# Research: Capability data in server-mode context

- Query: Are Memo/Todo records automatically injected or semantically retrieved; how do tools enter this turn's messages?
- Scope: internal; current server graph and its Todo/Memo plugins only. Static source inspection; no service, data, or product-code changes and no model call.
- Date: 2026-09-29

## Findings

1. Initial server-mode messages do not automatically read all Todo/Memo records. `server/app/agent_service.py:365–372` constructs messages from system instructions, history, unresolved tool facts, and the current user message. The automatic content from plugins is capability rules and tool schemas, not a current snapshot of their stored records. Historical replies and unresolved tool facts can nevertheless contain previously read records.
2. A model-emitted tool call routes the graph from model to tools and back to model (`server/app/agent_service.py:466–487`). The plugin registry validates/executes the call and commits its actual result (`server/app/plugin_runtime.py:82–103`). The graph serializes that result or error into `ToolMessage`, retaining the causal call ID/name, and includes it in the same run's next model call (`agent_service.py:476–480`).
3. Memo lookup is an account-scoped relational list, filtered only by kind and whether archived records are included, ordered by creation time/id (`server/app/plugins/memo/store.py:154–161`). `memo_list` is the declared lookup entry (`plugins/memo/plugin.json:64`; `server/app/plugins/memo/tools.py:34`, `:121`). This path has no keyword query, embedding similarity, ranking, or limit.
4. Todo lookup similarly lists account records by creation time/id (`server/app/plugins/todo/store.py:135–139`; dispatch at `server/app/plugins/todo/tools.py:92`). It does not automatically select records relevant to the current utterance.
5. In this examined message-building/plugin path there is no separate user-profile injection, automatic conversation summarizer, or vector-memory retrieval. A Memo may be an explicitly saved `note` or `goal`; the manifest instructs creation only when the user asks to record it (`plugins/memo/plugin.json:167`). That persistence is distinct from automatic learned user memory.

## Related specs / external references

- `.trellis/spec/backend/server-agent.md`: tool results and actual persisted effects, account scope, and the separate history/continuity contract.
- No external reference was required. The findings describe the current local source rather than an external framework claim.

## Caveats / Not Found

- This is a narrow static trace of the current server-mode path; it is not a repository-wide assertion about every mode or unconnected experimental module.
- No live tool call was made in this research. The tool result path is verified from source, not newly exercised end to end.
- The researcher-role contract requires a durable research artifact; this report is the only written file. No product file, service, or business data was changed.
