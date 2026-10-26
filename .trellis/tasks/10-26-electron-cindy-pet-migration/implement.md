# Implementation plan and review gates

Status: **planning only; implementation not started**. This file describes future
work, not completed checkboxes. Read [prd.md](prd.md) and [design.md](design.md) first.

## 1. Current delivery and implementation prerequisites

The present delivery is the task metadata, PRD, technical design, execution plan,
source audit, context manifests, and documentation verification. Commit and push only
these files to `codex/companion-product-refactor`. Do not run application builds,
install dependencies, migrate data, copy Cindy code, or activate implementation now.

Before any future implementation:

- [ ] Resolve PRD Q1: select Pi or preserve/extract the Rust runtime. Record the choice;
  delete the unselected execution path from the work checklist, not from historical rationale.
- [ ] Review the final scope, screen inventory strategy, proposed close/quit behavior,
  target-platform coverage, data migration, and rollback boundaries with the user.
- [ ] Perform the lossless PRD convergence pass and obtain approval of the latest summary.
- [ ] Create independently reviewable child tasks from the map below if implementation
  is approved. This planning delivery does not create or start those children.
- [ ] Curate each child's applicable context and run its validation before `task.py start`.
  Start the next actual deliverable, not this coordination parent by default.

## 2. Deliverable map and dependencies

This is a sequencing map, not an existing task tree. Parent/child links alone do not
encode dependencies; copy the prerequisite columns into each future child's artifacts.

| Step / suggested child | Prerequisites | Deliverable | Review / rollback gate |
|---|---|---|---|
| P0 `cindy-copy-inventory` | Implementation approval | Frozen source/dependency/screen matrix, data inventory, native baselines | Approve exceptions before source reduction; no product mutation needed |
| P1 `electron-cindy-source-import` | P0 | Copied Cindy source and required Electron build/host closure, independent new entry | Review provenance/import diff; old Tauri launch remains available |
| P2 `desktop-service-contracts` | P1 | Versioned IPC, real session/run/tool boundaries, stores and service ownership | Contract/security tests; rollback new entry without touching legacy data |
| P3 `agent-business-integration` | P2 + Q1 resolved | One local executor plus existing chat/todo/memo/reminder/customization behavior; server compatibility adapter | Real flow validation on disposable data; no dual execution |
| P4 `legacy-data-migration` | P2 + P3 schema/runtime mapping | Idempotent importer, protected credential transfer, migration report and rollback | Fault injection and restore rehearsal before real user import |
| P5 `independent-pet-window` | P1 + P2; P3 for live activity acceptance | Separate lightweight pet UI/preload/window, activity projection and recovery | Window/action isolation and native checks |
| P6 `electron-cutover-acceptance` | P3 + P4 + P5 | Installed build, visual/function/security/performance acceptance, reviewed documentation updates | Retire old paths only after final review and migration backup |

P4 and P5 can be developed independently once their prerequisites exist; they must
not share ownership of the same stores or window lifecycle files without coordination.
Do not start cloud/mobile implementation as a side effect of any child.

## 3. Detailed work packages

### P0. Inventory and baseline

- [ ] Confirm both baseline commits and clean/dirty state; preserve unrelated user work.
- [ ] Enumerate Cindy screens, navigation, startup providers, visible features, preload
  APIs, native handlers, workspace dependencies, assets, licenses, and service endpoints.
- [ ] Classify each as reuse/adapt/explicitly deferred. Review visible parity exceptions;
  do not trim whole feature groups solely to make the first build pass.
- [ ] Inventory legacy schema, configuration paths, credential metadata, custom assets,
  reminder rules, server sessions, and platform behavior without reading/logging secrets.
- [ ] Record reference and current native screenshots, startup/idle measurements, and
  supported platform coverage. Do not claim native observations from code inspection.

### P1. Source import and Electron shell

- [ ] **First application-code change: copy the pinned Cindy source**, with its required
  Electron/preload/shared/package dependency closure and source manifest. Do not create
  a newly designed replacement UI before importing the reference.
- [ ] Preserve a reviewable source-import diff/commit; adapt configuration separately.
- [ ] Bring over the compatible workspace, Forge/Vite, TS, assets, and native-module
  build requirements. Reconcile one reproducible lockfile; do not install arbitrary latest versions.
- [ ] Set this product's app ID, data directory, branding and update/network policy.
  Remove reference-production service activation from startup without fake success responses.
- [ ] Keep new main UI separate from the legacy launch path. No deletion of `src-tauri/`.
- [ ] Audit preload/security policy before enabling privileged capabilities. Confirm
  no runtime/build reference to `D:\atcs\cindy` remains.

### P2. Application services and IPC

- [ ] Define shared validation schemas, stable session/run IDs, request deduplication,
  ordered events, snapshots, reconnect cursors, and configuration generations.
- [ ] Bind copied preload methods to application services; retain useful upstream API
  names instead of spreading translation logic through visual components.
- [ ] Add real session operations required by the copied UI; document project/workspace
  mapping and permission grants rather than manufacturing placeholder entities.
- [ ] Give the host lifecycle ownership and enforce one executor per run. Keep stores,
  credentials, reminders, and blocking operations out of renderer/main hot paths.
- [ ] Implement explicit capability failures and errors, subscription disposal, and
  reload recovery. Test invalid senders, unknown methods, and malicious payloads.

### P3. Runtime and existing business features

- [ ] Pi branch, if approved: pin protocol/runtime/adapter; integrate managed RPC,
  persistence, event mapping, cancellation, pending input, permissions, packaging,
  and the existing business-tool bridge. Audit the full imported dependency closure.
- [ ] Rust branch, if chosen: extract a headless runtime adapter; remove dependence
  on Tauri windows/events at the host boundary while retaining established behavior.
