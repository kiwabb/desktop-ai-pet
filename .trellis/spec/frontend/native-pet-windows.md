# Native pet window lifecycle

> Current production geometry and companion interactions are defined in [Companion experience](./companion-experience.md), approved 2026-09-26. Its 232×340 scaled main, independent 720×680 chat, side placement and reveal-before-measure contract supersede the old 232×380.9 / 940×760 attached-shell and hidden-paint requirements below. Preserve the remaining lifecycle, focus, drag and native-evidence safeguards; attached-frame details remain compatibility history.

## 1. Scope and trigger
Chat open/close/resize must not resize the cat's transparent backing. Real screen recordings showed whole-cat dropout even with display policy and focus variations. Main is a fixed232×380.9 cat window; chat hosts the integrated shell behind it.

## 2. Signatures
- `set_pet_chat_mode(app, mode: String) -> Result<PanelViewport, String>` returns `{width: number, height: number}` in CSS pixels. Closed hides chat. Reopening fits the preferred940×760 backing to the selected monitor work area, then keeps main and chat bottom-right anchors equal. Chat resizes while hidden or in one final drag-end refit when the target display is smaller; main never resizes.
- `show_chat_window(app) -> Result<(), String>`: show/focus prepared chat.
- Shared pointer-captured drag: capture both physical origins, serialize/coalesce paired position updates, then release the matching drag session.
- `pet-panel:request {id, mode}` → chat; `pet-panel:reply {id, mode?, error?}` → main; `pet-panel:committed mode` → main.

## 3. Contracts
Main remains232×380.9. Chat prefers940×760 and fits the work area minus12px per edge while hidden; every open mode shares that backing. If the user drags it onto a smaller display, the matching `end_pet_group_drag` may refit it once after the serialized final pointer move. No mode change or pointer-move frame resizes either window. Compact uses `min(713px,100%) × min(401px,100%)`; expanded fills the backing. Both share main's bottom-right screen anchor. `desktop-shell.css` owns host geometry. Native dock config preserves the fixed artwork scale when the reading column narrows; standalone frames retain fit-to-size scaling. Chat is below main and explicitly hidden at startup. Child linkage alone failed user drag acceptance; paired movement must be implemented and validated explicitly. Only one PetStage exists. Chat panel stays mounted while hidden; page and draft belong to chat. Main crop follows confirmed visibility, never cross-window DOM selectors. Main installs reply listener before sending request; cleanup includes listener and5s request timeout. That timeout cancels waiting, not underlying native IPC. Main pending count suppresses duplicate reminder opens.

## 4. Errors and recovery
Invalid mode rejects. Hidden initial chat must observe the actual returned CSS viewport and publish actual interactive bounds before show; unready timeout hides chat and restores closed UI. Native failure must be surfaced without marking request successful. Stale page callbacks are invalidated by close/new page intentions. Keep native writes serialized. Acknowledgement means command/UI completion, not a presented-frame guarantee.

An already-open mode request must still reactivate the existing chat through `show_chat_window` before reporting success. Reuse the serialized transition/error path; do not resize, hide/reopen, or replace the current page/draft just to acquire focus. Same-mode page commits stay committed if reactivation fails, while the caller receives a rejection and visible error. A same-mode `closed` request must not show the window. Verify an in-flight reactivation followed by close retains command order.

After successful same-mode native activation, request one committed control-focus restoration. Reuse the active control only when it belongs to the visible panel, has layout, is enabled and has no hidden/inert ancestor; otherwise use the existing current-page default. Preserve its draft, caret and selection. Ordinary renders must not repeat the request; failed activation and closed mode must not request focus. This DOM contract does not replace native input-delivery acceptance.

On macOS, NSPanel's show/key operation focuses the content container; it does not guarantee WKWebView is first responder. After showing chat and restoring cat ordering, target the actual `tauri::Webview` via `Webview::set_focus`, not `WebviewWindow::set_focus`. Preserve the existing application-activation policy. Framework success confirms dispatch, not the native responder result: direct typing remains a separate runtime check.

## 5. Cases
Good: main remains stationary throughout10 compact/settings/back cycles, only the chat DOM layout changes underneath. Base: closed mode has only native main visible and no transparent chat interception. Bad: resizing main, duplicating cat in chat, relying on CSS to mask native frame loss, or hiding only DOM while giant native chat remains onscreen.

## 6. Required verification
Focused tests for window target, request/ack cleanup, queued failure, viewport recovery and same-flush page updates. Actual native checks for frame invariance, source-frame cat continuity, layering, focus, draft, drag and reset; state clearly which display/DPI configuration ran. A successful build/AX tree/browser preview is not native visual evidence. Rank original video frames, not low-FPS resamples that miss16ms gaps.

### Passive close-origin diagnostics
When a captured route enters `closed` without a known initiating action, use the existing opt-in motion diagnostics to identify the accepted UI path. `ChatPanel.closePanel(source: 'escape' | 'button')` emits `markMotionDiagnostic('route:chat-close-intent', { source, page })`, where `page` is only `chat`, `settings`, or `todos`; the public `onClose` contract stays unchanged. Emit after the saving guard and before the existing close work. Composition, already-handled/hidden Escape, saving rejection, and Escape that only returns from a secondary page must not emit a close intent. The button passes the literal `button`, never its React event object.

The existing helper remains disabled in normal production mode. Never include input text, arbitrary key values, DOM contents, model messages, URLs or credentials. For a passive observation, use the existing `mode:normal`, `action:none` request and perform actual UI actions through the approved UI tool. Check matching process/request IDs and the route limit before interpreting the output. An `escape`/`button` label establishes the handler path, not whether a human or automation initiated it; a close-intent marker does not by itself prove native visibility. Verify the existing chat contract and inspect the diagnostic gate; do not introduce test fixtures or a new control endpoint for this metadata.

