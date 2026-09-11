# 参考 DeepSeek Harness：待办作为插件

## Goal

参考 DeepSeek Harness「Agent = Model + Harness、一切皆插件」的思想，为项目引入通用的能力插件 seam：核心 agent 循环不再硬编码具体工具域，待办（todo）迁移为第一个范例插件。用户价值：之后新增能力（记忆、检索、提醒等）= 新增一个插件包，而不是在双端循环里散落修改五处。

## Background / Confirmed Facts

### 外部参考（DeepSeek Harness）

- 核心理念：模型负责推理，Harness 提供可重组的插件化运行底座；新能力优先做成插件，只有默认循环职责变化才改 Agent Loop。
- 能力可替换、接口稳定：消费者依赖服务定义，Provider 负责实现。
- 官方 `packages/todo` 插件即为范例：会话级任务列表，跨轮次/跨会话持久。

### 本项目现状（代码证据）

- 待办是目前唯一的 agent 工具域，已按决策 D08「工具注册中心 + 执行路由」实现（docs/SERVER_AGENT_ARCHITECTURE.md:36、80-89）：
  - DB 表 `tool_definitions` / `tool_instances`（server/migrations/001_core.sql）
  - 注册中心 server/app/registry.py（register_server_tools 启动 upsert :10-24，resolve_server 调用时校验 :26-37）
  - 工具定义/校验/执行在 server/app/todo_tools.py（TOOL_DEFINITIONS :11-38、MODEL_TOOLS :40-45、validated_arguments :48-75、TodoTools.execute :82-127）
- 双端镜像约束：Python 服务端（server/app/agent_service.py，LangGraph 循环；SYSTEM_PROMPT :29-45）与 Rust 单机模式（src-tauri/src/local_agent/runtime.rs tool_loop :239-301、tools.rs、store.rs、prompts.rs:5-21）的工具 schema、提示词逐字镜像，tools.rs:217-242 有测试钉住一致性。
- 前端：src/lib/todo-tool-presentation.ts（toolKind 映射 + 文案 + fingerprint :82-87）、src/components/TodoList.tsx、TodoReminders.tsx，挂载于 src/components/ChatPanel.tsx:365-366。
- REST/命令：server/app/main.py:111-166 的 /v1/todos 系列；src-tauri/src/lib.rs:491-502 的 agent_* 命令，backend/mod.rs 分发。
- 设备侧能力暂未开放：registry.py:39-41 强制 capabilities 为空数组（D08 预留 execution_location='device'）。
- 相关历史任务：.trellis/tasks/09-08-todo-feature-upgrade/、archive/2026-09/ 的 09-07 server-agent-todo-mvp。

## Key Decision

- **方向（用户已选定 A）**：架构演进——定义通用插件 seam，todo 作为首个范例插件。
- **双端镜像解法（设计推荐，待批准）**：折中方案——可声明化的内容（工具 schema/description、提示词片段、校验错误文案、名映射）收敛为仓库级共享描述文件 `plugins/todo/plugin.json` 作为单一事实源（Rust 端 `include_str!` 编译期嵌入，Python 端加载同文件）；handler/参数校验/存储方法仍双端各自实现。现有逐字钉住测试升级为「双端同源加载产出相等」的等价性测试。

## Requirements

- R1 核心循环解耦：agent_service.py 与 runtime.rs 只依赖插件注册表接口（definitions/prompt_fragment/validate/execute），不出现任何 todo 具体符号。
  - Python 侧触点：agent_service.py:25（import todo_tools）、:116（self.tools 构造）、:158/:340（bind_tools(MODEL_TOOLS)）、:29-45（SYSTEM_PROMPT 拆分）。
  - Rust 侧触点：runtime.rs:260（model_tools()）、:279（tools::execute 分发）；tools.rs:164-206 执行骨架上移为核心 trait。
