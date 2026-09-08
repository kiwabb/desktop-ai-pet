# Admin Control-Plane Contract

## 1. Scope / Trigger

Applies to `server/app/admin.py`, `model_config.py`, `tracing.py`, the runtime trace store and the independent `admin/` web application. Preserve device authentication, session sequence ordering, committed tool effects and local-mode behavior. The admin UI observes server-mode data only.

## 2. Signatures

- `POST /admin/v1/auth/login` accepts `{username,password}`. `GET /auth/me` and `POST /auth/logout` use the separate admin cookie session.
- `GET /accounts`, `/devices`, `/runs`, `/todos`, `/audits` accept `limit` (1–200) and `cursor`, returning `{items,next_cursor}`. Runs additionally accept `account_id`, `status`, `created_from`, `created_to`; dates require time zones. Model-config lists return `{versions,next_cursor,...state}`.
- `GET /runs/{id}` returns metadata only. `POST /runs/{id}/content` returns `{input_text,tools:[{id,arguments,result}]}` and requires administrator role, CSRF, audit and `Cache-Control: no-store`.
- `POST /runs/{id}/payloads/{payload_id}` returns `available|expired`, `body`, truncation information and size as applicable. `POST /todos/{id}/content` is also an audited administrator-only body read. Observers cannot read these endpoints.
- `POST /accounts` and `/devices` require `Idempotency-Key: <UUID>`. Device replay returns object identity with `credential_unavailable:true`, never the original token.
- Model writes: `POST /model-config/enable`, `/drafts`, `/{version_id}/test`, `/publish`, `/rollback`. Publish accepts `{version_id,expected_revision}`; rollback accepts `{version_id,key_source:current|historical}` and creates a candidate, not an immediate publication.
- `ModelConfigStore.state(conn,for_update=True)` must lock only `model_config_state` (`FOR UPDATE OF s`). New-run acceptance binds its immutable model version under the same state-row lock used by publication.
- Migrations 005–007 add identities, config versions, encrypted secrets, admin idempotency, trace persistence and timing fields. Do not rewrite applied migration 005.

## 3. Contracts

### Identity, sensitive data and pagination

Admin identities are separate from business accounts/devices. The fixed roles are `admin` and `observer`. Sessions store random token digests, not plaintext. Writes/body reads validate role, CSRF and Origin on the server. Observers receive runtime metadata, never message or tool body fields. Metadata queries must not select private body columns only to discard them later.

Audit writes use `success|failure`. Model tests have a separate `running|succeeded|failed` domain; map explicitly. Audit INSERT column/value/parameter counts must agree. Management writes and their audit commit together. Body reads audit before loading protected content. No keys/ciphertext in API responses, errors or audit metadata. Private responses are no-store.

Account/device idempotency claims, business insert, audit and sanitized replay response share one transaction. Reusing the key with different content returns 409. A lost device response does not authorize recovery of the original token; the UI presents the existing device and the revoke/reissue path. Copying the one-time token must await clipboard success before closing.

Cursors encode the last `(created_at,id)` pair; use parameterized keyset comparison plus `limit+1`, not a fixed LIMIT with a fake terminal cursor. Keep request ordering stable when timestamps match. Login failure tracking has a global bounded capacity as well as per-user limits; stale buckets expire.

CLI `create-admin` supports a private password file (0600, current owner, no symlink) or interactive password input. Prefer these over exposing passwords in process arguments. No automatic administrator or sample account is created.

### Model configuration

Fernet encryption uses server-only `PET_AGENT_ADMIN_ENCRYPTION_KEY`. Do not save the master key in the same database. Drafts are immutable, raw Key fields are write-only, and blank Key input reuses the selected parent secret. URLs must exclude credentials/query/fragment, use HTTPS remotely and reject redirects carrying credentials.

Explicit connection tests perform an actual tool-free streamed request. Require 2xx, event-stream protocol, valid content delta, normal stop and DONE; consume the complete bounded response and reject stream errors/HTML/redirects. Test budget is capped at 60 seconds and 256 KiB. The result proves basic model streaming, not the business tool flow. Tests have `validation_version=sse-v2`; legacy weak tests cannot grant publication eligibility.

Publish uses revision CAS, the latest successful validated test within 24 hours, and a fresh secret decryption check. Failures leave active unchanged. Rollback candidates record the original version and explicit current/historical Key source; the final publication is recorded as rollback. A successful old test cannot bypass a later failed test or changed encryption key.

New runs bind the active version when accepted; retries keep the original binding. Worker SDK and whole-run timeout both use that same resolved version. In-flight/queued runs do not follow later active changes. Environment mode remains supported until explicit management enable; enable requires the queue drained. Once managed, inability to decrypt/configure is an error, never a silent environment fallback.

### Observation and recovery

Trace persistence uses an independent small connection pool and a bounded ordered writer. Business execution never awaits trace SQL. Each observation write has its own deadline and lock/statement limits. A full queue may omit preview updates; loss of a required event marks a persistent gap when storage is available. No trace failure retries a model/tool or rolls back its committed effect.

