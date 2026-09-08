# Configurable tail verification — 2026-09-07

## Latest integrated silhouette refinement

User screenshot still showed a pasted-on triangular tail. Expanded now uses top67% / right-20px / 30×36px, superseding earlier sizes below. The internal SVG variant rounds the tip and starts its outline at x18 in the 52-unit viewBox, near the frame edge, while retaining inward fill overlap. Its 1px stroke matches the frame color and its separate shadow is removed. Compact shape/defaults and paw remain unchanged.

Browser settings-page measurement:30×36px, center455.25px on680px frame, stroke1px rgba(240,199,158,.95), filter:none. Inspected settings screenshot `output/playwright/tail-config/settings-soft.png` and expanded chat screenshot `output/playwright/tail-config/chat-soft.png`. Width-only100px keeps the fill34.34375px inside the border and outline start0.2716px outside it (within the1px border join); explicit right0 remains honored; reset restores30px/67%; standalone tail count0. Both scoped static checks and read-only review passed. No full build repeated for these localized decoration changes. Evidence is browser rendering with explicitly unconfigured service and neutral standalone slots, not native/model validation.

## Latest large-frame adjustment

User requested the large-frame tail lower again. Expanded default top is now **67%**, superseding 64% below. Browser measurement on the same 680px frame: center455.25px, about20.34px lower; dimensions remain42×48px. Switching back confirmed compact remains top132px/24×30px. Inspected `output/playwright/tail-config/expanded-lower.png`. Both scoped static checks and read-only review passed; no full build repeated for this numeric default change.

## Implemented contract

`ChatBubbleFrame` accepts `tail?: ChatBubbleTailConfig`; `ChatPanel` forwards the same prop. `top` is the vertical center anchor, `right` the horizontal offset. Numbers represent CSS pixels; position fields also accept CSS strings such as percentages. Width and height are independent pixel dimensions. Tail rendering remains attached-only.

| Variant | Center top | Right | Width | Height |
| --- | --- | --- | --- | --- |
| compact | 132px | -16px | 24px | 30px |
| expanded | 64% | -26px | 42px | 48px |

The compact center moved down about 8px and both variants are about 20% smaller. If width is customized without right, the default right offset scales proportionally to preserve the join. Explicit zero is respected. Tail SVG uses `preserveAspectRatio="none"` to scale its painted path independently in both dimensions; paw SVG is unchanged.

## Browser evidence

Used the existing Vite server on port 1421 and isolated Playwright session `tail-config`. The independent frame preview contains neutral slots; ChatPanel preview is explicitly unconfigured with no messages. No model, seeded conversation, or native Tauri interaction was used.

- Compact defaults measured 24×30px, center 133px from the outer border (132px from padding edge), right protrusion 15px and overlap 9px.
- Expanded defaults measured 42×48px. On the actual 680px ChatPanel preview, center was 434.90625px from the frame top.
- Explicit top 150, right -22, width 36, height 40 persisted across expanded/compact switches.
- Percentage top 70% and right 0 were honored; reset restored defaults; standalone rendered no tail.
- Width-only 48 produced proportional right -32. A stronger width-only 100 / default height 30 check exposed SVG letterboxing: painted path detached by 3.0756px. After the SVG fix, actual painted path left was 34.34375px inside the frame right edge and painted width was 98.0769px, confirming independent scaling and overlap.
- Paw offset remained x5.109375/y-4 relative to the frame; shared top-left corner remained 72px.
- Inspected final compact and expanded screenshots after the SVG correction: `output/playwright/tail-config/compact.png` and `output/playwright/tail-config/expanded.png`.

## Static verification and scope

- `pnpm build` passed once for the typed prop/JSX changes, including QA entry points.
- `node tools/verify-component-compact.mjs` and `node tools/verify-closed-reference.mjs` passed, including after the final SVG attribute change. No repeated full build for that attribute-only correction.
- Existing native-window and real-service acceptance items AC3–AC5 remain open independently of this visual/configuration change.
