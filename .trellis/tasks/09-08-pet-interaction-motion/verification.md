# Verification — implementation packaged, native acceptance open

## Real native evidence
Before packaging, restarted the previous app. Compact opened with real connected state. Clicking settings resized the screenshot to 940×760 but AX and screenshot remained cat-only across subsequent reads. See research/native-baseline.md. No business data was changed.

Rebuilt debug app successfully with `pnpm tauri build --debug --bundles app --config '{"build":{"beforeBuildCommand":null}}'`. Rust build 9.51s, bundled 橘伴.app. Reopened new bundle and clicked pet; next AX read returned: “The Mac is locked and automatic unlock could not unlock it.” Requested manual unlock. New native settings transition, visual frame continuity, 10 native cycles, native focus and scroll recovery have NOT passed acceptance yet. Do not report complete native verification.

## Browser runtime (actual empty state, no native bridge)
Real ChatPanel QA route, status null, no messages/tools and no backend mutations. A loop of 10 settings/back cycles with draft assertions passed. Returned result: cycles=10, draftPreserved=true, animation=none, bodyAnimations=0, compact width=475 under reduced-motion. With normal motion, settings body animation duration=180ms was observed. QA host keeps animateEntrance enabled; its shell animation does not establish App's one-time entrance behavior. Browser cannot prove native resize or frame-rate smoothness.

## Static/unit verification
Independent checker passed `pnpm build`, verify-pet-motion, verify-chat-interaction, verify-component-compact, verify-closed-reference, verify-pet-live-status and diff check. No lint script. Latest JS index-4RQcVeG3.js. Focused actual-function tests cover stalled RAF cleanup, serial queued modes, failure/retry, same-flush page/layout commit and close invalidation. No source image changes.

## Remaining limitations
Native IPC has no cancellation contract: if invoke never returns, its single-flight lock remains. A timer race must not release it and allow concurrent native frame writes. RAF wait is bounded at 120ms, but this is a paint opportunity, not proof of AppKit presentation. Original observed stall is consistent with RAF wait; exact promise-stage attribution was not instrumented.

## Status
Implementation and package ready; native visual acceptance pending manual unlock. Keep task in_progress, do not archive.


## Follow-up after user rejected initial-open experience
See research/initial-open-followup.md for current correction and evidence. Previous implementation did not satisfy native first-open acceptance. Latest debug package index-DZkRX6TI.js restarted. System reducedMotion=1 was read; now reduced mode retains opacity-only entry. Browser final normal/reduced intermediate frames inspected; original image and geometry checks, viewport-recovery/interaction tests pass. Native screen recording unavailable because no matching onscreen app window; user asked to bring desktop visible. Do not archive or claim native flicker eliminated.
