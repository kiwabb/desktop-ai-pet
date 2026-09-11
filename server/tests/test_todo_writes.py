"""Isolated tests for direct todo create/update/delete; no database or model runs."""
import copy
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi.testclient import TestClient

from app.auth import Principal
from app.config import Settings
from app.main import create_app
from app.plugins.todo import TodoStore, validated_title

NOW = datetime(2026, 9, 7, 8, tzinfo=timezone.utc)


class TodoWriteConnection:
    """In-memory todos table matching the runtime_store write SQL shapes."""

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
        row = None
        if sql.startswith('INSERT INTO todos'):
            row = dict(id=args[0], account_id=args[1], title=args[2], status='pending',
                       remind_at=None, created_at=NOW)
            self.items.append(row)
        elif sql.startswith('UPDATE todos SET title'):
            assert 'WHERE id=%s AND account_id=%s RETURNING *' in sql
            row = next((item for item in self.items if (item['id'], item['account_id']) == tuple(args[1:])), None)
            if row:
                row['title'] = args[0]
        else:
            assert sql.startswith('DELETE FROM todos')
            assert 'WHERE id=%s AND account_id=%s RETURNING *' in sql
            row = next((item for item in self.items if (item['id'], item['account_id']) == tuple(args)), None)
            if row:
                self.items.remove(row)
        return SimpleNamespace(fetchone=AsyncMock(return_value=copy.deepcopy(row) if row else None))


def item(**changes):
    return dict(id=str(uuid4()), account_id=str(uuid4()), title='isolated', status='pending',
                created_at=NOW, remind_at=None) | changes


def store_for(items):
    conn = TodoWriteConnection(items)

    @asynccontextmanager
    async def connection():
        yield conn

    return TodoStore(SimpleNamespace(pool=SimpleNamespace(connection=connection))), conn


class TodoTitleTests(unittest.TestCase):
    def test_strips_and_bounds_like_the_create_tool(self):
        self.assertEqual(validated_title('  买菜  '), '买菜')
        self.assertEqual(validated_title('x' * 2000), 'x' * 2000)
        for bad in ['', '   ', 'x' * 2001, None, 7, ['title']]:
            with self.subTest(bad=bad), self.assertRaises(ValueError) as result:
                validated_title(bad)
            self.assertEqual(str(result.exception), '待办标题需为 1 到 2000 个字符')


class TodoWriteStoreTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_returns_wire_view_without_account(self):
        store, conn = store_for([])
        created = await store.create_todo('account-1', '  买牛奶  ')
        self.assertEqual(created['title'], '买牛奶')
        self.assertEqual(created['status'], 'pending')
        self.assertIsNone(created['remind_at'])
        self.assertNotIn('account_id', created)
        self.assertEqual(len(conn.items), 1)
        with self.assertRaises(ValueError):
            await store.create_todo('account-1', '   ')
        self.assertEqual(len(conn.items), 1)

    async def test_update_title_scopes_to_owner_and_allows_completed(self):
        row = item(status='completed')
        store, conn = store_for([row])
        updated = await store.update_todo_title(row['account_id'], row['id'], '  新标题 ')
        self.assertEqual(updated['title'], '新标题')
        self.assertEqual(updated['status'], 'completed')
        for owner, todo_id in [(str(uuid4()), row['id']), (row['account_id'], str(uuid4()))]:
            with self.assertRaises(LookupError) as result:
                await store.update_todo_title(owner, todo_id, 'x')
            self.assertEqual(str(result.exception), '待办不存在或已删除')
        self.assertEqual(conn.items[0]['title'], '新标题')
        with self.assertRaises(ValueError):
            await store.update_todo_title(row['account_id'], row['id'], '')

    async def test_delete_is_hard_and_reports_missing_once(self):
        row = item()
        store, conn = store_for([row])
        deleted = await store.delete_todo(row['account_id'], row['id'])
        self.assertEqual(deleted['id'], row['id'])
        self.assertEqual(conn.items, [])
        for owner, todo_id in [(row['account_id'], row['id']), (str(uuid4()), str(uuid4()))]:
            with self.assertRaises(LookupError) as result:
                await store.delete_todo(owner, todo_id)
            self.assertEqual(str(result.exception), '待办不存在或已删除')
        before = len(conn.calls)
        with self.assertRaises(ValueError):
            await store.delete_todo(row['account_id'], '../bad')
        self.assertEqual(len(conn.calls), before)


