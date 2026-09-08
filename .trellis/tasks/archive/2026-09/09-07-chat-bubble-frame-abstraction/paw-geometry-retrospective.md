# Bug Analysis: Equal badge offsets did not preserve corner overlap

## 1. Root Cause Category

E — Implicit assumption, with D — Test coverage gap. The previous change assumed equal frame-relative SVG bounds meant equal visual placement. The frame's top-left curve still varied from 20/24/28px to 72px, so the badge covered different parts of the visible corner.

## 2. Why Fixes Failed

1. Moving visual markup into ChatBubbleFrame preserved per-mode badge positioning.
2. Making the badge a direct root child unified its bounds but left the underlying curve different.
3. Coordinate tests proved only rectangular offsets; the screenshot review failed to judge the badge together with the curve it was meant to overlap.

## 3. Prevention Mechanisms

| Priority | Mechanism | Action | Status |
| --- | --- | --- | --- |
| P0 | Architecture | One component owns the 72px top-left painted curve and paw anchor together | Done |
| P0 | Visual verification | Compare same-scale crops including the full arc, not just the SVG bounds | Done; see paw-shared-geometry-verification.md |
| P1 | Specs | Document short-header CSS radius normalization and child-background clipping | Done |
| P1 | Static check | Reject mode-specific top-left curve overrides as well as badge offsets | Done |

## 4. Systematic Expansion

Bounded to this frame's top-left corner. Review the header/body backgrounds because a copied radius on a short child can normalize to a smaller curve; do not expand into unrelated component redesign. Keep current compact reference geometry and other corners/content behavior.

## 5. Knowledge Capture

- Updated frontend/component-guidelines.md and frontend/quality-guidelines.md.
- Added R8/AC8 and saved the latest user-approved screenshot as references/paw-corner-approved-v2.png.
- This project has no Git repository or generated spec template tree to synchronize; do not create either solely for this record.
