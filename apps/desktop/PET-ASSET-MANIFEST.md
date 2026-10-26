# Electron pet asset manifest

These assets are copied from this product's existing `public/pets/` tree into
the Electron renderer package. They are not Cindy assets and do not load in the
Cindy main renderer.

| Source | Electron staging destination | SHA-256 | Runtime role |
|---|---|---|---|
| `public/pets/white-cat-v2/idle.png` | `apps/desktop/renderer/assets/pets/white-cat-v2/idle.png` | `f02df6be20e9176942b924e63a255f619f3e1811b8534b56a127d6e2587e7f6b` | Idle frame |
| `public/pets/white-cat-v2/blink.png` | `apps/desktop/renderer/assets/pets/white-cat-v2/blink.png` | `97e9c7d49956966ad4f53b23a59ef472cb1df3d013419803cf8b5001eb1411fa` | Blink overlay |
| `public/pets/white-cat-actions/eating-ai-v2-smooth/action.webp` | `apps/desktop/renderer/assets/pets/white-cat-actions/eating-ai-v2-smooth/action.webp` | `8e680fdef1c48c4c40e9d200ebd4626b8c76a5b65c6700026c8dc41bb9c5efb2` | Eating action, 175 frames at 24 fps, 7,350 ms loop candidate |
| `public/pets/white-cat-actions/play-wand/action.webp` | `apps/desktop/renderer/assets/pets/white-cat-actions/play-wand/action.webp` | `a653a89f759914fe32950799fed82eaffc86ad672eabf77c82c01ed22e3d66f5` | Play-wand action |
| `public/pets/white-cat-actions/belly-up/action.webp` | `apps/desktop/renderer/assets/pets/white-cat-actions/belly-up/action.webp` | `349142224bc5765de563278a884a877cf6321e5e6e162c2a107423b12cdbb30c` | Belly-up action |

The Electron build copies these files through
`apps/desktop/scripts/copy-renderer.mjs`. The build script preserves compiled
renderer JavaScript and only refreshes the packaged asset directory. The pet
renderer uses the existing action WebP files as animated media; it does not
claim that the AI-generated candidates have passed visual identity, endpoint,
ghosting, transparency, or native-window acceptance.
