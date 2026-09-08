# 服务端基础

## Goal

实现父任务已获批准的最小待办闭环中的服务端基础部分。用户已批准三项并行拆分，不改变产品范围。

## Requirements

- 继承[父任务 PRD](../09-07-server-agent-todo-mvp/prd.md)全部相关约束。
- 文件所有权：server 基础文件、认证、网关、数据库基础迁移、Redis 协调与注册中心。
- 线上和 Python 接口遵循[并行合同](../09-07-server-agent-todo-mvp/research/parallel-contract.md)。
- 共享工作区，不覆盖他人改动，不重新请求已获得的实施授权。

## Dependencies

runtime 的 AgentService 方法为集成依赖；先按固定合同实现，真实联调等子任务二完成。

## Acceptance Criteria

- [ ] 认证/撤销/所有权/未知能力/协议/快照事件泵的实际边界检查。
- [ ] 满足父任务对应 AC；单元/静态检查与真实运行证据分别报告。
- [ ] 不产生假模型回复或演示数据；没有真实条件时明确标未验证。

## Out of Scope

继承父任务的范围排除项：主动提醒算法、完整电脑操作、习惯学习与生产发布。
