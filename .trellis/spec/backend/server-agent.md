# Server-Agent Contract

## 1. Scope / Trigger

Applies to changes crossing FastAPI, LangGraph, PostgreSQL, Redis and Rust device clients. Preserve existing desktop art and interaction behavior. The service has four server tools: `todo.create`, `todo.list`, `todo.complete` and `todo.reminder.set`; device capabilities are empty. Habit learning is outside this implementation. One-time direct reminders follow [the reminder contract](todo-reminders.md).

## 2. Signatures

- `GET /health`: dependency status and model configuration presence, without credentials.
- Authenticated `GET /v1/status`, `POST /v1/sessions`, `GET /v1/sessions/{id}`, `GET /v1/todos` require the control role.
- `/v1/control/ws` requires control; `/v1/node/ws` requires node. Authenticate the bearer token before accepting the socket.
- `AgentService.submit(principal, request_id, session_id, text)` returns a durable acceptance. `events_after(principal, session_id, after_seq)` returns at most 200 ascending events.
- Authenticated `POST /v1/todos/{todo_id}/complete` requires the control role and returns `{item: Todo}`. Native `agent_complete_todo(todo_id)` returns `{generation, item}` without creating an agent run/tool call.
- Authenticated `POST /v1/todos/{todo_id}/reopen` requires control and returns `{item: Todo}` with `status=pending`. Native `agent_reopen_todo(todo_id)` returns `{generation, item}`. It is a direct operation, not a new model tool.
- Tauri `agent_list_todos()` returns `{generation, items}` from authenticated `GET /v1/todos`, without submitting an agent run or calling a model.
- `Database.pool` uses psycopg async connections, autocommit, dictionary rows and explicit transactions. Apply `server/migrations/*.sql` in filename order and record versions.

## 3. Contracts

Envelope: `{v: 1, type, request_id?, session_id?, run_id?, seq?, payload}`. Protocol version must be the integer 1. Payloads use snake_case.

```json
{"v":1,"type":"session.open","payload":{"session_id":null}}
```

`session.snapshot` contains `{session_id, seq, messages, tool_calls, runs}` at one transaction water level. `run.submit` supplies a UUID request ID, the current session ID and `payload.text`. Persistent events are `run.accepted`, `run.started`, `message.delta`, `tool.started`, `tool.finished`, `run.completed`, `run.failed` and `run.interrupted`.

New acceptance events go through the ordered database event pump. Only a duplicate acceptance whose sequence is already at or below the connection cursor may be acknowledged directly. Rust ignores duplicates, applies exactly the next sequence, and obtains a snapshot on gaps.

Configuration uses `PET_AGENT_DATABASE_URL`, `PET_AGENT_REDIS_URL`, `PET_AGENT_MODEL_BASE_URL`, `PET_AGENT_MODEL_API_KEY` and `PET_AGENT_MODEL_NAME`. The model timeout defaults to 90 seconds, graph step limit to 8, worker concurrency to 2. Model credentials stay on the server; desktop `agent-config.json` stores service address, device token and current session ID privately.

Tool definitions and instances are separate. Resolve callable instances against authenticated account/device identity and an implementation whitelist. Insert a todo and its tool result in one transaction. Serialize workers per session and bound cross-session concurrency. Expired running leases become interrupted; do not blindly replay side effects.

Session row locking is split by intent: `submit`, `claim` and every visible mutation (`append_delta`, tool and terminal writes) lock the session row, and `snapshot` keeps the lock so its `seq` is a true watermark; `events_after` only validates session existence and ownership with a plain read and never takes the session lock, so update polling cannot queue behind streaming writes. Each worker owns a private wake event (a shared event lets one worker clear a notification another has not consumed); `submit`/`stop` signal every worker, a worker clears only its own event BEFORE the recover/claim scan — a submission landing mid-scan must still wake the next wait — and the 1-second wait timeout remains the fallback scan so queued tasks are never missed. Submit (`agent_runs.created_at`), claim (`run.started` event), model start (`model_call_traces.started_at`), first response (`first_response_at`, may be a tool-call-only chunk) and first visible text (`first_visible_text_at`) are the durable timing points — tool responses and visible text are recorded separately; `tools/verify-agent-timing.py` measures them against the real model.

`todo_complete({todo_id: UUID string})` completes one existing account-owned todo and returns `{item: {id, title, status, created_at}}`. Todo status is `pending | completed`; migration `003_todo_complete.sql` expands the constraint without changing existing rows. Update by both ID and authenticated account in the same transaction as the tool result. Repeating completion returns the existing completed record; never insert a replacement. Share the account-scoped mutation between the model tool and direct HTTP endpoint; the tool owns its update/result transaction, while direct HTTP owns a separate business transaction.

Direct complete/reopen actions set an explicit target state (`completed`/`pending`), never toggle the stored state. Both are idempotent and account-scoped. Native clients validate the returned ID and action-specific target status before accepting success. No schema or credential changes are needed.

The model must obtain an actual todo ID from a query and resolve the user's explicit target. Missing or ambiguous targets require clarification. `todo_list({})` returns all records, including completed ones; UI and model responses must distinguish their business statuses from tool execution status.

