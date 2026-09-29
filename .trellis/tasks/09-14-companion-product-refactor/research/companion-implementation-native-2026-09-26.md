# Companion implementation acceptance — 2026-09-26

## Scope and evidence boundary

User approved all recommendations from the latest-build assessment. This report records the resulting pet-first desktop revision. Native evidence comes from the real newly built Tauri app, without mock messages, fixture business records, a replacement provider or demo service. Existing configured service http://127.0.0.1:18081 was unavailable; no model was invoked in this revision acceptance.

## First integrated build and findings

`pnpm tauri build --debug --bundles app` completed at 11:47:54 +08. Exact launched process PID 94155 used `src-tauri/target/debug/bundle/macos/橘伴.app/Contents/MacOS/desktop-ai-pet`, not the older installed application. The preceding hung assessment PID 65297 was verified by its exact executable path and stopped before launch.

Actual native observation:
- Clean pet-only artwork displayed without a visible checkerboard or platform. The standard main viewport was 232×340 logical pixels, captured at 464×680 physical pixels.
- Cat click produced local happy/petting feedback and did not open conversation.
- `聊一会` opened the actual independent conversation window, replacing the earlier reproducible opening timeout.
- First focus landed on Reading rather than the composer. CUA `typeText` did not enter text even after editor focus, while `pressKey('a')` did. Only the first-focus placement is a demonstrated product defect; the typeText limitation is not attributed to the app.
- Real ordinary keystroke and paste entered an unsent draft. Close/reopen and Todo→Memo→settings→back preserved it. The task's draft was then removed through the UI; no message or business record was submitted.
- Actual offline Todo/Memo/settings were reachable. No populated state or streaming claim is made. Compact empty presentation was crowded and auto-scrolled its heading away; sent for a bounded correction.
- Reopening the native pet menu while its popup remained active deadlocked PID 94155. Sample `/tmp/companion-94155-menu-sample.txt` shows Tauri menu popup → nested AppKit menu loop → resource-close IPC → resources-table mutex. This is distinct from the older default-quit sample. The task-owned hung process was stopped after exact path verification. Menu lifecycle correction is required before acceptance.

Independent review also found an open→open completion notification that could outlive hiding, and native close/hide flags committed before fallible operations. Those corrections are tracked separately from runtime proof.

## Second integrated revision (superseded by installed result below)

Second integrated bundle launched as PID 7312; SHA-256 `b3c102ce429932324432e4cd191cd3a76d8cfcb73a34c740c7f5d61d550469f3`. All 99 captured source/asset hashes stayed unchanged during its successful build. Actual visible-window input focus was corrected: after opening and observing the displayed panel, a normal `a` key entered the composer without another click. A key sent immediately with the triggering click, before native presentation, was not captured; no claim is made about pre-presentation keystrokes. Compact offline state now contains one explanation and one recovery action, with a fully visible editor.

Repeated native menu clicks followed by Escape did not hang. Reopening the menu and selecting rest via keyboard produced sustained closed eyes and a wake target; clicking the cat restored awake/happy state. The first eyelid colors were visibly too warm/flat and received a localized near-white feathered correction, pending next native build.

System screenshots were needed because per-window captures excluded the other panel. They exposed a genuine Space mismatch: PID 7312 main4070=(1268,571,232,340), level5 alpha1; chat4071=(536,231,720,680), level4 alpha1, both within the physical display. Both belonged only to Space1; the active ChatGPT full-screen display was Space21. Neither appeared in the on-screen CG window list. The application was not hidden, and raising chat via AX did not fix membership. macOS26.0.1 SDK documents CanJoinAllApplications (13+) specifically for floating windows in other apps' fullscreen spaces. A version-gated native correction is pending verification; window levels/focus are preserved.

System captures are temporary and include unrelated desktop content, so they are not published as product artifacts. Pending final rebuild, composed visibility, size/pin/hide recovery and quit/relaunch checks. Do not treat the second build's off-screen captures as successful desktop display.


## Installed result and final evidence

