"""Isolated boundary tests. Mocks are test fixtures, never a running demo service."""
import asyncio
import unittest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.auth import Auth, Principal, token_hash
from app.config import Settings
from app.contracts import Envelope, uuid_string
from app.main import create_app
from app.registry import Registry


@asynccontextmanager
async def isolated_lifespan(app):
    yield


def fake_db(row):
    cursor = AsyncMock()
    cursor.fetchone.return_value = row
    conn = AsyncMock()
    conn.execute.return_value = cursor
    db = MagicMock()
    db.pool.connection.return_value.__aenter__ = AsyncMock(return_value=conn)
    db.pool.connection.return_value.__aexit__ = AsyncMock(return_value=False)
    return db


class AuthBoundary(unittest.IsolatedAsyncioTestCase):
    async def test_auth_derives_owner_and_rejects_wrong_role(self):
        account, device = str(uuid4()), str(uuid4())
        db = fake_db({"id": device, "account_id": account, "roles": ["control"]})
        auth = Auth(db)
        principal = await auth.authenticate("Bearer test-only-token", "control")
        self.assertEqual(principal.account_id, account)
        with self.assertRaises(PermissionError):
            await auth.authenticate("Bearer test-only-token", "node")

    async def test_revoked_and_absent_tokens_fail(self):
        auth = Auth(fake_db(None))
        for authorization in [None, "", "Bearer ", "Bearer a b", "Bearer unknown"]:
            with self.assertRaises(PermissionError):
                await auth.authenticate(authorization, "control")
        with self.assertRaises(PermissionError):
            await auth.ensure_active(Principal(str(uuid4()), str(uuid4()), ("control",)), "control")

    def test_secret_repr_and_validation(self):
        settings = Settings(database_url="secret-db", redis_url="secret-redis", model_api_key="secret-key")
        self.assertNotIn("secret", repr(settings))
        self.assertNotEqual(token_hash("test-only-token"), "test-only-token")
        with self.assertRaises(ValueError):
            uuid_string("invalid", "session_id")
        for version in (2, True, 1.0, "1"):
            with self.subTest(version=version), self.assertRaises(ValueError):
                Envelope.model_validate({"v": version, "type": "session.open", "payload": {}})
        registry = Registry(MagicMock())
        registry.validate_capabilities([])
        for capabilities in [None, {}, ["system.run"]]:
            with self.assertRaises(ValueError):
                registry.validate_capabilities(capabilities)


