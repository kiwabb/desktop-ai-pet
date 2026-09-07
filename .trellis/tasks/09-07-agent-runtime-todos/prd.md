# 智能体与待办

## Goal

实现父任务已获批准的最小待办闭环中的智能体与待办部分。用户已批准三项并行拆分，不改变产品范围。

## Requirements

- 继承[父任务 PRD](../09-07-server-agent-todo-mvp/prd.md)全部相关约束。
- 文件所有权：AgentService、runtime_store、todo_tools、002_runtime.sql 与运行时检查。
- 线上和 Python 接口遵循[并行合同](../09-07-server-agent-todo-mvp/research/parallel-contract.md)。
- 共享工作区，不覆盖他人改动，不重新请求已获得的实施授权。

## Dependencies

依赖 foundation 的 Settings/Database/Principal/Coordination 合同；先并行编写，运行检查等真实依赖准备完成。

## Acceptance Criteria

- [ ] 任务幂等、会话串行、有限循环、待办事务与真实工具结果、失败保留记录。
- [ ] 满足父任务对应 AC；单元/静态检查与真实运行证据分别报告。
- [ ] 不产生假模型回复或演示数据；没有真实条件时明确标未验证。

## Out of Scope

继承父任务的范围排除项：主动提醒算法、完整电脑操作、习惯学习与生产发布。
