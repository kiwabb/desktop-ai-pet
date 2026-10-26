# Technical design: Electron, copied Cindy UI, independent pet

Status: proposed implementation design, 2026-10-26. Electron/source-copy/window
decisions and the Pi engine choice are confirmed in [prd.md](prd.md); the pinned
Cindy reference is available locally but has not been imported. Nothing in this
document claims that migration or runtime validation has occurred.

## 1. Architecture and ownership

```text
One installed Electron application
  Main renderer: copied Cindy components, styles, layout, navigation
    -> main-window preload: typed, allowlisted commands/events
  Pet renderer: existing pet assets + dedicated lightweight entry
    -> pet preload: activity, visibility, preferences, open-conversation only
  Electron host
    -> window/tray lifecycle and IPC authorization
    -> application services: sessions, runs, tools, reminders, preferences
    -> persistence + credential + migration services
    -> runtime adapter -> selected Agent child process
    -> legacy server adapter (compatibility path)
    -> future device transport adapter (not implemented in this migration)
```

The application service boundary is the proposed local gateway. It is a module/API
boundary, not a reason to expose an unauthenticated localhost port or launch a cloud
server. Use Electron IPC inside this application. A future remote transport must
authenticate, authorize, and invoke the same services, not directly access IPC channels.

Electron main owns OS integration and supervises the executor. Agent execution,
blocking database work, and expensive imports must not block its UI event loop;
use a controlled child/worker where needed. UI, protocol, and domain packages must
not reverse-import renderer or Electron main modules. No model keys in renderers.

## 2. Proposed repository shape

These are target paths, not directories created by this planning delivery.

```text
apps/desktop/
  src/main/                  Electron lifecycle, IPC, stores, migration adapters
  src/preload/               Main and pet-specific bridges
  src/renderer/              Cindy source, minimally adapted
  src/pet-renderer/           Existing pet, independent module graph and styles
  src/shared/                Pure wire types, schemas, constants
packages/
  app-core/                  Sessions, runs, tools, reminders, domain contracts
  runtime-adapter/            Selected engine integration; no UI imports
  <required Cindy packages>/  Copied dependency closure, with source attribution
plugins/                     Existing todo/memo manifests remain authoritative
src/ and src-tauri/           Legacy implementation retained during transition
server/                      Legacy remote service; no deletion or new cloud rollout
```

Prefer keeping copied Cindy-relative structure and package names where this avoids
gratuitous churn; the names above are organizational proposals, not a requirement
to rewrite upstream modules into a new framework. Root workspace/build changes occur
only during implementation. Never use a symlink to `D:\atcs\cindy` as a dependency.

## 3. Copy and adaptation boundary

Pin the source commit from the PRD before copying. Record a source manifest containing
source commit/path, destination, license/notice ownership, checksum, and adaptation reason.
Use a dedicated source-import commit, followed by separate host/business adaptations,
so reviewers can distinguish reused code from new behavior.

| Reference area | Treatment |
|---|---|
| `apps/desktop/src/renderer/` | Copy the approved interface and its dependency closure: components, layout, features, contexts, hooks, state, styles/themes, assets, types, i18n, and entry modules. Preserve visual structure. |
| `apps/desktop/src/preload/` and `src/shared/` | Reuse required APIs/contracts; map them to this application's services. Audit broad privileges before enabling them. |
| `apps/desktop/src/main/` | Reuse the required window, layout, IPC, theme, and native integration infrastructure. Do not wholesale enable Cindy's business/service integrations. |
| Workspace packages | Trace transitive imports and copy the actual required packages with compatible versions; pure shared packages are not a substitute for host implementations. |
| Forge/Vite/TypeScript/package configuration | Adapt a coherent Cindy build setup, retaining reproducible dependency versions and native-module rebuild requirements. |
| Product identity and service endpoints | Supply this product's values. Do not copy reference production services, analytics, updater destinations, login state, or caches. |
| `.env`, credentials, databases, `node_modules`, build output | Excluded from source import. |

Before trimming any visible capability, build a feature/API matrix:
`screen -> renderer entry -> preload method -> host handler -> domain service ->
dependency -> available/deferred -> acceptance test`. Every exposed command gets
a real implementation or an honest, reviewed unavailable state. No permissive
`window.electronAPI` proxy that returns empty success for arbitrary methods.

Reuse Cindy's panel registry and layout persistence rather than rebuilding its
sidebar. Preserve the single visible `chat-main` pane, panel-kind identities,
saved layout, and first-frame layout consistency. Integrate todo/memo panels using
existing panel patterns; review the addition without redesigning the surrounding UI.
The current app's single-active-session API must be extended behind the adapter if
the copied interface exposes multiple conversations/projects. Do not fabricate records.

