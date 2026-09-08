# Research: native activation and truthful pet status

- Query: Find source-proven activation defects without equating CUA failure with a product bug; propose a non-raster-edit live status replacement preserving cat pixels.
- Scope: internal, read-only source and approved PNG inspection
- Date: 2026-09-08

## Findings

### 1. Native activation event chain

`src/components/PetStage.tsx:96-140,171-204` implements:

- Primary pointerdown records the pointer and window position, then captures that pointer.
- Pointermove under5 CSS screen-coordinate units does not mark dragging; crossing that threshold marks `moved=true` and moves the Tauri window.
- Pointerup clears drag/capture. If a recorded drag exists and did not move, it calls `onPetInteract()` then `onToggleChat()`.
- The later pointer-generated click with `detail>0` is intentionally skipped. A click-only accessibility action with `detail===0` calls the same callbacks.
- Enter/Space keydown prevents the default and calls the same callbacks. This is a div with role=button, not a native button that would automatically emit an additional keyboard click by default.

`src/App.tsx:281-288,358-367,440-450` passes the callback to `openChatWindow()`, which always asks for **compact**, rather than toggling closed/open. The pet interaction callback only briefly changes petState. `changePetChatMode` guards concurrent transitions and already-active modes (`App.tsx:202-204`); its `finally` releases the guard and rolls provisional state back on failure (`264-277`).

**No source-proven ordinary-click or AX-zero-detail activation defect was found.** The current chain does not inherently double-toggle back to closed. The parent section has `pointer-events:none`, but the child hitbox explicitly restores `pointer-events:auto` for closed/compact/expanded/resizing (`src/styles.css:114-119,1022-1062`). This is valid hit-testing behavior, not evidence that the cat cannot be clicked.

CUA could generate a click-only event with nonzero detail; current code would ignore that particular sequence. Whether the native tool actually does so is **unknown**. Do not remove the drag safeguard or replace the interaction chain based on that unobserved assumption. Read-only temporary event tracing in the actual WKWebView, or a manual primary click versus AX press comparison, is the narrow next verification.

### Confirmed defensive defect, not an explanation of CUA failure

`handlePointerUp` does not check `event.pointerId` against the recorded drag pointer (line130). An unrelated pointerup can clear the tracked primary drag and trigger activation if it was stationary. `onPointerCancel` likewise clears any tracked drag without matching its pointer. This is deterministically possible for multi-pointer sequences, but does not explain a normal single mouse click failing.

Minimal fix if this is in scope: ignore pointerup/cancel whose pointerId differs from `dragRef.current?.pointerId`; complete/release only the captured pointer. Keep the5-unit movement threshold and detail-zero accessibility fallback. Do not claim this fixes native automation until its event trace reproduces that case.

Other narrow observations:

- The drag path adds `event.screenX/Y` deltas directly to a Tauri `PhysicalPosition` (`PetStage.tsx:112-126`). Screen-coordinate deltas are browser CSS units while physical positions are device pixels; check actual WKWebView scale before changing this high-DPI drag path. It is a drag-distance issue, not an explanation for stationary activation.
- The JSX callback discards the `openChatWindow()` promise (`App.tsx:448`). A native resize rejection is rolled back, but no user-facing error is added by this callback. If a real rejection is observed, propagate that exact failure; do not invent a generic click problem.
- Held Enter can call interaction repeatedly because no repeat guard exists, but compact mode is idempotent. No open→close flip follows from those repeats.

### 2. Live status without changing the cat raster

The approved PNG is `public/reference/desktop-pet-closed-reference.png`, intrinsic544×893. Current CSS image/stage dimensions are232×380.9. Horizontal scale232/544=.4264706; vertical380.9/893=.4265398. `App.tsx:443` selects `reference-closed`; the existing `.pet-status` HTML is only mounted for `animated` (`PetStage.tsx:159-170`) and therefore cannot currently correct the baked-in online text.

The PNG's upper decorative bubble occupies roughly source x188-484,y49-182; the cat's left ear starts around source y147. A whole horizontal crop below the old bubble (y182-185) would cut cat ears. Do not do it.

#### Recommended minimal safe replacement: retain bubble outline, replace interior

Retain the original PNG and its decorative bubble border/tail/rays, but remove only the interior text/green-dot area through a runtime SVG/CSS mask. Insert a separately rendered real-status interior in that exact location. This avoids tracing the cat or editing/re-encoding the PNG.

Suggested initial interior cut-out, all **above the cat's first visible row**:

```text
source rect: x207, y69, width265, height76 (bottom145)
CSS rect:    left88.28, top29.43, width113.01, height32.42
```

This rectangle covers the baked title/subtitle and colored indicator while leaving the bubble outline and all cat pixels below source145 untouched. Bounds are based on visual inspection; validate that all original text/green-dot pixels disappear at native1×/2× before finalizing. Do not widen the cut downward into the ear area merely to fit a longer live label.

