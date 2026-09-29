# Native real-conversation acceptance — 2026-09-29

## Evidence classification

Actual native CUA interaction and composed desktop captures are runtime evidence. Provider metadata in `live-service-plan-2026-09-29.md` and `live-chat-final-provider-2026-09-29.md` is separate real database/provider evidence. Focused tests use isolated component/hook inputs and are not presented as model output. No seeded history, substitute service/database or mock response was added to the native app.

The original saved server configuration and original service persistence were restored. Three actual chat requests have completed so far; they intentionally remain in conversation history and had zero tool calls. Existing September7–15 history visible during inspection is not evidence of a new request.

## First updated candidate

- Exact bundle: `src-tauri/target/debug/bundle/macos/橘伴.app`.
- Native process PID65305 resolved to that bundle.
- Executable SHA256: `74fcea0e1601d66950a271cab0186551467fee10d917f7f8c177d8a04710c585`.
- `pnpm tauri build --debug --bundles app` succeeded; build log `/tmp/companion-livechat-build-20260929.log`. Vite reports the existing chunk-size warning.
- Current visual components passed34 focused tests; TypeScript and scoped whitespace checks passed. Frozen14-path manifest matches. These are static/package checks, separate from runtime below.

## Genuine request and stream

Prompt began `请陪我安排一个轻松的午后` and asked for headings, steps, a quote and a three-column comparison. CUA submitted the actual native composer at14:19. Saved provider run is `95fa90aa-1c92-41d1-8e57-8a4fd0e2c252`.

Observed sequence:

1. Acceptance cleared the draft; waiting dots and the actual pending state appeared. Send stayed disabled while the next draft remained editable.
2. Explicit expansion during generation showed the assistant header `正在回复…` with an incomplete first numbered paragraph. Subsequent AX observations contained additional genuinely arriving text, including an incomplete table and later the third heading.
3. After `回到最新`, keyboard PageUp moved the reading region to the second section while the third section was still arriving. At completion, the visible second-section text remained in place; the status cue disappeared and the composer returned to its idle wording.
4. `回到最新` then reached the actual final blessing. No simulated typing or artificial delay was introduced.
5. Expanded actual table displayed all three columns, intact short first-column labels, quiet horizontal rules and a warm header. The source remained semantic table content.

Provider independently records one successful gpt-5.6-luna call,30.837s model duration,3.541s first visible text from model-call start,7,425 input/1,570 output tokens,1,479 message.delta events,2,004 assistant characters and zero tool calls. The model produced more than the requested approximate1,000 characters; do not claim exact requested length.

## Corrective finding

While reading the14:19 reply in expanded mode, collapsing landed in the previous14:09 reply. The reading hook retains absolute scrollTop while earlier messages reflow. The hook/ChatPanel/morph files were byte-identical to the pass baseline; this is an existing gap exposed by actual long content, not attributed to the new presentation changes. A bounded corrective batch now adds semantic content anchoring across explicit size changes.

Waiting also repeated the same words in both header and body. The correction keeps one visible textual state plus the existing genuine dots.

An AX snapshot temporarily omitted body/composer while screenshots still showed them. A later tool state-change notice was followed by a refreshed full tree; actual `a` input succeeded and was removed without sending. This does not prove a stuck inert/morph state, and no native/morph patch is authorized from it.

## Corrected candidate and remaining table gate

Candidate `195a04588c013e589929d0cd39e236cac1a6fbaacf92d1e4f3fef5690ad8a6d1` built successfully from the correction and ran as PID67837 from the exact candidate bundle. Focused checks expanded to46 Vitest tests plus the real reading-handler verifier using synthetic geometry. Independent read-only correction review found no blocking source issue. All14 frozen hashes still matched.

- A fourth actual request (`休息好了，陪我重新开始吧。简短回应，不调用工具。`) showed one waiting phrase with genuine dots, then `欢迎回来。我们慢慢开始，先做最简单的一件事。` and no remaining pending cue. It was accepted at14:32:02.593; metadata is in `live-chat-final-short-provider-2026-09-29.json`. The model succeeded, took10.095s, first visible provider text9.474s from model-call start,8,920 input/20 output tokens,16 deltas and zero tools. This single slow response is not a general latency benchmark.
- Expanded→compact retained the current long reply's table row/header instead of jumping to the earlier reply. Returning to expanded restored the same table/header. This was an actual native round trip over the persisted2,004-character reply, not a unit geometry claim.
- Closing and reopening restored the actual long reply and14:32 short reply. The short response's persisted provider run is `69c908f2-497d-43db-a2b0-4880e98ddb94`.
- Expanded table composition saved as `live-chat-expanded-table-2026-09-29.png`. It includes the real cat and desktop backdrop; the small panel image behind the cat belongs to the Codex conversation screenshot, not an extra pet window.
- Compact table focus was independently confirmed after close/reopen with fresh full AX (`回复中的表格`). ArrowRight still did not visibly pan clipped content. The missing-subtree observations are not used to establish this defect. A final narrow explicit local arrow handler is being added; no additional provider request is needed because provider/pending/reading paths are unchanged by this table-only fix.

## Final installed result

The last narrow patch adds explicit guarded horizontal arrow handling to the focused table scroller. The chat interaction verifier passed with both directions, clamped ends, child-target/focus/modifier/composition/default-prevented/no-overflow guards; Markdown SSR checks passed3/3. Final package build succeeded (`/tmp/companion-livechat-table-build-20260929.log`). No provider, pending, appearance or reading-anchor path changed in this final table-only patch.

Actual native compact-table verification on the final package:

- CUA clicked the real persisted table and AX identified the focused `回复中的表格` region.
- Right moved the table content: the first column became partially clipped on the left while the previously clipped rightmost phrases became fully visible. Left restored the complete first-column labels. The frame, composer and vertical position remained stationary.
- Returned to latest and quit the candidate before installation. No additional model request was sent merely to exercise this key handler.

Installed `/Applications/橘伴.app` executable SHA256 is `3b27d2fbe88f7b987c6eea9a8a16800d569c2fc10f438411093922622d1eac61`. Process PID69465 resolved to `/Applications/橘伴.app/Contents/MacOS/desktop-ai-pet`; its hash matched the tested final bundle. The previous installed executable `e06f92fd1569e783459f2fe9a33c68b651788198cad23374c0e0a16d7570ba56` was preserved at `/Users/zhoujiaangyao/Library/Application Support/desktop-ai-pet/app-backups/20260929-144238/橘伴.app`.

Installed launch/open reloaded the real14:19 long reply and14:32 short reply, with completed state and an editable empty composer. Final composed capture `live-chat-installed-2026-09-29.png` shows the actual installed cat and compact response together. Desktop icons, pointer feedback and the gray macOS input indicator in the capture are external system/background UI, not pet components. All14 frozen cat/paw/native-geometry/asset hashes match the pass baseline.

Installation metadata: `live-chat-install-2026-09-29.json`. Four real model requests total were made across this pass, each independently confirmed completed with provider usage and zero tools. The original API and dependency containers remain available with saved configuration unchanged. Exact latency varies; the final short provider call took10.095s, so this report does not claim fast inference.

This scoped pass covers genuine send/wait/partial/complete, upward-reading preservation, semantic resize anchoring, formatted output, local table keyboard pan and reopen/installed restoration. It does not close the larger task's untested failure/retry, business-tool writes, tray or multi-display acceptance gates. Unit geometry remains synthetic evidence, separate from the native observations above. No blanket commit, task archive, history cleanup or model configuration change was performed.
