# Companion product design
Operate-mode warm companion. Preserve approved cat, transparent dual windows and recognizable cream/cocoa. Root tokens own typography, spacing, radius, semantic states, shadow, z-order and motion. Lucide icons, one primary accent, consistent controls and readable local feedback.
Single dimension-driven attached shell, not a generic card holding a pet. Header owns drag, concise status and nearby actions. Body/composer fit available height. Secondary views return in place. Escape exits innermost editor, then secondary view, then chat.
Motion uses shared 120/180/240ms durations with a 160ms exit, transform/opacity and exponential easing without overshoot. No animation per token/history remount or native resize per frame. Reduced motion eliminates spatial movement. Subtle pet response uses original approved imagery.

## Ownership
- Shell/pet: App.tsx, PetStage/PetLiveStatus, frame/shell/geometry/morph, native layout, drag and pet state/rendering. Extract desktop host CSS and coordinate removal with main.
- Conversation: ChatPanel, feed/row/tool/composer, MessageContent, reading/presentation helpers/CSS/tests. Export stable projection helper for App owner, preserve UiMessage compatibility.
- Utilities: TodoList/Reminders/Settings, time labels/presentation/CSS/tests. Coordinate save/Escape with conversation.
- Main: global tokens/CSS, product/design artifacts, native QA, admin audit, integration/review.

## Contracts and implementation
AgentView generation/revision fencing, request_id retries, acknowledgement/IME protections, reminders CAS and secure native storage remain.
Native cat backing and layering invariant; change chat backing only at safe preparation/work-area boundaries, never during animation frames. Pure geometry derives available space and attachment/hit regions; test negative origins and scales.
Conversation: run-indexed tools, stable unchanged message references/memoization, recent-history window plus earlier-history access with scroll anchoring. Historical failure/interruption explicit; no auto repeat of tools.
Settings: config-specific request fencing, locked saves, visible saved vs connected results.
Todos: preserve drafts during refresh, visible pending writes, focus recovery and inline delete protection.

## Validation
Use existing real services/data or honest unavailable states; no new fake business records. Source-owned current .app for native inspection. Classify unit/static/runtime evidence and record host display. Preserve initial dirty patch.


## Current approved experience architecture — 2026-09-26
`companion-experience-design.md` owns the updated composition, two-window geometry, native preference/event contract and file ownership. This explicit user-approved revision replaces the attached cream-platform presentation and pet-click-to-chat behavior while preserving character identity and business APIs. Native cold-opening must work independently of model availability.
