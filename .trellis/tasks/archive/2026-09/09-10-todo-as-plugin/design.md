# 技术设计：能力插件 seam（todo 为首个范例插件）

对应 PRD：.trellis/tasks/09-10-todo-as-plugin/prd.md

## 架构与边界

### 插件包组成（7 个部分的归属）

| 组成 | 归属 | 现状锚点 |
|---|---|---|
| 工具定义（name/version/description/input_schema/permission） | 插件（声明于 plugin.json） | server/app/todo_tools.py:11-38 |
| 模型名 ↔ 业务名映射 | 插件（声明于 plugin.json；`domain.verb` ↔ `domain_verb` 规则固化为核心约定） | todo_tools.py:9、39；src-tauri/src/local_agent/tools.rs:13-21 |
| handler（业务执行体） | 插件（每端各自实现） | todo_tools.py:99-118 业务分支；tools.rs:186-197 |
| 参数校验 | 插件（每端各自实现；错误文案进 plugin.json 共享） | todo_tools.py:48-75；tools.rs:93-143 |
| 提示词片段 | 插件（文本在 plugin.json；每插件一个片段） | server/app/agent_service.py:31-34、38-43 |
| 存储方法 | 拆分：事务/事件骨架留核心，领域方法进插件 | server/app/runtime_store.py:372/394/417 留核心；:484-589 进 todo 插件 |
| 前端展示映射 | 前端独立维护（src/lib/<plugin>/presentation.ts），name 集合由 plugin.json 断言 | src/lib/todo-tool-presentation.ts |
| REST/Tauri 命令端点 | 核心（插件只声明，核心按约定挂载；不做动态注册） | server/app/main.py:111-166；src-tauri/src/lib.rs:491-502 |

### 核心插件接口（双端同构）

- Rust：`trait ToolPlugin { fn definitions(&self) -> &[ToolDefinition]; fn prompt_fragment(&self) -> &str; fn validate(&self, name, args) -> Result<Params>; fn execute(&self, ctx, params) -> Result<Value>; }`
- Python：等价协议类 `Plugin`。
- 核心循环持有插件注册表（有序 Vec / list），只调用上述接口。执行骨架（start_tool 幂等、finish_tool、错误消毒）上移到核心：todo_tools.py:82-98 公共部分、tools.rs:164-206 骨架与 :147-154 消毒逻辑。

### 数据流

1. 启动：核心扫描内置插件清单（显式注册顺序，非文件系统遍历）→ 各插件从共享 plugin.json 加载声明 → Python 侧 registry.register_server_tools 聚合所有插件定义 upsert 进 tool_definitions。
2. 运行：模型请求 bind_tools(注册表聚合的 model_tools) → 工具调用到达 → 核心按 business name 前缀（或映射表）路由到插件 validate → start_tool（幂等，核心）→ 插件 execute_in_tx（业务副作用与结果同事务）→ finish_tool（核心）→ resolve_server 校验保留（registry.py:26-37，改为对任意插件生效）。
3. 提示词：核心段 + 各插件 prompt_fragment（按注册顺序拼接）+ 动态时间上下文（agent_service.py:48-64 留核心）。
4. 前端：ChatPanel 经通用展示接口（{ name, status, text }）查插件展示表；插件声明 affects: ['todo-list']，核心按声明派发 UI 刷新（替代 todo-tool-presentation.ts:82-87 的硬编码 fingerprint 订阅）。

## 共享描述文件（单一事实源）

- 位置：`plugins/todo/plugin.json`（仓库根新目录 `plugins/`）。
- 内容：工具定义数组（name/version/description/input_schema/permission）、模型名↔业务名映射、提示词片段文本、参数校验错误文案表、affects 声明、提供的 REST 端点清单（声明性，供核心挂载）。
- Rust 端：`include_str!` 编译期嵌入（单机模式无运行时文件依赖），serde_json 解析生成 model_tools()，替换 tools.rs:24-62 手写 JSON。
- Python 端：importlib.resources 或仓库相对路径加载同文件；todo_tools.py 的 TOOL_DEFINITIONS 改为由此生成。
- 测试升级：tools.rs:217-242 逐字钉住测试 → 「双端同源加载产出相等 schema」等价性测试 + Python 对称测试。漂移从「靠人肉同步」变为「结构上不可能」。

## 双端触点清单

Python（server/）：
- agent_service.py:25 去 `from app.todo_tools import ...`；:116 `self.tools = TodoTools(...)` → `PluginRegistry(store, db_registry)`；:158/:340 bind_tools 改注册表聚合；:29-45 SYSTEM_PROMPT 拆分；:376 trace 的 tools 字段同步。
- registry.py:10-24 register_server_tools 遍历注册表聚合（消除 :11 函数内硬编码 import）。
- runtime_store.py：:372/394/417 留核心，:484-589 移入插件 store 模块。
- 新结构：`server/app/plugins/todo/`（tools.py / prompt 由 plugin.json 供 / store.py）。

Rust（src-tauri/src/local_agent/）：
- runtime.rs:260 `tools::model_tools()` → 注册表聚合；:279 分发改注册表。
- tools.rs：骨架上移为核心；todo 私有 match（:186-197）进插件实现。
- prompts.rs:5-21 逐字副本 → 由 plugin.json 片段生成；prompts.rs:47 测试改为快照测试。

前端（src/）：
- ChatPanel.tsx:419 附近改查插件展示表；todo-tool-presentation.ts 移入 src/lib/todo/presentation.ts 并注册。

## 兼容性与迁移

- DB schema 不变：001_core.sql:12-25 的 (name, version) 主键与 `server:{name}` 实例约定天然支持多插件；插件版本 ≠ 工具版本，工具 version 仍按单工具演进。
- 行为零回归是验收红线（PRD R8/AC6）。
- 回滚：按迁移步骤分步合并，每步独立可回滚；步骤 1（共享描述文件）本身不改行为。

## 重要权衡

- 选折中方案而非纯运行时共享 TOML/JSON：可声明化内容只占约 40%，handler/校验/存储必须双端实现；为 40% 引入跨语言资源打包与加载失败处理不成比例。
- REST 端点留核心：FastAPI 动态路由 + Rust 动态命令注册复杂度高、收益低；插件声明 + 核心挂载的薄层足够。
- 设备端预留：Plugin 接口不写死 server-only；execution_location='device' 的路由留待 D08 设备闭环任务，registry.py:39-41 空数组限制不动。

## 运维与回滚

- 无新服务、无新依赖；Rust 端 plugin.json 编译期嵌入意味着改插件定义需重编译（可接受，本就是代码级变更）。
- 若共享文件加载失败：启动即 panic/报错（fail-fast），不做运行时降级。
