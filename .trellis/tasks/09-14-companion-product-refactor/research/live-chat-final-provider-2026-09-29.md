# Research: Final native chat provider evidence

- Query: Independently verify the real native request beginning `请陪我安排一个轻松的午后` after the updated desktop bundle is ready.
- Scope: internal; read-only PostgreSQL metadata for the saved native session. Main owns the actual native request and all visual inspection.
- Date: 2026-09-29

## Findings

### Verified final request

Main signalled that the updated candidate native UI submitted the request at 14:19 and that it completed. The read-only query found exactly one matching run for the agreed prompt prefix in the saved native session on September 29. `SHOW transaction_read_only` returned `on`.

| Evidence | Verified value |
| --- | --- |
| Run ID | `95fa90aa-1c92-41d1-8e57-8a4fd0e2c252` |
| Accepted time | 2026-09-29 14:19:59.808090 Asia/Shanghai |
| Run status | `completed` |
| Bound configuration | Existing version `1291fa94-d7b7-4d9a-87e9-659aa234a6a3` |
| Model calls | One, `gpt-5.6-luna`, `succeeded` |
| Provider interval | 14:20:00.905949–14:20:31.743311 Asia/Shanghai |
| Model duration | 30,837 ms |
| First visible text | 3,541 ms after model-call start; timestamp 14:20:04.447425 |
| Acceptance-to-first-visible interval | Approximately 4,639 ms; this includes time before model-call start |
| Usage source | `provider` |
| Usage | 7,425 input / 1,570 output / 8,995 total tokens |
| Persisted streamed text events | 1,479 `message.delta` events |
| Streamed text interval | 14:20:04.447581–14:20:31.498907 |
| Lifecycle events | One each `run.accepted`, `run.started`, `run.completed`; no failed/interrupted event |
| Durable completion time | 14:20:31.751622 |
| Persisted message sizes | User 104 characters, assistant 2,004 characters |
| Tool calls | Zero |
| Trace integrity | `complete`; one expected and one collected step |

These are current persisted rows from the original service/model chain, not fixture results. The unique matching request, successful model trace, provider-reported usage, and persisted deltas establish actual provider execution and streamed output for the post-change native request. The 1,479 event count is not a token count; the 2,004-character stored reply is not a model-duration measurement.

### Method and evidence boundary

The existing service-chain report, `research/live-service-plan-2026-09-29.md`, identifies the original native configuration file and Python environment. Verification loaded `Settings()` from `server/` and the saved native session identifier internally, then connected with `default_transaction_read_only=on` and a 5-second statement timeout. Only the agreed prefix and day were matched. No environment dump, credential, session identifier, history text, trace body, or raw log was printed.

The allowlist consisted of run ID/status/accepted time/configuration version, model call status/name/timestamps/duration/first-visible metrics, provider token counts and usage source, stream-event type counts, tool count, persisted message character counts, and trace completeness. Native send visibility, partial rendering, reading position, table appearance, and reopen behavior require main-session UI evidence separately.

Main separately reported seeing waiting state, partial text after expansion, content growing, keyboard Page Up moving upward during generation, completion retaining the same visible reading section, and the header pending cue disappearing. This report attributes those observations to main and does not claim that this researcher independently inspected the UI.

### Files found and code patterns

- `server/app/config.py:8` — `Settings()` resolves the existing `PET_AGENT_` settings and local `.env`; secret-bearing fields suppress representation.
- `src-tauri/src/backend/mod.rs:23` — saved server configuration contains the service address, device token, and current session ID; only the session ID is needed internally for this scoped lookup.
- `server/migrations/002_runtime.sql:9` — durable runs bind accepted input and status to the existing session; `:26`, `:38`, and `:62` define persisted messages, tool calls, and stream events.
- `server/migrations/005_admin_model_trace.sql:102` — model-call traces hold the allowlisted timing, status, model, and provider-usage metadata.
- `server/migrations/007_trace_repair.sql:1` — separate first-token and first-visible-text duration fields.
- `server/app/agent_service.py:334` — original provider is invoked with streaming and stream usage enabled; no alternate model endpoint is needed.
- `server/app/agent_service.py:374` — model-call start is measured separately from run acceptance.
- `server/app/agent_service.py:405` — provider chunks supply actual stream text; `:407` keeps the latest cumulative usage metadata, and `:416` records first visible text relative to model-call start.
- `server/app/runtime_store.py:217` — terminal trace writes persist the captured status, duration, visibility, and usage metrics; trace metadata does not establish native rendering quality.

### Related specs

- `.trellis/spec/backend/server-agent.md` — persisted run/event contract, credential boundary, and explicit separation between static, service/model, and native UI evidence.
- `research/live-service-plan-2026-09-29.md` — already verified original service chain and the two earlier real requests; these earlier results do not verify the new bundle.

### External references

No external source was needed for this local runtime lookup. Prior memory about saved-configuration-first verification was used only as procedural guidance; all metrics above were independently queried on September 29.

## Caveats / Not Found

- This researcher submits no model request and makes no UI, configuration, service, or database changes.
- Zero tool calls confirms that this request did not exercise the business tools; it does not establish tool execution quality.
- Provider first-visible timing measures received nonempty provider text, not the exact frame when the native UI painted it.
- Metrics are for this unique request and are not a general latency guarantee.
- No implementation/check context manifests were loaded.
