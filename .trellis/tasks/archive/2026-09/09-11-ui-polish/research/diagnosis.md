# 聊天面板/气泡视觉诊断报告（09-11-ui-polish）

> 方法：单上下文诊断（本代理即子代理，无再下层 Task 工具；critique 手册要求的 A/B 双评估在此合并执行：先完成视觉评审，再跑确定性 detect，两者来源独立记录）。
> 目标面：`src/components/ChatPanel.tsx`、`ChatBubbleFrame.tsx`、`ChatBubbleShell.tsx`、`TodoList.tsx`、`TodoReminders.tsx` 及关联 CSS；证据截图见 `research/shots/`（01–11，含临时 mock 夹具渲染的有数据状态）。
> 评审基线：PRODUCT.md 品牌承诺 —— 白猫三帧与透明悬浮窗不可改，**聊天面板/气泡以"展示级精致"为目标大改**。

## 一、总体评价（当前质感水位）

**外壳是展示级，内瓤是工具级。** 一体外壳（ChatBubbleShell 的 SVG 连续描边、奶油渐变、底盘与脚印）和白猫同框的协调感已经到位，这是产品特有的、不可互换的视觉语言（截图 01/07）。但一旦视线进入面板内部——消息流、待办行、表单——质感立刻掉回"普通 Web 表单"：大面积平涂米白、近乎不可见的 1px 分隔线、两套并存的控件语言。外壳像奶油糖果，内部像后台管理系统，**材质叙事在边界处断裂**，这是当前与"高级/展示级"之间最大的鸿沟。

- Critique 维度（Nielsen 10 条，0–4）：总分 **25/40（Acceptable 上沿）**。最低分：#2 真实世界语言 2（"GMT+8"、原始 JS 报错直出）、#4 一致性 2（两套图标按钮/两套输入框语言）、#9 错误恢复 2（技术报错直接展示）。
- Audit 维度（0–4）：A11y **2**（三处对比度不达标、紧凑态图标 33px 触控区）、Performance **3**（大面积 backdrop-filter，但 morph 期间已做降级处理）、Theming **1**（`--pet-*` token 只在 ChatBubbleFrame.css 内成体系，styles.css/TodoList.css 大量硬编码 hex，无暗色模式）、Responsive **2**（桌面定宽为有意设计，但从略）、Implementation Integrity **3**（61 条规则仅 2 条命中，见第四节）。

## 二、问题清单（按严重度排序）

### P1-1 空状态是"文字孤岛"，第一屏没有门面感
- 证据：`shots/02-panel-expanded-empty.png` —— 展开面板约 640px 宽，空态正文被 `max-width: 268px` 挤成中央一条窄带，四周大面积死白。
- 代码：`src/styles.css:325-335`（`.empty-state` 居中网格 + 268px 限宽）；未配置分支在 `src/components/ChatPanel.tsx:400-407`。
- 影响：未配置状态是分发产品的第一屏，目前只有三行字 + 一个按钮，陪伴感/品牌感为零。
- 建议方向：空状态做"品牌时刻"——猫爪/星星插画（ReferenceIllustrations 已有资产）、分层文案（eyebrow/标题/引导/主按钮已有骨架，缺视觉载体）、让"配置助手服务"成为唯一的视觉焦点。

### P1-2 三处文本对比度不达 WCAG AA
- 证据与实测（对比度经脚本计算）：
  - 空态正文 `#7e746d` on 米白 = **4.16:1**（13px，需 4.5）— `src/styles.css:335`，截图 02。
  - 旧尾巴模式紧凑副标题 `#a59489` = **2.71:1** — `src/components/ChatBubbleFrame.css:251`。
  - 旧尾巴模式紧凑输入占位 `#b0a199` = **2.46:1** — `src/styles.css:689`。
- 建议方向：muted 色整体向 `#796959`（5.05:1，已达标）一档收敛；后两处属 legacy tail 路径，若不删旧路径就先改色。

