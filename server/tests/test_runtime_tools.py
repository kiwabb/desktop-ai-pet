"""Isolated tool tests with transactional doubles, no real DB or model data."""
import copy
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from app.todo_tools import TodoTools, validated_arguments, TOOL_DEFINITIONS, MODEL_TOOLS
from app.registry import Registry
from app.runtime_store import LeaseLost, RuntimeStore, uuid_text, wire


class TransactionalDouble:
    complete_todo_in_transaction = staticmethod(RuntimeStore.complete_todo_in_transaction)
    set_todo_reminder_in_transaction = staticmethod(RuntimeStore.set_todo_reminder_in_transaction)
    def __init__(self):
        self.items = []
        self.tool = None
        self.reject_finish = False
        self.finishes = []
        self.account_seen = None
        self.db_now = datetime.now(timezone.utc)
        self.sql = []

    async def start_tool(self, run, owner, call_id, name, arguments):
        if self.tool is None:
            self.tool = dict(id=str(uuid4()), name=name, run_id=run['id'], status='running', result=None, error=None)
        return copy.deepcopy(self.tool)

    @asynccontextmanager
    async def executing(self, run, owner):
        old_items, old_tool = copy.deepcopy((self.items, self.tool))
        try:
            yield self, run
        except Exception:
            self.items, self.tool = old_items, old_tool
            raise

    async def execute(self, sql, args=()):
        self.sql.append((sql, args))
        if 'clock_timestamp()' in sql:
            return SimpleNamespace(fetchone=AsyncMock(return_value={'db_now': self.db_now}))
        if sql.startswith('SELECT'):
            assert 'WHERE id=%s AND account_id=%s FOR UPDATE' in sql
            self.account_seen = args[1]
            item = next((item for item in self.items if (item['id'], item['account_id']) == args), None)
        elif sql.startswith('UPDATE todos'):
            assert 'WHERE id=%s AND account_id=%s' in sql
            self.account_seen = args[-1]
            item = next((item for item in self.items if (item['id'], item['account_id']) == args[-2:]), None)
            if item:
                if 'SET remind_at=%s' in sql:
                    item['remind_at'] = args[0]
                else:
                    item['status'] = 'pending' if "SET status='pending'" in sql else 'completed'
                    if 'remind_at=NULL' in sql:
                        item['remind_at'] = None
        else:
            assert sql.startswith('INSERT INTO todos')
            self.account_seen = args[1]
            item = dict(id=args[0], account_id=args[1], title=args[2], status='pending',
                        created_at=self.db_now, remind_at=None)
            self.items.append(item)
        return SimpleNamespace(fetchone=AsyncMock(return_value=item))

    async def finish_tool(self, conn, run, tool_id, result=None, error=None):
        if self.reject_finish and error is None:
            raise RuntimeError('injected transaction failure')
        self.tool.update(status='failed' if error else 'completed', result=result, error=error)
        self.finishes.append(copy.deepcopy(self.tool))
        return copy.deepcopy(self.tool)

    async def todos_in_transaction(self, conn, account_id):
        self.account_seen = account_id
        return wire(self.items)


