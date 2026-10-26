# Cindy source import inventory (pre-copy)

Status: **reference audit complete for the entry and host boundary; no Cindy
source has been copied into this product**.

This document freezes the first import boundary for the implementation task. It
is deliberately a pre-copy inventory, not a claim that the Electron renderer
already has Cindy UI parity.

## Source identity

| Field | Value |
|---|---|
| Repository | `makecindy/cindy` |
| Public URL | `https://github.com/makecindy/cindy` |
| Pinned commit | `ae50e8e1afd9b95e51801085d1a2ed9dfe8b16af` |
| Commit subject | `Merge pull request #7197 from zqchris/cindy/thoughtful-stallman` |
| Local reference | `/Users/zhoujiaangyao/zhoujiangyao/AI/cindy-reference` |
| Checkout | detached, shallow/partial, sparse, clean at the pinned commit |
| Reference license | Root `LICENSE`, Apache-2.0 |
| `LICENSE` SHA-256 | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| Reference notice | Root `NOTICE`, `Cindy Copyright 2026 XD Inc.` |
| `NOTICE` SHA-256 | `77ad73b2535cd4011ed8b509aa51d7c745ae5a6f411370d8f94337562c03cd97` |
| Third-party notices | Reference says they are collected under `docs/legal/notices/`; this sparse checkout does not materialize that directory |

The reference checkout is a read-only audit input. The application build must
not depend on its absolute path, its Git object store, or a developer-global
checkout.

## Current product boundary

The product currently has a deliberately small Electron shell:

| Product path | Current responsibility | Import constraint |
|---|---|---|
| `apps/desktop/renderer/main.html` | CSP, root element, and honest migration placeholder | Keep as the product-owned HTML entry until the Cindy renderer has a reviewed build entry |
| `apps/desktop/src/main/main.ts` | Electron app lifecycle, single-instance handling, main/pet creation | Remains the lifecycle owner; do not replace it with Cindy's bootstrap wholesale |
| `apps/desktop/src/main/desktop-windows.ts` | Main/pet `BrowserWindow` lifecycle and sender-checked pet IPC | Remains the window owner; adapt only reviewed window behavior |
| `apps/desktop/src/preload/main-preload.ts` | Narrow main-window bridge | Do not replace with the broad Cindy preload object |
| `apps/desktop/src/preload/pet-preload.ts` | Narrow pet bridge | The pet must not load the Cindy application graph |
| `apps/desktop/src/shared/` | Product-owned runtime/wire contracts | Cindy shared types need an explicit namespace and collision review |

The product `apps/desktop/package.json` currently has no Cindy renderer
dependencies or build scripts. The current `tsconfig.json` includes only
`src/**/*.ts`, so JSX/CSS/configuration changes are a separate build-adaptation
step, not an implicit consequence of copying files.

## Reference entry anchors

These are the exact files inspected and their SHA-256 values. The destination
column is a proposed destination for a later source-import commit; the files
are not present in the product yet.

| Reference path | Observed role | Lines / bytes | SHA-256 | Proposed destination | Decision |
|---|---|---:|---|---|---|
| `apps/desktop/src/renderer/index.tsx` | Query-param module graph dispatcher for main, sidebar, resource-usage, and remote-desktop windows | 28 / 1,122 | `a4a3b477365f0a3fcdef2f354fed26d5ac414cbc7983c25252c212538bd5b69b` | `apps/desktop/src/renderer/index.tsx` | Adapt after the product's window routes are mapped; do not import all branches by default |
| `apps/desktop/src/renderer/main-entry.tsx` | Renderer bootstrap: fonts, i18n, themes, global CSS, settings bootstrap, diagnostics, providers, and deferred `App` load | 235 / 11,071 | `e50a38d146968f06855b7c7325ce4fe9192d2482d8f4fede5fd70a68d81aa95f` | `apps/desktop/src/renderer/main-entry.tsx` | Copy only with a host/API feature matrix; static imports already pull broad services |
| `apps/desktop/src/renderer/App.tsx` | Provider root, auth/session gates, error surfaces, and `RouterProvider` | 488 / 23,242 | `79dd3fdb1f8f2addb49429df27ac21ba1734b87310a893fe1bded323b25efe37` | `apps/desktop/src/renderer/App.tsx` | Preserve structure only after service ownership and product identity are mapped |
| `apps/desktop/src/renderer/router.tsx` | Hash routes for login, main layout, CC agent, bots, settings, skillhub, scheduler, and plugin surfaces | inspected | `dbbf7030c9496928d514f63f7de85db0ea39d8e57ad2eb1c41d27f49dafb726b` | `apps/desktop/src/renderer/router.tsx` | Use as screen inventory input; do not enable every route as an unbacked feature |
| `apps/desktop/src/renderer/components/layout/MainLayout.tsx` | Main chrome, sidebar/right-sidebar, panel/layout persistence, browser/remote/device hooks | 1,969 / 98,512 | not copied | `apps/desktop/src/renderer/components/layout/MainLayout.tsx` | High fan-out; must be imported with its actual dependency closure or split by reviewed boundary |
| `apps/desktop/src/renderer/components/sidebar/Sidebar.tsx` | Sidebar shell, feature slot, top navigation, user section, resize/collapse behavior | 284 / 15,044 | not copied | `apps/desktop/src/renderer/components/sidebar/Sidebar.tsx` | Candidate visual shell; its feature/context imports still require review |
| `apps/desktop/src/renderer/styles/globals.css` | Tailwind layers, generated tokens, global selection/focus/drag rules | 2,465 / 93,089 | not copied | `apps/desktop/src/renderer/styles/globals.css` | Copy with generated tokens and CSS build configuration; do not silently overwrite pet styles |
| `apps/desktop/src/renderer/themes/colors.ts` | Generated light/dark color registry and theme variables | 3,216 / 148,374 | not copied | `apps/desktop/src/renderer/themes/colors.ts` | Copy only with its generator/notice provenance and product theme ownership decision |
| `apps/desktop/src/preload/preload.ts` | Large `window.electronAPI` context bridge | 8,440 / 421,902 | `d9ec7e1ecee6197c18c07b7dd94f7b11ec0fccf2aa7fc946722e7ebb4fb04bcc` | product-owned preload adapter, not wholesale | Must be reduced to allowlisted product services; never expose this object unchanged |
| `apps/desktop/src/main/bootstrap-electron.ts` | Browser windows, startup, CSP/navigation, persistence, and many IPC handlers | 10,731 / 486,825 | `13cf3248ffbbd3dfd9c19a2fc1e1f0d63a3c23a3726f420e26ead3636ab64f73` | product-owned `src/main/` adapters | Do not copy wholesale; it contains service integrations outside this task |
| `apps/desktop/package.json` | Electron Forge/Vite scripts and renderer/native dependency graph | 236 / 9,704 | `50bb08ceefafa6f1952f21943cc656175083ddf586c0a40903e70bd27632aac8` | product `apps/desktop/package.json` | Adapt selected versions/scripts only after dependency closure review |
| `packages/maker-core/package.json` | Pi/Maker package boundary and package metadata | 55 / 1,510 | `238fba1f0f0b3c03bf6b6ac5086512e233bc299ec65c061d7258e939a27fb38e` | product-owned runtime package only if needed | Do not infer that package metadata alone makes the Pi adapter portable |

