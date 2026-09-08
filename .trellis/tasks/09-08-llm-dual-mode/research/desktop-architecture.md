# Research: 桌面端当前架构（LLM 双模式改造背景）

- Query: 记录当前桌面侧（src-tauri/ Rust + src/ React）与"单机直连 LLM 模式"相关的架构现状
- Scope: internal
- Date: 2026-09-08

## 核心结论（速览）

1. **前端从不直接调用 Python 服务**。所有服务通信都在 Rust 层（`agent_client.rs`），前端只通过 `invoke()` + `listen('agent:view')` 与 Rust 交互。因此"模式切换"天然应该落在 Rust 层，前端只需扩展设置 UI。
2. **Rust 已具备直连 LLM 所需的全部网络依赖**：`reqwest`（含 `json`、`stream`、`rustls-tls`）和 `tokio` 已在 `Cargo.toml:16-23`；当前用 reqwest 做 HTTP REST、tokio-tungstenite 做 WebSocket。SSE 流式消费可用 `reqwest` 的 `stream` feature 实现，无需新增依赖。
3. **存在一套"桌面直连模型"的历史遗留契约，从未在 Rust 实现**：`src/lib/ai.ts`（无任何人 import，死代码）定义了 `ai_status` / `save_ai_settings` / `list_ai_models` / `stream_chat` 四个 command 和 `AiStreamEvent { requestId, kind: 'chunk'|'done', content }`；`.env.example` 定义了 `DESKTOP_AI_PET_BASE_URL/API_KEY/MODEL` 三个由 Rust 进程读取的环境变量；`docs/ARCHITECTURE.md:41-45` 仍描述这一直连方案（OpenAI-compatible SSE + `GET /models` + 0600 权限保存 API Key）。git 历史中不存在 `src-tauri/src/ai.rs`。这套遗留契约可作为单机模式设计的起点，但其事件模型与现行快照协议完全不同（见"差距"）。
4. **当前聊天链路**（`docs/SERVER_AGENT_ARCHITECTURE.md:22` 确认）：`src/App.tsx → src/lib/agent.ts → src-tauri/src/agent_client.rs → server/app/main.py → server/app/agent_service.py`。Python 服务端用 LangGraph + `ChatOpenAI` 调模型（`server/app/agent_service.py:136-138`、`266-271`），模型配置在服务端环境变量 `PET_AGENT_*`（`server/app/config.py:9-16`）。

## src-tauri/ 模块地图

| 文件 | 职责 |
|---|---|
| `src-tauri/src/main.rs:1-3` | 仅调用 `desktop_ai_pet_lib::run()` |
| `src-tauri/src/lib.rs` | 窗口/面板管理、位置持久化、窗口尺寸模式；`run()` 在 `lib.rs:404-448` |
| `src-tauri/src/agent_client.rs` | 与 Python 服务的全部通信：HTTP REST（待办/提醒/状态）+ 两条 WebSocket（control/node）+ 配置持久化 + 状态机 |
| `src-tauri/src/agent_protocol.rs` | 会话快照协议类型（`Snapshot`/`Envelope`）与增量应用逻辑 |
| `src-tauri/Cargo.toml:15-26` | 依赖：tauri 2（macos-private-api）、reqwest 0.12（json+stream+rustls）、tokio、tokio-tungstenite、serde、uuid、futures-util、tauri-nspanel（仅 macOS） |
| `src-tauri/tauri.conf.json` | 双窗口（`main` 232×380.9、`chat` 360×164，均无边框透明置顶）；CSP `connect-src 'self' ipc:`（`tauri.conf.json:47`）——webview 不允许直接发 HTTP，直连必须由 Rust 做 |
| `src-tauri/capabilities/default.json` | 仅 core:default + window 权限；无 http/shell/store 插件权限 |

### 已注册的 #[tauri::command]（`lib.rs:431-445`）

来自 `agent_client.rs`：`agent_view`（:435）、`save_agent_settings`（:455）、`agent_submit`（:484）、`agent_list_todos`（:294）、`agent_complete_todo`（:135）、`agent_reopen_todo`（:143）、`agent_set_todo_reminder`（:211）。
来自 `lib.rs`：`save_pet_position`（:179）、`reset_pet_position`（:199）、`quit_app`（:216）、`set_pet_chat_mode`（:280）、`set_chat_window_expanded`（:397）、`show_chat_window`（:368）。

### Rust 状态管理（可复用的模式）