Redis node leases use a 45-second TTL, 15-second heartbeats and connection generations. Redis notifications are best effort: PostgreSQL remains the durable event source.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Missing, revoked or wrong-role device token | Reject; existing sockets recheck immediately after waiting, before processing the next operation |
| Account attempts another account's session | Reject without leaking data |
| Reused request ID with different content | Conflict; do not create another run |
| Model not configured | Allow durable reads; reject model submission clearly |
| Model connection or HTTP failure | Persist failed run and a sanitized error; retain committed tool results |
| Unknown node capability | Reject; never advertise invented operations |
| Redis unavailable | Node registration unavailable; persistent control events remain recoverable from PostgreSQL |
| Missing/malformed/extra completion argument | Reject with validation error |
| Missing or foreign todo ID | Same non-disclosing not-found error; HTTP 404, do not update records |
| Direct write returns another ID or the wrong target status | Reject as unconfirmed; preserve current UI state and offer refresh/retry |
| Direct-list HTTP failure or unrecognized todo status | Sanitized error, never an empty successful list |
| Configuration changes during direct-list request | Reject or discard response from old generation |
| Event sequence gap | Reconnect/resnapshot; do not silently skip events |

## 5. Good / Base / Bad Cases

- Good: a real model invokes `todo_list`, streams a response and reconnects to the same persisted session.
- Good: direct list works with configured service credentials even when model/control/node connectivity is unavailable; only HTTP availability is required.
- Good: repeat reopen requests return the same pending record without inserting a replacement or creating an agent run.
- Bad: blindly toggling on a retry changes the final state back to completed.
- Base: a real empty database produces an empty todo list. No example records are inserted.
- Bad: a provider returns HTTP 502 while its container health is green. This is a failed model run, not successful business acceptance.

## 6. Tests Required

- Gateway isolated tests assert roles, revocation during socket waits, acceptance ordering, duplicate acknowledgements and integer-only protocol versions.
- Runtime isolated tests assert registry resolution, account ownership, transaction boundaries, idempotency and interrupted-run handling.
- Completion tests assert UUID validation, account scope, repeated completion, missing records and rollback when tool-result persistence fails. Direct endpoint tests assert auth and status errors without model/run submission; native write tests assert safe UUID path, auth, redirects and matching successful response.
- Reopen tests assert completed-to-pending, already-pending idempotency, foreign/missing rejection, no model submission, safe native path and matching pending response. Actual UI acceptance separately checks completing then reopening the same user-selected item, persisted state after refresh and keyboard focus.
- Rust direct-list tests assert bearer auth, redirect rejection, typed status decoding, failure-versus-empty distinction and no dependence on model/WS flags.
- Rust tests assert ordered projection and recovery. UI acceptance must separately verify draft acknowledgement, streaming, visible tools and reconnect behavior.
- `tools/verify-agent-service.py` uses real issued credentials and an actual model. Its default query is read-only; creation requires a user-provided real todo title that will remain stored. `tools/verify-agent-timing.py` verifies the submit→claim→model-start→first-response/first-visible-text timeline (tool-call responses and visible text reported separately), back-to-back submission order, gapless event sequence and mid-run reconnect recovery — including runs that already reached a terminal state during the disconnect, whose result arrives via the reconnect snapshot rather than a replayed event.
- Label evidence explicitly: isolated mocks, static/build checks, real service/model calls and real desktop UI observations are separate levels. Never seed business data merely to pass acceptance.

## 7. Wrong vs Correct

Wrong: immediately send acceptance sequence 4 while sequence 3 is still waiting in the event pump. The strict client sees a gap and reconnects.

Correct: commit acceptance, then let the event pump send sequence 3 followed by sequence 4. For a repeated request already acknowledged, return its existing acceptance without creating another run.

Wrong: clear a draft because a new message has the same text.

Correct: clear only when the exact submitted request ID is durably acknowledged. Another device can submit identical text.

Wrong: open a todo list by sending a chat message, or disable list access when the model is unconfigured.

Correct: use `listTodos() → agent_list_todos → GET /v1/todos`; keep credentials native, read without holding the state mutex across network await, and validate configuration generation before showing results.

Wrong: clicking a row's completion button submits a chat prompt or reports success before the database response.

Correct: pass that row's ID through the authenticated direct endpoint, keep the pending row on failure, and apply only the matching completed item from the current configuration generation.

Wrong: render a checklist control as a static image once completed, or implement `status = opposite(status)` on the server.

Correct: retain one focusable control, choose explicit `completeTodo(id)` or `reopenTodo(id)` from the displayed status, lock in-flight writes, and wait for the validated response.

## Conversation continuity and capability statements

`RuntimeStore.history(run)` reads the account/session's last40 nonempty messages before the run ordinal; `_run_graph` appends historical Human/AI messages in order, any unresolved tool facts, then the current user message once. A per-run checkpoint thread does not imply lost session history. Diagnose saved history separately from pre-model checkpoint inputs and real model behavior.

Resolve short follow-ups such as “创建代办” using the recent unique unexecuted proposal; ask only for missing/ambiguous information and do not replay completed or unrelated requests. Current system/tool declarations take precedence over historical assistant capability claims. Both the list and registered chat tools can set reminders under the shared reminder contract. A title containing a time never proves a reminder was scheduled. Model-selection probes without tool execution establish intent/arguments only, not persisted effects.
