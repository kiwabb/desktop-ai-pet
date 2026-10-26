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
- **单机行为等价**：SYSTEM_PROMPT / 既有业务工具 JSON Schema（todo/memo，含 description；单机额外注册只读 local_history_search）/ 错误文案 **逐字**同服务端；上下文策略按 [Local context](local-context.md) 执行估算预算、完整轮次、增量摘要和只读历史查询；本次单机先行，服务端仍保留原近 40 条消息策略；未完成 run 工具记录近 20 条独立保留；request_id 幂等；run 状态机 queued/running/completed/failed/interrupted；事件 seq 严格递增、delta 先落库再投影；`parallel_tool_calls=false`；总超时 90s；不显式传 temperature 等生成参数。

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
`async agent_view(AppHandle) -> Result<View, String>` and `async save_agent_settings(AppHandle, Settings) -> Result<View, String>` delegate the existing transaction to `blocking_config`, which uses `tauri::async_runtime::spawn_blocking`.

`credentials::hydrate_startup(Mode, &mut LocalConfig, &impl CredentialStore) -> bool` hydrates active local credentials or migrates legacy plaintext; its boolean means a durable migration permits a scrubbed rewrite. `credentials::load_saved_key(&LocalConfig, &impl CredentialStore) -> Result<String, String>` is used by explicit local settings/model-list actions. `async agent_list_models(AppHandle, String, String) -> Result<Vec<String>, String>` captures local config plus generation, resolves credentials on the blocking pool outside `AgentState`, rejects a changed generation, then calls the existing HTTP model-list function.

### Contracts
Do not acquire `AgentState` on the calling UI thread. Acquire its lock inside the blocking closure; retain serialization of initialization and save. Keep the initialized cache and Keychain-before-scrub migration ordering. Successful JS invoke payload remains `View`; never return credentials.

- A saved **server** configuration with no legacy plaintext must perform zero reads of the inactive local credential store. A background worker alone does not solve startup: waiting while holding `AgentState` still prevents server initialization and both windows' views. The inactive `local_has_key` value reflects only the loaded memory state; it must not trigger a credential read merely to populate metadata.
- Active local startup retains existing hydration and environment fallback. Explicit same-endpoint local saves or model-list actions lazily recover the stored key; fresh input does not read the old key; a different endpoint does not inherit it. A failed credential deletion rejects the endpoint change before config persistence.
- `Config::parse` marks a legacy plaintext key with the nonserialized `local_key_migration_pending` flag. A successful startup migration clears it. Failed migration keeps it across config clones. Every filesystem write passes through `persist_at`, which refuses pending configs **before creating a temporary file or rewriting the existing file**. This includes automatic server session snapshots, not only the initial scrub attempt.
- An explicit settings save retries pending migration. Blank same-endpoint local input still needs a successful store write; copying the in-memory plaintext cannot clear the flag. An explicit replacement key clears it only after a successful store write; an explicit endpoint change without a replacement clears it only after successful credential removal. No path serializes plaintext as a fallback.
- Model-list credential reads hold no `AgentState` guard. Recheck the captured generation after the lookup and before issuing HTTP, because settings can replace the shared credential entry while the lookup waits. No extra frontend or model protocol is introduced.

### Validation / Error Matrix
Credential/config business errors keep their existing handling. A blocking-task join failure rejects with the fixed message `助手配置操作中断，请重试`. Background execution does not make Keychain faster or bypass authorization.

| Condition | Result |
|---|---|
| Server startup, inactive local key encrypted | Skip credential read; initialize server backend normally |
| Explicit local key read denied/unavailable | Reject the action with the credential-store error; no request with an invented key |
| Settings generation changes during model-list lookup | Reject with `助手配置已更换，请重新获取模型列表` before HTTP |
| Legacy migration failed, any later config persistence | Refuse with `本地 API Key 尚未迁移到系统凭据存储，请在助手设置中重新保存后重试`; original file remains intact |
| Pending legacy migration retried successfully by save | Persist scrubbed config normally, retaining both mode sections |
| Old key deletion denied on endpoint change | Reject save; do not persist the new endpoint |

### Good / Base / Bad
Good: initialize/save on blocking pool, then publish the existing View. Base: an initialized view skips hydration. Bad: `async fn` that directly performs synchronous Keychain calls, or a synchronous command holding the shared state lock while waiting on Keychain.

