# 实施计划：待办作为插件

对应 PRD：.trellis/tasks/09-10-todo-as-plugin/prd.md；设计：./design.md

顺序原则：先同源性（消灭漂移），再抽 seam（不改行为），后搬 todo（seam 首个消费者）。每步独立可合并、可回滚。

## 步骤清单

### 步骤 1：共享描述文件，不改行为（✅ 已完成并通过 check，2026-09-10）
- [x] 建 `plugins/todo/plugin.json`：工具定义数组、名映射、todo 提示词片段文本、参数校验错误文案表、affects: ['todo-list']、REST 端点声明。
- [x] Rust：tools.rs 手写 JSON → `include_str!` + serde_json 从 plugin.json 生成（新增 local_agent/plugin.rs）；prompts.rs 改从片段生成（拆为 tool_rules + reminder_time_rules 两个片段，避免重排提示词）。
- [x] Python：todo_tools.py 的 TOOL_DEFINITIONS / MODEL_TOOLS 改从 plugin.json 加载；agent_service.py 的 todo 提示词段改从片段读。
- [x] tools.rs 钉住测试改写为「双端同源加载产出相等」等价性测试；Python 侧对称测试 server/tests/test_plugin_manifest.py。
- 验证：pytest 118 passed + 68 subtests；cargo test 50 passed（2026-09-10 全绿）。

### 步骤 2：服务端抽插件接口（✅ 已完成并通过 check，2026-09-11）
- [x] 定义 Plugin 协议（definitions / model_tools / validation_messages / prompt_fragments / validate / execute_in_tx）→ server/app/plugin_runtime.py。
- [x] todo_tools.py 拆为 server/app/plugins/todo/（manifest.py / store.py / tools.py）；execute 骨架上移 PluginRegistry（幂等 start → resolve_server 校验 → validate → 事务内 execute_in_tx → finish → 消毒）。
- [x] runtime_store.py：todo 领域方法移入 plugins/todo/store.py（TodoStore）；骨架留核心。
- [x] agent_service.py：import/构造/bind_tools/trace 全部改走 PluginRegistry，核心零 todo 符号；8 个 todo 直连端点移至 main.py 经 store_for('todo') 挂载。
- [x] registry.py：register_server_tools(plugins) 聚合 upsert；resolve_server(name, handlers) 对任意插件生效。
- [x] AC1 dummy 插件测试：server/tests/test_plugin_registry.py。
- 验证：pytest 121 passed + 68 subtests；cargo test 50 passed（2026-09-11 全绿，check 通过）。

### 步骤 3：Rust 侧对称改造（✅ 已完成并通过 check，2026-09-11）
- [x] 定义 ToolPlugin trait（plugin_runtime.rs）；tools.rs 删除，骨架上移 PluginRegistry；todo 分发进 local_agent/plugins/todo/（manifest.rs / store.rs / mod.rs）。
- [x] runtime.rs model_tools/execute 改走注册表；prompts.rs 经 builtin_plugins() 聚合片段；backend/mod.rs、local.rs 挂载点经 TodoStore 适配。
- [x] store.rs 移出 todo 领域方法（TodoStore 包装）；骨架留核心。
- [x] AC1 dummy 插件测试（plugin_runtime.rs 测试模块）。
- 验证：cargo test 51 passed；pytest 121 passed（2026-09-11 全绿，check 通过）。

### 步骤 4：提示词拆分收口（✅ 已完成并通过 check，2026-09-11）
- [x] plugin.json 的 prompt_fragments 改有序数组 [{key, text}]，声明顺序承载拼接顺序；双片段保留（核心中段嵌在两片段之间，合并必改字节序）。
- [x] 双端槽位布局组装（核心头 → 片段槽 → 核心中段 → 片段槽 → 核心尾），片段不足/超出 fail-fast；消除位置索引写法。
- [x] 双端快照 + 顺序稳定测试（聚合产物逐字节等于改造前；注册顺序驱动聚合含反转对照）。
- 验证：pytest 123 passed + 71 subtests；cargo test 55 passed（2026-09-11 全绿，check 通过）。

### 步骤 5：前端展示插件化（✅ 已完成并通过 check，2026-09-11）
- [x] 通用展示接口与注册表：src/lib/tool-presentation.ts（presentTool 未知工具降级、toolEffectsFingerprint 按 affects 派发）。
- [x] todo-tool-presentation.ts 迁入 src/lib/todo/presentation.ts 并注册；toolNames/affects 直接 import plugin.json 派生（结构性同源）；注册清单 src/lib/tool-plugins.ts。
- [x] ChatPanel.tsx 改注册表查询 + affects 派发；AC5 降级测试（src/lib/tool-presentation.test.ts，vitest 6 例）。
- 验证：pnpm test 6 passed；pnpm build 通过（2026-09-11 全绿，check 通过）。

### 步骤 6：文档与收尾（✅ 已完成，2026-09-11）
- [x] docs/SERVER_AGENT_ARCHITECTURE.md：新增决策 D13「能力插件 seam」+「如何新增一个插件」章节（AC7）。
- [x] server/README.md:45 过时引用更新；.trellis/spec/desktop/dual-mode-llm.md 蓝本引用更新为新插件结构（另两份 spec 无需改）。
- [x] 端到端验收：服务端模式真实链路全通过（verify-agent-service.py 建待办/查列表 + REST 设提醒 CAS/完成；注册聚合正确）；单机模式 verify-local-agent.mjs PASS + cargo 55 行为测试。
- [ ] 遗留人工项：单机模式真实模型聊天闭环与桌面 UI 目视验收需人工（无头环境不可达）。

## 验证命令

- 服务端：`cd server && .venv/bin/python -m pytest tests/`
- Rust：`cd src-tauri && cargo test`
- 前端：`pnpm build`
- 手动验收：两种模式下完整待办闭环。

## 风险点 / 回滚点

- 步骤 1 是行为中立重构，最低风险，先合。
- 步骤 2/3 动核心循环触点，是全任务最大回归面；合入前必须 AC6 的自动化部分全绿。
- 提示词片段顺序错误会静默改变模型行为——快照测试是防线，不可跳过步骤 4 的测试。
- 回滚粒度 = 步骤；git 分步提交。
