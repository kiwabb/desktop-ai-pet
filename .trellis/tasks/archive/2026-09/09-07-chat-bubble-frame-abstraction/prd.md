# 完整抽象桌宠气泡框组件

## Goal

将已抽出的 ChatBubbleFrame 完整封装为桌宠内部可复用的气泡框：调用方传入展示状态和内容即可使用，不需要复制气泡 CSS 或依赖特定 App 祖先类名。保持用户已经确认的白猫、气泡外观和现有聊天/设置流程。

## Confirmed Background

- 用户在查看现有抽象后要求“建一个任务，完整的抽象出来”，已授权创建本任务。
- 当前组件已接收标题、操作区和 children，但自身仍使用通用 chat-panel 类，且无障碍名称写死；见 src/components/ChatBubbleFrame.tsx:5-55。
- 外观与尺寸依赖宿主祖先选择器；进入动画的开关同时控制隐藏和点击；见 src/styles.css:782-815、1056-1099、1336-1339。
- App 管理 closed/compact/expanded 和原生 resize 时序；见 src/App.tsx:174-245、379-407。ChatPanel 管理设置、输入与发送；见 src/components/ChatPanel.tsx:88-174。
- 紧凑模式发送后收起，展开模式发送后保留面板；设置保存成功返回紧凑态；见 src/components/ChatPanel.tsx:88-104、126-155。
- qa/chat-preview.tsx 含现有 fixture 消息、假 configured 状态和假回复。它不是 AI 或原生窗口验收证据。

## Requirements

- R15 (settings reference fidelity): Rebuild the settings content to match the approved V2 HTML's left connection card and right status/guide/security stack, adapted to the current676×665 expanded frame. Use real AgentView state, saved endpoint and model information; preserve existing native save/credential semantics, reminder behavior and return flow. Include useful local help and credential visibility controls only if implemented; omit the reference's simulated test-connection action and false browser-session storage claims. Keep the shared paw, seven footprints, cat/platform and refined compact chat unchanged. Narrow layouts must retain access to every field and action.

- R14 (restrained visual refinement): Refine the compact composition with unified warm-white surfaces, warm dark text, fine borders and consistent low-elevation shadows. Replace four colored action blocks with aligned secondary actions; retain orange for the send action and small accents. Keep the already verified dimensions, existing actions, original cat/badge, footprint inventory and shell/platform geometry. Preserve focus, readable text contrast and reduced-motion support.

- R13 (compact composition refinement): The user rejected solving the empty lower area by only shifting controls downward. Rebalance the integrated compact header, composer and existing four quick actions as a whole; use a two-column action group, consistent insets and softer control styling. Preserve the approved cat, corner badge position/shadow, footprint inventory, shell/platform geometry and all business actions. Verify actual compact layout and navigation before delivery; do not introduce filler text, new actions or fabricated service data.

- R12 (reference completeness correction): Include the approved HTML's decorative footprint trail: five side/lower shell prints and the two expanded footer prints. These are distinct from the preserved top-left paw badge. Use the reference four-toe silhouette and geometry-relative anchors, retain decoration-only semantics, and keep the badge's placement/shadow unchanged.

- R10 (latest approved HTML): `references/preview-v2-approved.html`, copied from Downloads/preview (2).html, supersedes earlier tail-only visual references. Migrate its parameterized continuous shell, warm layered border/background and integrated pet platform to the reusable component for compact/expanded attached frames; keep standalone usable. Preserve the existing paw artwork, frame-relative position, size and exact shadow. Preserve existing chat/settings/todo data and actions; reference demo adapters/replies, wallpaper and new controls are not product requirements.
- R11 (rollback): User explicitly authorized local Git initialization and a baseline commit before visual edits. Completed on main as e773d91. This supersedes earlier instructions that reflected the absence of Git.

- R9 (user-requested tail configuration): Move the default tail slightly down and make it smaller. Expose typed vertical/horizontal position and width/height configuration on the public frame, usable across compact and expanded modes. Preserve the shared paw/corner geometry and attached-only tail rendering.

