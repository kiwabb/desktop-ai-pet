# Research: durable todo reminder integration

- Query: Smallest persisted scheduled-reminder path using existing Python todo service and Rust device runtime; cancel, complete, reopen, snooze and stale-device semantics.
- Scope: internal
- Date: 2026-09-07

## Findings

### Existing files and code patterns

- `server/app/runtime_store.py:50`: `todo_view` explicitly selects wire fields; every added reminder field must be included here rather than relying on `SELECT *` reaching the client.
- `server/app/runtime_store.py:305`: direct list obtains account-owned rows without creating a run. `complete_todo_in_transaction` at line 315 is shared by HTTP and model completion. Reopen at line 324 explicitly sets pending. These are the correct mutation boundaries for reminder clearing.
- `server/app/main.py:21`: lifespan opens/migrates PostgreSQL, opens coordination, and starts agent workers. A DB-computed due endpoint needs no additional server scheduler or worker lifecycle.
- `server/app/main.py:54`: `principal(request)` authenticates the control role. Existing todo routes at lines 96–108 authenticate before validating the target ID. Preserve this ordering and sanitized 400/403/404/503 errors.
- `server/app/agent_service.py:138`: direct todo methods only delegate to RuntimeStore; reminder methods should follow this path without `_wake`, graph submission, tool registration or session events.
- `server/app/db.py:21`: migration filenames apply in order under a transaction/advisory lock. Add migration 004; existing records remain without reminders.
- `server/migrations/002_runtime.sql:53`: todos are account-owned, sourced from real tool calls; no need for another task/reminder table for one scheduled time per todo.
- `src-tauri/src/agent_client.rs:259`: `start()` aborts the previous generation's parent task and starts independent control/node reconnect futures in `tokio::join!`. Add a third independently retrying reminder poll future here. Do not put polling in a tab-mounted React component or either socket loop.
- `src-tauri/src/agent_client.rs:249`: `change()` guards generation, increments revision and emits a cached `agent:view`. Reminder projection can reuse this mechanism and survive frontend listener timing/focus refresh.
- `src-tauri/src/agent_client.rs:324`: native initialization happens on first `agent_view`; `src/App.tsx:88` installs the listener and then calls it during app mount. Both windows share one native AgentState, so polling remains one task per app process.
- `src-tauri/src/agent_client.rs:143`: direct operations copy config/generation before HTTP, avoid holding the state mutex while awaiting, and reject old configuration responses. Reuse bearer auth, redirect rejection, timeout, UUID path validation and typed response validation.
- `server/app/auth.py:30`: every HTTP authentication resolves the current nonrevoked device to account and role; no request-supplied account or device scope should be trusted.

### Recommended minimal contract

Persist nullable `remind_at TIMESTAMPTZ` plus `reminder_version BIGINT NOT NULL DEFAULT 0`. Add a partial index on `(account_id, remind_at, id)` where `status='pending' AND remind_at IS NOT NULL`. Time comparisons belong to PostgreSQL, not device clocks.

Proposed direct routes (names may be finalized by the main design):

- `GET /v1/todos/reminders/due`: read account-owned pending rows with `remind_at <= NOW()`, ordered by `remind_at,id`; return complete active due projection, not a destructive delivery queue. If bounded, return a total/cursor so undisplayed due rows are not silently lost.
- `PUT /v1/todos/{id}/reminder`: explicit timezone-aware RFC3339 time or null to cancel, with expected reminder version. Return the matching updated Todo. Reject naive/invalid timestamps, extra payload fields, completed targets and past new schedules with a clear error. Validate future time in DB transaction so device clock skew cannot decide acceptance.
- `POST /v1/todos/{id}/reminder/snooze`: explicit ten-minute operation; DB sets `remind_at = NOW() + INTERVAL '10 minutes'`. Require expected reminder version and pending status. Do not accept arbitrary duration in this MVP unless separately designed.

CAS/version behavior is useful even in this small scope: an old due popup must not cancel or postpone a newer reminder from another device, and a retry after a lost successful snooze response must not repeatedly push the reminder forward. A version mismatch should return conflict plus a sanitized refresh instruction; it must not silently retry with the newest version. Explicit absolute reminder saves can use the same CAS contract. A dedicated conflict error/409 handler will be required; none exists currently.

### Required transitions

