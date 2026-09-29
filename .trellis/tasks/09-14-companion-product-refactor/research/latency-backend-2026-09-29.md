# Research: Backend response latency attribution

- Query: Is the observed slow reply caused by the model or application code; what do the existing timings actually measure?
- Scope: internal; bounded backend source inspection and read-only aggregate metadata for the four already completed real runs. No model calls, service changes, builds, or code edits.
- Date: 2026-09-29

## Findings

### Diagnosis

The largest measured wait is inside the model service chain. For the last short reply, 9.473 seconds passed from entering the SDK streaming call to receiving the first visible text, compared with approximately 1.065 seconds before that call began. This locates the wait but does not separate model computation, proxy queuing, transport, or SDK processing.

Application context construction is a concrete optimization opportunity, not a demonstrated primary cause: the final 24-character question still sends 8,920 input tokens, forty historical messages, and all nine tool definitions. Its contribution to the observed latency has not been measured with a controlled comparison. Do not say that context size proves the model is fast or that the code is the main bottleneck.

There is also an approximately one-second interval before the worker claims each run. Its exact cause needs instrumentation; the present code does not intentionally sleep one second on every submission.

### Actual timing evidence

These are real existing rows, not another request or a fixture. A fresh query on September 29 used the original `Settings().database_url`, `default_transaction_read_only=on`, and a five-second statement timeout. `SHOW transaction_read_only` returned `on`. Only the four known run IDs were selected; no credentials or historical text were printed.

| Run suffix | Accepted timestamp to run.started | run.started to model trace start | Model trace to first visible text | Whole model trace | Provider input / output tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| `adde8f` | 1,037.890 ms | 53.736 ms | 4,396 ms | 5,787 ms | 6,524 / 102 |
| `61ef51` | 1,023.263 ms | 30.487 ms | 2,941 ms | 15,148 ms | 6,674 / 721 |
| `e2c252` | 1,036.848 ms | 61.011 ms | 3,541 ms | 30,837 ms | 7,425 / 1,570 |
| `8ddb94` | 1,021.147 ms | 43.559 ms | 9,473 ms | 10,095 ms | 8,920 / 20 |

All four are one successful `gpt-5.6-luna` model call, with zero actual tool calls. Request IDs and the original evidence are in `live-service-plan-2026-09-29.md`, `live-chat-final-provider-2026-09-29.md`, and `live-chat-final-short-provider-2026-09-29.json` in this directory.

The last short answer reaches the backend's first visible provider text about 10.538 seconds after the accepted timestamp; its model loop completes about 11.160 seconds after that timestamp. The 9.473-second pre-text interval is inside the SDK/provider path, not the later native paint or per-delta database append. The records do not attribute a specific portion of that wait to the chosen context size.

### Metric boundaries and source patterns

- `server/app/agent_service.py:370` serializes a credential-redacted application request snapshot before starting the model clock at `:374`. The clock starts immediately before queueing trace metadata and entering `model.astream` at `:403`.
- `server/app/agent_service.py:410` obtains the chunk receive time; `:413–416` records first content/tool response and first nonempty visible text. Role-only or usage-only chunks do not count. The visibility metric precedes `append_delta` at `:421` and therefore is not a UI paint measurement.
- `server/app/agent_service.py:394–400` captures terminal duration after the streaming loop. It includes SDK/request/provider transfer and the awaited work inside that loop. It is not isolated model GPU time.
- `server/app/agent_service.py:334–337` creates `ChatOpenAI` with `max_retries=0`, `streaming=True`, and `stream_usage=True`, binding every registered tool. There is no application retry in these four successful one-step calls.
- `server/app/agent_service.py:240–242` persists submission, immediately sets the local worker event, then publishes the session notification. `:255–272` scans for work and uses a one-second wait only after finding no claimable run.
- `server/app/runtime_store.py:326–346` claims a session using `FOR UPDATE ... SKIP LOCKED`, then marks the next queued run running and emits `run.started`. `:122–163` uses a transaction for submission. PostgreSQL `now()` fields represent transaction time, so the accepted timestamp is not a measured commit-completion timestamp.
- The one-second pre-claim interval cannot be blamed on model object construction: the measured claim-to-model-start work, including configuration/history/graph setup, is only 30–61 ms in these four runs.
- A final bounded source check leaves that one-second cause unresolved. After a no-work scan, `agent_service.py:268` clears the shared event before waiting; a notification set during the preceding scan can therefore be cleared. Separately, `runtime_store.py:335` skips a session while it is locked; the event pump calls `events_after` immediately after submission (`main.py:309–311`), and that read acquires the same session row lock (`runtime_store.py:114–115`, `:60–63`). Either pattern can lead to waiting for the fallback scan, but there is no recorded lock/wakeup timeline identifying which, if either, occurred in these four requests. There is no unconditional one-second sleep in submission. No further investigation was performed.
- `server/app/main.py:275` uses a 250 ms control event pump; `:311–313` fetches and sends durable events in sequence. Redis notifications do not directly drive this loop. This introduces an additional polling boundary for native delivery, separate from the model first-text measurement.

