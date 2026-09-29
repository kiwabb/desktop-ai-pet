# Research: Native and backend integrated review

- Query: Audit the current native window, credential, diagnostics and direct Todo migration changes against the active companion refactor contract.
- Scope: Internal; bounded source inspection and reuse of explicitly identified earlier runtime evidence. No UI, model, business database, service, build or source mutation by this researcher.
- Date: 2026-09-15
- Status: Listed source review complete; G1 repair independently inspected and the worker reports 10/10 focused geometry tests passed. No full native/runtime acceptance claim.

## Findings

### G1 — Move can push the pet back onto the old display before drag-end chooses a display

**Evidence level: source plus pure arithmetic, not physical multi-display execution.** Root authorized a bounded repair after receiving this finding. The reviewed pre-repair source is also retained in `output/companion-review/native-integrated-current.diff`.

Source chain: `src-tauri/src/lib.rs:453` derives the proposed pet from the pointer-down origin and shared delta; lines 462–466 select the proposed pet's display but constrain the old, potentially oversized chat backing to that display. `src-tauri/src/lib.rs:285` then derives the release display again from the actual pet. `src-tauri/src/window_geometry.rs:19` selects nearest display by pet center, `:53` clamps an oversized rectangle to its leading edge, and `:43` checks backing size against the display selected at release.

Deterministic initial state in the same coordinate space, scale 1:

| Quantity | Value |
| --- | --- |
| Large display work area | `(0, 0, 1920, 1040)` |
| Smaller display immediately left | `(-800, 0, 800, 560)` |
| Initial attached chat | `(392, 24, 940, 760)` |
| Initial attached pet | `(1100, 403.1, 232, 380.9)` |
| Shared initial bottom-right anchor | `(1332, 784)` |
| Pointer delta | `(-1616, -203.1)` |

1. Proposed pet is `(-516, 200, 232, 380.9)`, center `(-400, 390.45)`, so display selection correctly chooses the smaller display.
2. Old chat backing would be `(-1224, -179.1, 940, 760)`. It cannot fit; the current group constraint places it at `(-800, 0, 940, 760)`.
3. Applying the same correction to both windows puts the actual pet at `(-92, 379.1, 232, 380.9)`, center `(24, 569.55)`, inside the large display.
4. Release selects the large display from that actual center. Its work area accommodates the old `940 × 760` backing, so `needs_refit` is false. The intended small-display refit is skipped.

The existing `refits_once_after_dragging_a_large_backing_to_small_display` unit case directly passes a small display to `fit_companion_on_display`; it does not exercise candidate selection → move constraint → actual pet → release selection. Thus that pass does not exclude this failure.

**Agreed repair boundary:** worker owns only `window_geometry.rs` and relevant `lib.rs` move/end functions plus focused pure geometry regression. When the candidate display cannot accommodate the old chat backing, constrain the fixed-size pet and apply the resulting shared delta to both windows. During that drag the oversized old chat is allowed to extend outside the smaller display, since it cannot fit without resizing. Release still selects the display from the actual pet and performs the existing one-time chat refit. Preserve the fixed pet dimensions, shared attachment, public command payloads, drag ID/end transaction, and no per-move backing resize. Include smaller-display, return-to-larger-display and reversal chains. This is an authorized design, not yet a verified implementation in this section.

### Reviewed file inventory and source boundaries

| File | Responsibility inspected |
| --- | --- |
| `src-tauri/src/backend/credentials.rs` | Keyring access, inactive-mode startup deferral, explicit local lookup, replacement/delete precedence and in-memory test store |
| `src-tauri/src/backend/mod.rs` | Nonserialized secret/migration state, guarded persistence, blocking config commands, mode generation and model-list credential fence |
| `src-tauri/src/lib.rs` | Main/chat initialization, shared coordinate conversion, fit/move/end, measured viewport, hit policy, native focus and diagnostic installation gate |
| `src-tauri/src/window_geometry.rs` | Fixed dimensions, display selection, constraints, fit and existing five pure tests; G1 is being repaired separately |
| `src-tauri/src/motion_diagnostics.rs` | Closed request protocol, explicit opt-in, readiness/apply acknowledgements, source/id fences and bounded cancellation |
| `src-tauri/tauri.conf.json` | Stable labels, fixed pet, hidden chat, smaller allowed chat minimum and CSP |
| `server/migrations/008_direct_todo_source.sql` | Drop only direct-Todo provenance NOT NULL |
| `server/migrations/002_runtime.sql:52` | Original Todo provenance UNIQUE and FK declaration |
| `server/app/plugins/todo/store.py:100` | Actual direct-create insert omits tool provenance; existing transaction/account boundary |
| `server/tests/test_todo_writes.py` | In-memory SQL-shape test boundary; not a PostgreSQL schema test |
| `src/lib/usePetGroupDrag.ts` | Captured origin, coalesced pending delta, sequential invoke drain and matching drag-end cleanup |
| `src/lib/motion-diagnostics.ts` | Frontend opt-in, arm/sample lifecycle, timers/rAF cleanup and restricted diagnostic actions |
| `src/App.tsx:41`, `:301`, `:418` | Actual CSS viewport acknowledgement and post-refit hit-bound publication |
| `src-tauri/src/backend/server.rs:434` | Narrow peer-requested audit of protocol error propagation; not a full server transport re-review |

