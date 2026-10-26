# Companion experience and native controls

## 1. Scope / Trigger

Current desktop contract, approved on 2026-09-26. This supersedes the old whole-PNG, attached platform, shared bottom-right chat anchor, and hidden-WebView-paint prerequisites in the legacy native/component specs. Keep their unrelated drag, focus, reading and evidence safeguards. Product authority is `PRODUCT.md`; visual authority is `DESIGN.md`. The accepted experience contract is `.trellis/tasks/09-14-companion-product-refactor/companion-experience-design.md`; current non-pet presentation requirements are in `warm-companion-theme-2026-09-26.md` in that task. The user explicitly rejected graphite tool styling and requires a cute/Q interface matching the cat colors; the prior interface brief retains behavior authority only. The user explicitly approved the pet, so its artwork/expression/motion are frozen during interface work.

## 2. Signatures

```ts
type CompanionPreferences = { scale: 0.8 | 1 | 1.2; alwaysOnTop: boolean }
type PanelViewport = {
  width: number; height: number; side: 'left' | 'right'
  petAnchor?: { x: number; y: number } | null
  tailReach?: number
}
invoke<CompanionPreferences>('get_companion_preferences')
invoke<CompanionPreferences>('set_companion_preferences', { preferences })
invoke<void>('hide_companion')
invoke<void>('show_companion')
invoke<PanelViewport>('set_pet_chat_mode', { mode: 'closed' | 'compact' | 'expanded' })
invoke<void>('show_chat_window')
```

Native events: `companion:preferences-changed` carries the preferences object; `companion:visibility-changed` carries a boolean; `companion:error` carries a user-facing string. Keep `pet-panel:request`, `pet-panel:reply`, `pet-panel:committed` and drag-session IPC compatible. `pet-panel:viewport-changed` carries the same viewport including `side` and `petAnchor`; command results and events share the same anchor validation path. Older/missing anchor payloads remain supported.

## 3. Contracts