- R8 (latest user correction): Use references/paw-corner-approved-v2.png as the definitive visual reference. Unify the painted top-left corner arc and badge as one shared component contract. Matching badge box offsets while retaining different corner curves does not satisfy the request.

- R7 (2026-09-07 user clarification): In every compact/expanded, attached/standalone and settings surface, the paw badge must overlap the top-left rounded corner exactly in the manner of references/paw-corner-approved.png. Use one frame-relative size/anchor, independent of title/header flow; reserve text clearance and prevent clipping. This explicitly replaces the previous per-mode badge treatment.

- R1：气泡框拥有边框、背景、圆角、阴影、标题栏、徽章、尾巴、装饰、内容分区和自身动效；样式由组件导入，选择器以组件根节点为边界。
- R2：显式区分紧凑/展开、贴宠物/独立外观、可见性、是否播放入场动画。关闭动画时仍可见；隐藏时内容不可交互，不残留键盘焦点。
- R3：通过标题、副标题、操作区、主体和可选底部插槽复用；无障碍名称随标题或显式配置变化。组件不硬编码聊天/设置业务，也不调用 AI 或 Tauri 窗口 API；标题栏拖拽由调用方显式启用。
- R4：宿主仅负责桌面坐标、可用尺寸、与白猫的层级以及原生窗口缩放时序。迁移 App 与 ChatPanel 后，气泡内部样式不依赖 pet-shell、pet-chat-* 或 chat-window-app 祖先。
- R5：保持当前紧凑聊天、展开聊天、设置界面及独立聊天窗口的行为；输入、快捷提问、关闭/Escape、流式消息、错误提示、设置返回和保存均不得回归。保留已确认角色和视觉比例。
- R6：更新受迁移影响的校验脚本及组件规范，记录接口、样式归属、使用方式和验证证据。不得新增假消息、假模型、假连接或模拟服务来完成验收。

## Acceptance Criteria

- [x] AC15 / R15: Browser shows the reference-derived connection/status/guide/security layout with true unconfigured state; help, credential visibility, required validation,500px stacking and settings return/reopen pass. Shared badge geometry and seven prints are preserved. Source review confirms native save/credential contracts and QA submit protection; TypeScript/Vite build and local Tauri packaging pass. Native bundled-page loading was verified; actual settings save/model invocation was not exercised. See reference-v2-verification.md.

- [x] AC14 / R14: Unified warm-white action surfaces and left-aligned labels are visible in the browser; text contrast, focus and reduced-motion checks pass. Frame/input dimensions, badge geometry/filter and footprint count remain unchanged. Scoped review and static checks pass; the local bundle was updated and restarted. Open-frame visual evidence remains browser-only; see reference-v2-verification.md.

- [x] AC13 / R13: Browser verifies an88px header,78px input,14px group gap and aligned two-column quick-action group in the unchanged475×278 shell; all existing prompt actions, keyboard focus, settings return and hide/reopen pass. Preserved paw geometry/filter and five footprints verified; scoped review and static checks pass. Updated local package loads successfully; native open-frame automation remains unavailable. See reference-v2-verification.md for the evidence boundary.

- [x] AC12 / R12: Integrated compact/expanded chat renders five reference footprints; expanded frames without a footer slot (settings/todos) render seven including the bottom prints. Browser screenshots confirm visible placement without content obstruction and unchanged top-left badge bounds/filter. Geometry/static checks and read-only review confirm dock-relative anchors, instance-scoped symbols, no pointer interception, and unchanged standalone/legacy behavior. See reference-v2-verification.md.

- [x] AC10 / R10: Compact chat, expanded chat/settings/todos share the reference's continuous frame/platform geometry. Four browser surfaces measured unchanged paw position/size/filter; neutral-host resize, unique SVG IDs, explicit decoration compatibility and hidden/standalone checks passed. Native navigation and the new packaged entry were verified. See reference-v2-verification.md for actual unavailable todo-preview state and native/service evidence boundaries.
- [x] AC11 / R11: Initialized local Git and committed baseline e773d91 before modifying visual source. Private .env/runtime data, dependencies and verification artifacts are ignored. No remote publication requested.

