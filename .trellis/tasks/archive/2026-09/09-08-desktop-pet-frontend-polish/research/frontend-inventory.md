# Research: frontend polish inventory

- Query: Inventory the current desktop-pet views, visual consistency and interaction risks to support a plan-only frontend polish phase.
- Scope: internal, read-only source inspection; no product edits, builds, service launches or runtime tests
- Date: 2026-09-08

## Findings

### Current view inventory

| Surface | Current responsibility / behavior | Source anchors |
| --- | --- | --- |
| Closed pet | Approved composite image; click/keyboard opens panel; pointer drag moves native window; context menu; image includes baked decorative status bubble | `src/App.tsx:443`; `src/components/PetStage.tsx:96-140,146-201`; `src/styles.css:95-118` |
| Compact | Shared shell/paw/disk; title + connection subtitle; todo/settings/always-on-top indicator/close; one-line composer, disabled attachment/voice controls, four quick prompts | `src/components/ChatPanel.tsx:205-283`; `src/components/ChatBubbleFrame.tsx`; `src/components/ChatBubbleFrame.css` |
| Expanded chat | Shared header; scrollable messages with avatars/author/time; plain content string; pending spinner; tool result cards; footer composer; explicit empty/unconfigured states | `src/components/ChatPanel.tsx:285-353`; `src/styles.css` message/composer rules |
| Settings | Independent `AssistantSettings` body; left connection form, right status/guide/security cards, warm footer; real AgentView state; reveal credential; save-only native action | `src/components/AssistantSettings.tsx:20-79`; `src/components/AssistantSettings.css:4-67`; `src/components/ChatPanel.tsx:133-141,289` |
| Todo list | Scrollable task rows, completion/restoration, created time, manual refresh, reminder editor, loading/empty/error states and confirmed-write guards | `src/components/TodoList.tsx:25-220`; `src/components/TodoList.css:1-149` |
| Reminder strip | First due reminder with pending-count summary; complete/snooze10min; backend-confirmed disappearance; explicit write/sync errors; bounded scroll slot above every expanded page | `src/components/TodoReminders.tsx:13-81`; `src/components/TodoReminders.css:2-17`; `src/components/ChatPanel.tsx:285-288` |
| Native transition | Closed232×380.9, compact713×401, expanded940×760; shared bottom-right native anchor; React hide/inert/premount/paint guard; reminders auto-expand | `src-tauri/src/lib.rs:60-68,281-350`; `src/App.tsx:170-200,202-280` |

The expanded shell content slots are now shared by chat/settings/todo. Preserve the approved white-cat asset, existing corner-paw position/shadow, one integrated disk, and current native footprint as plan constraints. Reuse prior `reference-v2-shell.md`, `reference-v2-cat-base-bounds.md`, and `settings-reference-v2.md`; do not reopen geometric/style selection already approved.

### Confirmed source-level gaps and inconsistencies

1. **Chinese IME send protection is absent.** The composer submits on Enter without checking composition state (`ChatPanel.tsx:247-251`). Plan a concrete acceptance rule: confirming a candidate must never send; Enter sends only after composition completes; Shift+Enter inserts newline. Actual WKWebView event sequence remains runtime verification.
2. **Every message update forces smooth scroll to the bottom.** `ChatPanel.tsx:73-76` has no near-bottom/user-reading guard. This can take the reader away from older messages during streaming. Plan scroll-follow only when already following the latest response, with a quiet return-to-latest control if needed.
3. **Return navigation semantics differ.** Settings “返回对话” calls `onExpandedChange(false)` (`ChatPanel.tsx:177-185`), while todo “返回聊天” keeps expanded mode (`189-192`). The settings control also still uses a settings icon when its label means back (`219-221`). Plan one explicit return rule/icon treatment for secondary pages.
4. **Advanced-looking composer controls are disabled.** Attachment and microphone are permanent disabled placeholders with “即将支持” titles (`ChatPanel.tsx:255-261`). They visibly occupy space without a working flow. Decide intentionally whether to retain subtle disabled affordances or remove them from the primary composer; do not imply implementation of these features as visual polish.
5. **Message body is plain text only.** `ChatPanel.tsx:326-329` renders content directly, so Markdown/code/list answers lack semantic presentation. Whether to add safe structured rendering is a planned feature decision, not an existing capability. Long tokens/code readability needs browser acceptance if chosen.
6. **Density differs across secondary pages.** Settings facts/purpose captions use10px and several body lines11px (`AssistantSettings.css:40,52-57`), while todo/reminders use15px task titles and12px metadata (`TodoList.css:81,90`; `TodoReminders.css:9-10`). Plan a shared readable hierarchy with explicit minimum sizes rather than shrinking text to fit reference proportions.
7. **Status decoration and live state are separate.** App selects `reference-closed` unconditionally (`App.tsx:443`); that PNG embeds its visible “在线中 · 随时待命” status decoration, whereas header/settings use real `connectionLabel`. This is a confirmed static-versus-live distinction. Preserve the approved asset; do not claim its decorative text represents a verified connection. Any proposed dynamic status treatment must be separately designed without altering the cat's visible artwork.
8. **Only the first reminder is actionable.** `TodoReminders.tsx:74-79` shows the first item and “还有N项待处理”; no direct chooser is present. Completion/snooze advances through confirmed state updates. Plan whether sequential handling is adequate and make the pending count understandable; do not assert more reminders are inaccessible, since todos provide another surface.

