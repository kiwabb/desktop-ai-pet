# worker 唤醒信号按执行器隔离与计时口径修正

上一轮（09-29-agent-wake-lock-timing）复核发现的三个 P2 问题。

## 需求

1. **双 worker 丢唤醒**：`AgentService` 的两个后台 worker 共用一个 `asyncio.Event`，
   多会话并发时一方会清掉另一方尚未处理的通知，复现为额外约 1 秒等待。
   改为每个 worker 持有独立唤醒事件，`submit`/`stop` 通知全部 worker；
   worker 只清除自己的事件。保留 1 秒兜底扫描。
2. **首段正文计时口径**：`tools/verify-agent-timing.py` 用
   `coalesce(first_visible_text_at, first_response_at)` 把纯工具调用响应也算作正文。
   拆分为两个指标：首次响应（可为工具调用）与首段可见正文，分别记录。
3. **重连验证遗漏**：断线期间任务可能已完成，重连快照已含终态；
   脚本须先检查快照中的 run 状态，已完成则不再等待不会再来的完成事件。

## 验收标准

- 新增双 worker 交叉清除的回归隔离测试（旧共享事件实现下应失败）。
- server 隔离测试全绿。
- 真实模型重跑 verify-agent-timing：首个任务提交→领取仍远低于 1 秒；
  工具响应与可见正文分开记录；断线恢复两种分支（断线期间完成/未完成）逻辑正确。