### P1-3 消息区"洗白"：气泡与底色几乎无分隔
- 证据：`shots/09-panel-expanded-messages.png` 局部 —— 助手气泡白底 + `border: 1px solid rgba(108,88,74,0.09)` 在 `rgba(255,249,243,0.56)` 的列表底色上几乎隐形，整面阅读区像一张无格白纸，层级全靠头像位置暗示。
- 代码：`src/styles.css:448-455`（基础气泡）、`src/styles.css:587`（expanded 覆盖）、`src/styles.css:871`（message-list 底色）。
- 建议方向：加强气泡材质（更实的表面色/更明确的边/更厚的投影层级），或在列表底色与气泡之间拉开明度差；用户气泡的奶油渐变（styles.css:588）反而是全面板最有质感的一处，可作为基准。

### P1-4 同一组件两套图标按钮语言 + 伪按钮
- 证据：截图 01（紧凑：33px 裸 glyph）vs 截图 02/09（展开：44px 带边框渐变方块）；置顶 pin 与其他按钮等大等形但不是按钮。
- 代码：紧凑 `src/components/ChatBubbleFrame.css:263-273`；展开 `src/components/ChatBubbleFrame.css:495-500` + `src/styles.css:304-311`；pin 伪按钮 `src/components/ChatPanel.tsx:308-312`、`src/styles.css:645-653`。
- 影响：展开态图标 33px < 44px 触控标准（紧凑态更是 33px）；视觉语言在 morph 前后跳变，像两个产品拼的。
- 建议方向：统一为一种按钮语言（推荐展开态的带框款，质感更好），pin 改为明确的"状态徽章"样式（去按钮化：缩小/去 hit area 暗示/前置到副标题行）。

### P2-5 快捷提问是"通用 AI 产品"的图标格子
- 证据：`shots/01-panel-compact-attached.png` —— 2×2 等宽 chips + lucide 线性图标，是当下 AI 套壳产品最标志性的版式。
- 代码：`src/components/ChatPanel.tsx:354-361`、`src/styles.css:820-852`。另：`src/styles.css:740-774` 存在一套**已不被使用**的彩虹糖果色 chip 样式（黄/蓝/绿/紫），属风格漂移遗留。
- 建议方向：要么收敛为纯文字低调一行（quieter），要么做成有猫性格的东西（如猫爪形 chip、语气拟猫化文案）；删掉死样式。

### P2-6 技术词汇直接面向用户
- 证据：`shots/03-panel-todos-error.png` —— 待办错误态直出 `Cannot read properties of undefined (reading 'invoke')`；`shots/09` 提醒卡显示 `9月11日 GMT+8 18:30`。
- 代码：错误直出 `src/components/TodoList.tsx:67-70`（catch 后 `String(cause)` 原文展示，`.todo-list-notice.is-error`）；GMT+8 来自 `src/components/TodoReminders.tsx:53`（`timeZoneName: 'short'`）。同类：未知工具名回退为英文裸名 `src/lib/tool-presentation.ts`（`presentTool` 的 degrade 分支）。
- 建议方向：用户态错误文案与诊断信息分层（界面显示"助手连接异常，点刷新重试"，技术细节进日志）；时间格式去掉 GMT 后缀或改"今天 18:30"式相对表达。

### P2-7 输入控件语言不统一
- 证据/代码：composer 是 20px 圆角胶囊（`src/styles.css:878-886`）；待办添加框是 8px 方角白底棕边（`src/components/TodoList.css:188-199`）；提醒编辑框 6px（`TodoList.css:175`）；设置页又是另一套卡片内联框（`AssistantSettings.css`）。同一面板里四种输入语言。
- 建议方向：定一种"面板内输入"规范（圆角阶、边框色、聚焦环），全部归一。

