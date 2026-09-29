# Research: Verify one new native chat run without extra model calls

- Query: After the main session sends one authorized nonsensitive connection-check message from the ordinary desktop app, what minimal read-only evidence confirms the new run's real model stream, terminal state and durable history?
- Scope: internal; focused backend source/schema inspection and prepared parameterized queries. No model requests, UI operations, admin login, credential retrieval or data writes by this researcher.
- Date: 2026-09-15

## Findings

### Files found and code patterns

- `server/app/main.py:111` — authenticated `GET /v1/sessions/{session_id}` returns the durable session snapshot, requiring the existing control identity. It returns the whole session, so it is broader than necessary for this one-run check. Do not acquire credentials or log into admin merely to call it.
- `server/app/main.py:53` — unhandled HTTP failures are sanitized before ASGI logging; health reports configuration/dependency presence only.
- `server/app/runtime_store.py:122` — submission deduplicates by account/request ID, binds the immutable model version, and persists user/assistant message rows with the accepted run. A known request ID is a stronger correlation anchor than selecting the latest run globally.
- `server/app/runtime_store.py:371` — each visible text delta appends to the assistant message and creates a `message.delta` event in the same fenced transaction. Comparing ordered event text with the persisted assistant content checks that persistence chain.
- `server/app/runtime_store.py:424` — terminal transition writes the run status and matching `run.completed`, `run.failed` or `run.interrupted` event. `agent_runs` has no `completed_at`; use the terminal event timestamp, and separately report model trace timestamps.
- `server/app/agent_service.py:276` — execution uses the run's bound model version rather than whatever becomes active later.
- `server/app/agent_service.py:400` — `model.astream` yields provider chunks; visible chunks call `append_delta`. `usage_source=provider` labels actual returned usage; missing usage is explicitly unavailable.
- `server/app/agent_service.py:302` — only successful graph completion reaches the run's `completed` transition. Model-step success alone is insufficient.
- `server/app/tracing.py:92` — trace writes are asynchronous and bounded. A terminal business event can precede its final trace row; inspect once after completion, and only repeat a small bounded query if the trace is still pending. Do not rerun the model because telemetry lags.
- `server/app/tracing.py:119` and `server/app/agent_service.py:314` — current code emits sanitized warning/failure logs, not a success transcript. No failure line does not prove successful streaming. Broad raw log collection is unnecessary here.
- `server/migrations/002_runtime.sql:9` — run/message/event fields and uniqueness; `005_admin_model_trace.sql:101` plus `007_trace_repair.sql` define trace metadata, usage, timings and interrupted status.

### Minimum read-only checks

Use the existing server database connection path without printing its configuration. Set a transaction `READ ONLY` with short statement/lock limits. Do not call `Database.open()`, which runs migrations, or any application service method that mutates state. The queries below only return the newly authorized test run and aggregate metadata; they do not read previous chat bodies or trace request payloads.

**1. Correlate the new run.** Prefer a request/run UUID captured by the main session. If unavailable, require both explicit time bounds and the exact new input. If more than one match remains, report ambiguity instead of choosing the last record.

```sql
SELECT id, request_id, session_id, created_at, status, model_config_version_id
FROM agent_runs
WHERE created_at >= %(sent_after)s::timestamptz
  AND created_at <= %(sent_before)s::timestamptz
  AND input_text = %(input_text)s
ORDER BY created_at, ordinal
LIMIT 2;
```

Use timestamps with an explicit UTC offset (`Asia/Shanghai` is `+08:00` here). Pin the selected run UUID for all later queries.

**2. Verify terminal lifecycle, delta delivery to durable history and absence/presence of tools.**

```sql
WITH target AS (
  SELECT id, request_id, session_id, status, created_at,
         model_config_version_id, error IS NOT NULL AS has_error
  FROM agent_runs WHERE id = %(run_id)s::uuid
), event_stats AS (
  SELECT count(*) FILTER (WHERE e.type = 'run.accepted') AS accepted,
         count(*) FILTER (WHERE e.type = 'run.started') AS started,
         count(*) FILTER (WHERE e.type = 'message.delta') AS delta_count,
         count(*) FILTER (WHERE e.type = 'run.completed') AS completed,
         count(*) FILTER (WHERE e.type IN ('run.failed', 'run.interrupted')) AS other_terminal,
         min(e.created_at) FILTER (WHERE e.type = 'message.delta') AS first_delta_at,
         max(e.created_at) FILTER (WHERE e.type IN
           ('run.completed', 'run.failed', 'run.interrupted')) AS terminal_at,
         string_agg(e.envelope->'payload'->>'text', '' ORDER BY e.seq)
           FILTER (WHERE e.type = 'message.delta') AS streamed_text
  FROM agent_events e JOIN target r ON r.id = e.run_id
)
SELECT r.*, e.accepted, e.started, e.delta_count, e.completed,
       e.other_terminal, e.first_delta_at, e.terminal_at,
       (SELECT count(*) FROM agent_messages m WHERE m.run_id = r.id) AS message_count,
       (SELECT count(*) FROM agent_messages m WHERE m.run_id = r.id
          AND m.role = 'user' AND m.content = %(input_text)s) AS exact_user_message_count,
       length(a.content) AS assistant_chars,
       a.content = coalesce(e.streamed_text, '') AS assistant_matches_deltas,
       (SELECT count(*) FROM agent_tool_calls t WHERE t.run_id = r.id) AS tool_count
FROM target r CROSS JOIN event_stats e
LEFT JOIN agent_messages a ON a.run_id = r.id AND a.role = 'assistant';
```

