# State Management

> How state is managed in this project.

---

## Overview

**没有状态管理库**（无 Redux / Zustand / Jotai）。三类状态各有归属：

| 状态类别 | 机制 | 例子 |
|---|---|---|
| 组件本地 UI 态 | `useState` | 输入草稿 `draft`、设置面板开关 `settingsOpen` |
| 共享 UI 态 | 提升到 `App.tsx`，props 下发 | `messages`、`streaming`、`status`、`petState` |
| 跨窗口态 | Tauri 事件 `emit`/`listen` | `'pet:state'`、`'agent:view'`、`'chat:mode'` |
| 原生持久态 | Rust 层本地配置文件 | 助手地址/设备凭证/会话 ID、宠物位置（`save_pet_position`） |

---

## State Categories

### `useState` vs `useRef` 的分工（本项目核心模式）

- 需要触发渲染的 → `useState`
- 只需要"读到最新值"（timer 回调、事件监听回调里）→ 同名 `useRef` 镜像，
  更新时两处一起写。范本：

  ```ts
  function updatePetState(nextState: PetState) {
    petStateRef.current = nextState   // ref 供回调读
    setPetState(nextState)            // state 供渲染
    void emit('pet:state', nextState) // 事件供另一个窗口
  }
  ```

  （`src/App.tsx:307`）

- 进行中的异步对象存 ref 不存 state：`activeRequestRef`、
  `contextMenuPromiseRef`、`dragRef`

## When to Use Global State

目前没有全局状态，也没有引入库的计划。判断标准：状态需要在宠物窗口和
聊天窗口之间同步时，**用 Tauri 事件**，不要引入前端全局 store。

## Server State

- PostgreSQL owns durable messages, runs, tool results and todos. Rust owns the local projection; React renders `AgentView` from `src/lib/agent.ts`.
- `agent:view` carries a complete projection with `generation` and `revision`; reject stale views. Focus reads `agent_view` again to recover missed window events.
- WebSocket snapshots set the session cursor. Accept persistent events in exact `seq + 1` order, ignore duplicates and resynchronize gaps.
- A transport disconnect preserves messages and task state. A failed model run remains visible with its persisted error and tool results.
- A submission is identified by `request_id`. Retrying the same request must reuse that ID; equal text from another device is not acknowledgement.
- Model secrets stay on the server. Device credentials stay in native configuration, never browser storage.
- See [server-agent contract](../backend/server-agent.md) for endpoints, ordering and evidence requirements.

---

## Common Mistakes

- **不要给流式追加用 replace**：chunk 到达时用函数式更新
  `setMessages(current => current.map(...))`；当前消息投影在 Rust 中顺序应用事件
- **不要直接改 Tauri 窗口尺寸后立刻渲染**：窗口 resize 与 React commit
  之间要用 `flushSync` 协调，避免中间帧闪烁（`src/App.tsx:167`
  `changePetChatMode` 的注释说明了完整时序）
- 未配置真实 AI 服务时**禁用发送**，不留"假回复"路径（`ChatPanel.tsx:131`）

## Direct Todo List

`ChatPanel` owns chat/settings/list navigation and the draft; `TodoList` owns loading/error/ready data and refresh. The list is keyed by `AgentView.generation`. Ignore unmounted/obsolete requests and require matching `TodoListView.generation`; do not show an old account's response after settings change.

`listTodos()` invokes native `agent_list_todos`, not `submitAgentRun`. Do not gate it on model or WebSocket state. Opening and refreshing read current server data; failed loads are errors, not empty success. Returning from list retains the owning chat state and does not cancel server tasks.

Todo business status (`pending | completed`) is independent of tool execution status (`running | completed | failed | needs_reconciliation`). Use `todoStatusLabel` for business labels.

The list's completion control invokes `completeTodo(todoId)` for pending items and `reopenTodo(todoId)` for completed items directly. Guard the in-flight write immediately, keep refresh from racing with it, and do not optimistically mark the item complete. On success apply the returned item with the requested target status only for the matching ID/generation and mounted view. On failure keep the existing list and show a row-level error. Retain the same button in both states so the user can undo completion and keyboard focus is not lost by replacing it with a static element.

## Due reminders

Reminder schedules and due status are server data, with native polling independent of TodoList/chat mounts. Follow [todo-reminders](../backend/todo-reminders.md) for new View fields, mutation fencing, occurrence deduplication and explicit snooze retry targets. `todo_revision` refreshes mounted lists after confirmed actions elsewhere; do not remount the entire ChatPanel or discard its draft. Preserve the single frame body slot when adding the notice and bound each scrolling region.

## Composer acceptance and IME

Preserve the original draft separately from trimmed submission text. Snapshot acknowledgement and the acceptance Promise must share one confirmation path that consumes the matching submission object only once. Late acknowledgements cannot consume a new submission or erase newly typed identical text. Acquire an immediate ref-based send lock before the request and release it when the Promise settles. Retain edited drafts and all failed submissions.

Candidate-confirming Enter must be rejected during composition, for native isComposing/keyCode229, and during the short WebKit composition-end event burst. Shift+Enter remains a newline. Verify actual native IME independently from pure-event regressions.
