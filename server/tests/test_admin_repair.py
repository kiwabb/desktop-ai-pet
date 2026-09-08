"""Isolated HTTP and helper regressions, not real database acceptance."""
import hashlib
import json
import os
import tempfile
import time
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException
from starlette.requests import Request

from app.admin import AdminAuth, AdminPrincipal, _page_query, _page_result, install_admin_routes
from app.cli import admin_password
from app.model_config import decode_cursor, encode_cursor


class Connection:
    def __init__(self):
        self.queries = []
        self.rows = []
        self.idempotency = {}
        self.row_handler = lambda query, params: []

    async def execute(self, query, params=()):
        assert query.count('%s') == len(params)
        self.queries.append((query, params))
        if query.startswith('INSERT INTO admin_idempotency_keys'):
            admin, action, key, digest = params
            self.idempotency.setdefault((admin,action,key), {'request_hash':digest,'response':None})
            self.rows = []
        elif query.startswith('SELECT request_hash,response'):
            self.rows = [self.idempotency[tuple(params)]]
        elif query.startswith('UPDATE admin_idempotency_keys'):
            response, admin, action, key = params
            self.idempotency[(admin,action,key)]['response'] = response.obj
            self.rows = []
        else:
            self.rows = self.row_handler(query, params)
        return self

    async def fetchone(self):
        return self.rows[0] if self.rows else None

    async def fetchall(self):
        return self.rows

    @asynccontextmanager
    async def transaction(self):
        yield self

    @asynccontextmanager
    async def connection(self):
        yield self


def request(query='', headers=()):
    return Request({'type':'http','method':'GET','scheme':'http','server':('localhost',80),
                    'path':'/admin/v1/runs','query_string':query.encode(),'headers':list(headers)})


class AdminRepairTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.conn = Connection()
        self.app = FastAPI()
        install_admin_routes(self.app, SimpleNamespace(pool=self.conn), SimpleNamespace(), SimpleNamespace())
        self.principal = AdminPrincipal(str(uuid4()), 'admin', 'admin', '')
        self.app.state.admin_auth.current = AsyncMock(return_value=self.principal)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url='http://localhost')

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_account_retry_is_single_business_insert_and_conflict_rejected(self):
        headers = {'Idempotency-Key':str(uuid4())}
        first = await self.client.post('/admin/v1/accounts',json={'name':'内部账号'},headers=headers)
        second = await self.client.post('/admin/v1/accounts',json={'name':'内部账号'},headers=headers)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(sum(q.startswith('INSERT INTO accounts') for q,_ in self.conn.queries),1)
        conflict = await self.client.post('/admin/v1/accounts',json={'name':'不同账号'},headers=headers)
        self.assertEqual(conflict.status_code,409)
        missing = await self.client.post('/admin/v1/accounts',json={'name':'缺幂等键'})
        self.assertEqual(missing.status_code,400)

    async def test_device_retry_never_returns_or_persists_original_credential(self):
        self.conn.row_handler = lambda query, params: [{'exists':1}] if query.startswith('SELECT 1 FROM accounts') else []
        headers = {'Idempotency-Key':str(uuid4())}
        body = {'account_id':str(uuid4()),'name':'设备','roles':['control']}
        first = await self.client.post('/admin/v1/devices',json=body,headers=headers)
        second = await self.client.post('/admin/v1/devices',json=body,headers=headers)
        self.assertEqual(first.status_code,200)
        self.assertFalse(first.json()['credential_unavailable'])
        self.assertTrue(second.json()['credential_unavailable'])
        self.assertNotIn('device_token',second.json())
        self.assertEqual(first.json()['device_id'],second.json()['device_id'])
        self.assertNotIn(first.json()['device_token'],str(self.conn.idempotency))
        self.assertEqual(sum(q.startswith('INSERT INTO devices') for q,_ in self.conn.queries),1)
        self.assertEqual(second.headers['cache-control'],'no-store')

    async def test_metadata_never_queries_body_and_body_read_is_audited(self):
        run_id, tool_id = str(uuid4()), str(uuid4())
        now = datetime.now(timezone.utc)
        def rows(query, params):
            if query.startswith('SELECT id,account_id,session_id,request_id'):
                return [{'id':run_id,'account_id':str(uuid4()),'session_id':str(uuid4()),'request_id':str(uuid4()),
                         'status':'completed','error':None,'created_at':now,'model_config_version_id':None}]
            if query.startswith('SELECT input_text'):
                return [{'input_text':'真实内容的隔离测试字符串'}]
            if query.startswith('SELECT id,arguments,result'):
                return [{'id':tool_id,'arguments':{'api_key':'must-redact'},'result':{'ok':True}}]
            return []
        self.conn.row_handler = rows
        metadata = await self.client.get(f'/admin/v1/runs/{run_id}')
        self.assertEqual(metadata.status_code,200)
        self.assertNotIn('input_text', metadata.json())
        self.assertFalse(any('arguments' in q or 'input_text' in q or 't.result' in q for q,_ in self.conn.queries))
        self.conn.queries.clear()
        body = await self.client.post(f'/admin/v1/runs/{run_id}/content')
        self.assertEqual(body.status_code,200)
        self.assertEqual(body.headers['cache-control'],'no-store')
        self.assertNotIn('must-redact', body.text)
        self.assertTrue(self.conn.queries[0][0].startswith('INSERT INTO admin_audit_events'))
        self.assertEqual(self.app.state.admin_auth.current.call_args.kwargs,{'write':True,'admin_only':True})

    async def test_invalid_json_and_config_types_return_structured_errors(self):
        malformed = await self.client.post('/admin/v1/accounts',content=b'{bad',headers={'Content-Type':'application/json'})
        self.assertEqual(malformed.status_code,400)
        self.assertEqual(malformed.json()['detail']['code'],'invalid_body')
        for endpoint, body in (
            ('drafts', {'base_url':'https://model.invalid','model_name':'model','timeout_seconds':True}),
            ('drafts', {'base_url':'https://model.invalid','model_name':'model','timeout_seconds':30,'parent_version_id':''}),
            ('rollback', {'version_id':str(uuid4()),'key_source':[]}),
            ('publish', {'version_id':str(uuid4()),'expected_revision':True}),
        ):
            response = await self.client.post('/admin/v1/model-config/'+endpoint,json=body)
            self.assertEqual(response.status_code,400)
            self.assertIsInstance(response.json()['detail']['message'],str)

    async def test_runs_filters_and_cursor_are_parameterized(self):
        cursor = encode_cursor({'created_at':datetime.now(timezone.utc),'id':str(uuid4())})
        response = await self.client.get('/admin/v1/runs',params={'cursor':cursor,'limit':2,'status':'failed',
                            'account_id':str(uuid4()),'created_from':'2026-09-01T00:00:00+08:00'})
        self.assertEqual(response.status_code,200)
        query, params = self.conn.queries[-1]
        self.assertIn('(r.created_at,r.id)<(%s,%s)',query)
        self.assertIn('r.created_at>=%s',query)
        self.assertEqual(params[-1],3)
        self.assertEqual((await self.client.get('/admin/v1/runs',params={'created_from':'2026-09-01'})).status_code,400)
        for endpoint in ('accounts','devices','todos','audits','runs'):
            result = await self.client.get('/admin/v1/'+endpoint,params={'limit':1})
            self.assertEqual(result.status_code,200)
            self.assertIn('next_cursor',result.json())

    async def test_auth_denies_observer_and_csrf_before_sensitive_work(self):
        csrf = 'isolated-csrf'
        row = {'id':str(uuid4()), 'username':'observer','role':'observer','csrf_hash':hashlib.sha256(csrf.encode()).hexdigest()}
        self.conn.row_handler = lambda q,p: [row]
        auth = AdminAuth(SimpleNamespace(pool=self.conn),SimpleNamespace())
        req = request(headers=[(b'cookie',b'pet_admin_session=isolated'),(b'host',b'localhost')])
        with self.assertRaises(HTTPException) as caught:
            await auth.current(req,write=True,admin_only=True)
        self.assertEqual(caught.exception.status_code,403)
        row['role'] = 'admin'
        with self.assertRaises(HTTPException) as caught:
            await auth.current(req,write=True,admin_only=True)
        self.assertEqual(caught.exception.detail['code'],'csrf_rejected')
        req = request(headers=[(b'cookie',b'pet_admin_session=isolated'),(b'host',b'localhost'),
                               (b'x-csrf-token',csrf.encode()),(b'origin',b'https://evil.invalid')])
        with self.assertRaises(HTTPException) as caught:
            await auth.current(req,write=True,admin_only=True)
        self.assertEqual(caught.exception.detail['code'],'origin_rejected')

    async def test_login_limit_capacity_and_expiry(self):
        auth = AdminAuth(SimpleNamespace(pool=self.conn),SimpleNamespace())
        now = time.monotonic()
        auth._failures = {str(i):[now] for i in range(1024)}
        with self.assertRaises(HTTPException) as caught:
            await auth.login('new-name','password')
        self.assertEqual(caught.exception.status_code,429)
        self.assertEqual(len(auth._failures),1024)
        auth._failures = {'expired':[now-61]}
        for _ in range(5):
            with self.assertRaises(HTTPException) as caught:
                await auth.login('unknown','password')
            self.assertEqual(caught.exception.status_code,401)
        with self.assertRaises(HTTPException) as caught:
            await auth.login('unknown','password')
        self.assertEqual(caught.exception.status_code,429)
        self.assertNotIn('expired',auth._failures)


class HelpersTests(unittest.TestCase):
    def test_cursor_tie_breaker_and_page(self):
        now = datetime.now(timezone.utc)
        rows = [{'created_at':now,'id':str(uuid4())} for _ in range(3)]
        page = _page_result(rows,2,lambda row:row['id'])
        self.assertEqual(page['items'],[row['id'] for row in rows[:2]])
        self.assertEqual(decode_cursor(page['next_cursor']),(now,rows[1]['id']))
        for value in ('bad','WzEsMl0=','bnVsbA=='):
            with self.assertRaises(ValueError):
                decode_cursor(value)
        for query in ('limit=0','limit=201','cursor=bad'):
            with self.assertRaises(HTTPException):
                _page_query(request(query))

    def test_admin_password_file_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory,'password')
            with open(path,'w') as file:
                file.write('isolated-private-password\n')
            os.chmod(path,0o600)
            args = SimpleNamespace(password_file=path,password=None)
            self.assertEqual(admin_password(args),'isolated-private-password')
            os.chmod(path,0o644)
            with self.assertRaises(ValueError):
                admin_password(args)


if __name__ == '__main__':
    unittest.main()