Expected plain connection-check success: one accepted event, one started event, one completed event, no failed/interrupted event, at least one delta, two message rows, exactly one matching user message, nonempty assistant content equal to the ordered deltas. Verify tool count instead of claiming that a natural-language instruction disabled registered tools. This ordinary chat path advertises the app's normal tools; a zero count proves no tool was executed for this run.

**3. Verify model calls and trace completeness.**

```sql
SELECT id, step_index, config_version_id, model_name, status,
       started_at, ended_at, duration_ms,
       first_token_ms, first_visible_text_ms, usage_source, usage,
       error_type, error_status
FROM model_call_traces
WHERE run_id = %(run_id)s::uuid
ORDER BY step_index
LIMIT 10;

SELECT integrity, expected_steps, collected_steps,
       gap_reason IS NOT NULL AS has_gap, updated_at
FROM run_trace_states
WHERE run_id = %(run_id)s::uuid;
```

The no-tool request normally has one succeeded model step; if the actual count differs, report it. Every observed step must be terminal, and `integrity=complete` plus matching expected/collected steps is separate from the run's own completion. `error_status` is not always populated by this writer; do not infer provider HTTP 200 from an absent value. Normal SDK streaming success is not a raw SSE packet capture.

**4. Optional exact answer check.** If the main session supplied the expected reply, add `a.content = %(expected_reply)s AS exact_reply` to query 2. If the actual reply needs examination, select only the assistant body for this pinned new run, bounded to 512 characters; never return unrelated history or `trace_payloads.application_request`, which includes prior messages.

### Interpretation and limits

- These database observations establish acceptance, real SDK/provider streaming activity, saved terminal state and durable conversation content for one newly submitted run when the runtime is the known ordinary service.
- They do not establish that the latest native app displayed every streaming update or retained it after reopening. The main session separately owns actual input focus, submit visibility, model output visibility and history recovery observations.
- No body/fixture is inserted by verification. The user's actual authorized chat submission naturally creates its run, messages/events and model traces. These records should not be removed merely to make the history look untouched.
- Existing trace instrumentation is not lossless by definition; incomplete traces must be reported, even if the business run completed. Missing provider usage must stay unavailable.

## Related specs and references

- `.trellis/spec/backend/server-agent.md` — authenticated snapshots, durable event ordering, provider failure and evidence separation.
- `.trellis/spec/backend/admin-control-plane.md` — immutable run config binding, async trace integrity, usage/timing semantics and secret boundaries.
- Task `prd.md` R9/R11/R12 and `implement.md` — native acceptance remains separate from source/unit/provider checks.
- `research/live-model-provider-probe.md` — previous direct provider probe; do not reuse its success as evidence for this new native run.
- External references: none; this plan is based on current repository source.

## Caveats / Not Found

- The initial preparation awaited the main session's new request/time anchor; the subsequent scoped live result is recorded below.
- No authenticated admin/read-session API call is needed. No credentials, personal directories or broad server logs were inspected.
- This research made no source changes and did not undo another agent's work.

## Live result: ordinary desktop message on 2026-09-15

The main session reported sending the exact nonsensitive input `No tools. Reply OK.` from the ordinary desktop app and seeing accepted/thinking UI. At `2026-09-15T02:49:43.831449Z`, this researcher independently queried the actual configured PostgreSQL database through its normal server settings, using a read-only connection with 5-second statement and 1-second lock limits. Settings/credentials were consumed internally and were not printed. No model request, administrator login, service startup, migration, configuration change or business write was performed by the check.

Correlation was limited to `2026-09-15T02:48:30Z`–`02:50:00Z` and that exact input, capped at two matches. Exactly one run matched:

| Field | Observed result |
| --- | --- |
| Run ID | `305eedf3-0009-40bc-92be-828c290bd2df` |
| Request ID | `b52e98fd-5ca2-4f09-a359-7e81baabb01f` |
| Session ID | `d24a882d-334a-467e-a285-681de2a33205` |
| Created | `2026-09-15T02:48:42.285163Z` |
| Terminal event | `2026-09-15T02:48:50.921002Z` |
| Run status | `completed`; no stored error |
| Lifecycle events | accepted `1`, started `1`, completed `1`, failed/interrupted `0` |
| Text deltas | `1`, first persisted at `02:48:50.692589Z` |
| Durable messages | `2`; exactly one user message matches the supplied input |
| Durable assistant | Exactly `OK` (2 characters), equal to ordered persisted delta text |
| Executed tools | `0` |
| Bound config version | `1291fa94-d7b7-4d9a-87e9-659aa234a6a3` |

