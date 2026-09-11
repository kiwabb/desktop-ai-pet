# Native pet window lifecycle

## 1. Scope and trigger
Chat open/close/resize must not resize the cat's transparent backing. Real screen recordings showed whole-cat dropout even with display policy and focus variations. Main is a fixed232×380.9 cat window; chat hosts the integrated shell behind it.

## 2. Signatures
- `set_pet_chat_mode(app, mode: String) -> Result<(), String>`: closed hides chat; compact/expanded align the fixed940×760 chat backing when reopening. Does not resize main or a visible chat surface.
- `show_chat_window(app) -> Result<(), String>`: show/focus prepared chat.
- Shared pointer-captured drag: capture both physical origins, serialize/coalesce paired position updates, then release the matching drag session.
- `pet-panel:request {id, mode}` → chat; `pet-panel:reply {id, mode?, error?}` → main; `pet-panel:committed mode` → main.

## 3. Contracts
Main remains232×380.9. The native chat backing remains940×760; its713×401 compact or940×760 expanded CSS scene shares main's bottom-right screen anchor. Chat is below main and explicitly hidden at startup. Child linkage alone failed user drag acceptance; paired movement must be implemented and validated explicitly. Only one PetStage exists. Chat panel stays mounted while hidden; page and draft belong to chat. Main crop follows confirmed visibility, never cross-window DOM selectors. Main installs reply listener before sending request; cleanup includes listener and5s request timeout. That timeout cancels waiting, not underlying native IPC. Main pending count suppresses duplicate reminder opens.

## 4. Errors and recovery
Invalid mode rejects. Hidden initial chat must observe its fixed CSS viewport and publish actual interactive bounds before show; unready timeout hides chat and restores closed UI. Native failure must be surfaced without marking request successful. Stale page callbacks are invalidated by close/new page intentions. Keep native writes serialized. Acknowledgement means command/UI completion, not a presented-frame guarantee.

## 5. Cases
Good: main remains stationary throughout10 compact/settings/back cycles, only the chat DOM layout changes underneath. Base: closed mode has only native main visible and no transparent chat interception. Bad: resizing main, duplicating cat in chat, relying on CSS to mask native frame loss, or hiding only DOM while giant native chat remains onscreen.

## 6. Required verification
Focused tests for window target, request/ack cleanup, queued failure, viewport recovery and same-flush page updates. Actual native checks for frame invariance, source-frame cat continuity, layering, focus, draft, drag and reset; state clearly which display/DPI configuration ran. A successful build/AX tree/browser preview is not native visual evidence. Rank original video frames, not low-FPS resamples that miss16ms gaps.

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

`getFrameVisualBounds(root)` returns the committed root rect; the real frame owns final geometry for the whole dissolve, so native hit bounds are published at transition start (from) and end (to) only, never per frame. Cancelling/closing removes the ghost and its WAAPI animations and restores the settled shell. Rapid toggling cancels the previous transition before snapshotting the new FROM state.

Verify compact→Todo/settings→back, partial reversal, close, reduced motion, default and customized dock values. Inspect intermediate and final frames for full background, single outline, unclipped controls and stationary dock; do not accept CPU metrics or a build as a substitute for native presentation.
