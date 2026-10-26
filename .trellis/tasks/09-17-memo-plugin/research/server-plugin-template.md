# Research: 服务端插件实现模板（todo → memo 对照）

- Query: 精读 server/app/plugins/todo/{manifest.py,store.py,tools.py} 与 server/app/plugin_runtime.py，列出 memo 版每个文件的类/方法签名、事务原语、校验流程，及 registry.py 注册校验逻辑
- Scope: internal
- Date: 2026-09-17

## Findings

### Files Found

| File Path | Description |
|---|---|
| `plugins/todo/plugin.json` | 唯一事实源：tools、name_mapping、prompt_fragments、validation_messages、affects、rest_endpoints |
| `server/app/plugins/todo/manifest.py` | manifest 加载器（26 行，几乎可原样复制） |
| `server/app/plugins/todo/store.py` | TodoStore：直连操作 + 事务内原语 |
| `server/app/plugins/todo/tools.py` | TodoPlugin + validated_arguments |
| `server/app/plugins/todo/__init__.py` | 导出 `TodoPlugin, TodoStore, todo_view, validated_arguments, validated_title` |
| `server/app/plugin_runtime.py` | Plugin Protocol、PluginRegistry 执行骨架、builtin_plugins |
| `server/app/registry.py` | tool_definitions/tool_instances 注册与 resolve_server 校验 |
| `server/app/contracts.py:28-71` | uuid_string / reminder_time / reminder_arguments / ReminderConflict |
| `server/app/runtime_store.py:24-31` | uuid_text / wire（行→JSON 序列化） |

### memo 版逐文件清单

#### 1. `plugins/memo/plugin.json`（新事实源）

字段完全对照 todo 版：`id:"memo"`、`tools[]`（每项含 `name`（点分业务名）/`version`/`description`/`input_schema`/`permission`/`execution_location:"server"`/`handler_key`（下划线模型名））、`name_mapping`（handler_key→name）、`prompt_fragments[]`（`{key,text}`，声明顺序=槽位顺序）、`validation_messages`（必须含 `arguments_not_object` 与 `unsupported_tool:'不支持该工具'`——后者被 `plugin_runtime.py:19` 的 `UNSUPPORTED_TOOL_MESSAGE` 对拍，`server/tests/test_plugin_registry.py:89` 有断言）、`affects`（todo 用 `["todo-list"]`，memo 应用独立组如 `["memo-list"]`）、`rest_endpoints`（声明式清单，实际挂载在 main.py 手写）。

建议工具集（对照 todo 四件套）：`memo.create`(kind/title/body?/review_at)、`memo.list`、`memo.update`（或 archive/complete 语义）、`memo.review.set`（review_at + expected_review_at CAS，完全复用 reminder_arguments 模式）。

#### 2. `server/app/plugins/memo/manifest.py`

逐行复制 todo 版，仅改 `PLUGIN_PATH` 指向 `plugins/memo/plugin.json`，常量改名：`TOOL_DEFINITIONS / MODEL_TO_BUSINESS / TOOL_HANDLERS / MEMO_PROMPT_FRAGMENTS / VALIDATION_MESSAGES / MODEL_TOOLS`（manifest.py:11-26 同构）。

#### 3. `server/app/plugins/memo/store.py`

todo 版结构（store.py:14-139）对照：

| todo 成员 | memo 版建议 | 说明 |
|---|---|---|
| `todo_view(row)` (store.py:14-16) | `memo_view(row)` | 选列 + `wire()` 序列化；memo 需含 `id, kind, title/body, status?, created_at, review_at` |
| `validated_title` (:19-23) | `validated_text/title` | 同样 stripped 1..2000，文案进 manifest validation_messages |
| `list_todos(account_id)` (:30-32) | `list_memos(account_id)` | 连接 + `memos_in_transaction` |
| `due_reminders` (:34-40) | `due_reviews(account_id)` | `WHERE account_id=%s AND status='pending' AND review_at <= now() ORDER BY review_at,id`（若 memo 无 status 则换条件） |
| `set_todo_reminder` + `set_todo_reminder_in_transaction` (:42-72) | `set_memo_review` + `..._in_transaction` | 核心事务原语：`SELECT ... FOR UPDATE` → 已完成/不存在检查 → `current == target` 幂等短路 → `current != expected` 抛 `ReminderConflict` → `target <= clock_timestamp()` 抛 ValueError（**用数据库时钟**）→ UPDATE RETURNING |
| `complete_todo(_in_transaction)` (:74-87) | 按 memo 语义（archive/resolve） | UPDATE ... RETURNING，行不存在抛 LookupError |
| `reopen_todo` (:89-98) | 可选 | 同上模式 |
| `create_todo(_in_transaction)` (:100-110) | `create_memo(_in_transaction)` | 直连版不带 source_tool_call_id；事务内版由 tools.py 内联 INSERT（带 `source_tool_call_id=tool['id']`） |
| `update_todo_title` / `delete_todo` (:112-133) | `update_memo` / `delete_memo` | UPDATE/DELETE ... RETURNING，LookupError 文案 |

