# Research: Live conversation display refinement

- Query: Continue making the interface more beautiful and verify the appearance of real requests and replies; identify a coherent refinement for populated compact/expanded conversations.
- Scope: internal; ConversationFeed, MessageContent, ChatInteraction and their immediate state inputs. Research only, no production edits, backend changes, UI operations, detector rerun or seeded data.
- Date: 2026-09-29
- Evidence: **source-only assessment**, pending the main session's real native request/reply captures. The preceding installed offline refinement is context, not evidence of a real conversation.

## Findings

### Current authority and files found

| File | Responsibility |
| --- | --- |
| `PRODUCT.md` | Real AI companion; approved single white cat, warm cute surroundings and honest service state. |
| `DESIGN.md:70-120` | Cream/apricot/cocoa appearance, peach user bubbles, unboxed assistant prose, preserved author/time/tool/error ownership. |
| `.trellis/spec/frontend/companion-experience.md` | Compact 420×380, explicit expanded reading, frozen cat/native attachment, draft/reading preservation and evidence boundaries. |
| `.trellis/spec/frontend/quality-guidelines.md` | No fabricated product data; source/build evidence differs from native and model acceptance. |
| `src/components/ConversationFeed.tsx` | Per-message identity, timestamps, Markdown, waiting state, run-owned tool/result/error presentation. |
| `src/components/ChatInteraction.css` | Conversation geometry, user/assistant styling, status/tool/scroll controls and companion overrides. |
| `src/components/MessageContent.tsx` | Memoized Markdown/GFM, safe URLs, disabled remote images, fenced-code copy state. |
| `src/components/MessageContent.css` | Paragraphs, lists, headings, quotes, tables and code. |
| `src/components/ChatComposer.tsx` | Real streaming send guard, editable next draft and state-aware composer label. |
| `src/lib/conversation-presentation.ts` | Real run projection, terminal failures, announcements, bounded history. |
| `src/lib/tool-presentation.ts` | Honest tool status and plugin-owned result wording. |

The project already has the right foundation: conversation is a warm reading surface, not a stack of assistant cards. Do not replace it with a second cat/avatar, paw chips on every row, decorative status labels, bubbles around long assistant responses, gradients or new illustration. Native geometry/palette/artwork are outside this pass.

### Candidate 1 — Keep real activity visible at the reply itself (priority 1)

**Observed code:** `ConversationFeed.tsx:52-55` displays “橘伴正在想…” only when there is no text and no tool. Once the first token arrives, the message gets ordinary Markdown with no in-row distinction between partial and completed prose. `ChatComposer.tsx:113-115` still signals streaming, but that signal lives away from the text being read. `conversation-presentation.ts:25-29` already provides real `pending` and `runStatus` values; no timer or fake typing is needed.

**User effect:** A pause between chunks looks finished at the point of attention, while a read-only tool-only round can end its visible tool state before the model's final explanation arrives. The completed text layout should remain quiet, but unfinished output needs a stable status attached to that reply.

**Narrow refinement:** Add a small warm secondary “正在回复” label to the assistant metadata while its real run is pending and text exists. Keep the existing pre-text waiting state. When there is a real running tool, its own status remains authoritative; avoid claiming text generation during tool execution. Prefer one stable label in the metadata over a fake streaming cursor or per-token motion. Remove the label on terminal run state. Preserve the one existing polite announcement in `ChatPanel.tsx:517`; do not make each token a new live-region announcement.

**Acceptance:** Real native submission visibly shows the accepted request, pre-text wait (if observable), changing partial content, then completed content with the status gone. Actual tool progress, if invoked, belongs to the same run. Reduced motion produces no typing movement. Sending remains guarded and the next draft stays editable. A fast provider that finishes before capture proves only completion, not observed streaming.

### Candidate 2 — Group the question with its reply, give whole turns room (priority 2)

**Observed code:** Every companion message receives `margin-bottom:24px` regardless of role and size (`ChatInteraction.css:134`). User metadata sits below its peach bubble (`:139`); assistant metadata above unboxed prose (`:136-143`). Compact only changes list padding (`:132`), so it retains the full 24px separation plus both metadata rows and their gaps.

