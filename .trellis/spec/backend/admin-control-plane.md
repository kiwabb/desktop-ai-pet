# Admin Control-Plane Contract

## 1. Scope / Trigger

Applies to the internal `server/app/admin.py`, `model_config.py`, runtime trace persistence and the independently built `admin/` React application. This contract is required because the feature adds new authentication, database migrations, encrypted secrets, model-version switching and cross-layer trace inspection.

## 2. Signatures

- `POST /admin/v1/auth/login` accepts exactly `{username, password}` and sets the HttpOnly session cookie plus the readable CSRF cookie.
- `GET /admin/v1/auth/me`, `POST /admin/v1/auth/logout`, `GET /admin/v1/overview`, `GET /admin/v1/accounts`, `GET /admin/v1/devices`, `GET /admin/v1/runs`, `GET /admin/v1/runs/{run_id}`, `GET /admin/v1/todos`, `GET /admin/v1/tools`, `GET /admin/v1/health` require an admin session.
- `POST /admin/v1/accounts`, `POST /admin/v1/devices`, `POST /admin/v1/devices/{device_id}/revoke`, all model-config mutations, and `POST /admin/v1/todos/{todo_id}/content` require the `admin` role, same-origin validation, CSRF and an audit row before sensitive reads or writes.
- `POST /admin/v1/runs/{run_id}/payloads/{payload_id}` is an admin-only, CSRF-protected, audited read of an expiring trace body.
- Model configuration mutations are `POST /admin/v1/model-config/enable`, `/drafts`, `/{version_id}/test`, `/publish` and `/rollback`. Publishing requires `expected_revision` and a previous successful test.
- Migration `005_admin_model_trace.sql` creates admin identity/session/audit tables, immutable model versions and encrypted secret references, the singleton active-state projection, run config bindings and model/tool trace tables.
- `ModelConfigStore.bind_for_new_run(conn)` locks the active state and returns the version ID for a new run. Existing runs resolve the version stored on `agent_runs.model_config_version_id`.

## 3. Contracts

- Admin identities are separate from device identities. Roles are `admin` and `observer`; observers can inspect metadata but cannot create/revoke devices, change model configuration, read todo titles, or read trace input/tool arguments/results.
- Passwords are stored as `scrypt$...` hashes. Sessions store only a SHA-256 token hash. Writes require the `pet_admin_csrf` value in `X-CSRF-Token`; cross-origin `Origin` values are rejected.
- `PET_AGENT_ADMIN_ENCRYPTION_KEY` is a Fernet key used only by the server to encrypt model API keys. It must be present before database-backed model management can be enabled. API responses never include the key or ciphertext.
- The initial mode is the environment model configuration. An administrator must explicitly call `/model-config/enable`; the call refuses while any run is `queued` or `running`, then optionally records the validated environment configuration as the baseline version.
- A draft contains `base_url`, `model_name`, `timeout_seconds`, optional `api_key` and optional `parent_version_id`. URLs are HTTPS unless they target localhost, contain no credentials or query string, and timeouts are 5–600 seconds.
- A model connection test performs a real streaming `POST {base_url}/chat/completions` without redirects or tools. A successful test is required before publish. Publish uses the state revision as a compare-and-set guard and records a publication and audit event in one transaction. Rollback creates a new draft and still requires test then publish.
- Run details expose status, trace timing, usage and tool names. Administrator-only fields include run input, tool arguments/results and payload metadata. Payload bodies are capped, marked when truncated, retained for the configured payload period, and returned only through the audited POST endpoint.
- Trace integrity is `partial`, `complete`, `incomplete` or `legacy`. If terminal trace or tool-link persistence fails, the run remains usable but the trace is marked `incomplete` with a gap reason. Duration uses a monotonic clock while timestamps remain wall-clock values.
- The admin app is a separate workspace package. Production serving must expose its built files and proxy `/admin/v1` to the server; it does not use seeded or fixture business data.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Missing, expired or revoked admin session | HTTP 401 with a sanitized authentication error |
| Observer attempts an admin-only operation | HTTP 403; do not perform the read or write |
| Missing, mismatched or cross-origin CSRF | HTTP 403; do not mutate state |
| More than five failed logins for one username in 60 seconds | HTTP 429 until the in-memory window expires |
| Missing encryption key when enabling management | HTTP 409; remain in environment mode |
| Queued or running runs when enabling management | HTTP 409; do not change active mode |
| Invalid URL, model name, timeout, parent or version | HTTP 400/404; do not create a usable publication |
| Test returns HTTP error or no streamed bytes | Persist a failed test and refuse publish |
| Revision differs at publish | HTTP 409; do not replace the active version |
| Expired or missing payload | Return `expired` or HTTP 404 without returning body content |
| Observer requests todo content or trace payload | HTTP 403; no sensitive query is performed |
| Trace persistence loses a terminal/link write | Mark the trace `incomplete` and preserve the gap reason |

## 5. Good / Base / Bad Cases

- Good: enable management after the queue is drained, test a draft against the actual model service, publish with the displayed revision, and observe later runs bound to the published version.
- Good: an observer sees run status, timing and tool names while an administrator performs an audited payload read.
- Base: an empty database shows zero accounts/runs and no active managed model; no records are inserted merely to make the dashboard look complete.
- Base: a model publish changes only new-run bindings; an in-flight run continues with its stored version.
- Bad: return the API key in a draft response, store it as plaintext, or use the browser local storage as the credential store.
- Bad: treat HTTP 200 from the model endpoint as a successful connection when no streamed bytes arrived.
- Bad: expose todo titles in the list endpoint before the audited single-item content read.

## 6. Tests Required

- Isolated server tests assert scrypt validation, URL restrictions, public model-state projection, redaction boundaries and rejection of invalid management operations.
- Database-backed tests must assert the migration order, one singleton state row, enable drain behavior, revision compare-and-set, encrypted secret round-trip, immutable version history and run version binding.
- HTTP tests must assert cookie flags, CSRF/origin enforcement, role separation, login rate limiting, audit-before-sensitive-read ordering and sanitized error bodies.
- Trace tests must assert payload size/truncation, retention cleanup, monotonic non-negative durations, tool-to-model links and the `incomplete` gap marker after a persistence failure.
- Real acceptance must separately verify a real PostgreSQL migration, an issued admin account, a real model streaming test, a browser login and a desktop run. Static checks, fixtures and isolated mocks do not prove those flows.

## 7. Wrong vs Correct

Wrong: publish a model version immediately after saving its URL and key, then let queued runs resolve whichever version is active when they execute.

Correct: save an immutable version, run the real streaming test, publish with the expected revision, and bind each new run to the active version inside its acceptance transaction.

Wrong: let an observer fetch a run's input, tool arguments or raw model payload because the observer can already see the run status.

Correct: return metadata and tool names to observers, require the administrator role and CSRF for sensitive reads, and write the audit event before reading the protected body.

Wrong: delete all trace metadata as soon as a payload expires, or report a complete trace after a terminal write failed.

Correct: expire payload bodies independently, retain metadata for its retention window, and mark the trace `incomplete` with a gap reason when evidence is missing.
