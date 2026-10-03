# Independent customization review — 2026-09-30

Evidence: independent read-only source review against approved PRD R1–R7, design, execution plan and `check.jsonl` specs; owner handoff rechecked at 19:29 local time. This is not native acceptance or real-provider evidence. No credentials, user configuration, reference images or business database were read. No model request was made. Reviewer changes are restricted to this report.

## Findings sent to owners

1. **Closed: finalization retry can strand completed images** — `src-tauri/src/customization/mod.rs`, `customization_retry` / `run_job`. A final validation/save failure leaves four completed states but no saved preset; retry formerly rejected four completed states, while UI only offered continue. Rechecked: only ready jobs reject a no-stage retry; failed jobs resume at saving. `run_job` skips credential loading when no stages remain and breaks before `provider::edit`. The added `completed_assets_resume_saving_without_another_request` test covers stage selection; zero-network behavior is additionally established by source tracing, not a live-provider test.
2. **Closed: ready notification races cancellation-channel closure** — same module, `launch` and final `run_job` commit. Rechecked: finalization retains sender and `cancellation_requested` only returns for an actual true value; channel closure stays pending. Added async test exercises closure versus explicit cancellation. Late attempts remain fenced by current job ID/status/attempt.
3. **Closed: transient asset failures cannot be retried at unchanged revision** — `src/lib/useCustomization.tsx`. Explicit refresh increments an asset retry nonce when a previous load failed. Dedicated asset errors survive unrelated progress updates. Same-revision warning updates do not replace appearance payload. New hook regressions cover transient failure→retry, progress without redecoding, late decode after default restore and same-revision notification warning; independently executed successfully.
4. **Closed: retry disclosure incomplete** — `src/components/PetCustomization.tsx`. Actual saved endpoint/model now appears beside retry controls. Base redo discloses four requests, other state redo one; continuation derives count from incomplete states (zero when all four assets exist). Verified by source inspection.

Closed follow-up: `terminal_commit` can report unsaved terminal state, but `publish` previously overwrote that with “已保存” when event delivery also failed. Rechecked corrected `publish`: it preserves existing warning and appends neutral notification-failure wording.

## Remaining follow-up

Backend owner identified, reviewer confirmed: `run_job` invokes `provider::key` within `access`, holding the shared customization mutex during system-credential interaction. A first-use authorization prompt can therefore delay Cancel/view despite execution in the blocking pool. Recommended narrow fix: clone settings and required-request flag under the lock, release it, then perform credential read in a separate blocking task; retain the next job-attempt guard before sending any image request. Main/owner are coordinating this final correction with bundle timing. No actual Keychain interaction was attempted by reviewer.

## Reviewed behavior

- R1: frontend count/MIME/byte limits and Rust signature/decode/pixel limits exist. Rust normalization applies orientation and emits new PNG copies; originals are frontend File inputs and never written. Real native file selection remains unverified.
- R2: four real sequential edits are implemented; derived stages reference the generated base. PNG alpha/edge validation and common canvas/ground fitting exist. These heuristics do not prove subject identity or attractive transitions. Exact native fitting/connector integration is still being completed by owner.
- R3: palette construction checks paired text/action contrast; current companion controls and panel aliases consume custom tokens. Semantic errors retain established semantic colors. Preview uses local inline theme variables; editing accent alone does not modify active appearance. Explicit Save for an already-active preset intentionally updates it and is described in UI. Full visual coverage requires native review.
- R4: attempt IDs guard delayed work; cancel and mutations serialize with disk commits. Completed-preset redo copies assets to a new ID, preserving the good original. No automatic provider retry was found. Both original finalization findings are closed.
- R5: snapshots carry revision; listeners are installed before initial fetch; older snapshots are rejected. Asset identity excludes job progress/name/accent, avoiding repeated decodes while generating. A ready job becoming a preset at the same ID creates the expected selected asset identity. Active startup asset validation falls back to default with a warning; malformed state preserves original bytes and reports an error. Restart and multi-window consistency still need real evidence.
- R6: separate image keyring namespace/account references, no implicit chat secrets or history. Saving a changed endpoint clears prior credential association unless a new key is supplied. HTTPS/loopback validation is reused; redirects are disabled; response size and duration are bounded; provider error bodies are not surfaced. No service compatibility or billing claim has been verified.
- R7: customization uses separate files/state and task slot, not agent SQLite or chat settings. Storage commits save before replacing in-memory state; active mutation validates assets first. Business-record preservation remains a native acceptance item.

## Verification status

- Lint: no dedicated lint script in package.json; not run by reviewer.
- TypeCheck/build: owner reported `pnpm build` pass, including TypeScript. Reviewer did not repeat the full build.
- Tests: reviewer executed `pnpm exec vitest run src/lib/customization.test.ts src/lib/useCustomization.test.tsx src/components/ChatPanel.navigation.test.tsx`: 3 files, 14 tests passed, exit 0. Hook tests use an isolated React hook harness and IPC/image mocks; these are unit evidence only.
- Broader checks: frontend owner reported 168 tests / 22 files pass; main reported backend 131 full-library tests pass plus targeted follow-up. These are attributed handoff results, not independently rerun here.
- Native/provider: not run. Real upload, generation, four-state preview, full theme, relocation/restart, cancel/failure recovery and default restoration remain required.

All original blocking findings are closed in reviewed code; the additional credential-lock follow-up above remains. Native/provider acceptance remains required; current review does not establish feature completion.

## Main-agent follow-up, final bundle

The credential-lock follow-up above is now closed by current source inspection: `run_job` clones Settings inside `access`, awaits its completion, and invokes `lookup_key_with` outside that critical section. The next stage reacquires `access` and checks job ID/status/attempt before the HTTP call. This is source evidence; no real credential prompt or provider call was exercised. Final full checks passed: frontend 170 tests, Rust 137 tests, native app bundle built. Native configuration focus/keyboard access was verified in the final bundle; full provider acceptance remains outstanding.
