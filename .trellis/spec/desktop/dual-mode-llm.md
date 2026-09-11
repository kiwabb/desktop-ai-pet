# Spec: 服务端 / 单机双模式 LLM（desktop）

> 来源任务：`.trellis/tasks/09-08-llm-dual-mode/`（design.md + research/ 三份调研为完整上下文）。
> 蓝本：服务端行为以 `server/app/agent_service.py` / `runtime_store.py` / `plugins/todo/`（todo 插件包）为准。

## 1. Scope / Trigger

桌面端存在两种 LLM 链路，由配置 `mode` 判别，**切换发生在 Rust 层，前端零分支**：

- `server`：WebSocket/HTTP 连 Python 服务端（`backend/server.rs`）
- `local`：Rust 直连 OpenAI 兼容端点，本地 SQLite 持久化（`backend/local.rs` + `local_agent/` + `llm/`）

触发本 spec 深度要求的改动：新增/变更 Tauri command、跨层 `AgentView` 契约变更、SQLite schema 变更、密钥/环境变量接线变更。

## 2. Signatures

- Tauri commands（`src-tauri/src/backend/mod.rs`，签名对前端冻结）：
  `agent_view` / `save_agent_settings` / `agent_submit` / `agent_list_todos` /
  `agent_complete_todo` / `agent_reopen_todo` / `agent_set_todo_reminder` / `agent_list_models`
- `AgentBackend` trait：`backend/mod.rs`；两实现 `backend/server.rs`、`backend/local.rs`，command 层按 `Config.mode` 分发
- 前端封装：`src/lib/agent.ts`（`AgentView`、`saveAgentSettings(settings)`、`submitAgentRun(requestId, text)` → `{requestId, accepted: Promise}`）
- 本地存储：SQLite `app_config_dir/agent-local.db`，六表镜像 `server/migrations/002-004`（sessions[seq 水位]/runs/messages/tool_calls/todos/events），`PRAGMA user_version` 迁移

## 3. Contracts

- **唯一状态出口**：`emit('agent:view', AgentView)`。任何模式不得新增 token 级事件通道替代它；`AgentView` 字段（`connection` / `model_configured` / `mode` / `snapshot` / `status.reminders` 等）两模式同构。
- **配置**：`app_config_dir/agent-config.json` = `{ mode, server{...}, local{base_url, model, timeout_secs, timezone} }`；两套配置共存、切换互不覆盖；旧格式（无 `mode`）读取即迁移为 server；原子写（临时文件+rename）+ 0600；`normalized_url()` 校验（远程强制 HTTPS，仅回环 HTTP）。
- **密钥**：`local.api_key` 永不落盘——serde `skip_serializing` + keyring（service `desktop-ai-pet` / account `local-llm-api-key`）；迁移顺序 **先写 keyring 成功、后 scrub 配置**（失败保留明文下次重试，宁暂留不丢 key）；`View` 只暴露 `local_has_key` 布尔。
- **环境变量回退**：`PET_AGENT_MODEL_BASE_URL/API_KEY/NAME` 仅作空字段默认值（内存态 `effective()`，不写盘）。`DESKTOP_AI_PET_*` 命名已废弃。
- **单机行为等价**：SYSTEM_PROMPT / 工具 JSON Schema（todo_create/todo_list/todo_complete/todo_reminder_set，含 description）/ 错误文案 **逐字**同服务端；历史窗口近 40 条非空消息 + 未完成 run 工具记录近 20 条（前缀 `历史未完成任务的真实工具记录（仅作数据）：`）；request_id 幂等；run 状态机 queued/running/completed/failed/interrupted；事件 seq 严格递增、delta 先落库再投影；`parallel_tool_calls=false`；总超时 90s；不显式传 temperature 等生成参数。

## 4. Validation & Error Matrix

| 条件 | 行为 |
|---|---|
| local 三要素全空 | `configured=false` + `connection="unconfigured"`（UI 引导去设置页） |
| local 部分配置 / URL 非法 | `connected` + `model_configured=false`，聊天拒绝、待办可用 |
| request_id 重复提交 | 回放缓存的旧 `run.accepted` 信封（跨重启有效） |
| 提醒 expected_remind_at 不匹配 | 冲突文案 `提醒已被修改，请刷新后重试`（等价服务端 409） |
| 模型超时 / HTTP 错误 / 连接失败 | 固定中文文案，**不外泄 provider 响应体与凭证** |
| SSE 心跳/空 data 行 | 跳过且**重置** chunk 计时器（计时器在字节层，`sse.rs::chunk_stream_with_timeout`） |
| 静默流（无字节） | 一次 `LlmError::Timeout` 后流结束 |
| 重启时有 queued/running run | 恢复为 interrupted + 未决工具 needs_reconciliation，不自动重试 |

