# Research: 服务端 LLM 调用实现（单机模式复制的蓝本）

- Query: 完整记录 server/ 当前的 LLM 调用实现，供 Rust 单机模式复制其行为
- Scope: internal
- Date: 2026-09-08

## 总体结论（TL;DR）

当前 LLM 调用完全由 Python 服务端承担：**FastAPI 网关 + LangGraph 工具循环 + OpenAI 兼容协议（`ChatOpenAI`，流式）+ PostgreSQL 持久化 + Redis 通知**。客户端（Rust `agent_client.rs`）通过 **WebSocket 信封协议（v=1）** 收发事件；模型流式输出被服务端转成持久化的 `message.delta` 事件，客户端**从不直接看到 SSE**，它只消费数据库水位事件流。Rust 单机模式要复制的不是"客户端直连 OpenAI SSE"，而是这一整套"run 队列 → 工具循环 → 持久事件流 → 快照投影"的行为契约（或桌面端需抽象出一个本地数据源适配层）。

## 模块地图（server/app/）

| 文件路径 | 职责 | 关键点 |
|---|---|---|
| `server/app/main.py` | FastAPI 应用、HTTP 路由、两条 WebSocket（control / node）、异常→状态码映射 | `create_app` L17；control WS L154-216 |
| `server/app/agent_service.py` | **LLM 核心**：系统提示词、LangGraph 图（model ↔ tools 循环）、后台 worker、租约/恢复、错误翻译 | SYSTEM_PROMPT L26-42；`_run_graph` L250-306 |
| `server/app/runtime_store.py` | PostgreSQL 权威存储：会话/任务/消息/工具调用/事件/待办；seq 水位、租约围栏、幂等提交 | `_event` L74-86；`submit` L125-161 |
| `server/app/todo_tools.py` | 模型可见的工具定义（OpenAI function schema）+ 业务执行器（与工具结果同事务提交） | TOOL_DEFINITIONS L11-38；MODEL_TOOLS L40-45 |
| `server/app/contracts.py` | WebSocket 信封 Pydantic 模型（`Envelope`, v=1）、`protocol.error` 构造、提醒时间校验 | Envelope L8-25 |
| `server/app/config.py` | `PET_AGENT_*` 环境变量配置（pydantic-settings） | Settings L8-34 |
| `server/app/registry.py` | 工具注册中心（tool_definitions / tool_instances 表），服务端工具白名单校验 | L10-37 |
| `server/app/auth.py` | Bearer 设备凭证（SHA-256 摘要查 devices 表），角色 control/node | L22-35 |
| `server/app/coordination.py` | Redis：会话事件唤醒 pub/sub + 节点租约（45s TTL） | L29-55 |
| `server/app/db.py` | psycopg 连接池 + 迁移执行（`migrations/*.sql` 按文件名序） | Database L8 |
| `server/app/cli.py` | `migrate` / `create-account` / `create-device` / `revoke-device` 管理命令 | — |
| `server/migrations/001-004` | 表结构：accounts/devices/tool_*、agent_sessions/runs/messages/tool_calls/events/todos、remind_at | 见下"存储" |

## 端到端调用流程