### Required Tests
A blocked worker must not stop a current-thread async executor timer; assert different thread identities. Assert server startup cannot call an inactive store's `get`; preserve local hydration and legacy migration tests. Verify same-endpoint lazy reuse, different-endpoint isolation, explicit-key precedence, denied deletion and denied lookup. Simulate a generation change inside credential lookup and assert rejection before a request can use the resolved key. Use a disposable unit config file to verify failed migration plus later snapshot/save persistence leaves the original bytes intact and creates no temporary file; after an explicit successful retry, assert neither plaintext nor the migration flag is serialized. All credential tests use in-memory stores; never read real credentials.

Native cold server startup must show both windows receive a view and the backend begins its real connection flow without an unrelated local credential prompt. Pure tests do not establish real connectivity or animation smoothness. Pre-existing atomicity between a fresh credential-store write and a subsequently failing config-file write is outside this startup change; the single-entry credential-store design is unchanged.

### Wrong / Correct
Wrong: `#[tauri::command] fn agent_view(...) { credentials::hydrate(...); ... }`. Correct: async command awaiting `spawn_blocking` around the original locked transaction.

## Electron/Pi runtime boundary (migration)

### 1. Scope / Trigger

This contract applies to the new Electron host adapter under
`apps/desktop/src/main/` and `apps/desktop/src/shared/`. It is triggered by the
Pi subprocess choice and covers the cross-layer boundary between a renderer-facing
run service and the Pi RPC transport. It does not replace the existing Tauri
backend, persistence, credential storage, or server mode.

### 2. Signatures

```ts
interface AgentRunRequest {
  sessionId: string
  runId: string
  requestId: string
  prompt: string
  streamingBehavior?: 'steer' | 'followUp'
}

class PiAgentRuntime {
  submit(request: AgentRunRequest): Promise<AgentRunAcceptedEvent>
  cancel(sessionId: string, runId: string): Promise<AgentRunCancelRequestedEvent>
  onEvent(listener: (event: AgentRunEvent) => void): () => void
  dispose(): void
}
```

The transport must expose typed `prompt`, `abort`, `onRecord`, and `onExit`
operations. Pi wire records stay host-side; renderers receive `AgentRunEvent` only.

### 3. Contracts

- `sessionId`, `runId`, `requestId`, and `prompt` are non-empty strings.
- A request identity is the tuple `(sessionId, runId, requestId, prompt,
  streamingBehavior)`. Re-submitting the exact same identity returns the original
  acceptance promise and sends no second prompt.
- A `runId` or `requestId` cannot be rebound to a different identity. In particular,
  reusing a `runId` with another `requestId` is rejected.
- Acceptance emits `run.accepted` with the Pi disposition and does not imply that
  model work has completed. Completion is a separate `run.settled` event.
- Every emitted event has a host-owned, strictly increasing `sequence` beginning at
  1. Pi records observed before prompt acceptance are buffered and emitted after the
  acceptance event.
- Only one non-settled Pi run is active. `cancel` first awaits a successful Pi
  `abort` response; only then may a buffered `agent_settled` record produce the
  cancellation event.
- Pi `agent_settled` has no run ID. The first run may attribute it directly; later
  runs require a fresh `agent_start` fence so a late settlement cannot complete the
  next run.
- Child exit before settlement produces `run.settled` with `outcome: 'failed'` and
  an explicit exit error. No prompt or tool is replayed automatically.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Empty session/run/request/prompt field | Reject before invoking Pi |
| Same request identity submitted twice | Return the original acceptance; one Pi prompt |
| Same request ID with different payload | Reject as a rebound identity |
| Same run ID with different request ID | Reject as a rebound identity |
| Another run submitted while one is active | Reject; do not queue implicitly |
| Cancel before prompt acceptance | Reject; caller must wait for `run.accepted` |
| Pi abort rejected | Reject cancellation and restore the accepted state |
| Settlement before abort response | Buffer it; attribute it only after abort acceptance |
| Late settlement without a new `agent_start` | Ignore for a later run |
| Pi process exits before settlement | Emit one failed settlement with exit details |

### 5. Good / Base / Bad Cases

- Good: persist or project the accepted request in an application service, subscribe
  to ordered `run.record` and `run.settled` events, and reconcile after a sequence
  gap from authoritative storage once persistence exists.
