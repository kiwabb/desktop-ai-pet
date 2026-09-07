# Verification — todo reminders

## Evidence levels

Initial real read-only baseline: one existing todo,12 agent runs; migrations001-003. Private temporary baseline contains exact original records for post-migration comparison and will be deleted after checking. No new todo, reminder, model request or database was created for acceptance.

Implementation and isolated tests do not establish real scheduled popup, keyboard/layout usability or successful user-data modification. Native GUI automation is unavailable in the current environment; no mock desktop will replace it. Final acceptance requires a user-selected schedule and actual native interaction.

## Pending

- Implementation/review/test results.
- Migration004 preservation, real empty/available due results and authenticated rejection checks.
- Owned API/debug client restart; current desktop-copy bundle is not part of this deployment.
- Actual set-time → popup → snooze/complete → refresh/restore native flow.

## Implementation and isolated checks

Backend/native and frontend implementations completed; cross-layer review has no remaining code blocker. Python58 isolated tests passed; after strengthening tool-result rollback to preserve a scheduled reminder, the19-test affected suite passed again. Rust agent_client8 tests passed (1 outside filter), cargo build passed. Frontend build passed; final reviewer fixes passed `pnpm exec tsc -b`. No lint script is configured.

Review corrected failed native expansion rollback/deferred retries and stale editor expected-time retention after manual refresh. Four cases executing the actual mode-transition function with a stub native invoke passed; these are isolated function checks, not actual desktop actions.

## Real runtime checks

Migration004 applied by restarting the owned API. Existing todo fields were preserved, the one real record has remind_at null, and real due query returns an empty list. Auth rejects with403, invalid/naive or incomplete reminder bodies with400, missing todo with404. Reads and rejected writes left the record unchanged; agent runs stayed12 and no model was invoked. See research/runtime-evidence.json.

Packaged the existing debug native executable and restarted the workspace debug app against Vite1421; the Desktop copy was not replaced. Service access logs show4 successful due reads,1 issued by this verification and3 attributable to the running client's background polling. This establishes requests reaching the real server, not visible reminder UI. See research/poll-evidence.json.

## Remaining acceptance

Actual user-selected set-time → due popup → snooze/complete → refresh persistence, native layout/focus and offline catch-up have not been observed. No real reminder was scheduled for demonstration and no sample records were inserted. This task remains in progress for native acceptance; no commit/push occurred because the workspace root is not a Git repository.

## Context follow-up repair

User's real runs13/14 share the same session. The second run's step0 pre-model checkpoint has16 messages and includes the preceding drink-water request, assistant's proposed title and “创建代办”. History is present; research/history-runtime-evidence.json records the relevant checkpoint tail.

Changed SYSTEM_PROMPT only for context-based short follow-ups and accurate list-versus-chat capabilities; history/session architecture and tool registry are unchanged. Added graph input ordering regression;11 isolated tests passed. Scope review found no blocker.

A real call to the configured gpt-5.6-luna provider used the same actual16-message input with revised system prompt. It selected todo_create(title="15:15喝水") without clarification. No tool executor was invoked and no todo/run was written. See research/context-model-probe.json. The probe process exited0 with the valid result, but emitted an asynchronous HTTP stream cleanup warning; do not treat it as full tool/runtime acceptance.

Restarted only the verified idle API to reload the prompt; native rebuild was unnecessary. Existing reminder native acceptance remains pending, and chat still has no reminder-setting tool.

## Conversational reminder integration

User rejected the previous list-only scope. Added registered todo.create version2 optional remind_at and todo.reminder.set version1, with shared transactional setter. Scheduled creation and tool result commit together; invalid scheduling rolls the new row back. Configured IANA default zone and actual current/received timestamps guide model interpretation; real wire-format created_at strings are supported. Frontend tool cards distinguish set/clear/scheduled creation and refresh open lists only on relevant confirmed effects.

Python68 isolated tests and final TypeScript checks passed; frontend build and pure presentation/fingerprint assertions passed. Review strengthened time context after a real provider initially selected a past time despite the server guard. Final review has no code blocker. No native change/build was required.

Real gpt-5.6-luna selection probes used the original run13 history and actual user text. Replaying its historical15:12 receipt timestamp selected todo_create(title="去喝水",remind_at="2026-09-07T15:15:00+08:00"). This is a historical-clock replay, not a live future reminder. With live current time, the first probe failed; after the context fix the model said15:15 had passed and asked for a future time, with no tool call. No tool executor or database writes occurred in these probes. See research/conversation-reminder-model-probes.json.

Restarted the verified idle API. Real registry now exposes todo.create v2 and todo.reminder.set v1. Existing1 todo remained unchanged; runs14 before/after, due list empty, default zone Asia/Shanghai. See research/conversation-reminder-runtime.json. Frontend served by existing Vite; desktop still uses its existing debug bundle.

Actual conversational reminder persistence and timed native popup remain pending a user-selected valid future reminder. No implicit rescheduling of the user's expired15:15 request occurred. This section supersedes earlier historical notes that chat lacks reminder tools.