- 全局状态：`AgentState(Mutex<Inner>)`，通过 `Builder::manage()` 注册（`lib.rs:405`），command 内 `app.state::<AgentState>()` 获取（如 `agent_client.rs:155`）。
- **generation/revision 机制**：每次保存配置 `start()` 递增 `view.generation`（`agent_client.rs:368-395`），中止旧任务（`task.abort()`）；所有异步回调先校验 generation 再落状态。这是切换配置/模式时防止串台的现成范式。
- **事件推送**：状态变更统一 `app.emit("agent:view", &inner.view)`（如 :181、:287、:366、:481）。前端通过 generation/revision 丢弃过期事件。
- **配置持久化**：`app_config_dir()/agent-config.json`（`path()` :327-333），临时文件 + rename 原子写入，Unix 下 0600 权限（`persist()` :334-357）。桌宠位置另有 `pet-position.json`（`lib.rs:55`）。
- **URL 安全校验**：`normalized_url()`（:309-326）强制远程 HTTPS、仅回环允许 HTTP、禁止凭证/查询参数。
- **后台任务**：`start()` 里 `tokio::join!` 三路并发（control 重连循环 :396、node 重连循环 :418、提醒轮询 :273），重连退避 1s→15s。

### Rust 现有的 HTTP/LLM 相关工作

- HTTP 调用已有：`GET /v1/status`（:556）、`GET /v1/todos[/reminders/due]`（:229-252）、`POST /v1/todos/{id}/complete|reopen`（:104-133）、`PUT /v1/todos/{id}/reminder`（:186-209）。统一模式：`reqwest::Client::builder().redirect(Policy::none()).timeout(15s)` + `bearer_auth` + 显式状态码/响应体校验，错误信息不含上游响应体细节（防泄密）。
- **没有任何直接调用 LLM provider 的代码**。聊天 token 流不走 SSE——服务端把 LangGraph `astream` 的 chunk 落库后经 WebSocket `message.delta` 事件推送（`server/app/agent_service.py:266-271` → `agent_protocol.rs:112-121` 逐段 append 到 `message.content`）。

## src/ 前端模块地图

### src/lib/

| 文件 | 职责 |
|---|---|
| `src/lib/agent.ts` | **唯一活着的 API 层**。全部经 `invoke()`：`getAgentView()`（:84）、`saveAgentSettings(baseUrl, token)`（:87）、`submitAgentRun(requestId, text)`（:90）、`listTodos/completeTodo/reopenTodo/setTodoReminder`（:16-32）。类型 `AgentView`（:55-76）与 Rust `View` 一一对应。`connectionLabel()`（:77-82）把连接状态映射为 UI 文案 |
| `src/lib/ai.ts` | **死代码**（无任何 import）。遗留的直连 LLM 契约：`getAiStatus/saveAiSettings/listAiModels/streamChat`（:26-51），`AiStreamEvent { requestId, kind: 'chunk'\|'done', content }`（:20-24）。对应 command 未在 Rust 注册 |
| `src/lib/chat-interaction.ts` | 纯函数：IME 组合输入判定 `shouldSubmitComposer`（:13）、滚动跟随阈值 `isNearChatBottom`（:19）、消息 URL 白名单 `safeMessageUrl`（:26） |
| `src/lib/pet-live-status.ts` | `getPetLiveStatus(view, petState)` 把 `AgentView` 连接状态映射为桌宠气泡文案（:13-35） |
| `src/lib/pet-state.ts`、`pet-2d-renderer.ts`、`todo-tool-presentation.ts` | 宠物状态机类型、PNG 渲染器、待办工具展示映射 |

### src/components/（聊天相关）

| 文件 | 职责 |
|---|---|
| `src/components/ChatPanel.tsx` | 聊天面板总装：输入框/发送（`submit` :176-204）、设置页开关（`openSettings` :212）、待办页开关、消息列表渲染、工具调用结果展示（:365-374）。持有 `baseUrl`/`apiKey` 表单 state（:57-58），默认 `http://127.0.0.1:18081` |
| `src/components/AssistantSettings.tsx` | 设置表单：服务地址 + 设备凭证两个字段（:37-48），模型只读展示（"由服务端配置和管理"，:49-53）。**这就是模式切换 UI 的自然落点** |
| `src/components/MessageContent.tsx` | Markdown 渲染（react-markdown + remark-gfm），链接经 `safeMessageUrl` 过滤 |
| `src/components/useChatReading.ts` | 滚动跟随/"回到最新"按钮逻辑 |
| `src/components/TodoList.tsx`、`TodoReminders.tsx` | 待办列表（用 `listTodos` 等 command）、提醒横幅（读 `status.reminders`） |
| `src/components/ChatBubbleFrame.tsx`、`ChatBubbleShell.tsx`、`PetStage.tsx`、`PetLiveStatus.tsx` | 气泡框外壳与桌宠舞台，与 LLM 链路无关 |

