# Character-matched theme — 2026-10-03

User rejected the blanket cream/apricot mapping as unrelated to the tabby. Supersedes yesterday's warm-only decision, not the original rejection of full gray pages.

## Palette source and scope
Inspected actual base.png from saved preset dd84773e-3883-40d0-8077-0e5a9266606c. Two iris boxes (169,255,217,293) and (286,266,332,306), selecting opaque color-bearing iris pixels, yielded 1923 samples; channel median RGB(179,164,105), #b3a469. This is manual palette curation of the real generated image, not a newly implemented automatic extraction feature.

Two frontend files change palette roles/contrast tests. No image generation, backend change or new control. Selected accent remains meaningful; nearly white ivory background, taupe text, muted olive-gold actions for this preset.

Native color well could not accept an exact value via AX, and Show Colors did not expose an editor. Closed app, verified process stopped, backed up original state in app-owned storage and atomically updated only this preset accent plus revision. Original images, job counts and business records untouched.

## Static verification
Independent scoped review: no findings. 12 targeted tests pass. Supplementary 4096 RGB sample sweep minimum ink contrast 4.50005:1 across seven backgrounds, loops terminate. Native evidence pending below.

## Native observation
- Built current exact source into debug macOS app (session 15070; TypeScript/Vite/native packaging passed), quit old app and reopened that bundle.
- Current preset restores as 小虎. Pet action and paw badge visibly use sampled olive-gold; customization preview shows the actual tabby beside ivory/taupe palette. Compact chat, Todo, Memo and settings chrome inspected; no blanket apricot remains.
- Backend startup is still pending after rebuilt-app restart; no loaded-content acceptance is claimed. User asked to complete any system Keychain prompt. No new model call or fake content.
- Full feature acceptance is still open; this commit is palette refinement only.
