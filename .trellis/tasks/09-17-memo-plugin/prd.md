# 备忘录插件

## 目标与用户价值

新增"备忘录"（memo）能力插件，解决用户的两个痛点：

1. AI 时代很多事情做一半就忘记了——随手记下的想法、进行中的事项，记完就再没看过。
2. 长期目标逐渐丢失——目标混在日常信息里，没有独立位置，逐渐被遗忘。

产品形态：备忘可记录、可查询、可钉"回顾时间"（到期由桌宠主动唤起用户回顾），并提供独立查看页面，长期目标单独成区展示。

## 背景

- 项目插件体系为"共享 manifest + 四端手工挂载"：`plugins/<id>/plugin.json` 为单一事实源，服务端 / Rust 单机模式 / 前端展示层各有一处显式注册点。先例：`plugins/todo/plugin.json`；官方落地清单：`docs/SERVER_AGENT_ARCHITECTURE.md:81-96`。
- 服务端 seam：`server/app/plugin_runtime.py`（Plugin Protocol + PluginRegistry，含幂等、事务同提交、错误消毒），注册点 `builtin_plugins()`（plugin_runtime.py:44）。
- Rust 单机模式对称 seam：`src-tauri/src/local_agent/plugin_runtime.rs`，注册点 `builtin_plugins()`（:157）；行为以服务端插件包为蓝本（`.trellis/spec/desktop/dual-mode-llm.md`）。
- 已有 todo 插件提供"待办 + 一次性提醒"。memo 与其区分：todo 是"要完成的事"（pending/completed），memo 是"要记住/回顾的信息与目标"（active/archived），回顾提醒语义是"再看一眼"而非"该做了"。
- 宠物主动唤起属核心设施：Rust 端轮询到期提醒 → `AgentView.reminders` → 前端 `App.tsx:267-299` 自动展开聊天面板。memo 回顾复用该唤起通道。

## 需求

- **R1 共享 manifest**：新建 `plugins/memo/plugin.json`，声明工具集、name_mapping、prompt_fragments、validation_messages、affects（`memo-list`）、rest_endpoints。模型侧工具：
  - `memo_create`（title 必填；kind: note|goal，默认 note；content 可选；review_at 可选，带时区未来 ISO 时间）——仅在用户要求记录时使用。
  - `memo_list`（可选 kind 过滤、可选含已归档）——返回真实记录供后续操作取 ID。
  - `memo_update`（memo_id + 期望修改的字段；目标不唯一先询问，不猜测 ID）。
  - `memo_archive`（memo_id；归档/取消归档）。
  - `memo_review_set`（memo_id、review_at|null、expected_review_at CAS，与 todo.reminder.set 同规约）。
- **R2 服务端插件包**：`server/app/plugins/memo/{__init__,manifest,store,tools}.py`，对照 todo 包结构；注册进 `plugin_runtime.py:44` 的 `builtin_plugins()`（位于 TodoPlugin 之后）；新迁移 `server/migrations/009_memos.sql` 建 `memos` 表。
- **R3 单机模式对称实现**：`src-tauri/src/local_agent/plugins/memo/{manifest.rs,mod.rs,store.rs}`，注册进 `plugin_runtime.rs:157`；`local_agent/store.rs` 新增 `user_version<2` 升级分支建 memos 表（本地首次引入增量迁移）。
- **R4 REST 与直连命令**：`server/app/main.py` 手写挂载 memo REST 端点（列表/创建/更新/归档/回顾设置/due 查询，均过 `principal()` 设备凭证认证、按 account_id 隔离）；Rust 端 `backend/mod.rs` 新增 MemoSource 分发 + Tauri 命令并在 `lib.rs` 注册；前端 `src/lib/agent.ts` 增加封装。memo 写操作必须复用现有 `todo_mutation_epoch/todo_writes_in_flight` fencing 计数器（`backend/mod.rs:473-503`），不另起一套。
- **R5 到期回顾唤起**：核心新增第二个轮询（15s，对照 `server.rs:282` 与 `local.rs:55-66` 的 todo 提醒轮询）查询 due 回顾；`AgentView` 增加独立字段（`memo_reviews` / `memo_review_error` / `memo_revision`），不混入现有 `reminders: Vec<Todo>`；前端唤起 occurrence key 用 `${id}:${review_at}`（对照 `App.tsx:275`），到期卡片自动展开聊天面板（沿用现有自动展开与已读抑制逻辑），卡片动作为"查看备忘"（打开备忘页）与"稍后10分钟"（review_at 顺延）。
- **R6 备忘查看页面**：新组件 `src/components/MemoList.tsx`，挂进 ChatPanel 头部按钮（对照 TodoList 模式），页面分"长期目标"（kind=goal）与"备忘"（kind=note）两区；支持查看标题/内容/回顾时间、归档与取消归档、手动创建备忘。工具卡片展示插件 `src/lib/memo/presentation.ts`（toolNames/affects 从共享 plugin.json 读取），`src/lib/tool-plugins.ts` 加一行注册；affects=`memo-list` 驱动页面刷新指纹。
- **R7 提示词布局扩容**：memo 的 prompt_fragments 加入固定布局，双端同步扩槽（`agent_service.py:42`、`prompts.rs:17-28`）；两份提示词全文快照（`server/tests/test_plugin_manifest.py:42-58`、`prompts.rs:64-83`）同步重写。
- **R8 测试**：双端 manifest 字面量对拍 + 前端一致性；提示词快照更新；执行骨架行为矩阵（幂等、事务同提交、错误消毒）；memo 工具校验与 store 行为测试（Python TransactionalDouble / Rust open_memory）；`test_plugin_registry.py:108` 实例总数随 memo 工具数更新。

