# Design: desktop pet frontend polish

Status: implementation authorized on 2026-09-08 by the user’s “开始执行”.

## Visual system

Use the approved white cat and V2 reference as the baseline. Warm-white surfaces, warm dark ink and restrained orange emphasis form one system across six existing views. Define a finite set of typography, spacing, radius, border, shadow, icon and interaction values. Content density follows purpose rather than literal reference scaling that produces unreadable text.

Capture one same-scale composition across all views before changing code. Preserve paw position/filter, cat artwork, continuous platform, footprint count and existing window dimensions. Reference imagery is design evidence; use real empty/runtime state for application acceptance.

## Responsibilities and affected paths

| Owner | Paths | Boundary |
| --- | --- | --- |
| Shared presentation | `ChatBubbleFrame.tsx/.css`, `ChatBubbleShell.tsx`, `pet-shell-geometry.ts` | Slots, header, decoration and compatible geometry; no service calls |
| Desktop composition | `App.tsx`, host rules in `styles.css`, `PetStage.tsx` | Native mode/size transitions, placement, click/drag and approved artwork |
| Chat interaction | `ChatPanel.tsx`, message/composer styles | Draft acceptance, IME, reading position, navigation and content rendering |
| Settings | `AssistantSettings.tsx/.css` with ChatPanel state | Visual fields/help only; original native save/credential contract remains |
| Tasks/reminders | `TodoList.tsx/.css`, `TodoReminders.tsx/.css` | Actual records, confirmed writes and bounded content slots |
| Verification | Existing `qa/`, `tools/`, task evidence | No fake native adapter, second demo service or seeded business data |

Native Rust changes are not assumed. If screen-edge/resize defects are reproduced, isolate the responsible path and document the additional scope before a repair. Do not replace working native timing guards with cosmetic sleeps.

## State and data contracts

- Service/native state remains authoritative. Chat connectivity, model configuration and device registration are distinct.
- The current compact accepted-send behavior expands the panel. Clear only the corresponding accepted draft; failure keeps input.
- Composition events must prevent candidate-confirmation Enter from submitting. Verify the actual WKWebView event sequence.
- Follow streaming output only while the user is following the latest content. Never steal scroll position while reading history.
- Settings URL sync depends on endpoint changes, not each status snapshot; endpoint replacement clears the draft credential. Keep native private-file storage and no credential logging/browser persistence.
- Preserve actual todo/reminder confirmation and error behavior. Styling must not fabricate successful writes.
- Static PNG status text is decoration; a redesigned live-status layer needs visual approval without changing cat pixels or duplicating the cat.

## Approved changes

Use the five decisions in PRD as one explicit review: return destinations, disabled placeholder visibility, safe structured messages, return-to-latest affordance, and the static/live status treatment. These behavior changes were approved as part of the complete execution plan.

Structured rendering uses react-markdown 10.1.0 and remark-gfm 4.0.1 after dependency review. Disallow raw HTML/script execution; preserve message identity/text and safe link behavior. Verify code overflow, text selection, copy feedback and streaming partial syntax.

## Accessibility, motion and layout

Provide readable text contrast, visible focus and meaningful disabled/loading/error states. Keep control dimensions stable when borders/focus appear. Reduce nonessential transforms and animations under reduced motion. Use transform/opacity for short transitions without forcing layout each frame.

Preserve fixed desktop geometry initially, while content supports long text, narrow containers and simultaneous reminder/error content through bounded scrolling. Verify wallpaper contrast and the actual native transparent hit area separately from browser layout.

## Migration and rollback

1. Record baseline source/assets/geometry and visible behavior.
2. Apply coherent changes by responsibility; shared frame and host geometry each have one writer at a time.
3. Maintain explicit-tail, dock, standalone and multi-instance compatibility.
4. Review each stage, then record local commits and evidence. Do not inherit prior local passes as final acceptance.
5. Roll back only task-owned changes to the recorded stage commit; preserve unrelated parallel tasks and private configuration.

## Implemented visual values

Body #493b31 at 14px/1.7; secondary #796959 at 12px; links #8b4c2d; warm-white #fffdfa; separator #eadfd4. Existing compact geometry remains fixed. Rendering dependency rationale: [official react-markdown documentation](https://github.com/remarkjs/react-markdown) supports React component rendering without raw HTML; this implementation additionally disables remote image requests and validates outgoing links.
