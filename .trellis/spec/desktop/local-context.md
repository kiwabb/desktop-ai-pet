# Local conversation context

## Scope and authority

The user authorized local-first context optimization on 2026-09-29. This policy
applies only to Rust local mode; Python server context policy is unchanged. Local
mode can call a remote configured model endpoint: it does not imply offline model
inference. Original messages and committed business effects remain authoritative.

## Signatures and ownership

- `local_agent/context.rs`: `ContextPlan::new(snapshot, system)` and
  `assemble(current, tools)` select model input and return numeric diagnostics.
- `Store::context_snapshot(run_id)` returns same-session preceding whole turns,
  unresolved tool facts and a usable summary, in one SQLite transaction.
- `Store::context_summary_snapshot(run_id)` reads the earliest contiguous terminal
  prefix after the cache watermark, independently of the recent-history window.
- `Store::save_context_summary(session_id, expected_revision, through_ordinal,
  content)` performs a strictly advancing revision CAS. Revision zero means absent.
- `Store::search_context_history(run_id, query, limit)` exposes bounded excerpts
  through registered tool `local_history_search` / `local.history.search`.
- `Store::record_context_metrics(run_id, step, metrics)` stores a bounded whitelist
  of numeric/boolean metadata in local SQLite only. No prompt or credential logging.
- `context_summary::schedule/cancel` own a separate tagged `summary_task` slot in
  `backend::Inner`, never the foreground worker handle.

## Contracts

The ordinary input target is 6,000 **estimated** tokens, including serialized
message framing, system instructions and all tool schemas. Estimator v1 counts
ceil(ASCII bytes / 4) plus one per non-ASCII scalar. This is not provider usage or
a declaration of the model context window. Preserve the current user input, latest
two complete turns, unresolved tool facts and complete current call/result chains;
record `budget_exceeded` if these indispensable inputs exceed the target. Rebudget
older history at each model step. Never silently truncate a mutation result.

Recent snapshots are capped at 256 complete terminal turns. Raw records are never
deleted or rewritten by context selection or summarization. Historical summaries
and retrieved excerpts are fallible data, not instructions or current business
state. Source run/message timestamps accompany historical text. Resolve historical relative dates only with an explicit date or a complete historical timezone/time anchor, never today. UTC source dates alone do not establish the user’s historical calendar day; summaries with insufficient anchors retain the relative words and provenance and mark the date unresolved. Original conversation facts take precedence over an assistant recap; when lookup only finds a recap or an overly narrow phrase, inspect the original conversation with a shorter literal query or a broader bounded recent page before declaring the detail absent. New user corrections and newer raw messages take precedence; query business
tools for current Todo/Memo state. All nine existing business tools remain available.

Summary candidates leave two source turns uncompressed and trigger at six eligible
turns or 4,000 estimated source tokens. A summary request uses at most 6,000 estimated
input tokens and 1,200 output tokens, the same configured model and no tools. Source
coverage advances only through the contiguous prefix actually included in input;
an oversized next source stops advancement rather than skipping it. Every cached
fact has validated source run IDs. Invalid JSON, invented sources, incomplete output
or model failure leaves the prior cache intact. Queued/running turns stop coverage;
failed/interrupted turns remain explicitly identified as such.

Run completion schedules summary work only when the worker is idle. A new submit
cancels summary work; mode/config changes abort it and advance generation. Hold no
agent/store lock across HTTP awaits. Validate generation and tagged slot before
calling the model and again atomically with the synchronous CAS save. Older requests
must not consume a summary whose watermark reaches their own run ordinal.

History lookup is read-only, limited to the current session and earlier run ordinals.
Its query is a literal case-sensitive substring of at most 200 characters; empty
query means recent messages. Limit is 1–10; excerpts are at most 600 characters and
include message/run IDs, original message `created_at`, source length, excerpt offset, truncation and `has_more`.
No interpolated SQL, model-selected session IDs, fake complete-recall claim or
automatic Memo/profile creation. Tool effects use the normal durable event lifecycle.

Schema v3 adds only `agent_context_summaries` and `context_request_metrics` caches.
Migration and version advance share one transaction. Preserve installed v1 and v2
rows, and allow reopening v3. Keep all context metadata local; do not upload it to
the server admin trace store.

## Error and verification matrix

| Condition | Required behavior / evidence |
| --- | --- |
| Required input exceeds target | Preserve it, set explicit estimate/over-budget metadata |
| No summary / below threshold | Use budgeted raw history and original-history retrieval |
| Stale summary completion or config switch | Reject/abort; no old-generation cache write |
| Invalid or oversized summary | Keep prior cache and original records |
| History query has no matches | Real empty result; no invented excerpts |
| Provider supplies no token usage | Keep usage absent; never substitute the estimator |
| App restarts | Existing raw data, cache and source watermark persist; no business retry |

Required isolated tests cover complete turns, tool pairing, oversized input,
source/correction precedence, contiguous summary coverage, future/session isolation,
stale CAS, v1/v2 migration, query/output bounds and cancellation. A native build and
isolated fixtures do not establish real model invocation. Live acceptance must use
the saved endpoint and original database, observe actual request/reply and follow-up,
and compare original message identities/content after migration. Do not fabricate
chats merely to activate the summary threshold; report inactive summary honestly.

## Wrong / correct

Wrong: summarize the latest 256 turns and mark every older turn covered. Correct:
read the earliest unsummarized contiguous prefix and advance only through sources
actually sent to the summarizer.

Wrong: overwrite `run_task` for every accepted message or reuse it for summaries.
Correct: one tagged worker drains the durable queue; summaries have a separately
cancelled slot and user requests take priority.
