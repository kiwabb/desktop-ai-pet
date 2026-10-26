# Electron + Cindy UI migration and independent pet

## Goal

Turn the current pet-centered desktop into a full desktop assistant with Cindy's
existing interface and an optional, independent pet window. Preserve conversations,
todos, memos, reminders, settings, and pet assets through the change.

This task currently delivers **planning documents only**. Authorization is limited
to D5 below; it does not include copying application code, installing dependencies,
migrating live data, or starting implementation.

## Confirmed decisions and background

| ID | Confirmed decision | User authority |
|---|---|---|
| D1 | Replace Tauri with Electron. | "那改成Electron把" |
| D2 | Copy Cindy's actual frontend first; do not hand-build a similar interface. | "界面一样 进来把代码先复制过来 不要自己写" |
| D3 | The pet is an independently switchable floating window in the same application; hiding it does not affect the main UI or Agent. | Explicit window-isolation answer. |
| D4 | Local Agent execution is primary, with UI, execution, and future cloud responsibilities separated. | Earlier accepted architectural direction. |
| D5 | Write and push the plan; implementation remains a separate review gate. | "可以 写完推送" |
| D6 | Select Pi as the local Agent engine and begin implementation of the approved migration plan. | User confirmation: "推荐的 Pi" after the implementation gate was explained. |

Baseline: `56192fb`, branch `codex/companion-product-refactor`. Read-only reference:
Cindy `ae50e8e1afd9b95e51801085d1a2ed9dfe8b16af`, inspected at `D:\atcs\cindy`.
See [source audit](research/source-audit.md) for evidence and limitations.

The current UI shares an entry between pet and chat (`src/App.tsx:77`, `src/App.tsx:164`).
The local loop is Rust (`src-tauri/src/local_agent/runtime.rs:284`); the separate
server also has a loop. Cindy's renderer depends on Electron APIs and workspace
packages, not just React components. Electron reduces adaptation, not dependency work.

## Requirements

### R1. Source-based Cindy interface migration

- Preserve Cindy's layout, navigation, chat/composer, themes, settings patterns, and
  window interaction for the approved screen inventory. Copy source before adapting it.
- Include the required dependency closure and record provenance and adaptation diffs.
- Keep this product's identity. Do not adopt Cindy accounts, production endpoints,
  telemetry, update feeds, credentials, or private data by copying code.
- Inventory every visible screen and feature. UI parity is not authorization for all
  Cindy backend features. Review exceptions explicitly; no silent removals or fake APIs.
- Leave the reference checkout unchanged; do not require its absolute path at build
  or runtime. Preserve applicable source and asset attribution.

### R2. Existing assistant capabilities

- Preserve history, streaming, run/tool results, errors, drafts, settings, todo/memo
  CRUD, reminders, and existing pet customization capabilities.
- Preserve request deduplication, reminder conflict checks, and timezone semantics.
- Back the copied session navigation with real session identities; several visible
  conversations must not secretly share one mutable backend session.
- Local utilities stay usable without a model connection. Preserve legacy server
  configuration/history and supported server flows; no silent switch to local execution.

### R3. Window-independent Agent lifecycle

- The application owns sessions and runs, not renderer mount/unmount state.
- Main-renderer refresh, navigation, pet hide/show, and pet-renderer failure must not
  duplicate, restart, or cancel runs.
- Expose running, waiting-for-input, completed, interrupted, and failed states honestly.
- Distinguish closing/hiding a window from application exit. Do not report interrupted
  work as successful, or create a second executor for the same run.

### R4. Independent optional pet

- Give the pet its own floating window and UI entry, with independent visibility,
  drag, bounds recovery, pinning, preferences, and main-window/tray recovery controls.
- Show task activity and open the corresponding conversation in the main window;
  do not duplicate the full chat/todo/memo interface inside the pet.
- Preserve approved artwork/actions/custom assets and reduced-motion behavior. Copy
  neither proprietary reference-product artwork nor claimed private implementation.
