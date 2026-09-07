# One-time todo reminder contract

## 1. Scope / Trigger

A direct reminder crosses PostgreSQL, HTTP, native background polling and React. One optional reminder belongs to a pending todo. Direct list operations do not invoke a model or create runs. Chat uses registered tools under the existing agent run; neither path needs queue-consumption state or a Redis scheduler. Existing accounts/credentials apply.

## 2. Signatures

- Migration004 adds `todos.remind_at TIMESTAMPTZ NULL` and an account/due partial index.
- `GET /v1/todos/reminders/due` -> `{items: Todo[]}`.
- `PUT /v1/todos/{todo_id}/reminder` body `{remind_at: string|null, expected_remind_at: string|null}` -> `{item: Todo}`.
- `agent_set_todo_reminder(todo_id, remind_at, expected_remind_at)` -> `{generation,item}`; TS `setTodoReminder(todoId, remindAt, expectedRemindAt)`.

- Model `todo_create({title, remind_at?})` (business `todo.create` version2) atomically creates a todo and optional reminder.
- Model `todo_reminder_set({todo_id, remind_at, expected_remind_at})` (business `todo.reminder.set` version1) sets/clears an existing pending todo reminder.

## 3. Contracts

Both chat tools retain the executing run's authenticated account and lease. Scheduled creation and reminder mutation share `set_todo_reminder_in_transaction`, and commit the business effect plus tool result in one transaction. A failed schedule must roll back a newly inserted todo; do not implement create and set as independently committed calls for a new reminder. Existing-target tools require real queried ID/expected time, and conflict errors are safe structured tool failures.

Model time context includes actual current time and the accepted request timestamp in `PET_AGENT_DEFAULT_TIMEZONE` (default `Asia/Shanghai`, validated IANA zone). `claim()` returns a wire-format run, so parse its aware ISO created_at string before localizing. Relative times anchor the accepted request; a bare HH.MM means HH:MM today unless context supplies another date. Past or ambiguous times require clarification, never silently tomorrow. Database time validation remains authoritative regardless of model output.

All routes authenticate control role before parsing account-owned input. Todo gains nullable ISO-offset `remind_at`, including direct queries and model tool results. Accept exact keys and timezone-aware valid timestamps, never naive local strings. UI datetime-local converts through local timezone to ISO.

Lock the owned todo row, compare parsed timestamp instants, reject completed targets. If the stored value already equals the target, return it (idempotent retry even if that time has since passed). Otherwise require stored value equals expected; compare new non-null time against the database clock and save in that transaction. `null` cancels. Completion clears remind_at atomically through the operation shared with the model tool; reopening leaves it cleared.

Due GET reads pending rows whose non-null time is <= database NOW(), ordered by time/id. Reading never consumes the reminder. Each signed-in device may show it; completing, cancelling or rescheduling changes the account's shared record.

Native adds `reminders`, `reminder_error`, `todo_revision` to AgentView. Poll independently alongside control/node loops, every15 seconds after each cycle, with finite HTTP timeout. Configuration generation cancels the old poll and discards old-account replies. Failures retain cached due data plus a sanitized sync error. The app must be running and connected for live reminders; reopen/reconnect catches up. No OS wake/scheduled notification guarantee.

Successful writes update cached due items and advance todo_revision so an open list refreshes. A private mutation epoch fences polls started before a write; never hold the native state mutex over HTTP. Frontend opens only the main pet panel, once per generation/id/remind_at occurrence during a process, with retry if a native mode transition delayed opening. A failed native resize must restore the prior React mode/ref before retrying; use a bounded15-second retry and recheck generation/current due items/close suppression. Closing suppresses reopening for that same occurrence; a later snooze time is a new occurrence.

Snooze sets one explicit timestamp10 minutes from the user's action, retaining that target for retries; it must not recompute a later time on every network retry. Show errors without removing the due notice until confirmed. A manual refresh after409 closes the stale editor and discards its expected timestamp/attempt; automatic revision refresh retains input. Reminder views/actions carry generation/unmount guards and do not interrupt chat drafts or runs.

## 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| Invalid or wrong-role credential |403, no business operation |
| Invalid UUID, missing/extra keys, invalid/naive timestamp, new past time |400 |
| Missing/foreign todo |404 without revealing ownership |
| Completed todo or stale expected time |409; refresh before retrying a changed plan |
| Same target retried |Return current todo, no repeated postponement |
| HTTP redirect or mismatched native response |Reject, sanitize error, retain local state |
| Configuration generation or mutation epoch changes |Discard obsolete result |
| Reminder read failure |Keep last known notice with sync error, never represent it as successful empty data |

## 5. Good / Base / Bad Cases

- Good: schedule one pending todo, go offline, reconnect after its time and see the still-due record.
- Base: existing todos migrate with remind_at null and produce a real empty due list.
- Good: a new conversational reminder creates one row with its remind_at and success result atomically; an invalid time leaves no orphan todo.
- Bad: an older device snoozes an already rescheduled record; expected time differs, so409 protects the new plan.

## 6. Tests Required

Model-tool tests additionally cover optional create time, shared setter/CAS, same-call retries, account/lease boundaries and business/result rollback. Model input tests cover actual wire timestamps, configured zone, date rollover and relative anchors; real-provider selection tests do not prove tool execution.

Isolated store tests cover future validation against DB time, nullable clear, same-target retry, stale CAS, account ownership, completed rejection and completion clearing. Due tests assert pending/time/account filters and stable order. Gateway tests assert auth, exact body and no model submissions. Native tests assert timeout/redirect/auth/typed response validation, independent polling and old-generation/epoch fencing. Frontend logic tests and source review cover local date conversion, stable retry target, occurrence deduplication and delayed opening. Actual native timed popup/actions/refresh are a separate acceptance level; no seeded or mock UI evidence may substitute.

## 7. Wrong vs Correct

Wrong: mount a timer only inside TodoList, consume due records on GET, or report that an exited app can notify.

Correct: persist the plan, poll from the native process independently of list visibility, keep due reads non-consuming, and state the app-running boundary.

Wrong: update the UI before persistence or compute a new snooze target after an uncertain response.

Correct: retain the intended target, await the validated response, and refresh after a conflicting plan change.

Wrong: tell the user to use a separate list because no conversational tool was wired, or create a title such as “15:15喝水” and claim a reminder exists.

Correct: call the registered reminder-capable create/set tool and confirm the actual returned reminder timestamp after success; ask for a date if that local time already passed.
