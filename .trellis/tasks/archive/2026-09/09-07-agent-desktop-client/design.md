# 桌面客户端设计

用户已批准父任务最小方案和三项并行拆分。继承[父任务 design](../09-07-server-agent-todo-mvp/design.md)，具体实现接口以[并行合同](../09-07-server-agent-todo-mvp/research/parallel-contract.md)为准。

## Ownership

Rust 远程连接、协议与前端设置/消息投影；保留已有 UI 改动。

## Dependencies

依赖固定 HTTP/WS 合同，不依赖后端完成即可实现；真实流式和重连验收需服务端两项完成。

## Contracts and Validation

所有请求、持久状态、权限与结果回传遵循共享合同。所需合同调整先通知主代理和相关代理，避免两边自行猜测。

本地协议边界/凭证保护/重连代际/消息去重/构建，随后真实桌面验收。不把 mock/静态证据升级为真实端到端证据。
