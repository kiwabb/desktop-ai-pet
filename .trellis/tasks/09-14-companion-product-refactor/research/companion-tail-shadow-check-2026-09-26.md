# Speech silhouette and shadow independent check — 2026-09-26

## Disposition and evidence boundary

**SOURCE-STABLE: no material source blocker found.** The coordinator was notified before this report so native packaging could proceed. Authority is `../companion-tail-shadow-2026-09-26.md`; comparison baseline is `/var/folders/ys/cjf2rbtd03lg_fclhtmcmgn80000gn/T/companion-tail-shadow-baseline-o4ny0s8h`. This is source/isolated-test evidence, not native visual acceptance. The reviewer launched no app, service, model, fixture or native build.

## Reviewed behavior and geometry

- Body and speech corner now use one SVG path with one move and one close. Four circular arcs match the content frame's 24px corners. The right/left corner is part of that perimeter, so there is no internal joining edge, separate corner stroke or separate shadow.
- The curved corner has a 48px base and an actual 28px reach: the quadratic tip's endpoints are at reach 24 and its control point at 32, producing a maximum of 28. Mirrored path order and curve directions are correct. A 48px center clearance keeps the base clear of the rounded corners.
- Linked layout reserves 16px around paint and 28px on the cat-facing side. Standard compact content stays 420×380; expanded width is 660px within the existing 720px backing, with 44px on the cat side and 16px opposite. Tail and body preserve the same face target across ordinary compact/expanded placement, with vertical clamping at the edges.
- If the corner would leave less than 320px of content width, overlap the target, point the wrong way, or lack vertical room, it is omitted and its reservation is returned to content. Missing/nonfinite anchors retain the existing CSS fallback. Native metadata validation is unchanged.
- The silhouette owns fill, 1px apricot edge and the restrained `0 3px 4px` warm shadow. Linked content is transparent with no separate box-shadow. The 16px paint safety inset accommodates the small shadow; no-anchor fallback uses the same smaller box shadow within its existing 12px inset. Actual raster edge quality remains a native QA item.
- SVG and content use the same physical entrance origin: body-edge coordinates expressed relative to their respective boxes. Existing 180ms scale/opacity motion is retained and reduced motion disables it. The lowered right-side placement selector no longer overrides the helper's 44px position.
- SVG is behind content, hidden from accessibility, non-focusable and noninteractive. Frame-only hit bounds, position-only republishing and entrance-end republishing are unchanged. App changes are limited to presentation: the separate tail is replaced by the single silhouette before ChatPanel. Navigation, drafts, readiness, visibility, focus and event/command handlers are unchanged.

## Findings (fixed)

None by the reviewer. No implementation changes were required after review.

## Findings (not fixed)

No material source defect identified. Native acceptance still needs to judge visible corner strength, absence of cropped or doubled shadow, compact/expanded continuity and close/reopen behavior. No new aesthetic iteration is requested from source evidence alone.

## Verification

- Independent continuation-baseline comparison: exactly six authorized source files differ (`App.tsx`, attachment helper/tests, desktop shell CSS, frame CSS and the panel shadow token). Native `lib.rs` and `window_geometry.rs` are byte-identical to this baseline.
- Independent frozen manifest SHA-256 check: all 10 cat/artwork/behavior/paw entries match.
- Scoped `git diff --check`: pass.
- TypeCheck: owner-reported pass; not duplicated.
- Syntax/lint hygiene: owner-reported three changed CSS files parse successfully; no separate broad lint/build run by the reviewer.
- Tests: owner-reported 16 focused attachment/entrance tests and `verify-chat-interaction` pass. The updated geometry tests cover left/right reservations, clamping, compact/expanded target stability, narrow fallback and threshold, invalid metadata, one closed perimeter and matching physical origins. No broad test rerun.
- Coordinator owns real native images and complete interaction acceptance. No production/model/business-flow claim is made by this review.
