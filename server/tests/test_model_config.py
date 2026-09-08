"""Isolated protocol/config regressions; no live database or model is used."""
import asyncio
import json
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from cryptography.fernet import Fernet
from app.model_config import ModelConfigStore, encrypt_secret, validate_test_stream


class Connection:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.queries = []

    async def execute(self, query, params=()):
        if query.count('%s') != len(params):
            raise AssertionError('SQL parameter count mismatch')
        self.queries.append((query, params))
        return self

    async def fetchone(self):
        return self.rows.pop(0) if self.rows else None

    @asynccontextmanager
    async def transaction(self):
        yield self


class Pool:
    def __init__(self, conn):
        self.conn = conn

    @asynccontextmanager
    async def connection(self):
        yield self.conn


def stream(*events):
    return ''.join('data: ' + (event if isinstance(event, str) else json.dumps(event)) + '\n\n' for event in events).encode()


def delta(text='ok', finish=None):
    return {'choices': [{'index': 0, 'delta': {'content': text}, 'finish_reason': finish}]}


class ModelProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_complete_stream_required(self):
        valid = stream(delta(), delta('', 'stop'), '[DONE]')
        await validate_test_stream(httpx.Response(200, headers={'content-type': 'text/event-stream'}, content=valid))
        cases = [
            (302, 'text/html', b'redirect'), (200, 'text/html', b'ok'),
            (200, 'text/event-stream', stream({'error': {'message': 'secret upstream error'}})),
            (200, 'text/event-stream', stream(delta())),
            (200, 'text/event-stream', stream(delta(), '[DONE]')),
            (200, 'text/event-stream', stream(delta(), delta('', 'length'), '[DONE]')),
            (200, 'text/event-stream', stream(delta('', 'stop'), '[DONE]')),
            (200, 'text/event-stream', valid + stream(delta())),
            (200, 'text/event-stream', b':' + b'x' * 262144),
        ]
        for status, content_type, body in cases:
            with self.subTest(status=status, body=body[:60]), self.assertRaises(ValueError):
                await validate_test_stream(httpx.Response(status, headers={'content-type': content_type}, content=body))

    async def test_split_utf8_sse_chunks(self):
        body = stream(delta('成功'), delta('', 'stop'), '[DONE]')
        class Response:
            status_code = 200
            headers = {'content-type': 'text/event-stream'}
            async def aiter_bytes(self):
                for byte in body:
                    yield bytes([byte])
        await validate_test_stream(Response())

    async def test_error_event_with_or_without_optional_space_is_rejected(self):
        for event in (b'event:error\n', b'event: error\n'):
            body = event + stream(delta(), delta('', 'stop'), '[DONE]')
            with self.subTest(event=event), self.assertRaisesRegex(ValueError, '错误事件'):
                await validate_test_stream(httpx.Response(200, headers={'content-type': 'text/event-stream'}, content=body))

    async def test_state_lock_and_audit_parameter_contract(self):
        conn = Connection()
        store = ModelConfigStore(SimpleNamespace(pool=Pool(conn)), SimpleNamespace())
        await store.state(conn, for_update=True)
        self.assertTrue(conn.queries[-1][0].endswith('FOR UPDATE OF s'))
        await store._audit(conn, str(uuid4()), 'model_config.test', str(uuid4()), 'success')
        self.assertEqual(len(conn.queries[-1][1]), 7)

    async def test_real_http_client_mock_transport_result_maps_to_audit_domain(self):
        key = Fernet.generate_key().decode()
        for body, expected, audit_result in [(stream(delta(), delta('', 'stop'), '[DONE]'), 'succeeded', 'success'),
                                              (stream({'error': {'message': 'secret'}}), 'failed', 'failure')]:
            conn = Connection()
            store = ModelConfigStore(SimpleNamespace(pool=Pool(conn)), SimpleNamespace(admin_encryption_key=key))
            store.version = AsyncMock(return_value={'ciphertext': encrypt_secret(key, 'isolated-test-key'),
                                                    'model_name': 'isolated', 'base_url': 'https://model.invalid/v1', 'timeout_seconds': 5})
            client = httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(200, headers={'content-type':'text/event-stream'}, content=body)))
            with patch('app.model_config.httpx.AsyncClient', return_value=client):
                result = await store.test('admin', str(uuid4()))
            self.assertEqual(result['status'], expected)
            self.assertEqual(conn.queries[-1][1][4], audit_result)
            self.assertNotIn('secret', result.get('error_message') or '')
            self.assertIn('validation_version', conn.queries[0][0])

    async def test_publish_rejects_expired_weak_or_latest_failed_test_and_bad_key(self):
        now = datetime.now(timezone.utc)
        key = Fernet.generate_key().decode()
        version = {'ciphertext': encrypt_secret(key, 'isolated'), 'rollback_source_version_id': None}
        tests = [None, {'status': 'failed', 'validation_version': 'sse-v2', 'completed_at': now},
                 {'status': 'succeeded', 'validation_version': None, 'completed_at': now},
                 {'status': 'succeeded', 'validation_version': 'sse-v2', 'completed_at': now - timedelta(days=2)}]
        for test in tests:
            conn = Connection([test])
            store = ModelConfigStore(SimpleNamespace(pool=Pool(conn)), SimpleNamespace(admin_encryption_key=key))
            store.state = AsyncMock(return_value={'management_enabled': True, 'revision': 0, 'active_version_id': None})
            store.version = AsyncMock(return_value=version)
            with self.assertRaises(ValueError):
                await store.publish('admin', 'version', 0)
            self.assertFalse(any('UPDATE model_config_state' in q for q, _ in conn.queries))
        conn = Connection([{'status':'succeeded', 'validation_version':'sse-v2', 'completed_at':now}])
        store = ModelConfigStore(SimpleNamespace(pool=Pool(conn)), SimpleNamespace(admin_encryption_key=Fernet.generate_key().decode()))
        store.state = AsyncMock(return_value={'management_enabled':True,'revision':0})
        store.version = AsyncMock(return_value=version)
        with self.assertRaises(RuntimeError):
            await store.publish('admin','version',0)

    async def test_rollback_uses_selected_key_and_publication_kind(self):
        key = Fernet.generate_key().decode()
        now = datetime.now(timezone.utc)
        conn = Connection([{'status':'succeeded','validation_version':'sse-v2','completed_at':now}, {'id':'publication'}])
        store = ModelConfigStore(SimpleNamespace(pool=Pool(conn)), SimpleNamespace(admin_encryption_key=key))
        row = {'base_url':'https://model.invalid', 'model_name':'model', 'timeout_seconds':90,
               'ciphertext':encrypt_secret(key,'isolated'), 'rollback_source_version_id':'historical'}
        store.state = AsyncMock(return_value={'management_enabled':True,'revision':4,'active_version_id':'current'})
        store.version = AsyncMock(return_value=row)
        store.save_draft = AsyncMock(return_value={})
        await store.clone_for_rollback('admin', 'historical')
        self.assertEqual(store.save_draft.call_args.args[1]['parent_version_id'], 'current')
        await store.clone_for_rollback('admin', 'historical', 'historical')
        self.assertEqual(store.save_draft.call_args.args[1]['parent_version_id'], 'historical')
        await store.publish('admin','candidate',4)
        publication = next(params for query, params in conn.queries if 'INSERT INTO model_config_publications' in query)
        self.assertEqual(publication[3], 'rollback')


if __name__ == '__main__':
    unittest.main()