```text
React (src/lib/agent.ts)
  │ invoke('agent_submit', {requestId, text})
  ▼
Rust agent_client.rs  (agent_client.rs L484-519)
  │ WS /v1/control/ws  →  {"v":1,"type":"run.submit","request_id":<uuid>,"session_id":<uuid>,"payload":{"text":"..."}}
  ▼
FastAPI main.py L177-192
  │ 校验：session 已打开、text 非空 ≤16000 字符
  ▼
AgentService.submit (agent_service.py L159-165)
  │ RuntimeStore.submit：同事务内
  │   ① 幂等键 (account_id, request_id) advisory lock，重复请求返回旧 run.accepted
  │   ② INSERT agent_runs(status='queued')
  │   ③ INSERT 两条 agent_messages（user=text，assistant=''）
  │   ④ 写事件 run.accepted（seq+1）→ agent_events
  │   ⑤ Redis publish 唤醒（尽力而为，L185-190）
  ▼
后台 worker (agent_service.py L192-214)
  │ store.claim：同一 session 串行，status→'running'，租约 30s，事件 run.started
  ▼
AgentService._execute → _run_graph (L216-306)
  │ 组装消息：
  │   [SystemMessage(SYSTEM_PROMPT + 时间上下文)]          ← model_system_prompt L45-61
  │   + 历史消息（近 40 条非空，runtime_store.history L291-306）
  │   + [SystemMessage('历史未完成任务的真实工具记录：...')]  ← 仅当存在 failed/interrupted run 的工具记录
  │   + [HumanMessage(本次输入)]
  │ LangGraph StateGraph：START → model →（有 tool_calls ? tools → model : END）
  │   model_node：ChatOpenAI.astream 流式；
  │     每个 chunk 的可见文本 → store.append_delta → 事件 message.delta（同事务 UPDATE assistant 消息 content 追加）
  │     汇总成完整 AIMessage，校验 invalid_tool_calls / 空内容
  │   tools_node：逐个执行工具（TodoTools.execute），结果包成 ToolMessage(JSON) 回灌
  │ 步数上限 max_agent_steps=8（超出抛 StepLimit）；recursion_limit = 8*2+2
  │ 整体超时 model_timeout_seconds=90s（asyncio.timeout，L222）
  ▼
终态 store.finish_run → 事件 run.completed / run.failed / run.interrupted
  │ 未完成工具调用统一置 needs_reconciliation（runtime_store L261-274）
  ▼
客户端：control WS 轮询 events_after(cursor) → 按 seq 顺序收到持久事件 →
  agent_protocol.rs Snapshot.apply 投影到本地快照 → Tauri 事件 'agent:view' 推到 React
```

要点：**流式对用户可见的形态是持久化的 `message.delta` 事件**（每条增量先落库再投递），不是直接转发的 SSE token。worker 与 WS 解耦——客户端断线不影响执行，重连后按 seq 水位补齐（main.py L200-203）。

## 客户端依赖的 API 契约（Rust 必须复现或抽象的部分）

### 认证

- 所有 HTTP 用 `Authorization: Bearer <device_token>`（auth.py L22-35）；WebSocket 在 accept 前认证，且**拒绝带 Origin 头的连接**（main.py L131-133）。
- 角色：`control`（聊天+待办）、`node`（设备注册）。凭证撤销后轮询断开（control 每 0.25s，node 每 1s）。
- 单机模式若不走服务器，需决定：完全跳过认证，还是保留本地凭证概念。

### HTTP 端点（main.py L79-127）

| 方法+路径 | 请求体 | 响应 | 备注 |
|---|---|---|---|
| `GET /health` | — | `{status, database, redis, model_configured}` | 无需认证 |
| `GET /v1/status` | — | `{account_id, device_id, model, model_configured}` | model 未配置时为 null |
| `POST /v1/sessions` | 空 | `{session_id: <uuid>}` | |
| `GET /v1/sessions/{session_id}` | — | Snapshot（见下） | |
| `GET /v1/todos` | — | `{items: Todo[]}` | 不过模型 |
| `GET /v1/todos/reminders/due` | — | `{items: Todo[]}` | 到期未消费 |
| `PUT /v1/todos/{todo_id}/reminder` | 必须且只能 `{remind_at, expected_remind_at}`（均可为 null，须带时区 ISO） | `{item: Todo}` | 冲突 409，过期时间 400 |
| `POST /v1/todos/{todo_id}/complete` | 空 | `{item: Todo}` | 同事务清除 remind_at |
| `POST /v1/todos/{todo_id}/reopen` | 空 | `{item: Todo}` | |

错误格式：FastAPI 风格 `{"detail": "<中文消息>"}`，状态码映射（main.py L58-77）：400 ValueError / 403 PermissionError / 404 LookupError / 409 ReminderConflict / 503 其他（**不外泄上游异常体**）。