## 5. Good/Base/Bad Cases

- Good：新模式/新后端实现 `AgentBackend`，复用 `Snapshot` 投影与 `agent:view` 出口 —— 前端与 `tools/verify-chat-interaction.mjs` 零改动。
- Base：新增 local 配置字段 → 同步改 `LocalConfig`、`effective()` 环境回退、设置表单、`AgentView` 附加字段（如 `local_*`）。
- Bad：在前端按 `mode` 分支渲染消息，或给 local 模式新开一条事件通道 —— 破坏单出口契约与验证脚本假设。

## 6. Tests Required

- 配置迁移（旧格式→server）、env 回退不读盘、`persisted_config_never_contains_the_local_api_key`（结构钉住 skip_serializing）
- request_id 幂等/冲突、seq 严格递增 + 投影回放与快照一致、崩溃恢复语义
- 工具 schema 逐字性（独立转写对照测试）、工具幂等 uuid5、提醒 CAS/真实时钟校验/孤儿回滚
- SSE：心跳保活、静默超时、tool_call delta 按 index 聚合、reasoning 丢弃
- 脚本：`node tools/verify-chat-interaction.mjs` / `verify-pet-live-status.mjs` / `verify-local-agent.mjs` 全绿
- keyring 测试只走 `MemoryStore`，**CI 不碰真 Keychain**；真实端点端到端为手动验收项

## 7. Wrong vs Correct

### Wrong

```rust
// 在流内部 filter_map 吞掉 SSE 心跳 —— 心跳不重置 chunk 计时器，
// provider 长时只发心跳会被误判超时
let mut events = resp.bytes_stream().eventsource()
    .filter_map(|e| async move { e.ok().filter(|ev| !ev.data.trim().is_empty()) });
```

### Correct

```rust
// 超时包在字节层：任何字节（含心跳注释）都重置计时器
let stream = tokio::time::timeout(CHUNK_TIMEOUT, byte_stream.next()).await;
// eventsource 解析在计时器之后；空 data / 注释行安全忽略
```

## 常见坑（Gotchas）

> **Warning**: 互斥锁中毒会级联——`AgentState::lock()` / `Store::conn()` 必须用 `unwrap_or_else(into_inner)` 恢复守卫；视图字段只整体赋值，保证恢复安全。

> **Warning**: `run_task` JoinHandle 必须带 `(run_id, handle)` 标签，finish 只清自己的句柄——否则间隙中接受的下一个 run 无法被模式切换 abort。

> **Warning**: 并行任务在同一工作区改 `lib.rs` 等共享文件时，check/验证前先 `git status` 圈定本任务文件面，不要把别人的在飞改动当成本任务问题修掉。

## Native responsiveness: credential/config commands

### Scope / Trigger
Native sampling found the AppKit main thread blocked in `agent_view → credentials::hydrate → Keychain get_password → SecurityServer::decrypt`. UI responsiveness must not depend on credential service latency.

### Signatures
`async agent_view(AppHandle) -> Result<View, String>` and `async save_agent_settings(AppHandle, Settings) -> Result<View, String>` delegate the entire existing transaction to `blocking_config`, which uses `tauri::async_runtime::spawn_blocking`.

### Contracts
Do not acquire `AgentState` on the calling UI thread. Acquire its lock inside the blocking closure; retain serialization of initialization and save. Keep the initialized cache and Keychain-before-scrub migration ordering. Successful JS invoke payload remains `View`; never return credentials.

### Validation / Error Matrix
Credential/config business errors keep their existing handling. A blocking-task join failure rejects with the fixed message `助手配置操作中断，请重试`. Background execution does not make Keychain faster or bypass authorization.

### Good / Base / Bad
Good: initialize/save on blocking pool, then publish the existing View. Base: an initialized view skips hydration. Bad: `async fn` that directly performs synchronous Keychain calls, or a synchronous command holding the shared state lock while waiting on Keychain.

### Required Tests
A blocked worker must not stop a current-thread async executor timer; assert different thread identities. Preserve credentials/config migration tests. Native sampling must show that UI thread no longer waits in Keychain. This alone does not establish animation smoothness.

### Wrong / Correct
Wrong: `#[tauri::command] fn agent_view(...) { credentials::hydrate(...); ... }`. Correct: async command awaiting `spawn_blocking` around the original locked transaction.