## 7. Wrong versus correct
Wrong: resize the combined cat+chat NSPanel, wait two RAF callbacks, declare flicker removed.
Correct: keep the cat backing fixed, prepare/reveal the separate integrated chat surface, then inspect actual onscreen frame sequences across repeated operations.

## Follow-up acceptance constraint
Visible native chat resizing exposed stale settings pixels across the cat. Do not solve this by hiding the whole shell: R1/A1 require no cat-only gap. Preserve panel continuity and explicitly validate transparent-area hit testing if using a stable larger backing. Cat/header dragging must move both windows, handle cancel/release, serialize moves and preserve click versus drag intent. A declared native child relationship is not proof of working paired movement.

## Persistent stacking
macOS main uses native level5 and chat level4. A one-time orderFront after showing chat does not preserve order after subsequent focus. Verify actual native window levels plus real composed screen after focusing input, settings and todos; a per-window screenshot does not include the other window and cannot prove cat/dock stacking.

## Frame/background atomicity
A stable native backing is insufficient if CSS frame dimensions update before SVG background dimensions. Commit actual frame size, SVG size and dock compensation in the same paint; do not rely on a later ResizeObserver state update. During todo expansion, keep background covering the full frame and loading/content visible. A motion preference is not an explanation for missing background pixels. Verify the exact user-reported route and lower frame area.

## Continuous frame animation
`useFrameMorph` commits destination HTML layout once and runs a compositor-only crossfade dissolve: a static ghost clone of the FROM shell (filters detached) fades out and contracts toward the dock anchor while the already-committed TO shell and surface content fade in. Only WAAPI `transform`/`opacity` animate — WKWebView GPU-composites exactly these two properties; SMIL path interpolation, clip-path animation and per-frame geometry writes were removed because they forced CPU paint per frame. Reduced motion keeps a short opacity-only crossfade without transform.

Morph durations read the root CSS motion tokens: preferred240ms incoming /160ms outgoing, with140ms opacity-only reduced motion. `getFrameVisualBounds(root)` returns the committed root rect; the real frame owns final geometry for the whole dissolve, so native hit bounds are published at transition start (from) and end (to) only, never per frame. Cancelling/closing removes the ghost and its WAAPI animations and restores the settled shell. Rapid toggling cancels the previous transition before snapshotting the new FROM state.

Verify compact→Todo/settings→back, partial reversal, close, reduced motion, default and customized dock values. Inspect intermediate and final frames for full background, single outline, unclipped controls and stationary dock; do not accept CPU metrics or a build as a substitute for native presentation.

## Work-area fitting and cross-display coordinates

### Scope and signatures
`window_geometry::fit_companion(pet: Rect, work: Rect) -> CompanionLayout` and `constrain(rect, work) -> Rect` are pure geometry. They receive one coordinate space and preserve pet dimensions while deriving a shared bottom-right anchor. `PanelViewport` is native layout data; this addition does not change agent/model APIs. Frontend `waitForPanelViewport({width,height})` uses the command result instead of a duplicated dimension constant.

### Contracts
On macOS `window_rect`, `place_window` and `display_for` use global AppKit points. The downward axis is `-origin.y-height`; do not divide global monitor origins by each display's backing scale. DOM screen deltas then apply directly, including displays with negative origins. On Windows/Linux origins, work areas and captured window rectangles all remain global physical coordinates. Apply the captured window scale to DOM deltas once, and the target monitor scale to preferred dimensions/margins only. Never divide each monitor origin by its own scale. `panel_viewport` converts the final chat dimensions to CSS pixels only at the frontend boundary. Available work area excludes system menu/Dock regions.

`move_pet_group_on_main` constrains one group delta and applies it to both captured origins. It never resizes either visible backing, and pointer capture release remains serialized after the final movement. Restore constrains saved cat positions to a currently available work area; removed monitors fall back to the default position. Hit bounds clamp against the measured current viewport rather than940×760 constants.

### Error and acceptance matrix
- Invalid mode rejects; nonfinite pointer deltas reject.
- No detected display rejects with a user-facing native error; no pretend successful layout.
- A smaller initial display fits before reveal; rendering readiness timeout hides the prepared chat and restores the prior React state.
- Dragging an open backing onto a smaller display triggers at most one refit after the matching drag session finishes. The native transaction clears obsolete hit bounds, fits chat, reanchors the unchanged cat and emits `pet-panel:viewport-changed {width,height}`. Frontend native resize cancels the old shell morph, synchronously commits measured SVG dimensions, and publishes fresh hit bounds. App also waits for the emitted viewport then republishes actual bounds. A readiness failure shows recovery text; native presentation remains a separate QA requirement.
- Work areas smaller than the fixed cat itself cannot display the full cat; no automatic asset scaling is introduced.

### Required verification
`cargo test window_geometry --lib` verifies edges at1920×1040,2560×1400,1280×680,800×560,640×460; scales1/1.25/1.5/2; negative origins; fixed pet dimensions; equal bottom-right anchors; reopen idempotence; adjacent1x/2x physical monitor origins; drag-end refit idempotence on an800×560 display. `pet-shell-geometry.test.ts` verifies fixed platform scale across narrow native reading columns and fitted standalone fallback. The viewport handler verifier covers ready, resize and timeout cleanup using returned dimensions. It also executes the actual `resizeViewport` handler and asserts morph cancellation before synchronous geometry commit before hit-bound publication; source guard confirms `move_pet_group_on_main` has no resize call.

Native acceptance must separately inspect mixed-DPI screen transitions, keyboard focus, actual readable controls, cat/platform continuity and unoccluded work-area placement. Pure logical scale tests are not hardware evidence.
