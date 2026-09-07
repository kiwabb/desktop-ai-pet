# Component Guidelines

> How components are built in this project.

---

## Overview

函数组件 + React 19。没有类组件、没有高阶组件、没有 render props。
组件通过 props 单向接收数据和回调，跨窗口状态用 Tauri 事件同步，不用全局 store。

---

## Component Structure

标准结构（参考 `src/components/ChatPanel.tsx`）：

1. 第三方 import → 相对路径 import（type import 单独一行，`import type { ... }`）
2. 模块级常量（如 `const petPreview = '/pets/white-cat-v2/idle.png'`）
3. `interface XxxProps { ... }`（不导出，除非被其他组件复用，如 `UiMessage`）
4. **命名导出**函数组件：`export function ChatPanel({ ... }: ChatPanelProps)`
   ——不用 `export default`（只有根组件 `App` 是 default export）
5. 组件体内顺序：`useState` / `useRef` → `useEffect` → 事件处理函数 → JSX

组件可以较大（ChatPanel 约 400 行、App 约 410 行）。子区域用条件渲染和
语义化标签组织（`<header>`、`<form>`、`<article>`），不过早拆分文件。

---

## Props Conventions

- Props 用 `interface XxxProps`，每个字段一个类型，必选为主
- 可选 boolean 用解构默认值：`attached = false`、`visible = true`
  （`src/components/ChatPanel.tsx` 的 props 解构）
- 回调命名 `onXxx`：`onClose`、`onSend`、`onExpandedChange`、`onPetInteract`
- 回调里发 Promise 的，调用方用 `() => void fn()` 包一层再传给 onClick
  类事件（见 `src/App.tsx:364`）
- 状态提升：共享状态放 `App.tsx`，组件通过 props 接收（如 `status`、`messages`、
  `streaming` 全部从 App 传入 ChatPanel）

## Styling Patterns

- **全局样式表** `src/styles.css` 承载应用与业务内容样式；无 CSS Modules / Tailwind / styled-components
- **有范围的例外**：可复用气泡框 `ChatBubbleFrame` 自带 `src/components/ChatBubbleFrame.css`，
  由组件直接 import，选择器以组件根类 `.chat-panel` 及状态类（`.is-compact` / `.is-expanded` /
  `.is-attached` / `.is-standalone` / `.is-hidden` / `.is-entering`）为边界；
  桌面锚点、可用尺寸和 z-index 仍归宿主（styles.css 的 pet-shell / chat-window-app 规则）
- A frame imported without `src/styles.css` must retain correct box sizing and
  layout. Apply `border-box` to the frame and its descendants/pseudo-elements.
  Keep default positioning in normal flow; restrict desktop `absolute`/`inset`
  rules to actual hosts, never a bare `.chat-panel` in application CSS.
- Entrance motion is active only when `visible && animateEntrance`. A committed
  hidden state removes the animation so showing the mounted frame can replay it.
  `animateEntrance=false` must not hide the frame. Component-local reduced-motion
  selectors must override the actual animation selectors without depending on a
  global `!important` reset.
- The paw badge is frame decoration: a direct child anchored over the top-left
  corner with one shared size/offset rule across variants and appearances.
  Never place it inside the title's flex row or override its geometry by mode.
  Keep it non-interactive and above the header; reserve title clearance without
  moving the badge. The approved treatment is stored in the bubble task's
  references/paw-corner-approved.png.
- Shared paw placement includes the **painted corner geometry**, not only its
  bounding-box offset. All surfaces must use the approved 72px top-left arc with
  the same paw anchor. A short header can normalize a copied 72px radius down to
  its own height and repaint a different curve; clip/paint inner backgrounds
  against the shared frame geometry instead of trusting computed radius alone.
- The frame's minimum usable dimensions must accommodate adjacent corner-radius
  sums (including border), even with no body/footer content. A clipping surface
  must meet those same dimensions. Attached compact has an 84px transparent
  header above its 72px corner; it may keep surface overflow visible to preserve
  existing error/footer visibility because only the outer frame paints that arc.
