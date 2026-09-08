# 最小实现技术设计

状态：已获用户批准，三个子任务并行实现中。方向决策以 [架构文档](../../../docs/SERVER_AGENT_ARCHITECTURE.md) 为准，产品要求以 [PRD](prd.md) 为准；固定接口和文件归属见 [并行合同](research/parallel-contract.md)。

## 1. 最小纵向切片

```text
现有聊天入口
  → Rust 控制连接（认证）
  → FastAPI 接受请求并持久创建任务
  → 后台执行器调用 LangChain / LangGraph
  → 注册中心选择 todo.create / todo.list
  → 业务服务读写 PostgreSQL
  → 真实工具结果回到模型
  → 持久事件经网关推送到 Rust，再投影到聊天界面
```

本轮设备端只完成身份、连接、心跳和能力注册边界。无已实现本机工具时提交空能力集合；不伪造“电脑操作已完成”。服务端待办工具必须真实注册、真实执行。

## 2. 模块与文件责任

| 区域 | 建议位置 | 本轮责任 |
| --- | --- | --- |
| Python 服务 | server/app/ | FastAPI 应用、配置、连接、运行时、注册中心、待办服务、存储与执行器 |
| 服务基础设施 | server/pyproject.toml、server/compose.yaml、server/.env.example | 可复现依赖、项目独立数据卷、环境变量说明；示例不含有效密钥 |
| 网关合同 | server/app/contracts.py、src-tauri/src/agent_protocol.rs、src/lib/agent.ts | JSON 合同、边界校验、面向 UI 的类型投影 |
| Rust 连接层 | src-tauri/src/agent_client.rs | WSS、凭证、连接与重连、请求/事件转发 |
| 现有宿主 | src-tauri/src/lib.rs、src/App.tsx | 连接生命周期、会话投影和状态集成 |
| 设置与消息显示 | src/components/ChatPanel.tsx | 服务地址/设备凭证设置，真实工具状态与错误呈现 |
| 验收说明 | server/README.md、任务 verification.md | 启动、实际证据和未验证边界 |

目录是执行方案，不要求提前建立空模块。依赖具体版本由实现代理核对官方兼容性后锁定。默认 Python 版本不能从本机 3.14.5 推导。

## 3. 账号、设备与配置

最小版通过管理命令创建真实账号并绑定设备，签发可撤销的独立设备凭证；不提供硬编码默认账号、演示用户或绕过认证的“开发模式”。

- 服务端校验凭证，导出 account_id / device_id / 允许的角色与能力；请求体不决定身份。
- 控制与节点使用两个逻辑入口：`/v1/control/ws` 与 `/v1/node/ws`。设备凭证可同时包含两种明确授权的角色。
- 由 Rust 发起握手，在认证 Header 中传递凭证。正式地址必须为 HTTPS/WSS；仅回环地址允许开发期 HTTP/WS。
- 模型 base URL、模型名和模型 API Key 由服务端环境配置。客户端只保存服务地址、设备凭证和当前会话 ID。
- 客户端凭证沿现有 Rust 私有配置文件模式保存（Unix 0600），不进 WebView 存储或日志。
- 服务配置使用独立配置文件和环境变量名，避免被旧 DESKTOP_AI_PET_MODEL 等变量误覆盖。
- 改变服务地址时清除该连接的会话身份并重新提供对应凭证，不能自动把旧凭证发给新地址。
- 撤销设备同时关闭存量连接并让后续请求失效；服务端 HTTP 与 WS 操作统一做所有权校验。

## 4. 注册中心合同

工具定义：name、version、description、input_schema、permission、execution_location。

执行实例：instance_id、tool_name、tool_version、account_id（设备实例）、device_id（可空）、handler_key（服务端实例）、在线租约关联。

MVP 的服务端定义为 `todo.create` 与 `todo.list`。模型工具命名若受供应商限制，由适配层映射，业务名称保持稳定。设备登记必须匹配允许列表和兼容版本；不接受客户端提交可执行代码或任意处理器路径。

持久目录放 PostgreSQL；Redis 保存设备连接租约及 gateway_id 映射。首次版本仍按相同规则识别实例，不能仅因目录中有记录就认为工具在线。实际跨设备动作留给后续切片验证。

## 5. 消息与生命周期合同

所有消息包含版本 `v=1`、类型 `type`、关联 ID 与结构化 payload；统一使用 snake_case 的线上字段。Python、Rust、TypeScript 各有明确解码边界，UI 不直接解析任意 JSON。

