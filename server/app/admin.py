"""Internal admin authentication, audit and read/write API."""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from psycopg.types.json import Jsonb

from .model_config import ModelConfigStore

SESSION_COOKIE = "pet_admin_session"
CSRF_COOKIE = "pet_admin_csrf"


def hash_password(password: str) -> str:
    if not isinstance(password, str) or len(password) < 12 or len(password) > 1024:
        raise ValueError("管理密码至少需要 12 个字符")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**15, r=8, p=1, maxmem=128 * 1024 * 1024)
    return "scrypt$32768$8$1$%s$%s" % (salt.hex(), digest.hex())


def verify_password(password: str, encoded: str) -> bool:
    try:
        prefix, n, r, p, salt, digest = encoded.split("$", 5)
        if prefix != "scrypt":
            return False
        candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), maxmem=128 * 1024 * 1024)
        return hmac.compare_digest(candidate.hex(), digest)
    except (ValueError, TypeError):
        return False


class AdminPrincipal:
    def __init__(self, admin_id: str, username: str, role: str, csrf_hash: str):
        self.id, self.username, self.role, self.csrf_hash = admin_id, username, role, csrf_hash

    @property
    def is_admin(self):
        return self.role == "admin"


def _error(status: int, code: str, message: str):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


def _uuid(value: str, field: str) -> str:
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        _error(400, "invalid_id", f"{field} 无效")


def _request_id(request: Request):
    value = request.headers.get("x-request-id")
    try:
        return str(UUID(value)) if value else None
    except ValueError:
        return None


def _json_body(body: object) -> dict:
    if not isinstance(body, dict):
        _error(400, "invalid_body", "请求体必须为 JSON 对象")
    return body


class AdminAuth:
    def __init__(self, db, settings):
        self.db, self.settings = db, settings
        self._failures: dict[str, list[float]] = {}

    async def login(self, username: str, password: str):
        if not isinstance(username, str) or not username or not isinstance(password, str):
            _error(401, "invalid_credentials", "用户名或密码错误")
        key = username.strip().lower()
        now = time.monotonic()
        recent = [stamp for stamp in self._failures.get(key, []) if now - stamp < 60]
        if len(recent) >= 5:
            _error(429, "login_rate_limited", "登录失败次数过多，请稍后重试")
        async with self.db.pool.connection() as conn:
            row = await (await conn.execute("SELECT * FROM admin_users WHERE username=%s AND active=TRUE", (username.strip(),))).fetchone()
        if not row or not verify_password(password, row["password_hash"]):
            recent.append(now)
            self._failures[key] = recent
            _error(401, "invalid_credentials", "用户名或密码错误")
        self._failures.pop(key, None)
        token, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + timedelta(seconds=self.settings.admin_session_ttl_seconds)
        async with self.db.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO admin_sessions(id,admin_user_id,token_hash,csrf_hash,expires_at) VALUES (%s,%s,%s,%s,%s)",
                (str(uuid4()), row["id"], hashlib.sha256(token.encode()).hexdigest(), hashlib.sha256(csrf.encode()).hexdigest(), expires),
            )
        return row, token, csrf

    @staticmethod
    def check_origin(request: Request):
        origin = request.headers.get("origin")
        expected_origin = f"{request.url.scheme}://{request.headers.get('host')}"
        if origin and origin != expected_origin:
            _error(403, "origin_rejected", "管理请求来源未获允许")

    async def current(self, request: Request, *, write=False, admin_only=False) -> AdminPrincipal:
        token = request.cookies.get(SESSION_COOKIE)
        if not token:
            _error(401, "not_authenticated", "请先登录管理后台")
        async with self.db.pool.connection() as conn:
            row = await (await conn.execute(
                "SELECT u.id,u.username,u.role,s.csrf_hash FROM admin_sessions s JOIN admin_users u ON u.id=s.admin_user_id "
                "WHERE s.token_hash=%s AND s.revoked_at IS NULL AND s.expires_at>now() AND u.active=TRUE",
                (hashlib.sha256(token.encode()).hexdigest(),),
            )).fetchone()
        if not row:
            _error(401, "session_expired", "管理会话已过期，请重新登录")
        principal = AdminPrincipal(str(row["id"]), row["username"], row["role"], row["csrf_hash"])
        if admin_only and not principal.is_admin:
            _error(403, "forbidden", "只读观察者不能执行此操作")
        if write:
            self.check_origin(request)
            csrf = request.headers.get("x-csrf-token")
            if not csrf or not hmac.compare_digest(hashlib.sha256(csrf.encode()).hexdigest(), principal.csrf_hash):
                _error(403, "csrf_rejected", "管理请求缺少有效 CSRF 凭证")
        return principal

    async def logout(self, request: Request):
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            async with self.db.pool.connection() as conn:
                await conn.execute("UPDATE admin_sessions SET revoked_at=now() WHERE token_hash=%s", (hashlib.sha256(token.encode()).hexdigest(),))


