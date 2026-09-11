# Component Guidelines

> How components are built in this project.

---

## Overview

函数组件 + React 19。没有类组件、没有高阶组件、没有 render props。
组件通过 props 单向接收数据和回调，跨窗口状态用 Tauri 事件同步，不用全局 store。

视觉权威：仓库根的 `PRODUCT.md`（产品事实）与 `DESIGN.md`（视觉系统：tokens、字重阶梯、材质规则）是 UI 工作的上游约束——新增/修改样式优先复用 `styles.css :root` 的 tokens 与 DESIGN.md 的 Named Rules，不要引入体系外的一次性色值/字重（中间字重如 650 禁止，用阶梯档位）。设计类任务走 Impeccable 流程（`.agents/skills/impeccable/`）。

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
- Entrance motion is active only when `visible && animateEntrance`. The host must
  disable `animateEntrance` when switching between already-open panel modes;
  replaying the initial entrance after a native resize creates a second jump.
  `animateEntrance=false` must not hide the frame. Component-local reduced-motion
  selectors must override the actual animation selectors without depending on a
  global `!important` reset.
- Open-to-open native mode changes must not hide the entire frame or toggle the
  cat platform crop. Closed-to-open preparation is a distinct phase. A paint
  opportunity obtained through RAF is not proof that AppKit presented the frame;
  bound RAF waits and verify native transitions separately from browser previews.
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

The approved HTML migration changes the default attached appearance to the
continuous shell described below. The tail configuration remains an explicit
compatibility mode; an empty or all-undefined tail object uses the new shell.

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

## Continuous shell and platform contract

### Scope and trigger

`ChatBubbleFrame` owns the approved `preview (2).html` perimeter, cream fill,
layered border and integrated pet platform. Compact and expanded attached views
use the same geometry function; chat/settings/todo contents remain caller slots.
The host owns desktop positioning and pet alignment. Reference demo behavior and
its alternative cat/paw assets are not imported.

### Signatures

```ts
interface ChatBubbleDockConfig {
  scale?: number
  offsetX?: number
  offsetY?: number
}
// Optional props on ChatBubbleFrame and forwarded by ChatPanel:
// dock?: ChatBubbleDockConfig
// tail?: ChatBubbleTailConfig
```

### Contracts

- Attached with absent/empty/all-undefined `tail`: render one `ChatBubbleShell`.
- Attached with any defined `tail` field: use the previous configurable tail;
  `dock` has no effect. Standalone renders neither decoration.
- Dock offsets use CSS pixels. Default scale is0.6; effective scale decreases
  when width/680 or height/440 is smaller. Panel size changes redraw the outline;
  they do not stretch the platform artwork independently along each axis.
- Native compact frame is475×278, bottom55px; expanded uses left40/right224,
  top40/bottom55. Expanded ChatPanel supplies default offsetX13.3 for pet alignment.
  A caller-supplied dock object replaces that host default.
- Keep the paw SVG and its exact position/size/filter unchanged. The transparent
  1px layout border preserves its padding-edge anchor even though SVG owns paint.
- Keep actual root minima and geometry minima aligned at132px; larger minima from
  corner/slot requirements still apply. Bottom-left corner28px and top-left72px
  must agree with surface clipping.
- Use per-instance `useId` for every SVG definition/reference. Disconnect
  ResizeObserver on teardown. The decoration cannot intercept pointer events.

### Validation and error matrix

| Input | Behavior |
| --- | --- |
| No dock / omitted fields | scale0.6 and zero offsets in the shared frame |
| Nonfinite offset | zero offset |
| Nonfinite, zero or negative scale | default scale0.6 |
| Excessive upward offsetY | clamp before the connection would fold backward |
| Positive scale exceeding available panel room | proportionally reduce artwork |
| `tail={{ right: 0 }}` | explicit legacy tail mode; zero remains valid |

### Good, base and bad cases

```tsx
// Base: shared continuous frame/platform.
<ChatBubbleFrame variant="expanded" appearance="attached" title="面板">
  {content}
</ChatBubbleFrame>
// Host alignment without business knowledge in the frame.
<ChatBubbleFrame variant="expanded" appearance="attached" title="面板"
  dock={{ scale: 0.6, offsetX: 13.3, offsetY: 0 }}>
  {content}
</ChatBubbleFrame>
// Do not layer a second triangle or a complete second disk over this shell.
```

### Required checks

Verify compact, expanded chat/settings/todo, independent hosts and short content;
measure unchanged paw bounds/filter. Test two React instances for unique SVG IDs,
host resizing, dock offsets/scale, explicit tail then reset, standalone and inert
visibility. Geometry checks must cross the short/tall branch boundary with
nonzero offsetX: connection x stays stable and y follows the height delta.

### Wrong versus correct

Do not validate only a rounded rectangle plus an overlaid platform. Inspect the
single full perimeter and the real cat layer together: the original PNG stays
unchanged, and the attached host clips only its old disk front to avoid overlap.
Closed mode keeps the original complete image. Native pet z3 stays above framez2.

### Reference footprint decorations

The continuous shell also owns the reference's five four-toe footprint motifs:
shoulder, curved edge, lower edge, above the pet status bubble, and lower joint.
Expanded frames without a footer slot add two bottom motifs (left and55% across);
frames with a composer/footer keep five so no decoration is concealed by it.
These prints use an independent instance-scoped SVG symbol, not the preserved
corner badge. They are noninteractive. The floating print uses a dock-relative
anchor `(width + 114*scale + offsetX, height - 568*scale + offsetY)` to stay visible
above the existing pet status bubble in the native compact and expanded windows.
The geometry module owns all positions, dimensions, rotations and fill colors.
The tail SVG uses `preserveAspectRatio="none"`: width and height independently
scale the decoration. Do not use a centered `meet` viewport with proportional
right offsets; a wide/short viewport would move the narrower drawn path off the
frame. Keep the paw SVG's original aspect behavior unchanged.