- [x] AC9 / R9: Defaults render lower/smaller in compact and expanded; explicit tail top/right/width/height values override mode defaults and survive switching modes. Browser React controls demonstrate changing all four values and resetting defaults; tail/frame join and unchanged paw geometry verified. See tail-config-verification.md (browser and static evidence).

- [x] AC8 / R8: At the same CSS scale, standalone/attached compact/expanded and settings all show the approved 72px top-left corner arc under the shared paw. Inspected screenshots for actual background clipping/radius normalization and title clearance, including short-content minima. See paw-shared-geometry-verification.md for the latest evidence; prior coordinate-only acceptance is insufficient.

- [x] AC7 / R7: Browser measurements across all four appearance/variant combinations plus settings show the same frame-relative badge size and offset (allow at most 1 CSS px border rasterization difference), including after changing title text and reopening. Screenshots match the approved corner-overlap treatment; badge never overlaps title text or gets clipped. See paw-corner-verification-2026-09-07.md: all measured x5.109375/y-4, size53.296875×59.265625 CSS px.

- [x] AC1 / R1、R3、R4：在无桌宠祖先类名的普通容器中引用气泡框及其自带样式，标题、插槽、边框、装饰和两种尺寸模式正常展示；验证只使用中性插槽或真实空状态，不生成聊天数据。（浏览器层通过，证据见 verification-2026-09-07.md）
- [x] AC2 / R2：可见但无入场动画、可见且有动画、隐藏三种状态独立工作；隐藏不接收指针或 Tab 焦点，重新打开恢复输入聚焦；减少动态效果系统设置下保持可用。（浏览器层通过；WKWebView 原生 inert 行为待真机确认）
- [ ] AC3 / R4、R5：真实桌面点击白猫打开紧凑框，快捷提问填入输入框；关闭和 Escape 收起；打开设置、返回、再次打开连续操作无闪白、截断、位置跳变或失效控件。（未验证：验证期间桌面 Space 被占用且并行会话正在重建应用，见 verification-2026-09-07.md）
- [ ] AC4 / R5：实际配置可用时验证紧凑发送收起及真实流式宠物回复、展开模式消息展示；设置保存仍正确返回。未配置或服务失败时只展示实际空/错误状态，分别注明未验证的 AI 和保存链路，不宣称通过。（未验证：本机无已配置服务）
- [ ] AC5 / R1、R5：紧凑、展开聊天、设置及独立窗口外观均无布局回归，错误内容与操作区不重叠；白猫原图与窗口尺寸契约保持一致。（fixture 三表面通过；真实运行时逐项比对未完成）
- [x] AC6 / R6：相关轻量资源/结构校验通过，前端编译通过一次；交付清楚区分源码检查、静态/fixture 外观检查、真实桌面交互和真实模型调用。

## Out of Scope

- 新增聊天功能、持久化、工具调用、附件、语音、模态遮罩、点击外部关闭或新导航。
- 修改 AI 协议、服务配置、Rust 窗口尺寸、宠物角色资源或扩大到通用组件库/新设计系统。
- 将现有其他 Trellis 任务一起归档或发布远端；用户已授权本地 Git，回退点为 e773d91。

## Current Status

2026-09-07 用户批准修复 review-2026-09-07.md 的问题。四项封装缺陷与 QA 旧调用契约均已修复，独立组件浏览器矩阵、空状态导航、编译和静态校验通过；最新证据见 remediation-2026-09-07.md，其结果取代先前浏览器验收中的不足。

AC3–AC5 的真实原生窗口与服务验收仍未闭合，任务保持 in_progress。并行 agent-desktop-client 已更新聊天发送/设置业务；本次只修封装与 QA，未回退该任务的行为，也未把浏览器验证认定为真实模型验证。
