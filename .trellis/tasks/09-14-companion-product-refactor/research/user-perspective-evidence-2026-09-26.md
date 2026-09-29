# Research: User-perspective desktop pet evidence — Assessment B

- Query: Independently review deterministic frontend findings and native desktop integration coverage from a user's perspective, without changing the product or operating the native UI.
- Scope: internal; `src/` deterministic scan and narrowly related `src-tauri` window implementation.
- Date: 2026-09-26
- Target: desktop pet surface, rooted at `src/App.tsx`; scan target `src`.
- Evidence class: current-source/static inspection. No native interaction, model execution, fixtures, screenshots, build, or tests were performed by Assessment B.
- Independence: Assessment B did not receive Assessment A findings. Findings remain withheld from the parent until it confirms Assessment A is complete.

## Findings

### Deterministic detector

Executed once:

```sh
.agents/skills/impeccable/scripts/impeccable detect --json src
```

Full, valid JSON is preserved in `user-perspective-detector-2026-09-26.json` beside this file. There are **72 findings, all advisory**:

| Rule | Count | Meaning |
| --- | ---: | --- |
| `design-system-color` | 60 | Literal colors not recognized by the DESIGN.md palette/sidecar detector. |
| `design-system-font-size` | 7 | Literal font sizes not recognized by its type ramp. |
| `design-system-radius` | 5 | Literal radii not recognized by its rounded scale. |

The detector reported no non-advisory findings. This is not an accessibility pass, contrast pass, or proof of runtime usability: its output for this target is design-system drift advice. Do not summarize it as “72 UX defects.”

| File | Count |
| --- | ---: |
| `src/components/AssistantSettings.css` | 1 |
| `src/components/ChatBubbleFrame.css` | 29 |
| `src/components/ChatInteraction.css` | 1 |
| `src/components/MemoList.css` | 2 |
| `src/components/MessageContent.css` | 2 |
| `src/components/PetExpression.css` | 1 |
| `src/components/PetLiveStatus.css` | 4 |
| `src/components/TodoList.css` | 3 |
| `src/components/pet-shell-geometry.ts` | 1 |
| `src/styles.css` | 28 |

### Verified false positives and applicability limits

1. **A reported 9px chat subtitle is not the current integrated subtitle.** `ChatBubbleFrame.css:152` defines a generic compact 9px subtitle, but the shipped attached/integrated compact selector sets it to 11px at `ChatBubbleFrame.css:472–475`. `App.tsx:620–622` selects the attached dock. Treat the base-rule finding as irrelevant to that current path, not proof of 9px chat text.
2. **Three font values fit the prose specification.** Findings at `ChatBubbleFrame.css:372` (18px), `:467` (20px), and `:590` (17px) fit the documented title range 16–18px and display range 20–21px at `DESIGN.md:150–156`. The machine-readable front matter has discrete steps; this is specification representation drift, not a demonstrated user problem.
3. **One radius belongs to invisible decoration.** The 32px value at `ChatBubbleFrame.css:326` applies to cat-ear pseudo-elements with `display: none` at `:320`. It does not establish an extra visible decoration or irregular current corner.
4. **Compatibility pet text is not the main desktop route.** The 8px status at `styles.css:202` and 9px fallback label at `:214` are rendered by `PetStage.tsx:111–121,180–184` only in `animated` mode. `App.tsx:650` pins the main route to `reference-closed`. Do not attribute these two sizes to the current cat.
5. **A repeated “undocumented” color is documented in prose.** `#a3653f` findings at `ChatBubbleFrame.css:277,367,490` correspond to the hover/active color named at `DESIGN.md:191`. The detector's palette recognition is narrower than the document's prose.
6. **Remaining color/radius advice needs user-visible context.** For example, `AssistantSettings.css:36` uses the stronger orange `#884423` for primary-button hover; `MessageContent.css:15` uses a 4px inline-code radius. These are maintenance consistency items; this scan does not establish a contrast failure, impaired action, or broken layout. Not every remaining color was classified as a false positive.

### Findings directly relevant to users

