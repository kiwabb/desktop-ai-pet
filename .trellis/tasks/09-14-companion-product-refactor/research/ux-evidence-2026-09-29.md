# Research: Companion UI detector and source evidence (Assessment B)

- Query: Independently assess the current desktop companion UI with one bounded Impeccable detector run and inspect source applicability, without influencing Assessment A.
- Scope: internal; primary target `src/components/ChatPanel.tsx`, direct companion UI components and their imported styles.
- Date: 2026-09-29
- Evidence class: deterministic static scan plus source inspection. No real model call, data mutation, fixture/demo generation, native interaction, browser overlay, or runtime acceptance was performed by Assessment B.
- Independence: Assessment A output was neither read nor requested. This report was prepared before any findings were sent to the parent; the parent release gate controls synthesis.

## Findings

### Detector run and exact counts

Exactly one detector invocation ran:

```sh
.agents/skills/impeccable/scripts/impeccable detect --json src/components
```

The stdout was preserved unchanged as `research/ux-detector-2026-09-29.json`. Exit code **2** means findings, not a crash. The detector returned **142 findings across 10 files: 141 advisory and 1 warning**. No errors were reported. All findings belong to four design-system consistency rules; this is not a count of 142 user-visible defects.

| Rule | Count |
|---|---:|
| `design-system-color` | 70 |
| `design-system-radius` | 44 |
| `design-system-font-size` | 27 |
| `design-system-font` | 1 |

No finding has a `.tsx` path. Imported CSS and one geometry `.ts` file were followed by the detector from the component directory. The exact per-file rule locations are retained below and the raw JSON retains snippets, severity, and import provenance.

### Current surface vs legacy and false positives

1. **The sole warning is a confirmed false positive against the current product contract.** `ChatBubbleFrame.css:635` uses `SF Pro Rounded`; `DESIGN.md:100` explicitly specifies this rounded system stack. `DESIGN.md:17-33` frontmatter still describes the prior system stack, so the machine-readable contract diverges from the current prose. Do not remove the approved rounded font to silence the warning.
2. **Many current color, type, and radius advisories describe approved values.** Examples: selected navigation at `ChatInteraction.css:126` uses `#704021` / `#ffe4bf`, documented at `DESIGN.md:91,94`; selection fallback at `ChatBubbleFrame.css:645` uses `#ffe4bf`, documented at `DESIGN.md:96`; navigation 13px at `ChatInteraction.css:123`, title 15px at `ChatBubbleFrame.css:660`, and empty-state title 16px at `ChatInteraction.css:156` are specified at `DESIGN.md:100`. The composer 20px radius at `ChatInteraction.css:168` is explicit at `DESIGN.md:117`. Capsule radii follow `DESIGN.md:104,110` and the newer companion spec. These findings expose stale machine-readable design metadata, not a need to restore the rejected graphite styling.
3. **The scan includes legacy appearance styles.** Current application entry passes `appearance="companion"` at `src/App.tsx:725`. `ChatBubbleFrame.tsx:173,183-197` keeps legacy decorations behind appearance/attached conditions; `ChatBubbleFrame.css:466-513` contains legacy `.is-attached.is-integrated` rules. Base colors, shadows, title sizes, and header borders at `ChatBubbleFrame.css:53-101` are overridden by companion rules at `:600-660`. Those literal base declarations are not proof of current computed companion styling.
4. **Eleven findings belong to old pet presentation, outside the requested panel improvement.** `PetExpression.css` contributes 1; `PetLiveStatus.css` contributes 10. `PetStage.tsx:97-110` renders the companion raster separately, while `:113-127` mounts these legacy components only in `reference-closed` mode. The frozen current cat must not be changed because these styles appeared in a directory scan.
5. **Scope diagnostics, not an exhaustive cascade classification:** 56 findings have `.is-companion` literally on their source line; 9 have `.is-attached` or `.is-integrated` literally on their source line. Multiline selectors, shared styles, and inherited variables mean these figures cannot partition all 142 findings into active/inactive states. No computed-style or native rendering claim is made.
6. Remaining semantic error colors, scrollbar/code radii, and shared typography advisories are advisory consistency work, not confirmed visual defects. The report does not label all unclassified findings false positives. Do not repair DESIGN metadata or legacy styles as an incidental side effect of this scoped UI task.

### Concrete current-source issues worth carrying into synthesis