### Actual request context size

The fresh query aggregates the persisted `application_request` trace, without displaying contents. None of these four captures is truncated.

| Run suffix | Total messages | Historical messages | System characters | Tool schemas | Tool JSON characters | Captured request bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `adde8f` | 38 | 36 | 2,373 | 9 | 4,230 | 30,396 |
| `61ef51` | 40 | 38 | 2,373 | 9 | 4,230 | 30,997 |
| `e2c252` | 42 | 40 | 2,373 | 9 | 4,230 | 34,096 |
| `8ddb94` | 42 | 40 | 2,373 | 9 | 4,230 | 39,601 |

`server/app/runtime_store.py:454–469` loads the last forty nonempty messages before the current run and up to twenty failed/interrupted runs' tool results. There is no token budget or summary compaction in this path. `server/app/agent_service.py:338–345` adds system instructions, history, any unresolved tool facts, and the current message once. These four requests contain one system message and no extra unresolved-tool system message.

`server/app/agent_service.py:31–84` composes core behavior, all plugin prompt fragments, and dynamic timezone/current/acceptance-time instructions. `server/app/plugin_runtime.py:44–64` registers Todo and Memo and aggregates their tool schemas. Their manifests come from `plugins/todo/plugin.json` and `plugins/memo/plugin.json`.

Character and JSON-byte counts are not token counts. The provider reports total input tokens only; exact system/history/tool token splits are not captured. The latest provider usage also reports 1,792 cache-read tokens.

Main independently matched four real proxy `usage_logs` rows using narrow time windows and token totals, with total durations of 5,694 / 15,121 / 30,752 / 10,043 ms. Their near match to the backend model-loop durations corroborates that the measured waiting is concentrated in the model service chain. The proxy `first_token` values are 2,201 / 1,339 / 1,903 / 3,184 ms, but these are not established first-visible-text metrics. Main's source check found `sub2api/backend/internal/service/openai_gateway_chat_completions.go:550–555` records time before parsing the first SSE payload, allowing non-text events to count; other forwarding paths have different boundaries, and the exact running-container branch is unconfirmed. This researcher did not independently query or inspect that proxy code. Do not subtract proxy `first_token` from backend first-visible and call the difference frontend delay, or split the 9.473 seconds between proxy and upstream. The supplied last-run proxy input split is 7,128 ordinary input plus 1,792 cache-read tokens, equal to the backend's 8,920 total input; these are not conflicting token totals.

### Streaming persistence costs

`server/app/agent_service.py:421–422` awaits `append_delta` and Redis publish for every text-bearing chunk before reading the next one. `server/app/runtime_store.py:358–379` opens an explicit transaction, locks/checks session and leased run, concatenates the assistant message, advances session sequence, and inserts a durable `message.delta` event. There is no coalescing of small provider deltas. The long post-change response generated 1,479 such events for 1,570 output tokens.

`server/app/coordination.py:12` sets Redis connect/socket timeouts to two seconds, and `:29–35` awaits publish with best-effort failure handling. That is another in-loop cost; the available records do not measure its duration separately.

`server/app/tracing.py:92–105` uses a bounded asynchronous queue for observability. The half-second preview interval at `server/app/agent_service.py:417–419` throttles trace snapshots only; it does not intentionally throttle live text. The trace writer's 250 ms write deadline is not a fixed delay imposed on every model chunk.

### Files found

