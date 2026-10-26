# Approved scope: local context optimization

User authorization: “先做单机的吧”, following the plan for input budgets,
incremental local summaries, on-demand history lookup and real validation.
This extends the active task; no second task or server rollout is required.

## Outcome and acceptance

- Rust local mode sends a bounded selection of complete recent conversation turns,
  a source-linked historical summary when available, unresolved tool facts and the
  unchanged current user message. Old raw messages remain durable and searchable.
- Initial ordinary-request target: 6,000 estimated input tokens including system
  instructions and tool schemas. It is a configurable policy in code, not a model
  context-window claim. Estimation must be named as estimation. Oversized current
  input/recent indispensable state is preserved with an explicit budget-exceeded
  metric rather than silent truncation. Re-budget between tool steps, preserving
  assistant-call/tool-result pairs and current turn semantics.
- Summary work runs only past a meaningful threshold, off the user reply path,
  with the currently configured local model and no business tools. Summary errors
  leave old cache and raw history intact. Existing summaries cannot be used for
  a request older than their source watermark. Summary is fallible historical
  context, never trusted instructions or current business state.
- Original details can be retrieved with a bounded read-only local history tool
  constrained to the current session and earlier run ordinals. Results cite source
  message/run IDs and are marked as historical data. Query parameters and output
  size are bounded; truncated results expose the limit instead of claiming complete
  recall. No fake user profile, automatic memo creation, or silent remote sync.
- Preserve current nine business tools and their actual stored results. No
  keyword-only capability removal. If read-only list results are compressed for
  model context, preserve record identity/state and indicate omitted content;
  mutations and durable effects remain unchanged.
- Pure/isolated tests: whole-turn selection, current-input protection, long text,
  summary threshold and failure fallback, source/correction precedence, cross-session
  and future-run rejection, stale-summary CAS, schema migration preserving v1/v2
  rows, tool-call pairing, history lookup bounds, cancellation and restart.
- Real acceptance uses the saved local endpoint/model and original local SQLite
  data. Observe actual request/reply and a follow-up; do not seed chats or business
  records to manufacture summary activation. If existing history is below the
  threshold, report the honest inactive-summary state; an explicit real summary
  maintenance run may summarize existing history only, with provenance preserved.
  Separate raw input estimates from provider usage and native-paint timings.

## Design and ownership

No Python, shared plugin manifest, frontend layout or model selection changes. The existing frontend tool-presentation registry adds only a friendly local-history label and bounded excerpt result.
Local and server context policy intentionally differ during this local-first phase;
preserve common business-tool/protocol contracts. Local metadata remains in SQLite,
not the server admin/trace database. Do not log prompts or credentials.

Storage owner: `src-tauri/src/local_agent/context_store.rs` (new), plus minimal
`store.rs` migration/access changes. Store module exposes `conn` only to its parent
scope where necessary. Types live in `context_store.rs`:

- `ContextTurn { run_id: String, ordinal: i64, status: String, created_at: String, user: String,
  assistant: String }`.
- `ContextSummary { revision: i64, through_ordinal: i64, content: String }`.
- `ContextSnapshot { session_id: String, before_ordinal: i64,
  turns: Vec<ContextTurn>, unresolved: Vec<Value>, summary: Option<ContextSummary> }`.
- `Store::context_snapshot(run_id: &str) -> Result<ContextSnapshot, StoreError>`:
  one consistent SQLite read; preceding turns in chronological order (bounded up
  to 256), same session only, optional usable summary and old unresolved facts.
- `Store::save_context_summary(session_id: &str, expected_revision: i64,
  through_ordinal: i64, content: &str) -> Result<bool, StoreError>`: atomic CAS,
  strictly advancing contiguous terminal source boundary (completed/failed/interrupted); no original-record replacement. Queued/running turns cannot be crossed.
- `Store::search_context_history(run_id: &str, query: &str, limit: usize)
  -> Result<Value, StoreError>`: bounded literal search (no SQL interpolation),
  same session and past runs only, source IDs/excerpts/has_more. Empty query may
  return a bounded recent-history page; caller-visible semantics must be explicit.

Summary candidates must begin immediately after the previous source watermark and read the earliest contiguous terminal prefix, independently of the recent-turn snapshot cap. Never skip unseen older turns while advancing coverage.

Final coordinated storage additions: `context_summary_snapshot(run_id)` supplies earliest uncovered source turns; `record_context_metrics(run_id, step, metrics)` accepts only bounded whitelisted numeric/boolean metadata, never prompt text.

Store migration v3 creates only cache/metadata tables inside a transaction with
the version advance. Handle real installed v1, current source v2 and reopening v3.
Storage owner does not edit `local_agent/mod.rs`; integration owner registers it.

Integration owner: new `context.rs`, `context_summary.rs` and optional local
history plugin; `runtime.rs`, `local_agent/mod.rs`, local plugin registration,
`backend/mod.rs` only for summary task lifecycle, `llm/mod.rs`/`sse.rs` only as
needed for bounded summary calls and provider-usage metadata. Existing modified
files belong to other work too; preserve their edits. One context-policy owner
centralizes limits/estimation and reusable request assembly. Summary tasks use a
separate tagged/cancellable slot; generation is checked before HTTP and before CAS
write, with no app/store lock held across await. User runs take precedence over
summary work. Do not reuse or overwrite the ordinary run-task handle.

The runtime owner may add a small local metadata table/API through coordination
with the storage owner if needed to prove request size and timing. No prompt-body
collection. Resolve small interface refinements directly between owners and record
the final contract here rather than expanding public Tauri APIs.

## Verification and delivery order

1. Snapshot pre-existing dirty files; implement storage and runtime in parallel.
2. Run scoped Rust tests and one integrated check; independent Trellis review.
3. Build the ordinary native app, preserve the installed app and SQLite/config,
   inspect the real local mode flow and data continuity, then retain the approved
   app behavior. No seeded data, second demo service or silent model substitution.
4. Update desktop code-spec with final executable contracts and evidence. Commit
   only this task's separable changes; keep unrelated overlapping work intact.

Baseline copies: `/tmp/desktop-pet-local-context-baseline-20260929/manifest.json`.
The larger companion task remains active; do not archive it for this slice.

## Real acceptance correction

The first installed real lookup succeeded, but a subsequent date question matched only the assistant recap and produced an incorrect claim that the original date was absent. Preserve that real result as evidence, not as a passing recall check. Add original run/message timestamps to model context and retrieved sources, carry time into summary input, and state a generic rule to verify original conversations when a narrow search only finds an assistant recap. Re-test the same date question against the same real conversation; do not inject the expected answer into the request or fabricate source records.
