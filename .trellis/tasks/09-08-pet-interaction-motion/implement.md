# 执行计划

1. 用户确认最终计划后，补齐上下文并启动任务，按 Trellis implement/check 子代理流程执行。
2. 有界复现：记录原生小框→设置→返回的阶段时序、实际窗口尺寸和可见画面；检查已展开→设置作为对照，分离 resize 与内容切换成本。不得无限截图或重复未变构建。
3. 修复已定位问题：连续呈现、一次性入场、稳定底座裁剪、有界等待/异常恢复与快速操作协调。Rust 仅按实测证据修改。
4. 添加共享动效参数及轻盈面板/内容/按钮反馈，兼容 reduced-motion，不改变既定几何和美术。
5. 做针对性状态测试：过期完成、连续切换、超时恢复；复用既有静态几何/交互检查。前端风险涉及跨层窗口行为，执行一次 pnpm build；若改 Rust 再进行相应编译打包验证。
6. 原生验收 A1–A5，浏览器辅助验收导航、焦点和减少动态效果；分别记录证据等级及未验证项。禁止伪造业务状态或宣称未观察到的流畅性。
7. 独立检查、必要修复、更新规范与 journal、本地提交。全部验收完成后再归档。

## 建议检查命令
- node tools/verify-component-compact.mjs
- node tools/verify-closed-reference.mjs
- node tools/verify-chat-interaction.mjs
- node tools/verify-pet-live-status.mjs
- pnpm build
- git diff --check

## 风险文件
src/App.tsx、src/components/ChatPanel.tsx、src/components/ChatBubbleFrame.tsx/.css、src/styles.css；原生证据需要时才进入 src-tauri/src/lib.rs。
