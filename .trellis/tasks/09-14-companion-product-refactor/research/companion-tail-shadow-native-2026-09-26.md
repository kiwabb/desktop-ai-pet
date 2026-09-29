# Speech corner and shadow correction — 2026-09-26

## Scope and cause
The user rejected the previous10px bump as too faint and the shadow as odd. Authority: `../companion-tail-shadow-2026-09-26.md`. Source diagnosis found the14px-offset/32px-blur body shadow exceeded the12px backing gutter, while the corner was separately painted. CSS overflow cannot escape a native window drawing buffer; native window config already disabled shadow. This correction leaves native code/metadata unchanged.

The body and28px rounded corner now share one closed SVG contour,1px apricot edge and0 3px4px/.10 warm shadow.16px paint safety gutters plus28px cat-side reservation avoid a clipped rectangular shadow; narrow widths cancel corner reservation before body falls below320px. Cat/art/paw/palette and all state/handler flows are preserved.

## Build and reversible installation
One coherent `pnpm tauri build --debug --bundles app` passed, including frontend type/build and native packaging. Log: `/tmp/companion-tail-shadow-build-20260926.log`. Existing large JS chunk advisory remains. No post-visual correction or second build was required.

Installed: `/Applications/橘伴.app`. Source/staged/installed executable SHA-256: `798e68eb8942aa99ff15a0054fc6acffc1f5ab1baa34dcc1e78a766a3f8b2986`. Previous bundle preserved at `/Users/zhoujiaangyao/Library/Application Support/desktop-ai-pet/app-backups/20260926-150943/橘伴.app`. Final PID73469 runs the installed executable path. Candidate PID73021 ran the exact new source bundle before installation.

## Real native acceptance
- Actual composed desktop screenshots show the larger corner clearly, aimed at the cat mouth, and a continuous light outline/shadow without the old rectangular cutoff. Independent image-only review agreed for compact. Expanded was visually checked by the main session. Evidence: `companion-tail-shadow-compact-native.png`, `companion-tail-shadow-expanded-native.png`.
- Both modes retained native rectangles: chat497,167,720×680 and cat1229,507,232×340. Compact body753,451,420×380; expanded513,183,660×648. Both use the same tail target near desktop y612.56. Cat did not move/resize due to opening or expansion.
- First opening focused the editable input. Local unsent text `气泡轮廓验收草稿` survived expand, collapse, close and reopen, then was cleared. No message was sent. The existing offline reason and disabled Send were actual runtime state, not fixture data.
- Final installed app opened with an empty focused input. On-screen windows4756/4755 retained the same geometry and layers4/5. `companion-tail-shadow-installed-native.png` is the unedited desktop region753,451,708,396 containing current panel/cat; the wider compact capture above additionally shows the full outer shadow.

## Static checks and limits
Owner passed16 focused attachment/entrance tests, TypeScript, three CSS parses and the existing chat-interaction handler verifier. Reviewer confirmed frozen10/10 hashes, unchanged native files/payload/state handlers, authorized six-file source scope, single contour, mirrored geometry, entrance origins, pointer exclusion and narrow fallback. See `companion-tail-shadow-check-2026-09-26.md`.

Live coverage is current100% scale, left-side placement, compact/expanded/close-reopen on the current display. Mirroring, narrow-window and reduced-motion cases are source/tests, not a new live platform/display claim. No model, backend, seeded service, fixture records or business writes were used. No system preferences changed. Broader task/menu/tray/model gates stay open, dirty work is preserved, and no blanket commit/archive is performed.