- `server/app/agent_service.py` — worker wakeup, graph construction, prompt assembly, SDK configuration, model metrics, and per-chunk processing.
- `server/app/runtime_store.py` — durable submission/claim, history selection, message append, event sequence, and trace persistence.
- `server/app/coordination.py` — best-effort Redis publication awaited by the streaming loop.
- `server/app/tracing.py` — asynchronous bounded telemetry writer.
- `server/app/model_config.py:378` — binds the immutable active model version inside submission; no sleep in this function.
- `server/app/main.py:264` — native control socket receive and 250 ms durable event pump.
- `server/app/config.py:16–19` — model timeout, graph step limit, and worker concurrency defaults.
- `server/app/plugin_runtime.py` and the two shared plugin manifests — unconditional prompt/tool aggregation.

### Related specs and external references

- `.trellis/spec/backend/index.md` — independent Python service boundary.
- `.trellis/spec/backend/server-agent.md` — durable event ordering, session serialization, real-data evidence separation, and last-forty-message continuity.
- `.trellis/workflow.md` — research persisted inside the active task and no implementation from this role.
- No external documentation was required: this question is about the current local runtime and source. Earlier memory was used only to retain the saved-configuration-first and evidence-separation procedure.

## Caveats / Not Found

- Proxy queuing, network setup, upstream admission, inference/prefill, and SDK overhead are not separately measured. The model trace is not a pure provider-compute stopwatch.
- No dedicated timer identifies the exact pre-claim one-second cause. The local event clear/wait and session `SKIP LOCKED` path deserve targeted instrumentation before changing concurrency behavior.
- Actual frontend paint latency is outside this researcher's scope.
- No change or new request was made. No implementation/check context manifests were loaded.

## Follow-up: stable pre-claim second, bounded root-cause investigation

### Additional real evidence

This follow-up remains read-only and makes no new request, fixture, service change, or product-code edit.

- The original API PID `61049` began at September 29 14:06:57. Source modification times for `agent_service.py`, `runtime_store.py`, `main.py`, `coordination.py`, `model_config.py`, and `db.py` all precede September 18. The Python 3.12 agent-service bytecode cache predates process startup as well. This excludes the obvious explanation that the wakeup code under review was added after these September 29 requests; it does not claim to have inspected live Python frame bytecode.
- Current configured worker concurrency is 2. Startup creates that many worker tasks at `agent_service.py:190–191`; workers share the single `asyncio.Event` created at `:142`.
- All four accepted events have exactly the same transaction timestamp as their respective run's `created_at`. Each `run.started` event is in a different transaction. There are zero intervening events for that session between acceptance and start. The accepted-to-start intervals remain 1,037.890 / 1,023.263 / 1,036.848 / 1,021.147 ms.
- A bounded September 29 lifecycle query found zero other running-run intervals overlapping each of these four pre-claim windows. This rejects a demonstrated queue behind another recorded run as the explanation for these samples. It does not time worker housekeeping.
- The six relevant public tables (`agent_sessions`, `agent_runs`, `agent_messages`, `agent_events`, `run_trace_states`, `model_config_state`) have no user triggers. All 44 catalog triggers are internal foreign-key checks/actions. Source migrations and backend code contain no `pg_sleep` or custom delay trigger.
- Database defaults are `read committed`, `synchronous_commit=on`, `lock_timeout=0`, `deadlock_timeout=1000`, `track_commit_timestamp=off`, `log_lock_waits=off`. The one-second deadlock-check threshold is not a mandatory one-second wait per transaction. Commit and historical lock timestamps are unavailable from these settings.
- The existing 24-line API log contains zero matching worker-failure, session-notification-failure, execution-failure, or trace-write-timeout entries and one server-start entry. Absence of error logs does not exclude transient lock contention; these branches are not currently logged.

### Most useful candidate: event-pump read lock races worker claim

This mechanism is reachable from the source and matches the one-second fallback shape. It has **not** been observed directly for these four requests.

