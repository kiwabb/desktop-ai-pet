# Approved companion experience revision — 2026-09-26

## Authority and boundary

After the latest native evaluation, the user explicitly approved all recommendations ("都按你建议的来"). This authorizes implementation now: preserve the white cat identity while reorganizing its surrounding artwork; petting and chatting become distinct actions; repair native opening, add hide/recovery/scale/pinning controls, and separate short conversation from longer reading. This approval supersedes the old complete-PNG/cream-platform/attached-shell restrictions where they conflict. Original assets and user data must remain intact.

This is the current in-progress task, not a new task or another approval gate. Existing unrelated memo, server and admin work is preserved. No provider replacement, fake business data, model-response fixtures, backend contract redesign, or blanket commits of the dirty tree.

## Outcome and visible flow

1. Cold launch shows a single recognizable white cat without the permanent poster card, platform, hearts or stars. Service disconnection must not prevent opening the tool panel or petting.
2. Clicking the cat produces a brief local pet response and stays on the desktop. Dragging does not trigger petting. A separately labelled `聊一会` action opens conversation and accepts immediate typing. Right-click/keyboard menu exposes actions.
3. Idle is quiet. A sustained resting state replaces random few-second naps; user interaction wakes the cat. Connection health belongs in conversation/settings, with an actionable failure at an attempted action. Do not pretend the model is connected.
4. Compact conversation supports sending and reading a short reply without automatically expanding. Explicit history/reading action opens the larger surface. Preserve real history, draft/selection, latest-following, tool activity and reminders.
5. Hide is reversible through an always-available menu-bar/tray entry. Reset, size presets, always-on-top and quit are discoverable. No global hotkey is required when the tray recovery path works. Visibility/scale updates must keep windows in the current display work area. Preferences persist, while startup must not strand the user with no recovery entry.
6. Settings, Todo and Memo remain accessible with clear navigation and a return path. Closing the panel returns to the same cat position.

## Chosen design direction

Code-led native companion, approved from the preceding concrete evaluation; do not restart a concept-selection or comp-approval round. Use the recognizable white longhair cat, warm restrained accents, system typography, quiet readable paper-like panels and Lucide controls. No attached ornamental disk, paw border, ribbon, permanent speech-card, decorative dashboard or duplicate pet. Panel controls have conventional geometry, clear focus and errors. Frontend consumers use a new independent `companion` frame appearance; preserve old shared/QA appearance variants unless intentionally retired with updated validation.

Only the cat moves during a local response; no whole-application breathing. Use restrained transform/opacity and reduced-motion behavior, with persistent resting rather than random spectacle. Canned pet reactions are local interaction feedback, never represented as a model answer.

## Cross-layer contract

- Preserve two independent transparent windows. A fixed main backing per selected size prevents chat transitions resizing the cat. Main base viewport is 232×340 CSS px; size presets are 0.8 / 1 / 1.2, applied only on an explicit preference change.
- Chat backing remains at most 720×680 CSS px and is clamped to work area. Compact content is at most 420×380, expanded content fills the available chat surface. No dedicated right column for a pet disk. Chat is placed beside the pet, with a 12px gap where the work area permits; prefer left, choose right when appropriate, clamp without moving the cat merely to open chat.
- Keep `set_pet_chat_mode`, `show_chat_window`, pointer-hit publishing and paired drag contracts compatible unless the native owner coordinates an explicit refinement. On main pet actions, do not require a hidden WebView to paint before it can receive an open request. Native window methods must not block the main event loop or call AppKit off its thread. Diagnose the actual opening failure; do not merely increase timeouts.
- New preferences: `get_companion_preferences() -> { scale: number, alwaysOnTop: boolean }`; `set_companion_preferences({ preferences: {scale, alwaysOnTop} })` returns the normalized same shape. Exact Tauri casing follows existing serde conventions. Allowed scale values: 0.8, 1, 1.2; invalid values reject. Native emits `companion:preferences-changed` with normalized preferences after commit.
- `hide_companion()` hides both windows; `show_companion()` restores the cat and clamps its position. Tray includes show/hide, size, pinning, reset, quit. Tray show must work after hiding; hidden chat remains closed. Preference writes are local and contain no credentials.
- Frontend pet menu can invoke these native commands and display a plain error on failure. Browser fallback may show a reversible local hidden state; it must not imply native tray verification.

## Ownership and implementation order

1. Native owner: `src-tauri/src/lib.rs`, `window_geometry.rs`, new native preferences module, `Cargo.toml`/lock, Tauri config/capabilities. Diagnose/fix opening, geometry and tray/preferences. No frontend edits; report any required App changes to frontend owner.
2. Companion frontend owner: `src/App.tsx`, `PetStage`, pet-only CSS/components/hooks, `desktop-shell.css`, companion types/tests and relevant pet verification tools. Integrate pet-only artwork at `/pets/white-cat-companion/idle.png`, labelled chat action, pet/idle behavior, menu/preferences, native event handshake. Coordinate shared frame props with panel owner.
3. Conversation owner: `ChatPanel`, `ChatBubbleFrame`, `ChatComposer`, `ConversationFeed`, chat-specific CSS/hooks/tests/verifiers. Independent panel appearance, compact latest conversation, explicit history, clear navigation, preserve utility features.
4. Coordinator: preserve/edit artwork using image tools; PRODUCT/DESIGN/token documentation, task/spec records, integration, native acceptance, scoped commit decision.

## Verification

Run targeted behavior tests for command readiness, preference validation/geometry, petting vs opening/drag, hide recovery, compact send/read, history/draft continuity and utility navigation. Compile once after integration; rebuild only after material corrections. No tests solely mirroring CSS literals.

Native acceptance uses the newly built real app and verifies its process path: cold open, local pet response without chat, labelled chat open/immediate typing, close/reopen, Todo/Memo/settings/back with actual empty/offline state, size changes, hide and tray recovery, and placement. Do not create records or invoke an unavailable model to fake completion. If the configured model is available, use an ordinary non-sensitive prompt only and verify real stream/reading; otherwise clearly record unavailable model verification. UI screenshots are per-window unless a composed screen is actually available.


## Visual refinement continuation — 2026-09-26

The user accepted this interaction direction and asked for a substantial beauty improvement. `visual-refinement-2026-09-26.md` refines the current appearance: compact content408×332, warm-white/graphite panels, lighter controls and naturally closed-eye art. Earlier larger maxima and presentation examples remain historical; native lifecycle/data contracts are unchanged.