- R2 共享插件描述：`plugins/todo/plugin.json` 承载工具定义、提示词片段、错误文案、名映射；双端从它加载，漂移在结构上不可能。
- R3 提示词拆分：SYSTEM_PROMPT 拆为核心段（身份/中断恢复/失败诚实性/数据-指令隔离）+ 插件片段（todo 段 :31-34、:38-40）+ 动态时间上下文（model_system_prompt :48-64 留核心）；拼接顺序显式固定并有快照测试。时间规则段（:41-43）随 todo 插件走。
- R4 注册中心兼容：DB schema 不变（001_core.sql 的 (name, version) 主键与 server:{name} 实例约定天然支持多插件）；register_server_tools 改为遍历插件注册表聚合 upsert；resolve_server 校验保留并对任意插件生效。
- R5 前端展示插件化：定义通用展示接口（现 todo-tool-presentation.ts:36-79 的 { name, status, text } 形状），ChatPanel.tsx 查插件表而非硬 import；工具 name 集合由 plugin.json 断言覆盖；刷新订阅关系由插件声明 affects（如 ['todo-list']）核心按声明派发（现 fingerprint :82-87）。
- R6 存储方法拆分：领域无关骨架（start_tool/finish_tool/executing，runtime_store.py:372/394/417）留核心；todo 领域方法（runtime_store.py:484-589）进 todo 插件。
- R7 REST/Tauri 命令端点本阶段留核心，插件仅声明提供哪些端点，核心按约定挂载；不做动态路由注册。
- R8 行为零回归：现有 pytest（test_todo_writes.py、test_reminders.py、test_runtime_tools.py、test_runtime_graph.py）与 cargo test 全绿；用户可见行为（聊天建/查/改待办、提醒、UI）不变。

## Acceptance Criteria

- [ ] AC1（对应 R1/R2）：grep agent_service.py 与 local_agent/ 核心文件，无 `todo` 领域符号（除插件注册/加载点）；新增一个仅含 plugin.json + 空 handler 的 dummy 插件时，双端循环无需改动即可加载其工具定义。
- [ ] AC2（对应 R2）：双端等价性测试通过——Rust 与 Python 从同一 plugin.json 加载后产出的模型工具 schema 逐字节相等；改动 plugin.json 的 description 后双端同时生效。
- [ ] AC3（对应 R3）：提示词快照测试通过；拼接顺序固定（核心段 → 插件片段按注册顺序 → 动态时间上下文）。
- [ ] AC4（对应 R4）：server 启动后 tool_definitions 表内容与新注册机制 upsert 结果一致；篡改 handler_key 时 resolve_server 仍拒绝执行。
- [ ] AC5（对应 R5）：ChatPanel 渲染工具调用时经通用展示接口；移除 todo presentation 注册项后界面降级为通用展示而不报错。
- [ ] AC6（对应 R8）：`pytest server/tests/` 全绿、`cargo test`（src-tauri）全绿；手动验收：服务端模式与单机模式下各完成一轮「聊天创建待办 → 列表查询 → 完成 → 设提醒」。
- [ ] AC7：docs/SERVER_AGENT_ARCHITECTURE.md 增补插件 seam 说明（如何新增一个插件的清单）。

## Out of Scope

- 新能力域的实现（记忆、检索等）——本次只交 seam + todo 迁移。
- 设备端工具执行闭环（execution_location='device' 路由）——仅要求插件接口不写死 server-only 假设。
- FastAPI 动态路由注册 / Rust 动态命令注册（R7 明确留核心）。
- 前端 TodoList/TodoReminders 组件的功能改造。

## Risks / Deferred Items

- 双端 handler/校验仍是两份代码（漂移缓解靠共享文案 + 行为测试矩阵）。
- 提示词片段粒度：一个插件一个片段，避免句间引用被打散（todo 提示词 :39 依赖 :31 的工具命名）。
- registry.py:39-41 的 capabilities 空数组限制保持不动。

## Open Questions

- 无阻塞项。待批准点：Key Decision 中的折中方案（共享 plugin.json）是否认可——若倾向每端各自插件包（纯改良 (a)），R2/AC2 相应调整。
