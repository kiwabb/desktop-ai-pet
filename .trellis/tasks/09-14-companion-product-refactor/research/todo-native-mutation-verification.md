# Research: Read-only verification of one authorized native Todo lifecycle

- Query: Verify creation, title editing, completion, reopening, reminder changes and deletion of the single user-authorized temporary Todo while preserving the two existing Todos.
- Scope: internal; the main session owns all ordinary native UI writes. This researcher performs only bounded read-only PostgreSQL queries and writes this research record.
- Date: 2026-09-15

## Findings

### Authority and identity scope

The parent reports that the user explicitly authorized creating only `桌宠交互验收（临时）`, testing its edit/complete/reopen/reminder interactions, then deleting it. No model call or change to the two original records is authorized. Queries use the established current session `d24a882d-334a-467e-a285-681de2a33205` solely to scope the existing account; they do not read other chat/history bodies or account credentials.

The database connection uses normal server settings internally, with `default_transaction_read_only=on`, 5-second statement timeout, 1-second lock timeout and repeatable-read transactions. No administrator login, model call, application mutation method, migration or `Database.open()` is used. Only the task's research file is written by this researcher.

### Files and code patterns reused

- `server/app/config.py:8` — normal server configuration loading; settings and credentials are never printed.
- `server/app/plugins/todo/store.py:14` — pure `todo_view` defines the public fields `id`, `title`, `status`, `created_at`, `remind_at`.
- `server/app/plugins/todo/store.py:30` and `:137` — account-scoped list semantics and stable `created_at,id` ordering.
- `server/app/plugins/todo/store.py:42` / `:74` / `:89` / `:100` / `:112` / `:123` — reminder, completion, reopening, creation, editing and hard deletion are existing business operations owned by the UI, not invoked by the researcher.
- `server/migrations/002_runtime.sql` and reminder migrations — current Todo identity/status/reminder shape.
- `research/native-chat-runtime-verification.md` — verified current account/session relationship and separation between database and native UI evidence.

### Original-record baseline

At `2026-09-15T03:18:54.822082Z`, the scoped database contained exactly two Todos. Both were completed and had no reminder.

Fingerprints are SHA-256 of UTF-8 JSON from the normal `todo_view`, with `ensure_ascii=False`, sorted keys and compact separators `(',', ':')`. This covers all five public fields, including title and timestamps, without printing the original titles.

| Original ID | Baseline SHA-256 | Status | Reminder |
| --- | --- | --- | --- |
| `3801041e-4a0b-4334-8bff-bd350550b1ac` | `06595881ae369ebfd33f1ba505e9f3e6a7f2f309f3b0f1c4f444846595067275` | `completed` | null |
| `c6f4de0d-3e44-4ae1-aabc-048ad2e7cf0f` | `db0aa4d8fe6d77ed51cfd401b79ef3eb7e8444873d0694a4a6c571141c5bee7e` | `completed` | null |

### Verification protocol

1. Locate a new temporary record only by the parent-supplied exact title and narrow creation window, capped at two matches. Require exactly one match before pinning its ID; never choose a globally latest record.
2. After title changes, scope exclusively to that pinned ID and current account, independently from the original records. Compare the actual public title/status/reminder with the parent-supplied expected phase.
3. On a UI failure, query for a persisted row before retry decisions; an error message by itself does not establish rollback or failure to create.
4. After deletion, require zero rows for the pinned ID, exactly two remaining account Todos, and both original IDs/fingerprints equal to the baseline. Until this comparison is run, do not claim original-record preservation as accepted.
5. Database reads confirm persisted state only. The parent independently observes UI pending/error messages, focus, refresh recovery, Escape behavior and final disappearance.

### Phase 1: initial native creation failed; no row found

The main session reports entering the exact authorized title and submitting with Return around `03:18:55Z`–`03:19:03Z`. The native UI retained the draft and displayed `未能保存，请重试。`.

At `2026-09-15T03:19:49.814314Z`, a read-only query of that exact title, current account, and `03:18:55Z`–`03:19:10Z`, capped at two matches, returned **zero records**. The same transaction counted **two** account Todos. No temporary record ID was obtained. This is evidence of no matching saved record in the checked window, not a diagnosis of the write failure.