- **Six supporting text declarations are below the current 12px supporting-text contract.** `AssistantSettings.css:78` mode badge is 11px; `MemoList.css:71` draft indicator is 10px (still inherited by the companion override at `:127`); `MemoList.css:104` review chip is 11px; `TodoList.css:114` reminder chip is 11px; `TodoReminders.css:23,26` reminder heading/time are 11px. These are valid current-path detector leads. The contract is `DESIGN.md:100` and `.trellis/spec/frontend/companion-experience.md:37`. Native screenshots must determine actual perceptual impact; source alone does not prove that the user cannot read them. Consolidating these to 12px is a concrete, scope-compatible refinement.
- **Todo completion target has a source-level contract discrepancy.** `TodoList.css:30` defines 44×44; companion button minimums drop to 32px at `:98`, and companion completion explicitly becomes 44×40 at `:111`. `.trellis/spec/frontend/component-guidelines.md:308` retains a 44px completion hit-area requirement, while the newer general companion rule permits other controls at 32px. Preserve the specific 44px completion target unless the parent resolves a more recent explicit exemption. This issue was found through source inspection, not the four detector rules; native click difficulty was not demonstrated.

These are bounded source findings. Overall composition, hierarchy, visual warmth, clipping, and current runtime data are owned by the independent design assessment and parent native capture pass.

### Existing behavior and structure that refinements must preserve

- `ChatPanel.tsx:510-515`: stable named Chat/Todo/Memo navigation; composer belongs only to the chat page.
- `ChatPanel.tsx:352-380`: page intent fencing and current-page cancellation; changes must not introduce accidental duplicate navigation.
- `ChatPanel.tsx:466-469` and `ChatComposer.tsx:127-133`: quick prompts add to the draft; they do not send a model request.
- `ChatComposer.tsx:35-43,87-121`: actual status controls send availability; offline input remains editable, with one actionable connection notice, IME handling, and explicit shortcut text.
- `ChatPanel.tsx:145-153`: accepted-send acknowledgement clears only its own submitted draft and requests message visibility once.
- `ChatBubbleFrame.tsx:176-208`: invisible frames are inert; decorative old paw/disk rendering is appearance-gated; header, navigation, body, and footer have distinct ownership.
- `AssistantSettings.tsx:118-124`: saved connection state is presented separately from editable configuration; its labels must not imply unsaved input is connected.
- `TodoList.tsx:528-547`: loading, failed load, and retained-list refresh failures remain distinct. Do not create records to replace real empty/error states during QA.
- `MemoList.tsx:265`: retained unsent draft is explicitly represented by the draft indicator; any typography change must keep that state discoverable.

## Files found

| File | Description |
|---|---|
| `src/App.tsx` | Current native companion appearance entry |
| `src/components/ChatPanel.tsx` | Navigation, page commits, composer and conversation orchestration |
| `src/components/ChatComposer.tsx` | Draft/IME/availability and input controls |
| `src/components/ChatBubbleFrame.tsx` | Appearance, slots, frame semantics, decorative gates |
| `src/components/ChatBubbleFrame.css` | Shared legacy styling and current companion overrides |
| `src/components/ChatInteraction.css` | Messages, composer, prompts and companion navigation |
| `src/components/AssistantSettings.tsx` / `.css` | Saved state, editable settings and presentation |
| `src/components/TodoList.tsx` / `.css` | Todo state presentation, row controls and companion hit sizes |
| `src/components/MemoList.tsx` / `.css` | Inline draft presentation and memo typography |
| `src/components/TodoReminders.css` | Due reminder and sync-summary presentation |
| `src/components/PetStage.tsx` | Companion/legacy rendering boundary |
| `src/design-tokens.css:87-101` | Current cream/apricot/cocoa palette |
| `PRODUCT.md`, `DESIGN.md` | User-approved product constraints and visual contract; frontmatter mismatch noted |
| `.agents/skills/impeccable/reference/critique.md` | Assessment B and independence/overlay procedure |

## Related specs

- `.trellis/workflow.md`: persist research; follow task-local scope.
- `.trellis/spec/frontend/index.md`: current companion spec supersedes legacy attached geometry.
- `.trellis/spec/frontend/companion-experience.md:25-42`: current geometry, warm theme, typography, stable navigation and data truthfulness contracts.
- `.trellis/spec/frontend/companion-experience.md:73-82`: static/theme checks and native acceptance must be reported separately.
- `.trellis/spec/frontend/component-guidelines.md:283-308`: accessible actions and specific Todo completion target.
- Historical memory was used only to orient the evidence boundary. Current source/specs were freshly read; no old port, bundle, success result, or screenshot was treated as current.

