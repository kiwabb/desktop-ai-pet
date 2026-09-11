# 设置页视觉收口（colorize/token 化）

## Goal

把 AssistantSettings（聊天面板内嵌设置页）的视觉语言归一到 DESIGN.md 体系：输入框采用胶囊语言、硬编码色值/字号/字重全部收敛为 styles.css :root tokens，消除 detect 的 design-system advisory 主要残留面。功能行为零变化。

## Background / Confirmed Facts

- 09-11-ui-polish 已完成聊天面板全量打磨，DESIGN.md / PRODUCT.md / .impeccable/design.json 已建立（焦糖橘 #a45831 主色、暖棕灰阶、字重阶梯 400-800、胶囊输入语言）。
- 终检遗留：AssistantSettings.css 输入框语言与硬编码色是 Theming 维度的主要残留面（detect advisory 主体）；AssistantSettings.css 当时不在打磨范围内。
- 终检另遗留（本任务顺带收口）：未知工具的 presentation degrade 分支直出英文裸工具名，加中文兜底。
- detect 已记录豁免：styles.css 宠物回复气泡 bounce 缓动（宠物舞台侧，不动）。

## Requirements

- R1 AssistantSettings.css 全部硬编码色值/字号/字重收敛为现有 tokens（不够用时按 DESIGN.md 规则新增 token 并记录回 DESIGN.md）。
- R2 设置页输入框/控件统一为 DESIGN.md 的胶囊语言与带框瓷砖按钮语言，视觉与聊天面板一致。
- R3 presentation 层未知工具 degrade 加中文兜底文案（tool-presentation.ts，契约 {name,status,text} 不变，vitest 断言同步）。
- R4 行为零回归：设置保存/校验逻辑不动，仅视觉与文案层。

## Acceptance Criteria

- [ ] `impeccable detect src` 的 advisory 中 AssistantSettings 相关项清零（或逐条记录豁免理由）；failure 命中维持仅剩宠物舞台豁免。
- [ ] 设置页截图（qa 预览夹具）与聊天面板视觉一致，主会话人工复核通过。
- [ ] `pnpm build`、`pnpm test` 全绿；cargo/pytest 不受影响。
- [ ] DESIGN.md 同步至最终状态。

## Out of Scope

- 宠物舞台与三帧资产；admin/ 管理台；新增设置项或功能改动。
