# Research: existing cat image disk bounds

- Query: Locate the existing baked-in disk and cushion at CSS 232 × 380.9 so the new shared SVG does not add a second disk.
- Scope: internal, read-only visual inspection and sparse PNG samples
- Date: 2026-09-07

## Findings

### Files found and method

- `public/reference/desktop-pet-closed-reference.png`: approved transparent composite, intrinsic 544 × 893; cat, cushion, disk, and status decoration are baked into this image.
- `src/styles.css:102`: `.closed-reference-art` displayed at 232 × 380.9 with object-fit fill. Vertical scale is 380.9 / 893 = 0.42653975.
- `tools/verify-closed-reference.mjs:22-95`: existing no-dependency PNG RGBA decoder. Its decoder functions were evaluated read-only in Node; no dependency installation or image rewrite.
- The full source image was visually inspected with `view_image`. Row/color sampling is evidence for opaque/transparent ranges, not semantic pixel-perfect segmentation.

### Relevant source-image / CSS Y bounds

All CSS coordinates below are relative to the **image element top**, not the native window.

| Region | Approximate source Y | CSS Y |
| --- | ---: | ---: |
| Earliest exposed disk top at lateral ends | 668-680 | 285-290 |
| Cushion center lower boundary | 740-744 | 315.64-317.35 |
| Disk front-face / bright lower rim | 744-764 | 317.35-325.88 |
| Low-opacity disk shadow still visible | 770-787 | 328.44-335.69 |
| Last row with alpha greater than 10 | 787 (measured) | 335.69 |
| Image element bottom | 893 | 380.9 |

The image has about **45.2 CSS px of transparent trailing area** after meaningful disk/shadow pixels. A host bottom gap of about 5px therefore places the actual visible disk bottom about 50px above the native window bottom, despite an almost-bottom-aligned image element.

Sparse samples support the boundary: at source center x272, y740 is brown cushion/base contact `[208,150,119,253]`, y750 is pale disk `[252,226,203,253]`, y760 orange disk `[251,186,137,252]`, y770 semitransparent lower edge `[221,146,68,195]`, and y780 shadow `[183,128,94,46]`. At y790 all sampled lower-region columns are fully transparent.

### Non-destructive clipping advice

A horizontal clip at source y744 (83.315% of image height; CSS y317.35) preserves the cushion's center bottom and removes the lower disk front and shadow. It does **not** remove disk portions rising around the cushion sides (visible from about source y668). This is a safe initial limit, not a complete disk isolation.

To eliminate the old disk entirely while preserving cushion and tail, use an open-state-only SVG/CSS clip following the lower cushion contour: rise at left/right sides and reach about source y744 at the center. The contour must be checked visually against the approved image; it cannot be reliably generated from alpha alone because the disk/cushion share opaque warm pixels. Do not use a flat source y670/CSS y286 cut: it slices the cushion and tail.

Align a replacement disk's upper front contact near image-local CSS y317, then tune its curved rim to the original cushion boundary. Do not calculate the replacement from image element height380.9 alone. Keep the source PNG unchanged and preserve the full image in the closed state.

### Related specs

- `.trellis/spec/frontend/component-guidelines.md`: protect current cat artwork and frame-relative paw; host owns positioning.
- `tools/verify-closed-reference.mjs`: approved image hash and closed-state image preservation contract.

## Caveats / Not Found

- All semantic disk/cushion boundary numbers are visual approximations within several source pixels, appropriate for initial CSS/SVG alignment; only image size and alpha last-row bounds are measured exactly.
- No raster crop, generated mask, pixel rewrite, browser screenshot, or native-window operation was performed.
- Existing host image bottom alignment was provided by the main session; this subtask measured image-local content only.
