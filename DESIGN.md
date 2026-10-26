---
name: 橘伴 Desktop AI Pet
description: 白猫陪伴与独立工具面板——自然的角色表情、暖白表面、石墨灰文字和轻量桌面控件。
colors:
  primary: "#353734"
  ink: "#353734"
  muted-soft: "#6d716b"
  surface-cream: "#fffefd"
  surface-list: "#f4f4ef"
  rule: "#e3e4de"
  input-bg: "#f4f4ef"
  input-focus: "#74786f"
  selection: "#ece4d9"
  danger: "#b42318"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.9em"
    fontWeight: 400
rounded:
  frame-corner: "16px"
  input: "12px"
  bubble: "12px"
  icon-tile: "8px"
  send-button: "8px"
spacing:
  panel-inset: "14px"
  reading-inset: "18px"
  group-gap: "12px"
  tight-gap: "6px"
components:
  send-button:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "8px"
    size: "32px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted-soft}"
    rounded: "8px"
    size: "32px"
  input-capsule:
    backgroundColor: "{colors.input-bg}"
    textColor: "{colors.ink}"
    rounded: "12px"
  message-bubble-assistant:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "0px"
    padding: "0px"
---

# Design System: 橘伴 Desktop AI Pet

## Current authority

**安静住在桌面上的白猫。** 2026-09-26 用户认可独立桌宠与工具面板的方向，继续要求显著提升美观度。用户随后确认宠物已经满意，并要求大幅优化操作按钮和面板。本规范是当前 companion 主入口的视觉依据；用户明确否定随后交付的石墨灰效率工具风格，要求和猫同色系、可爱且Q。最新执行范围见 `.trellis/tasks/09-14-companion-product-refactor/warm-companion-theme-2026-09-26.md`，覆盖此前冷静灰阶的视觉规定。猫的素材、姿态、表情和动作冻结。

保留白猫身份、轻点回应、明确聊天入口、独立阅读面板。视觉从猫的奶白毛色、浅杏橘毛尖、粉润耳朵和琥珀项圈延伸到界面：奶油白底、杏橘控件、暖可可文字、柔软圆润轮廓。可爱感是本轮明确目标；不能再回到石墨主按钮、绿灰输入框和黑色下划线导航。原始资产和 reference/animated 兼容入口仍保留；管理后台继续使用自身的操作界面规范。

桌面只有一个白猫主体。不开盘子、爪印外框、心形、星星、常驻状态牌；标题猫爪沿用用户更喜欢的旧版 `ReferencePawBadge`：奶油色贴纸外形、浅橘肉垫、三个趾垫，保持125:139比例缩小到标题内；不加通用方形底座，面板中不放猫头像或第二只猫。服务连接情况进入对话和设置，休息通过闭眼表达。未连接模型时不生成假回复。

## Color and type

当前配色由 `src/design-tokens.css` 中的 `--companion-*` 定义，并在 `.chat-panel.is-companion` 映射到已有组件变量。猫脚边的操作条使用同一套颜色。

| Token | Value | Use |
|---|---|---|
| `--companion-ink` | `#6c4631` | 暖可可正文与标题 |
| `--companion-muted` | `#8b6753` | 暖棕次级文字、时间、图标 |
| `--companion-surface` | `#fffaf4` | 奶油白面板 |
| `--companion-chrome` | `#fff0dd` | 轻杏色输入与辅助表面 |
| `--companion-line` | `#eed8bf` | 必要分隔、输入边界 |
| `--companion-accent` | `#a45b2b` | 暖橘强调与链接 |
| `--companion-action` | `#f4bd7e` | 杏橘主动作背景 |
| `--companion-action-ink` | `#704021` | 浅橘按钮上的深可可文字与图标 |
| `--companion-action-hover` | `#efb174` | 主按钮悬停 |
| `--companion-focus` | `#ae6739` | 键盘焦点 |
| `--companion-selected` | `#ffe4bf` | 当前导航和轻量选中面 |
| `--companion-user` | `#ffeadb` | 用户消息蜜桃色表面 |
| `--companion-selection` | `#ffe4bf` | 文本选择 |