class GatewayBoundary(unittest.TestCase):
    def test_direct_completion_requires_auth_and_valid_id(self):
        self.app.state.auth.authenticate.side_effect = PermissionError('拒绝')
        self.assertEqual(self.client.post('/v1/todos/invalid/complete').status_code, 403)
        self.app.state.service.complete_todo.assert_not_awaited()
        self.app.state.auth.authenticate.side_effect = None
        self.assertEqual(self.client.post('/v1/todos/invalid/complete').status_code, 400)
        self.app.state.service.complete_todo.assert_not_awaited()

    def test_direct_completion_passes_authenticated_owner_without_model(self):
        todo_id = str(uuid4())
        item = {'id': todo_id, 'title': 'isolated', 'status': 'completed', 'created_at': '2026-09-07T00:00:00Z'}
        self.app.state.service.complete_todo.return_value = item
        for _ in range(2):
            response = self.client.post(f'/v1/todos/{todo_id}/complete', headers={'authorization': 'Bearer unit-only'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {'item': item})
        self.app.state.service.complete_todo.assert_awaited_with(self.who, todo_id)
        self.app.state.auth.authenticate.assert_awaited_with('Bearer unit-only', 'control')
        self.app.state.service.submit.assert_not_awaited()
        self.app.state.service.create_session.assert_not_awaited()

    def test_direct_completion_not_found_and_storage_errors_are_truthful(self):
        url = f'/v1/todos/{uuid4()}/complete'
        self.app.state.service.complete_todo.side_effect = LookupError('未找到可完成的待办')
        self.assertEqual(self.client.post(url).status_code, 404)
        self.app.state.service.complete_todo.side_effect = RuntimeError('secret DB details')
        response = self.client.post(url)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('secret', response.text)

    def test_direct_reopen_requires_auth_and_valid_id(self):
        self.app.state.auth.authenticate.side_effect = PermissionError('拒绝')
        self.assertEqual(self.client.post('/v1/todos/invalid/reopen').status_code, 403)
        self.app.state.service.reopen_todo.assert_not_awaited()
        self.app.state.auth.authenticate.side_effect = None
        self.assertEqual(self.client.post('/v1/todos/invalid/reopen').status_code, 400)
        self.app.state.service.reopen_todo.assert_not_awaited()

    def test_direct_reopen_passes_authenticated_owner_without_model(self):
        todo_id = str(uuid4())
        item = {'id': todo_id, 'title': 'isolated', 'status': 'pending', 'created_at': '2026-09-07T00:00:00Z'}
        self.app.state.service.reopen_todo.return_value = item
        for _ in range(2):
            response = self.client.post(f'/v1/todos/{todo_id}/reopen', headers={'authorization': 'Bearer unit-only'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {'item': item})
        self.app.state.service.reopen_todo.assert_awaited_with(self.who, todo_id)
        self.app.state.auth.authenticate.assert_awaited_with('Bearer unit-only', 'control')
        self.app.state.service.submit.assert_not_awaited()
        self.app.state.service.create_session.assert_not_awaited()

    def test_direct_reopen_not_found_and_storage_errors_are_truthful(self):
        url = f'/v1/todos/{uuid4()}/reopen'
        self.app.state.service.reopen_todo.side_effect = LookupError('未找到可恢复的待办')
        self.assertEqual(self.client.post(url).status_code, 404)
        self.app.state.service.reopen_todo.side_effect = RuntimeError('secret DB details')
        response = self.client.post(url)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('secret', response.text)

    def setUp(self):
        self.app = create_app(Settings())
        self.app.router.lifespan_context = isolated_lifespan
        self.who = Principal(str(uuid4()), str(uuid4()), ("control", "node"))
        self.app.state.auth = AsyncMock()
        self.app.state.auth.authenticate.return_value = self.who
        self.app.state.service = AsyncMock()
        self.app.state.service.events_after.return_value = []
        self.app.state.registry = Registry(MagicMock())
        self.app.state.coordination = AsyncMock()
        self.app.state.coordination.heartbeat.return_value = True
        self.client = TestClient(self.app)
        self.session = str(uuid4())
        self.snapshot = {"session_id": self.session, "seq": 2, "messages": [], "tool_calls": [], "runs": []}
        self.app.state.service.snapshot.return_value = self.snapshot
        self.app.state.service.create_session.return_value = {"session_id": self.session}

    def test_http_ownership_error_is_not_data(self):
        self.app.state.service.snapshot.side_effect = PermissionError("不属于当前账号")
        result = self.client.get(f"/v1/sessions/{self.session}")
        self.assertEqual(result.status_code, 403)
        self.assertEqual(result.json(), {"detail": "不属于当前账号"})
        self.app.state.service.snapshot.assert_awaited_once_with(self.who, self.session)

    def test_internal_failure_does_not_expose_credentials(self):
        self.app.state.service.list_todos.side_effect = RuntimeError("postgresql://user:secret@host/db")
        response = self.client.get("/v1/todos")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret", response.text)

    def test_handshake_rejects_revoked_or_browser_origin(self):
        self.app.state.auth.authenticate.side_effect = PermissionError("已撤销")
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/v1/control/ws"):
                pass
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/v1/node/ws", headers={"origin": "https://untrusted.invalid"}):
                pass

    def test_snapshot_then_persisted_events_and_resync(self):
        event = {"v": 1, "type": "message.delta", "session_id": self.session, "seq": 3, "payload": {"message_id": str(uuid4()), "text": "真实格式测试夹具"}}
        self.app.state.service.events_after.side_effect = [[event], [], [], []]
        with self.client.websocket_connect("/v1/control/ws") as ws:
            ws.send_json({"v": 1, "type": "session.open", "payload": {"session_id": self.session}})
            self.assertEqual(ws.receive_json()["seq"], 2)
            self.assertEqual(ws.receive_json(), event)
            self.app.state.service.events_after.assert_awaited_with(self.who, self.session, 2)
            ws.send_json({"v": 2, "type": "session.open", "payload": {}})
            self.assertEqual(ws.receive_json()["type"], "protocol.error")

    def test_submit_requires_current_session_and_valid_request(self):
        with self.client.websocket_connect("/v1/control/ws") as ws:
            ws.send_json({"v": 1, "type": "run.submit", "session_id": self.session, "request_id": str(uuid4()), "payload": {"text": "test"}})
            self.assertEqual(ws.receive_json()["type"], "protocol.error")
            self.app.state.service.submit.assert_not_awaited()

    def test_acceptance_waits_for_prior_persisted_events(self):
        request_id = str(uuid4())
        delta = {"v": 1, "type": "message.delta", "session_id": self.session,
                 "seq": 3, "payload": {"message_id": str(uuid4()), "text": "test"}}
        accepted = {"v": 1, "type": "run.accepted", "session_id": self.session,
                    "request_id": request_id, "seq": 4, "payload": {}}
        self.app.state.service.submit.return_value = accepted

        async def events_after(who, session_id, cursor):
            if self.app.state.service.submit.await_count:
                return [event for event in [delta, accepted] if event["seq"] > cursor]
            return []

        self.app.state.service.events_after.side_effect = events_after
        with self.client.websocket_connect("/v1/control/ws") as ws:
            ws.send_json({"v": 1, "type": "session.open", "payload": {"session_id": self.session}})
            self.assertEqual(ws.receive_json()["seq"], 2)
            submit = {"v": 1, "type": "run.submit", "session_id": self.session,
                      "request_id": request_id, "payload": {"text": "test"}}
            ws.send_json(submit)
            self.assertEqual(ws.receive_json(), delta)
            self.assertEqual(ws.receive_json(), accepted)
            # The duplicate no longer appears in events_after, so explicitly
            # return its old acceptance without rewinding the live cursor.
            ws.send_json(submit)
            self.assertEqual(ws.receive_json(), accepted)
            self.assertEqual(self.app.state.service.submit.await_count, 2)

    def test_revocation_closes_existing_socket(self):
        self.app.state.auth.ensure_active.side_effect = PermissionError("已撤销")
        with self.client.websocket_connect("/v1/control/ws") as ws:
            with self.assertRaises(WebSocketDisconnect) as exc:
                ws.receive_json()
            self.assertEqual(exc.exception.code, 1008)

    def test_revocation_while_waiting_rejects_next_operation(self):
        # Simulate revocation committed after handshake while a message arrives.
        # No database or live account is created by this isolated regression.
        original_wait = asyncio.wait

        async def revoke_during_wait(*args, **kwargs):
            result = await original_wait(*args, **kwargs)
            self.app.state.auth.ensure_active.side_effect = PermissionError("已撤销")
            return result

        for role, kind, payload in [
            ("control", "session.open", {"session_id": None}),
            ("node", "node.register", {"capabilities": []}),
        ]:
            with self.subTest(role=role):
                self.app.state.auth.ensure_active.side_effect = None
                with patch("app.main.asyncio.wait", side_effect=revoke_during_wait):
                    with self.client.websocket_connect(f"/v1/{role}/ws") as ws:
                        ws.send_json({"v": 1, "type": kind, "payload": payload})
                        with self.assertRaises(WebSocketDisconnect) as exc:
                            ws.receive_json()
                        self.assertEqual(exc.exception.code, 1008)
                self.app.state.service.create_session.assert_not_awaited()
                self.app.state.coordination.register.assert_not_awaited()

    def test_node_unknown_capability_and_lease_generation(self):
        with self.client.websocket_connect("/v1/node/ws") as ws:
            ws.send_json({"v": 1, "type": "node.register", "payload": {"capabilities": ["system.run"]}})
            self.assertEqual(ws.receive_json()["type"], "protocol.error")
            self.app.state.coordination.register.assert_not_awaited()
            ws.send_json({"v": 1, "type": "node.register", "payload": {"capabilities": []}})
            registered = ws.receive_json()
            self.assertEqual(registered["type"], "node.registered")
            ws.send_json({"v": 1, "type": "node.heartbeat", "payload": {"connection_id": "old-connection"}})
            self.assertEqual(ws.receive_json()["type"], "protocol.error")
            self.app.state.coordination.heartbeat.assert_not_awaited()
            ws.send_json({"v": 1, "type": "node.heartbeat", "payload": {"connection_id": registered["payload"]["connection_id"]}})
            self.assertEqual(ws.receive_json()["type"], "node.heartbeat_ack")


if __name__ == "__main__":
    unittest.main()
