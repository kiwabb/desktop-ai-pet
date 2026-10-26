"""Isolated tests for memo REST endpoints; no database or model runs."""
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi.testclient import TestClient

from app.auth import Principal
from app.config import Settings
from app.contracts import ReminderConflict
from app.main import create_app

NOW = datetime(2026, 9, 17, 8, tzinfo=timezone.utc)


@asynccontextmanager
async def isolated_lifespan(app):
    yield


class MemoGatewayTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(Settings())
        self.app.router.lifespan_context = isolated_lifespan
        self.who = Principal(str(uuid4()), str(uuid4()), ('control',))
        self.app.state.auth = AsyncMock()
        self.app.state.auth.authenticate.return_value = self.who
        self.app.state.service = AsyncMock()
        self.app.state.memo_store = AsyncMock()
        self.client = TestClient(self.app)
        self.memo_id = str(uuid4())
        self.item = {'id': self.memo_id, 'kind': 'note', 'title': 'isolated', 'content': None,
                     'status': 'active', 'review_at': None, 'created_at': '2026-09-17T00:00:00Z'}
        self.store_methods = (self.app.state.memo_store.list_memos, self.app.state.memo_store.create_memo,
                              self.app.state.memo_store.update_memo, self.app.state.memo_store.set_memo_archived,
                              self.app.state.memo_store.set_memo_review, self.app.state.memo_store.due_reviews)

    def test_auth_runs_before_input_parsing(self):
        self.app.state.auth.authenticate.side_effect = PermissionError('拒绝')
        self.assertEqual(self.client.get('/v1/memos').status_code, 403)
        self.assertEqual(self.client.post('/v1/memos', json={'title': 'x'}).status_code, 403)
        self.assertEqual(self.client.patch(f'/v1/memos/{self.memo_id}', json={'title': 'x'}).status_code, 403)
        self.assertEqual(self.client.post(f'/v1/memos/{self.memo_id}/archive',
                                          json={'archived': True}).status_code, 403)
        self.assertEqual(self.client.put(f'/v1/memos/{self.memo_id}/review',
                                         json={'review_at': None, 'expected_review_at': None}).status_code, 403)
        self.assertEqual(self.client.get('/v1/memos/reviews/due').status_code, 403)
        for method in self.store_methods:
            method.assert_not_awaited()
        self.app.state.service.submit.assert_not_awaited()

    def test_list_delegates_filters_after_auth(self):
        self.app.state.memo_store.list_memos.return_value = [self.item]
        response = self.client.get('/v1/memos', headers={'authorization': 'Bearer unit-only'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'items': [self.item]})
        self.app.state.memo_store.list_memos.assert_awaited_once_with(self.who.account_id, None, False)
        self.app.state.auth.authenticate.assert_awaited_with('Bearer unit-only', 'control')
        self.client.get('/v1/memos?kind=goal&include_archived=true')
        self.app.state.memo_store.list_memos.assert_awaited_with(self.who.account_id, 'goal', True)
        for url in ('/v1/memos?kind=task', '/v1/memos?include_archived=yes'):
            self.assertEqual(self.client.get(url).status_code, 400)
        self.assertEqual(self.app.state.memo_store.list_memos.await_count, 2)
        self.app.state.service.submit.assert_not_awaited()

    def test_create_validates_body_and_delegates(self):
        for request in [{'json': {}}, {'json': {'title': 'x', 'extra': 1}}, {'json': []},
                        {'json': {'kind': 'note'}}, {'content': 'not json'},
                        {'json': {'title': 'x', 'review_at': '2026-09-17T16:00:00'}},
                        {'json': {'title': 'x', 'review_at': 5}}]:
            self.assertEqual(self.client.post('/v1/memos', **request).status_code, 400)
        self.app.state.memo_store.create_memo.assert_not_awaited()
        for error, code in [(ValueError('备忘标题需为 1 到 2000 个字符'), 400),
                            (ValueError('回顾时间必须晚于当前时间'), 400),
                            (RuntimeError('secret db'), 503)]:
            self.app.state.memo_store.create_memo.side_effect = error
            response = self.client.post('/v1/memos', json={'title': 'x'})
            self.assertEqual(response.status_code, code)
            self.assertNotIn('secret', response.text)
        self.app.state.memo_store.create_memo.side_effect = None
        self.app.state.memo_store.create_memo.return_value = self.item
        response = self.client.post('/v1/memos', json={'title': '目标', 'kind': 'goal', 'content': '细节'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'item': self.item})
        self.app.state.memo_store.create_memo.assert_awaited_with(self.who.account_id, '目标', 'goal', '细节', None)
        response = self.client.post('/v1/memos', json={'title': '回顾', 'review_at': '2026-09-17T16:00:00+08:00'})
        self.assertEqual(response.status_code, 200)
        self.app.state.memo_store.create_memo.assert_awaited_with(self.who.account_id, '回顾', 'note', None, NOW)

    def test_update_validates_uuid_body_and_maps_errors(self):
        self.assertEqual(self.client.patch('/v1/memos/bad', json={'title': 'x'}).status_code, 400)
        for body in [{}, {'title': 'x', 'status': 'archived'}, []]:
            self.assertEqual(self.client.patch(f'/v1/memos/{self.memo_id}', json=body).status_code, 400)
        self.app.state.memo_store.update_memo.assert_not_awaited()
        for error, code in [(ValueError('备忘标题需为 1 到 2000 个字符'), 400),
                            (LookupError('备忘不存在或已删除'), 404),
                            (RuntimeError('secret db'), 503)]:
            self.app.state.memo_store.update_memo.side_effect = error
            response = self.client.patch(f'/v1/memos/{self.memo_id}', json={'title': 'x'})
            self.assertEqual(response.status_code, code)
            self.assertNotIn('secret', response.text)
        self.app.state.memo_store.update_memo.side_effect = None
        self.app.state.memo_store.update_memo.return_value = self.item
        response = self.client.patch(f'/v1/memos/{self.memo_id}', json={'title': '新标题', 'content': None})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'item': self.item})
        self.app.state.memo_store.update_memo.assert_awaited_with(self.who.account_id, self.memo_id,
                                                                  {'title': '新标题', 'content': None})

    def test_archive_validates_body_and_maps_errors(self):
        self.assertEqual(self.client.post('/v1/memos/bad/archive', json={'archived': True}).status_code, 400)
        for body in [{}, {'archived': 1}, {'archived': True, 'extra': 1}]:
            self.assertEqual(self.client.post(f'/v1/memos/{self.memo_id}/archive', json=body).status_code, 400)
        self.app.state.memo_store.set_memo_archived.assert_not_awaited()
        self.app.state.memo_store.set_memo_archived.side_effect = LookupError('未找到备忘，请刷新核对')
        response = self.client.post(f'/v1/memos/{self.memo_id}/archive', json={'archived': True})
        self.assertEqual(response.status_code, 404)
        self.app.state.memo_store.set_memo_archived.side_effect = None
        self.app.state.memo_store.set_memo_archived.return_value = {**self.item, 'status': 'archived'}
        response = self.client.post(f'/v1/memos/{self.memo_id}/archive', json={'archived': True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['item']['status'], 'archived')
        self.app.state.memo_store.set_memo_archived.assert_awaited_with(self.who.account_id, self.memo_id, True)

    def test_review_validates_body_times_and_maps_conflict(self):
        url = f'/v1/memos/{self.memo_id}/review'
        self.assertEqual(self.client.put('/v1/memos/bad/review',
                                         json={'review_at': None, 'expected_review_at': None}).status_code, 400)
        for body in [{}, {'review_at': None}, {'review_at': 0, 'expected_review_at': None},
                     {'review_at': '2026-09-17T16:00:00', 'expected_review_at': None},
                     {'review_at': None, 'expected_review_at': None, 'extra': 1}]:
            self.assertEqual(self.client.put(url, json=body).status_code, 400)
        self.assertEqual(self.client.put(url, content='not json').status_code, 400)
        self.app.state.memo_store.set_memo_review.assert_not_awaited()
        for error, code in [(ReminderConflict('回顾时间已被修改，请刷新后重试'), 409),
                            (LookupError('未找到备忘，请刷新核对'), 404),
                            (ValueError('回顾时间必须晚于当前时间'), 400),
                            (RuntimeError('secret db'), 503)]:
            self.app.state.memo_store.set_memo_review.side_effect = error
            response = self.client.put(url, json={'review_at': None, 'expected_review_at': None})
            self.assertEqual(response.status_code, code)
            self.assertNotIn('secret', response.text)
        self.app.state.memo_store.set_memo_review.side_effect = None
        self.app.state.memo_store.set_memo_review.return_value = self.item
        response = self.client.put(url, json={'review_at': '2026-09-17T16:00:00+08:00',
                                              'expected_review_at': None})
        self.assertEqual(response.status_code, 200)
        self.app.state.memo_store.set_memo_review.assert_awaited_with(self.who.account_id, self.memo_id, NOW, None)

    def test_due_reviews_delegate_without_run(self):
        self.app.state.memo_store.due_reviews.return_value = [self.item]
        self.assertEqual(self.client.get('/v1/memos/reviews/due').json(), {'items': [self.item]})
        self.app.state.memo_store.due_reviews.assert_awaited_once_with(self.who.account_id)
        self.app.state.service.submit.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
