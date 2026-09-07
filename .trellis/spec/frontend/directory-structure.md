# Directory Structure

> How frontend code is organized in this project.

---

## Overview

这是一个 **Tauri 2 桌面应用**（桌面 AI 白猫「橘伴」），前端是单页 React WebView。
同一个 `App.tsx` 根据当前 Tauri 窗口 label 渲染「宠物窗口」或「聊天窗口」
两种形态（见 `src/App.tsx:22`）。

- 项目规模小，**不做 feature 分目录**，没有 pages/、features/、store/ 等层级
- 所有 UI 组件平铺在 `src/components/`，所有非组件逻辑平铺在 `src/lib/`
- 没有路由：双窗口是两个 Tauri 窗口加载同一入口，靠 `getCurrentWindow().label` 分支

---

## Directory Layout

```
src/
├── App.tsx                    # 唯一根组件：双窗口分支、宠物状态机、消息流编排
├── main.tsx                   # React 入口（11 行）
├── styles.css                 # 全局唯一样式表（约 1500 行，无 CSS Modules）
├── vite-env.d.ts              # Vite 类型声明
├── components/                # 全部 React 组件，平铺
│   ├── PetStage.tsx           # 宠物舞台：2D 渲染挂载、拖拽、点击交互
│   ├── ChatPanel.tsx          # 聊天面板：消息列表、设置表单、输入区
│   ├── TodoList.tsx           # 直接查询待办列表及状态/刷新
│   ├── ChatBubbleFrame.tsx    # 可复用气泡框及独立组件样式
│   └── ReferenceIllustrations.tsx  # 内联 SVG 装饰组件集合
└── lib/                       # 非组件逻辑，平铺
    ├── pet-state.ts           # PetState 联合类型 + 中文状态文案
    ├── agent.ts               # 助手服务 Tauri IPC 和消息/任务/工具类型
    └── pet-2d-renderer.ts     # 2D 分层渲染器（DOM/CSS 动画，无 canvas）

src-tauri/                     # Rust 原生层（窗口、私有配置、助手服务连接）
├── src/lib.rs                 # 窗口 command 与命令注册
├── src/agent_client.rs        # 助手连接、认证、快照投影与 IPC
├── src/agent_protocol.rs      # 服务端协议类型与投影
└── capabilities/              # Tauri 权限配置

public/
├── pets/white-cat-v2/         # 运行时三张对齐 PNG（idle/blink/talk，1207×1303）
└── reference/                 # 视觉参考图

qa/                            # 手工预览页（pet-preview / chat-preview），不进构建
tools/                         # Node 校验脚本（pnpm pet2d:validate 等）
docs/ARCHITECTURE.md           # 架构边界说明（改运行边界前先读）
```

---

## Module Organization

- **新增组件** → `src/components/<PascalCase>.tsx`，一个文件一个主组件
- **新增纯逻辑 / IPC / 类型** → `src/lib/<kebab-case>.ts`
- **静态资源** → `public/` 下按用途分目录，代码里用绝对路径引用
  （如 `'/pets/white-cat-v2/idle.png'`，见 `src/lib/pet-2d-renderer.ts:11`）
- 不要引入 `pages/`、`hooks/`、`store/`、`utils/` 等新目录——现有平铺结构
  确实放不下时再讨论分层
- 校验/工具脚本放 `tools/`，并在 `package.json` 登记对应 `pnpm` script
- 跨窗口通信用 Tauri 事件（`emit` / `listen`），事件名形如 `'pet:state'`、
  `'agent:view'`、`'chat:mode'`，定义在 `src/App.tsx` 和 `src-tauri/src/lib.rs`

---

## Naming Conventions

- 组件文件：`PascalCase.tsx`（`PetStage.tsx`、`ChatPanel.tsx`）
- 逻辑文件：`kebab-case.ts`（`pet-state.ts`、`pet-2d-renderer.ts`）
- Tauri command：snake_case（`agent_view`、`agent_submit`），前端在 `src/lib/agent.ts`
  包装成 camelCase 函数（`getAgentView`、`submitAgentRun`）
- CSS class：kebab-case 描述性命名（`pet-stage`、`chat-panel`、`message-bubble`），
  状态修饰用 `is-*`（`is-ready`、`is-dragging`、`is-selected`）

---

## Examples

- 组件组织参考：`src/components/ChatPanel.tsx`
- 逻辑分层参考：`src/lib/agent.ts`（IPC 薄封装）、`src/lib/pet-2d-renderer.ts`（接口 + 类实现）
