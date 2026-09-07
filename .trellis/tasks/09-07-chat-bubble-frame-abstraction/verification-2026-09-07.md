# 验证记录（2026-09-07）

## 执行流水线

1. trellis-implement 完成实现：ChatBubbleFrame 新契约 + ChatBubbleFrame.css（样式归组件所有）+ App/ChatPanel/QA 调用方迁移 + 校验脚本同步。
2. trellis-check 全量复查：修复 1 处问题（visible 恢复后输入框焦点不回流，ChatPanel 增加 visible 驱动的 rAF 重聚焦）；其余静态核验通过。
3. 主会话真实运行验证（本文件）。

## 主会话补充修复

- `qa/chat-preview.tsx` 块注释内 `pet-chat-*/` 提前闭合注释导致 vite 编译失败（QA 页打不开）→ 改写注释文字。
- 并行会话给 ChatPanel 新增必需 `tools` prop 导致 QA 页展开模式 React 崩溃 → QA fixture 补传 `tools={[]}`。

## AC 逐项结果

- AC1（无祖先依赖的独立引用）— **通过**（浏览器层）：`?view=frame` 在普通容器中渲染 compact/expanded，祖先链仅 preview-wrap；aria-label 回退 title；自带 border-radius/阴影/徽章/插槽。证据：output/task-09-07/qa-frame-compact.png、qa-frame-expanded.png + DOM 探针。
- AC2（可见性/动画三态）— **通过**（浏览器层）：is-hidden 后 visibility:hidden + pointer-events:none + inert（`transition: all` 使 visibility 离散翻转晚一拍，等待后确认生效）；恢复后 visible/auto；reduced-motion 规则存在且不禁用可见性。WKWebView 原生 inert 行为未在真机确认。
- AC3（真实桌面交互流）— **未验证**：验证期间桌面 Space 被切走（用户/并行会话活动），且另一会话正在编辑 src-tauri（agent_client.rs 反复触发 cargo 重建与文件锁竞争），GUI 注入有干扰用户操作的风险，主动停止。已完成非交互部分：真实 pet 窗口离屏截图渲染正常（output/task-09-07/native-pet-window.png）。
- AC4（真实流式回复）— **未验证**：本机无 `.env` / API Key，无已配置服务；按预案记录为未验证，不造错误配置。
- AC5（外观无回归）— **部分通过**：fixture 预览 compact/expanded/settings 三个表面渲染正常（output/task-09-07/qa-chat-*.png，属 fixture 证据）；真实运行时布局回归未逐一比对。
- AC6（脚本/编译）— **通过**：verify-component-compact.mjs、verify-closed-reference.mjs、pnpm build 全部通过（在并行会话最新代码上复跑亦通过）。

## 环境备注

- 本目录无 Git：实施前快照在 `backup/`（含 FILE-LIST.txt），未做任何 commit。
- 验证期间发现另一会话正在进行 agent/todo 集成（新增 src/lib/agent.rs 等）；其改动保留了本任务的 visible/animateEntrance 契约，最终复跑脚本确认无冲突。
- tauri dev 未保持常驻（避免与并行会话争用 cargo target 锁）。
