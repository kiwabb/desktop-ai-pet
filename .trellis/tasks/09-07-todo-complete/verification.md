# Verification — todo completion and direct list

## Baseline

Real existing account has one pending todo and 11 agent runs before changes. Applied migrations are 001_core.sql and 002_runtime.sql. The read-only baseline is saved in research/before-migration.json; no new acceptance todo was created.

## Acceptance boundaries

- Isolated tests will cover completion validation, ownership, repeat calls, atomic results, and typed direct-list/stale-generation handling. They do not establish real model completion.
- Real migration must preserve the existing todo. Direct GET checks compare results and run counts without model submission.
- Actual desktop navigation/list inspection is required to claim visible interface acceptance. The previous Computer Use native-pipe failure is unresolved; it cannot be substituted with a browser mock.
- A real model request lacking a target may verify clarification without modifying records. Real completion requires a user-specified target or the user's manual acceptance.

## Status

Code implementation and review passed. Updated API and debug desktop application are running. Real completion of a selected todo and actual desktop navigation remain unverified; no real todo was modified during agent verification.

## Static and isolated verification

- Python: 37 runtime/graph/gateway tests passed, including completion validation, ownership, idempotency and rollback checks. These use isolated doubles.
- Rust: 5 tests passed, including native direct-list auth, empty/error responses, redirect rejection, invalid status decoding and independence from model/WS flags.
- Frontend build and Cargo build passed. Reviewer found no blocker; Rust formatting check passed. Existing art, frame and unrelated UI work were preserved.
- `pnpm tauri bundle --debug --bundles app` packaged the existing debug executable. The workspace debug bundle was restarted against Vite on 1421; the Desktop copy was not replaced.

## Real service evidence

- Migration 003 applied successfully; the existing pending todo remained unchanged. `todo.complete` is registered and the live schema accepts completed status.
- Two authenticated direct GET requests returned the same existing list. Agent run count remained 11 before/after, and no model request was submitted. See [direct-list report](research/direct-list-evidence.json).
- A real model request saying only “完成待办” replied “请指定要完成的具体待办事项。” It invoked no completion tool and did not change any todo. See [ambiguity report](research/ambiguous-completion-evidence.json).
- Computer Use again failed with `Sky Computer Use native pipe startup failed`. This prevents agent-observed desktop navigation/list acceptance; passing source/build checks do not substitute for it.

## Remaining checks

- User-specified real todo completion, followed by query/refresh showing completed status.
- Actual desktop list entry, refresh/error state, return-to-chat draft preservation and settings-switch behavior. Isolated/native checks cover the underlying boundaries but not the visible flow.

The root is not a Git repository; no commit/push was performed. Task remains in progress for these acceptance items.

## Direct completion button increment

- User explicitly requested a row completion button. Implemented direct `POST /v1/todos/{todo_id}/complete`, typed native IPC and the row action. The model tool and HTTP action reuse one account-scoped completion operation with their appropriate transaction boundaries.
- Latest checks: 42 Python isolated tests, 6 Rust tests, frontend build and Cargo build passed. Reviewer found no implementation blocker; formatting passed. Successful completion in these tests uses isolated doubles, not the user's real todo.
- Rebuilt debug bundle and restarted this project's API and desktop process. No new migration was required for this increment.
- Live endpoint checks rejected unauthenticated, malformed and missing-ID requests with 403/400/404. Agent run count stayed 12 and the existing pending todo was unchanged. See [button boundary report](research/button-boundary-evidence.json).
- Actual user-selected successful click remains to be accepted. No real todo was completed on the user's behalf during verification. Desktop automatic UI evidence remains unavailable because of the previously recorded Computer Use failure.

## Visual correction after user feedback

- Inspected official Things and Todoist guidance and actual Things reference screenshots; sources are recorded in research/todo-visual-direction.md.
- Product edits are scoped to TodoList.tsx and TodoList.css: left completion control, title-first rows, compact dates, quiet counts/refresh, and static completed marks. Existing asynchronous save/state guards remain intact.
- Frontend build passed. Static review confirmed 44px targets, keyboard focus, long-title wrapping, exact timestamp accessibility and reduced-motion handling. A final CSS-only refresh hover foreground correction increased computed contrast from 3.79:1 to 9.19:1; no redundant build was run.
- Live Vite on 1421 serves the new selectors (research/visual-asset-evidence.json). This proves asset delivery, not native appearance or a successful real completion click.
- Native visual acceptance remains unobserved because the recorded Computer Use pipe failure persists. No mock desktop, seeded records, real todo mutation or model request was used for this revision.
- Reviewer noted that successful completion replaces the focused button with a static mark; keyboard focus continuity after save remains a native acceptance item. No automatic focus destination was added in this visual correction.

## Reopen increment

- User reported that completed tasks could not be unchecked. The control now remains interactive in both states and calls explicit complete/reopen actions. User data read before restart showed one real completed todo and 12 agent runs; this is a read-only persisted-state observation, not a traced UI click.
- Python: 47 isolated tests passed. Rust: 5 agent_client tests passed; existing projection test was outside that filter. Frontend build and native cargo build passed; the existing debug binary was packaged with `pnpm tauri bundle --debug --bundles app`.
- Unit scenarios cover repeated restoration, invalid/missing/foreign IDs, complete/reopen identity preservation, HTTP authorization, response ID/target-status validation and redirect rejection. These are isolated tests, not successful mutation of the user record.
- The same checkbox-role button remains mounted with aria-checked/action labels. During writes aria-disabled plus the synchronous busy lock blocks duplicates while preserving focusability. Actual native keyboard/click behavior remains to be observed.
- Review passed after correcting checked-control hover/active colors; icon contrast is 4.74:1/5.88:1. PostCSS parsing and live Vite CSS checks passed after this CSS-only fix.
- Restarted only this project's verified API and debug desktop processes with the new native command. The Desktop copy was not replaced. Live reopen requests reject missing authentication/malformed UUID/missing record with 403/400/404; existing todo unchanged, agent runs 12 before/after, no model request. See research/reopen-boundary-evidence.json.
- Real successful reopen and native click/focus/refresh acceptance remain pending. Task remains in progress rather than treating unit or rejection tests as full UI acceptance.

## User acceptance: reopen

用户在取消完成增量发布后回复“可以了 下一步做什么”。据此记录取消完成实际使用通过（用户手动反馈）；不将该确认扩大为所有配置切换、异常、键盘焦点或模型工具场景均已验收。