- Main has a 232×340 CSS-pixel base, scaled only by explicit 80/100/120% preference changes. Chat backing is at most 720×680, clamped to the display work area. Compact content is at most 420×380 after the approved non-pet interface rework. Place chat beside the cat, left preferred and right when necessary. Native spacing pairs with the effective viewport corner reach R: left gap is -(8+R) and right gap is -(20+R). When linked, logical pet scale s gives R=44s on the left and60s on the right; narrow placements explicitly use R=0. This permits transparent backing overlap without moving the cat. Scale these at the existing native physical boundary; keep screen EDGE12 separate. Use the same side-specific spacing for width fitting and adjacency selection. `side` aligns compact content to the cat-facing edge. Opening/expanding chat must not move or resize the cat.
- `petAnchor` is the frozen raster nose/mouth point (530,390) projected into chat viewport logical coordinates. Source is1207×1303, pet motion inset is4px4px65px, SVG uses xMidYMax meet. Compute the meet scale within `(petWidth-8, petHeight-69)`, center the raster horizontally and align it to the box bottom, then add the logical pet-to-chat delta and4px inset. macOS window rectangles already use points; other platforms use the existing chat scale conversion. Return null for invalid/nonfinite geometry; never invent a browser anchor.
- A valid anchor uses16px paint safety gutters plus the native `tailReach` reservation. Hosts without reach metadata retain28px. Explicit zero means no corner and no extra reservation; it must not become the legacy28px fallback. Compact is at most420×380 and top is `clamp(anchorY-156,16,viewportHeight-frameHeight-16)`; expanded uses the remaining backing area. The rounded speech corner has48px base; its center stays at least48px clear of corners. Omit the corner for horizontal overlap, unusable height or out-of-range finite anchors, but preserve a nonzero native reservation that already determined the window's gap. Native width fitting, side choice and metadata share the320px useful-body threshold and zero-reach gap; frontend fit comparisons use the same1e-6 tolerance. If both sides have less than320px useful width, prefer a full empty area above/below the unchanged cat with an8px native gap and at least352×352 backing (320×320 body). Its reach is zero. If no such area exists, retain the screen-clamped readable fallback; physical space then cannot guarantee full cat separation. Preserve the real target across compact/expanded and the old no-anchor layout.
- Paint body and speech corner as ONE closed SVG silhouette behind content, with a continuous fine apricot edge and one restrained warm shadow (0px3px4px, about.10 alpha). The old rectangular body shadow plus separately painted10px bump was rejected. Never let a large shadow extend outside the native backing: CSS overflow cannot escape the window's drawing buffer. The16px safety space must contain the small shadow. Keep no-anchor fallback shadows small enough for their existing12px gutter.
- The silhouette is aria-hidden and pointer-events:none. Native hit bounds still come only from the actual content frame, not the decorative paint. Content and paint must share exact entrance origin coordinates. Republish frame bounds after position-only attachment changes, retaining visibility epochs and last-intent guards.
- Reveal the linked surface from its cat-facing origin in180ms, with no more than8px translation and.985 scale; reduced motion removes spatial changes. Never await entrance animation before native reveal, focus or acknowledgement. Preserve approved pet motion and native lifecycle; native spacing follows the current signed adjacency contract without resizing or moving the cat.
- Route AppKit work through the native asynchronous main-thread dispatcher. Prepare dimensions, commit the visible React layout, reveal the native chat, then measure the returned viewport and publish actual hit bounds/focus/acknowledgement. Hidden WKWebView paint is not a prerequisite for reveal. Acknowledgement means the command/UI contract completed, not that every frame was presented.
- On macOS 13+, companion panels also use `NSWindowCollectionBehavior::CanJoinAllApplications`. `CanJoinAllSpaces` plus `FullScreenAuxiliary` alone did not place either panel in another application's active full-screen Space on macOS 26.0.1. Keep ordinary floating levels (cat 5, chat 4) and the existing focus policy. Native acceptance must check current-Space/on-screen membership and a composed screenshot; an AX tree and off-screen window capture do not establish desktop visibility.
- Click, Enter and Space on the cat produce local pet feedback. Drag wakes without a pet click. `聊一会` opens the panel. Idle rests after 120 seconds, resting stays until interaction, and a manual rest action closes the eyes visibly. Local canned feedback must never masquerade as model output. Respect reduced motion.
- Render exactly one of `public/pets/white-cat-companion/idle.png` and `sleeping.png` through the matching `idle-mask.png` luminance SVG mask. Both are registered 1207×1303 RGB rasters with opaque checker backgrounds; standalone `<img>` is forbidden. Preload the sleeping raster before swapping sources. Natural closed-eye artwork replaces companion vector eyelid patches. Preserve the original `white-cat-v2` assets and legacy reference rendering. Sleep is shown by the eyes, without a persistent visible status label; preserve the accessible wake label and actual errors.
- Companion appearance uses scoped cream/apricot/cocoa tokens derived from the approved cat: rounded system type including PingFang SC, 15px semibold frame titles, 13px capsule navigation, 12px supporting/control text and 32px minimum action targets. Frame corners are24px and composer corners20px. Pair the pale `--companion-action` background with `--companion-action-ink` cocoa foreground; white text on pale apricot fails contrast. Use the same soft capsule language on the labelled pet chat action, header navigation, utilities and secondary menu trigger. The header identity reuses the user-preferred `ReferencePawBadge` filled cream/apricot shape at its125:139 aspect ratio, with3 toe pads and no square tile. Keep it decorative/aria-hidden; ordinary interface icons remain Lucide. No second cat illustration or oversized external legacy paw frame. Preserve pet geometry/motion, accurate offline/error state and visible keyboard focus.
- Navigation has stable Chat/Todo/Memo destinations: repeated selection of the current page is idempotent only when no different transition is pending. Selecting the visible page while another destination is queued cancels/supersedes that pending intent and restores the selected page/size; a late callback must not override the last user choice. Settings is a separate header action; Escape returns to its captured source page/size, while the explicit Chat destination returns to chat. Repeated settings activation must not overwrite the source. Size controls say expand/collapse reading, not history navigation. Keep existing page intent, return-expanded state, focus and draft selection ownership; do not remount the conversation to change its layout.
- Companion empty state never fabricates a message and does not duplicate the unavailable connection reason. The composer remains editable offline, states why sending is disabled and offers actionable settings. Its wording must not imply an available model while disconnected. Actual run errors stay attached to the run.
- Aggregate reminder synchronization failures into a compact summary with inspectable full details. Preserve actual due reminder cards/actions and per-item write failures. A presentation summary must not reinterpret a failed list load as an empty list.
- Memo creation is an explicit inline editor. Closing it/Escape retains the unsent draft and returns focus to its opener; Escape must not bubble to panel navigation/close while it handles an active editor. In-flight persistence and row edit/reminder/delete semantics retain their existing guards. Settings keeps actual saved connection status distinct from unsaved form values and saved-but-not-connected results.
- `ChatBubbleFrame appearance="companion"` uses an independent regular frame without the old external paw/disk. Short conversation retains actual messages, stream/tool/error states and scrolling without expanding on accepted send. Reading/history expansion is explicit. Draft, caret and tool navigation survive mode changes and close/reopen.
- Native preferences contain only scale and pinning, persisted to `companion-preferences.json` in app config through a same-directory temporary file and rename. Serialize changes. Defaults are 1 and true; startup opens the cat rather than persisting a stranded hidden state.
- Hiding requires an installed recovery tray. Hide both windows, invalidate pending show requests and return the chat to closed. Tray show restores/clamps the cat, keeping chat closed. Tray also exposes size, pinning, reset and quit. Menu callbacks dispatch asynchronous work; never synchronously exit while inside AppKit's nested menu callback.
- The macOS companion popup remains the actual native NSMenu and follows system menu appearance. Theme its trigger and browser fallback through companion CSS; do not replace the verified native menu lifecycle merely to recolor it.
- A frontend native popup owns its menu resources until `popup()` settles. Guard the entire create/popup/dispose lifecycle against reentry; repeated clicks do not close the active resource. Release it only after popup settles, including failure cleanup. Resource-table locking can deadlock inside the nested AppKit menu loop if another IPC closes the active resource.
- Commit native visible/hidden flags only after the corresponding fallible window operation succeeds. If hiding chat fails after main was hidden, restore main. Once preferences or visibility are committed, event/menu notification failure is reported separately and must not falsely reject an already successful operation. Open-to-open paint and hit-bound awaits must recheck the captured visibility epoch before notifying main; hide→show cannot authorize an older opening intent.
- Offline service state remains honest in conversation/settings. It must not prevent petting, opening the panel or accessing local navigation. Existing records/providers are preserved.
- An unavailable composer must not advertise an available Enter-to-send action or claim a nonempty saved draft when the input is empty. Retain an editable auto-growing draft field and one full known connection reason with its settings action.
- Utility load failures own nearby retry and connection-settings actions. Put the reason for disabled creation beside Add/Save, while preserving editable drafts. A settings excursion retains only the originating utility instance, hidden from layout/focus/accessibility, until return or configuration-generation reset. Reminder components stay mounted but hidden during settings so their pending actions/errors survive; current connection leads the settings page. Daily surfaces retain both synchronization error details and actionable reminders.
- Real conversation presentation pairs only an adjacent user/assistant message with the same nonempty run ID. Keep their gap smaller than the separation between turns, user time close to its peach bubble, and assistant author visually distinct from time. Assistant content stays on the open cream reading surface. A pending assistant retains an accurate metadata cue before and after its first text; terminal messages remove it. Do not add fake typing delays or another live region.
- Markdown preserves readable heading/list/quote hierarchy and safe links, remote-image handling and code copy. Tables retain semantic markup inside a labelled, keyboard-focusable local horizontal scroller; use 13px text and useful minimum column widths rather than fragmenting short labels to squeeze the table into compact mode. The whole panel must not overflow horizontally.
- In native WKWebView, focused table scrollers explicitly handle unmodified ArrowLeft/ArrowRight when overflowing. Scroll only that element, clamp to its horizontal range, and leave child controls, composition, modifier shortcuts and vertical navigation untouched. A focusable wrapper alone did not establish native keyboard panning; verify visible column movement in the actual app.
- Explicit compact/expanded changes preserve the visible reading block and its relative offset when the reader has paused above the latest message. Capture before reflow and restore after the size commit; absolute scrollTop or total-history-height ratios do not preserve position when earlier long replies wrap differently. Following readers continue at the latest content. New user scroll intent, session changes and removed anchors cancel stale restoration; retain accepted-send and history-prepend ownership.

