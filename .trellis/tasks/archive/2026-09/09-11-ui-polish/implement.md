# 实施计划：UI 质感打磨

对应 PRD：./prd.md；设计：./design.md；诊断：./research/diagnosis.md

## 步骤清单

### 步骤 1：记录现任视觉系统（✅ 2026-09-11）
- [x] 按 .agents/skills/impeccable/reference/document.md 生成根 DESIGN.md（从现有代码提取 tokens/组件/材质）。
- 验证：DESIGN.md 存在且与代码一致。

### 步骤 2：polish 主刀（诊断问题清单逐项）（✅ 2026-09-11）
- [x] 面板内部材质延续外壳叙事（styles.css:453/587/871 分隔与表面层次）。
- [x] 空状态品牌时刻（styles.css:325-335）。
- [x] 三处 WCAG AA 对比度修复（styles.css:335、ChatBubbleFrame.css:251、styles.css:689）。
- [x] 控件语言统一 + pin 改纯指示器（ChatBubbleFrame.css:263/495、ChatPanel.tsx:309）+ 输入框语言统一。
- [x] 错误文案去技术词汇（TodoList.tsx:69、TodoReminders.tsx:53 GMT+8）+ 删除彩虹 chip 死样式（styles.css:740-774）。
- 验证：pnpm build + pnpm test + 截图对比。

### 步骤 3：typeset 中文排版阶梯（✅ 2026-09-11）
- [x] 按 reference/typeset.md 建立字重/字号/灰阶梯队，落实为 tokens。
- 验证：截图对比 + build。

### 步骤 4：quieter 收敛（✅ 2026-09-11）
- [x] 快捷提问 chips 收敛、header 密度、pin 徽章（按 reference/quieter.md）。
- 验证：截图对比 + build。

### 步骤 5：delight 情感化（✅ 2026-09-11）
- [x] streaming 情感化线索、微交互点缀（按 reference/delight.md，克制不喧闹）。
- 验证：截图对比 + build + test。

### 步骤 6：复核与收尾（✅ 2026-09-11）
- [x] 重跑 critique + scripts/impeccable audit（detect）；命中清零或记录豁免。
- [x] 更新 DESIGN.md 至打磨后状态；qa 夹具同步。
- 验证：最终全套（build/test/截图/detect）。

## 验证命令

- `pnpm build`、`pnpm test`
- 截图：复跑 research/capture-shots.py（需起 vite dev）
- detect：`.agents/skills/impeccable/scripts/impeccable audit --target <预览页>`（用法见 reference/audit.md）

## 风险点 / 回滚点

- styles.css 是全局样式集中地，改动面大——每步截图对比防误伤宠物舞台区域。
- 错误文案改动注意：TodoList.tsx:69 的错误来自 agent 链路 mock 缺失场景，文案修改不得吞掉真实错误的可诊断性（保留控制台原始日志）。
- tool-presentation 注册表契约（{name,status,text}）不可变。
