---
name: 橘伴 Desktop AI Pet
description: 桌面 AI 白猫的聊天面板/气泡视觉系统——奶油色一体外壳延续到面板内部的暖调材质。
colors:
  primary: "#a45831"
  send-orange: "#e8793b"
  ink: "#493b31"
  ink-deep: "#431407"
  muted-soft: "#796959"
  surface-cream: "#fffdfa"
  surface-list: "#f9ecde"
  rule: "#eadfd4"
  rule-strong: "rgba(155, 120, 94, 0.22)"
  border-peach: "#fed7aa"
  danger: "#b42318"
  info-blue: "#0f7d91"
  input-bg: "#fffdf9"
  input-rule: "rgba(172, 144, 122, 0.45)"
  input-focus: "rgba(165, 106, 72, 0.65)"
  input-focus-ring: "rgba(165, 106, 72, 0.1)"
  primary-hi: "#bd7145"
  success: "#76996c"
  success-ink: "#526c44"
  success-bg: "#f2f6e9"
  success-rule: "#d8e1c6"
typography:
  display:
    fontFamily: "Nunito, ui-rounded, 'SF Pro Rounded', -apple-system, sans-serif"
    fontSize: "21px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Nunito, ui-rounded, 'SF Pro Rounded', -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Nunito, ui-rounded, 'SF Pro Rounded', -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Nunito, ui-rounded, 'SF Pro Rounded', -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.6
  caption:
    fontFamily: "Nunito, ui-rounded, 'SF Pro Rounded', -apple-system, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.5
  body-sm:
    fontFamily: "Nunito, ui-rounded, 'SF Pro Rounded', -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.65
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.9em"
    fontWeight: 400
rounded:
  pill: "999px"
  send-button: "16px"
  input: "12px"
  icon-tile: "10px"
  bubble: "17px"
  bubble-corner: "6px"
  frame-corner: "72px"
spacing:
  panel-inset: "22px"
  group-gap: "12px"
  tight-gap: "6px"
components:
  send-button:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "16px"
    size: "48px"
  icon-button:
    backgroundColor: "{colors.surface-cream}"
    textColor: "{colors.muted-soft}"
    rounded: "10px"
    size: "44px"
  quick-prompt-chip:
    backgroundColor: "{colors.surface-cream}"
    textColor: "#695345"
    rounded: "{rounded.pill}"
    padding: "0 11px"
  input-capsule:
    backgroundColor: "#fffdf9"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  message-bubble-assistant:
    backgroundColor: "{colors.surface-cream}"
    textColor: "{colors.ink}"
    rounded: "{rounded.bubble}"
    padding: "12px 15px"
  pin-badge:
    backgroundColor: "#fff1e2"
    textColor: "#96755a"
    rounded: "{rounded.pill}"
    size: "26px"
---

# Design System: 橘伴 Desktop AI Pet

## Overview

**Creative North Star: "奶油糖壳里的猫"（The Cream Shell）**

一体 SVG 奶油渐变外壳（连续描边、底盘、脚印）是视觉权威；面板内部的每一个表面——消息气泡、列表底色、输入胶囊——都延续同一套暖调奶油材质，而不是在边界处切换成"后台管理系统"的平涂米白。密度上偏松弛：紧凑态 475×278 是克制的对话入口，展开态才承载完整阅读。美学哲学是"陪伴感优先的工具"：控件安静、圆角柔软、动效从已可见状态指数缓出，唯一允许喧闹的是猫本身。

已确认的视觉拒绝：彩虹糖果色 chip、回弹（overshoot）缓动、面向用户的技术词汇（invoke 报错、GMT+8）、裸色 3px 侧边条。

**Key Characteristics:**
- 奶油渐变材质从外壳贯穿到内部气泡与输入框
- 一套控件语言：带框暖白图标按钮 + 胶囊输入 + 单一强调色发送键
- 中文排版阶梯：800（面板标题）/ 700（卡片标题与主按钮）/ 600（标签）/ 500–400（正文）
- 品牌时刻留给空状态与猫：白猫帧资产直接出场，不加几何遮罩

## Colors

暖调奶油色系，强调色只有一个焦橙家族；灰阶全部偏暖，不用中性灰。