class ToolTests(unittest.IsolatedAsyncioTestCase):
    def setup_tool(self):
        store = TransactionalDouble()
        registry = SimpleNamespace(resolve_server=AsyncMock(return_value='todo_create'))
        run = dict(id=str(uuid4()), session_id=str(uuid4()), account_id=str(uuid4()))
        return store, registry, TodoTools(store, registry), run

    async def test_create_owner_and_result_are_transaction_bound(self):
        store, registry, tools, run = self.setup_tool()
        result = await tools.execute(run, 'owner', {'id': 'call', 'name': 'todo_create', 'args': {'title': '隔离测试标题'}})
        self.assertEqual(store.account_seen, run['account_id'])
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['result']['item']['id'], store.items[0]['id'])
        registry.resolve_server.assert_awaited_once_with('todo.create')

    async def test_repeat_tool_does_not_repeat_write(self):
        store, registry, tools, run = self.setup_tool()
        call = {'id': 'call', 'name': 'todo_create', 'args': {'title': '隔离测试标题'}}
        first = await tools.execute(run, 'owner', call)
        second = await tools.execute(run, 'owner', call)
        self.assertEqual(first, second)
        self.assertEqual(len(store.items), 1)
        self.assertEqual(registry.resolve_server.await_count, 1)

    async def test_result_failure_rolls_back_todo_insert(self):
        store, registry, tools, run = self.setup_tool()
        store.reject_finish = True
        result = await tools.execute(run, 'owner', {'id': 'call', 'name': 'todo_create', 'args': {'title': '隔离测试标题'}})
        self.assertEqual(store.items, [])
        self.assertEqual(result['status'], 'failed')
        self.assertIsNone(result['result'])

    async def test_scheduled_create_is_one_atomic_owned_result_and_retry(self):
        store, registry, tools, run = self.setup_tool()
        target = store.db_now + timedelta(minutes=10)
        call = {'id': 'scheduled', 'name': 'todo_create',
                'args': {'title': '喝水', 'remind_at': target.isoformat()}}
        result = await tools.execute(run, 'owner', call)
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['result']['item']['remind_at'], target.isoformat())
        self.assertEqual(store.items[0]['account_id'], run['account_id'])
        self.assertEqual(store.items[0]['remind_at'], target)
        query_count = len(store.sql)
        self.assertEqual(await tools.execute(run, 'owner', call), result)
        self.assertEqual(len(store.sql), query_count)
        self.assertEqual(len(store.items), 1)
        self.assertEqual(len(store.finishes), 1)

    async def test_scheduled_create_invalid_past_and_result_failure_leave_no_todo(self):
        for mode in ('invalid', 'past', 'now', 'finish'):
            with self.subTest(mode=mode):
                store, registry, tools, run = self.setup_tool()
                target = {'invalid': '2026-09-07T15:15',
                          'past': (store.db_now - timedelta(seconds=1)).isoformat(),
                          'now': store.db_now.isoformat(),
                          'finish': (store.db_now + timedelta(minutes=10)).isoformat()}[mode]
                store.reject_finish = mode == 'finish'
                result = await tools.execute(run, 'owner', {'id': 'scheduled', 'name': 'todo_create',
                    'args': {'title': '喝水', 'remind_at': target}})
                self.assertEqual(store.items, [])
                self.assertEqual(result['status'], 'failed')
                self.assertIsNone(result['result'])
                self.assertNotIn('injected', result['error'])

    async def test_existing_reminder_set_clear_and_conflict_do_not_insert(self):
        store, registry, tools, run = self.setup_tool()
        registry.resolve_server.return_value = 'todo_reminder_set'
        item = dict(id=str(uuid4()), account_id=run['account_id'], title='喝水', status='pending',
                    created_at=store.db_now, remind_at=None)
        store.items.append(item)
        target = store.db_now + timedelta(minutes=10)
        args = {'todo_id': item['id'], 'remind_at': target.isoformat(), 'expected_remind_at': None}
        result = await tools.execute(run, 'owner', {'id': 'set', 'name': 'todo_reminder_set', 'args': args})
        self.assertEqual(result['result']['item']['remind_at'], target.isoformat())
        registry.resolve_server.assert_awaited_with('todo.reminder.set')
        store.tool = None
        conflict = await tools.execute(run, 'owner', {'id': 'stale', 'name': 'todo_reminder_set',
            'args': {**args, 'remind_at': None}})
        self.assertEqual(conflict['status'], 'failed')
        self.assertEqual(conflict['error'], '提醒已被修改，请刷新后重试')
        self.assertEqual(store.items[0]['remind_at'], target)
        store.tool = None
        cleared = await tools.execute(run, 'owner', {'id': 'clear', 'name': 'todo_reminder_set',
            'args': {**args, 'remind_at': None, 'expected_remind_at': target.isoformat()}})
        self.assertIsNone(cleared['result']['item']['remind_at'])
        self.assertFalse(any(sql.startswith('INSERT') for sql, _ in store.sql))
        self.assertEqual(len(store.items), 1)

    async def test_reminder_tool_result_failure_rolls_back_and_foreign_is_hidden(self):
        store, registry, tools, run = self.setup_tool()
        registry.resolve_server.return_value = 'todo_reminder_set'
        row = dict(id=str(uuid4()), account_id=run['account_id'], title='喝水', status='pending',
                   created_at=store.db_now, remind_at=None)
        store.items.append(row)
        store.reject_finish = True
        args = {'todo_id': row['id'], 'remind_at': (store.db_now + timedelta(minutes=10)).isoformat(),
                'expected_remind_at': None}
        result = await tools.execute(run, 'owner', {'id': 'set', 'name': 'todo_reminder_set', 'args': args})
        self.assertEqual(result['status'], 'failed')
        self.assertIsNone(store.items[0]['remind_at'])
        store.reject_finish = False
        failures = []
        for todo_id in (row['id'], str(uuid4())):
            store.tool = None
            failures.append(await tools.execute({**run, 'account_id': str(uuid4())}, 'owner',
                {'id': 'foreign', 'name': 'todo_reminder_set', 'args': {**args, 'todo_id': todo_id}}))
        self.assertEqual(failures[0]['error'], failures[1]['error'])
        self.assertTrue(all(value['status'] == 'failed' for value in failures))
        self.assertIsNone(store.items[0]['remind_at'])

    def test_reminder_arguments_strict_and_ordinary_create_compatible(self):
        self.assertEqual(validated_arguments('todo_create', {'title': ' plain '})['title'], 'plain')
        self.assertIsNone(validated_arguments('todo_create', {'title': 'plain'})['remind_at'])
        self.assertIsNone(validated_arguments('todo_create', {'title': 'plain', 'remind_at': None})['remind_at'])
        args = {'todo_id': str(uuid4()), 'remind_at': None, 'expected_remind_at': None}
        self.assertEqual(validated_arguments('todo_reminder_set', args), args)
        invalid = [{}, {**args, 'todo_id': 'invalid'}, {**args, 'account_id': str(uuid4())}]
        invalid += [{key: value for key, value in args.items() if key != missing} for missing in args]
        invalid += [{**args, field: bad} for field in ('remind_at', 'expected_remind_at')
                    for bad in ('2026-09-07T15:15:00', '', 3, 'infinity', 'not-date')]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validated_arguments('todo_reminder_set', value)

    async def test_complete_is_owned_idempotent_and_retains_record(self):
        store, registry, tools, run = self.setup_tool()
        registry.resolve_server.return_value = 'todo_complete'
        item = dict(id=str(uuid4()), account_id=run['account_id'], title='隔离测试', status='pending', created_at=datetime.now(timezone.utc))
        store.items.append(item)
        call = {'id': 'complete', 'name': 'todo_complete', 'args': {'todo_id': item['id']}}
        first = await tools.execute(run, 'owner', call)
        self.assertEqual(first['result']['item']['status'], 'completed')
        self.assertEqual(await tools.execute(run, 'owner', call), first)
        store.tool = None  # A separate later tool call is also idempotent.
        second = await tools.execute(run, 'owner', {**call, 'id': 'again'})
        self.assertEqual(second['result'], first['result'])
        self.assertEqual(len(store.items), 1)
        registry.resolve_server.assert_awaited_with('todo.complete')

    async def test_completion_failure_rolls_back_business_change(self):
        store, registry, tools, run = self.setup_tool()
        registry.resolve_server.return_value = 'todo_complete'
        item = dict(id=str(uuid4()), account_id=run['account_id'], title='隔离测试', status='pending', created_at=datetime.now(timezone.utc))
        item['remind_at'] = datetime.now(timezone.utc)
        original_reminder = item['remind_at']
        store.items.append(item)
        store.reject_finish = True
        result = await tools.execute(run, 'owner', {'id': 'complete', 'name': 'todo_complete', 'args': {'todo_id': item['id']}})
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(store.items[0]['status'], 'pending')
        self.assertEqual(store.items[0]['remind_at'], original_reminder)
        self.assertIsNone(result['result'])

    async def test_other_account_and_missing_id_have_same_failure(self):
        store, registry, tools, run = self.setup_tool()
        registry.resolve_server.return_value = 'todo_complete'
        item = dict(id=str(uuid4()), account_id=str(uuid4()), title='隔离测试', status='pending', created_at=datetime.now(timezone.utc))
        store.items.append(item)
        results = []
        for todo_id in (item['id'], str(uuid4())):
            store.tool = None
            results.append(await tools.execute(run, 'owner', {'id': 'complete', 'name': 'todo_complete', 'args': {'todo_id': todo_id}}))
        self.assertEqual(results[0]['error'], results[1]['error'])
        self.assertTrue(all(result['status'] == 'failed' for result in results))
        self.assertEqual(store.items[0]['status'], 'pending')

    def test_complete_rejects_missing_extra_and_invalid_arguments(self):
        for arguments in ({}, {'todo_id': ''}, {'todo_id': 'not-uuid'}, {'todo_id': None}, {'todo_id': 1}, {'todo_id': str(uuid4()), 'title': 'extra'}):
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                validated_arguments('todo_complete', arguments)

    async def test_registry_mismatch_prevents_execution(self):
        store, registry, tools, run = self.setup_tool()
        registry.resolve_server.return_value = 'arbitrary_handler'
        result = await tools.execute(run, 'owner', {'id': 'call', 'name': 'todo_create', 'args': {'title': '隔离测试标题'}})
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(store.items, [])

    async def test_list_has_real_empty_shape(self):
        store, registry, tools, run = self.setup_tool()
        registry.resolve_server.return_value = 'todo_list'
        result = await tools.execute(run, 'owner', {'id': 'call', 'name': 'todo_list', 'args': {}})
        self.assertEqual(result['result'], {'items': []})
        self.assertEqual(store.account_seen, run['account_id'])

    def test_parameter_validation_blocks_owner_injection(self):
        with self.assertRaises(ValueError):
            validated_arguments('todo_create', {'title': 'title', 'account_id': str(uuid4())})
        for title in ('', '   ', 'x' * 2001, 5):
            with self.assertRaises(ValueError):
                validated_arguments('todo_create', {'title': title})

    def test_invalid_ids_are_domain_errors(self):
        for value in ('not-uuid', None, 12):
            with self.assertRaises(ValueError):
                uuid_text(value)


class SqlBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def store(self, rows):
        cursor = SimpleNamespace(fetchone=AsyncMock(side_effect=rows))
        conn = SimpleNamespace(execute=AsyncMock(return_value=cursor))
        @asynccontextmanager
        async def transaction():
            yield
        @asynccontextmanager
        async def connection():
            yield conn
        conn.transaction = transaction
        db = SimpleNamespace(pool=SimpleNamespace(connection=connection))
        return RuntimeStore(db), conn

    async def test_direct_completion_uses_owned_update_without_run(self):
        todo_id, account_id = str(uuid4()), str(uuid4())
        row = dict(id=todo_id, account_id=account_id, title='isolated', status='completed', created_at=datetime.now(timezone.utc))
        store, conn = self.store([row])
        result = await store.complete_todo(account_id, todo_id)
        self.assertEqual(result['status'], 'completed')
        conn.execute.assert_awaited_once()
        sql, args = conn.execute.await_args.args
        self.assertIn('WHERE id=%s AND account_id=%s', sql)
        self.assertEqual(args, (todo_id, account_id))
        self.assertNotIn('account_id', result)

    async def test_direct_completion_missing_and_invalid_rejected(self):
        store, conn = self.store([None])
        with self.assertRaises(ValueError):
            await store.complete_todo(str(uuid4()), 'invalid')
        conn.execute.assert_not_awaited()
        with self.assertRaises(LookupError):
            await store.complete_todo(str(uuid4()), str(uuid4()))

    async def test_direct_reopen_is_account_scoped_idempotent_and_preserves_record(self):
        account_id, other_account = str(uuid4()), str(uuid4())
        item = dict(id=str(uuid4()), account_id=account_id, title='isolated', status='completed', created_at=datetime.now(timezone.utc))
        conn = TransactionalDouble()
        conn.items.append(item)
        @asynccontextmanager
        async def connection():
            yield conn
        @asynccontextmanager
        async def transaction():
            yield
        conn.transaction = transaction
        store = RuntimeStore(SimpleNamespace(pool=SimpleNamespace(connection=connection)))
        original = copy.deepcopy(item)
        failures = []
        for owner, todo_id in [(other_account, item['id']), (account_id, str(uuid4()))]:
            with self.assertRaises(LookupError) as error:
                await store.reopen_todo(owner, todo_id)
            failures.append(str(error.exception))
        self.assertEqual(failures[0], failures[1])
        self.assertEqual(item, original)
        first = await store.reopen_todo(account_id, item['id'])
        self.assertEqual(first['status'], 'pending')
        self.assertEqual(await store.reopen_todo(account_id, item['id']), first)
        self.assertEqual(item, {**original, 'status': 'pending'})
        self.assertEqual(len(conn.items), 1)
        self.assertNotIn('account_id', first)
        self.assertIsNone(conn.tool)
        # The same record can be completed again using the original shared path.
        self.assertEqual((await store.complete_todo(account_id, item['id']))['status'], 'completed')

    async def test_direct_reopen_validates_before_database_and_propagates_failure(self):
        store, conn = self.store([None])
        with self.assertRaises(ValueError):
            await store.reopen_todo(str(uuid4()), 'invalid')
        conn.execute.assert_not_awaited()
        with self.assertRaises(LookupError):
            await store.reopen_todo(str(uuid4()), str(uuid4()))
        conn.execute.side_effect = RuntimeError('isolated write failure')
        with self.assertRaisesRegex(RuntimeError, 'isolated write failure'):
            await store.reopen_todo(str(uuid4()), str(uuid4()))

    async def test_other_account_snapshot_denied_before_messages_read(self):
        session_id = str(uuid4())
        store, conn = self.store([{'id': session_id, 'account_id': str(uuid4()), 'seq': 0}])
        with self.assertRaises(PermissionError):
            await store.snapshot(str(uuid4()), session_id)
        self.assertEqual(conn.execute.await_count, 1)

    async def test_request_reuse_with_changed_text_conflicts_before_insert(self):
        account_id, session_id = str(uuid4()), str(uuid4())
        store, conn = self.store([
            {'id': session_id, 'account_id': account_id, 'seq': 1},
            {'id': str(uuid4()), 'session_id': session_id, 'input_text': 'original'},
        ])
        with self.assertRaisesRegex(ValueError, '不同的消息'):
            await store.submit(account_id, str(uuid4()), session_id, 'changed')
        self.assertFalse(any('INSERT' in call.args[0] for call in conn.execute.await_args_list))

    async def test_exact_duplicate_returns_persisted_acceptance(self):
        account_id, session_id = str(uuid4()), str(uuid4())
        envelope = {'type': 'run.accepted', 'seq': 1}
        store, conn = self.store([
            {'id': session_id, 'account_id': account_id, 'seq': 1},
            {'id': str(uuid4()), 'session_id': session_id, 'input_text': 'original'},
            {'envelope': envelope},
        ])
        self.assertEqual(await store.submit(account_id, str(uuid4()), session_id, 'original'), envelope)
        self.assertFalse(any('INSERT' in call.args[0] for call in conn.execute.await_args_list))

    async def test_expired_lease_blocks_visible_writes(self):
        account_id, session_id, owner = str(uuid4()), str(uuid4()), str(uuid4())
        store, conn = self.store([
            {'id': session_id, 'account_id': account_id},
            {'status': 'running', 'lease_owner': owner, 'lease_valid': False},
        ])
        with self.assertRaises(LeaseLost):
            await store.append_delta(dict(id=str(uuid4()), account_id=account_id, session_id=session_id), owner, 'text')
        self.assertFalse(any('UPDATE agent_messages' in call.args[0] for call in conn.execute.await_args_list))


class RegistryContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_v2_and_reminder_instance_use_same_exposed_schema(self):
        @asynccontextmanager
        async def transaction():
            yield
        conn = SimpleNamespace(execute=AsyncMock(), transaction=transaction)
        @asynccontextmanager
        async def connection():
            yield conn
        await Registry(SimpleNamespace(pool=SimpleNamespace(connection=connection))).register_server_tools()
        definitions = {definition['name']: definition for definition in TOOL_DEFINITIONS}
        self.assertEqual(definitions['todo.create']['version'], '2')
        instances = [call.args[1] for call in conn.execute.await_args_list if 'INSERT INTO tool_instances' in call.args[0]]
        self.assertIn(('server:todo.create', 'todo.create', '2', 'todo_create'), instances)
        self.assertIn(('server:todo.reminder.set', 'todo.reminder.set', '1', 'todo_reminder_set'), instances)
        exposed = {tool['function']['name']: tool['function']['parameters'] for tool in MODEL_TOOLS}
        self.assertEqual(exposed['todo_create'], definitions['todo.create']['input_schema'])
        self.assertEqual(exposed['todo_reminder_set'], definitions['todo.reminder.set']['input_schema'])
        self.assertEqual(set(exposed['todo_reminder_set']['required']),
                         {'todo_id', 'remind_at', 'expected_remind_at'})


if __name__ == '__main__':
    unittest.main()
