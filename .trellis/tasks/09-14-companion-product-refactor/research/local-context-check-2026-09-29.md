# Independent local-context review — 2026-09-29

## Scope and decision

Reviewed the local-context slice against `local-context-optimization-2026-09-29.md`,
the task PRD/design/implementation record, and `.trellis/spec/desktop/local-context.md`.
Compared existing files with `/tmp/desktop-pet-local-context-baseline-20260929/`,
not the unrelated full dirty working tree. Followed `trellis-check/SKILL.md`.

No confirmed implementation blocker found for proceeding to native real-model
acceptance. This is a source/isolated-test review, not evidence that an installed
app, saved model, actual summary call or migrated user database has worked.

## Reviewed contracts

- `context_store.rs:64–161` reads the current run's session and strictly earlier
  ordinals in a transaction. The ordinary snapshot is capped at 256 terminal
  complete turns; the summary snapshot starts at the earliest uncovered source,
  stops at a queued/running hole, and is independent of the recent-window cutoff.
- `context_store.rs:179` checks an advancing source boundary and revision CAS.
  Missing/stale revisions, a foreign session, an unsettled source, and a
  non-advancing watermark cannot replace a cache. Existing raw rows are not
  shortened or replaced. `store.rs:466` creates v3 cache/metrics tables and advances
  the version within the same transaction.
- `context.rs:65` retains the latest two complete turns, current user text,
  unresolved tool facts and current tool-call/result pairs. System instructions,
  schemas and serialized framing are included in the estimate. Essential input
  may exceed 6,000 with an explicit flag; older turns are removed as complete
  units. `runtime.rs:284` assembles again at each model step without deleting tool
  output from the current chain or changing durable business results.
- `context_summary.rs:41` passes only the contiguous prefix that fits the summary
  request budget and advances through its last actual source. Validation requires
  parseable bounded JSON and real allowed run IDs. Prior summaries are historical
  data, and newer raw input follows them. Invalid/truncated/failed outputs do not
  replace the prior cache.
- `runtime.rs:60,124` serializes worker admission and queue-empty/slot clearing
  under `AgentState`; an exiting worker clears only its own tagged handle. New
  submissions cancel the separate summary slot. `context_summary.rs:133,141`
  checks mode, generation, foreground-idle state and slot tag before HTTP and
  again while performing the synchronous CAS write. No agent/store lock spans
  the model await. Backend restart cancels both handles; local startup retains
  the existing interrupted-run recovery path.
- `context_store.rs:218` limits history lookup to the current session and earlier
  run ordinals. Literal bound parameters, a 200-character query, 1–10 results and
  600-character excerpts prevent unbounded result payloads and SQL interpolation.
  Provenance, excerpt truncation and `has_more` remain explicit. The new plugin
  uses the normal durable tool lifecycle and does not mutate Todo/Memo records.
- `context_store.rs:280` accepts a bounded whitelist of numeric/boolean/null
  metadata only. SSE usage-only chunks preserve provider counters without visible
  text or arbitrary response fields. Input estimates and provider usage remain
  distinct. Existing nine business tools plus the local history tool are present.
- `src/lib/history/presentation.ts` registers both history names, distinguishes
  unavailable/failed/empty results, caps its visible excerpt preview, and has no
  Todo/Memo refresh effects. It does not advertise complete recall.

## Checks and small correction

- Runtime owner reported `cargo test --manifest-path src-tauri/Cargo.toml --lib`:
  **117 passed, 0 failed** after correcting test-only request IDs to valid UUIDs.
  Reviewer reused this coordinated run and did not run concurrent Cargo checks.
- Storage/presentation owner reported the history presentation plus existing tool
  tests: **13 passed**. This is isolated frontend test evidence, not native paint
  evidence.
- Reviewer independently ran scoped `git diff --check`: passed.
- Mechanical correction only: changed the `backend::Inner::run_task` comment
  from “run id” to “worker id”, matching the already existing tagged-worker
  implementation. No executable behavior was changed by the reviewer; no repeat
  build/test is justified for this comment alone.
- Tests inspected cover whole-turn selection, long current input, tool pairs,
  future-summary exclusion, contiguous source batches beyond 256 turns, pending
  holes, stale CAS, session/future isolation, bounded literal lookup, metrics
  rejection, v1/v2 record preservation, v3 reinitialization, source validation,
  summary cancellation/tag ownership, and SSE usage-only chunks.

## Evidence limits for delivery

- A next unsummarized whole turn larger than the summary input budget stops
  advancement; the implementation does not skip it and claim later coverage.
  Chatting and history lookup remain available. Do not report universal summary
  progress for arbitrarily large old turns.
