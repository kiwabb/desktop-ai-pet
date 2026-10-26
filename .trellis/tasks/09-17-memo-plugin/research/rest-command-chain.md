# Research: REST 与直连命令链路

- Query: 精读 server/app/main.py:116-173 的 todo 端点挂载、src/lib/agent.ts 的 Tauri 命令、src-tauri/src/backend/mod.rs 的 TodoSource 分发，列出 memo 版需要新增的端点/命令清单
- Scope: internal
- Date: 2026-09-17

## Findings

### Files Found

| File Path | Description |
|---|---|
| `server/app/main.py:116-173` | todo 八个 REST 端点（全部手写挂在 app 上，操作 `app.state.todo_store`） |
| `server/app/main.py:41` | `app.state.todo_store = service.plugins.store_for('todo')` |
| `src/lib/agent.ts:3-42` | 前端 Todo 类型 + 7 个 `invoke` 封装 |
| `src-tauri/src/backend/mod.rs:338-576` | `TodoSource` 枚举、`todo_config`、5+2 个 todo Tauri 命令、写路径 fencing |
| `src-tauri/src/backend/server.rs:81-301` | HTTP 客户端函数（每个端点一个，含响应校验） |
| `src-tauri/src/lib.rs:572-594` | `tauri::generate_handler!` 命令注册表 |

### 现有链路结构（todo 为例）

**服务端 REST**（main.py，全部要求 `principal()` 认证、异常映射 ValueError→400 / ReminderConflict→409 / LookupError→404 / 其他→503，:72-91）：

| Method & Path | 处理 | 调用的 store 方法 |
|---|---|---|
| GET `/v1/todos` (:116) | 列全部 | `list_todos` |
| POST `/v1/todos` (:130) | 建（body 严格 `{"title"}`，:121-128） | `create_todo` |
| PATCH `/v1/todos/{id}` (:136) | 改标题 | `update_todo_title` |
| DELETE `/v1/todos/{id}` (:143) | 硬删，返回删除前快照 | `delete_todo` |
| GET `/v1/todos/reminders/due` (:149) | 到期提醒轮询 | `due_reminders` |
| PUT `/v1/todos/{id}/reminder` (:154) | body 走 `reminder_arguments`（严格两键） | `set_todo_reminder` |
| POST `/v1/todos/{id}/complete` (:165) / `reopen` (:170) | 状态翻转 | `complete_todo` / `reopen_todo` |

**Tauri 命令层**（mod.rs）：每个命令的模式是
`begin_todo_write`（:473-480，锁内取 source+generation、`todo_mutation_epoch += 1`、`todo_writes_in_flight += 1`）→ 按 `TodoSource::Server|Local` 分发（Server 调 `server::*_http`，Local 直接调 `local_agent::plugins::todo::TodoStore`）→ `finish_todo_write`（:494-503，`apply_todo_write` 校验 generation、递减 in-flight、`view.reminders.retain(|t| t.id != item.id)` 剔除已处理提醒、`todo_revision += 1`、emit `agent:view`）。
只读的 `agent_list_todos`（:557-576）不走 epoch，只校验 generation。
`TodoSource`（:338-341）是按保存的 mode 分发的双数据源枚举；`todo_config`（:343-357）要求 local 模式 store 存在。

**server.rs HTTP 函数**：每端点一个 async fn，统一惯例：reqwest 无重定向、15s 超时、Bearer token、错误文案按状态码映射且不泄漏服务端 body、**响应逐字段校验**（id 匹配、status 匹配、due 列表必须全 pending 且有 remind_at，:276-277）。

### memo 版需要新增的清单

**1. 服务端 REST（main.py，对照 :116-173 逐个新增）** + lifespan 加 `app.state.memo_store = service.plugins.store_for('memo')`（对照 :41）：

| 建议端点 | 对应 store 方法 |
|---|---|
| GET `/v1/memos` | `list_memos` |
| POST `/v1/memos`（body 严格 `{title, kind}`，kind 白名单校验） | `create_memo` |
| PATCH `/v1/memos/{memo_id}` | `update_memo`（标题/正文） |
| DELETE `/v1/memos/{memo_id}` | `delete_memo`（返回删除前快照） |
| GET `/v1/memos/reviews/due` | `due_reviews` |
| PUT `/v1/memos/{memo_id}/review`（body 严格 `{review_at, expected_review_at}`，可复用 `reminder_arguments` 或写一个 review 版） | `set_memo_review` |
| （可选）POST `/v1/memos/{memo_id}/archive` | `archive_memo` |

同步把 `plugins/memo/plugin.json` 的 `rest_endpoints` 声明成同一张表（`test_plugin_manifest.py:70-79,115-118` 会对拍）。

**2. Rust server.rs HTTP 函数**：`fetch_memos`、`fetch_due_reviews`、`create_memo_http`、`update_memo_http`、`delete_memo_http`、`set_review_http`、（`archive_memo_http`），每个带 server.rs:511-741 风格的本地 socket 边界测试。

**3. backend/mod.rs 命令**：需要决策——是复用 `TodoSource` 改成泛化的 `DataSource`（todo+memo 共用 generation/epoch fencing），还是加平行枚举。建议**复用同一 todo_mutation_epoch/todo_writes_in_flight**（或更名 mutation_epoch）保证提醒轮询与 memo 写不交错。新命令：

- `agent_list_memos` → MemoListView `{generation, items}`
- `agent_create_memo(title, kind)` / `agent_update_memo(id, title)` / `agent_delete_memo(id)` → MemoMutationView `{generation, item}`
- `agent_set_memo_review(memo_id, review_at, expected_review_at)` → 同上（local 分支需一个 `local_set_review`，对照 `local_set_reminder` mod.rs:517-536 的错误族映射）
- （可选）`agent_archive_memo`

`apply_todo_write` 的 `view.reminders.retain`（:489）memo 版要剔除 `view` 里的 memo-review 项（见 reminder-polling.md）。

**4. `src-tauri/src/lib.rs:572-594`**：`generate_handler!` 里登记全部新命令。

**5. src/lib/agent.ts**：新增 `Memo` 接口（id/kind/title/status/created_at/review_at）、`MemoListView`、`MemoMutationView`、`memoKindLabel`，以及 `listMemos/createMemo/updateMemo/deleteMemo/setMemoReview` 等 invoke 封装（对照 :16-42）。

## Caveats / Not Found

- memo 是否暴露 complete/reopen 语义未定；若不暴露则少两个端点。
- `begin_todo_write`/`apply_todo_write` 是 todo 命名的共享骨架；memo 接入时建议顺手泛化命名（mutation epoch 与 in-flight 计数是跨数据源正确性关键，不要复制成两套互不感知的计数器，否则轮询-写入竞态防护会失效）。