- className 用模板字符串拼条件类：

  ```tsx
  className={`chat-panel ${expanded ? 'is-expanded' : 'is-compact'}${attached ? ' is-attached' : ''}`}
  ```

- 状态修饰类统一 `is-*` 前缀；动画态类如 `pet-chat-resizing`、`pet-chat-animate-in`
- 渲染器内部的动画变量用 CSS 自定义属性，JS 侧 `style.setProperty`
  （如 `--drag-tilt`、`--look-x`，见 `src/lib/pet-2d-renderer.ts:63`）
- UI 图标统一用 `lucide-react`，并加 `aria-hidden="true"`；**禁止用 emoji 当图标**

## Configurable bubble tail

`ChatBubbleFrame` accepts optional `tail` position/size configuration. `top` is
the tail's vertical center, with `translateY(-50%)` applied consistently in both
variants. `top` and `right` accept CSS pixels as numbers or CSS length strings;
`width` and `height` are CSS pixels. Explicit values override mode defaults.
Standalone appearance does not render a tail. Tail changes must not alter paw
geometry, frame clipping or native window size.

Expanded tail uses a rounded tip with the visible outline beginning at the frame
seam; only its fill extends inward for overlap. Match the frame's 1px border color
and omit a separate tail shadow. Compact retains its approved traced silhouette.

```tsx
<ChatBubbleFrame
  variant="expanded"
  appearance="attached"
  title="面板"
  tail={{ top: '65%', right: -22, width: 36, height: 40 }}
>
  {content}
</ChatBubbleFrame>
```

Use actual React props to verify default/partial/full configuration and resetting
to defaults. Resizing should keep the seam attached when horizontal position is
left at its default; callers choosing an explicit right offset own that offset.
The tail SVG uses `preserveAspectRatio="none"`: width and height independently
scale the decoration. Do not use a centered `meet` viewport with proportional
right offsets; a wide/short viewport would move the narrower drawn path off the
frame. Keep the paw SVG's original aspect behavior unchanged.

## Accessibility

- 可交互的非按钮元素用 `role="button"` + `tabIndex={0}` + `onKeyDown`
  处理 Enter/Space（见 `PetStage.tsx:172` 的 hitbox）
- 动态区域加 `aria-live="polite"`（消息列表、气泡、状态文案）
- 错误提示用 `role="alert"`
- 装饰性图片 `alt=""` + `aria-hidden="true"` + `draggable={false}`
- 所有按钮必须有 `aria-label` 或可见文字；UI 文案用中文

---

## Common Mistakes

- **不要用 onClick 处理拖拽场景**：拖拽和点击共存时，在 `onPointerUp` 里
  根据是否移动过决定是否触发点击（`PetStage.tsx:130`），`onClick` 只处理
  `event.detail === 0` 的键盘触发
- **不要给 WebView 加浏览器持久化**：API Key 等敏感数据走 Rust 层写本地
  文件（`0600` 权限），不进 localStorage / 日志
- **不要伪造数据**：模型列表获取失败就显示错误并允许手输，不生成假列表、
  假回复（`docs/ARCHITECTURE.md` 验收边界）

## Todo list presentation

`TodoList.tsx` owns a scoped `TodoList.css`. Keep the task title primary and completion in a left-side control with at least a 44px hit area. Avoid repeating business status as both a pill and a prominent right-side CTA. Use quiet creation dates, retaining an exact localized timestamp for hover and assistive technology. A completed item keeps a clickable check and subtle strike-through; the same button requests restoration to pending, with an action-specific accessible label; a pending write shows progress inside the control and must await confirmed persistence. Preserve loading/error/empty states, keyboard focus, reduced motion and stale-response guards during styling changes. Changes to this list must preserve the existing cat artwork and shared bubble geometry.