## 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Scale is not exactly 0.8, 1 or 1.2, including nonfinite values | Reject before applying/persisting |
| Malformed preferences or unknown fields | Report load/validation failure, never overwrite silently |
| Applying or storing preferences fails | Reject with visible error; restore previous applied preferences where possible |
| No recovery tray | Reject hiding; leave a recovery path visible |
| Show races with hidden state | Reject stale show and settle closed |
| Native reveal/viewport/focus fails | Surface error, roll back prepared chat; do not send a success acknowledgement |
| Same-mode open request | Reactivate/focus without replacing draft, page or history |
| Missing display | Report native error; do not claim clamped placement |
| Missing/null/nonfinite petAnchor | Keep prior bottom-aligned placement; omit tail |
| Anchor inside the frame horizontally or outside useful backing height | Omit tail; never draw a connector into the panel |
| Anchor changes without frame resize | Republish actual frame hit bounds after layout; reject stale visibility work |
| Configured model unavailable | Show actual failure/offline state; no fabricated messages |

## 5. Good / Base / Bad Cases

- Good: pet the cat, open `聊一会`, type immediately, close/reopen with draft intact, navigate Todo/Memo/settings and back, hide from the menu and recover from the tray.
- Base: disconnected launch still shows the cat, local reactions and an operable panel with an honest unavailable state.
- Bad: touching the cat launches tools; every send expands; sleep is only a label over open eyes; hide leaves no recovery; a hidden paint wait prevents first open; a checkerboard is visible around the cat.

