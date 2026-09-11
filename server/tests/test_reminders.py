"""Isolated reminder tests; no running database, model or user records."""
import copy
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi.testclient import TestClient
from app.auth import Principal
from app.config import Settings
from app.contracts import ReminderConflict, reminder_arguments, reminder_time
from app.main import create_app
from app.plugins.todo import TodoStore

NOW = datetime(2026, 9, 7, 8, tzinfo=timezone.utc)


class ReminderConnection:
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
        if 'ORDER BY remind_at,id' in sql:
            assert "account_id=%s AND status='pending' AND remind_at <= now()" in sql
            rows = sorted((r for r in self.items if r['account_id'] == args[0] and r['status'] == 'pending'
                           and r['remind_at'] is not None and r['remind_at'] <= NOW), key=lambda r: (r['remind_at'], r['id']))
            return SimpleNamespace(fetchall=AsyncMock(return_value=copy.deepcopy(rows)))
        assert self.in_transaction
        if 'clock_timestamp()' in sql:
            return SimpleNamespace(fetchone=AsyncMock(return_value={'db_now': NOW}))
        if sql.startswith('SELECT'):
            assert 'WHERE id=%s AND account_id=%s FOR UPDATE' in sql
            row = next((r for r in self.items if (r['id'], r['account_id']) == args), None)
        else:
            assert 'WHERE id=%s AND account_id=%s RETURNING *' in sql
            assert not self.fail_update, 'isolated update failure'
            row = next((r for r in self.items if (r['id'], r['account_id']) == args[-2:]), None)
            if row:
                if 'SET remind_at=%s' in sql:
                    row['remind_at'] = args[0]
                else:
                    row['status'] = 'pending' if "SET status='pending'" in sql else 'completed'
                    if 'remind_at=NULL' in sql:
                        row['remind_at'] = None
        return SimpleNamespace(fetchone=AsyncMock(return_value=copy.deepcopy(row)))


def item(**changes):
    return dict(id=str(uuid4()), account_id=str(uuid4()), title='isolated', status='pending',
                created_at=NOW - timedelta(days=1), remind_at=None) | changes


def store_for(items):
    conn = ReminderConnection(items)
    @asynccontextmanager
    async def connection():
        yield conn
    return TodoStore(SimpleNamespace(pool=SimpleNamespace(connection=connection))), conn


