# Desktop companion product refactor

## Goal and authority
Fulfil the complete user objective in objective.md across all desktop pet surfaces and states. Improve visual/interaction/motion/layout/performance/accessibility/maintenance while preserving all existing business capabilities.
User explicitly authorized direct implementation and autonomous product choices, and subsequently approved task creation and continued execution. Do not add repeated skill-level approval stops for settled choices.

## Product decisions
- Approved white cat remains the single character. Preserve source assets and transparent dual-window architecture.
- Retain warm cream/cocoa identity, refine to quiet commercial desktop UI. No rainbow chips, overshoot, decorative dashboards, duplicate pets or technical jargon.
- All functions remain accessible, with compatible business APIs.
- Review admin separately as an internal operator surface; fix material reliability/accessibility issues without forcing a pet dock.
- No fabricated product data/mock backend. Real empty/unavailable states remain honest. Isolated test inputs are not runtime evidence.
- Preserve 4 pre-existing scrollbar CSS edits.
- Native/DPI/model evidence is limited to actually inspected configurations.

## Requirements and acceptance
| ID | Requirement | Required evidence |
| --- | --- | --- |
| R1 | Pet central, single character, attached shell, open/close/switch/drag reactions | Composed native observations and asset/source checks |
| R2 | Unified visuals and every control state | Tokens/docs and actual screenshots across surfaces |
| R3 | Unified purposeful motion, reduced motion and cleanup | Runtime transitions, frame behavior, transform/opacity inspection |
| R4 | Native placement, edge fitting, drag/focus and minimal navigation | Pure geometry tests and native interaction |
| R5 | Pet, chat/history/tools, todos, settings, status, shortcuts and secondary/empty/loading/error states | Complete inventory matched to current rendered build |
| R6 | 1080p/2K/HiDPI/small windows/long content/language lengths | Declared layout matrices, actual host display evidence; untested hardware remains outstanding |
| R7 | Cohesive components/tokens with bounded responsibilities | Source review, typecheck/build and focused behavior tests |
| R8 | Avoid whole-history work per token, bounded initial DOM, timer/listener cleanup | Focused tests and measured runtime/performance evidence |
| R9 | Keyboard/focus/Escape/Enter/IME/tooltips/aria/contrast/targets | Regressions and actual keyboard observations |
| R10 | Implement all areas, then integrated review/fix | Working-tree changes and review matrix |
| R11 | Preserve APIs/core functions and safe async behavior | Existing/focused tests plus real environment flows |
| R12 | Final product UI/UX/performance review resolves material issues | Independent review with current screenshots and full requirement audit |

## Baseline gaps (before refactor)
Compact history has no direct entry and whole projection/feed reprocesses on tokens (ChatPanel:302,366,411; App:113). Settings model results race (AssistantSettings:42). Todo refresh discards edits, Escape bubbles, delete fades before result (TodoList:45,224,336). Native placement lacks work-area fitting and dimensions are duplicated (lib.rs:304; App:38; styles:1142). See research/audit.md.

## Boundaries
No replacement model service, new multi-session API, protocol redesign, production deployment or third-party asset/code import. No narrowing objective to one page or color changes. Completion requires objective.md.


## Approved experience revision — 2026-09-26
The user approved all recommendations in the latest user-perspective evaluation. Preserve the white cat identity while allowing its surrounding composition to change. Petting stays on the desktop; chatting has a separate labelled entrance. Repair real native opening, provide persistent size/pinning preferences and reversible hide/tray recovery, and support short conversation without forced expansion. Preserve history, tools, drafts, business data and backend contracts. These requirements supersede prior complete-PNG and attached-disk restrictions. The accepted implementation and acceptance contract is `companion-experience-design.md`; there are no outstanding product-approval questions.

## Approved local context optimization — 2026-09-29
The user authorized implementing local mode first. `local-context-optimization-2026-09-29.md` defines the current Rust/SQLite scope: estimated input budget, complete turns, source-linked incremental summaries and bounded original-history retrieval. Keep original records and existing business behavior; verify with the saved real local model and distinguish isolated tests from live evidence. This slice does not complete the wider companion objective.
