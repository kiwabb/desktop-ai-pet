"""Isolated memo tool and store tests with transactional doubles; no real DB or model."""
import copy
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from app.contracts import ReminderConflict
from app.plugin_runtime import PluginRegistry
from app.plugins.memo import MemoPlugin, MemoStore, validated_arguments
from app.runtime_store import wire

NOW = datetime(2026, 9, 17, 8, tzinfo=timezone.utc)


def seed_item(**changes):
    return dict(id=str(uuid4()), account_id=str(uuid4()), kind='note', title='isolated', content=None,
                status='active', review_at=None, created_at=NOW - timedelta(days=1)) | changes


class TransactionalDouble:
    """Core skeleton + memos table in one double; asserts the SQL shapes."""

    set_memo_review_in_transaction = staticmethod(MemoStore.set_memo_review_in_transaction)
    set_memo_archived_in_transaction = staticmethod(MemoStore.set_memo_archived_in_transaction)
    update_memo_in_transaction = staticmethod(MemoStore.update_memo_in_transaction)

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
            self.tool = dict(id=str(uuid4()), name=name, run_id=run['id'], status='running',
                             result=None, error=None)
        return copy.deepcopy(self.tool)

    @asynccontextmanager
    async def executing(self, run, owner):
        old_items, old_tool = copy.deepcopy((self.items, self.tool))
        try:
            yield self, run
        except Exception:
            self.items, self.tool = old_items, old_tool
            raise

    def _find(self, memo_id, account_id):
        return next((item for item in self.items if (item['id'], item['account_id']) == (memo_id, account_id)), None)

    async def execute(self, sql, args=()):
        self.sql.append((sql, args))
        item = None
        if 'clock_timestamp()' in sql:
            return SimpleNamespace(fetchone=AsyncMock(return_value={'db_now': self.db_now}))
        if sql.startswith('SELECT'):
            assert 'WHERE id=%s AND account_id=%s FOR UPDATE' in sql
            self.account_seen = args[1]
            item = self._find(*args)
        elif sql.startswith('UPDATE memos SET review_at=%s'):
            assert 'WHERE id=%s AND account_id=%s RETURNING *' in sql
            self.account_seen = args[-1]
            item = self._find(*args[-2:])
            if item:
                item['review_at'] = args[0]
        elif sql.startswith("UPDATE memos SET status='archived', review_at=NULL"):
            assert 'WHERE id=%s AND account_id=%s RETURNING *' in sql
            item = self._find(*args)
            if item:
                item['status'], item['review_at'] = 'archived', None
        elif sql.startswith("UPDATE memos SET status='active'"):
            assert 'WHERE id=%s AND account_id=%s RETURNING *' in sql
            item = self._find(*args)
            if item:
                item['status'] = 'active'
        elif sql.startswith('UPDATE memos SET'):
            assert 'WHERE id=%s AND account_id=%s RETURNING *' in sql
            item = self._find(*args[-2:])
            if item:
                set_clause = sql[len('UPDATE memos SET '):sql.index(' WHERE id=%s')]
                fields = [part.split('=')[0] for part in set_clause.split(', ')]
                assert set(fields) <= {'title', 'content', 'kind'}
                for field, value in zip(fields, args[:-2]):
                    item[field] = value
        else:
            assert sql.startswith('INSERT INTO memos')
            assert 'source_tool_call_id' in sql
            self.account_seen = args[1]
            item = dict(id=args[0], account_id=args[1], kind=args[2], title=args[3], content=args[4],
                        status='active', review_at=None, created_at=self.db_now)
            self.items.append(item)
        return SimpleNamespace(fetchone=AsyncMock(return_value=item))

    async def finish_tool(self, conn, run, tool_id, result=None, error=None):
        if self.reject_finish and error is None:
            raise RuntimeError('injected transaction failure')
        self.tool.update(status='failed' if error else 'completed', result=result, error=error)
        self.finishes.append(copy.deepcopy(self.tool))
        return copy.deepcopy(self.tool)

    async def memos_in_transaction(self, conn, account_id, kind=None, include_archived=False):
        self.account_seen = account_id
        items = [item for item in self.items if item['account_id'] == account_id
                 and (kind is None or item['kind'] == kind)
                 and (include_archived or item['status'] == 'active')]
        return wire(copy.deepcopy(items))


