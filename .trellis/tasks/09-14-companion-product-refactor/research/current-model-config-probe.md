# Research: Current configured model and minimal probe

- Query: Can the existing configured model service be used for current acceptance, and what supported probe avoids tool/business writes?
- Scope: internal; six Python source files, one allowlisted PostgreSQL read, no model invocation or UI operation.
- Date: 2026-09-14

## Findings

### Current configuration evidence

A `READ ONLY` transaction against the database selected by `server/app/config.py` returned only these fields:

| Field | Observed value |
| --- | --- |
| management_enabled | true |
| revision | 2 |
| active_version_id | 1291fa94-d7b7-4d9a-87e9-659aa234a6a3 |
| base_url | http://127.0.0.1:8080/v1 |
| model_name | gpt-5.6-luna |
| timeout_seconds | 90 |

The query did not select secret references, ciphertext or credential values. Connection settings were consumed internally; no credentials were printed or copied. The configured URL passed the existing validator that rejects userinfo, query and fragment. This proves the current database configuration, not current upstream availability or successful inference. The main session independently checks the live service; process-specific environment overrides were not inspected here.

### Effective selection and source files

- `server/app/config.py:8`: `Settings` loads `PET_AGENT_*` settings and local `.env`; fallback model configuration is separate from managed configuration.
- `server/app/model_config.py:159`: `state` resolves the single active version; `:378` binds it when accepting a new run. Managed mode does not silently fall back when the active version is absent. `:203` resolves the immutable selected version for execution.
- `server/app/runtime_store.py:143`: accepted runs persist the selected configuration version, user message and assistant placeholder. Therefore ordinary chat submission is not a history-free probe.
- `server/app/agent_service.py:276`: `_resolve_run_config` uses the run-bound version; `:331` builds `ChatOpenAI` with that URL/model/key and binds actual tools. Asking chat not to use tools is weaker than a request with no tool definitions.
- `server/app/main.py:65`: health/status treats an active managed version as configured. `model_configured=true` is not an upstream inference check.
- `server/app/admin.py:506`: authenticated metadata read; `:541` existing tool-free connection-test endpoint; `:191` administrator/session/CSRF checks.

### Supported minimal probe and exact effects

1. With an existing valid administrator session, `GET http://127.0.0.1:18081/admin/v1/model-config?limit=1` confirms `active.id`, `active.base_url`, `active.model_name` and `revision`. This metadata read does not write an audit or create a business run. Observer access suffices for the read.
2. Use the returned active ID for `POST http://127.0.0.1:18081/admin/v1/model-config/1291fa94-d7b7-4d9a-87e9-659aa234a6a3/test`. The existing route requires a real administrator session and matching `X-CSRF-Token`; a supplied Origin must match the service origin. Do not bypass authentication or fabricate an administrator actor.
3. `ModelConfigStore.test` (`server/app/model_config.py:291`) decrypts the existing key internally and requests the configured `/chat/completions` URL with only `{model, messages:[{role:"user",content:"请仅回复：连接测试成功"}], stream:true}`. No tools are advertised. No configuration draft/publication/change occurs.
4. The probe inserts one `model_config_tests` record, updates its terminal result, and writes one `admin_audit_events` entry. It consumes upstream inference tokens if the provider serves the request. Token usage is not recorded by this test endpoint. It does not create an agent run, chat message, Todo or reminder, and does not execute business tools. A new login, if needed, separately inserts an `admin_sessions` record; ordinary metadata reads do not log in implicitly.
5. Success requires an actual 2xx SSE response, valid content, normal `stop` and `[DONE]`, within 60 seconds and 256 KiB (`model_config.py:48`, `:305`). A success proves basic streaming capability only; it does not prove desktop rendering or current business-tool execution.

## Related specs and references

- `.trellis/spec/backend/admin-control-plane.md`: real tool-free SSE validation, CSRF/authentication, version binding, secret boundary.
- `.trellis/spec/backend/server-agent.md`: distinguish configured/service health from real model success; durable normal chat effects.
- Task `prd.md`, `design.md`, `implement.md`: keep existing interfaces/services and report actual evidence levels.
- External references: none; this question was answered from the current repository and scoped local configuration.

## Caveats / Not Found

- This research did not invoke a model, use the desktop/admin UI, acquire a new admin session, inspect credential files, or change application/configuration data.
- Earlier HTTP 404 evidence does not establish the result of a new request today; the configured endpoint is still the same, but a current inference probe is needed.
- Current existing administrator-session availability was not investigated. Do not search personal directories or extract protected keychain material just to obtain access.
- Display performance, cross-screen behavior and desktop streaming acceptance remain separate requirements.

## Current local endpoint check

The main session rechecked the existing endpoint on 2026-09-14 without changing configuration or sending credentials:

- `GET http://127.0.0.1:18081/health` returned 200 with `model=gpt-5.6-luna` and `model_configured=true`.
- `GET http://127.0.0.1:8080/openapi.json` returned 404.
- `POST http://127.0.0.1:8080/v1/chat/completions` with the intentionally incomplete body `{}` returned 404. The probe carried no credentials, model, messages or tools; it is a route check, not a model invocation or an authenticated connection test.
- The current listener on `127.0.0.1:8080` is Python PID 55029, with working directory `/Users/zhoujiaangyao/zhoujiangyao/eam/EAPAI/backend`. Its root response returned 404 and identified Werkzeug 3.1.8 / Python 3.14.5. This is evidence that the configured port currently reaches the EAPAI service; the process was neither changed nor stopped.

Conclusion: keep the existing selected model/configuration while diagnosing the configured local service address. A configured flag alone does not establish usable inference. A successful authenticated model request remains unverified; this check does not establish an invalid model name or credential.