### P3-8 其余小问题
- 工具结果条是灰底单行文字（`src/styles.css:1068`），信息层级弱，可与消息气泡做视觉关联（缩进/竖线引导）。
- 设置页主按钮内嵌两行文字（标题+副标题），按钮语义不纯（`shots/04`）。
- 入场动效 `cubic-bezier(0.22,0.9,0.28,1.08)` 带回弹（`ChatBubbleFrame.css:388`），略"tacky"，可换 expo-out。
- streaming/生成中状态只有一个 18px spinner，缺"猫正在想"的情感化线索。

## 三、正面发现（保持）

- 一体外壳 SVG 的描边叠层、底盘、脚印是强产品识别（`ChatBubbleShell.tsx`）；与白猫同框协调（`shots/01`）。
- 待办列表本体（`shots/10`）干净：行分隔线、悬停才显操作、逾期红 chip、已完成折叠组，信息设计成熟。
- a11y 骨架好于同类项目：aria-label 完整、focus-visible 有规范、prefers-reduced-motion 全面覆盖。
- 帧 morph 期间剥离 backdrop-filter/shadow 的性能处理（`ChatBubbleFrame.css:557-563`）是有意识的工程。

## 四、确定性 audit 命中表（impeccable detect，61 条规则）

| 规则 | 严重度 | 位置 | 摘录 | 判定 |
|---|---|---|---|---|
| side-tab（卡片单侧粗色边） | warning | `src/components/MessageContent.css:10` | `border-left: 3px solid #cba783`（markdown 引用块） | 真命中，P3：引用块改细线/缩短或去底色 |
| bounce-easing（回弹缓动） | warning | `src/styles.css:152` | `cubic-bezier(0.2,0.9,0.3,1.18)`（宠物回复气泡入场） | 真命中但属宠物舞台范围，记录待宠物侧处理 |
| 其余 59 条 | — | `src/`、`qa/` | 无命中 | — |

## 五、打磨机会点

**Quick wins（1–2 天内可见效）**
1. 对比度三处改色（P1-2）。
2. 删彩虹 chips 死样式 + 快捷提问改低调文字行（P2-5）。
3. 错误文案分层 + 去 GMT+8（P2-6）。
4. pin 伪按钮去按钮化（P1-4 的一半）。
5. 引用块 side-tab 修掉（audit 命中）。

**结构性改版（需要设计决策）**
1. 空状态品牌时刻（P1-1）——第一屏重新设计。
2. 消息区材质体系（P1-3）——气泡/列表底色/工具条的层级重新定义。
3. 控件语言统一（P1-4、P2-7）——按钮、输入框、图标按钮各定一规。
4. 色彩 token 化（Theming 1 分）——把 `--pet-*` 从 ChatBubbleFrame.css 提升为全局体系，消硬编码 hex。

## 六、推荐的下一步命令（排序）

1. **`$impeccable polish`** —— 主刀。带着本报告的问题清单逐项修：对比度、消息区材质、控件语言统一、死样式清理。
2. **`$impeccable typeset`** —— 中文排版节奏：标题字重阶梯（目前 720/750/800 混用）、时间戳与副文本的灰阶、空态文案层级。
3. **`$impeccable quieter`** —— 收敛：快捷提问、pin 徽章、header 图标数量与密度。
4. **`$impeccable delight`** —— 空状态/首屏品牌时刻、streaming 时的"猫在想"线索。
5. **`$impeccable colorize`** —— 若要 token 化再做；可与 polish 合并进行。
6. 修完后重跑 `$impeccable critique` + `impeccable detect` 复核分数与规则命中。

## 附：复现方式

- 截图脚本：`research/capture-shots.py`（Python playwright，dev server 在 1421 端口）。
- 有数据状态（09–11）依赖临时夹具 `qa/diagnosis-preview.html/.tsx`（mock `__TAURI_INTERNALS__.invoke` + 示例消息/待办；**临时文件，验证后可删**）。
- detect 原始输出：`research/detect-src.json`、`research/detect-components.json`、`research/detect-qa.json`。
