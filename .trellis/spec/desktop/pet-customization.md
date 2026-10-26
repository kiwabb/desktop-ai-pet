# Pet customization contracts

Scope: ordinary reference images -> provider-generated pet states -> matching appearance. User approved this workflow on 2026-09-30. Implementation and native acceptance status live in `.trellis/tasks/09-30-pet-image-customization/`; this specification is not evidence of shipped behavior.

## Ownership

Customization storage, image-provider settings and credentials are separate from agent configuration, SQLite business records and companion size/pinning preferences. The built-in cat remains an immutable default preset. Import copies assets into app-owned storage; original files are never edited. Never apply the built-in cat mask to a custom image.

## Image and provider boundary

Accept 1–4 explicitly selected ordinary image files. Enforce encoded byte and decoded pixel limits before expensive processing; validate actual signatures and decode, not extensions alone. Preserve orientation and alpha during normalization and exclude unrelated metadata from uploaded copies. Provider responses are untrusted, bounded and validated before persistence or rendering. Opaque checkerboards are not transparent assets.

Use a separate configured image endpoint/model/key and a dedicated system-credential namespace. Chat credentials and conversation history are not implicit image inputs. Only HTTPS or explicitly allowed loopback HTTP endpoints; do not forward credentials through cross-host redirects. UI/state/events/logs never include credential values or source image bodies.

Image generation is real work with visible stages. No simulated successful jobs, automatic retries of ambiguous paid requests or automatic restart replay. Cancellation fences subsequent results but must not promise provider-side cancellation/refund. A retry preserves valid prior stages and is an explicit user action.

## Persistence and synchronization

Validate complete assets before registering a ready preset. Commit active selection atomically and serialize conflicting mutations. Preserve the prior active preset when validation/save fails. Separate a successful durable write from a later event-delivery failure.

Every appearance snapshot/event carries a monotonically ordered revision. Both windows subscribe before initial fetch and reject stale snapshots. Preview is local and does not alter active appearance; activation preloads/decodes required states and updates pet and panel together. Restart uses authoritative saved selection. Missing/corrupt custom assets yield a visible recoverable warning and usable default rather than an invisible pet.

## Presentation

Generate base, closed-eye, happy and talking assets with a stable character identity, shared proportions and consistent ground anchor. CSS movement may complement states but cannot substitute for the promised generated state assets. Extract theme color from the character, not the reference-photo background; validate paired text/control contrast. Theme covers companion controls, compact/expanded chat, Todo, Memo, settings, hover, selection, focus and semantic status styles. Restore-default restores the complete original visual identity.

## Legacy character-matched palette contract

This section only governs legacy presets without a saved complete theme. New complete themes follow the contract below. User rejected both full gray surfaces and blanket apricot recoloring (2026-10-03). `petTheme(accent: string)` must honor the selected color, including low-chroma hues, instead of substituting the built-in white cat's orange palette. Use near-white ivory reading surfaces, taupe text and bounded tints/shades of the selected accent for actions/selection. The built-in default theme remains separate.

Choose a distinctive actual character detail when dominant fur gives an unsuitable action color. Current 小虎 was manually art-directed from its real iris pixels: sampled seed `#b3a469`. This is a curated preset adjustment, not evidence that automatic extraction now detects eyes. No hardcoded gray-cat-to-green rule.

Keep paired text contrast at least 4.5:1 and focus/control indicators at least 3:1. Tests cover sampled iris color, low-chroma hue retention, neutral extremes and saturated inputs. Preserve semantic statuses. Native review must include cat/controls, compact and expanded chat, Todo, Memo, settings and customization with real contents or real empty states. Color propagation and contrast tests alone are not visual acceptance.

## Evidence

Unit fixtures must be identified as fixtures. Real completion requires native image import, actual configured provider generation, preview/application, coordinated surfaces, source-file relocation, reopen/restart recovery, cancellation/failure recovery and default restoration. Builds/ports/rendered static mockups do not prove this chain. Preserve existing chat, business data, dragging, size, pinning and tray recovery.

## Explicit reuse of the chat connection

### Scope / trigger
Only the explicit “使用聊天连接” action copies the single-machine chat connection. User authorized this on 2026-10-02; startup and generation must not implicitly copy it.

### Signature
`customization_use_chat_connection({ model: string }) -> View`.

### Contract
The Rust command copies the current local chat endpoint/key to independent image settings and a dedicated image keyring account. It preserves the supplied image model. No key is returned through IPC or events. Chat settings remain unchanged.

### Validation and errors
Reject invalid/empty image model, server mode, absent chat configuration/key, running image job, credential failures, and changed source generation/endpoint/key or customization revision. Keyring reads, writes and cleanup happen outside state locks. Roll back the new keyring account on failed commit; retire the old image account only after successful commit.

### Cases
Good: explicit action with configured local chat copies the address/key and retains `gpt-image-2`. Base: no action leaves independent image settings untouched. Bad: changing chat settings while copying rejects the stale result.

