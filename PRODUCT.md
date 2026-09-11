# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

目前是作者自用的个人项目；计划未来分发给桌面用户（macOS 优先）。典型场景：用户在工作/学习时让 AI 白猫常驻桌面，随时聊天、记录待办、接收提醒——陪伴感与效率工具合一。

## Product Purpose

一只悬浮在桌面上的 AI 白猫：点开即可与 AI 助手对话，管理待办与提醒。存在的意义是把"AI 助手"从网页/应用窗口里解放出来，变成桌面上一个有生命感的伙伴。成功 = 用户愿意让它一直开着。

## Positioning

本地（Rust 单机）+ 服务端（Python LangGraph）双模式的 AI 陪伴桌宠：不依赖特定厂商客户端，模型密钥只在服务端，待办/提醒形成完整闭环，断连可恢复。邻近产品（静态桌宠、网页助手、单一待办 App）无法同时声称"有生命的桌面陪伴 + 真正的 agent 能力闭环"。

## Operating Context

macOS 桌面常驻：悬浮窗跨桌面空间显示、可覆盖普通全屏应用；聊天面板按需展开/收起，不打扰是默认状态。开发与评估依赖 qa/ 静态预览页 + Playwright 截图做视觉评审。

## Capabilities and Constraints

- Tauri 2 双透明窗口（桌宠 + 聊天面板），React 前端跑在 webview 内。
- 宠物动画仅由三张对齐透明 PNG（idle/blink/talk）驱动：呼吸、眨眼、说话、睡眠等——无 3D/骨骼动画运行时。
- 双模式 agent：服务端模式（WebSocket 控制通道 + REST）与单机模式（Rust 本地循环 + SQLite），UI 对两者同构。
- 待办/提醒能力通过能力插件 seam 提供（plugins/todo），前端展示走通用注册表。
- 未配置模型时禁用发送，不生成假回复。

## Brand Commitments

- 白猫三帧形象（public/pets/white-cat-v2/ 的 idle/blink/talk PNG）是 binding 资产，不可改。
- 透明悬浮窗形态（桌宠直接坐在桌面上，无窗口边框）不可改。
- 聊天面板/气泡的视觉风格可以大改——目标是"高级"质感。

## Evidence on Hand

- 宠物帧资产：public/pets/white-cat-v2/（运行资源）。
- 视觉评审夹具：qa/chat-preview、frame-preview、pet-preview 等预览页；.playwright-cli/ 截图链路。
- 无真实用户评价/媒体证据——不得虚构。

## Product Principles

1. 陪伴感优先：它是"活"的桌面伙伴，不是一个工具窗口。
2. 不打扰：默认收敛，按需展开；提醒出现要有分寸。
3. 可信：状态真实（不伪造回复、不假装执行），双模式行为一致。
4. 展示级精致：以未来分发为标准打磨视觉与动效细节。
