# 并行实现合同 v1

用户已于 2026-09-07 批准最小计划及三个子任务并行实施。此文固定接口和文件归属；若需改变线上合同，先向主代理提出，并同步其他代理，不自行分叉。

## 文件归属

- gateway-foundation：server/pyproject.toml、uv.lock、compose.yaml、.env.example、README.md、app/__init__.py、app/main.py、app/config.py、app/db.py、app/auth.py、app/contracts.py、app/coordination.py、app/registry.py、app/cli.py、migrations/001_core.sql、tests/test_gateway*.py。
- runtime-todos：server/app/agent_service.py、app/runtime_store.py、app/todo_tools.py、migrations/002_runtime.sql、tests/test_runtime*.py。不得改 pyproject 或 foundation 文件；依赖需求发消息给 foundation。
- desktop-client：src-tauri/、src/lib/agent.ts、src/lib/ai.ts（必要兼容）、src/App.tsx、src/components/ChatPanel.tsx、必要且局部的 CSS。保留已有气泡框改动，不改宠物资源。
- 主代理：规划、合同、集成验收、README 根入口、spec、项目验证脚本。所有代理共享工作区，禁止恢复或覆盖他人的更改。

## Python 基础接口（foundation 提供）

- config.Settings：database_url、redis_url、model_base_url、model_api_key、model_name、model_timeout_seconds（默认 90）、max_agent_steps（默认 8）、gateway_id、worker_concurrency（默认 2）。凭证字段不得输出到 repr/log。
- auth.Principal：account_id: str、device_id: str、roles: tuple[str, ...]。来自认证，不来自用户消息体。
- db.Database(settings)：.pool 为 psycopg_pool.AsyncConnectionPool；async open() / close()。连接使用 autocommit=True、dict_row、prepare_threshold=0，事务显式 conn.transaction()。open 按文件名执行 migrations/*.sql，记录迁移版本。
- coordination.Coordination(settings)：async open()/close()；async publish_session(account_id: str, session_id: str) 为 best-effort 唤醒提示，失败不得使已提交业务事务变失败。
- core SQL：accounts(id UUID PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ)；devices(id UUID PRIMARY KEY, account_id UUID REFERENCES accounts(id), name TEXT, token_hash TEXT UNIQUE, roles TEXT[], revoked_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ)。001 还负责工具定义/实例；002 不重复创建 core 表。
- 主服务端应用开关由配置控制真实依赖，禁止用 mock 模型作为运行模式。依赖不可用返回真实错误。

## Python 运行时接口（runtime 提供）

app.agent_service.AgentService(db, settings, coordination)：
- async start() / stop()：初始化 checkpoint 并管理有限并发的持久执行 worker。
- async create_session(principal) -> dict：返回 {"session_id": UUID string}。
- async snapshot(principal, session_id: str) -> dict：返回下述快照 payload；一致性事务保证 seq 与数据同一水位。
- async submit(principal, request_id: str, session_id: str, text: str) -> dict：返回持久 run.accepted envelope；重复请求复用原任务，不同 payload 重用同 request_id 则冲突。
- async list_todos(principal) -> list[dict]：真实数据，无默认示例。
- async events_after(principal, session_id: str, after_seq: int) -> list[dict]：返回持久事件，按 session 内 seq 递增，最多 200 条。始终校验会话账号归属。
- 错误用 ValueError（非法输入）、PermissionError（不属于账号）、LookupError（无记录）；统一面向用户的错误消息不能带模型密钥/连接串。
- 模型未配置时仍允许健康检查/会话快照/待办查询；提交模型任务返回明确未就绪，不能伪造回复。
- todo.create/list 的稳定目录名称保持点号，模型可使用 todo_create/todo_list 映射。注册中心到实际实现必须有白名单映射；foundation 与 runtime 通过消息确认具体联结，不能目录与调用完全脱节。

## HTTP 合同

Rust 使用 Authorization: Bearer <device token>，远程 HTTPS，回环开发允许 HTTP。device_id 来自 token，不由客户端指定替换。
- GET /health：不包含秘密；{"status":"ok|degraded","database":bool,"redis":bool,"model_configured":bool}。就绪与模型配置分别报告。
- GET /v1/status：需认证；{"account_id":str,"device_id":str,"model":str|null,"model_configured":bool}。
- POST /v1/sessions：需认证，无用户指定 account_id；返回 {"session_id":str}。
- GET /v1/sessions/{session_id}：需认证，返回 snapshot payload。
- GET /v1/todos：需认证；{"items":[Todo,...]}。
错误使用 JSON {"detail":str}，账号隔离失败明确拒绝。禁止 HTTP redirect 传递凭证到新地址。

## WebSocket 合同

- /v1/control/ws：需要 control 角色；/v1/node/ws：需要 node 角色。Rust 独立连接两个入口，以免聊天控制继承节点执行权限。
- Header 完成认证后接受连接。框架级 ping/pong 不能替代应用节点心跳；同一连接代际/凭证撤销均需校验。
- Envelope：{"v":1,"type":str,"request_id":str|null,"session_id":str|null,"run_id":str|null,"seq":int|null,"payload":object}。允许省略空标识，服务端所有数据采用 snake_case。
- 控制端先发 session.open，payload {"session_id":str|null}；null 时创建真实新会话，再返回 session.snapshot。
- session.snapshot 的 envelope.seq 等于 payload.seq；之后推送大于该水位的持久事件。网关从 PostgreSQL events_after 轮询兜底，不能依赖 Redis Pub/Sub 无损投递；快照后开始查事件也不会有丢失间隙。
- run.submit：request_id 为客户端生成 UUID，session_id 为当前会话，payload {"text":str}。新 run.accepted 必须经 events_after 按 seq 顺序推送，禁止越过尚未发送的较早事件。重复请求若 accepted.seq <= 当前游标，可单独返回旧确认；客户端按 seq 去重。
- 控制端可发 session.open 重同步。首轮固定一个当前会话；更换会话关闭旧事件泵或切换代际。
- node.register：payload {"capabilities":[]}，MVP 真实能力为空，注册未知能力拒绝；响应 node.registered，payload {"device_id":str,"connection_id":str,"heartbeat_seconds":15}。
- node.heartbeat：payload {"connection_id":str}，服务端响应 node.heartbeat_ack。Redis TTL 45 秒；connection_id 防止旧连接断开把新连接租约删除。
- protocol.error：request_id 保留，payload {"code":str,"message":str}，必须向 UI 呈现，不得当 run.completed。

## 快照和事件数据

Todo = {"id":str,"title":str,"status":"pending|completed","created_at":ISO8601 string}
Message = {"id":str,"role":"user|assistant","content":str,"created_at":ISO8601 string,"run_id":str|null}
ToolCall = {"id":str,"run_id":str,"name":str,"status":"running|completed|failed|needs_reconciliation","result":object|null,"error":str|null}
Run = {"id":str,"request_id":str,"status":"queued|running|completed|failed|interrupted","error":str|null}
Snapshot = {"session_id":str,"seq":int,"messages":[Message,...],"tool_calls":[ToolCall,...],"runs":[Run,...]}

持久事件 payload：
- run.accepted：{"run":Run,"user_message":Message,"assistant_message":Message}。placeholder assistant.id 固定，后续 delta 引用它。
- message.delta：{"message_id":str,"text":str}。
- run.started：{"run":Run}；queued→running 也必须推进同一会话的 seq。
- tool.started / tool.finished：{"tool_call":ToolCall}。
- run.completed / run.failed / run.interrupted：{"run":Run}。
所有持久事件有 session_id、run_id、request_id、seq；seq 在会话内单调递增，事务与快照状态同步。UI 展示真实 tool 状态，不展示隐藏思维链。

## 最小恢复约束

业务插入与 tool 结果同事务；request 唯一幂等。副作用后模型失败保留 tool 结果。旧 running 租约到期先标 interrupted，不重新生成工具调用或盲目重放。worker 认领同一会话任务要串行、跨会话有界并发。客户端收到连接断开不删除已保存的消息或把任务标成功，重连用 snapshot 恢复。

## 联调条件与真实性

开发本机运行独立服务不等于由桌面启动 Sidecar。模型配置用户已同意复用当前桌宠配置到本机服务端；不要向未知外部地址上传配置。用户尚未给真实待办内容，先验证真实空状态、只读模型查询；不创建演示待办。单元测试 mock 明确标注为隔离测试，不当作真实模型证据。完整实时数据库集成需使用本项目真实服务与实际授权数据。

## 后续完成与直接列表扩展

2026-09-07：新增 `todo.complete` / `todo_complete({todo_id})`，返回同一 Todo 结构，业务状态允许 completed。已有 GET /v1/todos 返回所有状态；桌面 `agent_list_todos` 直接读取此接口，不创建模型任务。细节见 [扩展设计](../../09-07-todo-complete/design.md) 与 [当前服务规格](../../../spec/backend/server-agent.md)。
