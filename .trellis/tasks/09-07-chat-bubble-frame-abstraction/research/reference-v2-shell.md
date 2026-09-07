# Research: approved V2 HTML shell geometry

- Query: Extract the approved HTML shell, disk connection, and size formulas for a React port, retaining the current paw placement/shadow and cat asset.
- Scope: internal, read-only reference and source inspection
- Date: 2026-09-07

## Findings

### Sources and boundary

- `references/preview-v2-approved.html` in this task: locked copy of the user's final `Downloads/preview (2).html`. Line references below use this file's original line numbers; embedded images were excluded from output.
- `src/components/ChatBubbleFrame.tsx:102`: current direct-child paw. The shell can change without replacing this decoration.
- `src/components/ChatBubbleFrame.css:106-118`: preserve paw top `-5px`, left `4.12px`, size `53.3 × 59.27px`, and both shadows (`0 5px 6px rgba(191,103,47,.3)`; `0 1px 2px rgba(191,103,47,.2)`). Its anchor currently uses the frame padding edge, about `+1px` from the border box; a borderless replacement must compensate for that to preserve painted position.
- Reference `PetShell` is a geometry/layout controller (lines 174-307), separate from the demonstration connection/chat controller (lines 310 onward). Port only the former's visual contracts. No demo adapters, prewritten replies, simulated connection flags, credential persistence, or page size controls belong in this change.

### Parameter space and size presets

Reference defaults (lines 182-188) are logical pixels, not native-window requirements:

| Preset | Panel width | Panel height | Minimum height |
| --- | ---: | ---: | ---: |
| chat | 940 | 480 | 440 |
| conversation | 940 | 730 | 580 |
| settings | 1022 | 882 | 560 |

Width range is 680-1600; height maximum is 1200. Chat and settings are two content views in the same shell; conversation selects a taller chat preset (lines 195-198, 284-293). `ResizeObserver` redraws from actual content-box width/height and ignores unchanged or zero measurements (lines 298-305).

The controller does **not** scale the disk when panel size changes. It translates the original disk and cat together. Whole-stage uniform scaling is a small-browser fallback only (lines 206-214):

```ts
scale = Math.min(1, Math.max(.15, (innerWidth-32)/1066),
                    Math.max(.15, (innerHeight-32)/754))
maxWidth = Math.max(680, Math.floor((innerWidth-32)/scale - 386))
maxHeight = Math.max(580, Math.floor((innerHeight-32)/scale - 174))
```

Presets are clamped to both their own bounds and available room. Desktop host/native window sizing should own availability; do not transplant browser recentering over existing desktop positioning.

### Core geometry: panel-local derivation

Original `redraw` is at lines 215-259. For panel logical size `(w,h)`:

```ts
w = Math.max(680,w); h = Math.max(440,h)
stageWidth = w + 386
stageHeight = Math.max(h + 174, 754)
L = 24
R = L + w
B = stageHeight - 116
T = B - h
r = 42
dx = w - 1022
dy = stageHeight - 1056
S = T + clamp(h - 370, 158, 222)
```

`(L,T)` is the HTML panel top-left; width/height remain `w,h`. The SVG uses the full stage viewBox and equal CSS dimensions, so SVG coordinates equal logical pixels. Coordinates are rounded to 3 decimals by `point` (line 199).

For a reusable shell tied to a panel rather than a browser stage, subtract `(L,T)` from every SVG point. This yields panel `(0,0,w,h)`, right `R=w`, bottom `B=h`, shoulder `S=clamp(h-370,158,222)`. The original dock local point `(x,y)` maps to:

```ts
P(x,y) = [w + x - 1046, h + y - 940]
```

This normalized form retains every curve and removes browser offsets. Any overall scale for the existing application's smaller logical sizes must scale all geometry/material strokes consistently, not only the disk or the SVG viewBox independently.

### Shell path, in readable panel-local form

Directly equivalent to lines 221-234; here `R=w`, `B=h`, `S=clamp(h-370,158,222)`, and `P` is above. The reference uses fixed `r=42` for all corners, except the right edge is a shaped profile.

```text
M 42 0 H R-42 Q R 0 R 42 V 79
Q R 91 R+12 97
C R+31 107 R+37 124 R+37 149 V S
C R+37 S+17 R+45 S+25 R+59 S+32
C R+99 S+49 R+96 S+92 R+71 S+109
C R+61 S+116 R+48 S+116 R+37 S+125
Q R+24 S+136 R+24 S+158
```

The section below the fixed shoulder has two forms; this prevents a reversed vertical segment on shorter panels (lines 225-230):

```text
if B-300 >= S+158:
  V B-300 Q R+24 B-272 R+47 B-260
  Q R+59 B-252 R+59 B-230 V B-113
else:
  mid = (S+158 + B-113)/2
  C R+24 mid R+59 mid R+59 B-113
```