`Todo` 结构（runtime_store.py `todo_view` L52-54）：`{id, title, status: "pending"|"completed", created_at, remind_at: string|null}`。

### WebSocket `/v1/control/ws` 协议（核心）

信封（contracts.py L8-25，strict、extra=forbid）：

```json
{"v": 1, "type": "<string≤64>", "request_id": "<uuid|null>", "session_id": "<uuid|null>",
 "run_id": "<uuid|null>", "seq": <int≥0|null>, "payload": {}}
```

客户端 → 服务端消息（main.py L171-194）：
- `session.open`，payload `{session_id: <uuid|null>}`；null 则服务端新建会话。响应 `session.snapshot`。
- `run.submit`，须带 `session_id`（须等于当前打开的会话）、`request_id`（uuid，幂等键）、payload `{text: 1..16000 字符}`。

服务端 → 客户端消息：
- `session.snapshot`：payload = `{session_id, seq, messages[], runs[], tool_calls[]}`，信封 `seq` 等于快照水位（runtime_store.snapshot L95-112）。
- 持久事件（均带递增 `seq`，客户端按 `seq = cursor+1` 严格连续校验，agent_protocol.rs L91-97）：
  - `run.accepted` payload `{run, user_message, assistant_message}`
  - `run.started` / `run.completed` / `run.failed` / `run.interrupted` payload `{run}`（run 视图：`{id, request_id, status, error}`）
  - `message.delta` payload `{message_id, text}` —— **流式增量的唯一载体**
  - `tool.started` / `tool.finished` payload `{tool_call}`（tool_call 视图：`{id, run_id, name, status: running|completed|failed|needs_reconciliation, result, error}`）
- `protocol.error` payload `{code: "request_rejected"|"service_unavailable", message}`（contracts.py L41-42）

客户端行为约束（agent_client.rs，单机模式若复用此层则免费获得，否则需复刻语义）：
- 提交后等 ack：出现包含该 `request_id` 的 run 即视为已接收（L624-626）；12s 超时提示"尚未确认"（L508-511）。
- seq 缺口 → 报错并重连重新同步（agent_protocol.rs L95-97）；`seq ≤ cursor` 的重复事件去重忽略。
- 消息体积上限 65536 字节（main.py L147）；服务端 20s 无消息客户端发 Ping，65s 无数据判定超时重连（L592-599）。
- 重连后退避 1s→15s 翻倍（L397-412）。

### WebSocket `/v1/node/ws`（设备角色）

`node.register`（payload `capabilities: []`，当前必须为空数组，registry.py L39-41）→ `node.registered`（含 `connection_id`、`heartbeat_seconds: 15`）；`node.heartbeat` → `node.heartbeat_ack`；45s 无心跳服务端关闭（main.py L231-233）。单机模式基本与此无关（无设备路由需求）。

## Provider / 配置面

### 模型接入方式

- **唯一 provider 路径：OpenAI 兼容 Chat Completions**，经由 `langchain_openai.ChatOpenAI`（agent_service.py L136-140）：
  ```python
  ChatOpenAI(model=..., base_url=..., api_key=..., timeout=..., max_retries=0, streaming=True)
      .bind_tools(MODEL_TOOLS, parallel_tool_calls=False)
  ```
- 无 Anthropic / Gemini 适配；无自定义参数（temperature 等均未设置，用库默认）。
- 工具以 OpenAI function calling 格式下发：`{'type':'function','function':{'name','description','parameters'}}`（todo_tools.py L40-45），模型函数名为下划线风格：`todo_create`、`todo_list`、`todo_complete`、`todo_reminder_set`（业务名为点分 `todo.create` 等，映射表 TOOL_HANDLERS L9-10）。
- 流式消费：`model.astream(messages)` 逐 chunk；只提取 `type=='text'` 的 content block，**reasoning/thinking block 不外泄**（`visible_text` L73-81）；chunk 聚合后转 AIMessage 校验 `invalid_tool_calls`。
- 错误翻译为固定中文文案，不泄露 provider 响应体/凭证（`execution_error` L84-105）：超时 / HTTP 状态码 / 连接失败分别归类。