### Primary
- **焦糖橘（Caramel Orange）** (#a45831): 发送按钮、聚焦环、勾选态。面板里唯一的高饱和色。
- **蜜橘（Honey Orange）** (#e8793b): 紧凑态发送键渐变亮端、空态强调文字。

### Neutral
- **深可可（Deep Cocoa）** (#431407): 全局最强文字色（:root --ink-deep）。
- **墨棕（Ink Brown）** (#493b31): 面板正文色（--pet-ink / --ink）。
- **柔灰棕（Soft Muted Brown）** (#796959): 次级文字、占位符、时间戳——在奶油底上 ≥5.1:1，是 WCAG AA 的 muted 基准（--muted-soft）。
- **奶油面（Cream Surface）** (#fffdfa): 气泡与输入框表面（--pet-surface）。
- **暖分隔线（Warm Rule）** (#eadfd4): 1px 分隔与卡片描边（--pet-rule）；需要更可见时用 rgba(155,120,94,0.22)（--rule-strong）。
- **蜜桃描边（Peach Border）** (#fed7aa): 外壳与宠物状态胶囊的描边。

### Named Rules
**The One Voice Rule.** 强调橘在任何一屏占比 ≤10%；它的稀缺性就是重点。次要操作一律暖白底 + 棕字。
**The Warm Gray Rule.** 次级文字从暖棕取色（--muted-soft），禁用中性灰；彩色表面上的次级文字从该色相或前景色调出。

## Typography

**Display/Body Font:** Nunito → ui-rounded / "SF Pro Rounded" → 系统圆体（当前运行时实际命中系统圆体；字栈表达设计意图）。
**Mono Font:** ui-monospace / SFMono-Regular → Menlo（仅用于代码块与数据，不作装饰）。

**Character:** 圆体无衬线配中文系统字，字重对比承担层级，不用字间距拉开的中文大写式排版。

### Hierarchy
- **Display** (800, 20–21px, -0.01em): 紧凑面板标题（"想聊点什么？"）。
- **Title** (700, 16–18px, -0.025em): 展开面板标题、空态标题、卡片标题。
- **Body** (400–500, 13–15px, 1.4–1.7): 消息正文、表单输入；消息气泡行高 1.7。
- **Label** (600, 11–12px): 作者名、时间戳、工具条、计数。

正文以下字号落实为 :root tokens：`--text-body` (14px)、`--text-body-sm` (13px)、`--text-label` (12px)、`--text-caption` (11px)。紧凑态副标题 9px 是参考稿量定的几何绑定例外。

### Named Rules
**The Weight Ladder Rule.** 面板与设置页字重只取 400 / 500 / 600 / 700 / 800 五档；不再出现 520/650/680/720/750/760 这类中间值（宠物舞台侧 PetLiveStatus 的 750 是任务前遗留，不在面板范围内）。
**The No-Eyebrow Rule.** 标题上方不放 kicker/eyebrow 小标签；标题自己承担重量。

## Layout

桌面定宽是有意设计：紧凑 475×278、展开 940×760（native 场景），面板内容 inset 22px（展开）/ 16–19px（紧凑胶囊）。消息流左对齐助手、右对齐用户；待办行 44px 完成控件 + 内容 + 提醒 chip + 悬停操作。组内紧凑（6–8px gap），组间宽松（12–22px）。

## Elevation & Depth

分层 = 柔和投影 + 内高光，不用硬边投影。气泡与卡片：低位偏移阴影（0 4px 14px rgba(92,61,41,0.06)）+ inset 0 1px 0 白色高光，营造"奶油表面微微鼓起"的触感。外壳本体：0 18px 44px 大柔影。

### Shadow Vocabulary
- **surface-lift** (`0 4px 14px rgba(92, 61, 41, 0.06), inset 0 1px 0 rgba(255,255,255,0.8)`): 消息气泡、带框图标按钮。
- **panel-ambient** (`0 18px 44px rgba(99, 62, 38, 0.18)`): 外壳级投影，仅框架使用。
- **send-lift** (`0 3px 7px rgba(174, 91, 42, 0.14), inset 0 1px 0 rgba(255,231,208,0.4)`): 发送键。

### Named Rules
**The Declare-Elevation-Once Rule.** 同一元素要么 1px 描边要么宽柔影为主，不叠加出"幽灵卡片"；本系统的答案是：细暖描边 + 低位柔影 + 内高光，三者各司其职。

## Shapes

圆角阶梯：胶囊（999px，输入/提醒 chip/pin 徽章）→ 输入与编辑器（12px）→ 消息气泡（17–18px，带 6px 小角指向说话者）→ 外壳角（72px 左上大弧 + 24–28px 其余角，几何绑定不可改）。描边一律 1px 暖调；禁止 >1px 的彩色侧边条。

## Components

### Buttons
- **Shape:** 发送键 16px 圆角方形（展开 48px）/ 紧凑态为 999px 胶囊内嵌。
- **Primary:** 焦糖橘渐变（linear-gradient(145deg, --primary-hi #bd7145, #a45831)）白字；紧凑紧凑胶囊态用蜜橘渐变。设置页主按钮（保存并连接）与发送键共用此语言。
- **Hover / Focus:** hover 加深一档；focus-visible 2px solid #a45831 外描边。active scale(0.96–0.97)。

### Icon Buttons
- **Style:** 带框暖白瓷砖——linear-gradient(145deg, #fffefa, #fcf7ef) + 1px var(--pet-rule) + 内高光 + 10px 圆角；展开 44px、紧凑 33px（紧凑几何是参考稿量定的绑定值）。
- **Hover/Active:** 描边加深 + 文字转 #a3653f。

### Chips
- **Style:** 快捷提问 = 单一暖白胶囊（无逐个着色），棕字 600，左对齐 icon+text。
- **提醒 chip:** 奶油底虚线（空）/ 实线（已设），逾期转 danger 红。

### Semantic
- **成功绿（Success Green）** (#76996c, --success): 连接状态点等成功指示；配套文字 --success-ink (#526c44)、底 --success-bg (#f2f6e9)、描边 --success-rule (#d8e1c6)。仅用于状态语义，不作装饰。
- **主渐变亮端（Primary Hi）** (#bd7145, --primary-hi): 主按钮焦糖橘渐变的亮端（linear-gradient(145deg, --primary-hi, --focus-accent)）。

### Inputs
- **Style:** 胶囊语言统一——composer 是准绳：--input-bg (#fffdf9) 底、1px --input-rule (rgba(172,144,122,0.45)) 描边、999px（行内编辑器 12px）、caret 焦糖橘。设置页（AssistantSettings）输入框与 composer 共用此语言。
- **Focus:** 描边转 --input-focus (rgba(165,106,72,0.65)) + 3px --input-focus-ring（同色 10%）外晕。

### Pin Badge
- **Style:** 26px（紧凑 22px）蜜桃小徽章，纯状态指示——不是按钮，无 hit area 暗示，role="img"。

### Message Bubbles
- **Assistant:** 奶油渐变面 + --rule-strong 描边 + surface-lift 阴影，6px 小角朝左下（指向猫头像）。
- **User:** 奶油橘渐变（linear-gradient(135deg, #fff1df, #fce5d0)）+ 内高光，小角朝右下。

### Empty State
- **Style:** 白猫帧资产（idle.png，72px，沿用舞台呼吸动效与投影）+ Title 标题 + muted 说明 + 唯一主按钮。不使用几何遮罩裁切猫。

## Do's and Don'ts

### Do:
- **Do** 次级文字与占位符用 --muted-soft (#796959)，奶油底上保证 ≥4.5:1。
- **Do** 新增面板内表面时延续奶油渐变叙事（暖调、内高光、柔影），并向 :root token 靠拢。
- **Do** 错误文案面向用户（"待办读取失败，可能是助手连接暂时中断。"），原始错误进 console。
- **Do** 动效用指数缓出（cubic-bezier(0.16, 1, 0.3, 1)）从已可见状态出发。

### Don't:
- **Don't** 给 chip/卡片逐个上彩虹色——一套暖白语言。
- **Don't** 用回弹（overshoot）缓动；宠物舞台的回复气泡是已记录的遗留豁免，不在面板内扩散。
- **Don't** 把状态指示器做成按钮尺寸/按钮形态。
- **Don't** 在标题上方加 eyebrow/kicker。
- **Don't** 改白猫三帧资产、外壳 SVG 几何、透明悬浮窗形态（PRODUCT.md binding）。
