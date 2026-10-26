import asyncio
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .auth import Auth
from .admin import install_admin_routes
from .config import Settings
from .contracts import Envelope, ReminderConflict, envelope, protocol_error, reminder_arguments, reminder_time, uuid_string
from .coordination import Coordination
from .db import Database
from .registry import Registry


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app):
        if not settings.database_url:
            raise RuntimeError("PET_AGENT_DATABASE_URL 未配置")
        db, coordination = Database(settings), Coordination(settings)
        service = None
        try:
            await db.open()
            await coordination.open()
            registry = Registry(db)
            from .plugin_runtime import builtin_plugins
            plugins = builtin_plugins(db)
            await registry.register_server_tools(plugins)
            from .agent_service import AgentService
            service = AgentService(db, settings, coordination, plugins)
            app.state.db, app.state.coordination = db, coordination
            app.state.auth, app.state.registry = Auth(db), registry
            app.state.service = service
            # Plugins only declare their endpoints (plugin.json rest_endpoints);
            # the core mounts them against the plugin's domain store.
            app.state.todo_store = service.plugins.store_for('todo')
            app.state.memo_store = service.plugins.store_for('memo')
            install_admin_routes(app, db, settings, coordination)
            await service.start()
            yield
        finally:
            if service:
                await service.stop()
            await coordination.close()
            await db.close()

    app = FastAPI(title="桌面助手服务", lifespan=lifespan, redirect_slashes=False)

    @app.middleware("http")
    async def sanitize_unhandled_errors(request: Request, call_next):
        try:
            return await call_next(request)
        except Exception:
            # Catch before ASGI server logging can serialize a sensitive upstream
            # exception. Expected domain errors use the handlers below.
            return JSONResponse(status_code=503, content={"detail": "服务暂时不可用，请稍后重试"})

    async def principal(request: Request):
        return await app.state.auth.authenticate(request.headers.get("authorization"), "control")

    async def effective_model_status():
        state = await app.state.model_configs.public_state()
        if state["management_enabled"]:
            active = state["active"]
            return (active["model_name"] if active else None, bool(active))
        return settings.model_name or None, settings.model_configured

    @app.exception_handler(PermissionError)
    async def forbidden(request, exc):
        return JSONResponse(status_code=403, content={"detail": str(exc)})

    @app.exception_handler(ValueError)
    async def invalid(request, exc):
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.exception_handler(ReminderConflict)
    async def reminder_conflict(request, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(LookupError)
    async def missing(request, exc):
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(Exception)
    async def unavailable(request, exc):
        # Never serialize a database connection string, token, or upstream exception.
        return JSONResponse(status_code=503, content={"detail": "服务暂时不可用，请稍后重试"})

    @app.get("/health")
    async def health():
        database, redis = await asyncio.gather(app.state.db.healthy(), app.state.coordination.healthy())
        model_name, model_configured = (await effective_model_status()) if database else (None, None)
        return {"status": "ok" if database and redis else "degraded", "database": database,
                "redis": redis, "model": model_name, "model_configured": model_configured}

    @app.get("/v1/status")
    async def status(request: Request):
        who = await principal(request)
        model_name, model_configured = await effective_model_status()
        return {"account_id": who.account_id, "device_id": who.device_id,
                "model": model_name, "model_configured": model_configured}

    @app.post("/v1/sessions")
    async def create_session(request: Request):
        return await app.state.service.create_session(await principal(request))

    @app.get("/v1/sessions/{session_id}")
    async def snapshot(session_id: str, request: Request):
        who = await principal(request)
        return await app.state.service.snapshot(who, uuid_string(session_id, "session_id"))

    @app.get("/v1/todos")
    async def todos(request: Request):
        who = await principal(request)
        return {"items": await app.state.todo_store.list_todos(who.account_id)}

    async def todo_title_argument(request: Request) -> str:
        try:
            body = await request.json()
        except ValueError:
            raise ValueError("待办请求必须为有效 JSON") from None
        if not isinstance(body, dict) or set(body) != {"title"}:
            raise ValueError("必须且只能提供 title")
        return body["title"]

    @app.post("/v1/todos")
    async def create_todo(request: Request):
        who = await principal(request)
        title = await todo_title_argument(request)
        return {"item": await app.state.todo_store.create_todo(who.account_id, title)}

    @app.patch("/v1/todos/{todo_id}")
    async def update_todo_title(todo_id: str, request: Request):
        who = await principal(request)
        todo_id = uuid_string(todo_id, "todo_id")
        title = await todo_title_argument(request)
        return {"item": await app.state.todo_store.update_todo_title(who.account_id, todo_id, title)}

    @app.delete("/v1/todos/{todo_id}")
    async def delete_todo(todo_id: str, request: Request):
        who = await principal(request)
        # Return the pre-delete snapshot so clients can animate the removal.
        return {"item": await app.state.todo_store.delete_todo(who.account_id, uuid_string(todo_id, "todo_id"))}

    @app.get("/v1/todos/reminders/due")
    async def due_reminders(request: Request):
        who = await principal(request)
        return {"items": await app.state.todo_store.due_reminders(who.account_id)}

    @app.put("/v1/todos/{todo_id}/reminder")
    async def set_todo_reminder(todo_id: str, request: Request):
        who = await principal(request)
        todo_id = uuid_string(todo_id, "todo_id")
        try:
            body = await request.json()
        except ValueError:
            raise ValueError("提醒请求必须为有效 JSON") from None
        target, expected = reminder_arguments(body)
        return {"item": await app.state.todo_store.set_todo_reminder(who.account_id, todo_id, target, expected)}

    @app.post("/v1/todos/{todo_id}/complete")
    async def complete_todo(todo_id: str, request: Request):
        who = await principal(request)
        return {"item": await app.state.todo_store.complete_todo(who.account_id, uuid_string(todo_id, "todo_id"))}

    @app.post("/v1/todos/{todo_id}/reopen")
    async def reopen_todo(todo_id: str, request: Request):
        who = await principal(request)
        return {"item": await app.state.todo_store.reopen_todo(who.account_id, uuid_string(todo_id, "todo_id"))}

    async def memo_body(request: Request, label: str) -> dict:
        try:
            body = await request.json()
        except ValueError:
            raise ValueError(f"{label}请求必须为有效 JSON") from None
        if not isinstance(body, dict):
            raise ValueError(f"{label}请求必须为 JSON 对象")
        return body

    @app.get("/v1/memos")
    async def memos(request: Request):
        who = await principal(request)
        kind = request.query_params.get("kind")
        if kind is not None and kind not in ("note", "goal"):
            raise ValueError("kind 仅支持 note 或 goal")
        raw_archived = request.query_params.get("include_archived")
        if raw_archived not in (None, "true", "false"):
            raise ValueError("include_archived 必须为 true 或 false")
        return {"items": await app.state.memo_store.list_memos(who.account_id, kind, raw_archived == "true")}

    @app.post("/v1/memos")
    async def create_memo(request: Request):
        who = await principal(request)
        body = await memo_body(request, "备忘")
        if "title" not in body or set(body) - {"title", "kind", "content", "review_at"}:
            raise ValueError("必须提供 title，仅可附加 kind、content 和 review_at")
        return {"item": await app.state.memo_store.create_memo(
            who.account_id, body["title"], body.get("kind", "note"), body.get("content"),
            reminder_time(body.get("review_at")))}

    @app.patch("/v1/memos/{memo_id}")
    async def update_memo(memo_id: str, request: Request):
        who = await principal(request)
        memo_id = uuid_string(memo_id, "memo_id")
        body = await memo_body(request, "备忘")
        if not body or set(body) - {"title", "kind", "content"}:
            raise ValueError("必须且只能提供 title、kind 或 content 中的至少一项")
        return {"item": await app.state.memo_store.update_memo(who.account_id, memo_id, body)}

    @app.post("/v1/memos/{memo_id}/archive")
    async def archive_memo(memo_id: str, request: Request):
        who = await principal(request)
        memo_id = uuid_string(memo_id, "memo_id")
        body = await memo_body(request, "归档")
        if set(body) != {"archived"} or not isinstance(body["archived"], bool):
            raise ValueError("必须且只能提供布尔值 archived")
        return {"item": await app.state.memo_store.set_memo_archived(who.account_id, memo_id, body["archived"])}

    @app.put("/v1/memos/{memo_id}/review")
    async def set_memo_review(memo_id: str, request: Request):
        who = await principal(request)
        memo_id = uuid_string(memo_id, "memo_id")
        body = await memo_body(request, "回顾")
        if set(body) != {"review_at", "expected_review_at"}:
            raise ValueError("必须且只能提供 review_at 和 expected_review_at")
        target, expected = reminder_time(body["review_at"]), reminder_time(body["expected_review_at"])
        return {"item": await app.state.memo_store.set_memo_review(who.account_id, memo_id, target, expected)}

    @app.get("/v1/memos/reviews/due")
    async def due_memo_reviews(request: Request):
        who = await principal(request)
        return {"items": await app.state.memo_store.due_reviews(who.account_id)}

    async def websocket_auth(ws: WebSocket, role: str):
        # This application does not accept browser-originated credentialed sockets.
        if ws.headers.get("origin"):
            await ws.close(code=1008)
            return None
        try:
            who = await app.state.auth.authenticate(ws.headers.get("authorization"), role)
        except PermissionError:
            await ws.close(code=1008)
            return None
        except Exception:
            await ws.close(code=1013)
            return None
        await ws.accept()
        return who

    async def receive(ws):
        raw = await ws.receive_text()
        if len(raw.encode()) > 65536:
            raise ValueError("请求超过大小限制")
        try:
            return Envelope.model_validate_json(raw)
        except ValidationError:
            raise ValueError("协议版本或消息结构无效") from None

    @app.websocket("/v1/control/ws")
    async def control(ws: WebSocket):
        who = await websocket_auth(ws, "control")
        if who is None:
            return
        session_id, cursor = None, 0
        pending_receive = asyncio.create_task(receive(ws))
        try:
            while True:
                # Revalidate even idle sockets: revocation blocks every new operation
                # immediately, and closes idle connections within the polling interval.
                done, _ = await asyncio.wait({pending_receive}, timeout=0.25)
                await app.state.auth.ensure_active(who, "control")
                if done:
                    message = None
                    try:
                        message = pending_receive.result()
                        if message.type == "session.open":
                            requested = message.payload.get("session_id")
                            target = uuid_string(requested, "session_id") if requested is not None else (await app.state.service.create_session(who))["session_id"]
                            result = await app.state.service.snapshot(who, target)
                            await ws.send_json(envelope("session.snapshot", result, session_id=target, seq=result["seq"], request_id=message.request_id))
                            session_id, cursor = target, result["seq"]
                        elif message.type == "run.submit":
                            target = uuid_string(message.session_id, "session_id")
                            if target != session_id:
                                raise ValueError("请先打开对应会话")
                            request_id = uuid_string(message.request_id, "request_id")
                            text = message.payload.get("text")
                            if not isinstance(text, str) or not text.strip() or len(text) > 16000:
                                raise ValueError("消息不能为空且不能超过 16000 字符")
                            result = await app.state.service.submit(who, request_id, target, text)
                            if result["seq"] <= cursor:
                                # A retried request already covered by the snapshot
                                # still needs an acknowledgement. Its old seq is safe
                                # for clients to deduplicate without changing state.
                                await ws.send_json(result)
                            # New acceptances are delivered by the ordered event
                            # pump below, after any intervening persisted deltas.
                        else:
                            raise ValueError("控制连接不支持此消息类型")
                    except (ValueError, LookupError, PermissionError) as exc:
                        await ws.send_json(protocol_error("request_rejected", str(exc), message.request_id if message else None))
                    except RuntimeError:
                        await ws.send_json(protocol_error("service_unavailable", "模型或任务服务未就绪", message.request_id if message else None))
                    pending_receive = asyncio.create_task(receive(ws))
                if session_id:
                    for event in await app.state.service.events_after(who, session_id, cursor):
                        await ws.send_json(event)
                        cursor = event["seq"]
        except WebSocketDisconnect:
            pass
        except PermissionError:
            await ws.close(code=1008, reason="设备凭证已撤销")
        except Exception:
            try:
                await ws.send_json(protocol_error("service_unavailable", "服务连接中断，请重新连接"))
                await ws.close(code=1011)
            except Exception:
                pass
        finally:
            pending_receive.cancel()
            await asyncio.gather(pending_receive, return_exceptions=True)

    @app.websocket("/v1/node/ws")
    async def node(ws: WebSocket):
        who = await websocket_auth(ws, "node")
        if who is None:
            return
        connection_id = str(uuid4())
        registered = False
        pending_receive = asyncio.create_task(receive(ws))
        last_heartbeat = asyncio.get_running_loop().time()
        try:
            while True:
                done, _ = await asyncio.wait({pending_receive}, timeout=1)
                await app.state.auth.ensure_active(who, "node")
                if asyncio.get_running_loop().time() - last_heartbeat > 45:
                    await ws.close(code=1008, reason="设备心跳超时")
                    break
                if not done:
                    continue
                message = None
                try:
                    message = pending_receive.result()
                    if message.type == "node.register":
                        if registered:
                            raise ValueError("当前连接已经注册")
                        app.state.registry.validate_capabilities(message.payload.get("capabilities"))
                        await app.state.coordination.register(who, connection_id)
                        registered = True
                        last_heartbeat = asyncio.get_running_loop().time()
                        await ws.send_json(envelope("node.registered", {"device_id": who.device_id, "connection_id": connection_id, "heartbeat_seconds": 15}, request_id=message.request_id))
                    elif message.type == "node.heartbeat":
                        if not registered or message.payload.get("connection_id") != connection_id:
                            raise ValueError("设备连接标识无效或尚未注册")
                        if not await app.state.coordination.heartbeat(who, connection_id):
                            await ws.close(code=1008, reason="设备租约已失效或被新连接替换")
                            break
                        last_heartbeat = asyncio.get_running_loop().time()
                        await ws.send_json(envelope("node.heartbeat_ack", {"connection_id": connection_id}, request_id=message.request_id))
                    else:
                        raise ValueError("节点连接不支持此消息类型")
                except (ValueError, LookupError) as exc:
                    await ws.send_json(protocol_error("request_rejected", str(exc), message.request_id if message else None))
                pending_receive = asyncio.create_task(receive(ws))
        except WebSocketDisconnect:
            pass
        except PermissionError:
            await ws.close(code=1008, reason="设备凭证已撤销")
        except Exception:
            try:
                await ws.send_json(protocol_error("service_unavailable", "设备注册服务不可用"))
                await ws.close(code=1013)
            except Exception:
                pass
        finally:
            pending_receive.cancel()
            await asyncio.gather(pending_receive, return_exceptions=True)
            if registered:
                await app.state.coordination.unregister(who, connection_id)

    return app


app = create_app()