## 前端 ↔ 服务端集成点（当前实际链路）

前端 **从未** 直接连 Python 服务；集成点是前端 ↔ Rust IPC：

1. **初始化/状态同步**：`src/App.tsx:96-104` —— `listen<AgentView>('agent:view', ...)` 订阅推送 + `getAgentView()` 拉取当前快照；revision 校验丢弃乱序 IPC 响应（:67）。
2. **发送消息**：`App.tsx:387-414` `handleSend()` → `submitAgentRun(requestId, text)`（`lib/agent.ts:90` → command `agent_submit`）。`requestId` 是 UUID 幂等键；`agent_submit` 阻塞等待服务端 ack（12s 超时，`agent_client.rs:508`），未 ack 的重试复用同一 requestId 不重复提交。
3. **流式渲染**：Rust 收到 WebSocket `message.delta` 后 append 进 `Snapshot.messages[].content` 并 `emit('agent:view')`（`agent_client.rs:620-636`）；前端 `applyView`（`App.tsx:64-95`）把 `view.snapshot.messages` 整体映射为 `UiMessage[]`（:81-85），`pending` 由 run 状态推导。**事件名只有一个 `agent:view`，没有独立的 token 事件**；"流式"是快照增量反复推送。桌宠气泡取最新 assistant 消息末尾 140 字（:88-93）。
4. **设置保存**：`ChatPanel.tsx:158-174` `submitSettings()` → `saveAgentSettings(baseUrl, apiKey)` → Rust 校验 + 持久化 + 重启连接（`agent_client.rs:455-483`）。
5. **待办**：`TodoList.tsx` 直接 `invoke` 待办 command；提醒由 Rust 15s 轮询后经 `agent:view` 下发（`agent_client.rs:273-292`）。
6. **跨窗口事件**（前端 emit，不经 Rust）：`pet:state`（`App.tsx:373`）、`chat:mode`（:301）。

### 运行模式/配置现状

- **当前没有任何模式切换/feature flag 机制**。唯一的"配置"就是 `agent-config.json`（base_url + token + session_id）。
- 服务地址在前端仅作为表单默认值（`ChatPanel.tsx:57`），真正的配置源是 Rust 持久化文件。
- `.env.example` 的 `DESKTOP_AI_PET_*` 变量当前没有任何代码读取（grep 无匹配），纯遗留。
- `vite.config.ts` 无代理/环境注入；CSP 禁止 webview 外联（`tauri.conf.json:47`）。

## 工具脚本假设的契约

| 脚本 | 假设的契约 |
|---|---|
| `tools/verify-chat-interaction.mjs` | 纯前端静态回归：IME/滚动/URL 过滤纯函数（:8-23）；用 TypeScript AST 从 `ChatPanel.tsx` 抽取真实 `submit`/`acknowledgeSubmission` 本地执行（:28-76），假设 `onSend` 返回 `{ requestId, accepted: Promise }` 签名（:52）、`status.connection === 'connected'` 且 `model_configured` 才可发送（:51）；SSR 渲染真实 `MessageContent` 验证 XSS 过滤与 Markdown（:100-108）。**单机模式必须保持 `ChatPanel` 的 `onSend` 签名和 `AgentView` 的 connection/model_configured 字段语义，否则此脚本失效** |
| `tools/verify-agent-service.py` | 针对 Python 服务端的真实端到端验证：`GET /health`、`GET /v1/status`（断言 `model_configured`）、401/403 鉴权检查、WebSocket 对话（:44-60）。仅适用于 server 模式 |
| `server/app/main.py:79-218` | 服务端 HTTP/WS 端点全集：`/v1/status`、`/v1/sessions`、`/v1/todos*`、`/v1/control/ws`、`/v1/node/ws` |

## docs/ARCHITECTURE.md 相关段落

