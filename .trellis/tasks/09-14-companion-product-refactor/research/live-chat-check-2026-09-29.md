# Live conversation presentation review — 2026-09-29

## Scope and evidence

Reviewed only the source delta against the snapshot named in `/tmp/companion-livechat-baseline-20260929.txt`, under the current `live-chat-polish-2026-09-29.md` brief. The six changed files are ConversationFeed TSX/tests, MessageContent TSX/CSS/tests, and ChatInteraction.css. Existing unrelated dirty work was not reviewed or altered.

This review is static/source and isolated-test evidence. The main session owns the real provider requests, native interaction, packaging and installation. The checker made no model calls, opened no UI and created no runtime fixture or business record.

## Findings (fixed)

None. No production changes were needed.

## Findings (not fixed)

No blocking or non-blocking code defect was found in this scoped delta. Native table overflow, horizontal keyboard scrolling and the final visual rhythm still require the main session's planned native acceptance; source review does not establish their rendered result.

The new presentation contracts should be recorded by the main session in the companion/component spec: run-owned pending metadata, adjacent same-run question/reply grouping and a labelled keyboard-focusable local table scroller. This is documentation follow-through, not an unresolved implementation defect.

## Reviewed contracts

- `projectConversationMessages` derives `pending` exclusively from assistant runs in `queued` or `running`. MessageRow uses that existing projection, so completed/failed/interrupted snapshots remove the new header cue. Active tool wording only reads tools indexed to the same run. A completed tool does not falsely complete a still-pending assistant response. Existing terminal outcomes remain intact.
- The waiting cue remains visible before text, and the header cue remains after partial text arrives. No artificial delay, token reveal or extra live region was added. Existing typing dots retain reduced-motion suppression; the new header text has no animation.
- Question/reply spacing is reduced only for an adjacent user→assistant pair with the same nonempty run ID. Message keys, memoization, cached history boundaries, tool index reuse and mount-only entrance cleanup remain unchanged.
- ChatPanel, ChatComposer, useChatReading and conversation-presentation are byte-identical to the baseline. Send acknowledgement, draft/IME guards, latest-following, history restoration and navigation ownership were not changed by this batch.
- The table remains a semantic table with the GFM cell alignment preserved. Its wrapper has a Chinese accessible name, `role="region"`, `tabIndex={0}`, local horizontal overflow and a visible inset focus outline. The outer message/grid sizing retains `min-width: 0`. Cell minimum widths preserve useful labels while allowing long cell text to wrap.
- Markdown raw HTML remains disabled; unsafe links remain text and model image URLs do not load. Code copying still reads the preformatted text, preserves failure feedback, and invalidates copied state when streaming changes the source. Those handlers were not modified.
- Companion prose remains 14px, tables 13px, and metadata/progress 12px. Heading sizes vary by level and compact state without changing content. No avatar, assistant card, cat artwork or palette replacement was introduced.
- Calculated from the actual companion token pairs: metadata/progress on cream **4.86:1**; body/author on cream **7.91:1**; table heading on warm header **7.33:1**; marker/link on cream **4.92:1**. The existing warm focus outline on cream is **4.22:1**. These are static contrast ratios, not a native visual test.

## Verification

- **Lint:** no lint script or ESLint configuration is defined, as documented in frontend quality-guidelines.md. Scoped whitespace checks passed for the existing changed files; the added test file was inspected directly.
- **TypeCheck:** `pnpm exec tsc -b` passed, exit 0.
- **Tests:** implementer/main reported **34/34 passing** focused cases in ConversationFeed, MessageContent and conversation-presentation. The checker inspected the changed tests and their assertions. They were not rerun unchanged; no fix or new untested branch was found requiring another run. These are isolated test inputs, not runtime data or provider evidence.
- **Frozen scope:** all **14** entries in the current frozen manifest matched their SHA-256 values. Cat/artwork, paw, companion attachment and native host contracts remain unchanged.
- **Package/native:** intentionally not repeated by the checker. Main session owns the single integrated package and the actual pending→partial→complete, compact/expanded, reading and reopen acceptance.

Source review is clear for the planned package/native pass; it does not complete the broader companion refactor's outstanding acceptance matrix.