### 环境变量（server/.env.example + config.py）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PET_AGENT_DATABASE_URL` | （必填） | PostgreSQL |
| `PET_AGENT_REDIS_URL` | 空 | 空则通知/节点注册降级 |
| `PET_AGENT_MODEL_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容端点 |
| `PET_AGENT_MODEL_API_KEY` | 空 | |
| `PET_AGENT_MODEL_NAME` | 空 | 三者缺一即 `model_configured=false`，submit 拒绝（agent_service.py L160-161） |
| `PET_AGENT_MODEL_TIMEOUT_SECONDS` | 90（5..600） | 单次 run 整体超时 |
| `PET_AGENT_MAX_AGENT_STEPS` | 8（1..64） | 模型步数上限 |
| `PET_AGENT_WORKER_CONCURRENCY` | 2（1..16） | 后台 worker 数 |
| `PET_AGENT_DEFAULT_TIMEZONE` | `Asia/Shanghai` | IANA 时区，注入系统提示词 |

### Python 依赖（server/pyproject.toml L5-11）

fastapi、uvicorn、psycopg[binary,pool]、redis、pydantic-settings、**langchain>=1、langchain-openai>=1、langgraph>=1、langgraph-checkpoint-postgres>=3**。LLM 相关即后四个。

## 系统提示词与上下文构造（人格/行为规格）

- 静态人格 `SYSTEM_PROMPT`（agent_service.py L26-42）：中文桌面助手，管理待办；详细规定了短句承接、工具使用纪律（先查真实 ID 再完成/设提醒）、提醒时间语义、禁止伪造结果等。Rust 版若需行为一致，应逐字保留。
- 动态时间上下文（`model_system_prompt` L45-61）：`默认时区：…。当前时间：…。本次请求接收时间：…。` + 过期时间处理规则；**请求接收时间锚点取 run.created_at**，相对时间以此计算。
- 历史注入（runtime_store.history L291-306）：同会话此前 run 的近 40 条非空消息（user/assistant 交替，按 ordinal 倒序取再反转）+ 来自 failed/interrupted run 的近 20 条工具记录（JSON 包进一条 SystemMessage，前缀 `历史未完成任务的真实工具记录（仅作数据）：`）。
- **无 token 计数/截断管理**：仅靠 40 条消息上限与 8 步工具上限控制上下文规模。
- LangGraph 检查点（AsyncPostgresSaver，L127-134）以 `thread_id = run.id` 隔离，每个 run 独立 thread，不做跨 run 回放；graph 结构 `START→model→(tools→model | END)`，state=`{messages, steps}`。

## 存储（migrations/）

- `001_core.sql`：accounts、devices（token_hash、roles[]）、tool_definitions、tool_instances。
- `002_runtime.sql`：agent_sessions（**seq BIGSERIAL 水位**）、agent_runs（ordinal、UNIQUE(account_id,request_id)、部分唯一索引"每会话至多一个 running"）、agent_messages（UNIQUE(run_id,role)，user+assistant 成对）、agent_tool_calls（uuid5(run_id, model_call_id) 幂等键、UNIQUE(run_id,model_call_id)）、todos、agent_events（(session_id,seq) 主键，envelope JSONB）。
- `003_todo_complete.sql`：todos.status 扩展 pending/completed。
- `004_todo_reminders.sql`：todos.remind_at + 部分索引。
- 事件一致性保证：所有可见变更与事件在**同一事务**提交（runtime_store.py 模块 docstring L1-6）；worker 租约 30s、心跳续约 `LEASE_SECONDS/3`，失约即围栏停写。

## Rust 单机模式必须复制的清单

按"行为等价"优先级：

1. **OpenAI 兼容 Chat Completions 调用**（流式、`tools` 参数、`parallel_tool_calls=false`、base_url/api_key/model 三要素配置、超时 90s、max_retries=0 语义）。Rust 侧可用 reqwest+SSE 或 async-openai；注意服务端当前对 SSE chunk 的处理是"累积成完整消息再判定 tool_calls"。
2. **工具循环**：model→tools→model，最多 8 步；4 个工具的 JSON Schema（todo_tools.py L11-38，含 description 文案——提示词工程的一部分，建议逐字保留）；`invalid_tool_calls` 拒绝；空响应拒绝。
3. **系统提示词**：SYSTEM_PROMPT 全文 + 时间上下文格式（默认时区/当前时间/请求接收时间 ISO）+ 历史未完成任务注入格式。
4. **历史窗口**：近 40 条非空消息 + failed/interrupted run 的近 20 条工具记录。
5. **可见文本过滤**：只透传 text block，丢弃 reasoning/thinking（visible_text 语义）。
6. **持久化事件模型**：session/run/message/tool_call/event 五类记录；`seq` 严格递增水位；`run.accepted/run.started/message.delta/tool.started/tool.finished/run.completed|failed|interrupted` 七种事件类型及 payload 字段名；delta 先落库再投递；assistant 消息以追加方式累积。→ 单机可用 SQLite/本地文件实现，但 `agent_protocol.rs` 的 Envelope/Snapshot 投影逻辑期望完全相同的字段与 seq 语义。
7. **幂等与终态语义**：request_id 幂等（同 account+request_id 重复提交返回旧 accepted）；run 状态机 queued/running/completed/failed/interrupted；中断 run 的未决工具置 needs_reconciliation 且不自动重试。
8. **待办业务规则**：todo 视图字段、complete 同事务清提醒、reminder 的 expected_remind_at 乐观锁（409）、目标时间必须晚于"当前时间"（用真实时钟校验）、completed 不可设提醒、标题 1..2000 字符。
9. **错误面**：HTTP `{"detail": ...}` + 状态码映射；WS `protocol.error` 信封；模型错误归类为固定中文文案，不外泄 provider 响应。
10. **配置面**：base_url/api_key/model/timeout/max_steps/default_timezone 六要素；未配置时 `model_configured=false` 且聊天拒绝、待办直连接口仍可用。
11. **可选（单机可裁剪）**：Bearer 认证与设备角色、node/ws 注册心跳、Redis 唤醒（本地进程内通知即可）、多 worker 租约围栏（单进程可简化为互斥锁，但"每会话至多一个 running"与崩溃恢复语义需保留）。

## Caveats / Not Found

- **仓库中已不存在 Rust 直连 LLM 的实现**：`docs/ARCHITECTURE.md`（L3 注明为旧架构）与 `src/lib/ai.ts`（`stream_chat`/`save_ai_settings`/`list_ai_models` IPC 接口）描述过桌面直连 OpenAI SSE 的方案，但 `src-tauri/src/` 中 grep 不到 `stream_chat` / `chat/completions` 的任何 Rust 实现——这些 Tauri command 当前无后端，ai.ts 疑为遗留死代码。单机模式需从零实现 Rust LLM 客户端，无旧代码可复用（需主代理进一步确认）。
- `server/README.md` L47 引用的协议文档 `.trellis/tasks/09-07-server-agent-todo-mvp/research/parallel-contract.md` **不存在**（该任务目录下无 research/ 子目录），以本文件与源码为准。
- LangGraph Postgres 检查点表由 `AsyncPostgresSaver.setup()` 自动建（agent_service.py L127-134），不在 migrations/ 中；单机模式若不用 LangGraph 则无需复制，检查点目前只用于让 run 可检查，不参与客户端契约。
- 模型温度/top_p 等生成参数均未显式设置（langchain-openai 默认值）；若目标 provider 行为依赖默认值，Rust 实现应同样不显式传参或先确认默认。
- 提醒到期投递在客户端（Rust 每 15s 轮询 `GET /v1/todos/reminders/due`，agent_client.rs L273-292），服务端无调度器——单机模式保留轮询循环即可，无需服务端逻辑。