- `raw_estimated_input_tokens` means all turns in the current capped snapshot
  plus mandatory/current context. It is neither the old implementation's measured
  40-message request nor all raw history in the database. Its ratio to the selected
  estimate is not proof of a measured old-version token reduction.
- Metrics are recorded with `completed=false` before the HTTP request. Successful
  steps add timing and usage; failure/abort currently keeps the initial estimate
  without final timing. Provider usage stays absent/null when not supplied.
- `first_text_ms` is time to parsed model text, not native painting latency.
- Cancellation ownership and source/CAS defenses have isolated tests and source
  review. Native concurrent-input timing and a real provider summary invocation
  are not established by these checks.
- No real DB, model, credential store or UI was accessed by this reviewer. Native
  acceptance must still preserve the original data, use the saved configuration,
  observe a real request and follow-up, and report the actual summary threshold
  state without seeding records.

## Post-build dead-code cleanup review

The native build exposed the replaced `Store::history`, `History` alias and
`HISTORY_WINDOW` as unused. Independently reviewed their removal from `store.rs`:
only the retired fixed-40-message path and its old shape test were removed. No
business storage/operation path changed; a scoped Rust search found no remaining
references to those symbols.

The unique failed-run committed-result assertion was retained and strengthened in
`context_store.rs`'s `unresolved_committed_effects_and_reconciliation_keep_source_and_full_result`:
it now covers both explicit `Failed` completion and interrupted-run recovery,
preserving full result and source identity plus pending-tool reconciliation even
after the source run falls outside the 256-turn ordinary snapshot. The removed
40-message limit assertion is obsolete under the approved new policy.

Scoped `git diff --check` passed after cleanup. Main is running the focused
`local_agent::` regression followed by the incremental native bundle; its result
must be appended before describing this final cleanup as test-verified. No second
Cargo run was started by the reviewer.

## Real date-follow-up failure and scoped correction review

Main reported that the first native request and follow-up both called the real
model/history tool, but the recall result was not correct: an earlier assistant
source explicitly included a calendar date, the first reply shortened it to a
relative date, and the follow-up searched only that narrow recap wording. It then
incorrectly claimed the original source lacked a date. These runs establish real
invocation only; they do not pass correct historical recall/date acceptance.
Reviewer did not access the real records or make further model calls.

The bounded correction was reviewed after both owners reported stable code:

- `ContextTurn.created_at` reads original `agent_runs.created_at`; both snapshot
  queries preserve the same session, ordinal, status and ordering constraints.
  History results expose the original `agent_messages.created_at`, not query time.
- Ordinary context adds separate source metadata while retaining the original
  user and assistant messages unchanged and in their original roles. Summarizer
  input adds original timestamps without changing its contiguous-source budget.
- General context/tool guidance prefers original facts and explicit dates over
  a later assistant recap, and requests another bounded search when a narrow
  query is insufficient. No acceptance-example string, date, search-rank change,
  fake record or mutated original text was introduced.
- New isolated assertions distinguish original run/message/query times, keep
  original and later recap roles/dates separate, and preserve explicit source
  dates in summary input. These assert transmitted data, not model accuracy.
- Scoped `git diff --check` passed. Main owns the final focused test and native
  same-question repeat; those results are pending and must not be inferred.

One prompt judgment was reported to main before acceptance: the summary request
does not include the ordinary request's configured default timezone. UTC source
timestamps alone do not establish the user's historical local calendar date at
a day boundary. The narrow recommendation is to preserve unresolved relative
wording and its provenance when the old conversation lacks an explicit date or
timezone, rather than silently treating a current configuration as a historical
fact. Main accepted this boundary and the runtime owner tightened only the summary
prompt: preserve explicit original dates; derive a relative date only with a full
original date/timezone anchor; otherwise preserve the relative wording and source
and state that its date is unresolved. Reviewer re-read the final prompt and ran
the scoped whitespace check successfully. No historical field, current-timezone
injection or date-guessing code was added. This resolves the prompt boundary for
the scoped review; it does not prove the real model will follow it. Final focused
tests and the real same-question date follow-up remain main's acceptance work.

## Final focused regression result

After removing the superseded fixed-window history path, the main process ran
`cargo test --manifest-path src-tauri/Cargo.toml --lib local_agent::`: **49 passed,
0 failed** (67 unrelated tests filtered). The failed/interrupted unresolved-tool
assertions now live in the new context snapshot tests. `node
tools/verify-local-agent.mjs` also passed its structural checks; neither command
called the real model or inspected user credentials.

## Source-time correction validation

After the real recall defect, the main process ran all local-agent tests again:
**52 passed, 0 failed**. Source run/message times, unchanged historical text/roles
and summary source times have dedicated isolated assertions. The final summary
timezone wording was followed by its focused four-test suite: **4 passed**. These
checks do not establish model answer correctness; native same-question retest is
recorded separately.
