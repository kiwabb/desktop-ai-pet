# 桌面助手服务

Python 3.12 + FastAPI 服务端，PostgreSQL 保存账号、会话、任务和待办，Redis 保存设备租约及唤醒提示。桌面客户端不启动本服务，也不安装 Python。当前设备操作能力为空；没有习惯学习或主动提醒实现。

## 安装与启动

在 `server/` 目录执行：

```bash
uv sync --locked --python 3.12
cp .env.example .env
chmod 600 .env
```

编辑 `.env`：设置与共享 PostgreSQL 相匹配的 URL；模型配置只能在服务端填写。配置内容不能提交、截图或输出到日志。模型密钥或模型名缺失时允许查询，模型任务应明确拒绝。PostgreSQL 使用本机共享实例 `shared-postgres`（`127.0.0.1:15433`，库/角色均为 `pet_agent`），不在本 compose 项目内；本项目 compose 只管 Redis `16380`，API 端口 `18081`，启动前确认没有占用。

```bash
docker compose config --quiet
docker compose up -d
uv run python -m app.cli migrate
uv run uvicorn app.main:app --host 127.0.0.1 --port 18081 --no-access-log
```

迁移按 `migrations/*.sql` 文件名顺序执行，已执行版本写入 `schema_migrations`；应用启动也会检查迁移。进程启动要求数据库可连接；Redis故障使节点注册不可用，已持久的控制事件通过数据库轮询恢复。`/health` 分别报告数据库、Redis和模型配置；模型已配置不等于真实模型调用成功。PostgreSQL 数据存于共享实例的 `pet_agent` 库，备份/清理由共享实例统一管理；Redis 属本 compose 项目，随时可重建。

## 配置真实账号与设备

```bash
uv run python -m app.cli create-account --name YOUR_NAME
uv run python -m app.cli create-device --account-id ACCOUNT_UUID --name DEVICE_NAME --output /private/path/device.json --base-url http://127.0.0.1:18081
uv run python -m app.cli revoke-device --device-id DEVICE_UUID
```

没有默认账号或默认凭证。`create-device` 独占创建 Unix `0600` 文件，JSON 包含 `base_url`、`device_token`、`device_id`、`account_id`，只在终端打印非敏感 ID 和路径。也可用 `--token-file` 输出私有纯凭证文件。数据库只保存随机高熵凭证的 SHA-256 摘要。请通过客户端设置传入凭证，禁止写入 URL、WebView 存储或日志。

撤销后新请求立即拒绝；存量控制连接每 0.25 秒、节点连接每 1 秒核对撤销状态（数据库耗时另计），并关闭失效连接。公网部署需在 TLS 反向代理之后使用 HTTPS/WSS，本机 HTTP 仅绑定回环。生产部署及多实例压测尚不在本次验收内。

## 接口与恢复

- HTTP 使用 `Authorization: Bearer …`，不做带凭证重定向。
- `GET /v1/status`、`POST /v1/sessions`、`GET /v1/sessions/{id}`、`GET /v1/todos` 需要 control 角色。
- `/v1/control/ws` 只接受控制消息；`/v1/node/ws` 只接受节点注册与心跳。认证在接受连接之前完成。
- 节点注册提交 `capabilities: []`，未知能力明确拒绝。心跳 15 秒、TTL 45 秒；连接标识防止旧连接删除新连接租约。
- 会话打开先发送带水位的快照，再轮询持久事件。重复的 `run.accepted` 使用会话 `seq` 去重；断开连接不会取消已保存任务。
- 工具目录由各插件共享 manifest（`plugins/<名称>/plugin.json`）在启动时聚合注册（`register_server_tools(plugins)`）；调用时再次验证白名单与持久执行实例（`resolve_server`）。

完整线上协议见 [并行合同](../.trellis/tasks/09-07-server-agent-todo-mvp/research/parallel-contract.md)。

## 内部管理后台

`admin/` 是独立的 React/Vite 管理界面，开发时先启动服务端，再在项目根目录执行
`pnpm --dir admin dev`，访问 `http://127.0.0.1:18181/admin/`。Vite 只代理
`/admin/v1`，不会改变设备 `/v1` WebSocket 的 Origin 规则。

管理账号不会自动创建。先设置 `PET_AGENT_ADMIN_ENCRYPTION_KEY`（它只用于 Fernet
加密后台管理的模型 API Key），执行迁移后用服务端 CLI 建立账号：

```bash
uv run python -m app.cli create-admin --username YOUR_NAME
uv run python -m app.cli create-admin --username OBSERVER_NAME --role observer
```

命令交互读取密码，不在进程参数中传递。自动化开通可使用
`--password-file /private/path/admin-password`，文件必须属于当前用户、权限为 `0600`，且不能是符号链接。
模型管理写入需要服务端加密主密钥；账号登录本身不依赖模型配置。