### Phase 1 diagnosis: actual provenance-column schema rejects the direct-insert shape

The implementation worker identified that the direct creation path at `server/app/plugins/todo/store.py:105` executes `INSERT INTO todos(id,account_id,title) ...`, whereas the model-tool creation supplies its actual tool-call ID. At the parent's request, this researcher independently read only the live `public.todos.source_tool_call_id` column metadata and associated constraints at `2026-09-15T03:22:43.757021Z`:

| Metadata | Actual value |
| --- | --- |
| SQL data type | `uuid` |
| `information_schema.columns.is_nullable` | `NO` |
| `information_schema.columns.column_default` | null |
| `pg_attribute.attnotnull` | true |
| `pg_attribute.atthasdef` | false |
| Unique constraint | `todos_source_tool_call_id_key`: `UNIQUE (source_tool_call_id)` |
| Foreign-key constraint | `todos_source_tool_call_id_fkey`: `FOREIGN KEY (source_tool_call_id) REFERENCES agent_tool_calls(id)` |

The current direct INSERT omits a required column with no default, so its shape conflicts with the live NOT NULL contract. This closes the code/schema mismatch identified by the worker and explains the reported save failure with no new row. The metadata check did not retry an INSERT, execute a migration, modify constraints, or read business bodies. It did not independently capture a PostgreSQL exception/SQLSTATE from the earlier request; the diagnosis combines the traced INSERT, observed actual schema, native failure and absence of a saved test record.

HTTP evidence boundary: the main session observed only the native save-error message and no matching persisted row. It did not capture the actual HTTP response status. The exception middleware at `server/app/main.py:53` maps an unhandled failure to HTTP 503, so 503 is the source-predicted mapping, not an observed response for this attempt.

### Pre-migration check: pending set is only 008

Before the main session applies the prepared migration, this researcher compared the actual `schema_migrations.version` values with the filenames in the current `server/migrations/` directory using one read-only query and filesystem listing. There are **7 applied migrations**. The full pending set is exactly **`008_direct_todo_source.sql`**. No migration was executed by this check.

### Post-migration check: nullable provenance, constraints and data preserved

The main session reports that the standard CLI `.venv/bin/python -m app.cli migrate`, executed from `server/`, completed successfully without restarting the service. At `2026-09-15T03:27:31.611179Z`, this researcher independently performed a read-only, repeatable-read check:

- `schema_migrations` contains `008_direct_todo_source.sql`.
- `public.todos.source_tool_call_id.is_nullable` is now **`YES`**, with no default.
- `todos_source_tool_call_id_key` remains `UNIQUE (source_tool_call_id)`.
- `todos_source_tool_call_id_fkey` remains `FOREIGN KEY (source_tool_call_id) REFERENCES agent_tool_calls(id)`.
- The current account still has exactly **2** Todos, with exactly the original ID set.
- Both original five-field SHA-256 fingerprints are byte-for-byte equal to the `03:18:54.822082Z` baseline.

This confirms the applied schema change and original-record preservation at the post-migration checkpoint. It does not yet establish successful native creation or the remaining temporary-record lifecycle. This researcher did not retry creation or execute any write.

### Phase 2: native retry created the single authorized temporary Todo

The main session reports native success: the list showed 1 pending and 2 completed records, the new-title input cleared, and a success message appeared. At `2026-09-15T03:28:23.361700Z`, this researcher independently queried only the current account, exact authorized title and `03:27:30Z`–`03:28:30Z`, capped at two matches. Exactly one record matched:

| Field | Persisted value |
| --- | --- |
| Temporary Todo ID | `c3e4460e-6723-43bc-9f99-74933ff60bd7` |
| Title | `桌宠交互验收（临时）` |
| Status | `pending` |
| Created | `2026-09-15T03:27:51.516413Z` |
| Reminder | null |
| `source_tool_call_id` | null |

All later checks are pinned to this ID plus the existing account, independently of title edits. This is a real directly created Todo with nullable provenance, not a model/tool-created replacement. The researcher performed no creation/retry request.

### Phase 3: title edit and completion persisted

The main session reports editing the temporary title, refreshing and seeing the edited title retained, then completing the item with a success message and 0 pending / 3 completed items in the native list. At `2026-09-15T03:29:20.377189Z`, a read-only query fixed to the temporary ID and current account confirmed:

