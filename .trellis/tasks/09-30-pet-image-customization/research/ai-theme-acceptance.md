# AI theme import acceptance ledger

## Authorized flow

User explicitly chose AI design from uploaded images, covering colors, material and controls. Fixed palette gallery is rejected. Source for native acceptance: the already selected real calico photo at `/tmp/calico-reference.jpg`, whose Wikimedia provenance is in `calico-real-result.json` and the prior acceptance notes.

## Required chain

- Native reference chooser imports the actual photo; disclosure identifies configured vision model and endpoint.
- One real analysis request returns a valid ThemeDesign; preview is visibly linked to this selection.
- Pet generation consumes that ready draft and freezes its theme. No output palette overwrites the AI design.
- Apply propagates colors/material/control styles to companion, chat, tasks, memos and settings; real existing records or empty states only.
- Reopen/restart preserves the exact saved theme; old presets and original images remain preserved.
- Focused static tests cover replacement/clear/retry fencing, bad responses and persistence. These are separate from runtime evidence.

## Evidence status

Pending new implementation/build. Existing native app currently loads real saved chat history successfully; no new chat/model request was made during this baseline observation.

## Data preservation

`ai-theme-before.json` stores the pre-change active selection, themes, request counts and image hashes without secrets. Source images are never edited.

## Static / unit evidence

- Implementer: Rust customization 33 tests passed; frontend 50 tests passed; TypeScript passed.
- Independent check: fixed actual material-gradient contrast, legacy preview inheritance and technical radius chip; 27 focused tests passed, TypeScript and diff checks passed.
- These tests use identified unit fixtures and make no claim about actual model execution.
- Native build started after the final source freeze; runtime evidence follows below.

## Native first pass

- `pnpm tauri build --debug --bundles app` succeeded after source freeze (session 59222).
- Launched the resulting debug bundle. Existing 三花 active, real saved chat history visible; no credential prompt blocked initialization.
- Native new-companion screen displays the actual configured vision endpoint/model and automatic one-request disclosure. Fixed palette gallery is absent; source photo chooser opens.
- Automated native file-picker confirmation did not respond to Return, selected path row or open action. Path `/tmp/calico-reference.jpg` is entered and a manual confirmation request is pending. No vision request was dispatched yet, and no generated theme/runtime success is claimed.
