# Implementation Plan

## Activation Gate

- [x] User authorized creation; task created in planning without activation.
- [x] Inspect current components, CSS, App transitions, QA data sources and frontend specs.
- [x] Write converged PRD, design and this execution plan; curate implement/check manifests.
- [x] Final plan was presented; implementation occurred in another session. This session received explicit approval “那你改掉吧” after the concrete review-2026-09-07.md findings, authorizing the scoped repairs.
- [x] Activated the existing task with task.py start and loaded phase 2.1 Codex context for remediation.

## Review Remediation (2026-09-07)

- Repair the four independently verified frame defects and stale QA callers from review-2026-09-07.md.
- Preserve the current remote-agent send/settings behavior owned by the parallel agent-desktop-client task; do not restore obsolete business behavior from the original backup.
- Validate the isolated component without application CSS, host positioning with application CSS, real React visibility changes, both animation appearances and reduced motion, and current QA empty/unavailable behavior.
- Original native/real-agent acceptance remains separate; do not turn browser-only fixes into a claim that AC3–AC5 passed.

## Implementation

1. Record current affected-file content/backup and existing local desktop/dev processes without disturbing running services. Capture a bounded baseline for compact/expanded/settings layouts and original asset checksums. Treat QA messages as fixtures.
2. Dispatch trellis-implement with the active task path, native context injection (child-side fallback), and ownership of ChatBubbleFrame.tsx, its new CSS, ChatPanel.tsx, App.tsx, migrated styles.css rules, affected existing QA entry and compact verification script. Worker is not alone and must preserve other changes.
3. Implement props, namespaced self-contained styles, body/footer slots, dynamic accessibility and opt-in draggable header. Move only frame styling, leave chat/settings business behavior in ChatPanel. Preserve App's native transition sequence.
4. Update callers and required static assertions coherently. Do not add a test framework, fake chat data, second demo service or unrelated cleanup. Document standalone use and state semantics.
5. Main agent updates frontend component/state/quality specs where this abstraction changes existing contracts; unrelated task remains intact.

## Validation

- Inspect residual selectors/imports and all ChatBubbleFrame callers. Confirm internal styles do not require pet-shell/pet-chat/chat-window-app; host-only coordinates may use them.
- Run node tools/verify-component-compact.mjs and node tools/verify-closed-reference.mjs after updating legitimately moved selectors. Keep asset/geometry checks meaningful; do not weaken assertions to obtain a pass.
- Run pnpm build once after coherent code changes; this risk justifies TypeScript and Vite compilation. Repeat only if a new change/failure warrants it. No Rust compilation unless native source changes become required and scope is revisited.
- Use existing QA entry only for isolated frame/appearance checks with neutral slots or real empty state, and clearly label any pre-existing fixture screenshot. No claim of real AI based on this entry.
- Use real Tauri runtime for AC3–AC5: open → type/quick prompt → settings → return → close/Escape → reopen, resizing, keyboard focus and reduced motion; inspect compact/expanded/standalone and real error layout where observed. Check actual visible behavior, not only screenshots or listeners.
- Existing configured real AI: validate one minimal real stream and visible result; do not send private content or alter configuration. Saving settings should only preserve actual existing values; do not invent credentials or endpoints. If not safely verifiable, record the exact unverified item and keep the acceptance box open.
- Dispatch trellis-check after implementation with task context and bounded scope; worker may repair identified issues and report evidence levels. Main agent coordinates final runtime evidence.

## Finish and Rollback

- Record pass/fail/unverified against each AC, including real-model invocation and whether any existing fixture was viewed.
- Revert only task-owned changes from recorded backup if regressions cannot be safely corrected, preserving concurrent edits.
- No Git metadata exists here: report local edits and verification accurately; do not claim commit/push or create a repository.
- Archive this task only when required implementation/verification is complete; report remaining environmental blockers honestly.