### Integrated compact content composition

Keep slot sizing in `ChatBubbleFrame.css` and composer/action styling in
`styles.css`, scoped to `.chat-panel.is-attached.is-integrated.is-compact`.
The native475×278 shell joins the pet platform; its extra height must be planned
as one content composition, not absorbed into a tall empty header. Use the
existing four quick actions in two columns with consistent composer/action
insets and restrained colors. Do not add filler copy or unrelated decorations.
Preserve the approved badge geometry/filter, all five shell prints and the
native frame/platform dimensions. Expanded and explicit legacy-tail layouts
retain their own rules. Compact actions use one warm-white surface and left-aligned
icon/text, not four different color blocks. Use warm dark text with at least4.5:1
contrast; keep orange emphasis on the send action. Fine borders, restrained
inner highlights and consistent shadows should not change control dimensions.

The compact body uses `display: flow-root` so real error content contributes its
natural height, including margins, to the outer grid. An empty body stays zero
height. A nested `minmax(0, 1fr)` inside a `min-content` outer track cannot be
relied on to reserve that height. Verify the entire height budget and control
visibility; source-based error analysis is not runtime service verification.

### Settings content and native state

`AssistantSettings` owns settings presentation and local disclosure/credential
visibility only. Its props are `status`, `baseUrl`, `credential`, `saving`,
`error`, `onBaseUrlChange`, `onCredentialChange` and `onSubmit`. `ChatPanel`
continues to own the edited values and native save operation. Editing the URL
clears the entered credential; reusing a saved endpoint preserves the existing
empty-credential semantics. Successful save clears the draft credential and
returns to compact. Never turn a visual test-connection control into a save call.
Synchronize the editable URL only when `status.endpoint` changes, clearing the
credential on that endpoint change. Depending on the whole status object would
overwrite a URL draft during connection/message updates while retaining a
credential intended for a different server.

Adapt the reference to a normal-flow connection card plus status/guide/security
cards. Container queries collapse the cards at narrow widths; opened help and
real errors must remain scrollable. Entering settings must start at its top;
chat message auto-scroll must not scroll the settings content.

Status details use saved `status.endpoint`, never the unsaved URL draft. Show
model and device-registration state separately from assistant connectivity.
`AgentView` does not expose a credential value/presence probe; use configuration
wording, not a fabricated masked secret. Keep the actual native private-file
storage explanation, not the reference demo's session-only claim. Reference
demo adapters, fake connected state and test results are never imported.

When form classes change, update `qa/chat-panel-preview.tsx`'s submit-capture
guard so browser QA still cannot invoke native settings save. Browser layout,
HTML validation and local visibility toggles do not establish native save or
real model operation.

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

## Message content and reading continuity

`MessageContent` renders Markdown through react-markdown and remark-gfm with raw HTML disabled. Preserve source text and message identity; allow explicit HTTP(S)/mailto links only and never automatically fetch model-provided images. Code copy must use the code content, report clipboard failures, and reset success feedback when streaming changes that content. Styles are scoped under `.chat-panel .message-markdown`.

`useChatReading` scrolls only its own viewport, never `scrollIntoView` on an ancestor. Follow new content only near the bottom or after the user explicitly returns to latest; preserve the reading position across settings/todo navigation. Returning from secondary pages restores the initiating chat mode; successful settings save retains the compact-return contract.

The approved pet PNG remains unchanged. `PetLiveStatus` overlays only the interior of its decorative speech bubble with actual AgentView-derived connection/model/device state. Do not punch a separately rasterized transparent mask beneath an opaque replacement: fractional edges can expose a visible seam. Keep pet pixels, original outline, and the independent open-state bottom clip untouched.

## Native panel and page commit contract

`ChatPanel.onExpandedChange(expanded, commitPage?)` may return a promise. Native
hosts commit the optional page callback together with the target layout update:
inside the same `flushSync` for closed→open reveals and same-size page
navigation, and as one automatically batched React render for open-to-open mode
changes — a `flushSync` there blocks the main thread for the whole destination
render behind the morph's ghost cover. Non-native hosts may omit it; ChatPanel
performs a guarded, once-only fallback on resolution. `changePage` invalidates
superseded intentions; close and unmount also invalidate pending page callbacks.

Serialize native frame writes and keep the latest pending target/callback. Capture
a batch's waiters before processing its successor; reject waiters on that batch's
failure. Do not use a timer race to permit another native size write: an unresolved
IPC has not been cancelled. `tools/verify-pet-motion.mjs` covers the batched
open-to-open page commit, same-flush same-size page commit, queued failure,
retry, single-flight and closed-page callback invalidation.

## Initial integrated-shell reveal

Never scale/fade the entire integrated root: its continuous SVG owns the platform
that replaces the cropped original disk. Keep root/platform stationary and fully
painted; fade the bubble region through a smooth luminance mask, coordinated with
surface and paw opacity. A hard rectangular mask boundary leaves a visible alpha
seam. Inspect a mid-animation frame, not only the settled screenshot.

Normal entry may translate content by 6px; reduced entry uses opacity only for
160ms. Preserve the OS preference and use a scoped rule that survives global
reduced-motion animation resets. Disable the body's independent page-change
animation during initial entrance so two timelines do not compete.

`waitForPanelViewport(mode)` observes CSS viewport dimensions with a bounded
600ms deadline; false means not ready and requires recovery, never timed success.
Matching dimensions and RAF callbacks do not prove AppKit actually presented a
frame. Native acceptance requires the pet window on the current visible desktop.
