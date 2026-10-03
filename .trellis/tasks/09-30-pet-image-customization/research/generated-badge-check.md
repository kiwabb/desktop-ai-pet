# Generated paw check — 2026-10-03

Evidence: source review and unit/static verification only. No native build, UI interaction or paid generation was performed by this reviewer.

## Fixed
- assets.rs: normalized badge output is validated after resizing; stored opaque PNG is rejected so an optional invalid badge falls back instead of showing a solid tile. Added opaque-output rejection assertion and transparent persistence fixture.
- useCustomization.test.tsx: migrated outdated loader mock to loadPetAppearance (two previously failing tests); added same-preset badge change/reset and stale decode completion regression coverage.

## Checked
- Separate badge job and immutable UUID candidates; explicit request, ready preview and selection; no automatic retry.
- Mutex-free credential wait, current running-job ID guard on completion, cancel/restart fencing, mutually exclusive pet/badge jobs.
- Read authorization for saved or current ready candidate, UUID kind validation, candidate ownership check, save-before-state replacement.
- Optional invalid badge preserves valid pet; default/reset rendering retained.
- Reuse followup reviewed: reset retains the paid ready candidate/count; reopening does not auto-select it; explicit reuse stages a draft without provider dispatch.

## Verification
- Rust customization unit suite: 24 passed (after validator fix).
- Frontend customization + synchronization hooks: 13 passed.
- TypeScript app type-check: pass.
- git diff --check and assets.rs rustfmt check: pass. No configured frontend lint script.
- Followup reset/reuse tests are run and reported by implementer separately.

## Not fixed / followup
- The active appearance hook currently reloads all four pet sprites when only the badge token changes. Guards prevent stale application, covered by tests, but this differs from the spec's independent badge decoding requirement. Recommend separate badge effect/cache as a focused followup; no module rewrite was made during review.
- Real generated image quality, 28px readability, coordinated native headers, reopen/restart and reset/reuse acceptance remain with main session; tests do not establish those results.