class MemoToolTests(unittest.IsolatedAsyncioTestCase):
    def setup_tool(self):
        store = TransactionalDouble()
        registry = SimpleNamespace(resolve_server=AsyncMock(return_value='memo_create'))
        run = dict(id=str(uuid4()), session_id=str(uuid4()), account_id=str(uuid4()))
        plugin = MemoPlugin()
        # The double provides both the core skeleton and the domain primitives
        # (in production both wrap the same database pool).
        plugin.store = store
        return store, registry, PluginRegistry(store, registry, [plugin]), run

    async def test_create_owner_and_result_are_transaction_bound(self):
        store, registry, tools, run = self.setup_tool()
        result = await tools.execute(run, 'owner', {'id': 'call', 'name': 'memo_create',
                                                    'args': {'title': ' 隔离测试标题 '}})
        self.assertEqual(store.account_seen, run['account_id'])
        self.assertEqual(result['status'], 'completed')
        item = result['result']['item']
        self.assertEqual(item['id'], store.items[0]['id'])
        self.assertEqual(item['title'], '隔离测试标题')
        self.assertEqual(item['kind'], 'note')
        self.assertIsNone(item['content'])
        self.assertIsNone(item['review_at'])
        self.assertNotIn('account_id', item)
        registry.resolve_server.assert_awaited_once_with('memo.create', tools.handlers)

    async def test_repeat_tool_does_not_repeat_write(self):
        store, registry, tools, run = self.setup_tool()
        call = {'id': 'call', 'name': 'memo_create', 'args': {'title': '隔离测试标题'}}
        first = await tools.execute(run, 'owner', call)
        second = await tools.execute(run, 'owner', call)
        self.assertEqual(first, second)
        self.assertEqual(len(store.items), 1)
        self.assertEqual(registry.resolve_server.await_count, 1)

    async def test_result_failure_rolls_back_memo_insert(self):
        store, registry, tools, run = self.setup_tool()
        store.reject_finish = True
        result = await tools.execute(run, 'owner', {'id': 'call', 'name': 'memo_create',
                                                    'args': {'title': '隔离测试标题'}})
        self.assertEqual(store.items, [])
        self.assertEqual(result['status'], 'failed')
        self.assertIsNone(result['result'])

    async def test_create_with_review_is_one_atomic_owned_result_and_retry(self):
        store, registry, tools, run = self.setup_tool()
        target = store.db_now + timedelta(minutes=10)
        call = {'id': 'scheduled', 'name': 'memo_create',
                'args': {'title': '长期目标草稿', 'kind': 'goal', 'content': '细节',
                         'review_at': target.isoformat()}}
        result = await tools.execute(run, 'owner', call)
        self.assertEqual(result['status'], 'completed')
        item = result['result']['item']
        self.assertEqual(item['review_at'], target.isoformat())
        self.assertEqual(item['kind'], 'goal')
        self.assertEqual(item['content'], '细节')
        self.assertEqual(store.items[0]['account_id'], run['account_id'])
        self.assertEqual(store.items[0]['review_at'], target)
        query_count = len(store.sql)
        self.assertEqual(await tools.execute(run, 'owner', call), result)
        self.assertEqual(len(store.sql), query_count)
        self.assertEqual(len(store.items), 1)
        self.assertEqual(len(store.finishes), 1)

    async def test_create_invalid_past_review_and_result_failure_leave_no_memo(self):
        for mode in ('invalid', 'past', 'now', 'finish'):
            with self.subTest(mode=mode):
                store, registry, tools, run = self.setup_tool()
                target = {'invalid': '2026-09-17T15:15',
                          'past': (store.db_now - timedelta(seconds=1)).isoformat(),
                          'now': store.db_now.isoformat(),
                          'finish': (store.db_now + timedelta(minutes=10)).isoformat()}[mode]
                store.reject_finish = mode == 'finish'
                result = await tools.execute(run, 'owner', {'id': 'scheduled', 'name': 'memo_create',
                    'args': {'title': '每周回顾', 'review_at': target}})
                self.assertEqual(store.items, [])
                self.assertEqual(result['status'], 'failed')
                self.assertIsNone(result['result'])
                self.assertNotIn('injected', result['error'])

    async def test_review_set_clear_and_conflict_do_not_insert(self):
        store, registry, tools, run = self.setup_tool()
        registry.resolve_server.return_value = 'memo_review_set'
        item = seed_item(account_id=run['account_id'])
        store.items.append(item)
        target = store.db_now + timedelta(minutes=10)
        args = {'memo_id': item['id'], 'review_at': target.isoformat(), 'expected_review_at': None}
        result = await tools.execute(run, 'owner', {'id': 'set', 'name': 'memo_review_set', 'args': args})
        self.assertEqual(result['result']['item']['review_at'], target.isoformat())
        registry.resolve_server.assert_awaited_with('memo.review.set', tools.handlers)
        store.tool = None
        conflict = await tools.execute(run, 'owner', {'id': 'stale', 'name': 'memo_review_set',
            'args': {**args, 'review_at': None}})
        self.assertEqual(conflict['status'], 'failed')
        self.assertEqual(conflict['error'], '回顾时间已被修改，请刷新后重试')
        self.assertEqual(store.items[0]['review_at'], target)
        store.tool = None
        cleared = await tools.execute(run, 'owner', {'id': 'clear', 'name': 'memo_review_set',
            'args': {**args, 'review_at': None, 'expected_review_at': target.isoformat()}})
        self.assertIsNone(cleared['result']['item']['review_at'])
        self.assertFalse(any(sql.startswith('INSERT') for sql, _ in store.sql))
        self.assertEqual(len(store.items), 1)

    async def test_archived_memo_cannot_set_review(self):
        store, registry, tools, run = self.setup_tool()
        registry.resolve_server.return_value = 'memo_review_set'
        store.items.append(seed_item(account_id=run['account_id'], status='archived'))
        args = {'memo_id': store.items[0]['id'], 'review_at': None, 'expected_review_at': None}
        result = await tools.execute(run, 'owner', {'id': 'set', 'name': 'memo_review_set', 'args': args})
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['error'], '备忘已归档，请刷新核对')
        self.assertFalse(any(sql.startswith('UPDATE') for sql, _ in store.sql))

    async def test_review_set_foreign_and_missing_have_same_failure(self):
        store, registry, tools, run = self.setup_tool()
        registry.resolve_server.return_value = 'memo_review_set'
        store.items.append(seed_item(account_id=str(uuid4())))
        args = {'review_at': None, 'expected_review_at': None}
        failures = []
        for memo_id in (store.items[0]['id'], str(uuid4())):
            store.tool = None
            failures.append(await tools.execute(run, 'owner',
                {'id': 'foreign', 'name': 'memo_review_set', 'args': {**args, 'memo_id': memo_id}}))
        self.assertEqual(failures[0]['error'], failures[1]['error'])
        self.assertTrue(all(value['status'] == 'failed' for value in failures))

    async def test_archive_clears_review_and_unarchive_restores_active(self):
        store, registry, tools, run = self.setup_tool()
        registry.resolve_server.return_value = 'memo_archive'
        item = seed_item(account_id=run['account_id'], review_at=store.db_now + timedelta(minutes=10))
        store.items.append(item)
        call = {'id': 'archive', 'name': 'memo_archive', 'args': {'memo_id': item['id'], 'archived': True}}
        first = await tools.execute(run, 'owner', call)
        self.assertEqual(first['result']['item']['status'], 'archived')
        self.assertIsNone(first['result']['item']['review_at'])
        self.assertEqual(await tools.execute(run, 'owner', call), first)
        self.assertEqual(len(store.items), 1)
        registry.resolve_server.assert_awaited_with('memo.archive', tools.handlers)
        store.tool = None
        unarchived = await tools.execute(run, 'owner',
            {'id': 'restore', 'name': 'memo_archive', 'args': {'memo_id': item['id'], 'archived': False}})
        self.assertEqual(unarchived['result']['item']['status'], 'active')
        self.assertIsNone(unarchived['result']['item']['review_at'])

    async def test_archive_foreign_and_missing_have_same_failure(self):
        store, registry, tools, run = self.setup_tool()
        registry.resolve_server.return_value = 'memo_archive'
        store.items.append(seed_item(account_id=str(uuid4())))
        failures = []
        for memo_id in (store.items[0]['id'], str(uuid4())):
            store.tool = None
            failures.append(await tools.execute(run, 'owner',
                {'id': 'archive', 'name': 'memo_archive', 'args': {'memo_id': memo_id, 'archived': True}}))
        self.assertEqual(failures[0]['error'], failures[1]['error'])
        self.assertTrue(all(value['status'] == 'failed' for value in failures))
        self.assertEqual(store.items[0]['status'], 'active')

    async def test_update_changes_only_given_fields_and_hides_foreign(self):
        store, registry, tools, run = self.setup_tool()
        registry.resolve_server.return_value = 'memo_update'
        item = seed_item(account_id=run['account_id'], content='旧正文')
        store.items.append(item)
        call = {'id': 'update', 'name': 'memo_update',
                'args': {'memo_id': item['id'], 'title': ' 新标题 ', 'content': None}}
        result = await tools.execute(run, 'owner', call)
        updated = result['result']['item']
        self.assertEqual(updated['title'], '新标题')
        self.assertIsNone(updated['content'])
        self.assertEqual(updated['kind'], 'note')
        registry.resolve_server.assert_awaited_with('memo.update', tools.handlers)
        self.assertEqual(await tools.execute(run, 'owner', call), result)
        failures = []
        for owner, memo_id in [(str(uuid4()), item['id']), (run['account_id'], str(uuid4()))]:
            store.tool = None
            failures.append(await tools.execute({**run, 'account_id': owner}, 'owner',
                {'id': 'other', 'name': 'memo_update', 'args': {'memo_id': memo_id, 'title': 'x'}}))
        self.assertEqual(failures[0]['error'], failures[1]['error'])
        self.assertEqual(store.items[0]['title'], '新标题')

    async def test_list_defaults_exclude_archived_and_filters_kind(self):
        store, registry, tools, run = self.setup_tool()
        registry.resolve_server.return_value = 'memo_list'
        store.items = [seed_item(account_id=run['account_id']),
                       seed_item(account_id=run['account_id'], kind='goal'),
                       seed_item(account_id=run['account_id'], status='archived'),
                       seed_item()]
        result = await tools.execute(run, 'owner', {'id': 'list', 'name': 'memo_list', 'args': {}})
        self.assertEqual(len(result['result']['items']), 2)
        self.assertEqual(store.account_seen, run['account_id'])
        store.tool = None
        goals = await tools.execute(run, 'owner', {'id': 'goals', 'name': 'memo_list', 'args': {'kind': 'goal'}})
        self.assertEqual([item['kind'] for item in goals['result']['items']], ['goal'])
        store.tool = None
        everything = await tools.execute(run, 'owner',
            {'id': 'all', 'name': 'memo_list', 'args': {'include_archived': True}})
        self.assertEqual(len(everything['result']['items']), 3)
        registry.resolve_server.assert_awaited_with('memo.list', tools.handlers)

    async def test_registry_mismatch_prevents_execution(self):
        store, registry, tools, run = self.setup_tool()
        registry.resolve_server.return_value = 'arbitrary_handler'
        result = await tools.execute(run, 'owner', {'id': 'call', 'name': 'memo_create',
                                                    'args': {'title': '隔离测试标题'}})
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(store.items, [])


