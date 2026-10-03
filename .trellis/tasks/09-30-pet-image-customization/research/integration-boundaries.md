# Custom pet integration boundaries

Evidence: source inspection on 2026-09-30. These are planning findings, not implemented or runtime-verified behavior.

## Shared requirements across both candidate input workflows

- Keep the built-in cat and its mask immutable as the default preset. PetStage currently fixes the companion viewBox and mask to the default art. Custom assets require their own dimensions, alpha and alignment metadata; substituting only an image URL is insufficient.
- Store imported/processed assets in an application-owned directory, never retain an external file-picker path as the durable reference. Moving the original upload must not break a saved pet. Do not put images or external URLs in the business database or connection configuration.
- Use a versioned customization manifest separately from CompanionPreferences. That existing Rust type is Copy and rejects unknown fields, so adding arbitrary nested assets directly would change existing preference and tray contracts unnecessarily.
- Load and decode required images before activating a preset. An interrupted import/generation or a failed persistence operation must keep the previous active preset. Activation references only a complete validated asset set.
- App.tsx currently subscribes to companion:preferences-changed before fetching preferences. Customization must synchronize both main and chat windows, including closed/reopened chat and a missed event. Use an authoritative revision to prevent an older initial fetch overriding a newer selection.
- lib.rs set_companion_preferences serializes writes and distinguishes successful persistence from a subsequent event/menu refresh failure. Apply the same result distinction to preset activation; do not return an ambiguous failed save after committing a preset.
- Existing capabilities permit window controls; no file-picker plugin is installed in the inspected capability file. Decide bounded import transport with implementation: native selected-file import or frontend file bytes with a validated Rust command. Do not grant unrestricted filesystem access just for uploads.
- Existing CSP allows self/asset images. Rendering durable app-owned image files requires a narrowly scoped asset protocol or validated image-byte delivery. A temporary browser object URL does not prove restart recovery.
- Theme changes need both the global tokens and companion/pet aliases. ChatBubbleFrame.css defines its own pet tokens; changing only :root --primary cannot deliver a coordinated theme. Enumerate actual companion overrides and controls before edits; old reference-mode colors are not automatically in current UI scope.
- Preserve shape, spacing, native hit bounds and independent window placement. Skin changes should affect image fitting and palette, not cause a new navigation or resizing model. Keep supported sizes, reduced motion and readable focus/error states.

## Observable acceptance matrix

| Requirement | Necessary evidence |
| --- | --- |
| Upload few images | Real native file selection, actual decode, reviewable imported images; no seeded substitute |
| Custom pet | Applied desktop image, interaction/rest behavior and aligned transitions beside controls |
| Matched theme | Main/chat windows plus chat, Todo, Memo and connection settings; hover/focus and error states |
| Durable ownership | Move the original selected source after saving; saved pet still loads |
| Restart recovery | Relaunch the built app and see the selected pet and matching theme |
| Cancel/failure | Previous preset remains selected and usable; no incomplete asset set becomes active |
| Restore default | Original cat, mask and warm palette return in both windows |
| Generation, if selected | Actual provider request and resulting assets, cancellation/retry and no false completion |
| Business isolation | Existing chat/Todo/Memo records and model configuration preserved |

## Decisions still pending

Input workflow remains a user decision: ordinary references with automatic image production versus already prepared transparent state images. No provider, model, network upload, image counts or generated-animation claim is selected by this research. The existing chat client does not establish image-generation capability.

GitHub publication remains a prerequisite to implementation under the user's requested order. Rechecked publication copy: clean worktree, no remote configured. Root commit already exists; do not recreate it or infer repository visibility from elapsed time.
