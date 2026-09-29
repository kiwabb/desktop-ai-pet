# Clear speech corner and coherent shadow — 2026-09-26

The user rejected the previous10px speech tail as too faint and its shadow as odd. This supersedes the tail/gutter/paint constraints in companion-panel-link-2026-09-26.md; preserve that brief's native anchor, visibility/order, draft/navigation and frozen-cat contracts. The old 10px bump and large rectangular shadow are rejected, not an accepted baseline to retain.

## Change boundary
Keep current warm palette, old paw, cat/assets/expression/motion, native geometry/metadata and window lifecycle. Change only the frontend decorative speech silhouette and the internal content reservation needed to fit it cleanly. No backend, model requests, fixtures, new controls or new animation concept.

## Visible design
- A clearly readable rounded speech corner,28px reach with48px tall base. Shape is an organic curved wedge with a rounded point aimed at the existing nose/mouth anchor, mirrored on the other side. No tiny symmetric bump.
- Render body+corner as ONE closed geometric SVG silhouette, behind existing content. One continuous light apricot edge (~1px) and a restrained offset contact shadow (0px3px4px, warm brown alpha about.10). Remove the old body box-shadow and separate tail paint for this linked native surface. Do not shadow the rectangle and tail independently. The silhouette must not add an internal seam or shadow line at the join.
- Allow16px paint safety inset, plus28px corner reservation on the cat-facing side. This places the body44px from the cat-facing backing edge,16px from the opposite edge in expanded mode. Compact remains420×380 maximum; expanded uses available width after these reservations. Height uses16px top/bottom safety inset. Tail tip stays16px inside backing so the small shadow fades without a rectangular crop. Native720×680 backing and cat remain unchanged.
- Preserve compact face-following top rule and target stability across expansion; clamp tail center at least48px clear of corners. If subtracting16+16+28 would leave body width below320px, omit the corner and its extra28px reservation (360px backing retains328px body). On tiny/overlap/invalid targets omit the corner safely; no fabricated browser anchor. Existing no-anchor placement remains, with smaller fallback shadow so it does not clip at12px.
- Decoration aria-hidden and pointer-events:none; hit bounds still ONLY actual content frame. Existing position-only and entrance-end publication remains. Paint and content share entrance origin; no new awaits or changes to focus/reveal/state. Reduced motion remains static.

## Ownership and checks
Frontend implementer owns src/lib/companion-attachment.ts/tests, src/App.tsx presentational silhouette markup only, src/desktop-shell.css, src/components/ChatBubbleFrame.css and src/design-tokens.css if required for shared shadow tokens. Native files are read-only. Main owns brief/spec/docs/nativebuild/install. Independent checker owns scoped review report.

Update existing meaningful geometry tests for reservations/left-right/target stability/narrow viewport and verify current handlers if markup ownership changes. One coherent native build, one actual compact+expanded composition/close-reopen pass, at most one batched material correction then final confirmation. Keep tests/source vs live UI evidence separate. No broad test reruns or repeated reports before build release.