class MemoValidationTests(unittest.TestCase):
    def test_create_argument_validation(self):
        params = validated_arguments('memo_create', {'title': ' plain '})
        self.assertEqual(params, {'title': 'plain', 'kind': 'note', 'content': None, 'review_at': None})
        self.assertEqual(validated_arguments('memo_create', {'title': 't', 'kind': 'goal'})['kind'], 'goal')
        invalid = [{}, {'kind': 'note'}, {'title': 'x', 'account_id': str(uuid4())}, {'title': 'x', 'extra': 1}]
        invalid += [{'title': title} for title in ('', '   ', 'x' * 2001, 5)]
        invalid += [{'title': 'x', 'kind': kind} for kind in ('task', 1, None)]
        invalid += [{'title': 'x', 'content': content} for content in ('x' * 20001, 5)]
        invalid += [{'title': 'x', 'review_at': bad}
                    for bad in ('2026-09-17T15:15', '', 3, 'infinity', 'not-date')]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validated_arguments('memo_create', value)

    def test_list_argument_validation(self):
        self.assertEqual(validated_arguments('memo_list', {}), {'kind': None, 'include_archived': False})
        self.assertEqual(validated_arguments('memo_list', {'kind': 'goal', 'include_archived': True}),
                         {'kind': 'goal', 'include_archived': True})
        for value in ({'unknown': 1}, {'kind': 'task'}, {'include_archived': 'yes'}, {'include_archived': 1}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validated_arguments('memo_list', value)

    def test_update_argument_validation(self):
        memo_id = str(uuid4())
        self.assertEqual(validated_arguments('memo_update', {'memo_id': memo_id, 'content': None}),
                         {'memo_id': memo_id, 'content': None})
        invalid = [{}, {'memo_id': memo_id}, {'memo_id': memo_id, 'status': 'archived'},
                   {'memo_id': 'not-uuid', 'title': 'x'}, {'memo_id': memo_id, 'kind': 'task'},
                   {'memo_id': memo_id, 'title': ''}]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validated_arguments('memo_update', value)

    def test_archive_argument_validation(self):
        memo_id = str(uuid4())
        self.assertEqual(validated_arguments('memo_archive', {'memo_id': memo_id, 'archived': False}),
                         {'memo_id': memo_id, 'archived': False})
        invalid = [{}, {'memo_id': memo_id}, {'archived': True}, {'memo_id': memo_id, 'archived': 1},
                   {'memo_id': memo_id, 'archived': 'true'}, {'memo_id': memo_id, 'archived': True, 'extra': 1},
                   {'memo_id': 'not-uuid', 'archived': True}]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validated_arguments('memo_archive', value)

    def test_review_set_argument_validation(self):
        memo_id = str(uuid4())
        args = {'memo_id': memo_id, 'review_at': None, 'expected_review_at': None}
        self.assertEqual(validated_arguments('memo_review_set', args), args)
        invalid = [{}, {**args, 'memo_id': 'invalid'}, {**args, 'account_id': memo_id}]
        invalid += [{key: value for key, value in args.items() if key != missing} for missing in args]
        invalid += [{**args, field: bad} for field in ('review_at', 'expected_review_at')
                    for bad in ('2026-09-17T15:15:00', '', 3, 'infinity', 'not-date')]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validated_arguments('memo_review_set', value)

    def test_arguments_must_be_objects(self):
        for handler in ('memo_create', 'memo_list', 'memo_update', 'memo_archive', 'memo_review_set'):
            with self.subTest(handler=handler), self.assertRaises(ValueError):
                validated_arguments(handler, ['not-a-dict'])
        with self.assertRaises(ValueError):
            validated_arguments('memo_unknown', {})


class ReviewConnection:
    """In-memory memos table matching the review/list SQL shapes."""

    def __init__(self, items):
        self.items, self.calls = copy.deepcopy(items), []
        self.in_transaction = self.fail_update = False

    @asynccontextmanager
    async def transaction(self):
        previous = copy.deepcopy(self.items)
        self.in_transaction = True
        try:
            yield
        except Exception:
            self.items = previous
            raise
        finally:
            self.in_transaction = False

    async def execute(self, sql, args=()):
        self.calls.append((sql, args))
        if 'ORDER BY review_at,id' in sql:
            assert "account_id=%s AND status='active' AND review_at <= now()" in sql
            rows = sorted((row for row in self.items if row['account_id'] == args[0]
                           and row['status'] == 'active' and row['review_at'] is not None
                           and row['review_at'] <= NOW), key=lambda row: (row['review_at'], row['id']))
            return SimpleNamespace(fetchall=AsyncMock(return_value=copy.deepcopy(rows)))
        if 'ORDER BY created_at,id' in sql:
            account_id, kind, _kind, include_archived = args
            rows = [row for row in self.items if row['account_id'] == account_id
                    and (kind is None or row['kind'] == kind)
                    and (include_archived or row['status'] == 'active')]
            return SimpleNamespace(fetchall=AsyncMock(return_value=copy.deepcopy(rows)))
        assert self.in_transaction
        if 'clock_timestamp()' in sql:
            return SimpleNamespace(fetchone=AsyncMock(return_value={'db_now': NOW}))
        if sql.startswith('SELECT'):
            assert 'WHERE id=%s AND account_id=%s FOR UPDATE' in sql
            row = next((r for r in self.items if (r['id'], r['account_id']) == args), None)
        elif sql.startswith('UPDATE memos SET review_at=%s'):
            assert 'WHERE id=%s AND account_id=%s RETURNING *' in sql
            assert not self.fail_update, 'isolated update failure'
            row = next((r for r in self.items if (r['id'], r['account_id']) == args[-2:]), None)
            if row:
                row['review_at'] = args[0]
        elif sql.startswith("UPDATE memos SET status='archived', review_at=NULL"):
            row = next((r for r in self.items if (r['id'], r['account_id']) == tuple(args)), None)
            if row:
                row['status'], row['review_at'] = 'archived', None
        elif sql.startswith("UPDATE memos SET status='active'"):
            row = next((r for r in self.items if (r['id'], r['account_id']) == tuple(args)), None)
            if row:
                row['status'] = 'active'
        else:
            raise AssertionError(f'unexpected SQL: {sql}')
        return SimpleNamespace(fetchone=AsyncMock(return_value=copy.deepcopy(row)))


class MemoWriteConnection:
    """In-memory memos table matching the direct write SQL shapes."""

    def __init__(self, items):
        self.items, self.calls = copy.deepcopy(items), []
        self.in_transaction = False

    @asynccontextmanager
    async def transaction(self):
        previous = copy.deepcopy(self.items)
        self.in_transaction = True
        try:
            yield
        except Exception:
            self.items = previous
            raise
        finally:
            self.in_transaction = False

    async def execute(self, sql, args=()):
        self.calls.append((sql, args))
        assert self.in_transaction
        if 'clock_timestamp()' in sql:
            row = {'db_now': NOW}
        elif sql.startswith('INSERT INTO memos'):
            assert 'source_tool_call_id' not in sql
            row = dict(id=args[0], account_id=args[1], kind=args[2], title=args[3], content=args[4],
                       status='active', review_at=None, created_at=NOW)
            self.items.append(row)
        elif sql.startswith('SELECT'):
            assert 'WHERE id=%s AND account_id=%s FOR UPDATE' in sql
            row = next((item for item in self.items if (item['id'], item['account_id']) == args), None)
        elif sql.startswith('UPDATE memos SET'):
            assert 'WHERE id=%s AND account_id=%s RETURNING *' in sql
            row = next((item for item in self.items if (item['id'], item['account_id']) == args[-2:]), None)
            if row:
                set_clause = sql[len('UPDATE memos SET '):sql.index(' WHERE id=%s')]
                fields = [part.split('=')[0] for part in set_clause.split(', ')]
                for field, value in zip(fields, args[:-2]):
                    row[field] = value
        else:
            raise AssertionError(f'unexpected SQL: {sql}')
        return SimpleNamespace(fetchone=AsyncMock(return_value=copy.deepcopy(row) if row else None))


def store_for(items, connection=ReviewConnection):
    conn = connection(items)

    @asynccontextmanager
    async def pool_connection():
        yield conn

    return MemoStore(SimpleNamespace(pool=SimpleNamespace(connection=pool_connection))), conn


class MemoReviewStoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_set_retry_modify_clear_preserve_identity_without_runs(self):
        row = seed_item()
        store, conn = store_for([row])
        future = NOW + timedelta(minutes=10)
        first = await store.set_memo_review(row['account_id'], row['id'], future, None)
        self.assertEqual(first['review_at'], future.isoformat())
        self.assertNotIn('account_id', first)
        count = sum(sql.startswith('UPDATE') for sql, _ in conn.calls)
        self.assertEqual(await store.set_memo_review(row['account_id'], row['id'], future, None), first)
        self.assertEqual(sum(sql.startswith('UPDATE') for sql, _ in conn.calls), count)
        later = future + timedelta(minutes=10)
        await store.set_memo_review(row['account_id'], row['id'], later, future)
        self.assertIsNone((await store.set_memo_review(row['account_id'], row['id'], None, later))['review_at'])
        self.assertEqual(conn.items, [row])
        self.assertTrue(all('agent_' not in sql and 'INSERT' not in sql for sql, _ in conn.calls))

    async def test_equivalent_instant_retry_after_due_needs_no_clock_or_write(self):
        row = seed_item(review_at=NOW - timedelta(minutes=1))
        store, conn = store_for([row])
        await store.set_memo_review(row['account_id'], row['id'],
                                    row['review_at'].astimezone(timezone(timedelta(hours=8))), None)
        self.assertEqual(len(conn.calls), 1)
        self.assertEqual(conn.items, [row])

    async def test_conflict_blocks_overwrite_and_archived_cannot_schedule(self):
        row = seed_item(review_at=NOW + timedelta(minutes=10))
        store, conn = store_for([row])
        for target in [None, NOW + timedelta(minutes=20)]:
            with self.assertRaises(ReminderConflict):
                await store.set_memo_review(row['account_id'], row['id'], target, None)
        self.assertEqual(conn.items, [row])
        conn.items[0]['status'] = 'archived'
        with self.assertRaises(ReminderConflict):
            await store.set_memo_review(row['account_id'], row['id'], row['review_at'], None)
        self.assertFalse(any(sql.startswith('UPDATE') for sql, _ in conn.calls))

    async def test_foreign_and_missing_same_invalid_uuid_no_query(self):
        row = seed_item()
        store, conn = store_for([row])
        errors = []
        for owner, memo_id in [(str(uuid4()), row['id']), (row['account_id'], str(uuid4()))]:
            with self.assertRaises(LookupError) as result:
                await store.set_memo_review(owner, memo_id, None, None)
            errors.append(str(result.exception))
        self.assertEqual(errors[0], errors[1])
        before = len(conn.calls)
        with self.assertRaises(ValueError):
            await store.set_memo_review(row['account_id'], '../bad', None, None)
        self.assertEqual(len(conn.calls), before)
        self.assertEqual(conn.items, [row])

    async def test_future_uses_db_clock_and_failure_rolls_back(self):
        row = seed_item()
        store, conn = store_for([row])
        for target in [NOW, NOW - timedelta(seconds=1)]:
            with self.assertRaises(ValueError):
                await store.set_memo_review(row['account_id'], row['id'], target, None)
        conn.fail_update = True
        with self.assertRaises(AssertionError):
            await store.set_memo_review(row['account_id'], row['id'], NOW + timedelta(minutes=1), None)
        self.assertEqual(conn.items, [row])

    async def test_due_reviews_owned_active_ordered_nonconsuming_and_overdue(self):
        owner = str(uuid4())
        overdue = seed_item(account_id=owner, review_at=NOW - timedelta(days=2))
        due = seed_item(account_id=owner, review_at=NOW)
        rows = [due, seed_item(account_id=owner), seed_item(account_id=owner, review_at=NOW + timedelta(seconds=1)),
                seed_item(account_id=owner, status='archived', review_at=NOW), seed_item(review_at=NOW), overdue]
        store, conn = store_for(rows)
        result = await store.due_reviews(owner)
        self.assertEqual([row['id'] for row in result], [overdue['id'], due['id']])
        self.assertEqual(await store.due_reviews(owner), result)
        self.assertEqual(conn.items, rows)
        self.assertTrue(all(sql.startswith('SELECT') for sql, _ in conn.calls))

    async def test_archive_clears_review_and_unarchive_does_not_revive(self):
        row = seed_item(review_at=NOW)
        store, conn = store_for([row])
        archived = await store.set_memo_archived(row['account_id'], row['id'], True)
        self.assertEqual(archived['status'], 'archived')
        self.assertIsNone(archived['review_at'])
        self.assertEqual(len(conn.calls), 1)
        restored = await store.set_memo_archived(row['account_id'], row['id'], False)
        self.assertEqual(restored['status'], 'active')
        self.assertIsNone(restored['review_at'])
        self.assertEqual(conn.items[0]['id'], row['id'])

    async def test_list_memos_filters_kind_and_archived(self):
        owner = str(uuid4())
        rows = [seed_item(account_id=owner), seed_item(account_id=owner, kind='goal'),
                seed_item(account_id=owner, status='archived'), seed_item(kind='goal')]
        store, conn = store_for(rows)
        self.assertEqual(len(await store.list_memos(owner)), 2)
        self.assertEqual([row['kind'] for row in await store.list_memos(owner, kind='goal')], ['goal'])
        self.assertEqual(len(await store.list_memos(owner, include_archived=True)), 3)
        before = len(conn.calls)
        with self.assertRaises(ValueError):
            await store.list_memos(owner, kind='task')
        self.assertEqual(len(conn.calls), before)


class MemoWriteStoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_returns_wire_view_without_account(self):
        store, conn = store_for([], MemoWriteConnection)
        created = await store.create_memo('account-1', '  读论文  ', 'goal', ' 细节 ')
        self.assertEqual(created['title'], '读论文')
        self.assertEqual(created['kind'], 'goal')
        self.assertEqual(created['content'], ' 细节 ')
        self.assertEqual(created['status'], 'active')
        self.assertIsNone(created['review_at'])
        self.assertNotIn('account_id', created)
        self.assertEqual(len(conn.items), 1)
        for call in [('account-1', '   ', 'note', None), ('account-1', 'x', 'task', None),
                     ('account-1', 'x', 'note', 5)]:
            with self.subTest(call=call), self.assertRaises(ValueError):
                await store.create_memo(*call)
        self.assertEqual(len(conn.items), 1)

    async def test_create_with_review_is_atomic_and_uses_the_db_clock(self):
        store, conn = store_for([], MemoWriteConnection)
        future = NOW + timedelta(minutes=10)
        created = await store.create_memo('account-1', '回顾', 'note', None, future)
        self.assertEqual(created['review_at'], future.isoformat())
        self.assertEqual(conn.items[0]['review_at'], future)
        # A past target fails and leaves no orphan memo behind.
        with self.assertRaises(ValueError) as result:
            await store.create_memo('account-1', '过期', 'note', None, NOW - timedelta(minutes=1))
        self.assertEqual(str(result.exception), '回顾时间必须晚于当前时间')
        self.assertEqual(len(conn.items), 1)

    async def test_update_scopes_to_owner_and_validates_changes(self):
        row = seed_item(content='旧正文')
        store, conn = store_for([row], MemoWriteConnection)
        updated = await store.update_memo(row['account_id'], row['id'], {'title': ' 新标题 ', 'content': None})
        self.assertEqual(updated['title'], '新标题')
        self.assertIsNone(updated['content'])
        self.assertNotIn('account_id', updated)
        failures = []
        for owner, memo_id in [(str(uuid4()), row['id']), (row['account_id'], str(uuid4()))]:
            with self.assertRaises(LookupError) as result:
                await store.update_memo(owner, memo_id, {'title': 'x'})
            failures.append(str(result.exception))
        self.assertEqual(failures[0], failures[1])
        self.assertEqual(conn.items[0]['title'], '新标题')
        for changes in ({}, {'title': ''}, {'kind': 'task'}, {'status': 'archived'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                await store.update_memo(row['account_id'], row['id'], changes)
        before = len(conn.calls)
        with self.assertRaises(ValueError):
            await store.update_memo(row['account_id'], '../bad', {'title': 'x'})
        self.assertEqual(len(conn.calls), before)


if __name__ == '__main__':
    unittest.main()
