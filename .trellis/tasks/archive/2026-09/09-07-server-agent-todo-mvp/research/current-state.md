# 当前实现与规划依据

检查日期：2026-09-07。证据等级：源码只读检查、现有容器进程清单；未调用模型、未建立业务数据库、未验收桌面新流程。

## 源码入口

| 路径 | 已观察到的事实 | 对 MVP 的影响 |
| --- | --- | --- |
| src/App.tsx:13 | 系统提示词位于前端 | 远程模式由服务端拥有提示词，客户端只发送用户输入 |
| src/App.tsx:32 | messages 存在 useState | 重连需加载服务端快照，前端仅为投影 |
| src/App.tsx:60 | 全局 ai:stream 事件 | 新消息增加会话、任务与顺序标识，避免跨会话污染 |
| src/App.tsx:331 | 发送时前端拼接全部历史 | 改为服务端读取会话历史，并提供幂等请求标识 |
| src/lib/ai.ts:15 | ChatRequest 是 requestId + messages | 新合同须贯通 Python / Rust / TypeScript |
| src/components/ChatPanel.tsx:41 | 设置表单为模型地址、模型名、API Key | MVP 将服务端连接设置接入既有设置区域 |
| src-tauri/src/lib.rs:574 | 环境变量优先于本地模型文件 | 新服务配置独立命名，保留旧文件，不隐式上传密钥 |
| src-tauri/src/lib.rs:719 | 只解析模型文本 delta | 工具事件通过服务端合同传输，客户端不解释模型供应商协议 |
| src-tauri/src/lib.rs:743 | Rust 直接向模型发起请求 | 远程模式替换为 Rust 网关连接 |
| src-tauri/tauri.conf.json | WebView CSP 仅允许本地 IPC 连接 | WebSocket 归 Rust，无需为远程服务放宽 WebView CSP |

## 工作区与环境

- 项目根不是 Git 仓库；没有 backend/ 或 server/ 服务目录。
- 还有两个进行中的 UI 任务，尤其是气泡框抽象。ChatPanel 已包含 visible / animateEntrance 等新属性，不能用旧快照覆盖。
- 已有其他项目的 API 占用 8000、PostgreSQL 占用 15433、Redis 占用 6379。
- 这些容器的存在不表示本项目已获准复用业务数据或账号。本轮只列名称、镜像与端口，没有读取容器密钥。
- uv 可用；默认 python3 为 3.14.5。新服务的 Python 版本和依赖版本在执行阶段核对兼容性并锁定，不直接假定系统 Python 适用。
- 当前资料只有前端 Trellis specs，无现成 Python 后端规范。后端最小合同以 design.md 为准，实施完成后提取实际约定。

## 验证与保护

前端现有规范不要求引入新测试脚手架。后端可使用标准库 unittest 编写必要的边界测试，不以增加测试框架作为任务目标。

配置、模型调用、数据库连通性、工具写入和桌面可用性必须分别验证。模型“能聊天”不证明支持流式工具调用。

本轮为规划阶段，未构建、未启动新服务、未修改现有数据库或产品代码。