## 4. Agent runtime decision

### Option A: Pi subprocess (recommended, conditional on Q1)

Reuse Cindy's relevant Pi transport/protocol work, after tracing its host and package
dependencies. Its adapter is integrated with Maker; copying one file is not a complete
runtime migration. Run the selected Pi version through RPC in a child process, not
from React and not by embedding the sampling loop in Electron main.

Benefits: avoid continuing a product-specific sampling/tool loop; align with Cindy's
existing process integration. Costs: tool/permission integration, model configuration,
session/history compatibility, runtime packaging, and lifecycle acceptance.

Required work if selected:

1. Pin one exact Pi version and compatible Cindy adapter. Local/reference/latest docs
   may differ; test the chosen protocol instead of assuming event-name compatibility.
2. Own process startup, stderr logging/redaction, JSONL framing, request correlation,
   backpressure, cancellation, timeouts, child-process-tree cleanup, and bounded restart.
3. Distinguish command acceptance from completed work. Define terminal-event mapping
   from the pinned protocol; reconnecting does not authorize replaying a prompt.
4. Use app-owned persistent session storage, with a mapping from application session
   IDs to engine session IDs. Do not use ephemeral `--no-session` as production storage.
5. Register existing todo/memo/history capabilities through a controlled extension or
   tool bridge to domain services. Validate schemas and retain idempotency/CAS behavior.
6. Review all native tools. Selecting Pi does not authorize enabling arbitrary shell,
   filesystem, network, or auto-approval capabilities. Start from the approved tool set.
7. Choose one context/compaction authority; keep raw history and avoid layering the old
   Rust summarizer over Pi automatic compaction. Never claim old native engine state
   can resume just because its transcript can be displayed.
8. Bundle the matching runtime, resources, and extensions for each supported OS/arch;
   do not assume a developer-global CLI or a single executable without assets.

### Option B: preserve the current Rust loop behind a headless adapter

If Pi is declined or deferred, extract the existing local Rust runtime from Tauri
window/event dependencies and run it as a controlled child service with the same
application contract. Keep the existing loop initially instead of implementing a new
TypeScript loop. This preserves more behavior but requires a new headless boundary,
Rust packaging, and continued maintenance of that engine. It is not zero-cost reuse.

Only one option becomes the default local executor. Do not implement both new local
paths merely to postpone Q1. Preserve the existing server path as a compatibility
adapter, without expanding a second product feature roadmap or deleting its data.

## 5. Application contracts and state

Define versioned shared schemas, validated in the host. Exact method spelling may
match the copied preload APIs; the following semantic contract is required:

- Sessions: list/create/open, snapshot, history pagination, and stable IDs.
- Runs: submit with request ID, acknowledge acceptance, stream durable events, request
  cancel, answer a specifically identified pending interaction, and query final state.
- Tools: validated invocation, stable call identity, durable result, deduplication,
  permission checks, and reconciliation for uncertain external side effects.
- Utilities: todo/memo operations and reminders with expected-version checks.
- Settings: validated persistence and non-secret provider/credential-presence metadata.
- Windows: main activation, pet visibility/preferences, and scoped readiness events.

For each event retain session/run identity, generation, monotonically ordered sequence,
and revision. Subscribe with a cursor or obtain a snapshot before applying deltas;
on gaps, rebuild from authoritative state. Drop late events from replaced runtimes,
sessions, or configuration generations. Cancellation acknowledgment is not proof of
termination until the executor confirms its state.

Persist acceptance and events before publishing success. The application store owns
business state and its presentation projection; engine session files own engine-native
continuation state. They have an explicit ID mapping and recovery protocol, not two
uncoordinated writable copies of the same state. On ambiguous crash recovery, mark
the run interrupted and tools as needing reconciliation rather than automatically retry.

## 6. Pet and main-window lifecycle

Use explicit names such as `app-main` and `pet`; the old Tauri label `main` means
the pet and cannot be mechanically translated into the new main window.

| Action | Main window | Pet | Executor |
|---|---|---|---|
| Hide pet | Unchanged | Hide and pause rendering work | Unchanged |
| Show pet | No forced focus | Restore/clamp bounds, show without stealing focus | Unchanged |
| Open task from pet | Activate target conversation | Remains optional | No new run |
| Reload main renderer | Rehydrate snapshot and drafts | Unchanged | Continues |
| Pet renderer crash | Unchanged | Report and offer bounded recovery | Continues |
| Close main window | Proposed: hide when tray recovery is available; otherwise retain a recovery/exit choice | Independent | Continues while app lives |
| Explicit Quit | Confirm impact for active work; bounded shutdown | Shut down | Cancel/reconcile and record interruption as needed |

