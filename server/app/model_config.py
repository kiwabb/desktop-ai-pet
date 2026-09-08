"""Versioned model configuration and the server-side secret boundary."""
from __future__ import annotations

import base64
import asyncio
import json
from datetime import datetime, timezone
from urllib.parse import urlparse
from uuid import uuid4

import httpx
from psycopg.types.json import Jsonb


def validate_model_url(value: str) -> str:
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError("模型地址无效")
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("模型地址必须为不含凭证和查询参数的 HTTP(S) 地址")
    if parsed.scheme != "https" and parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("远程模型地址必须使用 HTTPS")
    return value.strip().rstrip("/")



TEST_VALIDATION_VERSION = "sse-v2"


def encode_cursor(row) -> str:
    return base64.urlsafe_b64encode(json.dumps([row["created_at"].isoformat(), str(row["id"])]).encode()).decode()


def decode_cursor(value: str):
    from uuid import UUID
    try:
        if len(value) > 512:
            raise ValueError()
        parts = json.loads(base64.b64decode(value, altchars=b"-_", validate=True))
        if not isinstance(parts, list) or len(parts) != 2:
            raise ValueError()
        created_at = datetime.fromisoformat(parts[0])
        if created_at.tzinfo is None:
            raise ValueError()
        return created_at, str(UUID(parts[1]))
    except (ValueError, TypeError, KeyError, AttributeError) as exc:
        raise ValueError("分页游标无效") from exc


async def validate_test_stream(response):
    """Consume a bounded, complete OpenAI SSE response; never trust arbitrary bytes."""
    if not 200 <= response.status_code < 300:
        raise ValueError(f"模型服务返回 HTTP {response.status_code}")
    if response.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "text/event-stream":
        raise ValueError("模型服务未返回 SSE 流")
    received, buffer, event_lines = 0, b"", []
    saw_content = saw_finish = saw_done = False

    def consume(lines):
        nonlocal saw_content, saw_finish, saw_done
        data = "\n".join(line[5:].lstrip() for line in lines if line.startswith("data:"))
        if any(line.startswith("event:") and line[6:].lstrip(" ") == "error" for line in lines):
            raise ValueError("模型流返回错误事件")
        if not data:
            return
        if saw_done:
            raise ValueError("模型流在终结后仍有数据")
        if data == "[DONE]":
            if not saw_content or not saw_finish:
                raise ValueError("模型流缺少有效输出或正常终结")
            saw_done = True
            return
        try:
            value = json.loads(data)
        except (ValueError, TypeError) as exc:
            raise ValueError("模型流包含无效 JSON") from exc
        if not isinstance(value, dict) or "error" in value or not isinstance(value.get("choices"), list):
            raise ValueError("模型流响应协议无效")
        for choice in value["choices"]:
            if not isinstance(choice, dict) or not isinstance(choice.get("delta"), dict):
                raise ValueError("模型流缺少有效 delta")
            content = choice["delta"].get("content")
            if content is not None and not isinstance(content, str):
                raise ValueError("模型流文本格式无效")
            if content:
                if saw_finish:
                    raise ValueError("模型流在完成后仍输出文本")
                saw_content = True
            finish = choice.get("finish_reason")
            if finish is not None:
                if finish != "stop":
                    raise ValueError("模型流未正常完成")
                saw_finish = True

    async for chunk in response.aiter_bytes():
        received += len(chunk)
        if received > 262144:
            raise ValueError("连接测试响应超过 256 KiB 限制")
        buffer += chunk
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            try:
                line = line.rstrip(b"\r").decode("utf-8")
            except UnicodeError as exc:
                raise ValueError("模型流编码无效") from exc
            if not line:
                consume(event_lines)
                event_lines = []
            else:
                event_lines.append(line)
    if buffer.strip() or event_lines:
        raise ValueError("模型流在事件完成前断开")
    if not saw_done:
        raise ValueError("模型流缺少正常终结标记")

def _fernet(key: str):
    if not key:
        raise RuntimeError("未配置 PET_AGENT_ADMIN_ENCRYPTION_KEY，无法管理模型密钥")
    try:
        from cryptography.fernet import Fernet
        return Fernet(key.encode())
    except ImportError as exc:
        raise RuntimeError("服务端缺少 cryptography 依赖，无法管理模型密钥") from exc
    except Exception as exc:
        raise ValueError("模型密钥加密主密钥无效") from exc


def encrypt_secret(key: str, value: str) -> str:
    return _fernet(key).encrypt(value.encode()).decode()


def decrypt_secret(key: str, value: str) -> str:
    try:
        return _fernet(key).decrypt(value.encode()).decode()
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError("模型密钥无法解密") from exc