- [ ] Implement only the selected default local path. Keep legacy server-mode transport
  behind the same services and test its existing error/reconnection semantics.
- [ ] Reconnect todo/memo CRUD, reminder CAS/timezone/due polling, tool result labels,
  context/history access, model/settings errors, and pet-customization storage/provider flows.
- [ ] Ensure one reminder scheduler per active data owner, including with both windows
  visible and after reload/restart. Model availability must not gate local utility CRUD.
- [ ] Preserve old transcripts independently of the selected engine's native session
  format. Test no automatic prompt/tool replay after ambiguous failures.
- [ ] Verify genuine send -> stream -> tool -> final/error/cancel paths. Fixture tests
  and live-model tests must be reported separately; request configuration if unavailable.

### P4. Migration and recovery

- [ ] Build a fixture-driven importer before touching user data. Cover legacy formats,
  local/server settings, no-credential and failed-credential cases, custom asset paths,
  Unicode, empty databases, large histories, and interrupted runs.
- [ ] Establish exclusive writers and a consistent SQLite backup, including WAL handling.
- [ ] Import to a separate destination; preserve IDs/order and write a migration ledger.
- [ ] Test interruption at each phase, repeat imports, invalid/missing records, disk-full
  failure, unavailable credential store, and asset-copy failure.
- [ ] Confirm successful migration counts/relations/checksums and credential protection;
  retain the source and report any engine-resume limitations.
- [ ] Rehearse rollback before new writes and preservation/export after new writes.
  Live-data migration requires an explicit cutover confirmation, not this plan's approval.

### P5. Independent pet

- [ ] Create a dedicated window, entry module, styles, minimal providers, and narrow preload.
- [ ] Reuse the existing pet renderer/assets and replace Tauri transport without a new pet design.
- [ ] Implement independent visibility, tray/main recovery, drag, pinning, DPI/bounds
  persistence, transparent hit testing, reduced motion, and bounded renderer recovery.
- [ ] Feed only the host's compact activity projection. Route task activation to the
  correct main-window conversation without submitting another run.
- [ ] Test pet disabled at startup, repeated show/hide, main hidden/reloaded, pet crash,
  absent tray, monitor unplug, negative origins, and current custom-pet asset restoration.
- [ ] Confirm no full Cindy app/module graph loads in the pet and no orphan animation,
  polling, click interception, or unauthorized IPC remains after hiding.

### P6. Packaging, acceptance, and cutover

- [ ] Build/install on Windows without the reference repo or globally installed runtime.
  Verify native DB modules, engine assets, tray/icons, Unicode paths and shutdown cleanup.
- [ ] Compare all approved screens to the reference at equivalent theme, size and data
  state; check keyboard focus, dialogs, drafts, navigation, streaming and long content.
- [ ] Run the acceptance matrix below and record actual process/build/OS/display details.
- [ ] Compare startup, idle pet-on/off CPU/memory, animation behavior and package size
  with P0 measurements; resolve observed regressions rather than inventing thresholds.
- [ ] Update product/design/spec and developer instructions to the delivered Electron
  architecture. Mark replaced Tauri geometry rules as superseded while retaining safety contracts.
- [ ] Review remaining feature/platform gaps with the user. Only then make Electron the
  default and consider removing obsolete Tauri build paths in a separate reviewed change.
- [ ] Do not delete legacy user data/backups or disable server mode as routine cleanup.

## 4. Verification matrix

| Layer | Required tests / evidence | PRD acceptance |
|---|---|---|
| Source/dependencies | Provenance hashes, import/adaptation diff, license inventory, no reference absolute-path dependency | AC01, AC09 |
| UI | Native light/dark screen comparison, session/draft navigation, real loading/error states, keyboard focus | AC02, AC03, AC11 |
| Contracts/runtime | Duplicate requests, late events, sequence gaps, snapshot rebuild, cancel/exit/crash, pending input | AC03, AC05, AC08 |
| Utilities | CRUD, exact reminder conflict handling, due scheduling/timezone, failed persistence, tool result truthfulness | AC04, AC11, AC13 |
| Migration | Repeat import, staged failures, WAL-safe backup, counts/relations/assets, credential rejection, rollback | AC07, AC08, AC13 |
| Native pet | Visibility independence, correct target activation, focus/hit testing, DPI/displays, recovery, reduced motion | AC05, AC06, AC12 |
| Security | Sender/frame identity, payload/resource authorization, URL/CSP restrictions, secret redaction, narrow pet bridge | AC10 |
| Packaging | Clean-machine install, runtime/native resources, no orphan child processes, platform coverage record | AC09, AC12 |

Existing baseline commands (run during implementation, not asserted as run now):

```text
pnpm test
pnpm build
pnpm pet2d:validate
cargo test --manifest-path src-tauri/Cargo.toml
```

After copying Cindy, if the desktop package retains its `desktop` name and scripts:

```text
pnpm --filter desktop typecheck
pnpm --filter desktop lint
pnpm --filter desktop test
pnpm --filter desktop build
```

Confirm script names from the final package configuration before executing them.
Add targeted tests for IPC, source parity, migrations and pet lifecycle to that package.
Do not claim current Tauri-specific native verification scripts validate Electron
unchanged; port their semantic assertions and preserve the baseline evidence.

## 5. Documentation-only delivery checks

For the current task, validate JSON/context manifests, referenced local evidence paths,
requirement-to-acceptance coverage, no unresolved template placeholders, and whitespace.
Review the PRD once top-to-bottom for duplicated decisions or invented approvals.
Record results in [verification.md](verification.md). Confirm every staged file is
inside this new task, commit the plan, push without force, and verify the remote SHA.

Leave the task in `planning`. A successful push proves document delivery only, not
application correctness, implementation approval, or a completed migration.