#### 4. `server/app/plugins/memo/tools.py`

- `validated_arguments(handler, arguments)`（tools.py:15-42 同构）：按 handler 分支严格白名单键集合；时间参数走 `contracts.reminder_time`/`reminder_arguments`；id 走 `uuid_string`；所有错误文案从 `VALIDATION_MESSAGES` 取。
- `class MemoPlugin`（对照 TodoPlugin:45-92）类属性：
  - `id = 'memo'`；`definitions = TOOL_DEFINITIONS`；`model_tools = MODEL_TOOLS`；`validation_messages = VALIDATION_MESSAGES`；`affects = PLUGIN_MANIFEST['affects']`；`rest_endpoints = PLUGIN_MANIFEST['rest_endpoints']`
  - `__init__(self, db=None)` → `self.store = MemoStore(db)`（`store_for()` 靠 `getattr(plugin,'store')` 找到它，plugin_runtime.py:74-79）
  - `prompt_fragments()` → `list(MEMO_PROMPT_FRAGMENTS)`
  - `validate(handler, arguments)` → `validated_arguments`
  - `async execute_in_tx(self, conn, current, tool, handler, params)`：在核心事务内做业务写入并返回结果 dict；create 分支内联 `INSERT INTO memos(...,source_tool_call_id) VALUES (...,%s)` 用 `tool['id']` 保证幂等（todos 同款 UNIQUE 约束），需要 review 时同事务调 `set_memo_review_in_transaction(..., expected=None)`；返回 `{'item': ...}` 或 `{'items': ...}`。

#### 5. `server/app/plugin_runtime.py`（核心，**只改一行**）

- `builtin_plugins(db)`（:44-47）：`return [TodoPlugin(db), MemoPlugin(db)]`——注册顺序即提示词槽位顺序与 model_tools 顺序。
- 执行骨架（PluginRegistry.execute，:81-110）**无需改动**：`start_tool` 幂等（重复 call 直接返回已提交结果）→ `registry.resolve_server` 校验 DB 注册与本地 handler 一致（:96-98）→ `plugin.validate` → `store.executing` 事务内 `execute_in_tx` + `finish_tool` 原子提交 → 异常时仅 `ValueError/LookupError/ReminderConflict` 文案透传，其余消毒为"工具执行失败，未确认保存成功"（:108）。
- `store_for(plugin_id)`（:74-79）供 main.py 挂直连 REST。

#### 6. `server/app/registry.py`（无需改代码）

- `register_server_tools(plugins)`（:10-24）：启动时把所有插件 definitions upsert 进 `tool_definitions` 和 `tool_instances`（`server:<name>` 实例）。memo 只要进 `builtin_plugins` 就自动注册。
- `resolve_server(name, handlers)`（:26-36）：每次执行时 JOIN 校验 DB 中的 handler_key 与内存 handlers 一致，不一致抛 LookupError('工具执行实例不可用')。
- main.py lifespan（main.py:30-41）串起：`builtin_plugins(db)` → `register_server_tools(plugins)` → `AgentService(..., plugins)` → `app.state.memo_store = service.plugins.store_for('memo')`（需新增此行，对照 :41 的 todo_store）。

### 事务/校验要点（memo 必须继承的不变量）

1. 工具写入 = `start_tool`(幂等) + 单事务(业务+finish_tool)；重复模型调用绝不重复写（plugin_runtime.py:88-89）。
2. 提醒/review 时间一律用 **DB 时钟** `clock_timestamp()` 判未来性（store.py:65-67），不用应用时钟。
3. CAS 语义：`current == target` 幂等返回（允许丢失响应后的过期重试），`current != expected` 抛 ReminderConflict。
4. 直连 REST 操作（非工具）不走 run/tool_call，由 store 直连方法在自己的 `conn.transaction()` 里完成；`source_tool_call_id` 为 NULL（见 008 迁移把 todos 该列改为可空）。
5. 账号隔离：每条 SQL 都带 `account_id=%s`，外账号与不存在返回同一 LookupError 文案。

## Caveats / Not Found

- memo 是否需要 status（pending/completed）取决于"长期目标/备忘"两区的设计；若有完成语义，照抄 todo 的 status 检查约束演进（003 迁移模式）。
- `permission` 字段目前仅注册入表、未强制执行（registry.py 只 upsert）。
