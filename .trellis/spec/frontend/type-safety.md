# Type Safety

> Type safety patterns in this project.

---

## Overview

TypeScript `strict: true`（`tsconfig.app.json`），`noEmit` + `tsc -b` 随
`pnpm build` 执行。无运行时校验库（Zod 等）——边界校验靠 Rust 层 serde。

---

## Type Organization

- **领域类型集中放 `src/lib/`**：`PetState` 在 `pet-state.ts`，
  `AgentView` / `AgentMessage` / `AgentRun` / `ToolCall` 在 `agent.ts`，与使用它们的
  函数同文件导出
- **组件 props 类型放组件文件内**：`interface ChatPanelProps` 不导出；
  跨组件复用的 UI 类型导出（`UiMessage`，定义在 `ChatPanel.tsx:10`，
  被 `App.tsx` import）
- **优先字符串字面量联合**，不用 enum：

  ```ts
  export type PetState = 'idle' | 'curious' | 'thinking' | 'talking' | 'happy' | 'sleeping' | 'error'
  ```

- 联合类型的展示文案用 `Record<Union, string>` 穷尽映射，编译期保证不漏
  （`pet-state.ts:10` 的 `petStateLabel`）
- 纯类型 import 必须写 `import type { ... }`（`isolatedModules: true`）

## Tauri IPC 边界

- 每个 command 在 `src/lib/agent.ts` 有一对类型 + 包装函数：

  ```ts
  export function saveAgentSettings(baseUrl: string, token: string) {
    return invoke<AgentView>('save_agent_settings', { settings: { base_url: baseUrl, token } })
  }
  ```

- `invoke<T>` 永远带显式泛型参数；`listen<PayloadType>` 同理
- Rust 侧 snake_case 参数对象统一包一层命名对象（`{ settings }`、`{ request }`、
  `{ position }`），与 `src-tauri/src/lib.rs` 的参数结构对应

## Common Patterns

- 服务端事件使用 `type` 判别、`v: 1` 定版；Rust 校验后向窗口广播完整 `AgentView`。协议版本只接受整数 1，不接受布尔值、字符串或浮点数
- 可空状态用 `| null`：`useState<string | null>(null)`、
  `useRef<number | null>(null)`；不用 `undefined` 表达"没有"
- 可选字段仅用于真正可选的场景（`UiMessage.pending?`、`createdAt?`）

---

## Forbidden Patterns

- **禁止 `any`**；catch 到的 `unknown` 用项目统一的收窄写法：

  ```ts
  catch (cause) {
    setError(cause instanceof Error ? cause.message : String(cause))
  }
  ```

- 禁止非空断言 `!`——用条件判断或可选链（`rendererRef.current?.setState(...)`）
- 禁止类型断言 `as` 绕过检查（`as const` 除外，如 `role: 'system' as const`）
