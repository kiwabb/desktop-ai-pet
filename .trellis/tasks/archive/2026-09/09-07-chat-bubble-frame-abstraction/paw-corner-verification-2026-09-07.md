# Shared paw corner verification

## Approved target and implementation

User reference: references/paw-corner-approved.png. The user explicitly requested one paw treatment pressing on the top-left rounded corner for every mode.

ReferencePawBadge is now a direct child of ChatBubbleFrame. A single rule defines absolute left4.12px/top-5px, width53.3px/height59.27px, z-index6, pointer-events:none and the shared shadow. The badge remains aria-hidden. Per-mode badge rules and header flex positioning were removed; header text reserves 69.3px on the left. Standalone outer overflow is visible, with clipping retained on inner surfaces.

## Browser evidence

Measured after settling entrance motion; values are CSS px relative to the frame outer bounds:

| Surface | Paw x | Paw y | Width | Height | Gap before title |
| --- | --- | --- | --- | --- | --- |
| Standalone compact | 5.109375 | -4 | 53.296875 | 59.265625 | 11.890625 |
| Standalone expanded | 5.109375 | -4 | 53.296875 | 59.265625 | 11.890625 |
| Attached compact | 5.109375 | -4 | 53.296875 | 59.265625 | 11.890625 |
| Attached expanded | 5.109375 | -4 | 53.296875 | 59.265625 | 11.890625 |
| ChatPanel settings | 5.109375 | -4 | 53.296875 | 59.265625 | 11.890625 |

All four frame combinations were checked through real React props controls in the isolated entry. The settings check used the actual ChatPanel navigation with no configured service, messages or tools. Escape followed by reopening preserved exactly the same paw bounds and restored textarea focus. Compact frame remained475×222; compact title stayed x70.296875/y27 relative to the outer frame.

Visually inspected screenshots:

- output/playwright/paw-corner/compact.png
- output/playwright/paw-corner/expanded.png
- output/playwright/paw-corner/settings.png

The paw visibly overlaps the top-left corner, is not clipped by the expanded header, and does not cover title text. The compact treatment matches the approved reference geometry at its displayed scale.

## Static and independent checks

- pnpm build passed once, including QA TypeScript callers.
- verify-component-compact.mjs passed with updated root-child/single-rule geometry assertions; original image hash, dimensions, shape and color checks retained.
- verify-closed-reference.mjs passed.
- Independent trellis-check review found no substantiated introduced regression.

These are browser rendering/interaction and static checks. No native window or real model invocation is claimed; service settings and credentials were not changed. This closes AC7, without claiming the broader task's original native/real-agent acceptance.
