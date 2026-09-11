# 技术设计：聊天面板/气泡视觉质感打磨

对应 PRD：.trellis/tasks/09-11-ui-polish/prd.md；诊断：./research/diagnosis.md（含 11 张证据截图与 file:line 锚点）

## 设计方向

把外壳（一体 SVG 奶油渐变壳）已有的"展示级"材质叙事延续进面板内部，统一控件与输入语言，消灭 AI slop 痕迹与对比度缺陷，并给空状态一个品牌时刻。功能行为零变化——纯视觉/文案/动效层打磨。

## 关键决策

- **材质延续而非推翻**：外壳 SVG 奶油渐变是现任视觉权威（用户确认白猫/外壳方向保留），面板内部向其靠拢（暖调层次、柔和分隔、有深度的表面），不引入第二个视觉世界。
- **控件语言统一**：以展开态带框图标按钮为准绳收敛紧凑态；pin 从伪按钮改为纯指示器样式；输入框统一为胶囊语言（composer 为准）。
- **中文排版阶梯**：字重/灰阶/字号形成明确层级（typeset），解决"文字孤岛"与灰字过浅（同时修对比度到 AA）。
- **空状态品牌时刻**：delight——白猫在场感（可利用现有帧资产或外壳元素），替代死白。
- **去 slop**：快捷提问 chips 收敛为 quieter 的版式；删除 styles.css:740-774 彩虹 chip 死样式；错误文案去技术词汇（invoke 错误 → 用户可懂文案）；GMT+8 → 本地化表达。

## 边界与约束

- 范围：src/components/ChatPanel.tsx、ChatBubbleFrame(.css/.tsx)、ChatBubbleShell.tsx、TodoList(.css/.tsx)、TodoReminders.tsx、MessageContent.css、src/styles.css；qa/ 预览夹具可同步。
- 不动：宠物舞台与三帧资产、agent 链路逻辑、工具展示注册表接口（tool-presentation.ts 的 {name,status,text} 契约保持）。
- 遵守 .trellis/spec/frontend/ 各规范（component-guidelines、state-management 等）；design tokens 若引入，放 styles.css :root 并记录进 DESIGN.md。
- 可访问性底线：WCAG AA 对比度（诊断实测三处不达标必须修）。

## 验证与回滚

- 每步：`pnpm build` + `pnpm test`；视觉用 qa 预览页 + Playwright 截图前后对比（research/capture-shots.py 可复跑）。
- 终点：重跑 critique + `scripts/impeccable audit`（detect 61 规则），命中清零或有豁免理由。
- 回滚粒度 = implement.md 步骤；git 分步提交。