## 6. Tests Required

- Theme-only work: compare scoped source and frozen pet/art manifest against the turn baseline; verify text/action/hover contrast against actual paired tokens, the compact420×380 composition beside the cat and utility state presentation. Purely cosmetic changes do not need implementation-mirroring tests; recheck existing handlers if presentation edits affect markup ownership.
- Pet behavior: petting vs dragging vs explicit chat, sustained rest/wake, timer cleanup and activity transitions. For non-pet interface-only work, compare pet source/art and motion rules with the current approved baseline instead of changing them.
- Conversation: accepted send remains compact, actual messages remain visible, explicit reading change preserves draft/selection, utility navigation remains available offline; current-page navigation is idempotent, queued-destination cancellation obeys the last user choice, and explicit chat return retains the intended size. One composer connection notice retains the full known reason.
- Inline creation: Memo open/edit/close/reopen/Escape retains draft, returns focus appropriately and never creates records without submit. Test rendering/state logic separately from native interaction; no seeded data is required for this contract. Synchronization summaries retain both error details and do not suppress actionable reminders.
- Native geometry: both sides, edges, negative display origins, smaller work areas, resize only on explicit sizing and idempotent reopening. Check signed left/right spacing independently from screen EDGE12; projected visible fur and controls must stay clear of the body and speech tip at all three pet scales. Preferences validate presets/wire format/persistence and preserve defaults on a missing file.
- Panel attachment: test projection at80/100/120% with fixed CSS insets and negative origins; test left/right, top/bottom clamp, narrow overlap, invalid/missing anchors, compact/expanded target stability, the44px cat-facing body reservation and16px paint safety gutter. Compare frozen pet/paw/assets against the turn baseline. Actual native acceptance must show the cat and tail together, then exercise expansion, return and close/reopen with an unsent draft. Keep scale/display cases tested only by pure geometry distinct from live native coverage.
- Lifecycle: reveal precedes hidden viewport waits; cancellation and hide invalidate pending open; same-mode reactivation keeps command order and focus policy.
- Real native acceptance: exact new bundle/process, first open and immediate typing, close/reopen, local pet/rest/wake, utility routes, three sizes, pinning, hide/tray recovery, quit/relaunch. Record display coverage and unavailable model paths. Build/unit/AX evidence alone does not prove composed visual layout or real model streaming.