The root supplied the tracked-file diff; no git command was run by this researcher. New geometry and migration files were inspected directly. The frontend and admin implementation review is owned by the parallel checker; the frontend inspection here is restricted to native IPC boundaries.

### Credential and backend compatibility

No additional material defect was found in the changed credential/startup path during this inspection:

- `backend/mod.rs:41` continues to omit the local API key from serialization. `:99–110` also omits the migration-pending flag, which is reconstructed from legacy plaintext by `:122–139`.
- `credentials.rs:67` hydrates at startup only for active local mode or a legacy plaintext migration. An inactive server-mode local key is not read simply to initialize metadata. This directly addresses the earlier server-mode startup stall without changing the chosen provider configuration.
- Migration success is acknowledged only after the credential store accepts the key. `backend/mod.rs:299–301` rejects every config persistence attempt while migration is pending, before temporary-file creation. This covers background session snapshots as well as explicit saves. `:153–158` retries pending migration on an explicit save.
- `backend/mod.rs:581–591` dispatches configuration work to `spawn_blocking` and acquires `AgentState` inside that worker. The explicit local save path still has synchronous credential semantics inside that blocking operation; it is not a claim that all configuration access becomes nonblocking to other state users.
- `backend/mod.rs:705–727` snapshots model-list configuration and generation, releases the state guard for credential lookup, then verifies generation before initiating HTTP. `credentials.rs:80–94` keeps new-key, same-endpoint reuse and changed-endpoint delete precedence. A denied store operation is an error, not an invented empty success.
- `backend/mod.rs:758` retains `agent_submit` validation and mode dispatch. Existing server/local Todo branches retain their account/mode split; changing UI or this migration does not merge their separate data sources.

The existing single keyring entry is written before the subsequent config-file write. A later file-write failure is not an atomic rollback of the keyring; the desktop spec explicitly identifies this as an existing limitation outside the startup migration change. This audit does not claim it was solved or that actual local Keychain denial/replacement behavior was newly exercised.

### Native lifecycle and frontend acknowledgement

- `lib.rs:307–366` uses one global AppKit point space, with the same Y conversion for window frames and visible screen frames. The non-macOS branch uses global physical origins and monitor scale for fitting dimensions. This source pattern avoids mixing per-monitor origins; it is not physical mixed-DPI verification.
- `lib.rs:383–410` returns the measured chat viewport from `set_pet_chat_mode`. Hidden opening prepares the chat backing and moves the pet without resizing it; compact/expanded changes retain the prepared backing. `set_chat_window_expanded` preserves its previous void compatibility wrapper. The drag-end exception resizes chat once when necessary and emits `pet-panel:viewport-changed`.
- `App.tsx:41–53` waits for actual `innerWidth/innerHeight` within one CSS pixel and removes the resize listener/timer. A 600 ms timeout reports the real match result. `:423–428` closes the native frame on a failed opening acknowledgement rather than treating timeout as readiness. The post-drag event handler at `:301–312` remeasures and republishes hit bounds with disposal guards.
- `usePetGroupDrag.ts:34–44`, `:47–64` and `:102–115` serialize this hook's invoke work, coalesce pending moves and drain before the matching end command. Cancel/unmount paths clear pending motion and request end cleanup. This is a per-hook queue; this inspection does not establish every interleaving between independent WebViews.
- `lib.rs:278–299` matches the active drag ID before ending it. Native move operations use one shared delta and position-only placement for both windows. G1 identifies a failure in which rectangle is constrained, not a need for per-frame resizing.
- `lib.rs:476–514` includes native WebView focus after showing the chat. Hit bounds are measured and clamped, and the hidden chat does not intentionally intercept desktop input. The setup pointer-policy poll is coalesced and active only while visible; it is a process-lifetime thread, not a component timer.
- `tauri.conf.json` preserves `main`/`chat` labels and the 232 × 380.9 pet dimensions. Chat remains initially hidden and nonresizable to the user; its smaller minimum permits work-area fitting. A minimum does not prove that a physical work area smaller than the pet itself can contain both windows.

