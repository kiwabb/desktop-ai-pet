# 执行计划: 服务端 / 单机双模式 LLM

依据 `prd.md`（需求/验收）与 `design.md`（架构/选型）。行为等价对照表见 `research/server-llm-implementation.md` 末节 11 项清单。

## 验证命令

- Rust：`cd src-tauri && cargo check` / `cargo clippy` / `cargo test`（如有）
- 前端：`pnpm tsc -b`（或 `pnpm build`）与 `pnpm lint`（按 package.json scripts 实际为准）
- 前端回归：`node tools/verify-chat-interaction.mjs`
- server 模式回归（涉及 agent_client 搬迁时）：`python3 tools/verify-agent-service.py`（需本地服务端，可选）

## M1 单机纯聊天 + 模式切换（本任务首个交付）

1. **配置结构改造**：`agent-config.json` 扩展为 `{ mode, server{...}, local{base_url, model, timeout_secs, timezone} }`；两套配置共存；旧格式迁移（无 mode 字段视为 server）；沿用原子写 + 0600 + `normalized_url()` 校验。环境变量回退 `PET_AGENT_MODEL_*`。
2. **LLM 客户端**：新增 `src-tauri/src/llm/`，reqwest + eventsource-stream（新增此 crate），自有 chunk serde 类型；总超时 90s + chunk 间 30s 读超时；`rustls-tls` → `rustls-tls-native-roots`；错误翻译固定中文文案。
3. **本地运行时（无工具）**：新增 `src-tauri/src/local_agent/`：SYSTEM_PROMPT 逐字 + 时间上下文注入；历史窗口（近 40 条非空消息）；run 状态机 + request_id 幂等；内存态会话（M1 暂不做 SQLite）；复用 `agent_protocol.rs` 的 Snapshot/事件类型做投影，`emit('agent:view')` 出口不变。
4. **Backend 抽象与分发**：`AgentBackend` trait；现有 `agent_client.rs` 逻辑收敛为 ServerBackend；7 个 command 签名不变、按 mode 分发；切换走 generation/abort 机制。
5. **设置 UI**：`AssistantSettings.tsx` 增加模式选择器与单机表单（base_url/api_key/model，含 `GET /models` 下拉 + 不可用时手输回退）；`ChatPanel.tsx` 表单 state 相应扩展。M1 api_key 可暂存配置文件 0600（M3 迁 keyring）。
6. **验证**：cargo check/clippy + 前端 tsc/lint + `verify-chat-interaction.mjs` 全绿；手动：单机模式流式对话、双模式切换、未配置时 UI 表现。

**M1 完成门**：PRD 验收 1（无工具部分）、2、4 通过。

## M2 工具循环 + 本地持久化

1. SQLite（rusqlite bundled）：表镜像 `server/migrations/002_runtime.sql`（sessions/runs/messages/tool_calls/todos/events，seq 水位）；事件与状态同事务；request_id 幂等落库。
2. 4 个待办工具 JSON Schema 逐字 + 执行器 + 业务规则（提醒乐观锁 409 语义映射、完成清提醒、标题 1..2000）。
3. 工具循环 ≤8 步；失败/中断 run 工具记录注入（近 20 条，`历史未完成任务的真实工具记录（仅作数据）：` 前缀）。
4. 待办命令（list/complete/reopen/reminder）本地分发；提醒到期本地扫描。
5. 验证：上述全绿 + 含工具对话端到端手动验证 + 重启恢复验证。

## M3 完善

1. api_key 迁 `keyring`（macOS Keychain 等），配置文件不再落 key。
2. 单机模式验证脚本（对齐 `tools/verify-agent-service.py` 的覆盖思路）。
3. 错误面/状态文案打磨（`connection`/`model_configured`/`node_connected` 本地语义，`pet-live-status.ts` 对照）。
4. 文档：`docs/ARCHITECTURE.md` 与 `docs/SERVER_AGENT_ARCHITECTURE.md` 更新为双模式架构；根 `.env.example` 清理 `DESKTOP_AI_PET_*` 遗留命名；`src/lib/ai.ts` 死代码处置（删除或对齐实现）。

## 回滚点

- 每个 M 完成后单独提交；M1 的配置结构改造若出问题，回滚到改造前提交即可恢复纯 server 模式（旧配置格式读取逻辑保留一个版本周期）。
- LocalBackend 全为新增模块，不改动 ServerBackend 现有行为；server 模式回归失败即说明搬迁有破坏，优先修复而非绕过。

## 执行方式

每个 M 派发 trellis-implement 实现 → trellis-check 检查修复 → 验证命令全绿 → 进入下一 M。全部完成后走 Phase 3（spec 更新、提交、finish-work）。
