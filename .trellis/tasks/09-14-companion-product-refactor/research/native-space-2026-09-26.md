# Native Space visibility diagnosis — 2026-09-26

## Evidence level and scope

Real runtime, read-only inspection of the task-built macOS application, PID `7312`. No application restart, UI action, application compilation, model request or business-data change was performed during diagnosis. This record contains only target-app window metadata and the active display/Space identifiers; unrelated window contents are omitted.

A per-window capture and accessibility interaction had exposed the pet/chat surfaces, while the coordinator's whole-display capture did not show either surface. These are different evidence levels: accessibility availability and offscreen window capture do not establish participation in the current desktop composition.

## Observed state

Host: macOS `26.0.1`, build `25A362`. Active display bounds: `(0, 0, 1512, 982)` in logical display coordinates.

`CGWindowListCopyWindowInfo(optionAll)` returned:

| Target surface | Window ID | Bounds `(x, y, width, height)` | Layer | Alpha |
| --- | --- | --- | --- | --- |
| Main pet | 4070 | `(1268, 571, 232, 340)` | 5 | 1 |
| Chat | 4071 | `(536, 231, 720, 680)` | 4 | 1 |

Neither target window appeared in `optionOnScreenOnly`. Both rectangles were inside the display bounds. `NSRunningApplication` reported `isHidden=false`, `isActive=false`, `isTerminated=false`, and accessory activation policy. A direct `AXWindows` read succeeded with an empty array, so this read did not establish either window's minimized state.

A read-only `CGSCopySpacesForWindows(connection, 7, [windowID])` query returned `[1]` for both target windows. `CGSCopyManagedDisplaySpaces` identified the display's current full-screen Space as `21`. These private APIs were used only for diagnosis, not added to the application. The coordinator separately reported that an accessibility Raise did not make the target windows appear in the on-screen list.

The confirmed runtime gap is Space membership: the application windows remained assigned to ordinary desktop Space `1`, while the displayed full-screen Space was `21`. Off-screen coordinates, zero alpha and application-level hiding do not explain these observations. No external-process read of the panels' current `collectionBehavior` or `isVisible` was obtained; their intended flags were checked in the source.

## SDK contract and focused fix

Local SDK reference: `/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/System/Library/Frameworks/AppKit.framework/Headers/NSWindow.h`, lines 94–98 and 147–149.

The SDK defines `NSWindowCollectionBehaviorCanJoinAllApplications` for macOS 13+ and describes it as allowing eligible floating windows/overlays to join other applications' sets and full-screen spaces. It is one of the mutually exclusive `Primary`, `Auxiliary`, and `CanJoinAllApplications` behaviors. The existing configuration used `CanJoinAllSpaces`, `FullScreenAuxiliary`, `Stationary`, and `IgnoresCycle`, with none of those three newer categories selected.

`make_visible_on_every_space` now adds `CanJoinAllApplications` when `NSProcessInfo` confirms macOS 13 or later. Existing collection flags, panel levels, activation policy, focus behavior and hide-on-deactivation policy remain unchanged. The application does not use private Space APIs or elevated system/security window levels.

## Verification and remaining acceptance

- `cargo check --manifest-path src-tauri/Cargo.toml --locked` passed in 38.95 seconds. The scoped `git diff --check` also passed. These validate the Rust/API change, not current-desktop presentation.
- No post-fix runtime result is claimed here. The coordinator must rebuild and verify both target windows in the current full-screen desktop using `optionOnScreenOnly` plus a whole-display capture.
- Repeat explicit chat open/immediate input, hidden-to-visible recovery and normal desktop placement. Check that initial launch and local pet interaction do not activate another application or steal focus.
- Compatibility below macOS 13 is preserved by the runtime guard but has not been tested on older hardware/OS versions.

## Post-fix runtime confirmation — 12:07:17 +08:00

The coordinator rebuilt and launched the fixed application as PID `14749`. This agent took a read-only snapshot at `2026-09-26T12:07:17.636691+08:00`, before the subsequent menu/size/hide-recovery checks changed the state. No UI action, source edit, build or restart was performed for this verification.

| Target surface | Window ID | Bounds `(x, y, width, height)` | Layer | Alpha | On screen | Space membership |
| --- | --- | --- | --- | --- | --- | --- |
| Main pet | 4091 | `(1268, 571, 232, 340)` | 5 | 1 | true | `1, 21, 27` |
| Chat | 4092 | `(536, 231, 720, 680)` | 4 | 1 | true | `1, 21, 27` |

Both windows appeared in `CGWindowListCopyWindowInfo(optionOnScreenOnly)`, and the all-windows entries also carried `kCGWindowIsOnscreen=true`. The current display remained on full-screen Space `21`. Unlike the pre-fix windows, both target windows now included that Space in their membership. Their bounds, alpha and layers were unchanged from the pre-fix observations.

The coordinator supplied `/var/folders/ys/cjf2rbtd03lg_fclhtmcmgn80000gn/T/codex-shot-2026-09-26_12-06-26.png`. Independent inspection of this composed capture shows the pet and compact conversation surface together with a clear gap and no mutual occlusion. The panel displays its real disconnected state; this observation makes no model-invocation claim. The capture and native on-screen/Space metadata together establish that the fixed windows participate in the current desktop composition on this host.

This closes the specific cross-application full-screen visibility regression for macOS 26.0.1 on the observed display. Menu actions, size presets, hide/tray recovery, focus behavior and other display/OS configurations remain separate acceptance items owned by the coordinator.