## External references / versions

- No external research was necessary or performed for this bounded local-source assessment.
- Local Impeccable `SKILL.md` metadata version: **4.3.1**.
- `impeccable context --target src/components/ChatPanel.tsx` ran once and resolved `PRODUCT.md` and `DESIGN.md`, with no matching surface brief.
- Context reported platform value `desktop (Tauri / macOS first)` as unsupported and internally treated it as web. This is a tooling-context limitation, not permission to start a browser demo or replace the native validation path. It was not repaired.

## Browser / native evidence boundary

- Target: actual Tauri WKWebView, no live browser URL supplied.
- The dispatch establishes that available CUA has no arbitrary mutable evaluation/script injection. Therefore mutable-title/script preflight and detector injection cannot be executed on this target through that tool surface.
- **Overlay unavailable.** No browser console findings, overlay screenshot, or user-visible overlay is claimed.
- **No live-server started.** No backend, preview, mock/demo service, fresh browser tab, or fixture dataset was created.
- Native screenshots and current native interactions are owned by the parent, per dispatch. This assessment did not view or borrow Assessment A output and did not present static source inspection as runtime proof.
- No process cleanup is required because none was started. Raw detector JSON and this report are deliberate research artifacts, not temporary demo artifacts.

## Caveats / Not Found

- Ignore list: `.impeccable/critique/ignore.md` does not exist; nothing was silently suppressed.
- Target slug: `src-components-chatpanel-tsx`, produced by `critique-storage slug`.
- Exactly one detector scan; subsequent JSON parsing only summarized its unchanged saved output.
- No full build, compile, type check, test suite, data mutation, or git operation was performed.
- A terminal glob for a non-existent `src/Desktop*.tsx` returned no matches; the narrow route trace was completed with `rg` over actual `src` TSX files. No source was changed.
- Scan output contains no generic anti-pattern, keyboard, live contrast, geometry, or end-to-end state findings. Its four consistency rules do not establish usability, real streaming, tool execution, refresh recovery, or layout acceptance.
- Parent should cite only native observations it actually performs; no mock or runtime data was created by this assessment.

## Appendix: complete detector rule locations

Repeated line numbers below represent distinct values on one source line. See the raw JSON for exact values and import chains.

### `src/components/AssistantSettings.css` — 11 findings

- `design-system-color`: 36, 54
- `design-system-font-size`: 78, 81, 86, 87
- `design-system-radius`: 77, 78, 88, 92, 97

### `src/components/ChatBubbleFrame.css` — 60 findings

- `design-system-color`: 53, 58, 58, 58, 94, 101, 127, 132, 133, 163, 163, 163, 171, 172, 173, 174, 174, 194, 197, 242, 269, 277, 277, 277, 288, 342, 367, 368, 369, 372, 388, 470, 476, 479, 490, 491, 492, 496, 506, 506, 645
- `design-system-font`: 635
- `design-system-font-size`: 101, 152, 243, 372, 467, 474, 590, 591, 660
- `design-system-radius`: 272, 326, 326, 361, 380, 481, 513, 648, 678

### `src/components/ChatInteraction.css` — 21 findings

- `design-system-color`: 46, 103, 103, 126, 126, 160, 174, 176
- `design-system-font-size`: 123, 156
- `design-system-radius`: 123, 141, 143, 154, 154, 159, 165, 168, 174, 178, 180

### `src/components/MemoList.css` — 13 findings

- `design-system-color`: 27, 41, 41
- `design-system-font-size`: 71, 104, 109, 110
- `design-system-radius`: 77, 84, 92, 104, 112, 127

### `src/components/MessageContent.css` — 5 findings

- `design-system-color`: 15
- `design-system-font-size`: 33
- `design-system-radius`: 15, 36, 38

### `src/components/PetExpression.css` — 1 findings

- `design-system-color`: 11

### `src/components/PetLiveStatus.css` — 10 findings

- `design-system-color`: 17, 18, 18, 27, 30, 31, 32, 47
- `design-system-font-size`: 41, 48

### `src/components/TodoList.css` — 15 findings

- `design-system-color`: 21, 39, 39, 44, 62
- `design-system-font-size`: 114, 123, 124
- `design-system-radius`: 97, 100, 101, 112, 114, 119, 126

### `src/components/TodoReminders.css` — 5 findings

- `design-system-font-size`: 23, 26
- `design-system-radius`: 24, 28, 42

### `src/components/pet-shell-geometry.ts` — 1 findings

- `design-system-color`: 47