- Base: use the injected fake transport to test acceptance, stream records, settle,
  cancel, duplicate identity, and child exit without claiming a live model run.
- Bad: resolve `submit()` only after `agent_settled`, infer completion from a prompt
  response, or attribute the first settlement after every new prompt without a
  start fence.

### 6. Tests Required

- Assert empty identity fields are rejected before `prompt` is called.
- Assert exact duplicate requests call `prompt` once and return the same acceptance.
- Assert conflicting `requestId` and `runId` reuse is rejected.
- Assert event types and sequences are
  `run.accepted -> run.record* -> run.settled`.
- Assert late settlement is ignored until a new `agent_start` is observed.
- Assert cancellation emits `run.cancel_requested` only after a successful abort and
  emits one cancelled settlement after Pi confirms termination.
- Assert rejected abort restores the active run and does not publish cancellation.
- Assert child exit emits one failed settlement and no automatic retry.
- Keep fake-transport checks separate from real Pi/model and native Electron checks.

### 7. Wrong vs Correct

#### Wrong

```ts
// `agent_settled` has no run ID, so this can complete a newer run with an old event.
transport.onRecord((record) => {
  if (record.type === 'agent_settled') finish(activeRun)
})
```

#### Correct

```ts
// After the first run, require a new Pi start boundary before attribution.
if (record.type === 'agent_settled' && (!run.requireStartFence || run.started)) {
  emitSettled(run, record.aborted ? 'cancelled' : 'completed')
}
```

## Cindy source import boundary (migration)

### 1. Scope / Trigger

This contract applies before importing any source from the pinned Cindy checkout
into `apps/desktop/`. It is triggered by the Electron UI migration and prevents a
visual source reuse request from silently importing Cindy's host services, accounts,
credentials, telemetry, or remote integrations.

### 2. Signatures

Every copied file must have one manifest record before it is committed:

```ts
interface SourceImportRecord {
  sourceRepo: 'makecindy/cindy'
  sourceCommit: string
  sourcePath: string
  destinationPath: string
  sha256: string
  license: string
  importReason: string
  adaptation: 'unchanged' | 'product-adapter' | 'deferred'
  status: 'copied' | 'excluded' | 'rejected'
}
```

The manifest is committed with the source-import diff. The external checkout is
an audit input only; no build, runtime, or package script may resolve it by its
absolute path.

### 3. Contracts

- `sourceCommit` must resolve to the pinned Cindy commit selected by the task.
- `sourcePath` must exist in that commit and `sha256` must match the copied bytes.
- `destinationPath` must be inside the product's reviewed import boundary.
- Root license, root notice, and required third-party notices must be retained or
  explicitly recorded as unresolved before distribution.
- Cindy's broad preload and Electron bootstrap are not compatibility layers. Each
  renderer call maps to a product-owned, allowlisted service and handler.
- Pet renderer code cannot import the Cindy main renderer graph or receive its
  credentials/full conversation bodies.
- Excluded capabilities must return the product's explicit unavailable/error state;
  they must not return fake success merely because a UI component was copied.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Source path or commit cannot be resolved | Reject the import; do not copy bytes |
| SHA-256 differs after copy | Reject the import and remove only the staged copy |
| Destination is outside the reviewed product boundary | Reject the import |
| License/notice ownership is unknown | Defer the file; do not package it |
| Import reaches broad preload/bootstrap without a method mapping | Reject wholesale reuse; split into reviewed adapters |
| File contains an absolute reference to the external checkout | Reject and fix the adaptation |
| Deferred visible capability has no explicit unavailable state | Do not mark the source-import slice complete |

### 5. Good / Base / Bad Cases

- Good: copy a reviewed renderer module, record its pinned hash and transitive
  dependency reason, then connect its required operation to a typed product IPC
  handler.
- Base: keep the current Electron placeholder while the dependency or legal
  closure is unresolved; no parity claim is made.
- Bad: copy `preload.ts` or `bootstrap-electron.ts` wholesale and add a permissive
  `window.electronAPI` proxy until the page stops crashing.

### 6. Tests Required

- Recompute every copied-file hash from the pinned source and compare it with the
  manifest before commit.
- Assert no runtime, build, package, or copied-source file contains the external
  reference checkout path; audit-only manifests may record the local checkout.
- Assert the pet entry does not statically import the main Cindy renderer entry.
- Inspect the dependency/native-module closure and fail the import review when a
  required license, generated asset, or native runtime resource is unaccounted for.
