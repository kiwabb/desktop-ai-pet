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

## Warm custom palette contract

`petTheme(accent: string)` derives display tokens without changing the stored seed or generated assets. Low-chroma fur (including gray, black and white) must produce warm cream surfaces, cocoa text and apricot action/selection colors. A chromatic seed may coordinate the accent, but must not mechanically tint all surfaces. Existing saved presets receive the same derivation on startup and preview; no regeneration or silent persistent-data migration is required.

Keep paired text contrast at least 4.5:1 and visible focus/control indicators at least 3:1. Regression coverage must include the actual gray seed `#756a69`, neutral extremes and chromatic inputs. Preserve semantic success/error colors.

Wrong: mix the fur RGB with white/black for every token and declare success because colors propagated. Correct: derive colors by UI role, then inspect the actual native pet controls, compact/expanded chat, Todo, Memo, settings and customization with real saved content. Technical checks and visual acceptance remain separate evidence.

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