### Diagnostics remain explicitly opt-in and bounded

`lib.rs:1–2` and setup's `cfg(debug_assertions)` exclude the native module from release compilation. In debug builds `motion_diagnostics.rs:87–88` returns before installing listeners or reading requests unless `PET_MOTION_DIAGNOSTICS=1`. Frontend `motion-diagnostics.ts:6`, `:14–16`, `:31` permits instrumentation only in development or the dedicated motion-diagnostic build. Ordinary production-mode frontend code returns normal mode and does not install the collector. These are source gates, not a fresh inspection of the currently running process environment.

The current protocol is phase-v5. Native schema rejects unknown fields/actions and validates the bounded request ID. Both windows must advertise matching protocol readiness; both must acknowledge the requested mode without errors before the target is run. Report acceptance is fenced by request ID, target window and the already-reported flag. An armed request is allowed only with normal mode and action none, has bounded timeout, and is cancelled on replacement/removal. The frontend cleans the timer, rAF, arm callback, marks and busy state when finished/cancelled (`motion-diagnostics.ts:89–109`). The allowed non-passive diagnostic actions are fixed existing controls, not arbitrary script or message input. Root's CUA-only action constraint remains a separate operational rule: the actual passive captures used `action=none`.

Existing diagnostic records establish only their recorded window lifecycle. The recovery sample in `research/passive-motion-overlap-protocol.md:169` has 46 callbacks, route-to-cleanup 532 ms and start-to-natural-end 255 ms; its long callback gaps do not establish smoothness or compositor FPS. The new no-paint recovery branch did not run in that capture. Earlier phase-v4 procedures and the zero-callback/watchdog phase-v5 capture remain historical evidence, not a failed current release claim.

### Migration 008 matches real direct Todo semantics

`002_runtime.sql:57` originally required `source_tool_call_id UUID NOT NULL UNIQUE REFERENCES agent_tool_calls(id)`. Actual direct creation at `store.py:105–109` inserts only ID, account and title; it correctly has no model/tool provenance to supply. Migration 008 drops only NOT NULL and does not update business rows, introduce synthetic tool calls, or remove UNIQUE/FK protection for non-null real tool sources.

This is supported by stronger earlier evidence than the in-memory store tests: `research/todo-native-mutation-verification.md:71` records an independent real PostgreSQL read-only check at 03:27:31.611179Z showing migration 008 applied, nullability YES, no default, and both original constraints/record fingerprints preserved. Its later phases record the root's ordinary native temporary Todo lifecycle plus bounded durable checks. The final 05:55:59.225655Z cleanup query was performed by root, not this researcher: zero authorized temporary rows remained, exactly the two original rows remained, and their fingerprints matched. No database or Todo request was repeated for this audit.

### Error-copy boundary handed to the frontend checker

The narrow peer-requested check confirms an existing raw protocol-message path: `backend/server.rs:434–443` copies `protocol.error.payload.message` into `AgentView.error` and a rejected submit acknowledgement; `:497` returns a node protocol message which `:321–338` places into `node_error`. Most inspected WebSocket/HTTP transport failures use fixed Chinese `map_err` strings. The precise technical content emitted by the server for all protocol errors was not inspected here, so this finding establishes the pass-through boundary, not an observed secret leak or a particular runtime error string. The parallel checker owns whether the displayed `App.error` needs a product-copy mapping.

### Verification reuse and remaining native acceptance

The root explicitly reports no backend/diagnostic Rust changes since the recorded 29 backend and 4 diagnostic test passes, before this newly authorized geometry repair. `review.md` independently records the 29-backend-test startup fix and actual cold-start success with the saved server configuration. Earlier individual Rust source hashes were not captured; reuse therefore relies on that explicit root change-history attestation plus the reviewed diff, not a retrospective hash equality claim. No test or build was rerun by this read-only researcher. The old five geometry cases are insufficient for G1; the implementing worker owns the newly required focused chain tests.