## 7. Wrong vs Correct

Wrong: wait for two animation frames in a hidden WKWebView, then reveal it; increase the timeout when it never opens.

Correct: prepare size/state, reveal the independently positioned native window, then verify its viewport, publish hit bounds, focus and acknowledge. Validate that immediate real keystrokes reach the intended input.

Wrong: restore the old disk/composite PNG because a legacy document says its pixels are immutable.

Correct: preserve the original files and recognizable cat identity while using the explicitly approved pet-only artwork and current independent panel contract.

### Design decision: cat-matched warmth is a product constraint

The user rejected the graphite/gray tool aesthetic after seeing it beside the accepted cat. Readability and tidy spacing alone do not satisfy this product. Keep cream surfaces, apricot controls, cocoa text and rounded forms across companion surfaces; do not reinterpret “cute/Q” as austere grayscale. Example: `background: var(--companion-action); color: var(--companion-action-ink)` for a primary action, with an independently checked readable hover pair. Native screenshots must show the cat and panel together, not only an isolated component.

Wrong: apply a large rectangular box-shadow to the body and draw a separate unshadowed corner in a12px native gutter.

Correct: draw one closed speech silhouette and reserve enough space inside the native backing for both its native-reported corner and the complete small shadow. Inspect the actual desktop composition for hard rectangular crops; DOM overflow alone is not evidence.


## Display refinement contract

### 1. Scope / Trigger

The approved display optimization changes companion presentation and the native
corner metadata. Keep the active custom pet, artwork, expressions, motion and
pet rectangle. The user declined creating a Trellis task; implementation and
acceptance stay scoped to this chat.

### 2. Signatures

`PanelViewport.tailReach?: number` is a CSS-pixel value produced by
`window_geometry::chat_tail_reach(pet, chat, chat_scale)` and serialized as
`tailReach`. Commands and `pet-panel:viewport-changed` use the same constructor.

### 3. Contracts

- Logical pet scale s = pet.width / (232 * coordinate scale). The corner reach
  is 44s for a panel on the left and 60s for one on the right. Pair its native
  gap with -(8+reach) / -(20+reach), scaled once at the native boundary.
- In ample space, body right on the left side remains pet.x-8*scale, and body
  left on the right side remains pet.right-4*scale. The cat never moves on open.
- Keep 16px paint gutters, a 48px corner base, minimum useful linked width320px,
  and the existing clamping/no-anchor behavior. Readable compact content is
  still at most420x380. Expanded width pays for the longer corner reservation.
- Native fit, adjacency and viewport metadata use the same effective reservation.
  A narrow backing returns explicit zero and also removes the inward reach from
  its native gap. Invalid finite anchors hide decoration without releasing a
  valid native reservation. If neither side supports320px body width, choose an
  available vertical area with at least352x352 backing and an8px cat gap; retain
  the existing readable clamped fallback only when no such area exists. A visible
  refit checks both fitted width and height before shrinking once.