The real model trace for that run returned:

| Field | Observed result |
| --- | --- |
| Model call ID | `3ba0efda-cab7-4c39-b293-bab88a2bcc55` |
| Step | `0` (one step total) |
| Model | `gpt-5.6-luna` |
| Config version | Same version as the run binding |
| Status | `succeeded`; no error type/status |
| Started / ended | `02:48:44.102923Z` / `02:48:50.887285Z` |
| Model duration | `6784 ms` |
| First generated / visible text | `6589 ms` / `6589 ms` from model request start |
| Usage source | `provider` |
| Usage | Input `1794`, output `22`, total `1816` tokens; output reasoning detail `15` |
| Trace integrity | `complete`; expected steps `1`, collected steps `1`, no gap |
| Trace final update | `02:48:50.930726Z` |

Conclusion: this new normal desktop-submitted run used the existing bound model configuration, received real model output, durably stored the exact answer `OK`, and completed without executing tools. Only one text delta was produced, so this short reply does not demonstrate a prolonged multichunk animation. Native display of the final answer and recovery after reopening remain observations owned by the main session; no desktop screenshot or UI result is inferred from these database rows.

Main-session follow-up: the first `OK` answer and completed state were subsequently observed in native accessibility output and a screenshot. This is a main-session UI observation, independent of the database check above.

## Live result: ordinary desktop read-only Todo tool request

The main session then submitted `List my todos using the tool. Read only.`. At `2026-09-15T02:51:21.968541Z`, this researcher made a scoped read-only, repeatable-read query over `02:49:45Z`–`02:51:30Z` and that exact input, with at most two matches. Exactly one run matched. A second read-only transaction at `02:52:28.332399Z` compared the returned tool items with the actual account-owned Todo rows; it did not rerun the tool/model or output any Todo titles/history bodies.

| Field | Observed result |
| --- | --- |
| Run ID | `d1e30223-8ab0-452e-b784-b8aa52491666` |
| Request ID | `5d57f1fe-567e-44af-be57-ad945d1f2584` |
| Session | Same session as the first `OK` request |
| Created / completed | `02:50:05.390491Z` / `02:50:13.507184Z` |
| Run terminal | `completed` |
| Lifecycle | One accepted, started and completed event; one tool start/finish; no failed/interrupted event |
| Durable input | Exact supplied input; one user row, 40 characters |
| Durable assistant | 51 characters, equal to all ordered message deltas |
| Stream | 34 text deltas, persisted from `02:50:12.222684Z` through `02:50:13.105567Z` |
| Tool | Exactly one `todo.list`, status `completed`, empty arguments, no stored tool error |
| Tool ID | `17581324-3903-536e-b661-fad660728b8c` |
| Tool start / finish | `02:50:10.534732Z` / `02:50:10.555397Z` |
| Tool result | Two items, exactly equal to current account-owned Todo public fields and order |
| Current Todo status counts | Pending `0`, completed `2` |
| Trace integrity | `complete`, expected `2`, collected `2`, no gap |

The exact comparison used the normal pure `todo_view` serializer from `server/app/plugins/todo/store.py:14` over a narrowly scoped SELECT of `id`, `title`, `status`, `created_at`, and `remind_at`, ordered by `created_at,id`. All five fields matched for both items. The `todo_list` handler at `server/app/plugins/todo/tools.py:92` returns `todos_in_transaction`; its query at `store.py:137` only selects account-owned Todo rows. Only comparison booleans/counts were printed. The recorded tool links to the first model call at step 0, confirming the observed model → tool → model sequence.

Both real `gpt-5.6-luna` calls used the unchanged run-bound version `1291fa94-d7b7-4d9a-87e9-659aa234a6a3`:

| Model step | 0: select tool | 1: answer from result |
| --- | --- | --- |
| Call ID | `5e6447d1-685f-457c-8ad1-387232b283df` | `0ef0f26c-dc80-48a5-8899-92ee8edf0258` |
| Status | `succeeded` | `succeeded` |
| Started | `02:50:06.525355Z` | `02:50:10.574365Z` |
| Ended | `02:50:10.525014Z` | `02:50:13.484866Z` |
| Duration | `3999 ms` | `2910 ms` |
| First generated block | `3439 ms` | `1648 ms` |
| First visible text | Unavailable; this step selected a tool | `1648 ms` |
| Provider input / output / total tokens | `1815 / 41 / 1856` | `1997 / 66 / 2063` |
| Provider reasoning-token detail | `25` | `26` |
| Error type/status | None | None |

Conclusion: the normal desktop-submitted request executed the actual read-only `todo.list` tool against the existing two Todos, passed its result into a second real model call, durably streamed the answer in 34 deltas and completed with an intact two-step trace. No sample Todo or substitute service was created. Native presentation of this second tool/result stream remains the main session's separate observation.
