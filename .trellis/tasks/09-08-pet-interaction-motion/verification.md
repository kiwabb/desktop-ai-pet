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


## Current acceptance — 2026-09-08 visible desktop
The desktop visibility blocker is resolved. Actual source-frame captures disproved both single-window native flag A/B fixes. Fixed-main dual-window trial prevents observed whole-cat dropouts, but latest capture still shows stale chat backing during settings resize, and user reports failed paired/header dragging. See research/native-cat-flash.md. Current status: **native acceptance failed; continue implementation**, not pending unlock. No model message sent; unsent verification draft cleared.


## Fixed backing correction packaged
Final macOS candidate keeps chat940×760 and main232×380.9, with DOM-only compact/settings changes, real DOM hit bounds and native16ms cursor policy. Shared pointer capture explicitly moves both windows on one native main-thread operation. Focused motion/drag final-release and serial/cancel checks, geometry/chat regressions, frontend build and native package passed. Candidate JS index-xGGAhJG0.js, CSS index-CwZZLpeN.css, native executable SHA2562565c6f09e53e424dfedba95a7feee6a00e8a65ed7de983c6be74fc73561013b.

Two overlapping instances were discovered: project debug bundle PID12341 and Desktop installed bundle PID17455. Both exited and only final project bundle restarted as PID23408. Native inventory returned no visible matching window, AX only an empty window. User asked to bring pet desktop visible and retry dragging. Do not assign this lack of visible evidence to a proved renderer defect or claim the final candidate passed native acceptance. Still pending:10 cycles, drag both handles, click-through, final onscreen source-frame recording.


## Persistent layer candidate
Native binary SHA25674fa28d7588ef0efa62f88ab62411d7b7871dc17664f52f892eeea43e98c99ce restarted as sole PID76106. CoreGraphics actual window inventory confirms main31691 level5, chat31692 level4. UI clicking during recording did not establish chat visibility; main then moved from1294,574 to1337,565 and chat from586,195 to629,186, and both became non-onscreen. Main-thread sample shows ordinary NSApplication event loop, not a deadlock. Concurrent user movement/desktop visibility prevents attributing that attempted open to a code failure. Paired displacement observed, but title dragging and composed-screen occlusion need user/runtime confirmation. No final visual pass claimed.


## User acceptance and next visual refinement
User confirms previous correction with “可以了”, then reports compact-to-expanded transition looks poor. Preserve accepted fixed backing, persistent native layering and paired movement. This is acceptance of the prior fix, not proof of unrecorded cross-DPI or all flows. Next scope is frontend expansion continuity and staged content motion; do not reopen native architecture. System reduced-motion preference was observed enabled; requested user choice for desktop-pet motion while keeping OS setting unchanged.


## Expansion refinement browser verification
Real ChatPanel preview with null/unconfigured service state and no submitted data, using the same fixed940×760 host and compact713×401 scene as native. Original morph failed: DOM RAF samples showed dock drifting over100px because inline root size, SVG ResizeObserver size and dock React state committed separately. Atomic geometry correction retested51 RAF samples: frame475×278→676×665 with continuous intermediate sizes, root opacity1 throughout; dock X spread0.015625px, Y spread0.01831px, dimensions drift<0.001px. Browser layout evidence only, not native video/FPS proof.

Reverse at about95ms retained exact622.859375×562.6875 first reverse frame, ended475×278 with temporary width cleared; dock Y spread0.01593px. Reduced-motion browser branch used140ms body opacity only, transform none and opaque frame. User then requested turning system reduced motion off; initial defaults write was denied, subsequent read after System Settings interaction confirmed reduceMotion=0. No app-level override added.

Independent review caught hit-bounds latest-success falsely throwing an earlier intermediate error and reverting mode after page commit; implementation correction required before packaging.


## Clarified defect: todo expansion briefly blank below
User explicitly clarified this is a lower-area blank during todo expansion, not an OS motion preference complaint. Previous frame implementation changed CSS variant immediately but SVG dimensions depended on a later ResizeObserver/React commit. Atomic frame/SVG geometry updates address this ordering risk. Removed newly proposed opacity0 and80ms delay; destination content/loading remains at least0.8 opacity. Actual existing preview todo action captured48 RAF samples: shell physical height always covered frame height; frame opacity1 throughout; body minimum0.8; dock displacement<0.02px. Preview remains unconfigured and does not claim real todo service data.

Final frontend index-BTfb3uUG.js, focused latest-bounds success/failure and committed-page consistency checks passed and independently reviewed. Native bundle packaging initiated by root; actual native todo capture pending.

Final native debug app build succeeded in46.78s. CUA then explicitly returned: Mac is locked and automatic unlock could not unlock it. Old PID76106 exited with TERM and newly packaged project app opened. This restart is not visual acceptance. Await manual unlock for real todo expansion recording; keep task in progress, no completion/archive claim.


## Follow-up: improvement but visible stutter
User reports latest package is better but still choppy. Do not reopen accepted native architecture or attribute this to OS preference. Current frame loop performs inline size writes, synchronous getBoundingClientRect and React flushSync with SVG regeneration each RAF; App additionally observes geometry and sends hit-bounds IPC. Browser-only baseline using existing unconfigured QA,6 todo open/back cycles: LayoutCount764, RecalcStyleCount790, LayoutDuration0.085963s, RecalcStyleDuration0.151886s, ScriptDuration1.025705s, TaskDuration2.314119s.474 RAF samples,p95=9.3ms,max707.8ms,2 intervals>33ms. Browser/environment long stalls are not uniquely attributed to app and are not macOS WKWebView frame-rate evidence. Compare candidate using same script/route, retain background coverage and dock continuity checks.


Stutter candidate (same browser QA6-cycle script): LayoutCount450 vs764, RecalcStyleCount474 vs790, ScriptDuration0.297699s vs1.025705s, TaskDuration0.811843s vs2.314119s;537 RAF samples,p95=9.3ms,max16.7ms,no interval>33ms in this run. This is a browser comparison, not a guaranteed native FPS improvement. Animation duration remains280ms and shadow appearance retained.

Candidate todo geometry51-frame sample: background covers frame throughout, root opacity1, body minimum0.8; dock X spread0.015625px,Y0.00268555px, dimensions<0.001px. Reverse preserved exact619.328125×555.890625 at first reverse frame, returned475×278 with width cleared; reduced branch still140ms opacity0.8→1 with no transform.

Actual old native app was visible during this turn: recorded `/tmp/pet-stutter-before.mov` with two real todo/back cycles, showing real0 pending/2 completed state. No checkboxes, reminders, send or settings actions mutated data. Candidate native comparison pending.
