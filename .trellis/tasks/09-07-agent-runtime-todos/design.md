# 智能体与待办设计

用户已批准父任务最小方案和三项并行拆分。继承[父任务 design](../09-07-server-agent-todo-mvp/design.md)，具体实现接口以[并行合同](../09-07-server-agent-todo-mvp/research/parallel-contract.md)为准。

## Ownership

AgentService、runtime_store、todo_tools、002_runtime.sql 与运行时检查。

## Dependencies

依赖 foundation 的 Settings/Database/Principal/Coordination 合同；先并行编写，运行检查等真实依赖准备完成。

## Contracts and Validation

所有请求、持久状态、权限与结果回传遵循共享合同。所需合同调整先通知主代理和相关代理，避免两边自行猜测。

任务幂等、会话串行、有限循环、待办事务与真实工具结果、失败保留记录。不把 mock/静态证据升级为真实端到端证据。
