# Implementation Plan

## Activation gate

- [x] User authorized creation of this independent Trellis task.
- [x] Existing plan/source inventory reviewed; PRD, design, execution plan and real context manifests prepared.
- [x] User approved the complete plan and five decisions with “开始执行” on 2026-09-08.
- [x] Started the task after approval and recorded branch `codex/desktop-pet-frontend-polish`.

The prior `chat-bubble-frame-abstraction` task remains unchanged. Implementation began only after the subsequent explicit execution request.

## Stage 1 — Whole-product visual baseline (R1/R2/R7)

- [ ] Record current commit, approved asset checksums, paw/filter/footprint invariants, window geometry and running application entry.
- [ ] Produce a six-view same-scale visual/state board using real empty or runtime states.
- [x] Established shared typography/color/feedback values in design.md and component styles.
- [ ] Reconcile historical acceptance notes with current source behavior, especially accepted-send expansion.
- [x] The existing reference and full direction were approved through the execution request; final six-view appearance remains subject to visual acceptance.

## Stage 2 — Components and content (R1/R2/R5/R6)

- [x] Assigned bounded implementers to shared presentation, chat interaction, and the live status layer.
- [x] Apply the confirmed visual system to compact and expanded chat, settings, tasks and reminders.
- [x] Implement approved placeholder visibility and structured-message presentation decisions only.
- [x] Preserve service/credential/write contracts, legacy decoration interfaces and native dimensions.
- [ ] Review complete views together before more decorative adjustments.

## Stage 3 — Input, navigation and native continuity (R3/R4)

- [ ] Add IME-safe Enter handling and verify actual Chinese composition behavior.
- [ ] Implement reading-position protection and the approved latest-content affordance.
- [x] Apply the approved return destinations and correct back icons/focus behavior.
- [ ] Verify click versus drag, native resize/paint transitions, transparent hit areas and repeated mode changes.
- [ ] Tune restrained motion and reduced-motion behavior against the unchanged approved character.

## Stage 4 — Real states and recovery (R3/R5/R6)

- [ ] Verify actual request acceptance→expansion, corresponding draft clearing, stream/tool visibility and completion.
- [ ] Verify failures, reconnect/history restoration and reading continuity with real available state.
- [ ] Verify settings validation/save/failure/credential reuse within explicitly authorized write scope.
- [ ] Verify actual todo/reminder state or honest empty state, including layout with long/error content.
- [ ] Record service/native unavailable cases separately; never substitute fixture success.

## Stage 5 — Acceptance and local delivery (R7)

- [ ] Complete AC1–AC9 with exact version, entry, data source and pass/fail/not-executed status.
- [ ] Verify light/dark/complex wallpaper, narrow content and available screen/scale configurations.
- [ ] Run at least ten consecutive native navigation cycles and capture representative screenshots/recordings.
- [ ] Record idle resource usage and animation behavior; treat60fps as a target until measured.
- [ ] Run risk-matched checks, package current assets once, verify the final local app and record rollback commits.

## Check commands and evidence boundaries

After relevant source changes:

```sh
node tools/verify-component-compact.mjs
node tools/verify-closed-reference.mjs
pnpm build
```

Run `pnpm pet2d:validate` only when pet rendering/assets change. Add Rust checks only when Rust changes warrant them. Do not build for plan/spec-only edits. Run focused meaningful regressions for IME/scroll/state logic; do not create an unrelated testing framework.

Use existing browser QA for geometry, form controls and empty states, retaining its submit guard. Use the final native app for window/hit-testing/focus. Use actual service/model events for real chat/tool claims. Label design-only boards clearly. Any controlled fault or business write needs a concrete scope first.

## Collaboration and finish

Dispatch `trellis-implement` with this task path and explicit file ownership; workers must preserve others' changes. Dispatch independent `trellis-check` after coherent batches. Main session owns final visuals, native evidence, spec updates and stage commits. Avoid concurrent writes to shared frame/App state.

No remote push/deployment by default. Do not archive this or the baseline task while required acceptance remains unresolved. Keep known gaps explicit instead of asserting a perfect experience from source/build evidence.

## Execution checkpoint

Implementation and independent review are complete. Final frontend build and debug app packaging pass; see verification.md for exact artifact names and evidence levels. Browser10-cycle navigation is passed; it does not check native10-cycle acceptance. Native closed/live-status and compact controls were observed; one real no-tool prompt reached the generating state. Completion/stream/code-copy could not be verified while the app was absent from the current on-screen window list. The user was asked to bring the existing pet to the current desktop. Do not archive this task or mark all ACs complete.