class TimezoneSettingsTests(unittest.TestCase):
    def test_default_configured_and_invalid_zones(self):
        self.assertEqual(Settings(_env_file=None).default_timezone, 'Asia/Shanghai')
        self.assertEqual(Settings(_env_file=None, default_timezone='America/New_York').default_timezone,
                         'America/New_York')
        for value in ('', 'unknown/zone', '/etc/passwd', '../UTC'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                Settings(_env_file=None, default_timezone=value)


class ReminderStoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_set_retry_modify_clear_preserve_identity_without_runs(self):
        row = item()
        store, conn = store_for([row])
        future = NOW + timedelta(minutes=10)
        first = await store.set_todo_reminder(row['account_id'], row['id'], future, None)
        self.assertEqual(first['remind_at'], future.isoformat())
        self.assertNotIn('account_id', first)
        count = sum(sql.startswith('UPDATE') for sql, _ in conn.calls)
        self.assertEqual(await store.set_todo_reminder(row['account_id'], row['id'], future, None), first)
        self.assertEqual(sum(sql.startswith('UPDATE') for sql, _ in conn.calls), count)
        later = future + timedelta(minutes=10)
        await store.set_todo_reminder(row['account_id'], row['id'], later, future)
        self.assertIsNone((await store.set_todo_reminder(row['account_id'], row['id'], None, later))['remind_at'])
        self.assertEqual(conn.items, [row])
        self.assertTrue(all('agent_' not in sql and 'INSERT' not in sql for sql, _ in conn.calls))

    async def test_equivalent_instant_retry_after_due_needs_no_clock_or_write(self):
        row = item(remind_at=NOW - timedelta(minutes=1))
        store, conn = store_for([row])
        await store.set_todo_reminder(row['account_id'], row['id'], row['remind_at'].astimezone(timezone(timedelta(hours=8))), None)
        self.assertEqual(len(conn.calls), 1)
        self.assertEqual(conn.items, [row])

    async def test_conflict_blocks_overwrite_and_completed_cannot_schedule(self):
        row = item(remind_at=NOW + timedelta(minutes=10))
        store, conn = store_for([row])
        for target in [None, NOW + timedelta(minutes=20)]:
            with self.assertRaises(ReminderConflict):
                await store.set_todo_reminder(row['account_id'], row['id'], target, None)
        self.assertEqual(conn.items, [row])
        conn.items[0]['status'] = 'completed'
        with self.assertRaises(ReminderConflict):
            await store.set_todo_reminder(row['account_id'], row['id'], row['remind_at'], None)
        self.assertFalse(any(sql.startswith('UPDATE') for sql, _ in conn.calls))

    async def test_foreign_and_missing_same_invalid_uuid_no_query(self):
        row = item()
        store, conn = store_for([row])
        errors = []
        for owner, todo_id in [(str(uuid4()), row['id']), (row['account_id'], str(uuid4()))]:
            with self.assertRaises(LookupError) as result:
                await store.set_todo_reminder(owner, todo_id, None, None)
            errors.append(str(result.exception))
        self.assertEqual(errors[0], errors[1])
        before = len(conn.calls)
        with self.assertRaises(ValueError):
            await store.set_todo_reminder(row['account_id'], '../bad', None, None)
        self.assertEqual(len(conn.calls), before)
        self.assertEqual(conn.items, [row])

    async def test_future_uses_db_clock_and_failure_rolls_back(self):
        row = item()
        store, conn = store_for([row])
        for target in [NOW, NOW - timedelta(seconds=1)]:
            with self.assertRaises(ValueError):
                await store.set_todo_reminder(row['account_id'], row['id'], target, None)
        conn.fail_update = True
        with self.assertRaises(AssertionError):
            await store.set_todo_reminder(row['account_id'], row['id'], NOW + timedelta(minutes=1), None)
        self.assertEqual(conn.items, [row])

    async def test_due_owned_pending_ordered_nonconsuming_and_overdue(self):
        owner = str(uuid4())
        overdue, due = item(account_id=owner, remind_at=NOW - timedelta(days=2)), item(account_id=owner, remind_at=NOW)
        rows = [due, item(account_id=owner), item(account_id=owner, remind_at=NOW + timedelta(seconds=1)),
                item(account_id=owner, status='completed', remind_at=NOW), item(remind_at=NOW), overdue]
        store, conn = store_for(rows)
        result = await store.due_reminders(owner)
        self.assertEqual([r['id'] for r in result], [overdue['id'], due['id']])
        self.assertEqual(await store.due_reminders(owner), result)
        self.assertEqual(conn.items, rows)
        self.assertTrue(all(sql.startswith('SELECT') for sql, _ in conn.calls))

    async def test_complete_clears_atomically_reopen_does_not_revive(self):
        row = item(remind_at=NOW)
        store, conn = store_for([row])
        completed = await store.complete_todo(row['account_id'], row['id'])
        self.assertEqual(completed['status'], 'completed')
        self.assertIsNone(completed['remind_at'])
        self.assertEqual(len(conn.calls), 1)
        reopened = await store.reopen_todo(row['account_id'], row['id'])
        self.assertEqual(reopened['status'], 'pending')
        self.assertIsNone(reopened['remind_at'])
        self.assertEqual(conn.items[0]['id'], row['id'])


class ReminderParsingTests(unittest.TestCase):
    def test_strict_shape_zoned_instants_and_nonfinite_inputs(self):
        for body in [{}, {'remind_at': None}, {'remind_at': None, 'expected_remind_at': None, 'account_id': 'x'}, [], None]:
            with self.assertRaises(ValueError):
                reminder_arguments(body)
        for value in [True, 1, float('inf'), '', 'infinity', '2026-09-07', '2026-09-07T08:00:00',
                      '2026-99-99T00:00:00Z', '0001-01-01T00:00:00+23:00']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                reminder_time(value)
        self.assertEqual(reminder_time('2026-09-07T16:00:00+08:00'), reminder_time('2026-09-07T08:00:00Z'))
        self.assertEqual(reminder_arguments({'remind_at': None, 'expected_remind_at': None}), (None, None))


@asynccontextmanager
async def isolated_lifespan(app):
    yield


class ReminderGatewayTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(Settings())
        self.app.router.lifespan_context = isolated_lifespan
        self.app.state.auth = AsyncMock()
        self.who = Principal(str(uuid4()), str(uuid4()), ('control',))
        self.app.state.auth.authenticate.return_value = self.who
        self.app.state.service = AsyncMock()
        self.app.state.todo_store = AsyncMock()
        self.client = TestClient(self.app)
        self.todo_id = str(uuid4())
        self.url = f'/v1/todos/{self.todo_id}/reminder'

    def test_auth_before_bad_input_and_due_read(self):
        self.app.state.auth.authenticate.side_effect = PermissionError('拒绝')
        self.assertEqual(self.client.put(self.url, json={}).status_code, 403)
        self.assertEqual(self.client.get('/v1/todos/reminders/due').status_code, 403)
        self.app.state.todo_store.set_todo_reminder.assert_not_awaited()
        self.app.state.todo_store.due_reminders.assert_not_awaited()

    def test_due_schedule_principal_no_run(self):
        self.app.state.todo_store.due_reminders.return_value = []
        self.assertEqual(self.client.get('/v1/todos/reminders/due').json(), {'items': []})
        self.app.state.todo_store.due_reminders.assert_awaited_once_with(self.who.account_id)
        self.app.state.todo_store.set_todo_reminder.return_value = {'id': self.todo_id}
        result = self.client.put(self.url, json={'remind_at': '2026-09-07T16:00:00+08:00', 'expected_remind_at': None},
                                 headers={'authorization': 'Bearer unit-only'})
        self.assertEqual(result.status_code, 200)
        self.app.state.todo_store.set_todo_reminder.assert_awaited_once_with(self.who.account_id, self.todo_id, NOW, None)
        self.app.state.auth.authenticate.assert_awaited_with('Bearer unit-only', 'control')
        self.app.state.service.submit.assert_not_awaited()

    def test_bad_input_conflict_missing_sanitized_failure(self):
        for body in [{}, {'remind_at': 0, 'expected_remind_at': None}, {'remind_at': None, 'expected_remind_at': 'bad'}]:
            self.assertEqual(self.client.put(self.url, json=body).status_code, 400)
        self.assertEqual(self.client.put(self.url, content='not json').status_code, 400)
        self.assertEqual(self.client.put('/v1/todos/bad/reminder', json={}).status_code, 400)
        self.app.state.todo_store.set_todo_reminder.assert_not_awaited()
        for error, code in [(ReminderConflict('已修改'), 409), (LookupError('未找到'), 404),
                            (ValueError('时间已过去'), 400), (RuntimeError('secret db'), 503)]:
            self.app.state.todo_store.set_todo_reminder.side_effect = error
            result = self.client.put(self.url, json={'remind_at': None, 'expected_remind_at': None})
            self.assertEqual(result.status_code, code)
            self.assertNotIn('secret', result.text)