### Required tests
Check source generation/config mutation rejection, mode rejection, UI action payload retaining image model, success using returned saved endpoint/has_key, and no credential field in returned View. Native validation must show saved state without exposing secrets.

### Wrong versus correct
Wrong: send the chat key to JavaScript or copy it at startup. Correct: explicit IPC action handles the secret entirely in Rust and returns only non-secret settings metadata.

## Generated per-pet paw mark

### Scope / trigger
User clarified on 2026-10-03 that the paw mark should be customized from the uploaded pet image. Use the saved generated base (derived from those images) for one explicit additional image edit. Preserve the approved built-in paw as default/reset/fallback. A mark is a small paw graphic, never a duplicate cat avatar.

### Signatures
- `customization_badge_start({id: presetID}) -> View`
- `customization_badge_cancel({id: badgeJobID}) -> View`
- `customization_update` accepts optional `badge: {action: 'select', token: UUID} | {action: 'reset'}`. Omission preserves the current mark.
- `Preset.badge: UUID | null` and `View.badge_job: {id, preset_id, status, request_count, result, error} | null`, missing fields default safely for existing stores.

### Contracts
A separate persisted badge job uses running/ready/failed/cancelled/interrupted states and is mutually exclusive with the four-state pet job. It references the saved pet base, uses a square transparent PNG request and counts each dispatched provider attempt. It must not alter KINDS or silently turn the four-state job into five requests. UI identifies the extra image request before starting. No automatic retry/replay.

Successful output is a normalized immutable `assets/<preset>/badge-<UUID>.png` candidate; result generation does not activate it. Asset reads authorize only the preset's saved mark or its current ready candidate. Explicit selection commits the ready candidate; reset clears only the optional mark. Saved marks remain readable after a later generation job. Reset preserves the existing ready candidate and request count; choosing that candidate again is a local preview action, not another paid call. Initial ready-state hydration must not silently undo a user reset. Both windows observe revision changes; appearance loads include the badge token in their identity and fence stale decode completions. The current combined loader also rereads the four pet sprites on a badge-only change; this is an efficiency limitation, not a separate correctness claim.

### Validation and errors
Bound bytes, dimensions and decode; validate PNG transparency and actual subject before accepting generated output. Reject malformed IDs, unknown presets, wrong-preset or stale candidate selection and conflicting running jobs without changing active appearance. Credentials are read outside state locks. Cancellation fences late responses; restart marks running work interrupted without another provider request. Missing/corrupt optional badge falls back to original paw with a visible warning, preserving valid pet states.

### Cases
Good: existing 小虎 base -> one real image request -> candidate preview -> save -> all panel headers share that mark. Base: older presets with no badge show original paw. Bad: cancelled/stale output must not replace saved mark, and failed save must not overwrite an active file.

### Required tests
Old-store compatibility; optional omission/reset; path and candidate ownership; invalid image rejection; save failure keeps active state; cancellation fencing; same-preset badge refresh; missing optional image fallback; original-paw restoration. Native acceptance additionally requires actual provider response, preview before apply, header update, reopen/restart and reset using real assets.

### Wrong versus correct
Wrong: overwrite badge.png before manifest commit, reuse pet-sprite cache identity, silently add paid generation, or declare placeholder marks generated. Correct: immutable candidate tokens, revision-aware independent badge loading, visible explicit request and real result inspection.


## Legacy locally generated theme palettes (superseded for new imports)

### 1. Scope / trigger
This section records compatibility for saved local palettes. The user rejected the fixed palette gallery for new imports on 2026-10-03. New imports follow the AI design contract below. Legacy local palette edits do not dispatch provider requests or modify pet/badge image bytes.

### 2. Signatures
- `Preset.theme: Theme | null`, `Preset.colors: string[]`, `Preset.colors_version: number` default to absent/empty/zero for old stores.
- `Theme = {palette, primary, secondary, strength}`.
- `customization_update(..., theme?: Theme)` augments the existing update command; omitted theme preserves the stored complete theme.
- `presetTheme(accent, theme?)` renders the complete theme when present; absent theme uses legacy `petTheme(accent)` exactly.

### 3. Contracts
Palette identifiers: `character`, `apricot`, `rose`, `mint`, `sky`, `lilac`, `custom`. Primary and secondary are six-digit hex colors; strength is an integer from 0 through 100. Complete theme primary is authoritative for display. Saving an explicit theme synchronizes the legacy accent with its primary.

On local load, presets lacking candidates or with an older `colors_version` obtain up to four colors from their saved base (current extraction version 2). This backfill must not select a theme or overwrite the old accent. New generated presets receive a complete character theme with default strength 65. Candidate extraction ignores transparent edges; a chromatic cluster must meet both absolute chroma >=35 and relative chroma >=24%. Within meaningful clusters, sqrt(population) × chroma² favors distinctive coat colors without allowing a white/gray majority to dominate. This is pixel analysis, not semantic eye recognition.

