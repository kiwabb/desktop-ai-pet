# Interface rework independent review — 2026-09-26

## Scope and evidence

Compared the approved interface rework against `/var/folders/ys/cjf2rbtd03lg_fclhtmcmgn80000gn/T/companion-interface-baseline-ah477e7p`, not the historical dirty tree. Authority: `interface-rework-2026-09-26.md`, current `DESIGN.md`, and `companion-experience.md`.

This is source, isolated handler, and unit/static verification. The coordinator owns the final coherent native build and real UI acceptance. No application, model service, fixture database, or business record was created by this review.

## Findings (fixed)

- **P2 — safe connection reason lost during deduplication.** `ChatPanel.tsx` suppressed the connection error but kept only a generic disconnected message. The panel owner now uses the existing settings-context safe error mapping for known authentication/interface failures and only suppresses the original error when a replacement notice exists. Added tests cover 401/404, raw endpoint/secret exclusion, and a connected device error remaining visible.
- **P2 — nested Escape precedence.** New Memo editor and reminder-details Escape handlers did not honor an already consumed inner event; reminder details also lacked the keyCode 229 compatibility guard. The utility owner added both protections. The Memo editor regression confirms an inner-consumed Escape leaves the editor open.

## Findings (fixed, final navigation batch)

- **P2 — selected-page guard ignored cancellation of a queued different destination.** With App already awaiting a native mode transition, `toggleTodos()` can queue without committing. A subsequent current Chat click returned early and did not advance the page intent; after the host released the queued request the panel went to Todo. Reproduced using extracted actual handlers with a deferred host callback (unit evidence, not a claimed native reproduction). The panel owner fixed only the ChatPanel navigation boundary and its handler tests. A pending ref tracks only an uncommitted view/size intent; selecting the visible page replaces a different pending target while keeping the current size. Same-intent commit/finally cleanup cannot erase a newer request, and close/unmount invalidate it. The original conversation return size and settings origin remain unchanged. Once committed, repeated current-page selection is a true no-op, including during native tail work. Independent final source review passed.

## Findings (not fixed by reviewer)

- **P3 — navigation typography documentation drift.** Actual stable navigation uses 13px while `DESIGN.md` and the companion spec still say 12px. Documentation is coordinator-owned; sync was requested, without changing accepted application source. This does not block the native build.
- Native visual/interaction acceptance is outside this source review and remains coordinator-owned; it is a verification boundary, not an inferred product pass.

## Reviewed contracts

- The conversation feed remains mounted and session-keyed; composer draft, selection, acknowledgement and IME ownership remain intact. The composer retains a bounded scrollable multiline textarea, editable offline draft, accessible connection description, and disabled actual send when unavailable.
- Settings show saved mode/endpoint/model from `status`, separately from unsaved editable mode. Settings back/Escape restores its captured page and size; the explicit Chat destination still returns to chat. Saving remains guarded.
- Memo collapse keeps the form mounted and all unsent fields, restores focus to its opener, and consumes Escape before panel navigation. Failed/pending creation retains the draft and existing request/generation locks. Successful persistence remains the only clear action.
- Reminder sync summaries retain both safe error details. Actual due cards, complete/snooze actions, per-item write errors, CAS and occurrence handling remain unchanged. Failed Todo/Memo reads remain errors, not empty-success states.
- Companion CSS retains bounded body/reading overflow, explicit 32px-or-larger controls, unclipped connection text, and narrow multiline input sizing. Final visual fit and native focus belong to coordinator acceptance.
- All 9 frozen source/artwork entries covered by the turn manifest match their hashes, including App and pet source/assets. The manifest does not contain Rust files; this review did not edit native code.

## Verification

- **Full tests:** `pnpm test` passed **15 files / 121 tests** at 13:35:48, before the final connection/navigation corrections. No second broad suite is required; subsequent changed paths receive targeted checks.
- **Connection correction:** panel owner reports **11/11 ChatPanel tests passed**, including the added safe-error cases.
- **Memo editor:** utility owner reports **6/6 actual-handler tests passed** (included in the 121-test run).
- **Handler checks:** panel owner passed final `node tools/verify-chat-interaction.mjs`. Reviewed added queued Todo→Chat (compact/expanded and stale return size), Memo↔Todo cancellation, settings cancellation followed by return to its original Memo page, old callback/finalizer, and close invalidation scenarios. Existing stable selection, settings origin, save lock, draft acknowledgement, caret and IME coverage remains.
- **Lint:** no lint script is configured. Scoped `git diff --check` passed; owners also passed changed CSS syntax parsing.
- **Type check:** panel owner passed `tsc` after the final navigation batch. Coordinator final native build also checks final source; reviewer intentionally did not duplicate this command.
- **Native runtime:** pending coordinator acceptance. Unit/static success does not establish real sending, model streaming, or final WKWebView geometry/focus. The configured offline service remains an explicit environment limitation.

## Final source disposition

All material findings in this interface scope are fixed and reviewed. No source blocker remains. Source stability was confirmed jointly to the coordinator after the whole navigation batch; final native acceptance remains separate and must reference the new coherent package.

## Coordinator closure

Navigation documentation now states13px; the final installed native acceptance and exact package evidence are recorded in `interface-native-acceptance-2026-09-26.md`. The source-review evidence above retains its original scope.
