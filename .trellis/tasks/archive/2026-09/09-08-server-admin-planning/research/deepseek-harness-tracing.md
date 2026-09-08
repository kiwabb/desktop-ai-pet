# DeepSeek Harness 链路追踪参考

2026-09-08；证据为官方 GitHub 文档和源码静态核验，没有启动 DSH、运行模型或进行界面验收。用户拼写为 deepseek-hernes；本轮根据搜索与能力对应，将 DeepSeek Harness 作为工作参考，未声称用户已确认名称。

## 官方证据

- [Trajectory README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-trajectory/README.zh.md)：按轮次展示用户、助手、工具及嵌套工具记录；交互时间概览与局部检查器；Token、耗时、输入输出；TTFT/解码区间；按需加载与虚拟列表；向上阅读暂停尾部跟随。当前运行中耗时保持空白，仅显示开始标记，不杜撰时间跨度。
- [请求检查契约](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-conversation/src/client/contract/request-inspection.ts)：记录实际生效模型配置、system prompt、完整工具目录及其变化；请求有 turn/step、开始结束时间、状态、usage 和重试信息。
- [会话遥测](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session-telemetry.zh.md)：权威持久事件映射为有序 ledger，ops 信号另行区分；导出前处理副本而非改写原始事件；导出为可选能力，与 agent loop 分离。这里的 OTel provider 是日志流水线，不能将其描述为现成的全系统分布式 span 追踪。
- [仓库 README](https://github.com/deepseek-ai/deepseek-harness)：开发者预览、插件架构、MIT；本项目采用其交互与数据思路，不以移植 Cordis 插件系统为前提。

## 本项目映射

| 追踪能力 | 现有依据 | 需要补充 |
|---|---|---|
| 会话 / 轮次 | agent_sessions / agent_runs | 面向管理员的查询与关联；明确 run 对应一次用户提交 |
| 模型 → 工具 → 模型步骤 | `server/app/agent_service.py:262` 的 model_node 与 `:281` 的 tools_node | 模型调用独立标识、步骤序号和与工具的因果关联 |
| 工具参数与结果 | agent_tool_calls、tool.started/finished 事件 | 查询投影与检查器；保留失败运行中已提交副作用 |
| 模型输入 | `server/app/agent_service.py:253` 组装历史和系统上下文，`:266` 发起 astream | 捕获当次 messages、system、工具 schema、模型及有效参数，避免事后重建；区分应用层请求快照与 SDK 序列化后的上游 HTTP 请求 |
| 耗时与 TTFT | 当前有运行/工具持久事件，但没有模型级时间字段 | 记录调用开始、第一响应块、第一可见文本、结束；用单调时钟算耗时，绝对时间用于展示；不将 message.delta 的数据库写入时刻当作精确 TTFT |
| Token 用量 | 当前未持久化模型 usage | 按模型调用捕获提供方 usage，累计口径去重；未返回不填零；输入、输出、缓存命中仅在有来源时展示 |
| 恢复与排障 | 有 session seq、运行状态、持久事件 | 追踪新增记录具备稳定 ID，保证分页/刷新不重复，历史缺口可见 |

## 建议交互与范围

入口为“会话与运行 → 某次运行 → 链路追踪”。页面顶部展示状态、总时长、模型步骤数、工具数与有来源的用量；中间展示可缩放/选区时间概览；下方记录列表按步骤组织；选中记录展开检查器。指标缺失时明确显示未采集。

一条典型真实执行可显示为“请求接收 → 排队 → 第一次模型调用 → todo_list → 第二次模型调用 → 服务端运行结束”。此路径是设计说明，不是已发生的运行；实际界面只显示采集到的步骤。用户已确认首期只覆盖服务端；服务端完成不等于客户端已经展示回复，首期不扩展至 Rust 接收或 React 展示埋点。

首期建议包括运行与模型/工具步骤、输入输出快照、TTFT/耗时、真实 Token、失败位置、实时更新、刷新恢复、分页与脱敏。成本结算、多 Agent 树、嵌套工具、请求压缩和重试只有运行时真正支持且产生记录时才展示，不为对齐参考项目制造数据或扩展业务能力。

追踪标识候选：稳定的 run 级 trace_id，加模型调用/工具调用 span_id、parent_span_id、step_index；能否复用 run_id 为关联标识在设计阶段确定。若使用标准 OTel，需遵循其 ID 格式与上下文传播，不直接把 UUID 字符串作为合法 trace ID 传入 SDK。

追踪事实与既有业务事件保持可关联，但不改变客户端严格 seq 事件协议。导出到 Langfuse/OTel 作为后续集成选项，不作为首期展示必备服务。遥测导出故障不得中断业务；新增追踪存储采用何种事务和降级策略在 design.md 定案，并要求标识丢失区间。

正文可涉及私人会话，需明确访问角色、保存期限、截断规则和导出策略；API Key、Authorization、设备凭证不进入追踪。用户已确认单机模式不在首期范围内，不新增单机采集、本地会话上传或同步。
