# Bring the speech panel closer to the cat — 2026-09-26

User: “距离有点远”. Preserve accepted28px speech corner, unified outline/shadow, warm theme, old paw and frozen cat. This brief supersedes only earlier unchanged-native-gap constraints: move the CHAT backing toward the cat using transparent-margin overlap; never move/resize the cat, alter chat backing dimensions, change anchor projection or disturb native focus/show/hit/drag lifecycle.

## Smallest correction
Native geometry currently uses the screen EDGE12 as a positive inter-window gap. With16px paint inset and the sprite's transparent margin, the actual visible separation is excessive. Separate screen inset from signed adjacency spacing.
- Panel left of cat: native signed gap -36 logical px (48px closer than previous+12). Body edge stays8px left of cat's native rect; corner tip enters its transparent margin20px.
- Panel right: signed gap -48 logical px (60px closer). Body edge is4px inside the pet native rect, still outside the visible far tail; corner reaches32px into the right transparent margin.
- Multiply only native pixel boundary values by existing display.scale; preserve fixed logical UI geometry and pet scale handling. Both side-space choice/width fitting and adjacent_chat must use the same side-specific spacing. EDGE12 remains the screen-safe inset.
- Main inspected the actual approved matte: source row390 visible face x214..821; lower row1000 rightmost fur x1165. At100% rendered face is approximately43.7..156.4 inside232px window, lower right fur at220.2. Left/right transparent margins are asymmetric. Do not use -68 on the right: it would overlap the visible lower tail. Existing frontend paint/hit rectangles stay unchanged.

## Scope and ownership
Implementer owns src-tauri/src/window_geometry.rs only unless an actual necessity in lib.rs is identified. Frontend, raster/art, paw, palette/shadows and API shape are frozen. Main owns docs, one coherent build and native composition/flow check/install; checker owns independent geometry and no-overlap review. Preserve all dirty work.

## Acceptance
Update focused native geometry tests for exact side spacing, viewport fitting, left/right,80/100/120%, physical scale, negative origins, clamps and idempotence. No redundant full test suite. One actual native compact/expanded pass verifies narrower visible gap without cat/control overlap and unchanged draft close/reopen; one material-fix batch maximum if needed. Build and pure geometry tests do not prove alternate-display/native mirrored coverage. No models, backend starts, seeded data or preference writes.