Existing real provider and native flows retain their scopes. The latest correlated request in `research/native-long-reply-verification.md:309` is run `9b76b8a5-5032-4854-a052-52cc2aaf098c`: one real `gpt-5.6-luna` call through the existing endpoint, zero tools, 1249 text events whose concatenation equals the durable 1841-character answer. Root's native captures show old reading position retained while later real deltas arrived and after completion, then explicit latest returning to the final answer. This does not exercise the geometry repair, every pointer gesture, a running-tool card or local mode.

Remaining gates relevant to this audit are composed pet+shell attachment and layering; actual cross-display pointer drag, small-work-area and DPI transitions; current ordinary visible motion/reduced-motion behavior; and the outstanding native input/accessibility/runtime-performance checks in the full R1–R12 ledger. G1's source and focused test closure is recorded below. Earlier external-1080p menu placement, cold start, ordinary provider/tool runs, restart recovery and direct Todo lifecycle are useful real evidence within those recorded configurations. They do not close the remaining matrix or establish release readiness.

### Snapshot fingerprints

Read-only SHA-256 captured during the pre-repair portion of this audit for stable reviewed inputs. Geometry and `lib.rs` were excluded from that initial table because the worker had not yet changed them; their final repair hashes appear below. G1's original finding is pinned to the root's pre-repair diff and its explicit arithmetic above.

| File | SHA-256 |
| --- | --- |
| `output/companion-review/native-integrated-current.diff` | `65a600e24a0ad4edd176244f1ed8e39e7acec3f5a41d2ae3c1ae4fe7ce4d8b29` |
| `src-tauri/src/backend/credentials.rs` | `ce304e6d942b7ac44774755749663cb22d2515dc1294bdbeed17215f9b8f7b05` |
| `src-tauri/src/backend/mod.rs` | `fa5556fbf1d1b88e7759bee144e3d134754577472a214d3848cd9505aae692c0` |
| `src-tauri/src/motion_diagnostics.rs` | `6b8f12350f295c5a8d0c2f98e6b9594eb5ad5f8ab7d9ad51e75eda74be4d8474` |
| `src-tauri/tauri.conf.json` | `5feca3fce5e61e0c62edd8fe0975338d58b0292ee31099a67348d78333bac7fb` |
| `server/migrations/008_direct_todo_source.sql` | `360f13a3eca7d47ec6ed0622d8d9d74b3381ec322ef2414758b9479582caa04c` |
| `src/lib/usePetGroupDrag.ts` | `e29df4879f3460a7c1026b0dff02d5aadbf4a211805af3543c7732202b7246cc` |
| `src/lib/motion-diagnostics.ts` | `a38c244e25a290fca3833167dff5ecfdc7dd1425c76238bd98e498806e52cbd2` |

### Follow-up: independent G1 repair inspection

The worker implemented `window_geometry.rs:59–68` as `constrain_companion_drag` and wired the actual `lib.rs:462–471` move path to it. The helper selects the pet when chat is hidden or the candidate display requires a refit; otherwise it constrains the chat group. In either case it computes one correction and applies it to both input rectangles without changing dimensions. Both actual native `place_window` calls remain `resize=false`; the release command, public command payloads and hit transaction are unchanged. This independently closes the specific G1 source defect. Focused test closure is recorded below; physical acceptance remains separate.

The new exact G1 test runs candidate selection → shared constraint → release selection instead of directly injecting the destination into fit. With the earlier pointer delta, the pet is now constrained to `(-516, 179.1)` on the small display (its lower edge reaches 560), so its center remains there. The old chat can exceed that work area until release; release refits once and a second release is stable. Other new cases cover a fitted small backing returning to the large display, reversing before release from the original pointer-down origin, negative-origin/scaled target fitting and hidden chat.

During independent source inspection, the initial scaled fixture was found to use physical work `800 × 560` at scale 2, i.e. logical `400 × 280`, below the unchanged fixed pet's 380.9 logical height. The existing fit routine's minimum therefore makes a 761.8-physical-pixel height, so an assertion that the entire layout fits 560 cannot pass. The worker reports the actual first focused run was 9/10, failing only this fixture. The worker changed the test work area to `800 × 840` for scales 1.25/1.5/2, whose smallest logical area is `400 × 420`, while retaining a width that requires refit. Neither production fit logic nor the containment assertions were relaxed. Physical work areas smaller than the fixed logical pet remain an explicit boundary, not a newly verified fit capability.