The pet gets a dedicated entry and preload, not a late conditional inside a component
that already imports Cindy's full `App`. Reuse the existing pet art/action modules
after replacing Tauri calls. Keep main and pet CSS/provider graphs isolated.

Proposed pet view: revision, visibility/preferences, aggregate activity, and an optional
session/run target for activation. No message text, tool arguments, API keys, or raw
provider errors. Main owns aggregation; the pet cannot infer completion from animation.
Suggested priority: needs input, blocked/error, recently completed, running, idle.

Test transparent-area click-through separately from interactive pet hit regions,
drag vs click, negative screen coordinates, DPI, display removal, work-area clamping,
pinning, reduced motion, and recovery when a tray is unavailable. Pet load failure
must not prevent the main window from starting. Separate renderers do not protect
against an Electron-main or OS crash; do not promise whole-app isolation.

## 7. Data, credentials, and rollback

Inventory legacy locations from OS/app configuration, not a hardcoded development path:
`agent-local.db`, `agent-config.json`, companion preferences/positions, customization
metadata and files, and credential entries. The observed keyring service/account is
`desktop-ai-pet` / `local-llm-api-key`; migration must discover and test platform access.

Migration sequence:

1. Refuse concurrent legacy/new writers. Settle active runs or require an explicit
   interruption choice. Do not copy a live SQLite main file while ignoring its WAL.
2. Create a consistent, recoverable backup using a database backup operation or a
   safely closed source. Record schema/version, counts, checksums, and asset inventory.
3. Import into a separate staging store in this application's own user-data namespace.
   Preserve IDs, timestamps, sequences, tool outcomes, memo/todo links and reminder CAS.
4. Transfer secrets host-side into protected storage. Write the new secret successfully
   before scrubbing any permitted source; preserve the old source if transfer fails.
   A user re-entry prompt is acceptable; logging/exporting the secret is not.
5. Validate foreign keys, counts, transcript samples, asset paths, settings, timezone,
   reminder deduplication, and engine compatibility. Persist a migration ledger so
   reruns are idempotent and interrupted imports can resume or safely restart.
6. Activate the new store atomically after validation. Keep the legacy backup untouched;
   report any records that cannot be resumed as native engine state.

Rollback before new writes: disable the new entry and reopen the preserved legacy
data. Rollback after new writes: do not discard them by restoring an old backup;
export/preserve new records first and use a tested reverse import or stop for review.
Keep both versions from writing the same database. Do not promise downgrade without
loss until a concrete downgrade path has passed tests.

## 8. Security and cloud boundaries

Preserve Cindy's sandbox/context-isolation/no-Node renderer baseline and restrictive
navigation/CSP. Validate true sender/frame identity, schemas, resource ownership,
paths, and permissions in the host. Do not expose generic IPC invoke or raw Electron
events. Pet preload is narrower than main preload. Markdown/agent output is untrusted.
Remote content must not inherit privileged preload access. External URLs need a scheme
allowlist; credentials, model access, filesystem grants, and process launch stay host-side.

Future cloud responsibilities: identity/device pairing, revocation, authenticated relay,
optional encrypted record synchronization, and ownership/conflict management. Local
execution remains on the owning device; if it is offline, remote control cannot silently
execute elsewhere. A later design must specify device leases, deduplication, approvals,
local file/tool routing, and explicit takeover. No cloud service is deployed in this plan.

## 9. Compatibility and risk controls

- The new user direction supersedes old pet-centered main-UI styling and coupled
  chat-window geometry only for this planned migration. Preserve unrelated safeguards
  from existing specs: draft retention, truthful state, credential protection, reminders,
  focus, and native evidence. Update `PRODUCT.md`, `DESIGN.md`, and applicable specs
  during approved implementation; do not rewrite them as if migration already shipped.
- Cindy's large dependency graph and native modules may affect startup/package size.
  Measure cold/hot startup, idle pet-on/off CPU, memory, and bundle size against recorded
  baselines. Do not invent performance numbers before measurement.
- Exact frontend reuse requires real API coverage. Source copying alone is not proof
  of UI or business parity; review inventory exceptions before the cutover.
- Electron and Pi versions must be pinned and security-reviewed at implementation.
  Windows acceptance does not establish macOS Spaces or Linux compositor behavior.
- Runtime, schema, packaging, credential, and window migrations have separate gates
  and rollback points in [implement.md](implement.md).