**User effect:** The compact conversation spends a disproportionate amount of its limited height between the question and the answer; the turn has no visual grouping beyond opposing alignment. This is a source-derived layout concern, not a measured native clipping claim.

**Narrow refinement:** Preserve role/time semantics and left/right placement. Tighten only the user-to-assistant gap (rough target 12–14px in compact, 16px expanded); retain roughly 22–24px between completed turns. Use current message/run ownership to avoid grouping unrelated messages; if using adjacency CSS, constrain it to the actual paired relationship rather than any preceding user row. Metadata should stay secondary at a readable 12px; the author can use semibold cocoa with a softer timestamp. Keep the existing peach bubble and its lower-right corner.

**Acceptance:** In compact, an ordinary short user request and the beginning of the reply can be read together without the request jumping away immediately. Expanded mode has clear turn boundaries without giant empty gutters. Long user requests still wrap safely; earlier-history loading keeps the paired run intact (`conversation-presentation.ts:historyStart`). Explicit expansion, scrolling up during streaming, close/reopen and returning to latest preserve user reading intent.

### Candidate 3 — Restore a useful Markdown reading hierarchy (priority 2)

**Observed code:** All six Markdown heading levels are forced to 15px/500 (`MessageContent.css:31-33`); inline strong is 600 (`:34`). Tables inherit the small label token (`:24`), and companion table headers use only 500 (`:40`). Prose is 14px/1.7 (`:30`). The body and emphasis are coherent, but heading and tabular hierarchy is flatter than the content structure.

**User effect:** A real organized answer cannot communicate its section structure well, and compact tables look closer to utility metadata than answer content. Enlarging everything would consume the window; selective hierarchy is the correct lever.

**Narrow refinement:** Keep 14px prose. Use a restrained two-step heading scale: about 16px/600 for top-level sections in expanded mode, 15px/600 for compact and subordinate headings, with more space before than after. Keep h4–h6 modest rather than introducing web-article display type. Use 13px minimum table text, semibold column headers and a very pale warm header surface. Give lists/quotes consistent paragraph rhythm; preserve the current fine 1px quote edge. Code remains monospace and naturally scrolls within its own block. No syntax highlighting library or remote font is needed.

**Acceptance:** A real model answer containing headings, numbered/bulleted lists and a small table renders with a readable hierarchy in expanded and compact. Long code lines/tables scroll within their blocks; neither shifts the frame width nor creates a page-wide horizontal scrollbar. Links retain underline/focus and safe URL handling; raw HTML and remote images remain blocked. Keep content unchanged between streaming and completion, and preserve per-message memoization.

### Candidate 4 — Make tool output supporting evidence rather than another conversation bubble (priority 3, confirm against real tool output first)

**Observed code:** Each tool becomes a filled 16px-radius block, with 14px summary prose and 12px heading/status (`ChatInteraction.css:146-151`). `ConversationFeed.tsx:22-31` already has correct error/uncertainty semantics and collapses a long result into a details element. This is functionally sound. Multiple tool blocks could dominate a compact answer, but no real native tool run has been inspected in this research pass.

**Narrow refinement if the live state warrants it:** Keep a compact aligned icon/name/status row and existing exact result text. Tone supporting surface/spacing down slightly, keeping the warm inset and readable status contrast. Group tools tightly under the reply, without adding a separate outer card. Do not hide real failed or unconfirmed results, turn every result into success, change the 140-character disclosure semantics without need, or add automatic retries. Existing Escape closes details and returns focus (`ConversationFeed.tsx:24-30`); retain it.

**Acceptance:** A real read-only request such as inspecting existing Todo/Memo data displays actual tool progress and its actual result, including a genuine empty list where applicable. Expand/collapse and Escape work without closing the panel. If the model does not invoke a tool, this item remains source-only; do not manufacture a tool run.

## Recommended implementation batch

Prioritize candidates 1–3 as one bounded conversation-focused change. Candidate 4 is conditional on a real tool result being visually excessive. Ownership can stay within `ConversationFeed.tsx`, `ChatInteraction.css` and `MessageContent.css`; no `App`, native window, persistent settings or backend changes are required for this direction. Do not revisit offline copy or the approved cat/frame in this pass.

Source behavior contracts already present and to preserve:

- `ConversationFeed.tsx:35-45`: entrance occurs once on mount, not per token.
- `ConversationFeed.tsx:74-95`: bounded history retains its first visible message.
- `conversation-presentation.ts:16-35`: stable view-model identities avoid re-parsing old Markdown for each token.
- `MessageContent.tsx:22-32`: copying a changing code block does not falsely retain “copied”.
- `MessageContent.tsx:45-56`: safe links, disabled remote image loads, HTML skipped, GFM renderer.
- `ChatPanel.tsx:548-553`: reading hook owns scroll intent and return-to-latest affordance.
- `ChatComposer.tsx:38,95-115`: send guarded while streaming; next draft editable; IME handling retained.
- `conversation-presentation.ts:94-101`: real empty, failed and interrupted terminal states do not become fabricated successful text.

## Live acceptance contract for the main session

1. Use the existing saved endpoint/model and real app session. A service health response or configured flag is not inference proof.
2. Through the actual native composer, send one short benign request; record the exact real user message, accepted send, assistant run, provider/model chain and completed text without exposing secrets.
3. Send one structured-answer request to exercise real Markdown. Capture compact and expanded native layout, preserving content and the draft across explicit size changes.
4. Observe partial content while the real request is still running to establish streaming; if the provider is too fast, report that state as unobserved rather than inserting delays or fake content.
5. If a tool flow is part of the batch, request a harmless read of existing data. Capture actual tool state and result. No write/create/delete tool operation is required by this visual task.
6. Keep any current user draft intact. Clear only researcher-entered unsent test text. Do not alter or remove historical records merely to clean a screenshot.
7. Read long content above the bottom during updates, then use “回到最新”; test explicit expansion/collapse and reopen. Capture the cat and panel together from the exact new installed bundle.
8. Record static checks, native UI behavior and model/tool evidence separately. One coherent post-edit native pass, one material correction batch at most, and a final confirmation.

## Related specs and design references

- `.trellis/workflow.md`: research persists under the active task; implementation/check roles remain separate.
- `.trellis/spec/frontend/companion-experience.md`: current approved companion contract and native evidence matrix.
- `.trellis/spec/frontend/quality-guidelines.md`: real-data and runtime verification boundaries.
- `.agents/skills/impeccable/SKILL.md`, `reference/polish.md`, `reference/craft-floor.md`: preserve the committed world, refine the whole path, prioritize true state/legibility and perform bounded rendered checks. The main session has already run context/detection today; neither was rerun here. Existing desktop platform/frontmatter drift is not repaired in this pass.
- Memory historical guidance: `MEMORY.md:439-440` says use the saved model service first and verify real calls; `MEMORY.md:986-987` preserves the approved white cat. These were treated as continuity constraints and checked against current PRODUCT/spec authority, not as current runtime facts.

## External references (docs, versions)

None consulted. This is a local application-specific design review and does not make external API/version claims. Existing renderer imports React Markdown and remark-gfm; their exact versions were not needed or changed.

## Caveats / Not Found

- No screenshot supplied to this researcher yet. All findings above are source-only until a real native populated conversation is inspected.
- No model, server or tool execution was performed by this researcher. This document must not be cited as proof that actual requests, streaming or replies work.
- Compact visual budget and multiple-tool density are hypotheses grounded in current CSS, not measured native defects.
- `src/components/ChatPanel.css` does not exist; the relevant conversation styling is `ChatInteraction.css`, imported by ChatPanel.
- No production code, specs, task manifests, Git state or external data were changed.

## Native short-reply review — 14:08 capture

- Capture inspected directly: `/var/folders/ys/cjf2rbtd03lg_fclhtmcmgn80000gn/T/codex-shot-2026-09-29_14-08-51.png`.
- The main session reports this as the actual installed native app, a real request through the restored original provider, with waiting observed before the first content. This researcher directly verified the **rendered screenshot**, not the network/provider trace. It is not fixture evidence.
- Visible content: an assistant reply at 14:08, with an introductory sentence and three numbered suggestions, open in the compact cream panel beside the approved cat.

### What the screenshot establishes

The cream surface, cocoa text, peach/apricot navigation and the cat already share a coherent visual identity. The outer frame/corner/relationship should remain frozen. The assistant reply is legible and does not need another bubble or illustration to feel friendly.