1. `RuntimeStore.submit` holds its explicit transaction through session validation, active-model binding, run/message insertion, and the acceptance event (`runtime_store.py:126–163`). The async context exits before its caller resumes. `AgentService.submit` therefore calls `_wake.set()` after the submission transaction exits (`agent_service.py:240–241`), not intentionally before commit.
2. Workers awakened by that event first run `recover_expired`, then `claim` (`agent_service.py:259–260`). Both are asynchronous database transactions. An awakened worker is not guaranteed to acquire the session row before the gateway's next operation.
3. Meanwhile the gateway finishes `service.submit`, then immediately reads the ordered event stream (`main.py:295`, `:309–313`). `events_after` opens its own transaction and calls `_session` before reading events (`runtime_store.py:114–118`).
4. `_session` always issues `SELECT * FROM agent_sessions ... FOR UPDATE` (`runtime_store.py:60–64`), including this read/authorization use. The row lock lasts until the `events_after` transaction exits. New events remain safely persisted, but a concurrent worker can encounter this row lock.
5. `claim` uses `FOR UPDATE OF s SKIP LOCKED` (`runtime_store.py:330–335`). If the event reader holds the target row when each idle worker tries to claim it, those attempts can return no session even though its queued run is committed (`:337–338`).
6. Each no-work worker clears the shared wake event and waits up to one second (`agent_service.py:268–272`). The event-pump read's transaction release does not set a new worker wake. The next fallback scan then claims the task; a one-second wait plus ordinary query overhead has the same shape as the four measured intervals.

This is stronger than saying “there is a one-second poll”: it identifies the competing row lock, the no-work branch, and the absence of a wake on lock release. It is still a causal candidate rather than proof that the event reader won the lock race in any particular recorded request.

### Separate candidate: wake is cleared after a no-work scan

`_wake.clear()` happens after the awaited recovery/claim scan. A submit notification arriving during a scan can be erased immediately before that worker waits. Moving clear before the scan prevents this particular scan-to-wait lost-notification window. A shared `Event` clearing after other waiters were already awakened does not retract their already delivered wakeups; do not describe it as cancelling all workers' wakeups.

This candidate alone is a weaker explanation for four repeatable intervals than the competing session read lock, because an idle worker normally waits and a submission sets its event. There is no recorded timing identifying which branch occurred. The two mechanisms can also interact when workers wake, skip a temporarily locked session, then clear the notification.

### What is not in the one-second path

- `_renew` begins only inside execution after claim, and its first sleep is `LEASE_SECONDS / 3 = 10` seconds (`agent_service.py:274–277`, `:297–298`; `runtime_store.py:54`). It cannot explain a delay before `run.started`.
- Configuration resolution, model-object creation, historical reads, and graph setup occur after claim and total only 30–61 ms in these samples. They are not the observed approximately 1.02-second pre-claim gap.
- The normal submit path has no unconditional one-second delay, and the recorded run intervals provide no evidence of another model run occupying the workers.
- Transaction-start timestamps do not reveal commit-completion time. A submit transaction or durable commit cost cannot be numerically ruled out without a phase timer, despite the lock-skip candidate's better shape match.

### Smallest repair options for review, not implemented

1. Remove the unnecessary exclusive session-row lock from the event-pump read/authorization path only. For example, give `events_after` an account-scoped read that validates ownership without `FOR UPDATE`; retain the explicit session locks for submission, claiming, snapshot-water-level consistency, and business writes. Do not globally weaken `_session`, and preserve foreign-session rejection plus ascending event replay.
2. Move the wake reset before the worker's recovery/claim scan so a notification arriving during that scan remains set at the subsequent wait. This closes the lost-notification window, but **does not by itself** solve a scan that legitimately skips a row still held by another transaction and then has no new notification when that lock is released.
3. Keep a bounded fallback scan for recovery. Removing the timeout or busy-looping after every empty claim would introduce a new load problem rather than establish correctness.

These are options, not a claim that a patch has been applied or that either change alone would remove the observed second. A future change must retain same-session serialization, durable acceptance ordering, and gap-free replay.

### Minimum next verification

Past lock/wakeup timing cannot be reconstructed from the current metadata and logs. To distinguish the candidates, the next phase needs temporary, bounded phase timing in the real backend, followed by the user's next ordinary real message. No fabricated queued run or extra model request is needed for the plan itself.

Record monotonic timestamps and opaque run/worker correlation only, with no prompt/history/credential content: submission transaction exit; wake set; worker scan begin/end and claim success/empty; wake state before clear/wait and timeout-versus-notification return; event-pump session-lock acquisition and transaction exit. A wait beginning immediately after an empty claim while the event reader owns the row would identify the lock-skip path; a wake set between scan start and clear followed by a timeout would identify the lost-notification path. A long submission transaction would instead appear before the wake.

That instrumentation requires a separate implementation/restart step. This research stops here without modifying or restarting the service. Tests with mocks, if later written, can establish reachable scheduling behavior but must not be presented as proof of what happened in these four real calls.
