# Research: Optional per-preset companion badge

- Query: User requests 猫爪也要支持改变. Locate safe extension points without choosing between uploaded image, generated matching mark, and independent color.
- Scope: internal source inspection; no implementation or native acceptance.
- Date: 2026-10-03

## Findings

### Current behavior and files

- `src/components/ReferenceIllustrations.tsx:45`: `ReferencePawBadge` is the approved decorative SVG (125:139 ratio, three toe pads and main pad); accepts className only. Preserve this built-in fallback and do not introduce another cat avatar.
- `src/components/ChatBubbleFrame.tsx:197`: companion header renders that mark; line 183 is the separate legacy outer badge. Scope customization to companion header unless explicitly requested otherwise.
- `src/components/ChatBubbleFrame.css:661`: companion mark width 28px, original aspect preserved. Lines 704–705 already recolor custom-pet sticker/pads through theme variables, so user request goes beyond an entirely unthemed mark. Independent color should use badge-only variables, preserving ordinary action colors and immutable default.
- `src/lib/customization.ts:7`: `PetPreset` only has id/name/accent/created_at/four-state asset map; no badge property. `loadPetSprites` (line 15) fetches/decodes exactly four pet states.
- `src/components/PetCustomization.tsx:63`: preview draft hydration and sprite loading. Lines 107–115: local theme preview, edit fields, separate Save and Apply actions. Add badge preview here before persisting; do not apply draft globally.
- `src/lib/useCustomization.tsx:65`: assetIdentity currently includes only preset id and serialized pet asset metadata. Name/accent updates hydrate active preset through a separate effect; a new badge field must be included in the appropriate identity/effect dependencies or active header stays stale. Subscribe-before-fetch and monotonic revision guards already exist.
- `src-tauri/src/customization/mod.rs:25`: persisted Rust Preset. `customization_update` (556) validates name/accent, commits one revision, publishes. `customization_asset` (220) serves bounded app-owned PNG bytes for authorized preset/job. `commit` (173) saves before replacing in-memory state.
- `src-tauri/src/customization/storage.rs:12`: fixed allowed asset kinds; line 53 constructs UUID-scoped app-owned paths with symlink rejection. Badge image needs an explicit safe identifier contract, never an arbitrary external path. `load` (90) supports version 1 and validates presets; `validate_preset` (133) requires the four pet states.
- `src-tauri/src/customization/assets.rs:76`: generated pet validator normalizes to 768×960 with ground anchors. A header mark should have its own bounded raster normalization, not reuse pet alignment.
- `src-tauri/src/lib.rs:1211`: command registration location if a separate import/update badge command is needed.

### Alternatives, without selecting scope

1. **Independent colors:** optional serde-defaulted badge color configuration on each preset, validated hex values, badge-local CSS variables and controls. No extra provider call or asset file. Missing config means existing theme-following behavior. Shape remains approved SVG. Least state/IO scope.
2. **Uploaded mark:** optional raster badge metadata and application-owned normalized PNG, preview, explicit save/apply, restore original mark. Reject unsupported/signature-invalid/oversized files; keep external source read-only. Display inside the existing 28px mark slot without distortion. Missing/bad optional badge should fall back to SVG and warn, not invalidate an otherwise healthy pet.
3. **Generated matching mark:** requires separate explicit provider request/stage, visible extra request count/cost, cancellation and retry fencing; reference the actual generated character. Do not silently make the four-state pipeline five requests, and do not claim automatic mark quality from tests. Reuse the uploaded-mark persistence/rendering contract after output validation.

### Compatibility and state risks

- Additive optional fields with `#[serde(default)]` allow existing saved presets to load. Define omission versus explicit reset carefully: ordinary name/accent updates must not erase a badge.
- For image replacement use immutable asset generation IDs or similarly transactional storage. Overwriting a fixed badge.png before manifest commit can alter active appearance despite save failure; filename reuse also defeats frontend load identity unless a content revision changes.
- Predecode optional badge before final apply; preserve current pet on required asset failure. Optional badge failure should have its own fallback semantics.
- `customization_retry` at mod.rs:500 clones only the four pet states plus references into a new ID. Ready construction at 762 builds a fresh Preset. Explicitly decide whether a redone preset inherits badge/color; otherwise the new metadata silently disappears. Do not change retry semantics merely by adding a fifth KINDS member.
- Existing Save for an active preset immediately publishes changes; Apply performs update then activate, two commits. Keep UI copy truthful and avoid promising atomic combined activation across those two operations.
- Deletion already removes the preset's entire assets directory after manifest commit; placing badge files inside it retains cleanup ownership. Preserve source files.
- Focused checks: old JSON missing field, validation rejection without mutation, save failure preserving original, badge change on same active id, stale-load guard, fallback on missing optional asset, default restoration, restart and both windows. Native review needs badge beside actual cat and real panel, not only a magnified standalone mark.

### Related specs

- `.trellis/spec/desktop/pet-customization.md`: independent storage, explicit preview/apply, revision synchronization, real evidence.
- `.trellis/spec/frontend/companion-experience.md:37`: approved header mark aspect, decorative semantics, no second avatar; user-requested optional custom mark may extend this while preserving default.
- `.trellis/spec/frontend/component-guidelines.md`: legacy paw positioning constraints should not leak into companion rendering.
- Task PRD/design/implementation plan: four generated pet states; no existing badge scope.

### External references

None needed for this bounded internal contract research. No network/provider calls performed.

## Caveats / Not Found

- User choice between uploaded image, generated mark, and independent colors is still pending. This report does not authorize any option.
- `research.jsonl` is absent; research-only role did not read implement/check manifests.
- No code changes, builds, native interaction or credential access performed. Prior memory reinforced native-evidence separation only; all implementation findings above were checked against current source.

## Implementation boundary 2026-10-03
Main session authorized uploaded per-preset raster mark after user continued. Local draft preview; explicit existing Save/Apply persists. Optional immutable badge UUID in preset, reset is explicit, omitted update preserves badge. Four-state generation unchanged. Missing optional mark falls back to approved paw with warning. No provider calls or credentials. Native acceptance belongs to main session.

### Superseding scope and patch verification

The human clarified “按照上传的图片定制” during implementation. The main session authorized **generated matching paw**, superseding the initial upload-only interpretation before any upload UI shipped. The implemented action uses the existing generated base character as its reference; a separate square `images/edits` call generates one matching paw. Four pet stages remain unchanged. `badge_job` persists independent request count/status and candidate UUID; no silent activation. Mutually exclusive image tasks and explicit cancellation fence late work. Restart changes running badge job to interrupted without replay. Optional preset `badge` is serde-defaulted; absent update preserves it, explicit reset clears both the saved mark and that preset's pending candidate.

Source verification (2026-10-03): Rust filtered customization suite 24 passed; TypeScript app no-emit check passed; customization loader and existing settings focus/connection component suites 11 passed. New tests cover old preset compatibility, same-ID badge commit/reset, missing candidate rejection, old/cancelled work fences, restart interruption, transparent normalization and optional corrupt-mark fallback. Fixtures are test-only. No generation requests, credentials, real-state writes, native acceptance, bundle build or Git commit were performed by implementer. Main session owns real provider/visual/persistence acceptance.
