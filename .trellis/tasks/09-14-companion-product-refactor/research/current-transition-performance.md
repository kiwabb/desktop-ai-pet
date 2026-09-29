# Current compact → expanded performance review

Read-only source review, 2026-09-15. Inspected `useFrameMorph`, `ChatBubbleFrame`, `ConversationFeed`, their immediate reading/shell/Markdown dependencies and relevant CSS. No source edits, test runs, builds, UI actions, model calls or runtime configuration changes.

## Recorded evidence

Raw file: `output/companion-review/runtime-motion/armed-recovery-d524534f1d68/result.json`; PID47142, request `armed-4022d94b4eff41bf`, phase-v5, chat, normal/none, reducedMotion=false.

| Same-document interval | Recorded duration |
| --- | ---: |
| Route52538 → layout-effect52649 | 111ms |
| layout-effect52649 → morph-created52675 | 26ms |
| created52675 → settled52811 | 136ms |
| start52815 → natural end/cleanup53070 | 255ms |

The report contains46 RAF callbacks, including the full258ms interval52811→53069 and subsequent242ms interval53069→53311. It records natural completion, no watchdog/no-paint fallback and `stillMorphing=false`. These are window-level timing observations, **not function profiles or compositor measurements**. In particular, `layout-effect` is marked after the bounding-rect read (`useFrameMorph.ts:74–82`), so neither the111ms preceding it nor the26ms following it isolates layout, React, cloning or filter cost.

## Two supported small improvements

1. **Avoid the full-prefix anchor scan on unchanged/append-only history.** `ConversationFeed.tsx:77` calls `messages.findIndex` on every feed render, then slices only the retained window at90. Compact→expanded changes parent props/callbacks (`ChatPanel.tsx:355–409`), so the non-memoized feed runs even when messages are unchanged. This is a demonstrable O(total preceding messages) lookup, not full Markdown rendering. Smallest repair: retain the prior start index with firstId; reuse it when `messages[index]?.id` still matches, falling back to findIndex only after displacement/removal, then preserve existing run-boundary widening/count expansion. Verify append, replacement/prepend, earlier-history access and session remount. No measured millisecond saving is established.

2. **Remove the duplicate follow-latest pass on activation.** On compact→expanded with following=true, `useChatReading.ts:62–74` calls `followLatest`; the later layout effect at87–100 calls it again because active changed. Each call reads scrollHeight, writes scroll position and reads scrollTop (`34–40`). Both execute in the activation commit without intervening application mutation; this is redundant synchronous viewport work, though a second forced layout is not proved. Smallest repair: give one commit effect ownership of following, retaining separate observer setup/history restoration and including the session boundary. Preserve the accepted-send intent guards, inactive deferred reveal, manual history reading and ResizeObserver handling. The initial size observation remains legitimate and should not be removed indiscriminately.

## Filter and geometry boundaries

- The destination SVG still has a two-drop-shadow filter (`ChatBubbleShell.tsx:40,59`). Morph relief removes root backdrop/shadow and paw/tail filters, **not** this SVG filter (`ChatBubbleFrame.css:573–579`); the detached ghost explicitly removes filter attributes (`useFrameMorph.ts:112–115`). This is a confirmed difference in filter coverage, not proof of per-frame rerasterization or the258ms gap's cause. The report's `shellFilter` was read after cleanup. Do not remove the approved settled shadow on this evidence alone; a transient live-shell relief change would require separate visual/performance acceptance.
- `isolatedClone` rewrites every attribute against every local ID (`useFrameMorph.ts:26–39`), including unchanged numeric/color attributes. These are detached-DOM writes, not repeated live layout. This bounded shell-only work is a secondary optimization candidate; the trace does not assign its cost. The frame's measured geometry/state update (`74–85`) is needed for atomic final perimeter/layout. `ChatBubbleFrame.tsx:118–143` installs its dimension observer once per integrated-mode change; its `flushSync` belongs to a native viewport resize, not an ordinary compact→expanded transition.

## Already fixed; do not reopen as current defects

History remains mounted across compact/expanded (`ChatPanel.tsx:377–409`), starts with40 messages plus run-boundary widening, and expands only through earlier-history access. Initial IDs are lazy, tools are indexed under useMemo, MessageRow and MessageContent are memoized (`ConversationFeed.tsx:34,69–90`; `MessageContent.tsx:55–57`). Stable projections reuse unchanged objects (`conversation-presentation.ts:18–35,48–68`); their full snapshot scans belong to AgentView processing, not the mode toggle itself. There is no current per-row full tool scan or whole-history Markdown reparse on expansion.

The integrated root already disables backdrop/shadow (`ChatBubbleFrame.css:421–430`); the ghost is filter-free. Morph uses transform/opacity with paired bounds, finite cleanup, no-paint recovery and duration-derived watchdog (`useFrameMorph.ts:141–237`). This particular raw report observed the healthy natural path; it does not demonstrate the new fallback or a smooth-cadence pass. Prioritize the two behavior-preserving redundant-work repairs above before broader visual/animation redesign.

## Authorized implementation boundary

The follow-up changes only `ConversationFeed.tsx`, `useChatReading.ts`, the existing ChatPanel history handlers and their existing tests/verifier. A same-file pure history resolver caches a start index validated by firstId, falls back after displacement/removal, and retains run-boundary/count widening. One commit effect owns following; activation retains observer setup and historical-position restoration, while accepted-reveal/prepend commits avoid a redundant old-position write. Session resets, both ACK/append orderings, user-intent cancellation and ResizeObserver remain covered. No CSS, native code, diagnostic protocol, API, runtime data or build/restart changes; no frame-time improvement is inferred from these checks.

An independent review confirmed a third source-level race: chat keydown invalidated pending-send reveal but left following enabled until onScroll. A content/size update dispatched in that interval still followed. The main session explicitly extended this implementation to the existing ChatPanel history handlers: effective upward keys/wheel pause following synchronously when history overflows, preserve the current top and invalidate accepted-send intent. Prevented/modified/editing key events and wheel zoom are excluded. Unchanged scroll events cannot resume following; actual downward movement back near bottom or explicit Return to latest can. No default browser action is prevented and no timer is added. Isolated lifecycle checks cover gesture → content/resize → unchanged scroll → upward scroll → return to bottom. This confirms the source behavior, not the cause of the separately reported native Page Up observation.
