# Research: 数据表与迁移惯例

- Query: 精读 server/migrations/（编号规则、todos 表 002:52-60 及 003/004/008 演进）和 src-tauri/src/local_agent/store.rs 的 todos 建表，给出 memos 表双端字段设计建议
- Scope: internal
- Date: 2026-09-17

## Findings

### Files Found

| File Path | Description |
|---|---|
| `server/app/db.py:19-29` | 迁移执行器：`pg_advisory_xact_lock` 串行化，`schema_migrations(version=文件名)` 去重，`sorted(glob("*.sql"))` 顺序执行 |
| `server/migrations/001_core.sql` | accounts 等核心表 |
| `server/migrations/002_runtime.sql:52-60` | todos 初始定义（见下） |
| `server/migrations/003_todo_complete.sql` | 改 CHECK 允许 `completed`（DROP+ADD CONSTRAINT） |
| `server/migrations/004_todo_reminders.sql` | `ADD COLUMN remind_at TIMESTAMPTZ` + 部分索引 |
| `server/migrations/008_direct_todo_source.sql` | `source_tool_call_id DROP NOT NULL`（直连创建无 tool call） |
| `src-tauri/src/local_agent/store.rs:54-116` | SQLite `SCHEMA_V1`（含 todos:96-106），`PRAGMA user_version` 版本门 |

### 服务端迁移惯例

1. **编号规则**：`NNN_snake_name.sql` 三位数字前缀，按文件名排序执行；版本记录是整个文件名（`db.py:25-29`）。当前最大 008 → memo 首个迁移应为 **`009_memos.sql`**。
2. 迁移在连接池打开时执行，autocommit 连接 + 事务块 + advisory lock；每个迁移文件应是幂等设计上安全的（虽然靠 schema_migrations 去重，不强制 IF NOT EXISTS，但 002 的建表无 IF NOT EXISTS，即惯例是一次性执行）。
3. **todos 表演进轨迹**（memo 应直接吸收终态，一次建全）：
   - 002:52-60：`id UUID PK`、`account_id UUID NOT NULL REFERENCES accounts(id)`、`title TEXT CHECK (length(btrim(title)) BETWEEN 1 AND 2000)`、`status TEXT DEFAULT 'pending' CHECK(status='pending')`、`source_tool_call_id UUID NOT NULL UNIQUE REFERENCES agent_tool_calls(id)`、`created_at TIMESTAMPTZ DEFAULT now()`；索引 `todos_account(account_id, created_at, id)`。
   - 003：status 放开为 `('pending','completed')`。
   - 004：`remind_at TIMESTAMPTZ`（可空）+ 部分索引 `WHERE status='pending' AND remind_at IS NOT NULL`。
   - 008：`source_tool_call_id` 可空（直连 REST 创建无 tool call），保留 UNIQUE + FK。

### 本地（SQLite）迁移惯例

- `store.rs:388-400`：`initialize()` 里 `PRAGMA user_version` 门——`version < 1` 才执行 `SCHEMA_V1` 并置 1。**当前没有增量迁移机制**：已存在的本地库 user_version=1，新表必须走 `if version < 2 { 执行 SCHEMA_V2 增量; user_version = 2 }` 模式（新增），同时 SCHEMA_V1 本身也应包含 memos 表（新装用户一步到位）。
- 字段差异惯例：SQLite 无 UUID/TIMESTAMPTZ 类型 → 全部 TEXT；时间统一 `normalize_instant()`（store.rs:120-122，`SecondsFormat::Micros` UTC 固定宽度，**字典序=时序**，SQL `<=` 比较合法）；账号维度整列省略（单账号本地库）。
- SQLite 的 todos（store.rs:96-106）已直接吸收服务端终态（status 两值、remind_at、source_tool_call_id 可空），并有 `todos_pending_remind_at` 部分索引。

### memos 表双端字段设计建议

PostgreSQL（`server/migrations/009_memos.sql`）：

```sql
CREATE TABLE memos (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id),
    kind TEXT NOT NULL CHECK (kind IN ('note', 'goal')),
    title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 2000),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    review_at TIMESTAMPTZ,                       -- 可空；到期由宠物唤起回顾
    source_tool_call_id UUID UNIQUE REFERENCES agent_tool_calls(id),  -- 可空：直连创建为 NULL（吸收 008 教训）
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX memos_account ON memos(account_id, created_at, id);
CREATE INDEX memos_active_review_at_idx ON memos(account_id, review_at, id)
    WHERE status = 'active' AND review_at IS NOT NULL;
```

SQLite（`store.rs` SCHEMA_V1 追加 + user_version=2 增量）：

```sql
CREATE TABLE memos (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('note','goal')),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 2000),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    review_at TEXT,                              -- normalize_instant 格式
    source_tool_call_id TEXT UNIQUE REFERENCES agent_tool_calls(id),
    created_at TEXT NOT NULL
);
CREATE INDEX memos_created ON memos(created_at, id);
CREATE INDEX memos_active_review_at ON memos(review_at, id)
    WHERE status = 'active' AND review_at IS NOT NULL;
```

### 设计要点

1. **kind 字段**：`note`/`goal` 对应 ChatPanel 的"备忘/长期目标"两区；双端都用 CHECK 约束枚举，前端 TS 用联合类型 `'note' | 'goal'`。
2. **review_at 语义对齐 remind_at**：可空 TIMESTAMPTZ/TEXT；到期查询 `review_at <= now()`（PG）/ `review_at <= ?1`（SQLite 传 `normalize_instant(now)`）；归档/删除时是否清空 review_at 需与 todo 的"complete 清 remind_at"（003 后 store.py:82 `remind_at=NULL`）对齐——建议 memo 归档时也 `review_at=NULL`。
3. **幂等列 source_tool_call_id**：UNIQUE 让工具重试（同 tool_call id）天然幂等；必须**可空**（008 的教训：直连 REST/命令创建没有 tool call）。memo 若一开始就有直连创建，直接建成可空，不要重走 002→008 的弯路。
4. **status 命名**：todo 用 pending/completed；memo 若语义是"归档"建议 `active/archived`（避免与 todo 完成语义混淆），具体取值由 prd.md 定稿，但双端 CHECK 与 TS 联合类型必须三处一致。
5. 视图行序列化：服务端 `memo_view` 选列 + `wire()`；本地 `memo_from_row`（对照 store.rs:13-25 的 todo_from_row）；双端输出字段集必须一致（id, kind, title, status, created_at, review_at）。

## Caveats / Not Found

- 是否需要 `updated_at`、`body`（长文本）字段未在需求中确认；当前按 title 单字段建议，若备忘需要正文，加 `body TEXT`（双端同步加）。
- 本地 user_version=2 增量机制目前**不存在**，需要新建（`initialize()` 中加一级 `if version < 2`）；SCHEMA_V1 是否直接改、增量如何写，属于实现决策。