界面和猫使用同一暖色世界。主动作是杏橘色小软糖般的按钮，配深色图标保证可读；辅助文字仍从暖棕色中取色。成功、警告和错误色只承担真实状态语义，不用可爱文案替代错误说明。全局兼容 tokens 与 companion scoped tokens 仍各有归属。

使用圆润系统字体 `ui-rounded, 'SF Pro Rounded', -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif`；代码区使用等宽字体。面板标题15px/600，正文14px/400，导航13px/500，说明与控件12px/400，选中态600。内容空态标题16px/600。中文不做装饰性字距，强调集中在短标题和当前动作，不添加 eyebrow/kicker。

## Geometry and rhythm

主窗口基准232×340，只有用户选择80/100/120%时缩放。猫保持同一大小，聊天开合不改变主体。猫脚边保留“聊一会”主按钮与低权重菜单入口，点击目标至少32px；主按钮使用杏橘填色、深可可图标与胶囊轮廓，不额外包一层白色卡片。猫本身的位置、比例与动作不改；休息不额外挂常驻文字。

聊天承载窗口至多720×680，按工作区收敛；紧凑内容至多420×380。优先放猫左侧，按可见猫轮廓收近；透明窗口允许重叠，原生间距与尾巴伸出配对：宠物逻辑比例为s时，左侧为-(8+44s)px、右侧为-(20+60s)px，屏幕安全边距仍为12px。空间不足则调整侧向或钳制。紧凑内容对齐靠近猫的一边，阅读展开利用承载窗内部空间。外框24px圆角，常规内边距14–18px。2026-09-26 用户进一步要求猫与面板建立可见联系：面板朝向猫的一侧使用短而圆润的奶油色话泡尾巴，朝向既定猫素材的鼻口位置；不引入共享底盘。

用户随后否定10px的小凸角及大面积投影。当前话泡角按宠物比例伸出：左侧44s px、右侧60s px，底高48px；旧宿主无长度元数据时兼容28px，采用圆润弧线与面板构成一个完整轮廓；统一细杏色边缘与很轻的偏移阴影，不再分别给矩形面板和角投影。保留16px绘制安全边距，朝猫一侧按原生tailReach为角预留空间，确保阴影在透明窗口内完整收尾。紧凑面板仍至多420×380，阅读状态利用扣除绘制边距后的空间。它是装饰，不扩大鼠标命中区域；猫的位置与比例保持不变；只按 `companion-distance-2026-09-26.md` 调整聊天窗口横向间距。没有有效原生锚点时保留原有布局并隐藏角，回退面板也只用小阴影。展开仍以猫这一侧为原点、180ms缓出，不阻塞显示或输入；减少动态效果时禁用空间变化。当前执行约束见 `companion-tail-shadow-2026-09-26.md`。

面板头部承载当前标题与设置、展开阅读、关闭。其下是固定的“聊天／待办／备忘录”图标与文字胶囊导航，杏橘选中项清楚可见；重复点击当前项不跳转。设置独立于日常工具，Escape回到进入设置前的页面；显式“聊天”导航回对话。尺寸切换称为“展开阅读／收起阅读”，真正的历史加载仍在消息区。导航采用独立柔软胶囊，不用黑色下划线或铺满宽度的灰色分段大容器。

## Surfaces and controls