### Risks requiring browser or native verification

- **Window changes:** anchor drift, one-frame flash, stale backing image, cursor hit region, clipped shadow/paw/disk and double base must be checked in native closed→compact→expanded→closed transitions, including repeated clicks and drag during transitions. Existing guard code is evidence of implementation, not proof of flawless runtime.
- **Screen edges / multiple displays:** native resizing preserves bottom-right anchor; the inspected function does not visibly clamp expanded bounds to the current work area. Verify top/left screen edges, display scale changes and multi-monitor coordinate conversion before promising on-screen containment.
- **Scroll competition:** reminder strip takes up to46% of content height (`TodoReminders.css:5`) above independently scrolling messages/todos/settings. Verify long reminder + long error + settings inputs at once; keyboard focus and save buttons must remain reachable.
- **Focus recovery:** composer is focused on show/window focus (`ChatPanel.tsx:94-117`). On settings/todo that ref is absent; verify focus moves to an appropriate heading/control on navigation, returns predictably, and native reactivation does not displace an active editor.
- **Save state continuity:** save disables the submit button but leaves fields/reveal/help interactive (`AssistantSettings.tsx:37-55`); parent save then clears secret and closes settings. Verify rapid edits during save, failure retention and service replacement. Avoid altering credential semantics solely to simplify visuals.
- **Streaming/connection states:** confirm submitted draft clears only after accepted request, pending rows/tool updates remain visible, failure has a useful recovery path, and disconnect/model-unconfigured/device-offline text stays distinct. No real model was invoked in this research.
- **Accessibility:** current icons are mostly Lucide and many targets are44px; verify all header targets, focus outline, contrast, keyboard-only navigation, live-region noise during streaming, and reduced motion. Do not infer compliance from presence of aria labels alone.
- **Realistic content:** check empty states, long task/model/endpoint/message strings, many tasks, localized times, and multiline errors using real available data or explicitly authorized fixtures. Never silently seed tasks, responses or connection results.

### Proposed plan ordering and acceptance boundaries

1. Lock visual invariants and create a single inventory of typography, spacing, card/border/shadow, action states and status semantics across existing surfaces. No new product pages or native size redesign by default.
2. Prioritize readable hierarchy and navigation/IME/scroll behavior before decorative motion. Treat any attachment/voice or Markdown support as explicit scoped decisions.
3. Polish compact and expanded chat, then settings/todo/reminder density, then shared feedback/motion/focus. Keep existing real backend contracts and confirmed-write behavior.
4. Verify the full view transition matrix in browser for layout/interactions, then native for window/anchor/hit-testing; separately verify real service/model paths only when actually exercised. Capture representative states without fabricating data.

### Related specs

- `.trellis/spec/frontend/component-guidelines.md`: shared decoration versus host placement, existing icon rules, state ownership, native credential handling, approved cat/paw, no fake data.
- `.trellis/spec/frontend/quality-guidelines.md`: complete user-visible flow and evidence scope; build/source checks cannot substitute for runtime acceptance.
- Existing task research above: approved reference and disk/cat mapping; those decisions remain input constraints.

## Caveats / Not Found

- This document supports a plan only. No source/style edits, compilation, test execution, image changes, runtime service launches or screenshot sessions were performed.
- Confirmed items above describe what source currently does; severity and final UX choices require the main plan and targeted runtime evidence.
- No claim of “perfect” visual quality or complete accessibility/native/model correctness is made from this inventory.
