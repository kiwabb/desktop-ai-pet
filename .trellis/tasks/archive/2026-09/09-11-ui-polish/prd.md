# UI 质感提升（Impeccable 诊断与打磨）

## Goal

引入 Impeccable 设计体系，先对现有 UI 做诊断（critique + audit），再按诊断结果打磨，让桌面宠物的 UI 达到"高级"质感。

## Background / Confirmed Facts

- 产品：桌面 AI 白猫（Tauri 2 悬浮桌面宠物 + 聊天 + 待办/提醒），README.md 有完整能力描述。
- UI 面三块：聊天气泡/面板（src/components/ChatBubbleFrame.tsx、ChatPanel.tsx）、宠物舞台与动效（PetStage.tsx、useFrameMorph.ts）、待办列表（TodoList.tsx、TodoReminders.tsx）。
- Impeccable v4.3.1 已装至 .agents/skills/impeccable/（项目级），含本地检测引擎。
- 有 qa/ 预览页（chat-preview、frame-preview、pet-preview）和 .playwright-cli/，可无头截图做视觉评审。
- 平台判定：Tauri webview 里的 React UI → impeccable 归为 web（原生壳包网页不算 native 设计语言）。
- 刚完成 09-10 插件化重构，前端展示层已是注册表结构；打磨需遵守 .trellis/spec/frontend/ 各规范，避免风格漂移。

## Requirements

- R1 建立 PRODUCT.md（产品事实）与 DESIGN.md（现任视觉系统记录）。
- R2 产出诊断报告：critique（层级/清晰度/情感共鸣）+ audit（a11y/性能/响应式，61 条确定性规则），覆盖三块 UI 面。✅ 已完成：research/diagnosis.md（11 张截图证据，8 条问题清单，Nielsen 25/40，audit 最弱维 Theming 1/4）。
- R3 打磨范围与方向由用户在诊断报告后确认，再进入实施。

## 诊断关键结论（2026-09-11）

1. 结构性鸿沟：外壳展示级（一体 SVG 奶油渐变外壳质感好）vs 内瓤工具级（平涂米白、1px 分隔几乎不可见，styles.css:453/587/871），材质叙事在边界断裂。
2. 空状态是 268px 文字孤岛（styles.css:325-335），分发产品的门面零品牌感。
3. 三处对比度不达 WCAG AA：空态正文 4.16:1（styles.css:335）、legacy tail 副标题 2.71:1（ChatBubbleFrame.css:251）、placeholder 2.46:1（styles.css:689）。
4. 两套控件语言并存（紧凑 33px 裸 glyph vs 展开 44px 带框按钮）；pin 是指示器却伪装成按钮（ChatPanel.tsx:309）；三种输入框语言并存。
5. 技术词汇泄漏（TodoList.tsx:69 直出 invoke 错误、TodoReminders.tsx:53 显示 GMT+8）；快捷提问 2×2 chips 是典型 AI slop 版式；styles.css:740-774 有一套未使用的彩虹 chip 死样式。
6. detect 61 规则仅 2 命中（MessageContent.css:10 引用块、styles.css:152 bounce 缓动）。

## Acceptance Criteria

- [ ] PRODUCT.md、DESIGN.md 存在且内容经用户确认。
- [ ] 诊断报告基于真实渲染截图（qa 预览页或运行中的应用），指出具体问题而非泛泛建议。
- [ ] 打磨实施完成后：audit 规则全过或遗留项有明确豁免理由；`pnpm build` 通过；前端 spec 符合。

## Out of Scope

- 宠物 PNG 美术资产本身的重绘（idle/blink/talk 三帧是外部资产）。
- admin/ 管理台 UI。

## Open Questions

- 用户与场景定位（自用 vs 分发）——影响验收标准。
- 品牌承诺与禁区（白猫形象、透明窗是否 binding）。
