# Integrated frontend and admin review

Date: 2026-09-15. Active task: `09-14-companion-product-refactor`.

This is the full frontend/admin source review preparatory to final acceptance. It is not a final native, authenticated-admin, performance or R1–R12 completion claim. The reviewed desktop baseline was the ordinary `index-DH-v2eQj.js` build; the main session owns the subsequent Todo Unicode correction, native drag correction, ordinary packaging and runtime checks. Backend/native implementation auditing is assigned separately.

## Coverage and evidence

The review reconciled `objective.md`, the PRD's R1–R12 table, task design, `implement.md`, `review.md`, the baseline audit, `PRODUCT.md`, `DESIGN.md`, frontend/backend indices, frontend component/hook/state/type/quality contracts, native-window frontend contracts, dual-mode API boundaries and the admin control-plane contract.

| Area | Source covered | Concrete review scope |
| --- | --- | --- |
| Desktop host and pet | `src/App.tsx`, `PetStage.tsx`, `PetExpression.tsx/.css`, `PetLiveStatus.tsx/.css`, state/status helpers, `desktop-shell.css` | Single approved cat; fixed pet surface; confirmed cross-window visibility; request/reply cleanup; serialized page commits; same-mode activation; actual status; keyboard/context-menu actions; finite reaction/blink cleanup. Native drag source changes in flight remain separately owned. |
| Shell and motion | `ChatBubbleFrame.tsx/.css`, `ChatBubbleShell.tsx`, shell geometry, `useFrameMorph.ts`, frame/row entrance helpers | Frame/body/footer ownership, per-instance SVG IDs, attached/standalone geometry, hidden/inert boundary, dock scale, finite entrance, reduced motion, ghost/timer/RAF/observer cleanup and final hit-bound publication. Reuses the earlier independent lifecycle reviews of the frozen motion code. |
| Conversation and composer | `ChatPanel.tsx`, `ChatComposer.tsx`, `ConversationFeed.tsx`, `MessageContent.tsx/.css`, `useChatReading.ts`, conversation/tool presentation and `ChatInteraction.css` | Once-only acceptance, request identity, raw-draft preservation, selection attach/detach, IME guards, current page/read intent, history anchoring, passive follow protection, Markdown/link/image boundary, tool status and clipboard feedback. |
| Utilities | `TodoList.tsx/.css`, `TodoReminders.tsx/.css`, `AssistantSettings.tsx/.css`, `agent.ts`, reminder/time/error presentation | Typed IPC; model-independent Todo access; generation/revision fences; immediate write locks; refresh/edit preservation; confirmed deletion; reminder CAS and stable retry target; keyboard focus recovery; settings request isolation; save versus connection state. |
| Shared design and assets | `styles.css`, `design-tokens.css`, component styles and runtime asset imports | Cream/cocoa vocabulary, scoped styles, focus/disabled/overflow rules, motion tokens and reduced-motion overrides; approved reference and compatibility assets remain separate from inactive renderer compatibility styles. No asset was changed by this review. |
| Internal administration | All modules in `admin/src`: `main`, `api`, `Modal`, `accounts`, `models`, `runs`, `pages`, `ui`, `trace-helpers`, styles | Separate operator surface, login expiry, request fencing/abort/polling, role-gated audited body reads, pagination, clipboard failure retention, modal trigger restoration, mobile navigation trap/inert state, model version operations, trace selection/timing/partial and missing values. |

The four pre-existing scrollbar edits were not modified. Earlier source/baseline comparison established their preservation; this review made no desktop source or stylesheet edits.

## Findings fixed in this review

### Admin test feedback could belong to a different selected version

At `admin/src/models.tsx:41`, a test captures version A and continues after browser history changes the selected URL version to B. Disabling the version buttons does not disable `popstate`. Previously the response wrote unversioned result, success notice or failure text; the selection effect's one-time clear could be followed by A's late response, causing A's result to appear under B's selected-version heading. A network rejection reached the same unversioned generic action error path. This is a source-proven race, not an observed authenticated-browser/model failure.

After coordination, the reviewer changed only `admin/src/models.tsx` and added `tools/verify-admin-model-feedback.mjs`:

- Result, success notice and error carry the tested `versionId`; the actual JSX only presents matching feedback.
- The existing action catch accepts a test-specific error sink. Request rejection remains on the original no-refresh path, while resolved success/model failure still refresh version state. Other mutations retain their generic error handling.
- The existing immediate lock, `finally` cleanup, request endpoint, publication eligibility and revision CAS remain unchanged. Navigation does not cancel, repeat or claim to undo an already-sent model test.
- Starting another operation clears the previous transient test feedback. The raw model test result remains available for its matching selected version.

Seven isolated regressions execute the actual extracted handlers and actual JSX return: same-version versus A→B late success, returned model failure and network rejection, plus concurrent-action locking and preservation of generic action errors. They also check no-selection rendering and refresh behavior. They use isolated deferred promises and version records, not an authenticated session or a real model.

## Findings separately owned or not fixed

| Item | Exact boundary and disposition |
| --- | --- |
| Todo Unicode truncation | Main-session native evidence found `maxLength={2000}` truncating supplementary-plane input at 1000 characters. `TodoList.tsx` already validates trimmed `Array.from(value).length` before create/title-save IPC. The main session removed the two UTF-16 maxlength attributes and retains the 2000-code-point validation. This reviewer confirmed that contract and did not edit the file. New ordinary packaging and unsaved native input/error acceptance belong to the main session. |
| Small-display drag finding | Main session reported a separately identified native drag/refit defect and assigned its correction. This review does not approve that active native chunk or substitute the previous geometry checks for its new verification. |
| Summary build label | `review.md`'s top build row still calls `index-BIQhP3SI.js` “Latest”, while its final upward-reading section correctly records `index-DH-v2eQj.js`. Main owns the ledger and was notified to reconcile the summary with the next ordinary package. Historical 85-test recovery evidence remains valid as historical evidence. |
| Global protocol error boundary | `ChatPanel.tsx` renders its global `error` supplied by App, whereas terminal run errors and utility errors have context-specific presentation. The backend reviewer confirmed control/node `protocol.error.message` can pass unchanged into that global field; transport errors are mostly converted to fixed Chinese messages. No concrete current provider-body/credential leak or specific technical-text instance was established, so this is not recorded as a demonstrated leak or a new blocking defect. |

No additional material frontend/admin defect was established within this review. No UI, model request, credential access, database action or service restart was performed by this reviewer.

## Verification reused and newly executed

| Check | Evidence and result |
| --- | --- |
| Desktop frontend tests, reused | Last independent frozen-baseline run: **89/89 across 11 files**, including the 13 diagnostic tests. This is isolated unit/SSR evidence and predates the main session's new Todo correction. |
| Desktop interaction/motion checks, reused | Chat verifier and motion verifier passed; motion includes 8 actual-layout-effect lifecycle scenarios. Closed/compact checks and approved resource checks are retained from the task ledger. No unchanged suite was rerun in this review. |
| Desktop TypeScript/Vite/native build, reused | Main's ordinary `pnpm tauri build --debug` passed for `index-DH-v2eQj.js`, with unchanged `index-DYGFoG9B.css`. The main session owns the next package after its new corrections. |
| Admin regression, new | `node tools/verify-admin-model-feedback.mjs` **passed all 7 isolated handler/JSX cases** on the final patch. No new test framework was introduced. |
| Admin TypeScript and production build, new | `pnpm --dir admin build` **passed** (`tsc --noEmit && vite build`), final JS `index-Czd6WzIQ.js` 248.22 kB / gzip 78.08 kB; CSS `index-BcQ_amaO.css` unchanged. An earlier intermediate build is superseded by this final result. |
| Scoped whitespace, new | Modified admin source passed `git diff --check`. New verifier checked with `git diff --no-index --check /dev/null …`: no whitespace diagnostics (exit 1 reports a new-file difference). |
| Lint | No configured root/admin lint script. Not claimed as a separately executed lint pass. |

## R1–R12 disposition and unmet acceptance gates

