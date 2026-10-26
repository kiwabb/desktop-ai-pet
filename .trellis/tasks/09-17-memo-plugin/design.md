# 备忘录插件 — 技术设计

## 架构与边界

memo 是完全对照 todo 的第四个端的能力插件，核心骨架零改动：

| 端 | 新增 | 核心改动点（各一处显式注册） |
|---|---|---|
| 共享 | `plugins/memo/plugin.json` | — |
| 服务端 | `server/app/plugins/memo/{__init,manifest,store,tools}.py` + `migrations/009_memos.sql` | `plugin_runtime.py:44` 注册；`main.py` 挂 REST + `store_for('memo')`；`agent_service.py:42` 提示词布局扩槽 |
| 单机 | `src-tauri/src/local_agent/plugins/memo/{manifest.rs,mod.rs,store.rs}` | `plugin_runtime.rs:157` 注册；`store.rs` user_version=2 增量；`prompts.rs:17-28` 布局扩槽 |
| 桌面核心 | `backend/{server.rs,local.rs,mod.rs}` 第二路轮询与 View 字段 | `lib.rs` 注册 Tauri 命令 |
| 前端 | `src/lib/memo/presentation.ts`、`src/components/{MemoList,MemoReviewReminders}.tsx` | `tool-plugins.ts` 加一行；ChatPanel 挂页面入口；`agent.ts` 封装与 AgentView 类型；App.tsx 唤起 effect 扩展 |

执行保障（幂等 start_tool、事务同提交、错误消毒）由 `PluginRegistry` 骨架提供，memo 不重复实现。

## 数据契约

### memos 表（双端）

PostgreSQL `009_memos.sql` / SQLite（SCHEMA_V1 追加 + user_version=2 增量）：

- `id` UUID(PK) / TEXT
- `account_id`（仅服务端，FK accounts）
- `kind` TEXT NOT NULL CHECK IN ('note','goal')
- `title` TEXT，1–2000 字符（去空白后）
- `content` TEXT 可空（正文；title 为摘要）
- `status` TEXT DEFAULT 'active' CHECK IN ('active','archived')
- `review_at` TIMESTAMPTZ / TEXT（normalize_instant 格式，字典序=时序）
- `source_tool_call_id` UUID/TEXT 可空 UNIQUE FK agent_tool_calls（幂等；直连创建为 NULL——吸收 008 教训，一次建对）
- `created_at`；索引：账号+创建序、`status='active' AND review_at IS NOT NULL` 部分索引

归档时 `review_at=NULL`（对齐 todo complete 清 remind_at 的惯例）。kind/status 枚举在 PG CHECK、SQLite CHECK、TS 联合类型三处一致。

### 模型工具（handler_key → 业务名）

- `memo_create` → memo.create：title 必填；kind 默认 note；content、review_at 可选；创建+回顾原子保存。仅用户要求记录时使用。
- `memo_list` → memo.list：可选 kind、include_archived 过滤。
- `memo_update` → memo.update：memo_id + 待改字段（title/content/kind）；先 list 取真实 ID，不唯一先询问。
- `memo_archive` → memo.archive：memo_id + archived 布尔。
- `memo_review_set` → memo.review.set：memo_id + review_at|null + expected_review_at（CAS，同 todo.reminder.set 规约）。

### REST（`main.py` 手写挂载，过 `principal()` 认证，按 account 隔离）

`GET/POST /v1/memos`、`PATCH /v1/memos/{id}`、`POST /v1/memos/{id}/archive`（含 unarchive）、`PUT /v1/memos/{id}/review`、`GET /v1/memos/reviews/due`。manifest `rest_endpoints` 同步声明；`affects: ["memo-list"]`。

### AgentView 扩展

`View`/`AgentView` 新增 `memo_reviews: Vec<Memo>`、`memo_review_error`、`memo_revision`，与 `reminders: Vec<Todo>` 平行，不混类型。Memo 视图行字段：id, kind, title, content, status, review_at, created_at。

## 数据流

1. **对话写入**：模型调 memo_* → PluginRegistry.execute（幂等+事务）→ affects 指纹 → 前端 MemoList 刷新。
2. **直连写入**：MemoList 手动创建 → agent.ts → Tauri 命令 → MemoSource（Server=HTTP / Local=SQLite）→ 写成功后 `apply_memo_write`（从 memo_reviews 剔除该项 + bump revision，对照 mod.rs:482-492）。
3. **回顾唤起**：第二路 15s 轮询 `poll_memo_reviews`（server.rs，GET due 端点并校验返回形状）/ `due_reviews`（local.rs 直查 SQLite）→ `apply_memo_review_poll`（generation+epoch+in-flight 三重 fencing，对照 mod.rs:538-555）→ View.memo_reviews → agent:view → App.tsx 唤起 effect（occurrence key=`${id}:${review_at}`，沿用自动展开/重试/suppress 逻辑）→ MemoReviewReminders 卡片（查看备忘 / 10分钟后再回顾，snoozeRef 绝对时间防重复叠加）。

## 关键设计决策与取舍

- **第二路轮询 + 独立 View 字段**（非合并进 reminders）：todo 卡片围绕 remind_at/完成语义，memo 是回顾语义、动作不同；合并会污染类型且改动面更大。代价是多一次 15s HTTP（server 模式），可接受。
- **fencing 复用现有计数器**：memo 写走同一 `todo_mutation_epoch/todo_writes_in_flight`（实现时可重命名为通用名），保证 todo 写、memo 写与两路轮询互不交错；不另起计数器。
- **提示词布局扩槽**：memo fragment 追加在 todo fragment 之后、core_mid 之前；双端同步改槽位校验与两份全文快照。布局与 fragment 数不一致=启动即失败，属硬约束。
- **本地首次引入 user_version 增量迁移**：`initialize()` 加 `if version < 2` 分支；SCHEMA_V1 同步含 memos（新装一步到位）。升级失败不得影响既有 todos 表（增量独立事务）。
- **ChatPanel 页面态**：现有 `todosOpen` 布尔扩展为页面枚举（chat / todos / memos），避免双布尔分支组合爆炸。

## 兼容与回滚

- 服务端迁移 009 只加新表，不动既有表；回滚=DROP TABLE memos + 删除注册行。
- 本地 user_version 1→2 只 CREATE 新表；失败时保持 version=1，todo 功能不受影响。
- manifest 先落地、四端注册后若任一端缺失，其余端不受影响（前端未注册工具降级为通用展示）。
- 回顾轮询失败只进入 `memo_review_error` 卡片提示，不影响 todo 提醒链路。