- Compact connected composer has one input/send row. Header40px,
  navigation34px, one-line composer52px leave a252px reading slot at420x380;
  these are source budgets, not native measurement claims. Font14px and
  action targets32px remain minimums. Multiline drafts and real connection
  reasons can use additional height.
- Preserve keyboard guidance as an accessible input description. It is
  visually assistive in compact/offline states; expanded usable/streaming
  states show the relevant instruction. Offline must never promise sending.
- Companion soft surfaces mix45% chrome with the actual theme surface; user
  messages mix65% user color with surface. Tool cards have a further65% soft
  blend. Keep theme-selected navigation, text, action and material roles.
  Input boundaries use validated control color, with focus-color fallback.
- Legacy accent-only presets also derive control-line contrast of at least3:1
  across supported control surfaces and the actual45%-chrome composer mix.
  Keep their saved accent and theme schema unchanged; decorative line colors
  must not become the sole input boundary.
- A completed tool operation is execution success, not completion of a todo.
  Verified queries say 已查询, creations 已记录, and a todo completion says
  待办已完成 only when the returned item status is completed. Missing or
  malformed outcomes stay 结果待确认. Reminder dates retain a visible timezone.

### 4. Validation & Error Matrix

- Missing/nonfinite/negative reach: omit metadata and use legacy28px.
- Explicit zero: no decoration or extra reservation. Positive reach below8px
  or useful linked width below320px: omit decoration and reservation. Other
  invalid finite anchors/insufficient height hide only decoration when the
  supplied native reservation still fits; legacy hosts retain prior behavior.
- Missing anchor: retain old CSS placement, no fabricated browser anchor.
- Disconnected/unconfigured model: editable draft, one real connection notice,
  truthful disabled send; running request retains next-draft editing.
- A nonempty snapshot session ID represents a restored conversation, including
  a genuinely empty one. Server identity comes from a validated session snapshot;
  local identity comes only from successful durable recovery. Local read errors
  propagate with an empty/default snapshot and no active Store; never create a
  new session after a failed latest-session lookup or replace a failed history
  read with an empty snapshot carrying the previous ID. Before recovery, show
  restoring/unavailable content instead of greeting/quick prompts. Keep one
  recovery notice in the reading area and an editable composer. Same-generation
  reconnects retain snapshot identity and readable history. This source contract
  still requires matching native loading, recovery and failure acceptance.

### 5. Good / Base / Bad Cases

- Good: left100% reach44, right100% reach60, native body edges stationary.
- Base: older host omits reach and keeps the original28px geometry.
- Bad: changing only the native gap while leaving a28px corner pushes the
  readable body into fur; a longer SVG outside the backing is clipped.

### 6. Tests Required

- Rust pure geometry: both sides,80/100/120%, four display scales, screen-safe
  bounds, fixed body edges, negative display origins and drag/refit behavior.
- TS attachment: command/event metadata validation, legacy fallback, actual
  quadratic tip bounds, same world body across paired reach/backing changes,
  compact/expanded consistency and narrow/overlapping anchor fallback.
- Presentation: verified query/create/complete/error/uncertain states and
  explicit timezone in reminder output; composer description/disabled states.
- Real native acceptance: compare one-line reading height with baseline,
  actual chosen pet/theme and existing records; test opening, reading change,
  navigation/draft, real send/stream/tool request, sizes, edges and drag.
  Each delivery requires a fresh independent agent evaluating actual effects.
  A locked Mac, unit fixtures or a successful build cannot prove these.

### 7. Wrong vs Correct

Wrong: label a successful todo-list tool 已完成 next to a pending todo, or use
light decorative line color for an interactive input boundary.

Correct: say 已查询 / 待完成 with clear ownership, and use the contrast-validated
control boundary; preserve the truthful real result rather than creating data.