Each model step has a stable ID, config version, request protocol snapshot, partial/final response, terminal state and monotonic timing. Snapshots preserve AI tool_calls and ToolMessage tool_call_id/name/status, plus actual application request metadata; they are not advertised as raw upstream HTTP packets. Redact known effective credentials, credential fields and common credential text patterns before storing a copy; never alter the source business messages.

Explicitly request streaming usage from supporting providers. Store final cumulative usage once, and return unavailable when absent; do not add cumulative chunks. `first_token_ms` measures first generated content/tool block and `first_visible_text_ms` measures first visible text, both relative to request start. Wall-clock timestamps position the timeline; they are not TTFT values.

Cancellation, timeout, model error and shutdown seal the model step with retained partial output and the observed timing. Trace states include `interrupted`. Partial responses upsert a stable payload ID, marked `body.partial`. Late updates cannot resurrect terminated traces. A later successful model step cannot clear an earlier gap. Whole-run completeness is finalized from run lifecycle, expected/collected steps and gaps, not from one successful model call.

Recovery uses the durable business terminal event, a 120-second grace period and batches of at most 100 runs to reconcile orphaned observations. If storage is unavailable, report evidence as incomplete; no claim of lossless tracing. Default trace bodies expire after 30 days, metadata/audits after 90; only new observability tables are cleaned, not business sessions/todos. Expired bodies are cleared while payload IDs and expiry metadata remain until metadata retention ends, preserving the distinction between expired and never captured. Metadata deletion locks one bounded batch of call IDs and uses that same batch for every dependent table; active runs are excluded.

### Web boundary

The development proxy covers `/admin/v1`, not the `/admin/` SPA document. The UI uses no mock data service. Resource polling is single-flight, paused while hidden and cancelled/fenced on navigation. Selected payloads belong to run/call IDs; a late response cannot populate another run. URL state restores page/run/record. Model and tool rows follow causal execution order; the timeline and record selection are linked. Display actual Token values, timing, partial data and missing measurements.

## 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Missing/expired/revoked admin session | 401, return to login without retaining private content |
| Observer write/body read or invalid CSRF/Origin | 403 before sensitive SQL |
| Reused provisioning key with another body | 409, no duplicate account/device |
| Lost initial device credential response | Replay object identity only, no stored/recovered plaintext |
| Invalid cursor/date/limit/body | Structured 400, no raw SQL/provider exception |
| Queue nonempty when enabling managed config | 409, remain in environment mode |
| HTML, redirect, malformed/truncated/error SSE | Failed test, no publication eligibility |
| Old/weak/latest-failed test or unusable Key | Reject publish, active unchanged |
| Concurrent publication revision mismatch | 409, original run bindings preserved |
| Observation lock/queue saturation | Business continues; expose a gap or partial evidence |
| Model timeout/shutdown | Business terminal and trace terminal, partial output preserved |
| Payload expired/truncated | Explicit state/size marker, never empty successful content |

## 5. Good / Base / Bad Cases

Good: a real tool-list run exposes model1 → todo.list → model2, actual usage when available, and the run's immutable config version.

Good: switching config changes only later accepted runs; rollback is tested and audited as a rollback publication.

Base: the existing empty service shows real empty states; missing provider usage remains unavailable.

Bad: a static build, healthy old process or isolated mocked tests are reported as authenticated browser/real-model acceptance.

## 6. Tests Required

- SQL/driver/database: outer-join lock target, INSERT parameter mapping, audit enum mapping, CAS race and atomic new-run binding.
- Config: valid complete SSE versus HTML/302/error/EOF/oversize; latest-test eligibility; encryption failure; rollback Key selection and publication kind.
- Admin: observer/CSRF/Origin, safe body audit ordering, stable keyset filters, provisioning retry/conflict and token-free replay, bounded login state.
- Runtime: stalled trace writes do not stall business; cancellation/ordinary failure retain partial output; sticky gaps; stable payload upsert; complete tool protocol; version timeout; usage and distinct first-token/visible-text timing; bounded shutdown and recovery.
- UI: request fencing, chronological rows, selected-record URL recovery, polling/follow behavior, pagination and actual copy failure handling. Use existing tools or native Node tests; do not introduce a test framework solely for this task.
- Record real PostgreSQL, real provider and real browser acceptance separately. No temporary/demo database, seeded business data or mock product service without explicit user authorization.

## 7. Wrong vs Correct

Wrong: `LEFT JOIN ... FOR UPDATE` locks both sides, and a fake connection test lets the query pass.

Correct: lock only `s`, and verify the transaction semantics against PostgreSQL.

Wrong: pass test status `succeeded` to an audit CHECK allowing only `success`.

Correct: map the distinct domains and verify both success and failure transactions.

Wrong: await trace persistence inside the model loop and mark the whole run complete on each model success.

Correct: submit bounded observations separately, preserve gaps, and finalize on the run's actual terminal lifecycle.
