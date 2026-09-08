# 设计: 服务端 / 单机双模式 LLM 架构

依据：`research/server-llm-implementation.md`（蓝本）、`research/desktop-architecture.md`（现状）、`research/rust-llm-tech-options.md`（选型）。

## 1. 核心设计决策

### D1 模式切换落在 Rust 层，前端零分支

现状：前端从不直连 Python 服务，一切经 `agent_client.rs`，前端只用 `invoke()` + `listen('agent:view')`（`src/lib/agent.ts`）。因此双模式在 **Rust 内部**做数据源切换：无论哪种模式，都向前端产出同构的 `AgentView` / `Snapshot`，经同一个 `agent:view` 事件推送。

**理由**：
- `ChatPanel` / `App.tsx` / `pet-live-status.ts` / `tools/verify-chat-interaction.mjs` 全部只依赖 `AgentView` 契约，Rust 侧同构产出即可**前端零改动**。
- 备选方案（复活 `src/lib/ai.ts` 的 `stream_chat` + Channel 直推 token）需要前端按模式分支渲染、两条消息合并路径，且无法承载工具调用/待办，否决。Channel API 仅作为后续 token 推送性能优化的可选手段，不进 MVP。

### D2 单机模式复刻"快照投影"契约，而非"客户端直连 SSE"

服务端对客户端暴露的不是 SSE token 流，而是"run 队列 → 工具循环 → 持久事件（`run.accepted` / `message.delta` / `tool.*` / `run.completed|failed|interrupted`，带严格递增 `seq`）→ 快照投影"（`agent_protocol.rs` 的 `Snapshot.apply`）。单机模式在 Rust 进程内实现同一事件模型与投影：

- 本地运行时在内存中走同一套事件类型与 `Snapshot` 投影逻辑（直接复用/扩展 `agent_protocol.rs` 的类型），每次投影后 `emit('agent:view')`——与服务端模式完全同一条出口。
- 持久化落地本地存储，保证重启恢复与 seq 语义；单进程无需租约/围栏，用互斥锁保证"每会话至多一个 running"。

### D3 后端抽象：`AgentBackend` trait，两实现

```
                 ┌─────────────────────────────┐
  React ──invoke──▶ Tauri commands（现有 7 个不变）
                 │        │                    │
                 │   AgentBackend (trait)      │
                 │   ┌───────────┬───────────┐ │
                 │   │ ServerBackend          │ LocalBackend      │
                 │   │ (现有 agent_client)    │ (新增本地运行时)  │
                 │   └───────────┴───────────┘ │
                 │        统一 emit('agent:view')│
                 └─────────────────────────────┘
```

- `agent_client.rs` 现有逻辑基本原样收敛为 `ServerBackend`（WS control/node + HTTP + 提醒轮询）。
- 新增 `LocalBackend`：LLM 客户端 + 工具循环 + 本地存储 + 本地提醒检测。
- command 层（`agent_submit` / `agent_view` / `save_agent_settings` / 待办命令）保持签名不变，内部按当前 mode 分发。这满足 `verify-chat-interaction.mjs` 对 `onSend → {requestId, accepted}` 和 `status.connection/model_configured` 语义的假设。

## 2. 模块设计（src-tauri/ 新增）

| 新模块 | 职责 | 对应服务端蓝本 |
|---|---|---|
| `llm/mod.rs` | `LlmConfig{base_url, api_key, model, timeout_secs}`；`OpenAiCompatibleClient`：chat_stream（SSE）+ list_models | `agent_service.py` 的 `ChatOpenAI` 配置面 |
| `llm/sse.rs` | reqwest `bytes_stream()` + eventsource-stream 解析；`[DONE]`/心跳注释/多行 data 处理 | langchain-openai 的 astream |
| `local_agent/runtime.rs` | run 执行器：组装消息 → 模型流式 → 工具循环（≤8 步）→ 终态；错误翻译为固定中文文案 | `agent_service.py::_run_graph` |
| `local_agent/prompts.rs` | `SYSTEM_PROMPT` 逐字拷贝 + 时间上下文注入（默认时区/当前时间/请求接收时间）+ 历史未完成工具记录注入 | `agent_service.py` L26-61 |
| `local_agent/tools.rs` | 4 个待办工具的 JSON Schema（逐字）+ 执行器；业务名/下划线名映射 | `todo_tools.py` |
| `local_agent/store.rs` | 本地持久化：sessions / runs / messages / tool_calls / todos / events（seq 水位）；request_id 幂等 | `runtime_store.py` |
| `local_agent/reminders.rs` | 到期提醒本地扫描（替代 15s 服务端轮询，保留同样的轮询循环形态） | `agent_client.rs` poll_reminders |

