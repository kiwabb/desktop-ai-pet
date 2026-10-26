# Hook Guidelines

> How hooks are used in this project.

---

## Overview

Custom hooks already own specific lifecycles: `usePetGroupDrag`,
`useChatReading` and `useFrameMorph`. Keep window dragging, reader continuity,
and shell animation cancellation in their respective hooks. Extract further
hooks only for a cohesive repeated lifecycle, not to reduce component line count.

---

## Custom Hook Patterns

Existing custom hook conventions:

- 命名 `useXxx`，place shared hooks in `src/lib/` and component-specific hooks beside their component, matching existing camelCase filenames
- 返回值用对象还是元组，参考使用处可读性；本项目倾向对象

---

## Data Fetching

- 不用 React Query / SWR / fetch——前端**不直接发 HTTP**
- 所有后端调用走 Tauri IPC：`src/lib/agent.ts` 里 `invoke<T>('command_name')`
  的薄封装，组件 `await` 封装函数（如 `getAgentView()`、`saveAgentSettings()`）
- 流式数据走 Tauri 事件：Rust 发 `'agent:view'`（唯一状态出口，含消息增量的
  快照投影），组件 `listen<AgentView>` 订阅（见 `src/App.tsx`）

## useEffect 约定（重要，项目里最密集的模式）

- **每个副作用都有完整 cleanup**：事件监听存 promise，cleanup 里
  `unlistenPromise.then(unlisten => unlisten())`；timer 存 ref，cleanup 里
  `window.clearTimeout`（范本见 `src/App.tsx:43`）
- timer 一律 `window.setTimeout` / `window.clearTimeout`（拿 number 类型 id），
  id 存 `useRef<number | null>(null)`
- 异步挂载用 `disposed` / `cancelled` 标志防 setState-after-unmount
  （见 `PetStage.tsx:45`、`App.tsx:137`）
- 依赖数组如实填写；需要"最新值但不想触发重跑"的用 ref 镜像
  （`petStateRef`、`chatModeRef` 模式）
- Focus after a committed visible/view transition must not depend on an animation frame. Use a layout effect for committed DOM targets; consume quick-prompt caret intent once after the controlled draft commits, and discard it when hidden or on another page. Native focus recovery must preserve an already focused visible editor.
- When secondary pages unmount the composer, preserve its actual DOM value and selection start/end/direction in a stable parent ref during textarea detach. Restore the snapshot once on rebind only if the new textarea value still matches, then consume it. Changed or acknowledged-and-cleared drafts invalidate old selection. Keep the ref callback stable across ordinary draft updates; do not retain a hidden focusable editor to preserve selection. Verify a selected suffix survives settings/Todo navigation and is replaced by subsequent native typing.

## Naming Conventions

- ref 命名 `<purpose>Ref`：`activeRequestRef`、`bubbleTimerRef`、`dragRef`
- 事件处理函数 `handleXxx`：`handleSend`、`handlePointerDown`
- 异步动作函数用动宾：`openChatWindow`、`changeChatExpanded`、`loadModels`

---

## Common Mistakes

- **不要在 effect 里忘记清 timer/监听器**——桌宠常驻运行，泄漏会累积
- **不要在 effect 依赖里放易变对象**——用 ref 读最新值（项目里 `updatePetState`
  同时更新 ref 和 state，就是为了让 timer 回调读到最新状态）
- 跨 effect 共享的"当前值"（如 `chatMode`）必须同时维护 `<name>Ref`，
  否则闭包读到旧值