- 话泡主体与角只投影一次：暖棕、3px下移、4px模糊的轻阴影。原有14px偏移/32px模糊会被透明承载窗口裁成矩形，不再使用；阴影不得越出绘制安全边距。
- 猫操作条共用 `--companion-shadow-soft`：暖棕轻投影。
- Lucide 图标为14–16px、约1.7线宽，按钮通常32px以上。实线2px焦点轮廓仍清楚可见。
- 紧凑输入与发送并排，一行起步自然增长；阅读状态保留书写区域和底部动作行。发送采用杏橘填色、可可色 ArrowUp；输入面20px圆角，焦点清晰、描边轻。断连说明与恢复入口集中在输入附近，离线仍可编辑草稿，发送保持真实禁用。
- 助手消息直接排在阅读面上，保留作者、时间、工具与错误归属；用户消息使用柔和蜜桃色圆润气泡。避免每条回复再套卡片。
- 同一次请求的相邻问答靠近，不同轮对话留出清楚间隔；作者与时间分出轻重。真实生成期间，回复头部持续显示当前状态，完成后移除。长回复用克制的标题、暖色列表标记和引用建立阅读层级；表格正文13px、浅暖表头、轻行线，紧凑视图允许表格独立横向滚动，避免把短标签挤成碎字。
- 原生桌宠菜单保留 macOS 系统菜单外观；只给入口与浏览器备用菜单统一暖色主题，不为染色重建已验证菜单。
- Todo、Memo、设置与提醒使用同一字号、奶油杏橘色系和柔软控件语言。待办保留轻量快速录入；备忘新建表单按需在页面内展开，收起保留未提交草稿，Escape优先退出编辑。设置先展示实际连接情况，再提供配置编辑；保存成功与连接成功分开表达。
- 聊天空态采用亲切的短邀请和奶油色圆角草稿建议，排布紧凑有重心；不填充样例消息、统计或装饰插画。断连原因只出现一次；提醒同步失败收成可检查详情的摘要，实际到期事项和写入失败不能被折叠规则吞掉。正文14px，次级说明仍需易读。
- 输入区从一行自然增长；离线时说明可以先写，不能仍显示可直接发送的快捷键承诺。待办、备忘加载失败时，重试和连接设置紧挨错误；不能保存的原因放在按钮附近。设置页以当前连接开头，暂时隐藏日常提醒；从工具页检查连接再返回时保留未提交草稿。辅助文字最低12px，待办完成按钮维持44px点击区。

## Motion and expression

猫的局部动作表达回应与休息，界面本身不呼吸。动作沿用120/180/240ms与指数缓出；休息小幅呼吸保持在既定窗口内，reduced-motion关闭空间动效。

睁眼和自然闭眼使用已注册的同一坐姿素材。先预加载闭眼图，再切换一个图像源；不叠加两只猫、不以不透明眼睑贴片盖住眼睛。随机眨眼只在可见且允许动效时运行，休息一直保持到真实用户活动；保留计时器清理和辅助功能唤醒标签。

## Non-negotiable rules

- 保留已确认白猫身份和原始资产。新的表情与构图允许使用可溯源派生图。
- 点猫先得到宠物回应；聊天入口明确，拖动与点击区分。
- 不把技术错误或虚假连接包装成陪伴话术。
- 不重建连续底盘、装饰猫台、重复头像或常驻休息标签。
- 不用彩虹 chip、回弹动画、满屏粗体或层层描边制造“精致”。
- 悬浮位置、隐藏恢复、草稿、历史、流式与工具行为服从可执行规范，不因视觉改动退化。

## Runtime ownership and interaction contracts

- `src/design-tokens.css` owns shared colors, type scale, spacing, radii, shadows, layers and motion. `src/styles.css` retains reset, global focus/scrollbars and compatibility pet styles.
- `src/desktop-shell.css` owns independent pet/panel placement and available-space layout; component styles own their content. The companion frame does not render the legacy continuous disk.
- Conversation shows the most recent 40 messages initially. Earlier history is accessible with scroll anchoring. Unchanged messages retain identity; historical Markdown is memoized.
- Streaming leaves the next draft editable while sending stays guarded by acknowledgement and run state. Tool progress and terminal errors belong to the relevant run.
- Expanding/collapsing while reading preserves the visible paragraph, heading or table row across text reflow; readers already following the latest reply stay at the bottom. Preserve new user reading intent over a pending restoration.
- Escape closes the innermost editor first, then returns from a secondary view, then closes chat. Todo refreshes preserve active edits; destructive row actions await persistence.
- Settings distinguish editing, saving, saved and connected. Model-list results are fenced against configuration changes and unmounts.
- Motion uses 120/180/240ms durations and cubic-bezier(.16,1,.3,1), with a 160ms exit. Spatial motion is disabled for reduced-motion users. No native resizing per animation frame. The companion cat owns local reaction and sustained resting feedback; the UI frame does not breathe. Motion stays inside the selected main-window size and spatial effects are removed under reduced motion.
- The independent service administration app keeps its operator-oriented design; native dialog focus, mobile navigation and readable error states use the same interaction discipline.