The remaining path is the fixed disk/connection translated with the panel bottom/right:

```text
C P(1140,819) P(1200,818) P(1250,821)
C P(1323,823) P(1390,839) P(1390,868)
V B-36
C P(1390,930) P(1305,948) P(1230,948)
C P(1160,948) P(1115,937) P(1080,937)
C P(1060,937) P(1040,940) P(1018,940)
H 42 Q 0 B 0 B-42 V 42 Q 0 0 42 0 Z
```

Thus this is **one contiguous panel-to-disk silhouette**, not a rounded rectangle plus an attached triangle. The right shoulder and lower saddle are part of the same outline. Keeping the old triangle over it would duplicate the connection.

### Disk/cat relationships and material layers

Lines 89-122 define fixed disk-local shapes; all receive one `translate(dx,dy)` (line 238). They must not stretch when just `w/h` changes:

| Element | Panel-local position / extent |
| --- | --- |
| Top disk ellipse center | `(w+174, h-72)` |
| Top disk ellipse radii | `(170,48)` |
| Disk rightmost silhouette | `w+344` |
| Disk lowest silhouette | `h+8` |
| Cat button reference top-left | `(w-16, h-505)` |
| Cat button reference size | `378 × 498` (CSS line 8) |
| Pet status bubble top-left | `(w+93, h-586)` |
| Pet status bubble reference size | `228 × 103` (CSS line 8) |

The cat/cushion remains a separate raster asset above SVG. Preserve the application's approved asset; the HTML asset is not authorization to replace it. These positions explain the intended visual relationship but current host geometry is a separate integration responsibility.

Paint order (lines 47-122):

1. One filled whole outline using cream gradient `#fffdfa → #fff8ee → #fff1dc`; base stroke `#ffce9f` 7px. One frame-shadow filter with two drop shadows: `(dy14,std14,#ad6635,.24)` and `(dy3,std3,#ea9754,.4)`.
2. Clip disk surface to the same outline. Fixed ellipse top, integrated front face, depth gradient, and subtle saddle light are painted within it.
3. Original outline border is three strokes: `#ffce9f` 10px; `#fffefa` 5.5px; warm gradient 1.5px. A scene-space mask fades this border out at the lower joint.
4. Disk rim/saddle highlight and shared lower edge replace the faded segment. All local gradients/masks stay in disk coordinates inside the translated group.

The outer mask dimensions and its `x=978+dx,y=820+dy` fade rectangle move in scene space (lines 240-245). The lower-outline gradient x endpoints likewise move. Do not translate both the local group and its local masks, which would apply the offset twice.

`soloDock` is visible only when the panel is closed (CSS lines 15-16,21). Expanded state paints the integrated disk only. A second complete disk must not be overlaid under the open shell.

### Suggested React boundary and acceptance

- A pure geometry function takes actual panel dimensions and returns path, viewBox/overflow bounds, disk translation, and anchors; SVG decoration component consumes it. Keep page/business state outside that function.
- Use instance-unique SVG IDs for gradients, masks, filters and clip paths, since independent QA and application frames can coexist.
- Retain current paw component/CSS separately. Do not copy the HTML paw `100×100`, alternate narrow-size rule, or reference paw shadow. The reference's corner radius `42` differs from the old approved `72`; new shell and existing paw must be checked together, rather than carrying over old background clipping accidentally.
- Check compact, expanded chat, and settings at their actual host sizes; verify one disk, unbroken saddle, no clipped border/shadow, unchanged paw painted offset/shadow, and fixed cat size. Exercise the short-panel branch as well as the tall-panel branch.

### Related specs

- `.trellis/spec/frontend/component-guidelines.md`: frame-owned decoration, host-owned placement/window sizing, CSS isolation, approved paw placement/shadow, existing configurable tail, no fake backend states.
- `.trellis/spec/frontend/quality-guidelines.md`: visual evidence must describe actual QA scope; protect approved cat artwork.
- `.trellis/workflow.md`: persist research before implementation and keep verification proportional.

## Caveats / Not Found

- Research is source-grounded static extraction; no browser or native runtime claim is made here.
- Reference widths/minima belong to its 1408-scale composition. Applying these dimensions literally to the current native panel would change the window footprint; the host integration must intentionally map logical scale/available bounds.
- The reference's one-shell disk connection supersedes the old separate-triangle visual. Existing public `tail` compatibility is an implementation/design decision; do not silently leave a visible legacy triangle on top of the approved outline.
- Reference side-paw decorations (line 255) are extra motifs distinct from the preserved corner paw. Their inclusion needs to follow the approved visual integration; they are not required for the geometric seam.
- No external documentation or web sources were needed. No code, specs, Git state, or other task directories were modified by this research.
