# Research: native send-to-expanded stall

- Query: Narrow the newly observed native disappearance after accepted send; inspect paint waits and AppKit resizing without treating hypotheses as confirmed causes.
- Scope: internal source/dependency inspection, plus explicitly parent-reported runtime symptoms
- Date: 2026-09-08

## Findings

### Runtime evidence supplied by the main session

Latest packaged closed pet opens compact with AX activation. A real no-tool message submitted with Enter shows generating/disabled, then AX exposes only cat/live status. Visible screenshot is232px-wide cat content with the open-state bottom crop; state lasts beyond30s. Another pet activation changes its happy state but does not restore the panel. This researcher has not independently captured native state.

### Proven wait/guard defect

`src/App.tsx:16-22` waits for two `requestAnimationFrame` callbacks then a0ms timer. There is no timeout, cancellation, visibility fallback or error path. The closed→open premount at245-247 has a separate unbounded rAF wait.

`changePetChatMode` sets `modeTransitionRef=true` and `modeTransitioning=true` before these awaits (`204-215`). It releases the guard only after awaits settle or reject in `finally` (`265-278`). If rAF is suspended, the Promise neither resolves nor rejects; `finally` never executes. Subsequent cat activations return early due to the guard (`203-204`), while `onPetInteract` still changes happy state. This source mechanism **can exactly produce a permanent hidden/inert frame with a responsive cat**. It proves a liveness defect, not that the observed run stopped at this particular await.

The native invoke itself has no deadline either. A pending invoke before the paint wait would present a similar interaction symptom. Need command-return versus paint-return evidence to distinguish them.

### Important symptom cross-check

Current `src/styles.css:1098-1099` crops the original disk only while `.chat-panel.is-integrated:not(.is-hidden)` exists. `ChatBubbleFrame.tsx:119` adds is-hidden when `visible=false`; App passes `visible={!modeTransitioning}`.

Therefore a **freshly painted open-cropped cat** argues against modeTransitioning=true. It suggests either the frame is logically visible but outside an unexpectedly small native/client viewport, or the screenshot is showing a stale backing layer. AX missing controls does not itself establish is-hidden/inert. A232px-wide content crop is not necessarily a232px-wide NSWindow: measure native outerSize and browser innerWidth separately.

### Native resize findings

`src-tauri/src/lib.rs:281-363` computes target closed232×380.9, compact713×401 or expanded940×760. It derives one bottom-right physical anchor, converts via scale_factor, calls raw AppKit `setFrame:display:false`, then `show_and_make_key` and returns Ok. It does not read back NSWindow frame/content/WKWebView size to confirm the requested geometry was applied.

Locked `tauri-nspanel` revision is c9ec213 (`Cargo.lock:3555-3557`). Its `show_and_make_key` directly calls makeFirstResponder(contentView), orderFrontRegardless and makeKeyWindow (`.../c9ec213/src/panel.rs:409-418`). `as_panel` is a direct native panel reference. These helpers do not add thread dispatch.

The command is synchronous `#[tauri::command] fn`, with no explicit `run_on_main_thread`. Tauri macro2.6.3 blocking wrapper calls the handler inline on its IPC invocation context (`.../tauri-macros-2.6.3/src/command/wrapper.rs:398-434`), while protocol dispatch calls webview.on_message. This establishes **lack of an explicit main-thread guarantee in this command**, but not an observed off-main-thread execution. Do not declare an AppKit thread violation as the confirmed root cause without logging/asserting native `NSThread.isMainThread` at command entry.

Tao's normal set_inner_size delegates to a thread-aware helper (`tao-0.35.3/.../macos/window.rs:755-759`, `util/async.rs:24-44,87`); the custom raw setFrame bypasses that wrapper intentionally for atomic anchor+size update. Preserve the atomic update when adding a safe main-thread boundary.

### Smallest safe repair / diagnostic order

1. First obtain four non-sensitive facts for the failing transition: from/to mode plus transition sequence, native invoke started/returned, native outerSize/scale or AppKit frame/contentSize after setFrame, and JS innerWidth/innerHeight plus paint-wait completion. Never log message/credential bodies. These isolate native pending, incorrect native size, stale webview size and suspended paint.
2. Fix the proven unbounded paint dependency: one shared bounded paint helper covering both premount and post-resize phases. Keep the fast double-rAF path; use a short fallback timer (for example300-500ms) and cancel remaining callbacks/timer when either path finishes. This is a readiness fallback, not proof that a frame painted.
3. Before declaring the mode transition successful, validate actual viewport/native geometry against target. A timeout must not mark a232px viewport as expanded. If geometry is wrong, expose a recoverable transition error and release the guard; preserve/reconcile the prior mode. Merely reverting React mode after native size changed is insufficient for geometry rollback.
4. If native thread evidence is negative, or as a narrowly justified hardening change, perform native measure→setFrame→show→readback on `run_on_main_thread`, returning completion via an async response. Do not queue onto the main thread and synchronously wait from that same thread: that would introduce a real deadlock.
5. A deadline around invoke must handle late completion explicitly (sequence/transition token and reconciliation), since Promise.race does not cancel native work. Do not stack uncontrolled retries against pending resize operations.

### What is not established

- No actual native command trace, NSWindow frame readback, WKWebView viewport value, JS hidden/inert class or RAF counter was obtained in this subtask.
- Off-main AppKit execution, setFrame refusing target dimensions, and RAF suspension are candidate mechanisms with different required fixes. Only the unbounded-await liveness hole is source-proven.
- Do not rewrite pointer/AX click handling: initial AX open now works, and happy-state response confirms the later activation reaches the pet interaction path.

## Caveats / Not Found

Read-only source/dependency research only. No code edits, builds, native restarts, extra real messages, timers injected into production, or synthetic events were performed. Use main-session runtime evidence to select the minimal actual repair.
