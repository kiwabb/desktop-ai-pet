# Companion panel attachment independent check — 2026-09-26

## Scope and evidence

Authority: `../companion-panel-link-2026-09-26.md`. Compare only this continuation against `/var/folders/ys/cjf2rbtd03lg_fclhtmcmgn80000gn/T/companion-link-baseline-wpeedf8p`. The approved cat, restored paw, warm theme, business state/navigation/drafts/reading and native positioning remain binding. This review uses source and isolated checks; the coordinator owns the coherent native package and actual composed UI acceptance. No app, backend/model service, business fixture or native build is launched by the reviewer.

## Native metadata review

The native diff adds `Point`/`pet_render_anchor`, focused tests, serializable `PetAnchor`, and the optional `PanelViewport.pet_anchor` mapped to JSON `petAnchor`. Existing positions, dimensions, visibility, hit policy, drag and placement algorithms are unchanged.

Projection matches the actual frozen renderer: `PetStage` uses the 1207×1303 SVG with `xMidYMax meet`; `.companion-cat-motion` has 4px top/side and 65px bottom insets. After conversion to the existing common logical space, box width/height subtract 8/69, scale is the limiting raster axis, horizontal letterboxing is centered and vertical letterboxing is bottom-aligned. The source nose/mouth point is (530,390). macOS uses common AppKit points/scale 1; other platforms use the existing chat scale boundary. This source contract does not claim real cross-platform or mixed-DPI acceptance.

`panel_viewport` is the common producer used by both command returns and viewport-change notifications. It retains width/height/side and serializes unavailable projection as null. Finite positive geometry is required, empty render boxes and numeric overflow omit the anchor, and valid anchors outside the backing are intentionally retained for the frontend's visibility decision.

Native owner reports six focused `pet_anchor_tests` passed using standalone `rustc --test` (no app build): mirrored placement, 80/100/120% sizes with fixed CSS insets, shared physical scaling/negative origins, top/bottom/narrow clamp invariance, height-limited letterboxing, and invalid geometry. Scoped diff hygiene passed. Independent source review found no native metadata issue.

## Frontend and integrated disposition

**SOURCE-STABLE: no material source blocker found.** No reviewer implementation changes were needed. The coordinator may build this coherent batch; the actual native visual/interaction acceptance remains separate.

- Both native commands and events pass through `parsePanelViewport`. Invalid dimensions reject the payload; missing/invalid anchor metadata preserves compatible dimensions and removes the attachment. Valid off-backing coordinates survive validation. The command response cannot overwrite a viewport event received while that command was in flight.
- Viewport events require the current revision, visibility epoch, non-hidden state and non-closed mode before committing geometry or reporting errors. Cold opening waits against the latest viewport ref, commits that same current viewport before publishing hit bounds, and preserves existing show/readiness/focus ordering. Existing navigation/page intent, pending transitions, settings return, drafts and reading code is unchanged.
- Helper geometry and CSS match: compact dimensions are capped at 420×380 within 12px insets; the face-aligned vertical placement clamps inside the backing; expanded uses the existing 12px body inset. Left/right placement is mirrored. Normal compact/expanded layouts share the same tail target; corner clearance clamps the attachment when the target is near a vertical edge. Overlap, opposite-side and vertically unusable targets omit the tail. Missing anchors retain the previous CSS placement.
- The 32px-high SVG occupies 11px including a 1px body overlap, so only 10px protrudes into the 12px gutter. It is decorative (`aria-hidden`, non-focusable, `pointer-events: none`) and excluded from the frame-only hit bounds. The maximum curve reach stays inside its SVG and backing. Seam quality and perceived aim require the native composed image.
- Position-only events explicitly republish hit bounds after layout. Entrance transforms are bounded by the existing frame cleanup; a frame-class observer republishes the final rectangle after entrance cleanup. Cold opening now activates the 180ms .985-scale entrance after native show; readiness/focus never waits for animation completion. Reduced motion disables frame and tail animation.
- Independent continuation-baseline comparison finds only the intended six existing source files changed: App, desktop shell CSS, frame CSS, viewport types/parser, native geometry and native metadata. The two new attachment helper/test files are scoped additions. All 10 frozen cat/artwork/behavior/paw hashes match. ChatPanel, ChatComposer, reading/navigation, utility pages, theme tokens, frame TSX and existing native placement algorithms remain unchanged.

## Findings (fixed)

None by the reviewer. During owner implementation, the cold-opening viewport wait was hardened to follow the latest received viewport; final source review includes that correction.

## Findings (not fixed)

No material source defect identified. No extra design revision is requested. Native acceptance must still inspect body/tail fusion, face-facing placement using fresh cat geometry, compact-to-expanded stability, left/right and screen-edge behavior, transparent-area click-through, initial/repeated opening and reduced motion. Source and isolated test evidence do not establish those runtime results.

## Verification

- Frozen manifest: independent SHA-256 check, 10/10 match.
- Source scope: independent comparison against this continuation's baseline; only authorized existing application files differ.
- TypeCheck: owner-reported pass (`tsc`); not duplicated by the reviewer.
- Syntax/lint hygiene: owner-reported two changed CSS files parse and scoped diff hygiene pass. No separate broad lint/build was run by the reviewer.
- Focused tests: owner-reported 15 frontend tests pass (attachment/parser plus bounded entrance coverage), six standalone native anchor tests pass, `verify-chat-interaction` and `verify-companion-interaction` pass. Owners additionally exercised the actual extracted viewport receive/wait handlers for event-before-command ordering, invalid payload/revision stability, old-host missing-anchor compatibility, latest-size opening waits and listener/timer cleanup. These are static/isolated checks, not live app evidence.
- No app, service, model invocation, fixture/business-data creation, full test rerun or native build by this reviewer. The coordinator owns final native evidence and broader outstanding task gates.
