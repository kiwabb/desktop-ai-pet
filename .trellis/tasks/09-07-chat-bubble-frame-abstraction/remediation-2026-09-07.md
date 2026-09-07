# Review remediation — 2026-09-07

## Scope and authorization

The user approved fixing review-2026-09-07.md with “那你改掉吧”. The existing task was reactivated. This pass repairs the four frame encapsulation defects and the stale QA contract, preserving the parallel remote-agent business implementation.

## Changes completed

- Restrict application desktop positioning to actual hosts; keep reusable frames in normal flow and establish a local containing block for decorations.
- Make border-box and internal selectors local to the frame.
- Apply entrance animation only while visible; support both appearances and effective component-local reduced motion.
- Replace stale QA chat fixtures with an explicit empty/unavailable browser state and isolate the frame stylesheet in its own QA entry.
- Include QA React callers in TypeScript validation.
- Update frontend component and quality guidelines with regression checks for these boundaries.

## Verification

All five reviewed findings are closed for this remediation scope.

| Browser case | Observed result |
| --- | --- |
| Stylesheet isolation | Only ChatBubbleFrame.css and qa/preview.css loaded; no application stylesheet or ChatPanel dependency |
| Standalone compact header | border-box, exactly 48px, 0px overlap with body |
| Other three appearance/variant combinations | All remain in normal flow with position:relative and 0px header/body overlap |
| Animation disabled | Visible in all four combinations; animationName:none |
| Hidden React prop | visibility:hidden, pointer-events:none, inert:true, animationName:none in all four combinations |
| Reopen with animation enabled | New animation startTime and playState:running in all four combinations |
| Reduced motion | Media matched and animationName:none in all four combinations, using component CSS alone |
| Application stylesheet added | Frame stayed position:relative with no desktop offset; subsequent paragraph remained below the frame (frame bottom339.796875, paragraph top352.796875) |
| Hidden input focus | Programmatic focus rejected; six Tab steps never entered the hidden frame |
| Empty ChatPanel flow | Quick prompt filled draft; unconfigured send opened settings; return restored compact frame; Escape hid it; reopen focused textarea and retained draft |
| Desktop-host QA geometry | Attached compact remained 475×222; expanded empty state displayed, message count0 |

Real React controls exercised visible/animateEntrance/variant/appearance; no DOM class rewriting was used to establish corrected animation behavior. Adding the application CSS to the isolated entry was a browser-only diagnostic for style leakage.

`pnpm build` passed once after coherent product/QA changes, now type-checking qa/*.tsx as well as src. Both `verify-component-compact.mjs` and `verify-closed-reference.mjs` passed; the latter retains the 544×893 / 252085 source-exact visible pixel assertion and now reads the migrated QA implementation entry. Its initial stale-entry failure was repaired without changing the asset assertions. No Rust build was needed.

Independent trellis-check review found no remaining substantiated defects in the repaired scope. The browser console contained only the existing favicon404 and React development guidance, not a component error.

Visually inspected browser QA screenshots (unconfigured/empty state, not native or model evidence):

- output/playwright/bubble-fix/compact-empty.png
- output/playwright/bubble-fix/expanded-empty.png

The screenshots show the preserved white-cat artwork and correctly laid-out panels. The composer draft came from clicking the existing quick-prompt control; it was not submitted to a model.

## Evidence boundaries

Frame controls exercise real React props and browser layout/animation. They do not emulate a Tauri window or a connected agent. No model call, fake connection, seeded chat data, credential mutation or mock reply is authorized or needed for these repairs.

The broader task's original AC3–AC5 native and real-agent acceptance remains separate. The original review and verification reports are retained as historical records; this remediation report will state which reviewed defects were closed.

Native Tauri resize/focus, credential saving and a real agent/model response were not verified in this remediation pass. The broader task remains in_progress rather than being archived with these acceptance gaps. This workspace has no Git repository, so no commit or push was performed.