改动模块：
- `agent_client.rs` → 拆为 `backend/server.rs`（逻辑搬迁为主）；新增 `backend/mod.rs` 定义 `AgentBackend` trait 与 mode 分发。
- `agent_protocol.rs` → Snapshot/事件类型被 LocalBackend 复用，按需小幅泛化。
- `lib.rs` → 注册状态变更（`AgentState` 持有 `Box<dyn AgentBackend>`）；invoke_handler 不变。
- `AssistantSettings.tsx` / `ChatPanel.tsx` → 仅设置页增加模式选择器与单机表单字段（唯一的前端改动面）。

## 3. 关键实现决策

### 3.1 LLM 客户端：reqwest + eventsource-stream（+1 crate）

- 对比 7 个方案后选型：项目已有 reqwest(json+stream+rustls) + futures-util；只需新增 `eventsource-stream`（2112 万下载，async-openai 内部同款）。async-openai（+27 传递依赖）为次选。
- 自有 serde 类型描述 chat completion chunk，同时抽 `delta.content` 与 `delta.tool_calls`，为工具循环留口。
- `parallel_tool_calls=false`、`max_retries=0` 语义对齐服务端。
- 生成参数（temperature 等）不显式传，与服务端一致用 provider 默认。

### 3.2 TLS / 代理 / 取消 / 超时（风险 R1-R4）

- reqwest feature 从 `rustls-tls` 改为 `rustls-tls-native-roots`（读系统根证书，兼容企业代理 MITM；tokio-tungstenite 已用同名 feature）。
- 代理：reqwest 默认读 `HTTP(S)_PROXY`，不另做 GUI。
- 取消：流循环放 `tauri::async_runtime::spawn` 持 `JoinHandle`（沿用 `agent_client.rs:46` 模式），abort 即取消；切换模式/重新提交时经 generation 机制中止。
- 超时：总 90s（对齐服务端）+ chunk 间 `tokio::time::timeout(30s, stream.next())`。

### 3.3 本地持久化：SQLite（rusqlite bundled）

- 表结构镜像 `server/migrations/002_runtime.sql`（sessions/runs/messages/tool_calls/todos/events），事件与状态变更同事务提交，保留 seq 严格递增语义——投影逻辑与服务端模式完全一致。
- 选 rusqlite（bundled，单文件、零服务）而非 sqlx（编译期宏对 schema 迁移不友好）；不引入 ORM。
- 简化备选：JSON 文件快照 + 原子写入（沿用现有 `persist()` 模式）。若实现期想进一步减依赖可降级，但 seq/幂等/事务语义需自行维护，**不推荐**。

### 3.4 配置与密钥

- `agent-config.json` 扩展为带判别字段的枚举：
  ```json
  { "mode": "server", "server": { "base_url": ..., "token": ..., "session_id": ... },
    "local": { "base_url": ..., "model": ..., "timeout_secs": 90, "timezone": "Asia/Shanghai" } }
  ```
  两套配置共存、切换不覆盖；沿用临时文件+rename 原子写 + 0600。
- `local.api_key` **不落盘**，存 OS 凭据库（`keyring` crate：macOS Keychain / Windows Credential Manager / Linux Secret Service），service 名如 `desktop-ai-pet/local-llm`。
- 环境变量回退：`PET_AGENT_MODEL_BASE_URL/API_KEY/NAME` 作为单机模式默认值（与服务端变量同名，语义对齐；`.env.example` 的 `DESKTOP_AI_PET_*` 遗留命名废弃，实现期清理）。
- `normalized_url()` 安全校验复用于单机 base_url（远程强制 HTTPS，仅回环允许 HTTP）。

### 3.5 模式切换语义