- **Desktop control is incomplete for an always-present companion (source-confirmed product gap).** The cat context menu has only “重置位置” and “退出橘伴” (`App.tsx:529–550`). Both native windows are always-on-top and omitted from the taskbar (`tauri.conf.json:22–28,37–43`); macOS uses accessory activation (`lib.rs:534`). The bounded source search found no tray icon, global show/hide shortcut, Reopen handler, or “hide pet” control. Users can close the chat while the cat remains, or fully quit; there is no implemented temporary-hide-and-recover user flow in the inspected desktop entry points. This matters more than palette advisories for someone trying to keep the companion running throughout work.
- **Settings are connection settings, not companion preferences (source-confirmed).** The visible settings view configures server/local mode and service/model credentials (`AssistantSettings.tsx:117–171`) and explains connection state (`:181–191`). No pet size, text size, pinning, or visibility setting was found in that view. Do not tell users they can customize these values through settings.
- **The visible cat-status detail really is 9px (source-confirmed reading concern).** `PetLiveStatus.css:46–56` uses 9px, a single line, ellipsis and clipping in the reference cat. This line carries useful text such as “连接已断开,” “模型待配置,” and “聊天可用 · 设备离线” (`pet-live-status.ts:21–32`). It is an explicit design exception (`DESIGN.md:156`), so it is not an accidental token violation; it still makes essential state harder to read than the 11px caption baseline. Its visual severity requires the parent's current native observation. Equivalent status is exposed as accessible text, so do not claim the status is wholly inaccessible.
- **Viewport adaptation exists, but scale is fixed (source-confirmed, runtime boundary retained).** The cat remains 232×380.9; chat prefers 940×760 and shrinks to work area with 12px margins. Native resizing is disabled in config. The compact actual panel is capped at 475×278 while reserving 210.7px for the pet dock (`desktop-shell.css:3–7,133–151`). A container rule wraps header actions below 430px (`ChatBubbleFrame.css:583–594`). This proves an implemented fit strategy, not successful readability at all display sizes. No user-controlled cat/text scale was found, and no physical display/DPI matrix was exercised by B.
- **Unavailability is represented honestly (source-confirmed positive).** The send action requires configured, connected, model-configured state (`ChatComposer.tsx:32–33`), and the composer provides a reason/settings action (`:98–102`). Cat status distinguishes unconfigured, connecting, disconnected and model-missing states (`pet-live-status.ts:15–28`). B did not connect a service or send a model request.

### Native operation coverage

| User operation | What current code covers | What this assessment does not prove |
| --- | --- | --- |
| Click cat to open chat | Cat is a labelled button with Enter/Space and accessibility click support; pointer release distinguishes click from drag (`PetStage.tsx:124–156`). | Actual native click/keyboard delivery or discoverability. |
| Drag cat or header | Shared pointer capture, 5px threshold, serialized/coalesced movement, release/cancel cleanup (`usePetGroupDrag.ts:25–119`); header excludes interactive controls (`App.tsx:98`); native paired positioning (`lib.rs:431–471`). | Smooth native movement, cross-display behavior, or no lost pointer events. |
| Keyboard/input focus | Native chat makes its NSPanel key and explicitly focuses the actual Webview (`lib.rs:476–499`); active-control restoration and page defaults exist (`ChatPanel.tsx:154–185`). Cat focus is indicated on the artwork (`desktop-shell.css:48–54`). | Actual WKWebView typing/IME, visibility of focus cues, or focus retention after each native route. |
| Close/reopen chat | “收起对话” and Escape (`ChatPanel.tsx:211–215,422`); native closed mode hides only chat (`lib.rs:383–398`); App preserves mounted chat/drafts in the transition path. | Current native draft retention or responder behavior. |
| Hide pet temporarily / recover | No app-owned complete flow found. Chat can be hidden; cat context menu provides reset and quit. Startup restores/clamps saved position or uses the default (`lib.rs:125–164`). | No claim that the app can never be recovered by OS-level means; only no implemented independent recovery entry in inspected product code. |
| Reset / quit | Context menu invokes `reset_pet_position` and `quit_app` (`App.tsx:533–546`); reset aligns and persists position; quit calls `app.exit(0)` (`lib.rs:200–223`). Keyboard menu path supports ContextMenu / Shift+F10 (`PetStage.tsx:147–150`). | Availability when the cat cannot be located; these commands require reaching its own menu. |
| Settings | Header has an accessible settings button (`ChatPanel.tsx:421`), save lock/status, connection help, and a return path (`AssistantSettings.tsx:172–191`). | A nontechnical first-run user successfully configuring a provider; no credentials were changed. |
| Different display sizes / cat ratio | Work-area fit, negative/global coordinate handling, fixed pet size, matching bottom-right anchor (`window_geometry.rs:3–7,29–37,70–80`); one drag-end refit if needed (`lib.rs:278–299`). `App.tsx:622` preserves dock scale; main always uses approved reference cat (`:643–650`). | Pixel-perfect composition, readable minimum widths, actual 1080p/2K/HiDPI, and cross-monitor continuity. |

### Files found and code patterns