管理会话使用 HttpOnly、SameSite Cookie 和 CSRF Cookie；设备 bearer token 不被解释为
管理身份。管理员发放设备时，明文凭证只在 `no-store` 响应中出现一次。模型配置保存为
不可变版本，测试是管理员显式触发的真实流式请求，发布通过 revision CAS；新接收运行
绑定接收时的版本，在途运行不会换配置，总超时也使用该绑定版本。回滚先选择沿用当前
或历史 Key 并生成候选版本，重新测试后发布，保留回滚来源与审计记录。测试校验完整 SSE
流，旧版仅检查字节的测试不再允许发布；最新有效测试须在 24 小时内，发布前再次检查 Key 可解密。

服务端追踪保留运行、模型步骤、工具关联和有限的应用层请求/响应快照。快照默认 30 天，
追踪元数据和审计默认 90 天；当前只提供受控单条读取，不提供批量导出。provider 未返回
usage 时记录为未采集，追踪写入失败显示缺口且不重放模型或撤销业务工具结果。追踪采用
独立连接池与有界异步队列；超时、取消、停止时保留已输出内容并结束模型步骤。管理端
按实际模型/工具顺序展示，支持时间区间定位、受控正文检查、分页和刷新恢复。

升级时应用新增 `006_admin_repair.sql`、`007_trace_repair.sql`，不要改写已执行的 005。
首次启用数据库模型管理前需排空任务；启用后无法解密配置会明确拒绝新模型请求，不静默
切回环境配置。管理员正文读取使用 POST、CSRF、审计和 `no-store`；设备发放要求幂等键，
重试仅返回设备标识，不恢复原始明文凭证。

## 待办完成与直接列表

`todo.complete` 的模型调用名为 `todo_complete`，只接受 `todo_id`，由认证账号限定更新范围。迁移 `003_todo_complete.sql` 将业务状态扩展为 `pending/completed`，保留现有数据。重复完成返回同一事项的已完成状态。

桌面列表直接调用已有 `GET /v1/todos`，无需模型请求，返回全部事项及真实状态；原生 IPC 为 `agent_list_todos`。列表的“完成”按钮通过原生 `agent_complete_todo` 调用 `POST /v1/todos/{todo_id}/complete`，无需模型；服务端与聊天工具共用账号范围内的完成逻辑。接口返回 `{item: Todo}`，重复完成保持同一事项的已完成状态。聊天没有明确目标时仍先追问。

## 检查与证据边界

```bash
uv run python -m unittest discover -s tests
```

`test_gateway*` 是显式使用 mock 的隔离边界检查，不能证明真实 PostgreSQL、Redis、模型或桌面界面已验收。真实验证记录由父任务 `verification.md` 维护。不建立演示数据库，不预置待办，不在真实运行模式注入假模型回复。

已完成事项再次点击完成框，通过 `agent_reopen_todo` 调用认证的 `POST /v1/todos/{todo_id}/reopen`，将该账号事项设为 `pending`。重复请求保持待完成状态，不执行状态反转，不调用模型。HTTP 仍返回 `{item: Todo}`，原生返回 `{generation, item}`；客户端校验 ID、目标状态和配置代际后才更新界面。

## 一次性待办提醒

迁移004增加可空 `remind_at`，旧事项保持无提醒。认证的 `GET /v1/todos/reminders/due` 按数据库当前时间读取到期事项，不消费数据；`PUT /v1/todos/{id}/reminder` 接收 `remind_at` 与 `expected_remind_at` 两个必填可空时间字段。时间须含时区，null 清除；重复相同目标幂等，旧时间不匹配或事项已完成返回409。完成操作在同一事务清除提醒。

Rust独立后台每15秒检查，模型和WebSocket断开不影响该HTTP通路；退出客户端时不通知，重连补显。无需额外调度服务、Redis队列或系统通知权限。详细边界见[提醒合同](../.trellis/spec/backend/todo-reminders.md)。

## 对话提醒工具

`todo.create` version2 的模型函数 `todo_create` 接受可选 `remind_at`：不传/null 保留普通创建；指定有效时间时事项、提醒与工具结果原子保存。`todo.reminder.set` version1 的模型函数 `todo_reminder_set` 接收真实查询所得的 `todo_id`、`remind_at` 与 `expected_remind_at`，复用直接接口的账号隔离/条件更新/数据库时间校验，null 取消。

`PET_AGENT_DEFAULT_TIMEZONE` 默认 `Asia/Shanghai`，必须是有效 IANA 时区。每次模型调用的运行上下文包含当前时间与请求接收时间；相对时间以接收时间为起点，过期或歧义时间须确认。新增工具由启动时的注册中心同步，不需要新增表迁移。对话工具影响保存在现有 run/tool 事件中，列表路径仍不调用模型。
