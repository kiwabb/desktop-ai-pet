# Research: Conversation history and short follow-up trace

- Query: Why did “创建代办” after the offered “15:15喝水” receive another request for content? Is conversation history present?
- Scope: internal; RuntimeStore, AgentService, native session lifecycle and existing isolated tests. No database access, model call, runtime mutation or code edit.
- Date: 2026-09-07

## Findings

### History exists in storage and in the model input path

- `server/app/runtime_store.py:125-161`: each accepted run inserts the user text and one initially empty assistant record in the same transaction. `append_delta` at lines 208-216 appends public model text durably to that assistant record.
- `server/app/runtime_store.py:291-306`: history selects the preceding runs in the same session AND account (`r.ordinal < current ordinal`), takes the latest 40 nonempty user/assistant messages descending, then reverses them to chronological order. This is explicit bounded conversational history, not merely UI display history.
- `server/app/agent_service.py:221-237`: `_run_graph` reads that history, maps user rows to HumanMessage and assistant rows to AIMessage, prepends system prompt, then appends the current input. `model.astream(state['messages'])` receives that constructed list.
- `server/app/agent_service.py:272-277`: each run has its own checkpoint thread intentionally; cross-run history comes from RuntimeStore, not reuse of the LangGraph checkpoint. A fresh thread does not imply missing conversation context.
- `server/app/runtime_store.py:163-180`: session locking prevents two tasks in one session from executing concurrently; oldest queued run is claimed first. A normal follow-up therefore waits for the preceding run.

### Session continuity is implemented

- `src-tauri/src/agent_client.rs:435-448` loads persisted config on initialization.
- `src-tauri/src/agent_client.rs:470-476` preserves the session when endpoint and credential are unchanged; a changed endpoint/token deliberately resets it.
- `src-tauri/src/agent_client.rs:578-589` opens the stored session on reconnect. Lines 627-632 persist the accepted snapshot's session ID before marking connected.
- `src-tauri/src/agent_client.rs:490-504` sends current snapshot session ID with each submission.
- `server/app/main.py:171-180` creates a session only when session.open does not specify an ID; run.submit must match the opened session.

### Confirmed reminder mismatch and likely follow-up weakness

- `server/app/agent_service.py:31` explicitly tells the model that reminders are unsupported. `server/app/todo_tools.py:10-29` exposes only create, list and complete. Therefore “暂不支持设置提醒” is consistent with the current model capability boundary, even though direct list UI scheduling exists.
- `.trellis/spec/backend/todo-reminders.md:1-5` explicitly scopes reminders to direct operations and excludes a model tool. Do not advertise conversational reminder success by prompt edits alone.
- Prompt lines 23-32 have no instruction to resolve a short affirmative/create follow-up from an unambiguous immediately preceding user request or assistant proposal. The creation tool requires a title but does not require the title to be repeated in the latest message. If the two preceding nonempty messages are in the same session and within the 40-message window, they should reach the model by code contract. Asking for content then indicates failure to use available context, not proof of absent history.
- Concrete loss boundaries: more than 40 nonempty messages truncates older content; changed/absent persisted session scopes history away; empty assistant content is excluded. Successful prior tool call payloads are not replayed across runs, only visible assistant/user text. Failed/interrupted tool results are separately included as data. The quoted immediate text-only exchange does not itself implicate tool-history omission.

### Verification gaps and recommended bounded regression coverage

- `server/tests/test_runtime_graph.py:38-55` defaults every graph test to empty history. Existing tests cover streaming, tools, checkpoint and failure handling, but no test asserts nonempty prior user/assistant messages arrive before the current short follow-up.
- Add isolated assertions for exact message order/roles, bounded chronological store selection/account-session scoping, and failed/interrupted committed-result context. These prove transport/assembly, not real model semantic compliance.
- To settle this reported occurrence, inspect only the two actual run/session IDs, ordinals, saved messages, and output of RuntimeStore.history for the follow-up. That live inspection belongs to the main session. A read-only real-model replay with writes disabled can separately evaluate the short-follow-up prompt correction; do not create synthetic business records or execute the overdue drink-water request merely for testing.

## Related specs and external references

- `.trellis/spec/backend/server-agent.md`: durable events, per-session serialization, real tool truth, account boundaries, and evidence levels.
- `.trellis/spec/backend/todo-reminders.md`: direct scheduling and no model-tool scope.
- External references: none needed; this is a source-grounded trace of the repository implementation, not a library-version recommendation.

## Caveats / Not Found

- Source inspection alone cannot prove the reported live request had the same persisted session or which messages reached the provider. No real database, provider request trace, or native UI was inspected in this research.
- No history or message assembly regression test currently validates the quoted follow-up scenario. No code changes were made.
