# Source audit and decision evidence

Inspection date: 2026-10-26 (Asia/Singapore). This is a read-only source audit, not
native testing. No user database, credential value, or production service was accessed.

## 1. Baselines

| Repository | Inspected revision | Role |
|---|---|---|
| `D:\atcs\desktop-ai-pet` | `56192fb`, `codex/companion-product-refactor` | Migration target; clean before this planning task |
| `D:\atcs\cindy` | `ae50e8e1afd9b95e51801085d1a2ed9dfe8b16af` | Read-only source reference; clean at inspection |

The paths identify the inspection environment, not future runtime dependencies.
The source-import phase must verify and record file-level provenance before copying.

## 2. Current project evidence

| Evidence | Observed fact | Planning consequence |
|---|---|---|
| `package.json` | React/TypeScript/Vite with Tauri; existing build/test and pet-validation scripts | Reuse appropriate frontend logic/tests; change desktop build only during implementation |
| `src-tauri/tauri.conf.json` | `main` is the small transparent pet; `chat` is a separate initially hidden transparent window; bundle target currently `app` | New ordinary main window cannot inherit old labels/config blindly; Windows installer work must be explicit |
| `src/App.tsx:11`, `:12`, `:77`, `:164` | Both UI surfaces share imports/entry and consume Agent views | Separate entry/module graphs and use a reduced pet projection |
| `src/lib/agent.ts` | Existing typed host commands and snapshot/run/tool/utility models | Preserve semantics through an adapter; audit real session API gaps |
| `src-tauri/src/backend/mod.rs:303`, `:1219` | Backend abstraction and submit dispatch | Reuse the abstraction's intent, not a renderer-owned replacement loop |
| `src-tauri/src/local_agent/runtime.rs:21`, `:284` | Local Rust tool loop with an eight-step bound | Runtime replacement/extraction is separate from window migration |
| `src-tauri/src/backend/local.rs:25`, `:31` | Local SQLite database next to configuration | Inventory schema and backup/import explicitly |
| `src-tauri/src/backend/mod.rs:338` | `agent-config.json` path | New Electron user-data path must not silently hide existing settings |
| `src-tauri/src/backend/credentials.rs:9`, `:10` | Protected keyring service/account identifiers | Transfer through a host-side credential service; never read secrets in the renderer |
| `src-tauri/src/local_agent/store.rs`, `context*.rs` | Durable history/context and runtime records | Preserve original records; engine continuation format needs explicit mapping |
| `plugins/todo/plugin.json`, `plugins/memo/plugin.json` | Business tool manifests | Keep schemas/behavior consistent while moving execution plumbing |
| `src-tauri/src/customization/`, `src/lib/customization.ts` | Custom pet storage/provider/frontend integration | Include customization and asset migration, not only stock artwork |
| `src/components/PetStage.tsx`, `src/lib/pet-2d-renderer.ts`, `public/pets/` | Existing pet renderer and assets | Reuse these rather than generate a new pet or copy proprietary assets |
| `server/app/agent_service.py`, `runtime_store.py` | Separate server execution and persistence path | Preserve compatibility; do not silently replace remote execution with local |

## 3. Cindy evidence

All paths in this section are relative to the pinned Cindy checkout.

