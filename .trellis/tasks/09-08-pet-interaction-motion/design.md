# Technical design — corrected after onscreen A/B failures

## Evidence and boundary
See research/native-cat-flash.md. Entire cat disappears for source video frames during native size changes; display:true and no-refocus isolated variants both fail repeated native capture. CSS-only fixes and viewport checks do not protect cat presentation.

## Fixed cat surface
The main NSPanel remains232×380.9 for closed, compact and expanded. It renders exactly one original PetStage. Existing chat WebView renders attached/integrated ChatPanel with existing713×401 and940×760 scene coordinate system; no second cat. Align right/bottom native anchors. Keep chat visually below main without stealing composer focus. Manual acceptance rejected reliance on AppKit child linkage: explicitly synchronize both window positions during pointer-captured cat/header dragging, serialize/coalesce moves, and preserve the final release position. Preserve main saved-position/reset semantics.

## State and acknowledgement
Chat owns mounted panel, draft, settings page, reading state and serialized page/mode commits. Main requests changes with IDs and awaits acknowledgement. Main crop and reminder suppression follow confirmed visibility/mode, not request timing. Initial chat opening sizes a hidden chat window, observes its viewport, then shows/focuses and reveals. Hiding keeps component mounted. Visible native chat resize exposed stale backing. A whole-shell fade/hide would violate R1/A1 and is rejected. Next implementation must preserve a continuously visible panel; evaluate a stable chat backing with explicit transparent-area hit testing so unused canvas does not intercept the desktop. Errors and stale replies must not commit a newer intention. Preserve actual agent data subscriptions and existing reminder/accepted-submit behavior.

## Visual contracts
Retain original white cat, corner paw placement/shadow, footprints, configurable tail and shell geometry. Main crop has explicit committed-chat-visible state because cross-window :has cannot apply. Normal entry fades bubble/paw with6px content movement; reduced entry opacity-only160ms. The SVG platform remains stationary. No new design assets or product controls.

## Verification and residual risk
Record actual onscreen cat region during open/close and10 settings/back cycles. Read native window frames to prove main size invariant; inspect keyboard, draft, stacking, native drag/reset and multi-display scope separately. Do not claim native rendering success from browser, AX, build or viewport alone. Temporary raw screen captures remain local temp and must not expose unrelated background. Review handshake timeout and IPC noncancellation explicitly.

## Rollback
Keep the failed A/B experiments uncommitted and replace them with fixed-surface architecture. Separate visual shell changes from window coordination. No business schema, service or credential changes.


## Final correction being implemented
Chat native backing remains940×760 for every open mode; compact uses a713×401 CSS scene anchored bottom-right. Page changes do not resize either visible native backing. Report actual interactive frame bounds to native hit testing; poll mouse location on the main thread only while chat is visible, and ignore mouse events outside content. During pointer capture keep drag delivery active. Hidden chat ignores events. Validate real desktop click-through and report the16ms boundary polling limitation accurately. No whole-shell fade-out for page switching.


## User-requested expansion refinement
The user accepted the native correction, but rejected compact-to-expanded visual quality. Keep native backing/layering/drag stable. Shared frame should interpolate actual old/new geometry on ordinary-motion mode, keep the dock's screen anchor fixed, and stage destination content opacity rather than exposing reflow. Reverse transitions should begin at current visible geometry. Under system reduced-motion, avoid geometry motion and use short content opacity unless the user explicitly requests an application-level exception. Do not change OS preferences. Ensure native click-through bounds track the animated frame and receive final bounds; do not flood IPC with unbounded per-frame requests.


## Revision: continuous composited expansion
User rejected the width/height/SVG-per-frame implementation as visibly stepped even after script cost reduction and corrected first-RAF timing. The earlier geometry interpolation paragraph is superseded for implementation strategy: retain endpoint geometry and hit bounds, but avoid main-thread layout and path updates on each animation frame.

The nine-slice prototype was rejected after intermediate-frame inspection: upper right contour movement and stationary dock could not remain seamless with independent tiles. Final candidate keeps one SVG outline and fixed destination HTML layout. Browser-native SVG animations interpolate normalized path geometry, dock compensation, footprints and scene translation on one SVG timeline. HTML content/actions/paw use unscaled WAAPI translation. This still incurs SVG layout/paint; no GPU-only claim is made. Reverse transitions sample actual current SVG time and numeric path state. Temporary layers must clean up on cancellation, hidden state and finish.

Check real native Todo and settings expansion/reversal, plus browser per-animation layout and source-frame geometry. Browser cost improvement is supporting evidence only; user-visible stepped growth remains a failed acceptance result regardless of successful build.