| File | Role |
| --- | --- |
| `src/App.tsx` | Separate main/chat entry, native transitions, menus, viewport and focus coordination. |
| `src/components/PetStage.tsx` | Single visible reference cat, interaction target, accessibility and live state. |
| `src/lib/usePetGroupDrag.ts` | Pointer capture with click/drag distinction and serialized native commands. |
| `src/components/ChatPanel.tsx` | Chat/settings/todo/memo navigation, focus defaults, Escape behavior. |
| `src/components/ChatComposer.tsx` | Input selection handling, submit availability, recovery link. |
| `src/components/AssistantSettings.tsx` | Connection-only configuration, model lookup, save and status feedback. |
| `src/desktop-shell.css` | Fixed cat geometry, attached layout, focus artwork, reduced motion. |
| `src/components/ChatBubbleFrame.css` | Active variants, design-system advisory locations, container adaptation. |
| `src/components/PetLiveStatus.css` | Real 9px status detail and bounded/ellipsized label. |
| `src-tauri/tauri.conf.json` | Borderless transparent always-on-top, nonresizable windows. |
| `src-tauri/src/lib.rs` | NSPanel levels, focus/show/hide, position persistence, paired movement. |
| `src-tauri/src/window_geometry.rs` | Work-area fitting, fixed cat dimensions and drag constraints. |

### Related specs and context

- `.trellis/workflow.md`: research must be persisted; review does not authorize product edits.
- `.trellis/spec/frontend/index.md` and `native-pet-windows.md`: fixed cat backing, shared anchor, serialized drag, native focus, runtime evidence boundary.
- `.trellis/spec/desktop/index.md`: desktop/window ownership entry point.
- Task `prd.md`, then `design.md`, then `implement.md` were read. No `research.jsonl` exists. `implement.jsonl` and `check.jsonl` were not read because the researcher role explicitly isolates those manifests.
- `PRODUCT.md`: companionship, persistent desktop use, restrained interruption and truthful state.
- `DESIGN.md`: current cream/cocoa identity; explicit small cat-status exception, integrated shell and native evidence limitations.
- `.agents/skills/impeccable/reference/critique.md:65–94`: independent B, one CLI run, fallback when mutable injection is unavailable.

### External references and versions

No external research was needed. Source configuration identifies Tauri configuration schema v2 and product version `0.1.0` (`tauri.conf.json:2–5`). These are repository declarations, not a verified version of the currently running package. Impeccable SKILL.md declares version `4.3.1`.

### Parent follow-up: native launch preparation

After completing B, the parent asked whether the latest source enables a single-instance restriction before quitting the old installed app and launching the newly built bundle. A targeted lookup of `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, and `src-tauri/tauri.conf.json` found no `single-instance` dependency/registration/configuration. `lib.rs:522–526` builds the application and adds only `tauri_nspanel`; `lib.rs:600` runs the generated context. No source-level Tauri single-instance restriction is enabled in those startup entry points. This is launch preparation only and does not release the independent assessment findings.

## Caveats / Not Found

- No browser overlay was injected. The available CUA API has no documented DOM script injection interface; the parent instructed that native UI inspection remains exclusively with it. Static CLI inspection plus the parent's native review replace overlay evidence. B did not start an Impeccable live server, open a browser, or operate the native app.
- `.impeccable/critique/ignore.md` does not exist; no detector findings were silently ignored. Target slug and final critique snapshot/trend are parent-owned, not generated by B.
- The parent reported that its `impeccable context` invocation returned `TARGET_SELECTION_REQUIRED` after recognizing only admin. It read PRODUCT/DESIGN directly; B did not rerun context or scan admin.
- The raw detector JSON contains 72 complete records. Its shell exit code was not separately persisted; do not invent a clean exit status. The command completed and the JSON parsed successfully.
- No tests/builds, new services, temporary business data, model calls, or product/task-state edits were made. Only this research markdown and detector JSON were created by B. These are retained artifacts, not cleanup leftovers.
- Historical memory was used only to locate the prior focus-ring contract and the native-evidence boundary; current focus CSS and source behavior were re-read. The earlier package/runtime claims were not reused as current verification. Relevant memory: `MEMORY.md:187–198`; rollout `2026-09-16T00-52-40-sftM-remove_pet_focus_oval_and_rebuild_app.md:22–32`, rollout id `01a0a7b3-99e4-7d92-b10c-34a3feef45a2`.
- The statement that no tray/global shortcut/temporary pet-hide setting was found is bounded to the real frontend `src` route and native `lib.rs`/Cargo entry points searched. It is not an OS-level impossibility claim.