def public_version(row, *, has_key: bool | None = None) -> dict:
    return {
        "id": str(row["id"]),
        "parent_version_id": str(row["parent_version_id"]) if row.get("parent_version_id") else None,
        "base_url": row["base_url"],
        "model_name": row["model_name"],
        "timeout_seconds": row["timeout_seconds"],
        "has_key": bool(row.get("secret_version_id")) if has_key is None else has_key,
        "rollback_source_version_id": str(row["rollback_source_version_id"]) if row.get("rollback_source_version_id") else None,
        "key_source": row.get("key_source"),
        "created_at": row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else row["created_at"],
    }


class ModelConfigStore:
    def __init__(self, db, settings):
        self.db, self.settings = db, settings

    async def state(self, conn=None, *, for_update=False):
        suffix = " FOR UPDATE OF s" if for_update else ""
        if conn is not None:
            return await (await conn.execute(
                "SELECT s.*, v.id, v.parent_version_id, v.base_url, v.model_name, v.timeout_seconds, "
                "v.secret_version_id, v.created_at, v.rollback_source_version_id, v.key_source "
                "FROM model_config_state s LEFT JOIN model_config_versions v ON v.id=s.active_version_id "
                "WHERE s.singleton=TRUE" + suffix
            )).fetchone()
        async with self.db.pool.connection() as connection:
            return await self.state(connection, for_update=for_update)

    async def public_state(self, *, limit=100, cursor=None):
        if not 1 <= limit <= 200:
            raise ValueError("分页数量必须为 1 到 200")
        where, params = "", []
        if cursor:
            where = " WHERE (v.created_at,v.id)<(%s,%s)"
            params.extend(decode_cursor(cursor))
        async with self.db.pool.connection() as conn:
            state = await self.state(conn)
            versions = await (await conn.execute(
                "SELECT v.*, COALESCE((SELECT t.status='succeeded' AND t.validation_version='sse-v2' "
                "AND t.completed_at>now()-interval '24 hours' FROM model_config_tests t WHERE t.version_id=v.id "
                "ORDER BY t.tested_at DESC,t.id DESC LIMIT 1),FALSE) AS tested "
                "FROM model_config_versions v" + where + " ORDER BY v.created_at DESC,v.id DESC LIMIT %s",
                [*params, limit + 1],
            )).fetchall()
        page = versions[:limit]
        return {
            "management_enabled": bool(state and state["management_enabled"]),
            "revision": int(state["revision"]) if state else 0,
            "active": public_version(state, has_key=bool(state and state.get("secret_version_id"))) if state and state.get("active_version_id") else None,
            "versions": [{**public_version(row), "tested": bool(row["tested"])} for row in page],
            "next_cursor": encode_cursor(page[-1]) if len(versions) > limit else None,
        }

    async def version(self, version_id: str, conn=None):
        query = "SELECT v.*, s.ciphertext FROM model_config_versions v LEFT JOIN model_secret_versions s ON s.id=v.secret_version_id WHERE v.id=%s"
        if conn is not None:
            return await (await conn.execute(query, (version_id,))).fetchone()
        async with self.db.pool.connection() as connection:
            return await self.version(version_id, connection)

    async def resolved(self, version_id: str | None):
        if version_id:
            row = await self.version(version_id)
            if not row:
                raise LookupError("模型配置版本不存在")
        else:
            state = await self.state()
            row = await self.version(str(state["active_version_id"])) if state and state.get("active_version_id") else None
            if not row:
                return None
        key = decrypt_secret(self.settings.admin_encryption_key, row["ciphertext"]) if row.get("ciphertext") else ""
        return {"base_url": row["base_url"], "model_name": row["model_name"],
                "timeout_seconds": row["timeout_seconds"], "api_key": key, "id": str(row["id"])}

    async def _audit(self, conn, admin_id, action, object_id, result, request_id=None, metadata=None):
        await conn.execute(
            "INSERT INTO admin_audit_events(id,admin_user_id,action,object_type,object_id,result,request_id,metadata) VALUES (%s,%s,%s,'model_config_version',%s,%s,%s,%s)",
            (str(uuid4()), admin_id, action, object_id, result, request_id, Jsonb(metadata or {})),
        )

    async def enable_management(self, admin_id: str, request_id=None):
        """Enter database-backed configuration mode after an explicit drain check."""
        async with self.db.pool.connection() as conn, conn.transaction():
            state = await self.state(conn, for_update=True)
            if state and state["management_enabled"]:
                return {"management_enabled": True, "active_version_id": str(state["active_version_id"]) if state.get("active_version_id") else None}
            queued = await (await conn.execute(
                "SELECT count(*) AS count FROM agent_runs WHERE status IN ('queued','running')"
            )).fetchone()
            if int(queued["count"]) != 0:
                raise RuntimeError("启用管理模型配置前必须先排空 queued/running 任务")
            _fernet(self.settings.admin_encryption_key)

            active_version_id = None
            if self.settings.model_base_url and self.settings.model_name and self.settings.model_api_key:
                base_url = validate_model_url(self.settings.model_base_url)
                secret_id = str(uuid4())
                active_version_id = str(uuid4())
                await conn.execute(
                    "INSERT INTO model_secret_versions(id,ciphertext,algorithm,key_id,created_by) VALUES (%s,%s,%s,%s,%s)",
                    (secret_id, encrypt_secret(self.settings.admin_encryption_key, self.settings.model_api_key),
                     "fernet-v1", "PET_AGENT_ADMIN_ENCRYPTION_KEY", admin_id),
                )
                await conn.execute(
                    "INSERT INTO model_config_versions(id,base_url,model_name,timeout_seconds,secret_version_id,created_by) "
                    "VALUES (%s,%s,%s,%s,%s,%s)",
                    (active_version_id, base_url, self.settings.model_name, self.settings.model_timeout_seconds, secret_id, admin_id),
                )
            await conn.execute(
                "UPDATE model_config_state SET active_version_id=%s,management_enabled=TRUE,updated_at=now() WHERE singleton=TRUE",
                (active_version_id,),
            )
            await self._audit(conn, admin_id, "model_config.enable", active_version_id, "success", request_id,
                              {"baseline_created": active_version_id is not None})
        return await self.public_state()

    async def save_draft(self, admin_id: str, data: dict, request_id=None, audit_action='model_config.draft', *, rollback_source=None, key_source=None):
        base_url = validate_model_url(data.get("base_url", ""))
        model_name = data.get("model_name")
        timeout = data.get("timeout_seconds")
        if not isinstance(model_name, str) or not model_name.strip() or len(model_name) > 256:
            raise ValueError("模型名称无效")
        if not isinstance(timeout, int) or isinstance(timeout, bool) or not 5 <= timeout <= 600:
            raise ValueError("模型超时必须为 5 到 600 秒")
        parent_id = data.get("parent_version_id")
        api_key = data.get("api_key")
        if api_key is not None and (not isinstance(api_key, str) or len(api_key) > 4096):
            raise ValueError("模型密钥无效")
        async with self.db.pool.connection() as conn, conn.transaction():
            parent = await self.version(parent_id, conn) if parent_id else None
            if parent_id and not parent:
                raise LookupError("父模型配置不存在")
            secret_id = parent.get("secret_version_id") if parent else None
            if api_key:
                secret_id = str(uuid4())
                await conn.execute(
                    "INSERT INTO model_secret_versions(id,ciphertext,algorithm,key_id,created_by) VALUES (%s,%s,%s,%s,%s)",
                    (secret_id, encrypt_secret(self.settings.admin_encryption_key, api_key), "fernet-v1", "PET_AGENT_ADMIN_ENCRYPTION_KEY", admin_id),
                )
            row = await (await conn.execute(
                "INSERT INTO model_config_versions(id,parent_version_id,base_url,model_name,timeout_seconds,secret_version_id,created_by,rollback_source_version_id,key_source) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
                (str(uuid4()), parent_id, base_url, model_name.strip(), timeout, secret_id, admin_id, rollback_source, key_source),
            )).fetchone()
            await self._audit(conn, admin_id, audit_action, str(row['id']), 'success', request_id,
                              {'model_name': row['model_name'], 'base_url': row['base_url']})
        return public_version(row)

    async def test(self, admin_id: str, version_id: str, request_id=None):
        row = await self.version(version_id)
        if not row:
            raise LookupError("模型配置版本不存在")
        test_id = str(uuid4())
        async with self.db.pool.connection() as conn:
            await conn.execute("INSERT INTO model_config_tests(id,version_id,status,validation_version) VALUES (%s,%s,'running',%s)", (test_id, version_id, TEST_VALIDATION_VERSION))
        error = None
        cancelled = False
        status = "failed"
        try:
            secret = decrypt_secret(self.settings.admin_encryption_key, row["ciphertext"]) if row.get("ciphertext") else ""
            if not secret:
                raise ValueError("该版本没有模型密钥")
            headers = {"Authorization": f"Bearer {secret}", "Content-Type": "application/json"}
            payload = {"model": row["model_name"], "messages": [{"role": "user", "content": "请仅回复：连接测试成功"}], "stream": True}
            async with asyncio.timeout(min(row["timeout_seconds"], 60)):
                async with httpx.AsyncClient(timeout=min(row["timeout_seconds"], 60), follow_redirects=False) as client:
                    async with client.stream("POST", f'{row["base_url"]}/chat/completions', headers=headers, json=payload) as response:
                        await validate_test_stream(response)
            status = "succeeded"
        except asyncio.CancelledError:
            cancelled = True
            error = "模型连接测试已取消"
        except Exception as exc:
            error = str(exc) if isinstance(exc, ValueError) else "模型连接测试失败"
        async with self.db.pool.connection() as conn:
            async with conn.transaction():
                await conn.execute("UPDATE model_config_tests SET status=%s,error_message=%s,completed_at=now() WHERE id=%s", (status, error, test_id))
                await self._audit(conn, admin_id, "model_config.test", version_id, "success" if status == "succeeded" else "failure", request_id)
        if cancelled:
            raise asyncio.CancelledError()
        return {"id": test_id, "version_id": version_id, "status": status, "error_message": error}

    async def publish(self, admin_id: str, version_id: str, expected_revision: int, kind: str = "publish", request_id=None):
        if not isinstance(expected_revision, int) or isinstance(expected_revision, bool) or expected_revision < 0:
            raise ValueError("配置版本号无效")
        async with self.db.pool.connection() as conn, conn.transaction():
            state = await self.state(conn, for_update=True)
            if not state or not state["management_enabled"]:
                raise RuntimeError("请先显式启用管理模型配置")
            version = await self.version(version_id, conn)
            if not version:
                raise LookupError("模型配置版本不存在")
            test = await (await conn.execute(
                "SELECT status,validation_version,completed_at FROM model_config_tests WHERE version_id=%s ORDER BY tested_at DESC,id DESC LIMIT 1", (version_id,)
            )).fetchone()
            if (not test or test["status"] != "succeeded" or test["validation_version"] != TEST_VALIDATION_VERSION
                    or not test["completed_at"] or (datetime.now(timezone.utc) - test["completed_at"]).total_seconds() > 86400):
                raise ValueError("配置版本必须通过最近 24 小时内的完整连接测试，且最近一次测试成功")
            if not version.get("ciphertext") or not decrypt_secret(self.settings.admin_encryption_key, version["ciphertext"]):
                raise ValueError("该版本没有可用模型密钥")
            kind = "rollback" if version.get("rollback_source_version_id") else "publish"
            if state and state["revision"] != expected_revision:
                raise RuntimeError("配置已被其他管理员更新，请刷新后重试")
            old_id = state.get("active_version_id") if state else None
            new_revision = expected_revision + 1
            await conn.execute(
                "INSERT INTO model_config_state(singleton,active_version_id,revision,management_enabled) VALUES (TRUE,%s,%s,TRUE) "
                "ON CONFLICT(singleton) DO UPDATE SET active_version_id=excluded.active_version_id,revision=excluded.revision,management_enabled=TRUE,updated_at=now()",
                (version_id, new_revision),
            )
            publication = await (await conn.execute(
                "INSERT INTO model_config_publications(id,from_version_id,to_version_id,kind,expected_revision,resulting_revision,created_by) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                (str(uuid4()), old_id, version_id, kind, expected_revision, new_revision, admin_id),
            )).fetchone()
            await self._audit(conn, admin_id, f"model_config.{kind}", version_id, "success", request_id,
                              {'revision': new_revision})
        return {"revision": new_revision, "active_version_id": version_id, "publication_id": str(publication["id"])}

    async def clone_for_rollback(self, admin_id: str, version_id: str, key_source="current", request_id=None):
        if not isinstance(key_source, str) or key_source not in {"current", "historical"}:
            raise ValueError("密钥来源必须为 current 或 historical")
        row = await self.version(version_id)
        if not row:
            raise LookupError("回滚目标不存在")
        parent_id = version_id
        if key_source == "current":
            state = await self.state()
            if not state or not state.get("active_version_id"):
                raise ValueError("没有当前生效版本，无法沿用当前密钥")
            parent_id = str(state["active_version_id"])
        return await self.save_draft(admin_id, {"parent_version_id": parent_id, "base_url": row["base_url"],
                                                "model_name": row["model_name"], "timeout_seconds": row["timeout_seconds"], "api_key": None},
                                     request_id, audit_action='model_config.rollback.draft', rollback_source=version_id, key_source=key_source)

    async def bind_for_new_run(self, conn):
        state = await self.state(conn, for_update=True)
        if state and state["management_enabled"]:
            if not state.get("active_version_id"):
                raise ValueError("管理模型配置已启用但没有生效版本")
            return state["active_version_id"]
        return None