Implementation shape:

1. Keep `<img src=...>` and file hash unchanged. Wrap the image in a new local mask owner or use an SVG mask on a visual wrapper. Mask is white over the whole image and black only for the status interior rectangle. Use per-instance SVG IDs.
2. Mount a `.pet-live-status` sibling in `PetStage` for reference mode, absolute at the above CSS rect, opaque warm-cream fill matching the original bubble interior, no second outline/drop shadow. A tiny boundary color adjustment is permitted inside this decorative region; no overlay should cover the ears/cat.
3. Render an independent dot + two text rows: title about13-14px/16px; concise detail9-10px/12px. Grid `8px minmax(0,1fr)`, gap5px, right padding2-4px. At most1 line per row; a full accessible label can carry longer status detail. A title such as “陪着你” with concise connection detail avoids repeating long header text.
4. Keep pointer-events:none on the status layer so the existing broad hitbox still opens the panel. Do not reuse the global `.pet-status` selector, which currently applies transforms and hides that element in compact (`styles.css:223-242,911-930`). Scope new styles to the reference stage.
5. The existing open-state **bottom disk crop** is a separate `clip-path` on `.closed-reference-art` (`styles.css:1091-1093`). Compose the new status mask on a wrapper/another visual level so it does not overwrite that bottom crop. Closed keeps the original disk; expanded/compact keep the integrated single disk.

If the design later requires a fully new bubble silhouette, use an explicit upper-region contour mask that stays outside cat pixels, then paint the new outline. That is more work and must be visually reviewed. The interior-only approach satisfies truthful status with the smallest change and strongest cat-pixel guarantee.

#### Data contract and state mapping

`PetState` alone cannot express configuration/connection (`src/lib/pet-state.ts`). Pass real `AgentView`-derived status into `PetStage` from App, preferably as a small typed presentation object `{title,detail,tone,accessibleLabel}` computed in a pure helper. Do not set green from petState idle/happy.

Priority: unconfigured→neutral “待配置”; connecting→warm amber “正在连接”; disconnected/error→warm red or muted “连接中断”; connected but model absent→amber “模型待配置”; chat connected but device offline→amber “聊天可用 · 设备离线”; connected/registered/model-ready→green “在线待命”. Thinking/talking can change title/detail only after connection facts permit it. Use complete `connectionLabel(status)` for accessible detail if the visible status is shortened.

Do not expose endpoint credentials, invent uptime, replace null status with success, or make the static raster's decoration an online assertion. A live update can use one polite status region; avoid announcing the decorative title repeatedly on unrelated AgentView revision changes.

#### Smallest file boundary

- `src/components/PetStage.tsx`: optional live-status presentation prop and reference-only mask/live layer; isolated pointerId fix only if parent chooses it.
- `src/styles.css` or a tightly scoped PetStage CSS file: interior positioning/typography/tone; mask composition; maintain232×380.9 footprint.
- `src/App.tsx`: derive/pass the actual state presentation; no native-size change.
- Optional small `src/lib/pet-status.ts`: typed pure mapping if sharing/testing warrants it.
- Update approved-image verification expectations narrowly: PNG hash must stay identical, and cat pixels/position plus existing lower crop/paw must remain unchanged. Full reference screenshot equality necessarily differs **only** inside the explicitly allowed status decoration region.

### Verification contract for implementation

- Compare source asset hash before/after; source file never rewritten.
- Compare screenshot pixels outside status-decoration region at the same geometry; especially both ears, fur, cushion and corner paw remain untouched.
- Confirm no residual old text/green dot, no doubled border, and no hard rectangular color seam on light/dark/complex desktop backgrounds.
- Check real null/unconfigured/connecting/disconnected/model-missing/device-offline/ready presentation using real available state, or separately authorized tests without describing them as runtime service proof.
- Native primary click, drag, keyboard Enter/Space and accessibility press are distinct activation cases. Record which event path was observed, rather than treating a tool failure as a product diagnosis.

## Caveats / Not Found

- Read-only research only: no product/image edits, build, native service restart, synthetic activation, or real backend invocation.
- No concrete normal-click failure was established. The pointerId edge case is proven by source but is not a verified cause of the current native automation symptom.
- Status cut-out coordinates are a conservative visual starting rectangle; implementation must verify old glyph coverage. The chosen bottom145 is deliberately above the cat's earliest visible source pixels.

## Implementation outcome (2026-09-08)

Pixel sampling narrowed the safe interior to source x217/y74/242x70. Independent SVG cut-out plus opaque fill exposed an L-shaped antialias seam in actual Chromium screenshots. Final implementation retains the full original image and paints an opaque scoped status interior directly above it; no transparent mask remains. A refreshed closed-state screenshot confirmed the black seam is absent. The original open-state bottom disk clip is unchanged. Real AgentView maps to the new presentation object; QA null is explicitly unknown, not connected.
