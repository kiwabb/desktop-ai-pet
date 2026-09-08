# PRD: 桌面端 Rust 直调大模型 —— 服务端/单机双模式切换

## Goal

调研现有 Python 服务端大模型调用实现，设计桌面端 Rust 直调大模型的单机模式，与服务端模式并存且可切换；**本阶段只交付调研与设计文档，不写实现代码**。

## 背景

当前大模型调用完全由 Python 服务端承担（FastAPI + LangGraph + OpenAI 兼容协议，见 `research/server-llm-implementation.md`）。桌面端（Tauri Rust）通过 WebSocket/HTTP 连接服务端，前端只与 Rust IPC 交互。需要新增一个**单机模式**：不启动 Python 服务端，由桌面端 Rust 直接调用 OpenAI 兼容的大模型端点；与现有**服务端模式**并存，用户可在设置中切换。

## 功能需求

### F1 单机 LLM 调用（Rust）
- Rust 后端直接调用 OpenAI 兼容 Chat Completions（`stream=true`），SSE 解析，逐 chunk 产出文本增量。
- 配置三要素：base_url / api_key / model（未配置齐时 `model_configured=false`，聊天拒绝、其余功能可用）。
- 超时：总超时默认 90s + chunk 间读超时；在途流可取消。
- 错误归类为固定中文文案，不外泄 provider 响应体与凭证（对齐服务端 `execution_error` 语义）。

### F2 单机 Agent 运行时
- 系统提示词逐字复用服务端 `SYSTEM_PROMPT` + 时间上下文注入格式。
- 历史窗口：近 40 条非空消息 + 失败/中断 run 的工具记录注入。
- 工具循环：model → tools → model，上限 8 步；4 个待办工具（todo_create / todo_list / todo_complete / todo_reminder_set），JSON Schema 与 description 逐字保留。
- 可见文本过滤：只透传 text，丢弃 reasoning/thinking。
- run 状态机与幂等：request_id 幂等；queued / running / completed / failed / interrupted。

### F3 本地持久化
- 会话 / 消息 / 工具调用 / 待办本地存储，重启后历史可恢复。
- 历史本期无限增长、原样记录；清理/截断策略留作后续优化。
- 待办业务规则与服务端一致（提醒乐观锁、完成清提醒、标题 1..2000 字符等）。
- 提醒到期检测本地化（替代现有的服务端轮询）。

### F4 模式切换与配置
- 设置页新增模式选择（服务端 / 单机），各自表单：服务端 = 地址 + 设备凭证；单机 = base_url + api_key + model。
- 单机模式支持 `GET {base_url}/models` 拉取模型列表下拉选择；接口不可用时回退为手输模型名。
- 模式与配置持久化于应用配置目录（沿用 0600 原子写入）；api_key 使用 OS 凭据存储（keyring）。
- 切换模式复用现有 generation/重启机制，中止旧链路任务，不串台。
- `AgentView.connection` / `model_configured` 等状态字段在单机模式下产出同构语义，前端文案无需分支。

## 非目标（本阶段）

- 不实现设备注册/心跳（node/ws）、Bearer 认证、多设备路由 —— 单机模式无此需求。
- 不支持 Anthropic/Gemini 原生协议 —— 与服务端对齐，仅 OpenAI 兼容协议（base_url 可配）。
- 不迁移服务端 PostgreSQL 数据到本地；两种模式会话历史各自独立。

## 验收标准（后续实现阶段）

- [ ] 不启动 Python 服务端，配置单机模式后可完成一轮含工具调用的对话（如"帮我加一个明天下午的提醒"），流式逐字渲染。
- [ ] 切换到服务端模式并保存后，链路恢复为现有 WebSocket 行为；两种模式配置互不影响。
- [ ] 重启应用后，单机模式会话历史与待办仍在。
- [ ] `tools/verify-chat-interaction.mjs` 与现有前端回归全部通过；未配置模型时 UI 表现与服务端模式一致。
- [ ] api_key 不以明文落盘。

## 调研产物

- `research/server-llm-implementation.md` — 服务端 LLM 实现全量记录（复制的蓝本）
- `research/desktop-architecture.md` — 桌面端现状与模式切换落点
- `research/rust-llm-tech-options.md` — Rust 技术选型与风险
- 技术设计见 `design.md`