The visible prose hierarchy is flat: the introductory sentence and three numbered entries are almost equal in weight and color. The assistant author and time share the same visual row and similar weight. At the top of the scrolled reading region, only the preceding user message's timestamp remains visible; that is a real current composition, but a bottom-aligned scroll position can legitimately clip older content, so it is not independently proof of a scroll defect. It does make the cost of detached metadata and fixed row gaps apparent in this small viewport.

The visible OS input/cursor indicators over the composer and any image of the UI behind the actual foreground windows are not product decoration and must not be “fixed” in CSS.

### Final three refinements for implementation

1. **A more connected conversation rhythm.** Pair the peach request and unboxed answer more tightly. Bring the user's timestamp closer to the bubble with a smaller internal gap; use approximately 12–14px between the paired question and assistant in compact while retaining clear space between turns. Keep the assistant author at 12px semibold cocoa and time at 12px regular muted brown, with stable baseline alignment. Do not remove timestamps, overlap messages or force a single-line request. This improves actual conversational warmth through grouping rather than added decoration.
2. **A more crafted reading surface.** Keep assistant prose unboxed and 14px. Use semantic two-level headings, slightly stronger warm-apricot list markers (`::marker`, no fake numbered badges), consistent paragraph/list rhythm and readable 13px table text with a pale warm header. Preserve natural left alignment and the soft peach request bubble. The screenshot supports the prose/list refinement; heading/table/code acceptance still needs the forthcoming real structured reply.
3. **A reply-attached real progress cue.** During a genuinely pending reply, keep a small secondary status by its author once text exists, with a distinct true running-tool state if applicable. Keep the existing pre-text waiting presentation. No simulated token reveal, decorative blinking caret, per-token entrance or success claim. The screenshot only shows completion; the main session's waiting observation and a later observed partial reply establish activity separately.

Tool-card redesign is not part of this final primary batch because this screenshot contains no tool result. Its correct status and disclosure behavior remain preserved, and any later tool adjustment needs a real visual cause.

## Native long-reply review — 14:10 capture (final research pass)

- Capture inspected directly: `/var/folders/ys/cjf2rbtd03lg_fclhtmcmgn80000gn/T/codex-shot-2026-09-29_14-10-31.png`.
- Main-session runtime observation: at 14:09 the actual reply initially showed its first heading and a partial paragraph ending in “大”, then visibly grew into a completed response containing two headings, list, quote and table. This is reported evidence of **incremental text in the native app**, separate from the final screenshot. This researcher did not replay the request or independently inspect the provider trace.
- Direct visual evidence: expanded reading shows a real section heading, paragraphs, a three-column table and concluding prose. The table's first-column five-character labels wrap after four characters (“按项目分 / 类”, “按用途分 / 类”, “桌面清空 / 法”). The body stays inside the native panel. The screenshot is a scrolled position, so absence of the top section in this frame is not a missing-render claim.

### Concrete table finding and implementation constraint

The current auto table allocation sacrifices the short identifying labels to the two verbose columns. A table that makes “按项目分类” occupy two lines is visibly unfinished at this expanded size, and the dense equal-weight grid dominates the gentle reading surface. The heading is identifiable, but its scale contrast with the prose is modest. These observations confirm candidate 3 and do not justify a new assistant-card design.

- Give short table labels a readable minimum column width; preserve ordinary wrapping in description cells. Do not globally force every cell to nowrap.
- Combine 13px table text and semibold headers with a pale warm header surface. Use subtler separators so information hierarchy, rather than grid density, leads the eye.
- Keep table overflow local: at compact width, horizontal scrolling inside the table is preferable to splitting short labels into isolated final characters or widening the entire conversation. The code-block overflow contract remains unchanged.
- Preserve real prose, semantic heading/list/quote structure and safe Markdown rendering. No line clamp or truncated answer to manufacture a tidy capture.

### Final direction confirmed

Proceed with the three priorities recorded above: connected question/reply rhythm, crafted Markdown hierarchy including the confirmed table fix, and a truthful reply-attached pending cue. The warmth comes from the approved palette, soft request bubble, typography and spacing; no extra cat, avatar, illustration, per-reply assistant card or replacement theme is needed. No further research or screenshot loop is required before this implementation batch.