- `ARCHITECTURE.md:3` 顶部已注明：本文保留"桌面直连模型"的原有架构说明，服务端智能体方向见 SERVER_AGENT_ARCHITECTURE.md。
- `ARCHITECTURE.md:15-16` 运行边界图仍列着 Rust 层"本地模型配置 + OpenAI-compatible SSE 请求"——**描述的正是本任务要实现的单机模式**，但对应 Rust 代码不存在（从未提交过）。
- `ARCHITECTURE.md:41-45` AI 配置节：设置页经 IPC 把 API Key 交 Rust，写应用配置目录并设 0600；设置页调 `GET /models` 读 `data[].id`，接口不可用时允许手输模型名。与 `src/lib/ai.ts` 的 `saveAiSettings`/`listAiModels` 契约吻合。
- `ARCHITECTURE.md:49-52` 状态转换：`thinking → talking → happy/error` 由流式 token 驱动——当前实现已由 `AgentView` 的 run 状态驱动（`App.tsx:79-94`），不依赖 token 事件。
- `docs/SERVER_AGENT_ARCHITECTURE.md:22` 明确当前链路为 server 模式；决策 D01-D12 确认智能体核心在服务端。

## 模式切换的自然落点（建议参考，非实现）

1. **Rust 配置结构**：`agent_client.rs:13-18` 的 `Config { base_url, token, session_id }` 可扩展为带 `mode: "server" | "local"` 判别字段的枚举；`normalized_url()` 校验、0600 持久化、generation 重启机制全部可复用。单机模式需要新增 provider base_url / api_key / model 三字段（`.env.example` 与 `ai.ts` 已给出命名先例）。
2. **Rust 命令层**：`save_agent_settings` / `agent_submit` / `agent_view` 三个 command 是前端唯一入口，可在此按 mode 分发；或者复活 `ai.ts` 的四个 command 并在前端按 mode 选择。
3. **前端设置 UI**：`AssistantSettings.tsx` 当前只有"服务地址 + 设备凭证"（:37-48），模式选择器（如 segmented control）加在这里；`ChatPanel.tsx:57-58` 的表单 state 相应扩展。
4. **状态呈现**：`AgentView.connection` / `model_configured` / `connectionLabel()`（`agent.ts:77-82`）与 `pet-live-status.ts:13-35` 已把"连接状态→文案"收敛在两处，单机模式只需让 Rust 侧的 `View` 在本地模式下产出同构字段（如本地模式无 `node_connected` 概念，需定义其语义）。

## 差距：Rust 侧直连 LLM 目前缺什么

1. **无 LLM 客户端代码**：没有 chat completions 请求构造、SSE 解析（`reqwest` `stream` feature 已可用，但无任何代码消费 SSE）、模型列表请求。`ai.ts`/`.env.example` 只是契约残影。
2. **无本地会话/消息持久化**：当前消息历史完全由服务端快照下发（`session.snapshot` 事件，`agent_protocol.rs:78-87`）。单机模式需要本地存储会话（或可接受内存态），并向前端产出与 `Snapshot` 同构的数据，否则 `ChatPanel`/`App.tsx` 的消息渲染、`verify-chat-interaction.mjs` 的假设都要改。
3. **无本地流式事件通道**：当前 `message.delta` 是 WebSocket 信封内的持久事件，经快照合并后以 `agent:view` 全量推送。直连时可选择 (a) 复用同一快照投影（Rust 本地维护 `Snapshot` 并 emit `agent:view`，前端零改动）或 (b) 复活 `AiStreamEvent` chunk/done 事件（前端需改）。
4. **无工具调用能力**：服务端 LangGraph 有 todo 工具循环（`agent_service.py:295-300`）；单机模式若要待办工具，需要在 Rust 重新实现工具循环和本地待办存储——当前 Rust 的待办 command 全部代理到服务端 HTTP。
5. **无设备凭证→API Key 的双套秘密管理**：`persist()` 只存一种配置；单机模式的 API Key 需要同等级（0600）存储，且与 server 模式配置共存或互斥的策略未定。
6. **CSP 无需改动**：直连由 Rust 发起，`tauri.conf.json:47` 的 `connect-src 'self' ipc:` 不构成阻碍；若误选前端直连方案则会被 CSP 拦死。
7. **提醒轮询依赖服务端**：`poll_reminders` 拉 `/v1/todos/reminders/due`（`agent_client.rs:236`），单机模式下无对应数据源。

## Caveats / Not Found

- `src/lib/ai.ts` 是否曾经在工作区有过配套 Rust 实现无法确认（git 历史中无 `ai.rs`，可能在首次提交前被删除）。
- 未深入 `src/components/PetStage.tsx`/`pet-2d-renderer.ts`（与 LLM 链路无关）。
- 服务端 WebSocket 信封协议细节仅读了客户端投影侧（`agent_protocol.rs`）；服务端发送侧在 `server/app/main.py:154-217` 与 `runtime_store.py`，如需对齐协议需另开研究。