| Evidence | Observed fact | Planning consequence |
|---|---|---|
| `apps/desktop/package.json` | Electron Forge/Vite scripts and many workspace dependencies | Import the dependency closure/build setup, not only a component folder |
| `apps/desktop/src/renderer/index.tsx:1` | Selects separate dynamic entry module graphs before loading main application modules | Reference pattern for a genuinely lightweight pet entry |
| `apps/desktop/src/renderer/App.tsx:120`, `:196`, `:197` | Startup calls and subscribes to `window.electronAPI` | Copying visual components alone will not produce a working application |
| `apps/desktop/src/preload/preload.ts:37` | Imports Electron context bridge, IPC and web utilities | Electron is compatible with the reference host; audit/implement required APIs |
| `apps/desktop/src/renderer/components/layout/MainLayout.tsx`, `components/sidebar/Sidebar.tsx`, `layout/LayoutRoot.tsx` | Main layout/sidebar/pane composition | Reuse original structure instead of a visual rewrite |
| `apps/desktop/src/shared/layoutTree.ts`, `src/main/layout/LayoutStore.ts`, `src/renderer/panels/` | Persistent pane tree and panel registration | Preserve pane identities, one visible chat main, and layout restoration |
| `packages/maker-core/src/agents/pi/transport.ts:119`, `:120`, `:126` | Pi subprocess transport, standard streams, hidden Windows child window | Existing process/RPC integration is reusable evidence, not a complete portable engine module |
| `packages/maker-core/src/agents/pi/index.ts:7`, `:2124` | Pi integrated into Maker's larger Agent adapter | Trace required host interfaces, tool policies, resources and version before importing |
| `docs/dev-rules/architecture-invariants.md` | Pure-package dependency direction and pane-tree invariants | Preserve these in copied/adapted modules |
| `docs/dev-rules/electron-security-and-process-boundaries.md` | Sandboxed renderers, narrow preload, sender/payload validation, lightweight independent windows | Reuse security boundaries and scoped window lifecycle; do not enable Node in renderers |

The file list is a starting inventory, not a completed import manifest or proof that
every Cindy feature can operate without its services. The full Maker adapter, its
behavior rules, and all transitive packages require a scoped audit if Pi is selected.

## 4. Reference behavior versus private implementation

Previously inspected official [desktop pet behavior documentation](https://learn.chatgpt.com/docs/pets)
describes an optional movable companion and task activity/navigation behavior. It
does not establish a private process architecture to copy. The user-confirmed contract
is an independently switchable window in the same application, not another installed app.
Retain this project's pet assets and use the reference only for interaction boundaries.

[Pi RPC documentation](https://pi.dev/docs/latest/rpc) describes a subprocess protocol;
it does not make Electron mandatory. Electron was chosen by the user to favor Cindy
source reuse. Current online documentation may differ from the pinned adapter/runtime;
verify the exact protocol/version when Q1 is resolved. No Pi integration test was run.

The UI review keeps Cindy as visual authority. Prior UI/UX checks contribute keyboard
focus, unobscured controls, reduced-motion, loading/error, and native interaction
acceptance; they do not authorize a new palette, typography system, or sidebar design.

## 5. Existing specs: keep versus supersede

- `.trellis/spec/frontend/companion-experience.md`: retain draft/error/focus/native
  evidence safeguards. The new request replaces pet-centered main-interface styling
  and the old coupled chat geometry; do not apply those as Electron layout requirements.
- `.trellis/spec/desktop/dual-mode-llm.md`: retain deduplication, ordered events,
  interruption semantics, secrets, and mode separation. Tauri command transport and
  the full `agent:view` broadcast are current implementation facts, not mandatory new APIs.
- `.trellis/spec/desktop/local-context.md`: preserve original history and retrieval
  semantics; evaluate engine-native context management explicitly if Pi is selected.
- `.trellis/spec/desktop/pet-customization.md`: preserve asset ownership, selection,
  storage, and real native acceptance through the shell change.
- `.trellis/spec/backend/todo-reminders.md`: retain scheduling, conflict, deduplication,
  and offline boundaries; no renderer-owned duplicate scheduler.

Do not update these as though Electron already shipped. Record intentional changes
with their implementation and evidence. Existing historical tasks remain untouched.

## 6. Known unknowns and limits

- Q1 is a product choice: Pi versus extraction of the existing loop.
- File-level copy manifest, full feature parity inventory, exact Electron/Pi pins,
  platform packaging resources, and data schema mapping are implementation discovery
  deliverables. No unsupported compatibility claim is made here.
- Current credentials and user databases were not read. Their locations and migration
  contracts are derived from source; actual OS access requires later controlled testing.
- No UI was launched, no source copied, no dependency installed, and no live model,
  IPC, native pet, packaging, migration, or cloud test was performed for this plan.
