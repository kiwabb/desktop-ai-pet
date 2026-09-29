# Closer panel placement — 2026-09-26

## Scope
User requested smaller distance after the corner/shadow correction. Only `src-tauri/src/window_geometry.rs` production code changed: separate signed adjacency from screen EDGE12; left-36/right-48 logical spacing, consistently scaled in side-space fitting and positioning. Frontend paint,28px corner,16px shadow gutter, paw/cat/art and all lifecycle/state APIs remain unchanged. Authority: `../companion-distance-2026-09-26.md`.

## Build and install
One coherent `pnpm tauri build --debug --bundles app` passed. Log `/tmp/companion-distance-build-20260926.log`; existing large JS chunk advisory remains. No visual fix or second build was needed.
Source/stage/installed executable SHA-256: `45f13e2046f17804208b749bbdeadbe6bf33a133d6125757edf1933a896551b6`. Previous bundle preserved at `/Users/zhoujiaangyao/Library/Application Support/desktop-ai-pet/app-backups/20260926-163757/橘伴.app`. Final PID80495 runs `/Applications/橘伴.app/Contents/MacOS/desktop-ai-pet`; candidate PID80208 ran the exact new source bundle.

## Actual native result
Before: chat497,167,720×680; cat1229,507,232×340. After: chat545,167,720×680; cat unchanged. Thus the current left panel moved48 logical pixels toward the cat without resizing either backing or moving the pet. Native layers4/5 remain.

Actual compact and expanded composed screenshots (`companion-distance-compact-native.png`, `companion-distance-expanded-native.png`) show a clear gap between the speech tip and face fur, no cat/tail/control overlap, and preserved corner/outline/shadow. Expanded retained the same native geometry and target. Compact body801,451,420×380; expanded561,183,660×648. The projected mask face separation is about24 logical pixels at standard scale, which is geometry-derived rather than a pixel measurement from the screenshot.

First open focused the input. Unsent local text `间距验收草稿` survived expansion, collapse/close and reopening, then was cleared. No message was sent; actual offline status and disabled Send remained. Final installed app opened with empty focused input; on-screen windows4852/4851 matched the new geometry. Final unedited desktop region801,451,660,396: `companion-distance-installed-native.png`.

## Static evidence and limits
Owner passed16 standalone geometry tests; new coverage includes mirrored placement, all3 pet scales,4 display scales, negative origins, positive projected fur clearance and idempotence. Reviewer confirmed sole native geometry source scope, frozen10/10 hashes, unchanged frontend/lib.rs and no blocker. See `companion-distance-check-2026-09-26.md`.

Live verification covered current100% left placement on the current display. Right-side60px improvement, other scales/displays and clamp paths are source/pure geometry evidence, not new live native acceptance. No model, backend, seeded data, preference update or business write was used. All overlapping dirty work preserved; broader task gates remain open and no blanket commit/archive was performed.