- Keep source/provenance checks separate from Electron native startup, visual parity,
  real Pi/model execution, and installed-package acceptance.

### 7. Wrong vs Correct

#### Wrong

```ts
// Make the copied Cindy UI compile by exposing every host method.
contextBridge.exposeInMainWorld('electronAPI', ipcRenderer)
```

#### Correct

```ts
// Expose only a reviewed product contract; map each method in the manifest.
contextBridge.exposeInMainWorld('desktop', {
  submitRun: (request: AgentRunRequest) => ipcRenderer.invoke('agent:submit', request),
  cancelRun: (sessionId: string, runId: string) =>
    ipcRenderer.invoke('agent:cancel', { sessionId, runId }),
})
```

## Electron pet activity and window persistence (migration)

### 1. Scope / Trigger

This contract applies to the independent Electron pet window and the host-owned
activity projection added during the migration. It is triggered by adding pet
activity IPC, position recovery, and the Pi run-to-pet status bridge. It does not
replace the existing Tauri pet preferences or authorize live-data migration.

### 2. Signatures

```ts
type PetActivityStatus =
  | 'idle' | 'running' | 'cancelling' | 'waiting'
  | 'completed' | 'cancelled' | 'failed'

interface PetActivity {
  status: PetActivityStatus
  sessionId: string | null
  runId: string | null
  updatedAt: number
}

invoke<PetActivity>('pet:activity')
on('pet:activity', (activity: PetActivity) => void)
on('pet:state', (state: { visible: boolean }) => void)
```

The host persists only `{ version: 1, x: number, y: number }` in the Electron
user-data directory as `pet-position.json`. It restores the position against the
nearest current display work area and clamps negative/off-screen coordinates.

### 3. Contracts

- Only the main window may invoke `agent:submit` and `agent:cancel`; only the pet
  window may invoke `pet:activity`, `pet:hide`, and `pet:main:open`.
- The pet receives a compact projection of run identity and status. It never
  receives prompts, message deltas, tool arguments, provider errors, credentials,
  or raw Pi records.
- `run.accepted` and `run.record` project to `running`; cancellation acceptance
  projects to `cancelling`; terminal outcomes project to the matching terminal
  status. The projection does not imply that a model response is visible.
- Position persistence is best effort, atomic in the same directory, and must not
  prevent application shutdown. A malformed or missing file falls back to the
  default Electron window position.
- The pet renderer is a separate entry/preload graph. Hiding it must not dispose
  the Pi runtime, cancel a run, or duplicate an IPC subscription.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| IPC sender is not the registered main/pet window | Reject with an unauthorized-sender error |
| Pet activity payload is absent or malformed | Reject the invoke; do not expose a fallback success |
| Position JSON is missing or malformed | Ignore it and use the default position |
| Position has nonfinite coordinates | Ignore it and use the default position |
| Saved display was unplugged or coordinate is outside work area | Use the nearest current display and clamp inside its work area |
| Position write/rename fails | Keep the current window usable; do not block quit |
| Pet is hidden or renderer is destroyed | Stop sending to its webContents; keep host run ownership |

### 5. Good / Base / Bad Cases

- Good: a Pi run changes the pet to `running`, hiding/showing the pet preserves
  the same run, and a restart restores a finite in-bounds position.
- Base: no run is active, the pet shows `idle`, and no activity record is sent.
- Bad: the pet infers completion from an animation timer, receives model text, or
  a hidden pet causes the main process to abort the active run.

### 6. Tests Required

- Assert each agent event maps to a compact activity projection without copying
  the raw record or settlement error.
- Assert malformed position values and negative multi-display origins are handled
  by pure parser/clamping tests.
- Mock Electron sender identity and assert unauthorized main/pet calls reject.
- Assert activity listeners are disposed with the window and that hiding does not
  dispose the Pi runtime.
- Keep pure projection/position tests separate from native Electron startup,
  display/DPI acceptance, and real Pi/model execution.

### 7. Wrong vs Correct

#### Wrong

```ts
// A pet timer guesses that work finished and can disagree with the host.
setTimeout(() => pet.show('完成'), animationDuration)
```

#### Correct

```ts
// The host owns lifecycle truth and sends only a compact projection.
runtime.onEvent((event) => setPetActivity(windows, petActivityFromAgentEvent(event)))
```
