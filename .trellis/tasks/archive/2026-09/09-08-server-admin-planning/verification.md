# Verification

## Static and isolated checks

- `python3 -m compileall -q server/app` passed.
- From `server/`, `uv run python -m unittest discover -s tests` passed: 72 tests.
- Added isolated coverage for password hashing, model URL validation, and public model-version redaction. These tests use no database, credentials, model provider, or seeded business rows.
- From `admin/`, `pnpm exec tsc --noEmit -p tsconfig.json` passed after the final UI change.
- From `admin/`, `pnpm build` passed after the final UI change.
- The admin navigation includes a real-data todo/reminder page; titles remain available only through the audited administrator-only single-item read.
- `server/migrations/005_admin_model_trace.sql` is an additive migration. Existing `/v1` tables and device roles remain unchanged; the new run binding column is nullable for legacy runs.
- `server/uv.lock` was regenerated for the declared `cryptography` dependency.

## Real service, model, database, and browser evidence

Not run in this implementation pass. No database migration was applied, no admin account or device was created, no model provider was called, and no browser login or desktop device flow was performed. No fixture or mock was added to substitute for those checks.

## Remaining limits

- Deployment must supply `PET_AGENT_ADMIN_ENCRYPTION_KEY` and install the locked Python dependencies before model configuration write/test/publish operations can succeed. The UI now exposes the explicit management-mode enable step and the server rejects it while queued/running work exists.
- A reverse proxy must serve the built `admin/` files and proxy `/admin/v1`; the Vite development proxy is documented, while production hosting is deployment configuration.
- The real acceptance matrix still needs PostgreSQL transaction checks for CAS publication, run-version binding, audit atomicity, trace retention cleanup, and revoke behavior, plus real model and browser evidence. Todo lists expose metadata only; administrator todo content is read through the audited single-item endpoint.