## 关键决策

1. **核心形态**：记录 + 主动唤起回顾（用户确认），非纯被动记录。
2. **长期目标单独建模**：`kind` 字段（note/goal），页面分区展示（用户确认）。
3. **状态语义**：memo 用 active/archived（归档），不用 todo 的 pending/completed——备忘没有"完成"概念。
4. **回顾唤起走独立轮询与独立 View 字段**，不与 todo 提醒混排；两者同时到期时各自成卡，互不覆盖。
5. **memo 记录含可选 content 正文**（title 为摘要，content 为细节）。
6. **模型仅在用户明确要求记录时调用 memo_create**（沿用 todo 的克制约定）。

## 验收标准

- AC1（R1/R7）：服务端启动与单机模式启动均不因提示词布局失败；两份提示词快照测试通过。
- AC2（R1/R2/R3）：对话中"帮我记一下……"可创建备忘；"记一个长期目标：……"创建 kind=goal 记录；"我记过什么/我的长期目标有哪些"返回真实列表；重复同一 tool call id 不产生重复记录（幂等）。
- AC3（R4）：备忘页手动创建/归档与对话创建的数据互通；服务端模式与单机模式行为一致。
- AC4（R5）：创建带 review_at 的备忘后到期，桌宠自动展开聊天面板并展示回顾卡片；"稍后10分钟"后再次唤起；todo 到期提醒与 memo 回顾同时存在时两张卡都展示。
- AC5（R6）：备忘页"长期目标"与"备忘"两区正确分组；归档后默认从列表隐藏、可查看已归档并取消归档；工具调用后列表自动刷新（affects 指纹）。
- AC6（R2/R3/R4）：服务端 `pytest`、Rust `cargo test`、前端 `tsc`/构建 全部通过；双端 manifest 对拍测试通过。

## 范围外（Out of Scope）

- 智能回顾/每日摘要/周期性主动汇报（后续迭代）。
- 重复性回顾日程（每周回顾等）。
- admin 后台的 memo 业务数据页（工具目录会自动出现 memo 工具，足够）。
- 备忘录全文搜索、标签体系。
- 宠物形象/动画层面的新状态。

## 风险与延期项

- **提示词布局硬编码**：槽位数与 fragment 数不一致会启动即失败（Python import fail-fast、Rust 首次组 prompt panic）——实现顺序必须先扩布局再放片段，快照同步重写。
- **本地 SQLite 首次引入增量迁移**（`user_version` 1→2）：需谨慎处理既有用户数据，失败不可破坏现有 todos 表。
- **fencing 计数器共享**：memo 写不接入现有计数器会导致轮询-写入竞态。
- 延期：唤起卡片"查看备忘"之外的富交互（编辑、跳转定位到具体条目）可后续增强。

## 参考

- 调研结论：`research/`（prompt-layout、server-plugin-template、data-model-migrations、rest-command-chain、reminder-polling、frontend-presentation-panel、testing-conventions）。
- 插件 seam 原始需求：`.trellis/tasks/archive/2026-09/09-10-todo-as-plugin/`。
