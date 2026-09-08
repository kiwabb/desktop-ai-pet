# Initial open follow-up — user-reported regression

User reports clicking pet still flashes, has no motion and feels unfluid. This is an unresolved acceptance failure, not a new unrelated feature.

Live read-only system preference: `defaults read com.apple.universalaccess reduceMotion` returned `1`. Current CSS suppresses all CSS animations under reduced motion. WebView matchMedia has not been instrumented; the system preference directly explains the configured animation suppression path. Do not change the user's OS setting. Reduced mode should use only a brief opacity reveal, with no spatial movement, scale or bounce.

Source defect: initial integrated root bloom applies opacity/transform to the same SVG that owns the replacement platform, while original disk crop switches at reveal. Preserve a stationary platform and animate the bubble region separately. Viewport readiness must use real dimensions rather than claiming double RAF acknowledges AppKit presentation.

Native evidence boundary: CUA can inspect app AX/background screenshot, but Screen Recording helper returns no onscreen matching 橘伴 window. Raised app using AX; no presented-screen recording obtained. Asked user to bring pet desktop visible; waiting. Do not label background screenshots as actual display-frame evidence.


## Implemented correction and verification
Initial integrated root no longer scales/fades the platform. A single SVG paint with a feathered luminance mask fades bubble region; surface/paw share the duration. Browser intermediate-frame review rejected the first hard wipe (controls outside visible shell) and then the hard alpha split; final smooth junction screenshots inspected at 60ms.

Actual browser computed results: normal root transform none, root animation none, surface integrated-content-arrive with ~2px remaining Y offset at 60ms; reduced root/surface transform none, surface integrated-content-dissolve, mask integrated-shell-dissolve. This proves actual browser effects, not native presentation. Screenshots are real empty/unconfigured preview with animation timelines paused for deterministic inspection, not a native recording.

Viewport helper regression covers ready, delayed resize, unready deadline and native closed recovery before React cleanup. Final build index-DZkRX6TI.js; debug app packaged (9.62s compilation) and restarted through CUA. No native protocol changes or OS preference changes. Visual native acceptance still pending currently visible window; task stays in_progress.

CUA native AX after restart + pet click exposed the connected compact chat controls. Closed it via 收起对话 afterward. This confirms opening completion in native accessibility state; it does not establish visible frame continuity.