Draft selection, strength and advanced editing stay inside customization preview. Save/apply uses existing durable revision broadcasts. Metadata-only theme changes update both windows without sprite reload; stale image completions cannot overwrite new metadata. Existing generated raster badges keep their pixels; original SVG marks inherit tokens. Built-in default remains unchanged. Rich themes expose `--companion-control-line` with at least 3:1 contrast against role surfaces for actual input boundaries; decorative `--companion-line` remains subtle. Legacy themes reset the new token to their old line value to prevent inheriting a rich theme from a surrounding preview.

### 4. Validation / error matrix
Unknown palette, malformed hex, out-of-range strength, excess/invalid candidates -> reject invalid update/store without replacing durable valid state. Missing old fields -> legacy appearance. Missing base during candidate backfill -> preserve existing scheme and existing asset recovery behavior; no provider call. Theme omission -> preserve full theme, not reset to single color.

### 5. Good / base / bad cases
Good: choose a calico-derived character theme, preview independently, save and activate; every companion surface follows the same roles. Base: an old gray-tabby scheme keeps its curated iris seed until selection. Bad: repaint all old schemes at startup, derive only gray/white from calico fur, or trigger image generation to change theme.

### 6. Required tests
- White/gray-dominant character extraction retains substantial colored regions and ignores transparent saturated noise.
- Legacy serde/load compatibility; candidate backfill preserves selected appearance; update omission preserves full theme.
- Six palette role sets and strength extremes; text/placeholder >=4.5:1 and focus/control indicators >=3:1, including arbitrary dark/saturated input colors.
- Preview isolation, reset to saved, save payload and same-preset theme propagation without sprite reload.
- Native acceptance: real saved characters, visibly distinct palettes, cross-surface apply, close/reopen, restart, unchanged assets and request counts. Unit fixtures are not runtime proof.

### 7. Wrong versus correct
Wrong: a lone colorwell, a gray canvas with one recolored button, or an unlabeled simulated conversation used as proof. Correct: named multi-color choices, concentration and advanced editing, explicit component color specimen, authoritative save/apply state and separately recorded real native observations.


## AI visual design on reference import (2026-10-03)

### Scope and authority
The user explicitly chose AI design of colors, panel material and control style when an image is imported. The fixed six-theme gallery is rejected and must not return under another name. Existing stored themes remain compatible; default and saved pet assets are preserved.

### IPC and data contract
- `customization_theme_prepare({images, selectionId}) -> View` validates and normalizes the selected ordered image set, stores immutable app-owned copies, then automatically starts one bounded vision request.
- `View.theme_draft` exposes id, selection_id, attempt, status, request_count, validated theme and error; no image bodies or credentials in events. One current draft is retained.
- `customization_theme_retry({id})` explicitly advances the attempt. `customization_theme_clear({id})` clears only the matching draft and fences any pending work.
- `customization_start({name, draftId, themeAttempt})` requires that exact ready draft, then freezes references and theme into the pet job. Pet generation completion saves that theme unchanged. Legacy jobs without a frozen theme retain compatibility recovery.
- `Theme.design?` is version 1: bounded name/summary, eight hex semantic colors, matte/paper/glaze material, radius 12–24, border_width 1–2, shadow 0–3, soft/solid/outlined control style. Reject unknown fields and invalid values.
- `Theme.source?` contains the actual model and generation time assigned by Rust. A local palette has no AI provenance.

### Provider and lifecycle
The import UI discloses the configured analysis endpoint/model and one vision request before file selection. Use the current local chat connection through Rust only; neither chat history nor tools are sent. This dedicated request does not copy chat settings into image generation settings. Downscale normalized reference copies for analysis; bound bytes, response and timeout; disable redirects. Credential access occurs outside customization locks. Recheck source config and draft/attempt after credential waits, before dispatch and before accepting results. Count actual dispatched attempts; no automatic retry or restart replay.

The frontend assigns a selection epoch synchronously, serializes prepare submissions, and ignores any result not matching the current selection. Replace, append, remove and clear invalidate prior previews immediately. Cancellation does not claim provider-side refund. Restart marks running analysis interrupted. Invalid/unsupported model responses produce a real error with explicit retry, never a fixed success theme.

### Rendering and persistence
Render only whitelisted CSS tokens. Material and control style must visibly affect the actual surface/control roles, with SVG frame and DOM using compatible treatment. Preserve native geometry, clipping budget, reduced motion and semantic state clarity. Enforce text contrast >=4.5:1 and focus/input boundaries >=3:1; model color proposals do not override readability. Preview remains local until save/apply; cross-window metadata updates do not regenerate sprites. Generated raster paw marks retain their pixels.

### Evidence and required tests
Test stale completion after replacement/clear/retry; one request per import action; immutable refs/theme freezing; invalid JSON/schema/source handling; bounded timeouts/cancellation; old-store round trips; materials/control tokens and contrast; preview isolation and exact apply payload. Real acceptance must show native import of the selected reference, a real model result with request count, meaningful preview, saved theme identity, cross-window application and restart. Unit fixtures are never presented as generated themes or real conversation data.