| 消息/操作 | 关键字段 | 行为 |
| --- | --- | --- |
| run.submit | request_id、session_id、text | 所有权校验；提交事务后返回 run.accepted；相同账号和 request_id 返回已有任务 |
| session.snapshot | session_id | 返回持久消息、工具结果、当前任务状态及 seq 水位 |
| run.accepted | request_id、session_id、run_id、seq | 表示请求已持久接收，不表示模型或工具成功 |
| message.delta | run_id、message_id、seq、text | 按顺序追加真实流式内容 |
| tool.started / tool.finished | run_id、tool_call_id、seq、name、result/status | 展示实际工具活动；错误与成功有不同结构 |
| run.completed / run.failed / run.interrupted | run_id、seq、result/error | 终态来自持久执行状态，不能仅以网络 EOF 判完成 |
| node.register / node.heartbeat | connection_id、capabilities | 绑定认证身份，登记允许能力并续租；不允许跨角色调用 |

HTTP 提供最小会话创建/快照和待办查询接口，使用与 WS 相同的设备认证与账号隔离。具体路由名称在实现前固定到合同文件，避免各层自行推导。

执行状态：`queued → running → completed | failed | interrupted`。未确认的设备副作用使用 `needs_reconciliation` 工具状态。

客户端重连先订阅并缓冲后续事件，再读带 seq 的快照，随后只应用大于快照水位的事件。服务端生成顺序号；不能用客户端时间或消息文本拼接猜测游标。切换服务器、会话和连接代际时停止旧订阅并丢弃旧代际事件。

## 6. 数据与持久执行

业务数据最小包括 accounts、devices、sessions、messages、todos、tool_definitions、tool_instances、runs、tool_calls、run_events。LangGraph checkpoint 使用其独立表，不与待办业务字段混合。

- 每条会话、任务和待办都关联 account_id，所有读写都从认证上下文限定账号。
- `(account_id, request_id)` 唯一约束抵御断线重提；`(run_id, tool_call_id)` 唯一约束复用已完成工具结果。
- `todo.create` 的记录插入与工具结果持久化使用同一事务。响应丢失后可以查回结果。
- 同一会话中的任务按顺序领取；不同会话可以并行，限制每次执行步数和时间，避免无限工具循环。
- 后台执行器领取数据库中的待处理任务，使用数据库的占用/租约机制避免多进程同时处理同一任务。
- Redis Pub/Sub 是唤醒提示。定期检查数据库兜底，通知丢失不能丢任务；Redis 不可用时网关不得把失效设备租约当成在线。
- 服务重启后 queued 任务可重新领取；过期 running 任务先核对工具结果，最小版标为 interrupted 并提供真实结果快照，不承诺自动续跑所有模型步骤。
- 不在一次未知结果的模型重试中自动重新创建待办。新模型调用 ID 不能绕过上次执行产生的副作用核对。
- 消息/工具结果与事件水位一致持久化，再发布事件；流式文本可短批次合并，不能用一次完整回复伪装流式 token。

## 7. 界面与兼容

远程连接走 Rust，由现有 Tauri IPC 向 React 暴露结构化操作；不需要为外部网关放宽现有 WebView CSP。

- 保留白猫、气泡框、窗口大小、动画及 compact/expanded 的用户操作。
- 服务端模式下从已选会话快照恢复消息；前端系统提示词和任意历史不再是模型输入的权威来源。
- 设置区域配置助手服务地址和设备凭证。显示连接状态、服务端模型就绪状态，不让用户填写服务端模型密钥。
- 新服务模式使用新会话；不自动迁移旧内存消息与旧模型密钥。
- 旧模型配置文件保留用于回滚，远程请求失败时明确报错，不静默降级成直接模型聊天。
- 模型失败但工具已成功时保留工具结果；不要沿旧路径删除全部回复占位而掩盖已提交记录。
- 本轮不增加新看板、视图切换体系或未经确认的交互容器。

## 8. 开发与发布边界

现有其他项目容器与端口保持不动。提供本项目正式服务的开发配置及独立 PostgreSQL/Redis 数据卷；选端口前检查监听器。开发服务由开发者显式启动，不由 Tauri 启动，也不建立专门的“演示后端”。

用户已授权本机开发服务使用当前桌宠模型配置。生产服务地址、部署主机、TLS 证书和实际创建验收内容尚未提供；这些是部署/对应验收前置条件，不阻塞代码实现，但不能以假服务或假模型替代。

回滚包括停止本项目新增服务、恢复客户端直连入口版本；不删除任何真实待办/账号数据，不覆盖其他任务对 UI 的改动。根目录目前不是 Git 仓库，不能声称已提交或推送。

## 9. 验收与未完成能力

具体观察标准见 PRD AC1–AC8。静态检查不能证明真实模型工具调用，Python 客户端协议测试不能证明 Rust 或桌面界面可用，单设备联调不能证明第二台物理设备已接入。

MVP 不交付完整电脑操作、主动提醒算法、习惯学习、多实例稳定性证明或生产上线。