async def audit(conn, principal: AdminPrincipal | None, action: str, object_type: str, object_id: str | None,
                result: str, request: Request, metadata: dict | None = None):
    request_id = request.headers.get("x-request-id")
    try:
        request_id = str(UUID(request_id)) if request_id else None
    except ValueError:
        request_id = None
    await conn.execute(
        "INSERT INTO admin_audit_events(id,admin_user_id,action,object_type,object_id,result,request_id,metadata) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
        (str(uuid4()), principal.id if principal else None, action, object_type, object_id, result, request_id, Jsonb(metadata or {})),
    )


def install_admin_routes(app, db, settings, coordination):
    router = APIRouter(prefix="/admin/v1")
    auth, configs = AdminAuth(db, settings), ModelConfigStore(db, settings)
    app.state.admin_auth, app.state.model_configs = auth, configs

    @router.post("/auth/login")
    async def login(request: Request):
        auth.check_origin(request)
        body = _json_body(await request.json())
        if set(body) != {"username", "password"}:
            _error(400, "invalid_body", "登录参数无效")
        row, token, csrf = await auth.login(body["username"], body["password"])
        response = JSONResponse({"user": {"id": str(row["id"]), "username": row["username"], "role": row["role"]}})
        response.set_cookie(SESSION_COOKIE, token, httponly=True, secure=settings.admin_cookie_secure, samesite="strict",
                            max_age=settings.admin_session_ttl_seconds, path="/admin")
        response.set_cookie(CSRF_COOKIE, csrf, httponly=False, secure=settings.admin_cookie_secure, samesite="strict",
                            max_age=settings.admin_session_ttl_seconds, path="/admin")
        return response

    @router.post("/auth/logout")
    async def logout(request: Request):
        await auth.current(request, write=True)
        await auth.logout(request)
        response = JSONResponse({"ok": True})
        response.delete_cookie(SESSION_COOKIE, path="/admin")
        response.delete_cookie(CSRF_COOKIE, path="/admin")
        return response

    @router.get("/auth/me")
    async def me(request: Request):
        principal = await auth.current(request)
        return {"user": {"id": principal.id, "username": principal.username, "role": principal.role}}

    @router.get("/overview")
    async def overview(request: Request):
        await auth.current(request)
        async with db.pool.connection() as conn:
            counts = await (await conn.execute(
                "SELECT (SELECT count(*) FROM accounts) AS accounts, "
                "(SELECT count(*) FROM devices WHERE revoked_at IS NULL) AS devices, "
                "(SELECT count(*) FROM agent_runs WHERE created_at>=now()-interval '24 hours') AS runs, "
                "(SELECT count(*) FROM agent_runs WHERE created_at>=now()-interval '24 hours' AND status='failed') AS failed"
            )).fetchone()
        redis = await coordination.healthy()
        return {"window": "24h", "accounts": int(counts["accounts"]), "active_devices": int(counts["devices"]),
                "runs": int(counts["runs"]), "failed_runs": int(counts["failed"]),
                "failure_rate": (float(counts["failed"]) / float(counts["runs"])) if counts["runs"] else None,
                "dependencies": {"database": True, "redis": redis, "redis_status": "healthy" if redis else "unknown"}}

    @router.get("/accounts")
    async def accounts(request: Request):
        await auth.current(request)
        async with db.pool.connection() as conn:
            rows = await (await conn.execute("SELECT id,name,created_at FROM accounts ORDER BY created_at DESC,id DESC LIMIT 200")).fetchall()
        return {"items": [{"id": str(row["id"]), "name": row["name"], "created_at": row["created_at"].isoformat()} for row in rows], "next_cursor": None}

    @router.post("/accounts")
    async def create_account(request: Request):
        principal = await auth.current(request, write=True, admin_only=True)
        body = _json_body(await request.json())
        if set(body) != {"name"} or not isinstance(body["name"], str) or not 1 <= len(body["name"].strip()) <= 200:
            _error(400, "invalid_name", "账号名称无效")
        account_id = str(uuid4())
        async with db.pool.connection() as conn, conn.transaction():
            await conn.execute("INSERT INTO accounts(id,name) VALUES (%s,%s)", (account_id, body["name"].strip()))
            await audit(conn, principal, "account.create", "account", account_id, "success", request)
        return {"id": account_id, "name": body["name"].strip()}

    @router.get("/devices")
    async def devices(request: Request):
        await auth.current(request)
        async with db.pool.connection() as conn:
            rows = await (await conn.execute(
                "SELECT d.id,d.account_id,d.name,d.roles,d.revoked_at,d.created_at,a.name AS account_name "
                "FROM devices d JOIN accounts a ON a.id=d.account_id ORDER BY d.created_at DESC,d.id DESC LIMIT 300"
            )).fetchall()
        return {"items": [{"id": str(row["id"]), "account_id": str(row["account_id"]), "account_name": row["account_name"],
                           "name": row["name"], "roles": row["roles"], "revoked_at": row["revoked_at"].isoformat() if row["revoked_at"] else None,
                           "created_at": row["created_at"].isoformat()} for row in rows], "next_cursor": None}

    @router.post("/devices")
    async def create_device(request: Request):
        principal = await auth.current(request, write=True, admin_only=True)
        body = _json_body(await request.json())
        if (set(body) != {"account_id", "name", "roles"} or not isinstance(body["roles"], list)
                or not all(isinstance(role, str) for role in body["roles"])
                or set(body["roles"]) - {"control", "node"}):
            _error(400, "invalid_device", "设备参数无效")
        account_id = _uuid(body["account_id"], "account_id")
        name = body["name"].strip() if isinstance(body["name"], str) else ""
        if not 1 <= len(name) <= 200 or not body["roles"]:
            _error(400, "invalid_device", "设备参数无效")
        token, device_id = secrets.token_urlsafe(48), str(uuid4())
        async with db.pool.connection() as conn, conn.transaction():
            exists = await (await conn.execute("SELECT 1 FROM accounts WHERE id=%s", (account_id,))).fetchone()
            if not exists:
                _error(404, "account_not_found", "账号不存在")
            await conn.execute("INSERT INTO devices(id,account_id,name,token_hash,roles) VALUES (%s,%s,%s,%s,%s)",
                               (device_id, account_id, name, hashlib.sha256(token.encode()).hexdigest(), body["roles"]))
            await audit(conn, principal, "device.issue", "device", device_id, "success", request, {"account_id": account_id, "roles": body["roles"]})
        response = JSONResponse({"device_id": device_id, "account_id": account_id, "device_token": token}, headers={"Cache-Control": "no-store"})
        return response

    @router.post("/devices/{device_id}/revoke")
    async def revoke_device(device_id: str, request: Request):
        principal = await auth.current(request, write=True, admin_only=True)
        device_id = _uuid(device_id, "device_id")
        async with db.pool.connection() as conn, conn.transaction():
            row = await (await conn.execute("UPDATE devices SET revoked_at=COALESCE(revoked_at,now()) WHERE id=%s RETURNING id", (device_id,))).fetchone()
            if not row:
                _error(404, "device_not_found", "设备不存在")
            await audit(conn, principal, "device.revoke", "device", device_id, "success", request)
        return {"id": device_id, "revoked": True}

    @router.get("/runs")
    async def runs(request: Request):
        await auth.current(request)
        status = request.query_params.get("status")
        account_id = request.query_params.get("account_id")
        if account_id:
            account_id = _uuid(account_id, "account_id")
        allowed = {"queued", "running", "completed", "failed", "interrupted"}
        if status and status not in allowed:
            _error(400, "invalid_status", "运行状态无效")
        values, where = [], []
        if status:
            where.append("r.status=%s"); values.append(status)
        if account_id:
            where.append("r.account_id=%s"); values.append(account_id)
        clause = " WHERE " + " AND ".join(where) if where else ""
        async with db.pool.connection() as conn:
            rows = await (await conn.execute(
                "SELECT r.id,r.account_id,r.session_id,r.request_id,r.status,r.error,r.created_at,r.model_config_version_id, "
                "s.integrity,s.collected_steps FROM agent_runs r LEFT JOIN run_trace_states s ON s.run_id=r.id" + clause + " ORDER BY r.ordinal DESC LIMIT 100", values
            )).fetchall()
        return {"items": [{"id": str(row["id"]), "account_id": str(row["account_id"]), "session_id": str(row["session_id"]),
                           "request_id": str(row["request_id"]), "status": row["status"], "error": row["error"],
                           "created_at": row["created_at"].isoformat(), "model_config_version_id": str(row["model_config_version_id"]) if row["model_config_version_id"] else None,
                           "trace_integrity": row["integrity"] or "legacy", "trace_steps": row["collected_steps"] or 0} for row in rows], "next_cursor": None}

    @router.get("/runs/{run_id}")
    async def run_detail(run_id: str, request: Request):
        principal = await auth.current(request)
        run_id = _uuid(run_id, "run_id")
        async with db.pool.connection() as conn, conn.transaction():
            if principal.is_admin:
                await audit(conn, principal, "run.detail.read", "run", run_id, "success", request)
            row = await (await conn.execute("SELECT * FROM agent_runs WHERE id=%s", (run_id,))).fetchone()
            if not row:
                _error(404, "run_not_found", "运行不存在")
            trace = await (await conn.execute("SELECT * FROM run_trace_states WHERE run_id=%s", (run_id,))).fetchone()
            calls = await (await conn.execute("SELECT * FROM model_call_traces WHERE run_id=%s ORDER BY step_index", (run_id,))).fetchall()
            payloads = await (await conn.execute("SELECT id,model_call_id,kind,expires_at FROM trace_payloads WHERE run_id=%s ORDER BY created_at", (run_id,))).fetchall()
            tools = await (await conn.execute(
                "SELECT t.id,t.name,t.status,t.arguments,t.result,t.error,t.created_at,l.model_call_id,l.step_index "
                "FROM agent_tool_calls t LEFT JOIN tool_trace_links l ON l.tool_call_id=t.id "
                "WHERE t.run_id=%s ORDER BY t.ordinal", (run_id,))).fetchall()
        result = {"id": str(row["id"]), "account_id": str(row["account_id"]), "session_id": str(row["session_id"]), "request_id": str(row["request_id"]),
                  "status": row["status"], "error": row["error"], "created_at": row["created_at"].isoformat(), "input_text": row["input_text"] if principal.is_admin else None,
                  "trace": {"integrity": trace["integrity"] if trace else "legacy", "gap_reason": trace["gap_reason"] if trace else "未采集模型级链路", "calls": []}}
        for call in calls:
            call_payloads = [{"id": str(item["id"]), "kind": item["kind"], "expired": item["expires_at"] <= datetime.now(timezone.utc)}
                             for item in payloads if str(item["model_call_id"]) == str(call["id"])]
            result["trace"]["calls"].append({"id": str(call["id"]), "step_index": call["step_index"], "model_name": call["model_name"], "status": call["status"],
                                               "started_at": call["started_at"].isoformat(), "ended_at": call["ended_at"].isoformat() if call["ended_at"] else None,
                                               "duration_ms": call["duration_ms"], "first_response_at": call["first_response_at"].isoformat() if call["first_response_at"] else None,
                                               "first_visible_text_at": call["first_visible_text_at"].isoformat() if call["first_visible_text_at"] else None,
                                               "usage": call["usage"], "usage_source": call["usage_source"], "error_type": call["error_type"], "payloads": call_payloads})
        result["tools"] = [{"id": str(tool["id"]), "name": tool["name"], "status": tool["status"],
                             "error": tool["error"], "created_at": tool["created_at"].isoformat(),
                             "model_call_id": str(tool["model_call_id"]) if tool["model_call_id"] else None,
                             "step_index": tool["step_index"],
                             "arguments": tool["arguments"] if principal.is_admin else None,
                             "result": tool["result"] if principal.is_admin else None} for tool in tools]
        return result

    @router.post("/runs/{run_id}/payloads/{payload_id}")
    async def trace_payload(run_id: str, payload_id: str, request: Request):
        principal = await auth.current(request, write=True, admin_only=True)
        run_id, payload_id = _uuid(run_id, "run_id"), _uuid(payload_id, "payload_id")
        async with db.pool.connection() as conn, conn.transaction():
            await audit(conn, principal, "trace.payload.read", "trace_payload", payload_id, "success", request, {"run_id": run_id})
            row = await (await conn.execute("SELECT kind,body,truncated,original_bytes,expires_at FROM trace_payloads WHERE id=%s AND run_id=%s", (payload_id, run_id))).fetchone()
            if not row:
                _error(404, "payload_not_found", "追踪正文不存在")
        if row["expires_at"] <= datetime.now(timezone.utc):
            return {"status": "expired", "kind": row["kind"]}
        return {"status": "available", "kind": row["kind"], "body": row["body"], "truncated": row["truncated"], "original_bytes": row["original_bytes"]}

    @router.get("/todos")
    async def admin_todos(request: Request):
        await auth.current(request)
        async with db.pool.connection() as conn:
            rows = await (await conn.execute("SELECT id,account_id,status,remind_at,created_at FROM todos ORDER BY created_at DESC,id DESC LIMIT 200")).fetchall()
        return {"items": [{"id": str(row["id"]), "account_id": str(row["account_id"]),
                           "status": row["status"], "remind_at": row["remind_at"].isoformat() if row["remind_at"] else None, "created_at": row["created_at"].isoformat()} for row in rows], "next_cursor": None}

    @router.post("/todos/{todo_id}/content")
    async def todo_content(todo_id: str, request: Request):
        principal = await auth.current(request, write=True, admin_only=True)
        todo_id = _uuid(todo_id, "todo_id")
        async with db.pool.connection() as conn, conn.transaction():
            # Keep the audit write in the same transaction and before the body read.
            await audit(conn, principal, "todo.content.read", "todo", todo_id, "success", request)
            row = await (await conn.execute(
                "SELECT id,account_id,title,status,remind_at,created_at FROM todos WHERE id=%s", (todo_id,)
            )).fetchone()
            if not row:
                _error(404, "todo_not_found", "待办不存在")
        return {"id": str(row["id"]), "account_id": str(row["account_id"]), "title": row["title"],
                "status": row["status"], "remind_at": row["remind_at"].isoformat() if row["remind_at"] else None,
                "created_at": row["created_at"].isoformat()}

    @router.get("/tools")
    async def tools(request: Request):
        await auth.current(request)
        async with db.pool.connection() as conn:
            rows = await (await conn.execute("SELECT name,version,description,input_schema,permission,execution_location FROM tool_definitions ORDER BY name,version")).fetchall()
        return {"items": [dict(row) for row in rows]}

    @router.get("/health")
    async def admin_health(request: Request):
        await auth.current(request)
        database = await db.healthy()
        redis = await coordination.healthy()
        config = await configs.public_state()
        return {"database": database, "redis": redis, "redis_status": "healthy" if redis else "unknown", "model_config": config}

    @router.get("/model-config")
    async def model_config(request: Request):
        await auth.current(request)
        return await configs.public_state()

    @router.post("/model-config/enable")
    async def enable_model_config(request: Request):
        principal = await auth.current(request, write=True, admin_only=True)
        try:
            return await configs.enable_management(principal.id, _request_id(request))
        except RuntimeError as exc:
            _error(409, "management_enable_rejected", str(exc))
        except ValueError as exc:
            _error(400, "invalid_config", str(exc))

    @router.post("/model-config/drafts")
    async def save_model_draft(request: Request):
        principal = await auth.current(request, write=True, admin_only=True)
        body = _json_body(await request.json())
        allowed = {"parent_version_id", "base_url", "model_name", "api_key", "timeout_seconds"}
        if set(body) - allowed or not {"base_url", "model_name", "timeout_seconds"} <= set(body):
            _error(400, "invalid_config", "模型配置参数无效")
        try:
            row = await configs.save_draft(principal.id, body, _request_id(request))
        except LookupError as exc:
            _error(404, "parent_version_not_found", str(exc))
        except ValueError as exc:
            _error(400, "invalid_config", str(exc))
        except RuntimeError as exc:
            _error(409, "configuration_unavailable", str(exc))
        return row

    @router.post("/model-config/{version_id}/test")
    async def test_model_config(version_id: str, request: Request):
        principal = await auth.current(request, write=True, admin_only=True)
        try:
            result = await configs.test(principal.id, _uuid(version_id, "version_id"), _request_id(request))
        except LookupError as exc:
            _error(404, "version_not_found", str(exc))
        return result

    @router.post("/model-config/publish")
    async def publish_model_config(request: Request):
        principal = await auth.current(request, write=True, admin_only=True)
        body = _json_body(await request.json())
        if set(body) != {"version_id", "expected_revision"}:
            _error(400, "invalid_config", "发布参数无效")
        try:
            result = await configs.publish(principal.id, _uuid(body["version_id"], "version_id"), body["expected_revision"], request_id=_request_id(request))
        except LookupError as exc:
            _error(404, "version_not_found", str(exc))
        except ValueError as exc:
            _error(400, "invalid_config", str(exc))
        except RuntimeError as exc:
            _error(409, "revision_conflict", str(exc))
        return result

    @router.post("/model-config/rollback")
    async def rollback_model_config(request: Request):
        principal = await auth.current(request, write=True, admin_only=True)
        body = _json_body(await request.json())
        if set(body) != {"version_id"}:
            _error(400, "invalid_config", "回滚参数无效")
        try:
            result = await configs.clone_for_rollback(principal.id, _uuid(body["version_id"], "version_id"))
        except LookupError as exc:
            _error(404, "version_not_found", str(exc))
        except ValueError as exc:
            _error(400, "invalid_config", str(exc))
        return {"draft": result, "requires_test_and_publish": True}

    @router.get("/audits")
    async def audits(request: Request):
        principal = await auth.current(request, admin_only=True)
        async with db.pool.connection() as conn:
            rows = await (await conn.execute(
                "SELECT a.id,a.action,a.object_type,a.object_id,a.result,a.request_id,a.metadata,a.created_at,u.username "
                "FROM admin_audit_events a LEFT JOIN admin_users u ON u.id=a.admin_user_id ORDER BY a.created_at DESC,a.id DESC LIMIT 200"
            )).fetchall()
        return {"items": [{"id": str(row["id"]), "username": row["username"], "action": row["action"], "object_type": row["object_type"], "object_id": row["object_id"],
                           "result": row["result"], "request_id": str(row["request_id"]) if row["request_id"] else None, "metadata": row["metadata"], "created_at": row["created_at"].isoformat()} for row in rows]}

    app.include_router(router)
