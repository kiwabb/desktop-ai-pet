# 气泡框完整抽象设计

## Latest Reference Migration (R10)

Source: `references/preview-v2-approved.html` (user selected Downloads/preview (2).html). The reference visual shell supersedes older separate-tail defaults. Keep the existing root paw geometry/shadow, title/actions/body/footer slots and behavior boundaries. Move a parameterized continuous outline, right-side contour and pet platform into the shared component, sized from its actual container; the host supplies desktop placement and pet alignment. Use unique SVG IDs per mounted instance. Standalone has no pet dock. Preserve explicit legacy tail configuration through a documented working compatibility path.

Expected source scope: ChatBubbleFrame and owned shell/geometry module; host style alignment; minimal PetStage presentation only if needed to avoid duplicate base; ChatPanel prop forwarding and existing QA/static checks. No model/config protocol, Rust resize timing, reference demo replies, wallpaper or new settings features. Preserve the existing white cat asset.

Baseline rollback: local main commit `e773d91`, created before source changes at user request. New changes are reviewed against this commit.

## Architecture

App（窗口、位置、请求状态）→ ChatPanel（聊天/设置业务与插槽内容）→ ChatBubbleFrame（可复用视觉容器）。PetStage 与气泡框保持同级，由宿主协调位置；气泡框不拥有宠物状态或原生 resize。

保留 ChatBubbleFrame.tsx 入口，新增同目录 ChatBubbleFrame.css，由组件直接 import。该文件只管理组件根类及后代，不引入 CSS 框架。当前规范的“唯一全局样式表”更新为有范围的例外：可复用气泡框自带命名空间样式，应用和业务样式继续保留 styles.css；不做全项目迁移。

## Component Contract

- Tail contract (user request): optional typed tail configuration for top/right and width/height. Top is the tail's vertical center relative to the frame padding box, so size changes do not silently shift its center. Numeric top/right are CSS pixels and CSS strings support percentages/calc; numeric width/height are CSS pixels. Partial configuration uses mode defaults; it changes decoration only, not window size. Compact target defaults center132px/right-16px/24×30px; expanded center67%/right-20px/30×36px (latest refinement: narrower rounded tip, seam-local outline, 1px frame-matched stroke and no separate shadow). Public overrides must win over all variant CSS and remain stable on variant switches. Standalone continues without a tail.

- Paw corner contract (user-approved 2026-09-07 reference): Render ReferencePawBadge directly under the frame root, positioned independently from the header. Keep a single 53.3×59.27 CSS px size and the approved compact corner anchor (approximately x+5px/y-4px relative to the frame outer box) across all modes and settings. Reserve title clearance separately. Decoration must neither clip nor intercept clicks, and must remain above the expanded header surface. Remove per-mode badge sizes and flex negative-margin positioning.

- variant: compact | expanded；appearance: attached | standalone。外观和尺寸状态来自组件 props，而非 App 祖先类。
- visible: 默认 true，独立管理可见性与交互；animateEntrance: 默认 false，明确只控制入场动效。可见性恢复时应能重播入场；关闭动画不隐藏。隐藏保留内容状态但不可聚焦/点击（hidden 或 inert 配合隐藏样式；检查实际布局和 WebView 支持）。
- title、可选 subtitle、可选 actions、children、可选 footer；ariaLabel 可选并回退到 title。提供 className/style 供宿主设置外部位置/尺寸；类型使用 React 标准类型。
- draggable: 默认 false；启用时才设置标题栏 data-tauri-drag-region。按钮维持交互区域，不扩大拖拽命中范围。
- 不向组件暴露 settings、模型、消息或发送事件。移除 contentKind 对业务种类的认识，设置页布局归 ChatPanel 插槽内容。
- 使用稳定 body/footer 容器承接 children，使气泡布局不依赖 ChatPanel 恰好返回几个 DOM 同级元素。紧凑状态保留现有标题/输入/快捷行比例，并给真实错误提示保留可见区域；内容长短变化不可覆盖输入和底部操作。

## Style Ownership

The frame also owns the painted corner: one 72px top-left radius controls its border/background and a full-size inner surface containing header/body/footer. This avoids short-header radius normalization. Enforce minimum frame/surface dimensions for adjacent radius sums. The attached compact surface retains visible overflow to preserve error/footer reachability; its transparent84px header ensures the outer frame alone paints the72px corner zone. Other short-header surfaces retain full-frame clipping. See references/paw-corner-approved-v2.png; equal paw offsets without equal curves were rejected by the user.

| Owner | Responsibility |
| --- | --- |
| ChatBubbleFrame.css | 自身 reset/box-sizing/继承字体兜底、外壳、标题、插槽布局、徽章/尾巴/爪印、入场和 reduced-motion |
| styles.css / ChatPanel 内容类 | message-list、composer、settings-form、quick-prompts 及其状态样式 |
| App 宿主样式 | 桌面锚点、宽高约束、z-index 和白猫位置 |

迁移前记录各模式最终生效规则；styles.css 存在多段重复覆盖，不能逐段复制后再改变级联顺序。收敛到组件状态选择器并删除已迁移规则，业务内容通过 ChatPanel 自身模式类表达。保留宿主显式布局类/变量，避免把桌面坐标作为所谓通用默认值写死到气泡框。

## Transition Mapping

App 保留 changePetChatMode 内 flushSync、invoke、waitForWindowPaint 及 transition guard。宿主将窗口缩放期映射为 frame visible=false，将 panelEntering 映射为 animateEntrance，移除宿主 CSS 对气泡内部隐藏的重复控制。打开前预挂载、缩放后显示的顺序必须保留；不改为 Portal 或独立弹窗。

ChatPanel 继续持有 draft/settingsOpen，App 继续持有 messages/streaming。紧凑/展开变化不改变状态归属。默认不新增组件内部计时器，优先用 CSS 动画和受控 props。

## Compatibility and Risks

- 主要风险是 CSS 级联、增加插槽包装后 grid/滚动高度变化，以及隐藏与原生缩放不同步。
- 迁移全部当前调用方（App、ChatPanel、qa/chat-preview）和源码字符串校验，不保留无消费者的旧 entering/contentKind 接口。
- 独立窗口和贴宠物窗口都在验收范围。现有 fixture 预览只证明外观；普通容器检查复用现有 QA 入口且使用中性插槽，不新增模拟服务。
- 真实模型验证使用已有配置；不打印 Key、不改地址、不为验证制造错误配置。没有可用服务时记录未验证范围。
- User authorized Git initialization; baseline e773d91 replaces the earlier no-Git constraint. Preserve other work and use scoped commits; no remote publication requested.