The worker then reported `cargo test window_geometry --lib --offline`: **10 passed, 0 failed, 66 filtered out**, including five added regressions. This researcher independently inspected the corrected fixture and the production helper/call site, and did not duplicate the test. The repair is closed at source plus isolated-test level. Final read-only SHA-256: `window_geometry.rs` = `92d2832248db2ac8a633130bac51a24688456ae4ea1b9e42eb549393002d274c`; `lib.rs` = `c819dcbe315ae4208d872f711176d6fd888d43cd6365ddeda96d9ca55c7fa19e`. These identify the reviewed repair and do not retroactively identify any earlier runtime package.

### Follow-up: Todo Unicode input contract

Root's `research/todo-unicode-input-verification.md` records actual unsaved native input in the prior ordinary package: pasting 1001 supplementary-plane CJK characters retained 1000 code points / 2000 UTF-16 units. The two HTML `maxLength=2000` attributes imposed UTF-16 length, while the existing frontend validation, Rust `chars().count()` and Python `len` use the 2000-code-point contract. Root removed only those input attributes, preserving validation before API calls. The observation and source fix are cross-layer evidence; post-fix ordinary native retention and over-limit rejection are still pending. No Todo was submitted or stored for that test, and it is not Chinese IME or persisted-long-row acceptance.

### Narrow reconciliation after source freeze

- Query: Compare only this round's three fixes and evidence counts across `research/integrated-review.md`, this file, and `research/todo-unicode-input-verification.md`.
- Date: 2026-09-15. Document-only comparison; no source, test, UI, model, database or service action.

| Current fix | Completed category | Still unverified in the compared records |
| --- | --- | --- |
| Admin selected-version test feedback | Source repair; **7 isolated handler/JSX regressions**; admin TypeScript and production build | Authenticated admin UI/model operation and actual browser-navigation response ownership |
| Native small-display drag | Independent source inspection; worker reports **10 geometry tests passed**, with **5 added** cases and **66 filtered out** | Current ordinary paired movement, composed attachment and physical cross-display/DPI fit |
| Todo Unicode truncation | Actual pre-fix unsaved native observation; removal of two maxlength attributes; source validation review | Post-fix ordinary 1001-code-point retention and 2001-code-point rejection; no persisted long-row or IME claim |

No material contradiction was found in those completion/evidence categories. The frontend review's references to native work being separately owned/in flight describe that review's boundary and earlier timing; they do not override the later source/test closure recorded here. Its top-level ordinary build and desktop checks explicitly predate the new corrections. None of these documents claims all three new fixes have completed real runtime acceptance.

Count correction: the researcher's preceding chat reply incorrectly said “34” for the historical backend/diagnostic tests. This file did not contain that combined count. Preserve the evidence categories separately: **29 historical backend tests** and **4 historical Rust diagnostic tests**. The frontend baseline is separately **89 tests across 11 files**, including **13 frontend diagnostic tests**; the admin's **7 new isolated regressions**, native's **10 geometry cases**, and **66 filtered-out tests** are separate categories. Filtered tests were not executed by the geometry command. No combined total or new execution claim is made.

Only this owned research file was updated. The other two authors' files and frozen source were left unchanged.

## Related specs

- `.trellis/spec/frontend/native-pet-windows.md`: fixed pet, shared coordinate space and attachment, monitor fitting, release-only refit, measured viewport and native evidence boundaries.
- `.trellis/spec/desktop/dual-mode-llm.md`: startup credential migration, blocking configuration work, model-list generation fence and persistence guard.
- `.trellis/spec/backend/server-agent.md`: direct Todo NULL provenance, preserved constraints, real-runtime versus mock evidence.
- `.trellis/spec/desktop/index.md` and `.trellis/spec/backend/index.md`: scoped review entry points.

## External references and versions

No internet source or external service was used. Dependency declarations were inspected only to identify the local context: Tauri 2, keyring 4, and the pinned tauri-nspanel revision in `src-tauri/Cargo.toml`. No conclusion depends on an unverified claim about a newer library release.

## Caveats / Not Found

- This review does not reproduce physical monitor transitions, operating-system DPI changes, compositor frame rate, or a complete release acceptance.
- No credentials, user message contents, connection strings, live business records, protected-system UI or model requests were accessed for this audit.
- Native source review is complete within the listed files, including G1's independently inspected repair and worker-reported focused tests. Current-package physical multi-display and the remaining R1–R12 runtime gates remain open.
