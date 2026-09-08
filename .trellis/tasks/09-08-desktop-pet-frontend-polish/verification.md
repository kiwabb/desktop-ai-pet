# Frontend polish verification — 2026-09-08

## Version and scope

- Source baseline: d22c6fd; branch codex/desktop-pet-frontend-polish.
- Product v0.1.0, final frontend assets index-Dr61Evd5.js and index-Dgfvj8Ip.css.
- Bundle: src-tauri/target/debug/bundle/macos/橘伴.app; successful debug packaging.
- No settings/credential writes, todo/reminder writes, seeded data or mock service.

## Static and build evidence

- Full pnpm build (tsc + Vite): passed.
- verify-component-compact, verify-closed-reference, verify-chat-interaction, verify-pet-live-status: passed.
- pet2d:validate, git diff --check: passed.
- Independent review repaired draft acknowledgement races and stale copy feedback. Regression tests execute actual handlers/renderer; their unit inputs are not runtime business data.

## Browser evidence

Real QA entry http://127.0.0.1:1421/qa/chat-preview.html uses null status, empty messages/tools, and guards settings submission.

- Compact frame475×278; expanded/settings/todos676×665.
- All measured paw offsets x5.109375,y-4 relative to frame; width53.296875,height59.265625.
- Footprints: compact/expanded5, settings/todos7.
- Return settings→compact and todos→expanded restored origin;10 browser settings/return/hide/show cycles passed, hidden frame inert.
- Shift+Enter newline passed. This is not proof of real OS IME composition.
- Reduced-motion computed animation for approved reference is none.
- Screenshots: output/playwright/frontend-polish/{compact,expanded,settings,todos,closed}.png. Later refreshed compact/settings/closed include final seamless status overlay.
- Todo browser view shows unavailable native invoke error, not empty success. Only console error is favicon404.
- Status overlay seam was found and removed; refreshed closed screenshot visually checked.

## Native / real-service evidence

- Final bundle reopened through its exact project path. Native AX and screenshot show the new live state “助手与设备已连接，模型已配置”, seamless status surface, and removal of attachment/voice placeholders.
- AX primary click opened compact, and focused the composer. A real short no-tool Markdown verification prompt was submitted; the UI entered disabled generating state. This establishes initiation, not completed model output or a full streaming flow.
- Subsequent AX/screenshot returned cat-only content. CoreGraphics optionAll reported main window24514 at232×381; optionOnScreenOnly found no pet windows. It is unknown whether the sampled background content represents final rendering. No speculative native patch was made.
- User was asked to bring the existing pet onto the current desktop before final send→expand, streaming, clipboard and native navigation acceptance.
- Native screenshots were displayed through CUA; system screenshot skill could not capture an on-screen pet, so no system screenshot file was generated.
- Do not interpret browser cycles or unit status cases as native/service acceptance.

## Outstanding acceptance

Six-view user confirmation, actual IME composition, real streaming/read protection, real code clipboard/link behavior,10 final native cycles, screen edges/multiple displays, real failure/recovery and explicitly scoped settings/todo writes remain open until observed. No claim of measured60fps or whole-task completion.