@asynccontextmanager
async def isolated_lifespan(app):
    yield


class TodoWriteGatewayTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(Settings())
        self.app.router.lifespan_context = isolated_lifespan
        self.who = Principal(str(uuid4()), str(uuid4()), ('control',))
        self.app.state.auth = AsyncMock()
        self.app.state.auth.authenticate.return_value = self.who
        self.app.state.service = AsyncMock()
        self.app.state.todo_store = AsyncMock()
        self.client = TestClient(self.app)
        self.todo_id = str(uuid4())
        self.item = {'id': self.todo_id, 'title': 'isolated', 'status': 'pending',
                     'created_at': '2026-09-07T00:00:00Z', 'remind_at': None}

    def test_auth_runs_before_input_parsing(self):
        self.app.state.auth.authenticate.side_effect = PermissionError('拒绝')
        self.assertEqual(self.client.post('/v1/todos', json={'title': 'x'}).status_code, 403)
        self.assertEqual(self.client.patch(f'/v1/todos/{self.todo_id}', json={'title': 'x'}).status_code, 403)
        self.assertEqual(self.client.delete(f'/v1/todos/{self.todo_id}').status_code, 403)
        self.app.state.todo_store.create_todo.assert_not_awaited()
        self.app.state.todo_store.update_todo_title.assert_not_awaited()
        self.app.state.todo_store.delete_todo.assert_not_awaited()
        self.app.state.service.submit.assert_not_awaited()

    def test_create_validates_body_shape(self):
        for request in [{'json': {}}, {'json': {'title': 'x', 'extra': 1}}, {'json': []},
                        {'content': 'not json'}]:
            self.assertEqual(self.client.post('/v1/todos', **request).status_code, 400)
        self.app.state.todo_store.create_todo.assert_not_awaited()

    def test_create_returns_item_and_delegates_with_principal(self):
        self.app.state.todo_store.create_todo.return_value = self.item
        response = self.client.post('/v1/todos', json={'title': '买牛奶'},
                                    headers={'authorization': 'Bearer unit-only'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'item': self.item})
        self.app.state.todo_store.create_todo.assert_awaited_once_with(self.who.account_id, '买牛奶')
        self.app.state.auth.authenticate.assert_awaited_with('Bearer unit-only', 'control')
        self.app.state.service.submit.assert_not_awaited()

    def test_update_validates_uuid_body_and_maps_errors(self):
        self.assertEqual(self.client.patch('/v1/todos/bad', json={'title': 'x'}).status_code, 400)
        self.assertEqual(self.client.patch(f'/v1/todos/{self.todo_id}', json={}).status_code, 400)
        self.app.state.todo_store.update_todo_title.assert_not_awaited()
        for error, code in [(ValueError('待办标题需为 1 到 2000 个字符'), 400),
                            (LookupError('待办不存在或已删除'), 404),
                            (RuntimeError('secret db'), 503)]:
            self.app.state.todo_store.update_todo_title.side_effect = error
            response = self.client.patch(f'/v1/todos/{self.todo_id}', json={'title': 'x'})
            self.assertEqual(response.status_code, code)
            self.assertNotIn('secret', response.text)
        self.app.state.todo_store.update_todo_title.side_effect = None
        self.app.state.todo_store.update_todo_title.return_value = self.item
        response = self.client.patch(f'/v1/todos/{self.todo_id}', json={'title': '新标题'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'item': self.item})
        self.app.state.todo_store.update_todo_title.assert_awaited_with(self.who.account_id, self.todo_id, '新标题')

    def test_delete_returns_snapshot_and_maps_errors(self):
        self.assertEqual(self.client.delete('/v1/todos/bad').status_code, 400)
        self.app.state.todo_store.delete_todo.assert_not_awaited()
        for error, code in [(LookupError('待办不存在或已删除'), 404), (RuntimeError('secret db'), 503)]:
            self.app.state.todo_store.delete_todo.side_effect = error
            response = self.client.delete(f'/v1/todos/{self.todo_id}')
            self.assertEqual(response.status_code, code)
            self.assertNotIn('secret', response.text)
        self.app.state.todo_store.delete_todo.side_effect = None
        self.app.state.todo_store.delete_todo.return_value = self.item
        response = self.client.delete(f'/v1/todos/{self.todo_id}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'item': self.item})
        self.app.state.todo_store.delete_todo.assert_awaited_with(self.who.account_id, self.todo_id)
        self.app.state.service.submit.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
