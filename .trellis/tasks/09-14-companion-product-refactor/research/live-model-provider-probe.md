# Research: Minimal live provider probe using the active configuration

- Query: After restoring sub2api on port 8080, how can the main session make one real tool-free model request using the existing active configuration without admin login, configuration changes, or desktop business records?
- Scope: internal; four Python source files inspected; no credential values, database records, process actions, UI actions, or provider requests read/executed by this researcher.
- Date: 2026-09-14

## Findings

### Files found and reusable code patterns

- `server/app/config.py:8` — `Settings()` consumes normal `PET_AGENT_*` environment and the current working directory's `.env`; secret-bearing fields use `repr=False`. Run a probe from the established server working directory and do not print the settings object or environment.
- `server/app/model_config.py:159` — `ModelConfigStore.state()` selects the managed state and active immutable version. Require `management_enabled` and a nonempty active ID for this requested managed-config probe; fail explicitly rather than falling back to environment settings.
- `server/app/model_config.py:203` — `resolved(active_version_id)` reuses the normal configuration resolver. It selects the immutable version and decrypts its existing secret internally, returning `{base_url, model_name, timeout_seconds, api_key, id}`. Only allowlisted nonsecret fields may be displayed. Do not print the returned dictionary.
- `server/app/model_config.py:50` — `validate_test_stream(response)` consumes the complete response and requires a 2xx status, `text/event-stream`, valid JSON content deltas, a normal `stop`, then `[DONE]`. It rejects stream error events, content after finish, malformed/truncated streams and more than 256 KiB. It returns no text/result object on success.
- `server/app/model_config.py:291` — the administrative `test()` method supplies the existing minimal request pattern but must not be called for this no-record probe: it inserts a test row at line 297 and writes the terminal result/audit at lines 319–320.
- `server/app/db.py:18` — `Database.open()` runs database migrations, including schema/table writes. Do not call it in a read-only probe. Its underlying pool can be opened independently; an independently constructed pool supplied through an object exposing `.pool` also fits `ModelConfigStore`.
- `server/app/cli.py:87` — the current CLI contains migrate, account/device provisioning/revocation, and administrator creation. It has no provider-probe subcommand. Running the CLI enters `Database.open()` and is unnecessary here.

### Minimal execution shape for the main session

1. Use the project's existing Python environment from `server/` and instantiate `Settings()` normally. Do not manually retrieve/copy credentials, search personal directories, extract Keychain items, or expose environment/connection strings.
2. Open only a psycopg pool, configured with `dict_row`, a short connection timeout and PostgreSQL `default_transaction_read_only=on`. A connection `options` setting can additionally bound `statement_timeout`. Do not invoke application lifespan, worker startup, Redis startup, migrations or `Database.open()`.
3. Construct `ModelConfigStore` with that pool and the settings. Read `state()`, retain its current active ID, then call `resolved(str(active_id))`. This pins the selected immutable configuration even if another operator publishes concurrently. Abort on missing managed state, active version or key.
4. Revalidate the returned URL with `validate_model_url`. Confirm the expected local base URL `http://127.0.0.1:8080/v1`; an unexpected configuration should be reported before contacting another address.
5. Make exactly one authenticated `POST <base_url>/chat/completions`, using the existing key only in the in-memory Authorization header. Copy the established body from `model_config.py:306`:

   ```json
   {"model":"<resolved model name>","messages":[{"role":"user","content":"请仅回复：连接测试成功"}],"stream":true}
   ```

   No tools or business context are included. Use `follow_redirects=False`, a whole-request `asyncio.timeout(min(timeout_seconds, 60))`, and an HTTP client timeout with the same cap. For this explicitly local target, disable inherited HTTP proxy settings to keep the credential on the observed local route.
6. Pass the real response through `validate_test_stream`. To show actual generated text, wrap its `aiter_bytes()` with a bounded recording iterator while forwarding `status_code` and `headers`; the validator consumes the stream only once. After successful validation, parse recorded SSE data deltas and compare the joined content with the requested phrase. Do not call `aread()` after the stream has already been consumed. Keep the recording in memory and discard it after printing a minimal sanitized result.
7. Print only the version ID, model name, validated URL, HTTP status, elapsed time, stream-validation result and the bounded generated answer (or exact-match boolean). Close the HTTP client and database pool in `finally` blocks.

### Error and evidence boundaries

- `HTTP 401/403` identifies provider authentication/authorization rejection; `404` identifies a missing route/resource, not proof of an invalid model name; `429` identifies rate/quota rejection. Do not print provider error bodies or headers, which can contain sensitive details.
- Connection refusal and timeout are separate outcomes. Catch these explicitly; avoid raw exceptions/tracebacks that can expose DSNs, request headers or secrets. Known validator errors contain controlled messages and HTTP status only.
- A 2xx response alone is insufficient: complete valid SSE with generated content, normal stop and DONE is required. A fixed-answer mismatch is distinct from a protocol failure.
- This makes a real provider inference request and consumes upstream tokens. sub2api/upstream can create normal usage or operational logs. It does not create a pet agent run, chat history, Todo, admin session, model test, admin audit or configuration update in the pet database.
- Successful provider validation proves that the active URL/model/key combination can produce a complete streamed answer. It does not validate the pet server run queue, business tools, desktop streaming/rendering, focus, refresh recovery or cross-display behavior.

## Related specs and references

- `.trellis/spec/backend/admin-control-plane.md` — secret handling, complete SSE validation, bounded test duration/response, and separation of model/API/browser evidence.
- `.trellis/tasks/09-14-companion-product-refactor/prd.md` — R11 existing API/core behavior and honest real-environment evidence.
- `.trellis/tasks/09-14-companion-product-refactor/design.md` — use real existing services and classify actual evidence.
- `.trellis/tasks/09-14-companion-product-refactor/implement.md` — static/unit success is not model/native proof.
- `research/current-model-config-probe.md` — prior allowlisted active-configuration read; its EAPAI process availability observations predate the user's subsequent service-restoration instruction.
- External references: none; source-grounded local workflow. Prior memory supplied only the evidence-level distinction, which was independently confirmed by the current task/spec.

## Caveats / Not Found

- This is a reviewed probe plan, not a successful model-call result. The main session owns the actual request and its outcome.
- Process-specific environment overrides were not inspected. A standalone `Settings()` instance must use the established server launch environment; do not claim it matches a running process if evidence contradicts that.
- No preexisting provider-probe CLI was found in the inspected CLI. No implementation or new permanent script is necessary for the one requested verification.

## Main-session execution result

The main session subsequently reported the following real provider result on 2026-09-14. This researcher did not make a second request or independently recheck it:

- Probe ID: `021a1365-75a7-40ee-929e-d327567ce063`.
- Active version: `1291fa94-d7b7-4d9a-87e9-659aa234a6a3`, revision `2`, model `gpt-5.6-luna`.
- HTTP `200`; generated answer exactly `连接测试成功`; finish reason `stop`; complete `[DONE]` passed the existing `validate_test_stream` validator.
- Response size: `1356` bytes; first chunk: `3.184 s`; request duration: `4.684 s`. First chunk is a transport measurement, not a claimed first visible text measurement.
- Provider-reported usage: prompt `13`, completion `7`, total `20` tokens.
- The main session used a read-only pool and `resolved(active_id)` with normal provider-key authentication; it did not call `Database.open()`, `.test()` or an admin endpoint, change configuration, or advertise tools.

This is real provider streaming evidence. It is not an administrative connection-test record, a normal pet agent run, or desktop end-to-end acceptance.
