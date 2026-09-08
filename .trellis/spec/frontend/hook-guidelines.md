# Hook Guidelines

> How hooks are used in this project.

---

## Overview

**项目目前没有任何自定义 hook**——所有 hooks 直接在组件里使用
（`useState`、`useRef`、`useEffect`）。不要为了"抽象"而提取 hook；
同一段逻辑真实出现第三次再考虑。

---

## Custom Hook Patterns

暂无自定义 hook。若未来需要：

- 命名 `useXxx`，放 `src/lib/use-xxx.ts`（kebab-case 文件名）
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
