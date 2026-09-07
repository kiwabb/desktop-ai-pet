# Design

## Boundary and data flow

现有聊天 → AgentService → 注册中心 → TodoTools → PostgreSQL → 工具事件/会话快照 → 原工具卡片。

- `server/app/todo_tools.py`：新增目录、模型 schema、参数校验及完成分支。SQL 必须同时限定 id 和认证 account_id，事务由现有 store.executing 管理。
- `server/app/agent_service.py`：更新已支持能力，强调缺少明确目标须追问；查询返回的标题是数据而非指令。
- `server/migrations/003_todo_complete.sql`：扩展 status CHECK 为 pending/completed；保留已有数据，默认仍为 pending。
- `src/components/ChatPanel.tsx`：新增名称及状态展示，区分创建结果与完成结果。必要时将纯结果格式化提取到 src/lib/，复用现有气泡框，增加列表视图入口和返回聊天入口，保留原聊天布局。
- `server/tests/test_runtime_tools.py` 及受影响的目录断言：验证参数、账号隔离、重复完成和事务结果。按现有测试工具补充必要检查。

## Contract

`todo_complete({todo_id: UUID string})` → 已有工具结果 `{item: {id,title,status,created_at}}`，status 扩展为 pending/completed。

`todo_list({})` 保留返回所有记录的行为，模型和 UI 明确区分待完成与已完成。HTTP/WS envelope 与工具运行状态不变；工具 completed 表示执行完成，todo.status 表示业务完成。

缺失、空白、非 UUID、额外参数拒绝；不存在或其他账号记录使用不泄露归属的固定错误。重复完成已完成事项成功返回当前状态；不创建新事项。

## Migration and risk

旧数据不清空，不重写旧迁移。新增状态后旧 UI 对单条结果有“已记录”的硬编码，所以同步更新显示和模型提示词。回滚不能直接收紧 CHECK 而丢弃已完成记录。

歧义判断依赖模型结合对话与查询结果，需要真实明确/模糊请求分别验收。真实完成验收须由用户指定目标事项；无目标时可验证追问但不得修改现有事项。

## Direct list path

`TodoList` view → `src/lib/agent.ts:listTodos()` → Tauri `agent_list_todos` → authenticated GET /v1/todos → RuntimeStore/PostgreSQL. This path never calls AgentService.submit or the model.

- `src-tauri/src/agent_client.rs` defines typed Todo (`id/title/status/created_at`) and HTTP response parsing. Reuse private configuration and redirect rejection, add a bounded HTTP timeout and sanitized errors.
- `src-tauri/src/lib.rs` registers the new command. Return `{generation, items}` so a stale response cannot overwrite a view after settings change. Do not hold the state mutex across network await.
- `src/lib/agent.ts` owns the TS types and invoke wrapper. The list has loading/error/data state independent of model and WS status.
- `src/components/TodoList.tsx` owns list rendering and refresh; `ChatPanel.tsx` owns view navigation. Reuse `ChatBubbleFrame` slots and Lucide icons; scope new styling to this view. Existing chat remains mounted at the state-owner level so navigating away does not lose a draft or interrupt a run.
- Display all returned records in current server order with distinguishable pending/completed controls and localized timestamps. No new status filter or pagination contract in this version.
- Clear old data on configuration generation changes, ignore stale request results, and do not represent failed loads as empty successful results. A fresh list entry always reads current server state.

## Deliverables and dependency

Completion tool and direct list can be verified independently. The list uses the existing GET endpoint and generic pending/completed decoding; completing a record then seeing its new state requires the completion migration/tool first. Keep both as checklists in this scoped task rather than parallel changes to the same ChatPanel owner.

## Direct completion button (authorized increment)

`TodoList` → typed `completeTodo(todoId)` → native `agent_complete_todo` → `POST /v1/todos/{todo_id}/complete` → account-scoped database transaction. Response HTTP `{item: Todo}`, IPC `{generation, item}`. No model submission or tool/run creation on this path.

Extract/reuse one account-scoped completion operation in RuntimeStore for the existing model tool and new direct endpoint. The model tool keeps business update and tool result in its existing transaction; direct HTTP owns its own transaction. Validate UUID at the boundary and retain indistinguishable missing/foreign-record errors. Repeated completion is idempotent by final business state.

Each pending row has a completion action and a submitting indicator. Do not optimistically report completed before success. On error retain the row and show an actionable error. Disable overlapping refresh/duplicate completion or otherwise ensure stale reads cannot undo the confirmed state. Completed rows use the same control to request restoration to pending. On navigation/config change discard late results using the same generation/unmount guards as reads. Reuse Lucide and scoped TodoList CSS; no new dialog or batch operation.

## Visual correction after user feedback

Reference the official Things and Todoist sources in research/todo-visual-direction.md. Keep task titles primary, place completion on the left with a 44px hit area, and show a compact creation date with an exact localized timestamp available to assistive technology and hover. Remove redundant status pills and the right-hand CTA. Completed rows retain a clickable check and subtle strike-through in server order. Preserve the existing frame, cat artwork and all save/error/generation guards.

## Reopen direct action

Add an explicit idempotent reopen action alongside complete: authenticated POST /v1/todos/{todo_id}/reopen → account-scoped store mutation to pending. Reuse typed Rust HTTP decoding, response ID/status validation and generation guard; register agent_reopen_todo and expose typed reopenTodo. Keep existing model todo.complete contract unchanged. TodoList reuses its busy/request guard and stable button DOM for both states, with action-specific accessible labels and error messages.

Expected files: server runtime store/service/router and focused tests; native agent client/command registration and tests; TS IPC wrapper and TodoList TSX/scoped CSS. No migration is needed: pending/completed already exist. Root owns documentation, runtime restart and read-only real-service evidence. Implementation agent owns code/tests, preserving all concurrent frame/artwork edits.
