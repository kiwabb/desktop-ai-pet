# Local context native acceptance — 2026-09-29

## Evidence boundary

This record uses the original installed app, saved local endpoint/model and original
SQLite history. No seeded chats/business data, mock model, replacement endpoint or
second demo service was used. Native UI input created genuine conversational test
requests; all business operations requested were read-only. Isolated tests are
recorded separately in `local-context-check-2026-09-29.md`.

## Preserved baseline

- Original DB: `~/Library/Application Support/ai.desktop.pet.juban/agent-local.db`.
- SQLite online backup: `~/Library/Application Support/desktop-ai-pet/app-backups/local-context-20260929/agent-local-before.db`.
- Original schema v1: 1 session, 3 runs, 6 messages, 1 tool call, 1 Todo.
- Original message identity/content hash: `8e4cfe48caef0543d3c221b69072f866adaddd8ee81e10bb1eaec1a3856c75e9`.
- App/config backup directory: `~/Library/Application Support/desktop-ai-pet/app-backups/local-context-20260929-194139/`.
- Original installed binary SHA-256: `3b27d2fbe88f7b987c6eea9a8a16800d569c2fc10f438411093922622d1eac61`.

## Build and initial native flow

`pnpm tauri build --debug --bundles app` passed frontend type checking, Vite and
Rust native packaging. Final cleanup removed the superseded fixed-window reader
and its newly unused warnings; the frontend's existing >500 kB chunk advisory is
unchanged. Replaced `/Applications/橘伴.app` reversibly and verified its binary hash
against the built bundle. The initial installed slice hash was
`cb46161e38db214b002d8be12a9abc1331981bc95d5d51eb36cba82bcbe8b3b2`.

Native UI: open chat → connection settings → local → keep saved endpoint/model and
blank secret → save. Saved configuration is `http://127.0.0.1:8080/v1`,
`gpt-5.6-luna`. This is Rust local agent execution using a configured model endpoint,
not offline model inference. No secret was printed, entered anew or exposed.

Saving temporarily waited inside macOS `SecurityServer::ClientSession::decrypt`.
A two-second process sample located the existing `save_key → load_saved_key →
Entry::get_password` path, not HTTP or summary work. It later returned without
retry, key replacement or ACL changes. The UI showed local ready and the real DB
migrated v1→v3. Original message, tool-call and Todo rows compared byte/value equal
against the backup. The existing settings transaction holds AgentState while
waiting for Keychain; this separate configuration latency was not changed here.

## Genuine model runs and discovered recall defect

1. Run `71e2b861-1199-4d1c-91be-0fd158a33aa5`: requested the latest three original
   chat records, read-only. The real history tool completed and native UI showed
   “查找聊天记录” with bounded excerpts/has-more. Two model steps completed, with
   provider input counts 2887 / 3327, estimated inputs 4025 / 4450 and durations
   2980 / 4789 ms. It generated 24 durable `message.delta` events. Historical topic
   lookup worked, but the answer abbreviated an explicitly dated old reminder into
   relative wording.
2. Run `ca5f9f0a-db36-4970-8a9f-45410011c701`: followed up on that historical date
   without supplying the answer. The model searched an overly narrow phrase,
   matched only its own recap and incorrectly claimed the original date was absent.
   This is **not a passing recall result**. The actual tool and model ran: provider
   inputs 2964 / 3214, estimates 4126 / 4398, durations 3758 / 3990 ms; 27 durable
   deltas. Original business records remained unchanged.

The defect motivated a bounded correction: original run/message timestamps in
context and retrieval, timestamps in summary source input, and a generic rule to
prefer original facts/dates over assistant recaps and investigate narrow results.
No date-specific answer or test record was inserted into product code or user data.
Same-question native retest and final installed hash are recorded below when done.

These metrics measure parsed model steps, not native paint time. The raw estimate
is the full capped snapshot, not a measured old-version 40-message request. No
before/after latency or token-savings claim follows from these short conversations.

## Final installed retest — passed

Final ordinary debug app build passed, installed binary matching the built bundle:
`0451dd6e423f1d7a362cc1600757ec1c04be449fd365fe19fe38c670e4899e8d`.
The user completed the macOS Keychain authorization in the system window after the
final restart; the computer-use tool disallowed operating SecurityAgent, and no
alternate credential-access mechanism was used. Existing local history and tool
cards recovered, including the two earlier real verification runs; the draft
written during credential loading remained intact.

Run `ae2f968c-5b66-455c-98e8-71e1a78a23ff` sent the **identical** historical-date
question without injecting its answer. The model first retrieved three narrow
matches, then expanded to seven source messages, all with original timestamps.
The second lookup contained the original explicit date. Native reply correctly
stated **2026-09-09 14:00 Beijing time**. Both history tools completed normally.

| Model step | Estimated input | Full capped-snapshot estimate | Selected/available turns | Provider input | Duration ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 4748 | 4748 | 5/5 | 3537 | 6863 |
| 2 | 5288 | 5288 | 5/5 | 4098 | 6068 |
| 3 | 5910 | 6227 | 2/5 | 4853 | 4511 |

This genuinely exercised per-step budgeting: step three removed older complete
turns while preserving both current lookup call/result pairs. It is not a
before/after old-version benchmark. The real run has 23 durable message deltas,
two tool.started/tool.finished pairs and run.completed. Native observations covered
accepted message, waiting state, completed text and completed tool cards; these
observations do not quantify per-frame streaming paint latency.

Run `e0f5ea79-daeb-4d7e-b962-3c36c6785541` then requested current pending Todos,
read-only. The registered `todo.list` returned the actual one pre-existing pending
record. Native text and tool card agreed. Its two provider inputs were 3665/3755
tokens, estimates 4882/4988, model-step durations 3458/3923 ms. This confirms current
business state was read through the business tool, not inferred from old chat.

## Final data and remaining boundaries

`local-context-data-preservation-2026-09-29.json` records the final comparison:
v3, 7 runs, 14 messages, 6 tool calls, 1 unchanged original Todo, 0 Memos. Every
original message/tool/Todo row is unchanged; the original six-message hash is still
`8e4cfe48caef0543d3c221b69072f866adaddd8ee81e10bb1eaec1a3856c75e9`.
Only the four actual conversational validation requests and their model/tool
results were added. No business record was created, edited or deleted.

Summary cache remains empty because the real eligible old history is below the
automatic threshold. Summary threshold/provenance/failure/CAS/cancellation are
covered by isolated tests and review; **real model summary generation was not
triggered or claimed**. Oversized indivisible old turns stop summary advancement
without dropping source data. Mode-switch/concurrent-summary races have isolated
coverage, not an exhaustive native timing matrix. Keychain authorization latency
remains a separate existing configuration/startup issue.

The app remains installed and running in saved local mode. The broader companion
task remains active. Existing overlapping uncommitted work was preserved; no broad
commit was made. `local-context-slice-2026-09-29.patch` and the matching source
manifest isolate this slice against its dirty-worktree baseline for review; the
patch is not intended to apply directly to HEAD without its pending prerequisites.
