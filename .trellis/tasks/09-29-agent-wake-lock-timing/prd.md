# 服务端会话读写锁分离与任务唤醒时序修复

## 背景

服务端模式聊天链路存在约 1 秒的提交到执行间隔。定位到两个原因：

1. `RuntimeStore.events_after`（控制 WebSocket 每 250ms 轮询聊天更新）通过 `_session` 的
   `SELECT ... FOR UPDATE` 占用会话行排他锁，与提交、领取、流式写入竞争。
2. `AgentService._worker` 在扫描（recover_expired + claim）之后才 `self._wake.clear()`，
   扫描期间收到的提交通知会被清掉，只能等 1 秒兜底超时才发现新任务。

## 需求

1. **读写锁分离**：`events_after` 只校验会话存在与归属权限，不再对 `agent_sessions`
   加 `FOR UPDATE`。提交消息（`submit`）、领取任务（`claim`）、流式写入与终态
   （`append_delta`/`start_tool`/`finish_*`/`recover_expired`）保留原有锁。
   `snapshot` 的锁保留（seq 水位一致性依赖它）。
2. **唤醒时序**：将 `_wake.clear()` 移到扫描之前，扫描期间到达的通知不会被清除；
   保留 1 秒超时兜底扫描，任务不会遗漏。
3. **计时补齐**：提交（`agent_runs.created_at`）、领取任务（`run.started` 事件）、
   开始调用模型（`model_call_traces.started_at`）、收到正文（`first_response_at` /
   `first_visible_text_at`）四个时间点可查询核对；执行器记录领取延迟日志。
4. **真实验证**：沿用当前配置的真实模型，验证：
   - 提交到模型开始的约 1 秒间隔消失；
   - 连续发送多条消息均被执行；
   - 事件 seq 严格递增、回复顺序正确；
   - 断线重连后快照与事件水位一致。

## 验收标准

- `server` 隔离测试全绿（unittest），新增唤醒时序回归测试。
- 真实服务 + 真实模型端到端验证输出证据文件（含四个时间点的间隔）。
- 不改动已持久化事件的语义与协议契约；`submit`/`claim`/写入路径的锁行为不变。