- ID remains `c3e4460e-6723-43bc-9f99-74933ff60bd7`.
- Title is exactly `桌宠交互验收（临时）· 已编辑`.
- Status is `completed`.
- `remind_at` and `source_tool_call_id` are both null.

The database check proves the edited title and completed status are persisted. Refresh rendering and success feedback are the main session's separate native observations.

### Phase 4: reopened and future reminder persisted

The main session reports restoring the same item to pending, completing/reopening it with keyboard Space while focus followed the same row, then saving a custom reminder for `2026-09-15 11:38 Asia/Shanghai`. The native UI showed a saved message and the `9月15日11:38` reminder label.

At `2026-09-15T03:35:54.630523Z`, a read-only query of the pinned ID plus account confirmed:

| Field | Persisted/read result |
| --- | --- |
| Title | `桌宠交互验收（临时）· 已编辑` |
| Status | `pending` |
| Reminder | Exactly `2026-09-15T03:38:00Z`, equivalent to 11:38 Asia/Shanghai |
| `source_tool_call_id` | null |
| Database transaction time | `2026-09-15T03:35:54.625666Z` |
| Due predicate at database time | false |

The existing schema stores the optional reminder timestamp on the Todo; eligibility is the read-only predicate `status='pending' AND remind_at IS NOT NULL AND remind_at <= CURRENT_TIMESTAMP`. No separate notification/claim record was queried or created. This researcher did not call a due/claim API, trigger notification processing, modify timestamps or alter status. The main session retains the ordinary app to observe actual due behavior; persisted scheduling is not yet proof of a native notification.

### Phase 5: actual native reminder observed by the main session

At `2026-09-15T03:39:26Z`, the main session reports observing the ordinary native app already expanded from the previously closed cat and displaying the real reminder card with title `桌宠交互验收（临时）· 已编辑` and `9月15日11:38`. Both a screenshot and accessibility output supported that observation. The main session reports no proactive opening action between closing the panel and this observation.

This records a **main-session native UI observation** of actual reminder presentation for the scheduled temporary Todo. It is not an independently captured UI observation by this researcher. `03:39:26Z` is the observation time, not an established exact trigger time; no exact notification delay or polling latency is inferred. The researcher made no reminder/API/model call and no database query for this phase.

The main session completed the item through the matching reminder card: the card disappeared, and the Todo list showed 0 pending / 3 completed with the temporary item checked. It then selected only that item's delete action and confirmation. The UI displayed `待办已删除。` and returned to 0 pending / 2 completed.

### Phase 6: deletion and original-record preservation verified

The research agent could not perform the final query because its turn hit a usage limit. The main session therefore performed the same bounded read-only PostgreSQL check directly at `2026-09-15T05:55:59.225655Z`. It used normal server configuration internally, a repeatable-read/read-only transaction, a 5-second statement timeout, a 1-second lock timeout and the established account/session scope; no credentials or original titles were printed.

- Exactly **0** rows remain for temporary ID `c3e4460e-6723-43bc-9f99-74933ff60bd7`.
- The account contains exactly **2** Todos and its ID set equals the original baseline.
- Both original five-field SHA-256 values match the baseline exactly. Both records remain completed with null reminders.

This closes cleanup and preservation for the single authorized temporary record. Its creation, edit, complete/reopen, saved reminder, actual native due presentation, reminder completion and deletion used real existing storage through the ordinary application, without a model call or fixture data. The final database query is main-session evidence, not an independent sub-agent result.

## Related specs and external references

- `.trellis/spec/backend/server-agent.md` — direct Todo operations, explicit states, account ownership and evidence boundaries.
- `.trellis/spec/backend/todo-reminders.md` — reminder/CAS and direct user mutation semantics.
- Task PRD/design — preserve real existing data; no seeded substitutes; native acceptance is independent of static tests.
- External references: none; current repository/database evidence only.

## Caveats / Not Found

- The authorized single-record lifecycle and final preservation comparison are complete. This does not verify every reminder option, failure/retry path or another account's data.
- Exact reminder trigger time and per-frame rendering performance were not measured.
- Queries did not trigger retries, reminders or mutations; all business writes were ordinary native UI actions owned by the main session.
