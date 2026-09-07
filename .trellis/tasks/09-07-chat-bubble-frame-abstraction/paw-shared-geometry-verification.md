# Shared paw and painted-corner geometry

Latest reference: references/paw-corner-approved-v2.png. This report supersedes the previous claim that equal SVG offsets alone established the requested visual match.

## Implementation

ChatBubbleFrame owns both the paw anchor and the painted top-left corner. A private 72px corner-radius token drives the root and full-size chat-panel-surface; mode rules adjust only other corners. The surface contains header/body/footer, so a short header cannot paint a smaller corner. The paw and tail remain outside its clipping boundary.

Minimum root/surface dimensions accommodate sums of adjacent radii; root minima also reserve border width. Attached compact preserves visible surface overflow for existing error/footer reachability: its transparent84px header covers the entire72px arc, leaving the outer frame as its only corner painter. Other surfaces retain clipping.

## Final evidence

- Real React controls in the isolated frame entry exercised all four appearance/variant combinations. All root and surface top-left radii were72px, with paw x5.109375/y-4 and53.296875×59.265625 CSS px bounds.
- Same-scale210×160 corner screenshots were inspected, including the background curve below the paw. The surface heights188/204/306/208px exceeded the corner sums despite header heights48/64/84/68px.
- Empty neutral body/no footer browser diagnostics: standalone compact outer94px/surface92px and expanded outer98px/surface96px, sufficient for72+20 or72+24px adjacent radii. These diagnostics removed only neutral QA content; no application message/error/connection data was invented.
- Actual ChatPanel browser navigation to settings and back to expanded/compact preserved paw bounds and72px radius. Compact remained475×222; expanded/settings remained676×680. Title gap11.890625px in each case.
- Visually inspected the complete compact, expanded and settings screenshots. Paw is above the painted corner without title overlap or decoration clipping.
- Both static scripts passed; one build passed after the JSX surface restructuring. Subsequent CSS-only minimum-size/overflow corrections ran focused static checks without another build. Independent review confirmed those boundary fixes and retained static assertions.

Screenshots under output/playwright/paw-geometry/:

- standalone-compact.png / standalone-expanded.png / attached-compact.png / attached-expanded.png — same-scale corner comparisons.
- compact-final.png / expanded-final.png / settings-final.png — final complete surfaces.

The current ChatPanel also contains parallel agent/todo changes; this task did not edit those business controls. Verification is browser rendering/navigation plus static/build checks, not a native Tauri or real-agent/model run. No service settings, credentials or data were changed. The larger task's original native acceptance remains open.
