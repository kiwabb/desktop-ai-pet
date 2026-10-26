# Research: 前端展示与面板（memo 页面与展示插件落地清单）

- Query: 精读 src/lib/tool-presentation.ts、tool-plugins.ts、todo/presentation.ts、components/TodoList.tsx 及 ChatPanel.tsx 中 TodoList 挂载方式（todosOpen、affects 刷新指纹），给出 memo 版页面组件与展示插件落地清单
- Scope: internal
- Date: 2026-09-17

## Findings

### Files Found

| File Path | Description |
|---|---|
| `src/lib/tool-presentation.ts` | `ToolPresentationPlugin` 接口（:10-18）+ 注册表 + `presentTool`（:45-49 未注册降级）+ `toolEffectsFingerprint`（:53-56 按 affects 分发） |
| `src/lib/tool-plugins.ts` | 显式注册清单（目前仅 `import './todo/presentation'`） |
| `src/lib/todo/presentation.ts` | todo 展示插件范本（见下） |
| `src/lib/tool-presentation.test.ts` | 注册表/指纹/降级测试（含 dummy 插件示例） |
| `src/components/TodoList.tsx` | 列表面板范本（562 行，状态机+编辑+提醒编辑+删除确认） |
| `src/components/ChatPanel.tsx:62,336-347,386,396` | todosOpen 状态、toggleTodos、工具栏按钮、TodoList 挂载 |
| `src/components/ChatPanel.tsx:90-102` | 刷新指纹：`toolEffectsFingerprint(tools,'todo-list')` + generation/session/todo_revision → todoRefreshVersion |
| `src/lib/todo-sort.ts` | groupTodos 纯函数（pending/completed 分组排序） |
| `src/lib/todo-time.ts` | formatReminderTime/isReminderOverdue 等 |
| `src/components/ConversationFeed.tsx` + `src/lib/conversation-presentation.ts` | 工具卡片在消息流里的渲染（经 presentTool） |

### todo 展示插件结构（`src/lib/todo/presentation.ts`）

- `toolKind(name)`：业务名与模型名双名映射（:5-11）；
- `todoToolPresentation(tool)`：未完成只显示名称+状态；completed 后按 kind 渲染文案，**结果字段缺失/时间格式非法时降级为"待核实"**而非裸数据（:50-67）；时间解析要求显式时区偏移（:25-36）；
- `todoEffectsFingerprint(tools)`（:84-89）：只取 completed 的写类工具，按 tool.id 排序的稳定指纹（[tool.id, item.id, item.status, item.remind_at]）；
- 插件对象（:93-98）：`toolNames` 与 `affects` **直接从 `plugins/todo/plugin.json` 取**（Vite JSON import），保证与 manifest 同源；末尾 `registerToolPresentation(...)` 自注册。

### ChatPanel 挂载机制

- `todosOpen` state（:62）与 settingsOpen 互斥；`toggleTodos`（:336-347）先 `changePage(true, …)` 确保 expanded 再开页；返回聊天走 `returnToChat`（:313-319）恢复 returnExpandedRef；
- 头部按钮 :386（ClipboardList 图标）、标题 :380（'待办列表'）；
- **挂载**：:396 `{todosOpen && <TodoList key={status?.generation ?? 0} generation={...} refreshVersion={todoRefreshVersion} />}`——key=generation 保证换配置整体重挂；
- **刷新指纹**（:90-102）：`toolEffectsFingerprint(tools, 'todo-list')`（模型工具写入触发刷新）+ `status.todo_revision`（直连写入触发）+ generation/session → JSON key 变化时 `todoRefreshVersion++` → TodoList 的 useEffect（TodoList.tsx:121-133）在**非编辑/非忙**时刷新，编辑中排队；
- TodoList 内部（:88-115）`listTodos()` 带 request 序号防竞态 + generation 校验。

### memo 版落地清单

1. **`src/lib/memo/presentation.ts`**（新）：对照 todo/presentation.ts——
   - `toolKind` 映射 memo 工具双名；present 函数区分 kind=goal/note 文案（"记录备忘"/"回顾时间"）；
   - `effectsFingerprint` 取 [tool.id, item.id, item.status, item.review_at]；
   - 插件对象 `toolNames`/`affects` 从 `plugins/memo/plugin.json` 读，`affects` 用独立组（如 `['memo-list']`）。
2. **`src/lib/tool-plugins.ts`**：加 `import './memo/presentation'`。
3. **`src/components/MemoList.tsx`**（新）：对照 TodoList.tsx——
   - 同一 props 形状 `{generation, refreshVersion}`、同样的 request/generation fencing、busyRef/queuedRefresh 编辑期延迟刷新模式；
   - **两区渲染**：按 `item.kind` 分"长期目标"(goal)/"备忘"(note)两组（可写一个 `groupMemos` 纯函数放 `src/lib/memo-sort.ts`，对照 todo-sort.ts）；
   - 行内操作按需求裁剪：编辑、删除、设置/清除回顾时间（review 编辑器可复用 quick-reminders/todo-time 工具函数）；无"完成勾选"则去掉 checkbox 列。
   - 需要 `MemoList.css`。
4. **`src/lib/agent.ts`**：Memo 类型 + invoke 封装（见 rest-command-chain.md）。
5. **ChatPanel.tsx**：
   - 新增 `memosOpen` state 或与 todosOpen 合并为 `page: 'chat'|'todos'|'memos'|'settings'`（当前两个布尔已显拥挤，建议枚举化）；
   - 头部加备忘入口按钮（注意 :386-387 现有 `!todosOpen`/`!settingsOpen` 显隐条件要同步加 memosOpen 分支；:380 标题、:141 focusCurrentView、:199 Escape 处理、:109/:176 等 todosOpen 出现的每一处都要加 memo 对应分支——**todosOpen 在 ChatPanel 里出现约 12 处，逐处对照**）；
   - 刷新指纹：`toolEffectsFingerprint(tools, 'memo-list')` + `status.memo_revision` → `memoRefreshVersion`（对照 :93-102）；
   - 挂载 `{memosOpen && <MemoList key={generation} .../>}`（对照 :396）。
6. **回顾唤起卡片**：见 reminder-polling.md（MemoReviewReminders 或扩展 TodoReminders）。

## Caveats / Not Found

- ChatPanel 的 settingsOpen/todosOpen 双布尔互斥逻辑在加第三种页面前建议先枚举化重构，否则 :109、:176、:199、:289、:384-387、:391、:393、:419、:429 等处都要手工补分支，易漏。
- `presentation.ts:2` 直接 import `../../../plugins/todo/plugin.json`——memo 版需要确认 vite 对新的 plugins/memo/plugin.json 的 JSON import 同样可用（同构路径，无额外配置先例问题）。