- `save_agent_settings` 扩展为接收完整配置（含 mode）；保存即 `start()` 递增 generation、abort 旧任务、按 mode 构建对应 backend——复用现有防串台机制（`agent_client.rs:368-395`）。
- `AgentView.status` 字段同构映射：
  - server 模式：`connection` = WS 连接状态（现状不变）。
  - local 模式：`connection` = `connected`（本地运行时就绪）/ `disconnected`（未配置）；`model_configured` = 三要素齐全；`node_connected` 概念本地模式恒为无意义，定义为不展示或恒 true，需在实现期按 `pet-live-status.ts:13-35` 的文案表敲定。

### 3.6 行为等价清单（来自调研，共 11 项）

见 `research/server-llm-implementation.md` 末节"Rust 单机模式必须复制的清单"：OpenAI 兼容调用、工具循环、系统提示词、历史窗口、可见文本过滤、持久化事件模型、幂等与终态、待办业务规则、错误面、配置面、可裁剪项。**逐条作为实现期的验收对照表。**

## 4. 数据流（单机模式一轮对话）

```
ChatPanel.submit → invoke('agent_submit', {requestId, text})
  → LocalBackend.submit:
      store 同事务：幂等检查 → insert run(queued) + 两条 message → emit 快照（含 run.accepted 投影）
  → spawn worker：claim → run.started →
      loop ≤8 步:
        llm.chat_stream(messages) → 逐 chunk append_delta → 投影 message.delta → emit('agent:view')
        → 汇总 AIMessage；有 tool_calls → tools 执行（本地 store）→ tool.started/finished 投影 → 回灌 ToolMessage
      → finish_run → run.completed|failed|interrupted → emit
前端：listen('agent:view') → applyView（现有逻辑，零改动）
```

## 5. 裁剪项（单机模式不做）

Bearer 认证与设备角色、node/ws 注册心跳、Redis 唤醒（进程内通知即可）、多 worker 租约围栏（互斥锁替代）、LangGraph 检查点（不参与客户端契约）。

## 6. 兼容性与验证

- 前端/验证脚本零改动是硬约束：`AgentView` 字段语义、`onSend` 签名、`agent:view` 单事件出口保持不变（`desktop-architecture.md` 第 6 节列明了 `verify-chat-interaction.mjs` 的全部假设）。
- `tools/verify-agent-service.py` 仅适用于 server 模式，单机模式需新增对应验证脚本（实现期任务）。
- 文档更新：`docs/ARCHITECTURE.md`（当前标注过时，描述的恰是单机模式）与 `docs/SERVER_AGENT_ARCHITECTURE.md` 需在实现后更新为双模式架构。

## 7. 分阶段实施路线（后续实现任务拆分建议）

| 里程碑 | 范围 | 验收 |
|---|---|---|
| M1 纯聊天 | llm/ + local_agent 运行时（无工具）+ mode 配置 + 设置 UI + 内存/JSON 会话 | 单机模式流式对话可用；双模式切换正常 |
| M2 工具与待办 | SQLite store + 4 工具循环 + 待办命令本地分发 | 含工具对话端到端；重启恢复 |
| M3 完善 | keyring 密钥、本地提醒、错误面打磨、验证脚本、文档更新 | PRD 验收标准全绿 |

## 8. 风险登记（实现期对照）

R1 TLS 根证书 → native-roots；R2 代理 → env proxy；R3 流取消 → JoinHandle abort；R4 双层超时；R5 SSE 边界 → eventsource-stream；R6 base_url 拼接 → trim + list_models 自检；R8 错误体格式不一 → 只依赖状态码；R9 token 高频 IPC → 必要时不改架构做 50ms 微批聚合。（详见 `research/rust-llm-tech-options.md` 第 6 节）

## 9. 开放问题（已确认，2026-09-08）

1. **本地会话历史保留策略**：先无限增长，原样记录；清理/截断策略作为后续优化项，不进本期实现。
2. **模型列表辅助配置**：要。实现 `list_models` 命令（`GET {base_url}/models`，读 `data[].id`），设置页可下拉选择；接口不可用时回退为手输模型名（与 `docs/ARCHITECTURE.md:41-45` 遗留契约一致）。
3. **待办数据**：两种模式完全独立，不做导出/导入。