The final normal build includes the exclusive menu lifecycle, visibility-epoch checks, native transaction ordering, first-open focus, simplified compact empty state, feathered white eyelids and macOS13+ CanJoinAllApplications. `pnpm tauri build --debug --bundles app` passed; all 99 source/asset manifest entries remained unchanged during the build. Binary SHA-256: `e2c6caf4ec2931be66ed3680a438a8fca2bdfc475782761a4ef8d25950082afa`.

The built bundle was first tested as PID14749. It was then copied into `/Applications/橘伴.app` after clean Cmd+Q exit. The older installed app was preserved at `/Users/zhoujiaangyao/Library/Application Support/desktop-ai-pet/app-backups/20260926-122443/橘伴.app`; the installed binary hash exactly matches the built binary. Installed PID25217 passed launch/hide/quit. Relaunch now runs PID26334 from `/Applications/橘伴.app/Contents/MacOS/desktop-ai-pet`, leaving the cat visible at standard size with pinning enabled. User records, provider configuration and unrelated working-tree changes were preserved; no model, fixture service or business-record write was performed.

| Scenario | Evidence and result |
|---|---|
| Real composed pet and compact panel | Passed on macOS26.0.1,1512×982 logical Retina display, another app's full-screen Space21. Both native windows occur in CG optionOnScreenOnly; Space membership includes21; levels5/4 retained. Regional system capture shows both together without overlap. Independent details in native-space-2026-09-26.md. |
| Pet touch vs chat | Real cat click produces local happy response, stays on desktop. Explicit labelled chat action opens the panel. |
| First-open typing | After the panel is visibly open, a normal key reaches composer without a separate editor click; focus reported on composer. Pre-presentation keystrokes are not covered. |
| Short/read layouts and draft | Real unsent draft survives explicit reading expansion and return. Earlier same-revision flow verifies close/reopen and offline Todo/Memo/settings/back. Only task-created draft text was cleared. |
| Rest/wake and artwork | Actual rest action and sustained idle close the eyes; pet click wakes. Final near-white feathered eyelids observed in composed and individual captures. No checkerboard/platform visible. |
| Native menu reentry | Repeat menu clicks and Escape no longer hang; reopen and action selection work. |
| Three sizes | Real menu selection produces small372×544, standard464×680, large558×816 physical captures, with controls visible. Restored scale1.0. |
| Pinning and persistence | Toggled off via menu; persisted JSON reports alwaysOnTop=false and actual window layer0. Restored true; subsequent installed restart preserved scale1.0/true. |
| Hide | Installed app menu action hides all pet/chat windows; CG onScreen returns no matching windows while process stays running. |
| Tray-click recovery | Implemented and independently source-reviewed but NOT directly automated. Current CUA surface cannot address the system status item; SystemUIServer/ControlCenter lookups time out and no window remains after hide. Do not claim a successful tray-click flow. |
| Quit/relaunch | Cmd+Q exits both visible and hidden installed instances without the earlier menu deadlock. Normal installed launch restores visible default cat; final process26334 remains running. |
| Real model/stream/tool/history data | Not verified for this installed build: saved server127.0.0.1:18081 has no listener. Honest offline state shown; no fake responses/data. Prior task real-model results are historical, not evidence for this build. |
| Other displays/reduced motion/full original matrix | Not claimed in this revision. Existing isolated regression coverage is retained; hardware matrix remains open. |

## Checks and delivery boundary

Focused frontend behavior tests, TypeScript, relevant conversation/pet/menu lifecycle verifiers, Rust preference3/geometry8 tests, Rust checks and normal native builds passed. Counts from overlapping targeted runs are not summed. No lint command exists; scoped diff whitespace checks pass. Independent review found and repaired the visibility race and coordinated menu/native transaction/focus fixes.

PRODUCT.md, DESIGN.md, .impeccable/design.json and frontend companion-experience.md now record the current authorized design. Original artwork is retained; generated pet-only art and matte carry provenance and embedded exact prompts. The larger September14 task remains in progress because its full acceptance matrix and tray-click/model checks are not complete. No blanket commit, push or task archive was performed: this workspace contains substantial pre-existing overlapping frontend/native and unrelated server/admin changes.