- Pet-off must not leave click-blocking invisible windows or unnecessary animation.
  Pet events must not contain credentials or full conversation bodies.

### R5. Recoverable data and credential migration

- Make a consistent backup before import; preserve the original database/configuration.
- Retain IDs, relationships, ordering, timestamps, reminder versions, and asset references.
  Repeating migration must not duplicate records.
- Migrate credentials through protected host-side access. Failure must not erase old
  credentials, reuse a different provider's key, or fall back to plaintext.
- Reconcile in-flight work or mark it interrupted. Do not automatically replay tools.
  Keep raw transcripts even where engine-specific state cannot be resumed.
- Report migration results and retain a documented rollback path.

### R6. Secure, reproducible delivery

- Use narrow, validated preload APIs. Never enable renderer Node access to make copied
  code compile. Package production dependencies and selected runtime assets.
- The installed app must not need the reference repo or a developer-global runtime.
- Keep the old application recoverable until replacement acceptance passes.
- Verify real native windows and an installed build. Windows is the first verification
  environment; report other-platform coverage separately rather than assuming parity.

### R7. Local-first layering and future devices

- Separate UI, application services, execution, persistence, and cloud responsibilities.
- Future account/device relay/sync services must not become local-startup prerequisites.
- Record that synchronized history is not live process, filesystem, permission, or
  tool-side-effect migration. A device taking over work needs explicit ownership rules.

## Acceptance criteria

| ID | Observable result | Requirements |
|---|---|---|
| AC01 | Copied-file manifest identifies the pinned Cindy source; the reference remains unchanged. | R1 |
| AC02 | Native screenshots and interactions match the reviewed Cindy screen inventory in light/dark themes; exceptions are approved. | R1, R6 |
| AC03 | Real chat streams and records tool outcomes; session switching retains correct history and drafts. | R2, R3 |
| AC04 | Todo/memo CRUD and reminders work; stale reminder updates report conflict rather than overwrite. | R2 |
| AC05 | Pet hide/show/crash and main-renderer reload during a run cause no duplicate execution or lost ownership. | R3, R4 |
| AC06 | Pet-off leaves the app usable; show restores an on-screen pet; a task click opens the right conversation. | R4 |
| AC07 | Repeated migration and injected import failure produce no duplicates, source corruption, or secret leakage. | R5 |
| AC08 | Restart after exit/crash distinguishes interrupted runs and uncertain tool outcomes; no destructive replay. | R3, R5 |
| AC09 | The installed Windows build runs without the reference repository or developer toolchain. | R6 |
| AC10 | Invalid IPC senders/payloads, unsafe links, unauthorized pet commands, and renderer credential access are rejected. | R4, R6 |
| AC11 | Offline/model-failure startup retains navigation, local utilities, editable drafts, and truthful errors. | R2, R7 |
| AC12 | Native drag, DPI changes, display removal, transparent hit testing, keyboard focus, and reduced motion pass. | R4, R6 |
| AC13 | Legacy server configuration/history and supported flows pass compatibility checks; no silent local fallback. | R2, R5 |

## Out of scope for this delivery

- Product implementation, dependency installation, builds, or live-data migration.
- Automatically adopting all Cindy integrations, accounts, analytics, remote desktop,
  browser automation, collaboration, or multi-engine features.
- A separately installed pet application or guaranteed whole-application crash isolation.
- New pet artwork, a new visual design system, or a lookalike rewrite of Cindy.
- Deploying cloud services, a mobile client, multi-device control, or synchronization.
- Deleting Tauri/server code or retiring server mode before a reviewed cutover.

## Implementation readiness

**Q1 — Agent engine: resolved.** Pi is selected for the new Electron runtime. The
existing Rust loop remains available as the recoverable legacy path until the new
runtime passes its acceptance gates; it is not a second new executor.

Implementation is now approved and the task is `in_progress`. The pinned Cindy
checkout is not present in the current workspace, so source-copy work must stop at
the provenance boundary rather than inventing a lookalike UI; independently valid
Electron host and Pi protocol work may proceed while that source is supplied.
