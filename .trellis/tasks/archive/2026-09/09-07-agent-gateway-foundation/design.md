# 服务端基础设计

用户已批准父任务最小方案和三项并行拆分。继承[父任务 design](../09-07-server-agent-todo-mvp/design.md)，具体实现接口以[并行合同](../09-07-server-agent-todo-mvp/research/parallel-contract.md)为准。

## Ownership

server 基础文件、认证、网关、数据库基础迁移、Redis 协调与注册中心。

## Dependencies

runtime 的 AgentService 方法为集成依赖；先按固定合同实现，真实联调等子任务二完成。

## Contracts and Validation

所有请求、持久状态、权限与结果回传遵循共享合同。所需合同调整先通知主代理和相关代理，避免两边自行猜测。

认证/撤销/所有权/未知能力/协议/快照事件泵的实际边界检查。不把 mock/静态证据升级为真实端到端证据。
