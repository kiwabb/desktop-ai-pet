# Visual refinement native acceptance — 2026-09-26

## Scope and evidence
User: “方向感觉没问题 但是美观度需要大大提升”. This is a visual refinement of the approved companion direction. No native/backend/data behavior was rewritten. Prior broad task acceptance remains separate.

Evidence classes:
- Real native runtime: current locally built Tauri/WKWebView app, then exact installed bundle. Configured service http://127.0.0.1:18081 remained offline; no model invocation, fake messages, seeded records or substitute service.
- Static/unit: independent source review, CSS parsing/contrast checks, 22 existing component tests and focused sprite/interaction checks. These do not establish real streaming or populated list behavior.
- Generated artwork: built-in image_gen edited the approved idle portrait to naturally closed eyes. 1207×1303 canvas/pose inspected; source RGB requires the existing luminance matte. Prompt embedded in PNG and recorded in asset provenance.

## Changes delivered
- Companion palette uses warm white #fffefd, graphite #353734 and muted #6d716b; quiet navigation groups replace fragmented outlines. System type,14px/500 titles,14px body,12px controls.
- Compact panel408×332 within unchanged720×680 backing,16px corners,14–18px spacing,32px minimum action targets and shared soft elevation. One coherent language across conversation, Todo, Memo and settings.
- Pet actions sit near the paws as a light group. Persistent visible resting label removed; wake ARIA and real errors retained.
- One predecoded sprite source switches idle/sleeping through the same mask. Companion vector eye patches removed; original/legacy assets preserved.
- One correction batch after native observation compacted error-only reminder bands (about94px to54px combined single-line height), removed their unwanted independent scrollbars, and aligned semantic Memo select height/appearance with its input.

## Actual observed flow
First native batch:
- Cat artwork and new action strip visible; menu rest sustained natural closed eyes. Click woke the same cat with local response and no duplicate outline/checkerboard.
- Compact open focused the composer. A keystroke sent in the same automation batch as open arrived before focus and was not entered; after the open/focus observation, a real keystroke entered without clicking the input. Chinese text was pasted as an unsent draft, not sent to a model.
- Draft survived explicit reading expansion, Todo/Memo/settings navigation and return, compact collapse, close and reopen. Test draft cleared before installation.
- Real offline states stayed visible; send disabled. Expanded pages remained navigable. No populated-data/model claims.
-80%,100%,120% pet sizes were viewed in the real native app; no clipping or overlap. Preference restored and read back as scale1.0/alwaysOnToptrue.

Final installed confirmation:
- Opened installed app, opened compact chat, entered Memo, inspected both final correction targets: narrower complete offline notice rows, no inner reminder scrollbars,40px select matching title input. Returned to clean compact conversation with no draft.
- Composed desktop capture includes both windows, shows cat on the right and compact panel on the left without overlap. Capture: `/var/folders/ys/cjf2rbtd03lg_fclhtmcmgn80000gn/T/codex-shot-2026-09-26_13-15-48.png`. It includes narrow incidental background, so not published as a standalone user artifact.
- CG on-screen window listing: cat232×340 at(1235,565),level5; chat backing720×680 at(503,225),level4. Installed PID50047. This proves this display/composition only, not the entire original display/accessibility matrix.

## Verification and install
- Independent report: `research/visual-refinement-check-2026-09-26.md`.
-22 existing ChatPanel/ConversationFeed/AssistantSettings tests passed; targeted companion interaction/sprite decode/failure/disposal/blink cleanup checks passed. CSS parse/diff and new text/focus contrast checks passed.
- Initial coherent build and one correction build passed TypeScript,Vite,Tauri packaging. Logs: `/tmp/companion-visual-refinement-build-20260926.log` and `/tmp/companion-visual-refinement-final-build-20260926.log`. Existing >500kB chunk warning remains; no build failure.
- Asset provenance scan:3 rasters,0 missing embedded prompt metadata.

Installed: `/Applications/橘伴.app`. Exact source/installed executable SHA256: `a69e191b04278d99f32e72fd91328f2fd8f8fde45c68f6a10992d7e9065dcade`.
Previous installed version preserved at `/Users/zhoujiaangyao/Library/Application Support/desktop-ai-pet/app-backups/20260926-131505/橘伴.app`.

## Boundaries
Configured service unavailable: no current model-stream/tool execution verification. Tray click automation and the original broad task matrix remain as previously recorded, not retried or claimed complete. No blanket commit/archive because extensive pre-existing overlapping work is retained. Visual pass complete; larger task stays in_progress.