| Requirement | Source/reused evidence | Concrete remaining gate |
| --- | --- | --- |
| R1 Pet and attached surfaces | Single cat asset path, live status/expression overlay and shell visibility/crop ownership reviewed. | Current ordinary composed cat/shell opening, closing, page changes and paired movement, with continuous layering and attachment. Per-window captures do not close this gate. |
| R2 Visual system and states | Shared desktop tokens and component states reviewed; admin remains an intentional separate operator surface. Existing ordinary captures cover compact/history/settings/Todo states. | Current composed visual review and remaining authenticated admin control/error states. No design-award quality or complete state-matrix claim follows from source. |
| R3 Purposeful motion | Finite frame/row lifecycles, bounded recovery, opacity/transform paths and reduced-motion source contracts reviewed and tested. | Ordinary visible transition quality and actual OS reduced-motion behavior. The diagnostic's 46 callbacks/natural completion do not establish smoothness or compositor FPS; its new no-paint branch was not triggered live. |
| R4 Native interaction and placement | Frontend request/ack, page/visibility commits and focus contracts reviewed; prior native focus and bounded dragging evidence retained. | Separately owned drag correction checks, current paired movement, edge fitting and actual cross-display transitions. |
| R5 Complete functional surfaces | Pet, compact/history/tools, shortcuts, Todo/reminders, settings and all admin routes inventoried in source. Existing real chat/tool/Todo flows retained. | Main's Unicode-input acceptance; remaining reminder-editor keyboard and authenticated admin modal/error flow. Brief transient tool-running visibility remains unobserved, distinct from the successful persisted tool execution. |
| R6 Display and content matrix | CSS reflow/overflow, fixed pet scale and narrow-column geometry reviewed. Real 1080p placement and long chat draft/reply observations already exist. | Remaining declared 2K/scaling/small-work-area/language-length and mixed-DPI transitions; do not treat logical geometry cases as tested hardware. |
| R7 Maintainability | Frame, content, utilities, projection and motion responsibilities remain separated; typed IPC and existing framework reused. Final admin typecheck/build passed. | Incorporate the main session's new corrections and their scoped checks; synchronize final records. No additional architecture rewrite is required by this review. |
| R8 Performance | Unchanged message identities prevent old Markdown reparsing; initial feed exposes 40 recent messages widened to a complete run; anchor lookup is cached and activation following has one owner. Cleanup is bounded. | A bounded current runtime DOM/layout/responsiveness assessment. `projectConversationMessages` still traverses the full snapshot and rebuilds maps; reduced scanning/scroll calls are not proof that all per-token work is O(1), nor a measured overall speedup. History growth is not claimed to be a permanently hard-capped 40-row DOM. |
| R9 Accessibility | Focus restoration, hidden/inert exclusion, keyboard controls, composition guards, contextual errors and documented static contrast reviewed. Existing actual typing/selection/reading observations retained. | Real Chinese IME conversion; OS reduced motion; remaining reminder editor and authenticated admin keyboard/focus behavior. Literal `ni ` input is not an IME pass. |
| R10 Integrated implementation/review | All frontend/admin areas reviewed; the new admin race is fixed and checked. | Root independent review of the new admin diff plus independently owned new native/Todo fixes. |
| R11 Business/API preservation | Typed agent boundary, direct Todo operations, ACK/CAS/idempotent retry and audited admin access preserved. Prior real provider/tool/persistence flows retained. | Current ordinary confirmation after root's changes and authenticated admin evidence when access is available. Isolated admin fixtures do not prove login, copy permissions or provider integration. |
| R12 Final acceptance | This document completes the integrated frontend/admin source-review portion. | Resolve the above material fixes and remaining ordinary composition/display/accessibility/performance/admin evidence, then perform final whole-objective audit and record/commit-boundary sync. Full goal completion remains unclaimed. |

The next highest-value authorized check is the main session's already prepared ordinary package: verify the unsaved Unicode input/error contract and the corrected paired drag/refit path, then judge the current composed cat/shell flow. Admin source/build verification can be reviewed independently; authenticated admin UI requires an actual authorized session. Additional diagnostic request variants, every failure permutation and physical FPS measurements for every route are optional investigation methods, not newly invented objective requirements.

The main session owns spec/ledger synchronization. The admin control-plane Web boundary should explicitly preserve version ownership for result, success, returned failure and request-rejection feedback while an already-sent test continues through URL selection changes.
