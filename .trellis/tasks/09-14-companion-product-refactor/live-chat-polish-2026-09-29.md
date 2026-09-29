# Real conversation polish — 2026-09-29

Mode: Operate / Read. User requests continued visual improvement and actual request/reply validation. This follows the offline panel pass; it must inspect real persisted messages and real generation rather than seed/demo data.

## Evidence and boundary

Original stopped Redis/model-proxy containers and the original pet API were restored using existing volumes/configuration. API startup applied existing additive migration009 (memos table + indexes, no seed or old-row changes). Saved server model remains gpt-5.6-luna at the existing proxy, revision2. Native UI reloaded original history; a short reply and a longer Markdown reply were requested from the actual native composer. Both completed. Native inspection observed waiting, partial response growth, final content and explicit expansion. Server trace/usage is recorded separately in research/live-service-plan-2026-09-29.md.

Frozen files/approved cat, paw, geometry, theme, small contour shadow and native lifecycle remain unchanged. Baseline: `/tmp/companion-livechat-baseline-20260929.txt`. Preserve prior offline improvements and all overlapping dirty work.

## Coherent changes

1. Tighten the visual association of question and answer. Keep user text in its soft peach bubble and the assistant on the open cream reading surface. Reduce user-to-assistant gaps and user timestamp separation, preserve larger separation between conversation turns. Assistant author and timestamp must have distinct weight/opacity without undersized text or poor contrast. No avatar, duplicate pet or decorative cards.
2. Restore a readable Markdown hierarchy: clear H1/H2/H3 sizing/weight, measured paragraph/list spacing, warm list markers, a restrained quote treatment. Tables need readable 13px text, a warm header, quiet row rules, minimum useful column widths, and local horizontal scrolling in compact mode instead of breaking short first-column labels into fragments. A focusable labelled overflow region is allowed if needed. Code copy/safe-link/remote-image protections remain intact.
3. Place a quiet, accurate running indicator in the current assistant message header throughout genuine `pending`. Before text, retain the existing waiting content; after the first text, the header must still signal work is ongoing. Completed/failed/interrupted messages never animate as running. Reduced motion removes spatial animation. No fake typewriter output or artificial reply delay.

## Ownership and acceptance

- Implementer owns ConversationFeed.tsx, ChatInteraction.css, MessageContent.tsx/.css and meaningful focused tests for changed state/semantics. Do not change ChatPanel send/read/history logic, ChatComposer, utility pages or backend/provider configuration.
- Main owns service/runtime actions, docs, package/install and composed native captures. Checker reviews only this baseline delta.
- Focused tests verify pending/terminal semantics and table accessibility/safety. One package build after source settles, one native pass and at most one coherent correction batch if material defects appear.
- Native after change: send one final real request for waiting/partial/final rendering, inspect compact/expanded and actual Markdown/table content, read upward without forced jumps, return to latest, and close/reopen persisted conversation. Real requests intentionally remain in history. No Todo/Memo mutations or mock/native fixtures.
- Verify provider run + usage + actual visible response as separate evidence. Do not equate a listening port, settings flag, unit tests or historical responses with a new successful model call.

## Source scope

This is current live conversation presentation only. No palette/geometry replacement, new chat sessions, history deletion, model changes, new services/databases or broad legacy CSS cleanup. Existing shared opening/earliest-synthetic-key timing is not attributed to this presentation pass.

## Bounded native correction after the first package

Candidate `74fcea0e1601d66950a271cab0186551467fee10d917f7f8c177d8a04710c585` completed a genuine third model request, showing waiting, partial, final and upward-reading protection. Native expanded→compact reading landed in the previous reply because the reading hook retains only absolute scrollTop while previous text reflows. Explorer confirmed this path is byte-identical to the pass baseline: it is an existing usability gap exposed by real long replies, not a claimed regression from the new styles.

One corrective batch is authorized: extend implementation ownership to `useChatReading.ts`, the narrow size-toggle integration in `ChatPanel.tsx`, and focused reading tests. Capture a visible paragraph/heading/list item/table-row anchor before explicit size changes and restore its relative reading position after commit. Preserve latest-follow, pending send intent, user scroll precedence, history prepend and session reset. No global height-ratio approximation, native lifecycle change or conversation remount. Also remove duplicate visible waiting wording now that the assistant metadata already carries the waiting cue; retain genuine dots and accurate accessibility without another live region.

An AX snapshot temporarily omitted the content subtree, but a refreshed observation and actual keyboard input succeeded. Do not call this a confirmed inert lock or change morph/native code on this evidence. Final package verification uses the existing real long reply for bidirectional resize/table/keyboard/reopen, plus one concise real prompt to recheck final waiting/complete rendering. No further broad polish batch is planned.

Final candidate195a0458 passed bidirectional real-table anchoring, real short request, one waiting phrase and close/reopen persistence. A narrow acceptance defect remained: the compact table had keyboard focus confirmed by fresh AX after reopen, but unmodified ArrowRight did not pan the clipped content. Complete the table-accessibility work with explicit local ArrowLeft/ArrowRight handling only for the focused overflowing scroller; preserve child controls, modifier shortcuts and vertical reading. Retest the actual table after the final package, without another provider request or broad visual pass.