| Trigger | Persistent result |
| --- | --- |
| Set/change time on pending todo | Store absolute timestamp; advance version |
| Cancel reminder | Set null; advance version; keep todo pending |
| Complete by button or model | Set completed and clear reminder in the shared transaction; advance version when invalidating a schedule |
| Reopen completed todo | Pending without restoring its old reminder; user sets a new time explicitly |
| Due endpoint read | No write or delivery acknowledgement |
| Later 10 minutes | Conditional update against displayed version, pending and currently due; new time uses DB NOW |
| Network failure/unknown write outcome | Keep an unconfirmed state; refresh before offering another version-dependent attempt |

Repeated complete/reopen must retain their existing explicit-target/idempotent behavior. Merely reopening an already pending todo should not clear a valid new schedule accidentally: clearing belongs to completion, not unconditional reopen.

### Native delivery and races

Poll immediately on startup/configuration change, then about every 15 seconds while the app runs; use bounded request timeout and retries independent from model/WS readiness. Offline, quit and sleep have no guaranteed delivery; the next successful poll recomputes overdue state from PostgreSQL and catches up. This is approximately timed in-app delivery, not an OS alarm guaranteed while the application is quit.

Expose cached due items and a separate reminder fetch error in AgentView, or a dedicated equally generation/revision-protected projection. Do not reuse chat connection errors or invent agent messages/runs. An error is not an empty successful due list; retain stale items only with a visible synchronization-error condition and server-validated actions.

Compare reminder keys `(todo_id, reminder_version)` to distinguish an existing visible reminder from a newly scheduled occurrence. Do not re-open or steal focus every poll. Returning all due records until completion/snooze/cancel allows a persistent panel to survive UI refresh without needing a delivered marker. Both windows receive app events, so choose one presentation owner; root owns the exact UI integration.

Configuration generation alone does not protect a read started before a same-generation write. Capture a native reminder mutation epoch before each poll, advance it on successful complete/set/cancel/snooze, discard a poll result if the epoch changed, and immediately refetch. Alternatively serialize reminder reads and writes through a dedicated async gate without holding the state mutex during HTTP. Otherwise an old poll response can bring a completed/delayed reminder back temporarily. Preserve ordered UI projection when a command response and event race.

Multiple devices in the same account will independently show the same due reminder in this MVP; no claim/lease is recommended because a device claiming and going offline could hide delivery elsewhere. Completion/snooze/cancel converges at the next poll; version checks reject stale writes. Exactly one device receiving each reminder would require a distinct delivery design and is not provided by this simple architecture.

### Verification scope for implementation

- Migration preserves existing rows with null reminder; timestamp serialization retains offsets/UTC meaning.
- Store tests cover future/due boundary using server time, account isolation, pending filter, cancellation, shared model-complete clearing, reopen semantics, repeated actions, stale versions, snooze retry and competing devices.
- Gateway tests cover auth first, malformed IDs/body/timestamp, conflict, missing/foreign indistinguishability, and zero agent submissions.
- Native tests cover HTTP auth/no redirects, typed nullable timestamps/version, generation reset, stale poll after write and independent failure state. Frontend mount is not the poll lifetime.
- Actual app acceptance separately verifies a user-authorized real reminder, live popup while list is closed, complete, later ten minutes, cancellation, persistence and offline catch-up. Do not insert fake todos or modify an unidentified real todo for acceptance.

## External References

None consulted: these are recommendations based on the current repository, not claims about external framework or product behavior.

## Related Specs

- `.trellis/spec/backend/index.md`
- `.trellis/spec/backend/server-agent.md`: account/role auth, shared todo transactions, explicit idempotent targets, generation fencing, evidence levels. Its current scope excludes reminders and must be updated by the main session after the new contract is agreed.
- `.trellis/workflow.md`: persist research; task PRD/design/implementation belong to the coordinating session.

## Caveats / Not Found

- Task PRD was still a short goal plus TBD requirements during this inspection; proposed endpoint names, 15-second poll and version field are recommendations, not an already implemented contract.
- No reminder columns, due endpoint, scheduler, OS alarm or delivery acknowledgement exists in inspected current code.
- No code, business data, runtime service or external account was modified. Only this research file was written; no live reminder or model invocation was verified.

## Final design resolution

Root design uses expected_remind_at timestamp CAS and explicit target scheduling instead of the optional version column/separate snooze endpoint proposed above. The task design.md and backend/todo-reminders.md are authoritative.
