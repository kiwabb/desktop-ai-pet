# 设计: 待办功能完善

## 1. 服务端（server/）

`server/app/runtime_store.py` 新增（遵循现有 `*_in_transaction` 模式，事件同事务）：
- `create_todo(account_id, title)` → 校验标题 strip 后 1..2000（文案复用工具层风格）→ INSERT → todo_view
- `update_todo_title(account_id, todo_id, title)` → 404 LookupError（`待办不存在或已删除`）+ 标题校验；completed 也可改标题
- `delete_todo(account_id, todo_id)` → 404 同上；硬删除（DELETE 行）。注意 todos 表无外键依赖（tool_calls 只记 JSON 结果），直接删

`server/app/main.py` 新增路由（沿用 principal/错误映射）：
- `POST /v1/todos` body `{title}` → 201/200 `{item}`
- `PATCH /v1/todos/{todo_id}` body `{title}` → `{item}`
- `DELETE /v1/todos/{todo_id}` → `{"deleted": true}` 或 204（择一，推荐 200 `{"item": todo_view}` 返回删除前快照，便于前端动画期间展示）
- pytest 加进 `server/tests/`（仿 test_gateway.py 风格）：认证 401/403、标题校验 400、404、成功路径

## 2. 单机模式（src-tauri/src/local_agent/store.rs）

新增 `create_todo` / `update_todo_title` / `delete_todo`，语义与服务端逐字对齐（校验文案一致）；标题校验与 CAS 等既有规则复用。删除为硬删除。均走现有事务 + 视图投影路径。

## 3. Rust command 层（src-tauri/src/backend/）

- `AgentBackend` trait 加三个方法；`ServerBackend` 走 reqwest（沿用现有 bearer/错误处理模式）；`LocalBackend` 走 store。
- 新 command：`agent_create_todo(title)` / `agent_update_todo(id, title)` / `agent_delete_todo(id)` → 返回 `{ item, generation }` 形态与现有 todo command 对齐（generation 围栏复用）。
- `lib.rs` invoke_handler 注册。

## 4. 前端

- `src/lib/agent.ts`：`createTodo(title)` / `updateTodoTitle(id, title)` / `deleteTodo(id)` 薄封装。
- `src/components/TodoList.tsx`：
  - 顶部新增输入行（受控 state，Enter/按钮提交，提交中禁用）
  - 行内：编辑按钮 → input 替换标题（Enter 保存 / Esc 取消）；删除按钮
  - 提醒编辑器加快捷 chips 行（pure 计算函数放 `src/lib/`，如 `quick-reminders.ts`，便于脚本/测试验证：给定 now 产出未来时间）
  - 分组：`pending`（remind_at 升序，无提醒按 created_at 升序）+ `completed` 折叠组（created_at 倒序，默认收起，header 显示数量）
  - 行增删/完成的 CSS 过渡（transform/opacity only，参考 ChatBubbleFrame 的合成器约束）
- 排序/分组逻辑写成纯函数（`src/lib/todo-sort.ts` 或并入现有 lib），保证可测试。

## 5. 契约与兼容

- `AgentView` 不变；`verify-chat-interaction.mjs` 不受影响（不动 ChatPanel 的 submit 契约）。
- 模型工具 4 件套不动；新 REST 端点与工具共享 `runtime_store` 方法，保证语义一致。
- 待办工具结果展示（todo-tool-presentation.ts）不变。

## 6. 风险

- 删除与模型并发：模型工具循环可能同时操作同一 todo——store 层 404 → 工具失败文案兜底（现有 needs_reconciliation 语义覆盖）；可接受。
- PATCH/DELETE 幂等：删除重复请求返回 404 即可；编辑重复提交同值无副作用。
