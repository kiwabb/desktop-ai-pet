# Verification — 2026-09-07

## Static and isolated checks

- Gateway: 12 isolated tests passed, including revocation during socket waits, ordered acceptance and protocol-version validation. These use explicit mocks.
- Runtime: 21 isolated tests passed. These do not establish real model/tool execution.
- Desktop: `pnpm build` passed; Rust focused tests 3/3 passed after independent control/node reconnect and exact request acknowledgement fixes.
- Root documentation and specifications updated; documentation-only changes do not require another build.

## Real runtime observations

- The independent assistant API runs on loopback port 18081, with this project's PostgreSQL on 15434 and Redis on 16380. Dependency health succeeded; model configuration presence alone does not prove model availability.
- Existing sub2api and sub2api-redis containers were started at the user's request. Both reported healthy. `http://127.0.0.1:8080/health` returned `{"status":"ok"}`. Existing shared PostgreSQL was already running and was not restarted.
- The first real read-only query failed because the configured model endpoint had no listener. Run: `0d2a13ae-7d49-4323-9014-0558d00ab5a4`.
- After starting sub2api, another actual model request reached the endpoint but failed with HTTP 502. Run: `909cd538-da69-4319-acff-fd6cc72d5b23`; request: `af4307da-6b30-452c-8bbd-4e7d0bf9def9`. Recent sub2api logs contained `no available accounts`; account eligibility and upstream availability have not been established.
- The smoke script exited nonzero at its terminal-event assertion. No successful smoke report was generated. This is evidence of a persisted failed run, not of successful tool use or streamed model text.
- No demo database, seeded todos or simulated runtime model responses were created. Genuine failed conversation records were retained.

## Successful real read-only checks after provider recovery

- The user restored model availability. Real model `gpt-5.6-luna` successfully called `todo.list`; a completed result contained `items: []`, followed by 5 streamed message deltas and `run.completed`. A repeated request reused its original run; protocol reconnection recovered the persisted session. Evidence: [read-only service report](research/service-readonly-evidence.json).
- Native desktop configuration was created privately from the already issued device credential. The latest existing debug executable was bundled with `pnpm tauri bundle --debug --bundles app`; this packaged existing output without another compile. The dev application runs against Vite on 1421, with independent Python API on 18081. The unrelated Desktop copy of the app was not replaced.
- In the actual Tauri app, the existing compact composer showed `助手已连接`; a submitted read-only query expanded the conversation. Observed messages: the user query with `已发送`, assistant `目前没有待办。`, and `查询待办 · 已完成 当前没有待办事项。`. The draft cleared after acknowledgement. Evidence: [observed UI text](research/desktop-readonly-state.txt), [actual screenshot](research/desktop-readonly.png).
- Desktop session `d24a882d-334a-467e-a285-681de2a33205` contained two messages and one successful tool call at sequence 10. The full HTTP snapshot was identical before and after restarting this project's API; todos remained empty. Evidence: [restart report](research/service-restart-evidence.json).
- The UI observation captured a completed response, not text growing across multiple frames. The Computer Use native pipe later failed twice, so the outage/reconnection UI state was not observed. This tooling failure does not imply a desktop failure or successful UI recovery.

## Continued real boundary checks

- Invalid device tokens were rejected with HTTP 403 for todo reads and during both control/node WebSocket handshakes.
- An authenticated node registration advertising unsupported `computer.execute` was rejected. The real desktop node lease remained present and unchanged; the check did not replace its connection generation.
- Evidence: [real boundary report](research/service-boundary-evidence.json). These checks did not call the model or create todos. Revoked-token and cross-account scenarios remain supported by isolated tests, not this real check.
- Retrying Computer Use after resetting its JavaScript kernel still returned `Sky Computer Use native pipe startup failed`. No further UI success is claimed.
- Correction to the earlier conversational completion claim: a successful empty query does not prove todo creation. Parent acceptance remains incomplete, consistent with the task status.

## Disconnect while the real model is running

- A real read-only model task was submitted, then the control WebSocket was closed immediately after `run.started`, before receiving any tool or model result.
- The task completed without that control connection. The real `todo.list` tool completed and the persisted assistant message was nonempty.
- Reconnecting recovered the entire saved snapshot. Repeating the exact request returned the original run; the session still contained exactly one run and its snapshot was unchanged. Todos remained empty.
- Evidence: [disconnect-during-run report](research/disconnect-during-run-evidence.json). This establishes server execution independence and protocol recovery, not desktop UI recovery.
- Computer Use remained unavailable. A temporary compatibility symlink for the updated official plugin did not resolve startup and was removed immediately. No persistent plugin or security configuration was changed.

## User-confirmed create/query acceptance

- The user was asked to create a real todo through the desktop assistant and query it back, then explicitly reported: “验证了没问题”.
- The create → query user flow is accepted on the basis of that manual confirmation. This is user-reported UI evidence, not an additional agent-observed run or a fabricated tool report.
- No extra acceptance todo was created by the agent. The user's confirmation does not extend to unobserved transient streaming or outage/recovery UI behavior.

## Remaining acceptance

- Complete real desktop observations of growing streamed text, running tool state and outage/reconnection recovery. Successful completed-state display alone does not establish these transient flows.
- Keep parent and child tasks in progress until their acceptance evidence is complete. Workspace root is not a Git repository; no commit or push was performed.