## Observed dependency and host closure

The first-frame renderer is not a self-contained React page:

1. `index.tsx` selects a module graph before React starts. Its default branch
   loads `main-entry.tsx`.
2. `main-entry.tsx` statically loads Inter/JetBrains Mono/HarmonyOS fonts,
   `@google/model-viewer`, i18n, theme colors, global/sortable CSS, settings
   bootstrap modules, diagnostics, and `App` providers.
3. `App.tsx` statically imports auth, worktree/PR, environment, history, remote
   desktop, scheduler, bot/plugin, toast, and provider surfaces before it renders
   the router. This is evidence that copying the entry files alone cannot produce
   a valid product build.
4. `router.tsx` imports the main layout and a broad route inventory. The route
   list includes account/login, CC agent, bots, remote sessions, issue/skillhub,
   scheduler, plugin, and settings surfaces.
5. `MainLayout.tsx` imports right-sidebar/browser/terminal, remote/device,
   scheduler, sharing, updater, credential, and persistence-related modules. It is
   therefore a high-fan-out integration point, not a safe isolated component copy.
6. The Cindy preload and Electron bootstrap are broad host surfaces. They must be
   mapped method-by-method to the product's session/run/tool/store contracts and
   not used as a permissive compatibility proxy.

The sparse reference currently materializes 2,024 renderer files, 2,453 main
files, 23 preload files, and 394 shared files. Renderer assets and tests were
excluded by the sparse checkout, so these counts are not a complete build
closure and do not prove that the source can build in this product.

## Import and exclusion policy

### Candidate reuse in the first source-import commit

- The reviewed renderer entry/layout/theme files above, plus their exact local
  dependency closure after an import script records every copied path.
- Only the Cindy workspace packages required by that closure and by the selected
  Pi adapter; each package gets its own source path, version, checksum, and
  license/notice entry.
- Root `LICENSE` and `NOTICE`, plus every third-party notice required by the
  selected files and dependencies.
- Product-owned adaptation shims in separate files where possible, so the import
  diff remains distinguishable from later application-service changes.

### Explicitly excluded until a separate review

- Cindy accounts, login state, production endpoints, analytics/telemetry, updater
  feeds, credentials, caches, databases, `.env` files, and build output.
- Remote desktop/device relay, browser automation, collaboration, marketplace,
  billing, external messaging/connectors, and other integrations not required for
  the first approved screen inventory.
- Cindy's broad preload object and wholesale `bootstrap-electron.ts`.
- Cindy renderer assets/tests omitted from the sparse audit checkout; no asset may
  be copied without provenance and license review.
- `node_modules`, generated files, lockfile fragments, native binaries, and any
  developer-specific absolute path.

An exclusion is not permission to render a fake success state. A deferred visible
capability must either be removed by an approved screen exception or be represented
by the product's explicit unavailable/error contract.

## Next implementation gate

Before copying application code, produce a file-level import manifest from the
actual selected closure with:

- source path, destination path, source commit, SHA-256, and copied-file license;
- direct/transitive import reason and the destination service/API it calls;
- adaptation reason and a separate patch for every changed reused file;
- native module, build script, generated asset, and runtime resource requirements;
- screen -> renderer entry -> preload method -> host handler -> domain service
  mapping, with `available`, `deferred`, or `rejected` status;
- a reviewable exclusion list and an explicit no-absolute-reference check.

Until that gate passes, keep the current main/pet placeholders and the existing
Tauri/server paths intact.
