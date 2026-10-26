# Research: 提醒轮询扩展点（memo due-review 并入方案）

- Query: 精读 backend/server.rs:260-300、local.rs:55-66、backend/mod.rs apply_reminder_poll(:538)、App.tsx:267-299 唤起逻辑，搞清楚 memo due-review 如何并入这条链路，AgentView.reminders 的数据结构
- Scope: internal
- Date: 2026-09-17

## Findings

### Files Found

| File Path | Description |
|---|---|
| `src-tauri/src/backend/server.rs:282-301` | server 模式 `poll_reminders` 循环（15s，GET `/v1/todos/reminders/due`） |
| `src-tauri/src/backend/local.rs:54-78` | local 模式同名轮询（直查 SQLite `TodoStore::due_reminders(Utc::now())`） |
| `src-tauri/src/backend/server.rs:39-44` | start 时 `tokio::join!` 三个后台循环（control/node/reminders） |
| `src-tauri/src/backend/mod.rs:538-555` | `apply_reminder_poll`：generation+epoch+in-flight 三重 fencing |
| `src-tauri/src/backend/mod.rs:199-201` | `View.reminders: Vec<Todo>`、`reminder_error`、`todo_revision` |
| `src-tauri/src/backend/mod.rs:482-492` | `apply_todo_write`：写成功后从 reminders 剔除该项并 bump todo_revision |
| `src/App.tsx:267-299` | 主窗口唤起逻辑（见下） |
| `src/App.tsx:224-228` | `suppressCurrentReminders`（关面板时标记已展示） |
| `src/components/TodoReminders.tsx` | 提醒卡片：展示 items[0]，完成/稍后10分钟两个动作 |
| `src/lib/agent.ts:70-71` | 前端 `AgentView.reminders: Todo[]` |

### 现有链路（todo 提醒）

1. **轮询**：每 15s（server.rs:299 / local.rs:76）。server 走 HTTP due 端点且校验返回必须全 pending+有 remind_at（server.rs:276-277）；local 直查 store。**读不消费**——到期项一直返回直到被完成/改期。
2. **fencing**（mod.rs:538-541）：generation 不符、`todo_mutation_epoch` 变化（说明轮询期间发生过写）、或 `todo_writes_in_flight > 0` → 整批丢弃，避免覆盖更新的本地写结果。
3. **视图**：`View.reminders: Vec<Todo>`（mod.rs:199），变化才 bump revision + emit `agent:view`。
4. **前端唤起**（App.tsx:267-299，只在主窗口跑）：
   - occurrence key = `` `${item.id}:${item.remind_at}` ``（:275）——同一事项改时间后会重新唤起；
   - `shownRemindersRef` 按 generation 重置（:270-273）；已 expanded 则直接标记 seen（:277-280）；否则延迟到重试点后 `changePetChatMode('expanded')` 展开聊天面板，成功才标记 seen，失败 15s 后重试并报错（:282-297）；
   - 关面板时 `suppressCurrentReminders`（:224-228）把当前所有 occurrence 标 seen，防止重新弹出。
5. **展示**：ChatPanel.tsx:395 `<TodoReminders items={status.reminders}>` 只展示**第一项**（TodoReminders.tsx:115-119），操作=完成（completeTodo）或稍后10分钟（setTodoReminder CAS，snoozeRef 固定绝对时间避免重复点击叠加）。

### memo due-review 并入方案

**推荐：加第二个轮询 + 第二组视图字段**（与 todo 平行，不混入 reminders），理由：

- `View.reminders: Vec<Todo>` 类型是 Todo，前端卡片（TodoReminders）和 occurrence key 都围绕 `remind_at`/完成语义；memo review 是"回顾"语义，动作不同（打开备忘页/稍后回顾），硬塞进同一数组会把类型污染成 tagged union，改动面更大。
- 双轮询模式已有先例：`tokio::join!` 里三个独立循环（server.rs:39-44），每个 generation 切换即整体中止重建。

具体改动点：

1. **View**（mod.rs:199-201 附近）：加 `memo_reviews: Vec<Memo>`、`memo_review_error: Option<String>`、`memo_revision: u64`。
2. **Inner**：复用同一 `todo_mutation_epoch`/`todo_writes_in_flight`（前提：memo 写也走这对计数器，见 rest-command-chain.md），或新增 memo 专属 epoch——**推荐复用同一对**（重命名为通用名），保证 todo 写与 memo review 轮询也不会交错。
3. **轮询**：server.rs 加 `poll_memo_reviews`（GET `/v1/memos/reviews/due`，同样校验返回形状）；local.rs 直查 `MemoStore::due_reviews(Utc::now())`；两处都调新的 `apply_memo_review_poll`（对照 mod.rs:538-555，fencing 逻辑相同）。
4. **写剔除**：memo 的 `apply_memo_write` 里 `view.memo_reviews.retain(|m| m.id != item.id)`（对照 :489）。
5. **前端**：
   - `agent.ts` AgentView 加 `memo_reviews: Memo[]`、`memo_review_error`；
   - App.tsx 唤起 effect 扩展为同时看 `status.memo_reviews`，occurrence key 用 `` `${item.id}:${item.review_at}` ``（可加前缀区分来源）；
   - 新增 `MemoReviewReminders` 卡片组件（对照 TodoReminders），动作=「查看备忘」（打开 ChatPanel memo 页）+「10 分钟后再回顾」（setMemoReview CAS，复用 snoozeRef 绝对时间模式）；或扩展 TodoReminders 支持双来源列表。
   - ChatPanel 打开 memo 页时 suppress 语义同 `suppressCurrentReminders`。

**备选（不推荐）**：单一轮询端点返回 `{todos, memos}` 合并载荷。省一次 HTTP，但要改现有端点契约（双端快照/边界测试全要动），且 local 模式没有 HTTP 开销问题，收益小。

### AgentView.reminders 数据结构（钉死）

Rust `View.reminders: Vec<Todo>`（mod.rs:199）→ TS `AgentView.reminders: Todo[]`（agent.ts:70），Todo = `{id, title, status, created_at, remind_at}`。**只含已到期且 pending 的项**，客户端不再次过滤。

## Caveats / Not Found

- 唤起一次只展示第一项（TodoReminders.tsx:115）；memo review 与 todo 提醒同时到期时的优先级/合并展示是产品决策，需要 prd 确认。
- local.rs 轮询依赖 `inner.store` 存在；memo 表若 user_version 升级失败，due_reviews 会报错——错误会进 `memo_review_error` 并显示在卡片上（对照 TodoReminders.tsx:121），行为可接受。