These describe implementation contracts. Builds, isolated tests, browser previews and native runtime observations must be recorded separately in the task acceptance ledger.

## Companion asset provenance

`public/pets/white-cat-companion/idle.png`、`sleeping.png` 与 `idle-mask.png` 由内置 image_gen 基于已确认白猫生成。两个表情图都是1207×1303 RGB，棋盘格不是透明通道，必须经同一 luminance matte 渲染。只显示一个表情源，原始参考资产保持不变。

每张 PNG 都嵌入生成提示词，`provenance.json` 记录精确提示词和来源；闭眼生成词另存 `sleeping-prompt.txt`。不能把未遮罩 RGB 直接当透明精灵显示。构图/表情批准不等于运行验收，最终原生观察单独记录在任务证据中。

## 图片导入时的 AI 视觉主题（2026-10-03）

本节覆盖自定义桌宠的固定配色选择方向。用户明确要求 AI 看上传图片，设计配色、面板质感和控件风格。固定六套搭配、浓度滑杆和事后调色不再是主流程；不能更名后重新引入。默认白猫、已有宠物资产与保存主题保持兼容。

定制页面属于 Operate：选择参考图片 → 自动设计 → 看见与图片相邻的完整样式预览 → 生成宠物 → 保存/应用。AI 提供主题名、简短设计说明、多角色颜色以及受限的材质、圆角、边线、阴影和按钮风格。颜色来自模型对图片的设计判断，不把本地像素分析冒充 AI。亮面、纸感和柔雾材料只能在既有面板几何与性能边界内呈现，保持可爱、轻盈、可读，不增加装饰底盘或重复头像。

主题预览使用实际组件样式并标明“样式预览”，文字不是聊天记录。图片移除/替换立即失效旧结果；正在设计、失败原因和显式重试清楚可见。导入前说明图片发送的当前分析服务、模型和一次请求；后续四状态生图独立计数。没有成功模型结果时不能显示假成功主题。

草稿只影响预览；保存/应用同步桌面两窗口。AI 结果只能进入受校验的颜色与样式白名单，文字/焦点对比度由本地保护；不执行模型提供的 CSS、HTML、URL。原猫爪继承主题，已生成猫爪保留真实图像。模型结果与规范化图片绑定，生成宠物完成后保存同一主题，不由主形象取色覆盖。


## 本轮显示优化的执行约束

轻量表面保留当前主题色：辅助面混入45%的chrome、用户气泡混入65%的user，
工具卡片再减轻到65%的辅助面。正文14px、操作点击区至少32px。
紧凑420x380面板采用40px头部、34px导航、一行52px输入区的高度预算；
多行和真实异常允许占用更多高度，最终阅读空间增幅须用原生运行测量。
窄屏的原生间距、正文预留和tailReach使用同一判定，0表示明确取消装饰与额外预留。
左右正文都不足320px时，优先在猫上方或下方放置至少352×352的承载窗口，
与猫矩形保持8px间隔；没有足够完整空区时沿用可读宽度优先的屏幕内回退。
无效但有限的连接点只隐藏尾巴，不能释放原生间距已经消费的正文预留。
工具的执行状态和待办业务状态分别表达；查询显示“已查询”，创建显示“已记录”，
真实完成待办且返回状态确认后才显示“待办已完成”。提醒时间附带时区。
每次交付前由未参与实现的独立agent评估真实画面与交互，静态通过单独记录。
