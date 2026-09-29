# Research: Native long Markdown reply with one real Todo query

- Query: Independently verify the single newly submitted desktop request beginning `这是桌宠界面验收：只调用一次查询待办工具`, its actual model/tool execution, durable stream, terminal state, and preservation of the original two Todos.
- Scope: internal; the main session owns the native submission and UI observations. This researcher performs bounded read-only PostgreSQL checks and writes only this research file.
- Date: 2026-09-15

## Findings

### Identity and read-only protocol

The main session supplied the current session ID `d24a882d-334a-467e-a285-681de2a33205` and the exact new input:

> 这是桌宠界面验收：只调用一次查询待办工具，不创建、修改或删除任何记录。查询后，先用一句话概括当前待办，再写一份约500字的桌面助手使用说明，分成3个带标题的小节，最后给出一个3行JavaScript代码块。

At `06:22:11.972776Z`, candidate selection required that session, the supplied prefix and creation within `06:19:00Z`–`06:25:00Z`, capped at two matches. Exactly one candidate was found. A second transaction at `06:23:19.816886Z` pinned that run UUID and independently required equality with the full input. It did not select a globally latest or historical run. The final provider-identity read at `06:24:00.443891Z` joined only the pinned run's immutable configuration version.

All timestamps below are UTC on 2026-09-15. The normal server `Settings` supplied the connection internally; no connection strings, credentials, secret versions or trace request payloads were printed or retrieved. Connections used `default_transaction_read_only=on`, a 5-second connect/statement timeout and 1-second lock timeout. The correlated stream/Todo checks used repeatable-read transactions. No `Database.open()`, migration, administrator login, API/model request or business write was performed by this researcher.

### New run and durable stream

| Field | Independently observed result |
| --- | --- |
| Run ID | `a9aa3ebf-5c0d-4fe1-8b82-4ee7c5c8f12a` |
| Request ID | `599cde59-2346-42d6-be8c-462263d48ba9` |
| Session | `d24a882d-334a-467e-a285-681de2a33205` |
| Accepted | `06:21:20.776674Z` |
| Started | `06:21:20.847257Z` |
| Completed | `06:21:42.456824Z` |
| Run status | `completed`, no stored error |
| Lifecycle counts | accepted 1, started 1, completed 1; no failed/interrupted event |
| Durable messages | 2; exactly one user message equals the full supplied input |
| Text delta count | **359** |
| First / last persisted text delta | `06:21:31.890065Z` / `06:21:42.257011Z` |
| Durable assistant length | **616 characters total**, including Markdown/code; **427 Chinese ideographs** |
| Stream-to-message comparison | Assistant content equals all ordered delta text exactly; summed delta length is 616 |
| Answer fingerprint | SHA-256 `8597707092acd45dafd2327f2faebab5fa74e01957c84054be8dc97be29e425f` |
| Markdown structure | 3 ATX headings; one JavaScript fenced block with exactly 3 code lines |

The persisted delta interval spans approximately 10.367 seconds. That is a database event interval, not a measured native animation/frame rate or proof that every delta appeared as a separate rendered frame. The generated reply is approximately the requested length, not exactly 500 Chinese characters. The bounded answer-tail check inspected only this new run's final 240 characters; unrelated history and trace request payloads were not read.

### Actual provider and model → tool → model sequence

The run and both model steps bind version `1291fa94-d7b7-4d9a-87e9-659aa234a6a3`. Its allowlisted provider endpoint is **`http://127.0.0.1:8080/v1`**, model **`gpt-5.6-luna`**. This is the saved endpoint for the actual run; the researcher did not alter configuration or infer provider identity from `/health`.

| Model step | 0: select Todo query | 1: produce answer |
| --- | --- | --- |
| Call ID | `4bc1fc3a-69bc-4aca-939f-e6d21b955452` | `a087f32c-5edc-4667-93db-c9568337dfa6` |
| Status | `succeeded` | `succeeded` |
| Started | `06:21:21.114080Z` | `06:21:26.946735Z` |
| Ended | `06:21:26.897426Z` | `06:21:42.431595Z` |
| Duration | 5783 ms | 15484 ms |
| First generated block | 5692 ms | 4944 ms |
| First visible text | Unavailable; tool-selection step | 4944 ms |
| Usage source | `provider` | `provider` |
| Input / output / total tokens | 1929 / 27 / 1956 | 2111 / 406 / 2517 |
| Provider token details | 11 reasoning output tokens | 1792 cache-read input tokens; 38 reasoning output tokens |
| Stored error type/status | None | None |

Exactly one tool row exists for the run:

- Tool identity: **`todo.list`**, ID `da4054fc-d3cd-5a5f-b4b9-ec3b1944b268`.
- Provider function-call identifier: `call_qI8LLhf3sgrIW95wp1ePjRjW`.
- Arguments: `{}`. Status: `completed`, no stored error.
- Tool event start/finish: `06:21:26.903159Z` / `06:21:26.926420Z`.
- Result: exactly two items; the complete five-field public result equals the actual account-owned Todo list in its normal order.
- `tool_trace_links` explicitly links this tool to model step 0, call `4bc1fc3a-69bc-4aca-939f-e6d21b955452`.
- Trace integrity: **`complete`**, expected steps 2, collected steps 2, no gap; final update `06:21:42.477551Z`.

These records establish real SDK/provider calls through the existing endpoint, one real Todo query, and a completed durable answer for this new desktop-submitted run. They are not a raw HTTP/SSE packet capture; absent error status is not an independently captured upstream HTTP 200. The upstream implementation beyond the configured local proxy was not inspected.

### Original Todo preservation

At both `06:22:11.972776Z` and `06:23:19.816886Z`, the scoped account contained exactly **2** Todos and exactly the original ID set. Both were completed with null reminders. Each SHA-256 used the normal pure `todo_view` result with all public fields (`id`, `title`, `status`, `created_at`, `remind_at`), JSON `ensure_ascii=False`, sorted keys, compact separators, UTF-8 encoding. Both hashes match the established baseline in `todo-native-mutation-verification.md`:

| Original ID | Unchanged SHA-256 |
| --- | --- |
| `3801041e-4a0b-4334-8bff-bd350550b1ac` | `06595881ae369ebfd33f1ba505e9f3e6a7f2f309f3b0f1c4f444846595067275` |
| `c6f4de0d-3e44-4ae1-aabc-048ad2e7cf0f` | `db0aa4d8fe6d77ed51cfd401b79ef3eb7e8444873d0694a4a6c571141c5bee7e` |

There are no mutating tool rows for this run. The original Todo preservation conclusion is bounded to these two checkpoints and the five compared public fields.

### Main-session native observations — separate evidence

The main session reports that the ordinary native UI acknowledged this input, cleared the composer and displayed `橘伴正在回复` with thinking state. Its next capture showed the current run's completed Todo-list card with the original two records while the answer was still running, before final prose was visible. The following observation already showed the final answer with its three headings and three-line code block. The main session did **not** capture an intermediate prose prefix or the brief in-progress tool card itself. These are reported main-session observations; this researcher made no UI capture or operation.

The main session then used Page Up and observed the current request, first answer section and `回到最新` control. It opened settings and returned with Escape; the same first-section reading position was restored. Clicking the latest control was still pending when this update arrived. Full code overflow behavior and recovery after closing/reopening remain separately owned by the main session; neither follows from the SQL results or the settings-return observation.

### Files, code patterns and related specs

- `research/native-chat-runtime-verification.md` — reused bounded run correlation, durable-delta and trace-integrity query protocol.
- `research/todo-native-mutation-verification.md` — reused original public-field fingerprints and current account/session scope.
- `server/app/config.py:8` — normal Settings loading, consumed without printing sensitive values.
- `server/app/runtime_store.py:371` — `append_delta` appends assistant content and a delta event in the same fenced transaction.
- `server/app/runtime_store.py:381` — `start_tool` records a distinct run/provider-call identity and prevents mismatched replay.
- `server/app/runtime_store.py:404` — `finish_tool` persists the actual tool result and corresponding event in its transaction.
- `server/app/runtime_store.py:424` — run terminal state and terminal event are persisted together.
- `server/app/plugins/todo/store.py:14` — pure five-field `todo_view` used for result and fingerprint comparisons.
- `server/migrations/002_runtime.sql:9`, `:26`, `:38`, `:62` — run, message, tool and event identities.
- `server/migrations/005_admin_model_trace.sql:44`, `:90`, `:102`, `:137` and `server/migrations/007_trace_repair.sql:1` — immutable config binding, integrity, model steps, tool links and timing fields.
- `.trellis/spec/backend/server-agent.md` and `.trellis/spec/backend/admin-control-plane.md` — real model/durable/UI evidence separation, trace completeness, server-owned credentials.
- Task PRD R5/R8/R9/R11/R12 — full native flow acceptance remains distinct from this database verification.
- External references: none; this check uses current repository protocols and actual configured PostgreSQL data.

## Caveats / Not Found

- No fixture, seeded answer, second model service or extra model request was introduced by this researcher. The ordinary authorized submission itself creates its real conversation/run/trace records.
- The 359 persisted deltas do not establish 60 FPS, native per-frame smoothness, or visible streaming recovery. Those require actual UI observations or measurements.
- Main-session evidence confirms final text/heading/code-block visibility and settings-return reading-position restoration. It does not establish an intermediate prose prefix, transient running tool card, all code overflow conditions or close/reopen recovery for this specific request.
- No code, configuration, other task artifact or another agent's work was changed.

## Follow-up: exact entrance-check reply and reported native restart recovery

### Correction to the researcher's earlier chat handoff

The previous final chat handoff incorrectly equated **359 delta events** with **359 characters**. That sentence is retracted. The independently queried values and this file's original table are authoritative: the long reply has **616 total characters**, including **427 Chinese ideographs**, delivered in **359 delta events**. Event count and character count are separate measurements.

### New request identity and SQL scope

At the main session's request, a single read-only, repeatable-read check at `2026-09-15T06:35:22.132731Z` correlated only the current session `d24a882d-334a-467e-a285-681de2a33205`, creation in `06:32:00Z`–`06:35:00Z`, and exact input:

> 界面入场检查：不要调用工具，只回复“已收到”。

The query allowed at most two candidates and returned exactly one. All subsequent queries pinned its run UUID. The established normal Settings/read-only connection protocol, 5-second connect/statement timeout and 1-second lock timeout remained in effect. No Todo query, fingerprint refresh, unrelated run/history read, UI operation, administrator login, model request, migration or data mutation was performed by this researcher.

| Field | Independently observed result |
| --- | --- |
| Run ID | `8e87522e-d492-4a94-86e3-94c6afa36ee4` |
| Request ID | `0cce5e89-b487-43f8-a14c-f1b1f5fd6176` |
| Created / accepted | `06:33:30.188054Z` |
| Started | `06:33:31.226889Z` |
| Completed | `06:33:33.574716Z` |
| Run status | `completed`; no stored error |
| Lifecycle | One accepted, started and completed event; no failed/interrupted event |
| Durable messages | Exactly 2; exactly one user message equals the supplied input |
| Exact durable answer | **`已收到`**, exactly **3 characters** |
| Text stream | **2 delta events**, summed text length **3**, exactly equal to the durable answer |
| First / last delta | `06:33:33.273272Z` / `06:33:33.278772Z` |
| Tool rows | **0**; no tool events |
| Bound configuration | `1291fa94-d7b7-4d9a-87e9-659aa234a6a3` |

The single actual model step has these trace fields:

| Field | Observed result |
| --- | --- |
| Model call ID / step | `a14c990e-4f96-4140-a189-1bce5c2c23c3` / 0 |
| Model / state | `gpt-5.6-luna` / `succeeded` |
| Configuration | Same immutable version as the run |
| Started / ended | `06:33:31.288518Z` / `06:33:33.563935Z` |
| Duration | 2275 ms |
| First generated / visible text | 1985 ms / 1985 ms |
| Usage source | `provider` |
| Provider input / output / total tokens | 2316 / 6 / 2322 |
| Stored error type/status | None |
| Trace integrity | `complete`, expected 1, collected 1, no gap |
| Trace final update | `06:33:33.587697Z` |

This independently establishes a new real model response with the exact requested answer, durable completion and zero tools. It does not reuse the earlier long reply's success or refresh the earlier Todo preservation timestamps.

### Main-session native observations and evidence limits

The main session reports that the new request was acknowledged, its composer cleared, and the actual `已收到` reply appeared without a new tool card after clicking `回到最新`. These UI observations are attributed to the main session, not inferred from the database.

The main session also reports that the earlier long reply, run `a9aa3ebf-5c0d-4fe1-8b82-4ee7c5c8f12a`, recovered after an ordinary app restart in frontend asset build `index-BijFjrp2`. Its three headings, code block and corresponding Todo tool card were visible. This new reported evidence closes the earlier pending ordinary-restart recovery observation for that specific long reply. The previously reported Page Up and settings→Escape reading-position checks remain separate UI evidence; no native frame-rate or every-intermediate-prefix claim is added.

Files/source contracts are unchanged from the bounded protocol above. This follow-up wrote only this appended section and introduced no code or runtime changes.

## Follow-up: sending from old history and observing intermediate prose

### Exact new request and independent verification scope

The main session reports sending from ordinary frontend bundle `index-DKBlzDJE` around 14:45 Asia/Shanghai. Its exact input was:

> 旧历史发送验收：不要调用工具。请以“发送可见”开头，分三段介绍桌面整理，每段约150字；只输出正文。

At `2026-09-15T06:47:08.031648Z`, this researcher performed one bounded read-only, repeatable-read PostgreSQL transaction using the established normal Settings protocol. Candidate selection required the exact input, current session `d24a882d-334a-467e-a285-681de2a33205`, and creation in `06:44:00Z`–`06:47:00Z`, capped at two matches. Exactly one candidate matched; subsequent queries pinned its UUID. Connection/statement timeouts remained 5 seconds and lock timeout 1 second. No credentials, connection strings, prior message bodies or trace request payloads were printed.

| Field | Independently observed result |
| --- | --- |
| Run ID | `97045ec4-7738-47b9-b4f2-281db4449136` |
| Request ID | `0bb5912d-dbb1-4a4b-baa1-e212be9f9b34` |
| Accepted | `06:45:35.077589Z` |
| Started | `06:45:36.099846Z` |
| Completed | `06:45:43.708253Z` |
| Run terminal | `completed`; no stored error |
| Lifecycle | accepted 1, started 1, completed 1; no failed/interrupted events |
| Durable messages | 2; exactly one user message equals the full supplied input |
| Tool count | **0**; no tool events |
| Assistant length | **365 total characters**, including punctuation/newlines; **329 Chinese ideographs** |
| Stream | **241 delta events**, summed text length **365** |
| Delta-to-durable comparison | Exact equality between the ordered delta text and persisted assistant answer |
| First / last persisted delta | `06:45:38.979177Z` / `06:45:43.682424Z` |
| Persisted delta time span | **4703.247 ms** (approximately 4.703 seconds) |
| Answer fingerprint | SHA-256 `927f6c08447606d11de81b948d834806dc96d459ddbe97c4ea048057c6d69b98` |
| Required prefix | Starts exactly with `发送可见` |
| Paragraph structure | Exactly 3 blank-line-separated paragraphs; no Markdown headings or fenced code blocks |
| Per-paragraph length | Total characters 120 / 119 / 122; Chinese ideographs 108 / 109 / 112 |

The reply is shorter than the requested approximately 150 characters per paragraph. The actual lengths above are the evidence; do not report strict satisfaction of that nominal length. Event count, text length and model token usage are separate quantities. The 4.703-second interval measures persisted text events, not native frame rate or synchronization with a specific Page Up operation.

### Actual current provider/model trace

The run binds immutable version `1291fa94-d7b7-4d9a-87e9-659aa234a6a3`. A narrowly scoped join to that version returned the allowlisted endpoint **`http://127.0.0.1:8080/v1`** and model **`gpt-5.6-luna`**. No secret version or authentication material was read or altered.

| Model trace field | Independently observed result |
| --- | --- |
| Model call ID / step | `81bfa131-ef72-45ff-841a-5f0fd7a53816` / 0 |
| Actual model steps | Exactly 1 |
| Status | `succeeded` |
| Configuration | Same immutable version as the run |
| Started / ended | `06:45:36.174130Z` / `06:45:43.698485Z` |
| Model duration | 7524 ms |
| First generated / visible text | 2805 ms / 2805 ms |
| Usage source | `provider` |
| Input / output / total tokens | 2365 / 272 / 2637 |
| Provider output reasoning detail | 24 tokens |
| Stored error type/status | None |
| Trace integrity | `complete`; expected 1, collected 1, no gap |
| Trace final update | `06:45:43.714851Z` |

This verifies a new successful actual model call, persisted completion, intact trace, zero tool execution and exact stream/message consistency for the specified request. No Todo rows or fingerprints were queried, because the run contained no tools. Earlier original-Todo preservation checkpoints remain unchanged and are not presented as freshly reverified.

### Main-session native observations — separate from SQL

The main session reports these observations from bundle `index-DKBlzDJE`:

- Before sending, Page Up had placed the reading area on old history and the latest control was visible.
- Pressing Return acknowledged the new request, cleared the draft, and immediately displayed the accepted new message plus thinking state. The latest control disappeared.
- The next screenshot captured the first paragraph and part of the second while the app still showed that it was replying. This is direct main-session evidence of visible intermediate prose for this specific request, beyond database delta persistence.
- At the following Page Up observation, the reply was already completed. The precise order between scrolling and the final incoming tokens was not captured.

These observations support send visibility from old history and native intermediate-text visibility. They do **not** establish whether scrolling occurred before or after the final tokens, whether a midstream reading position remained stable across later deltas, or native frame-rate smoothness. No such timing conclusion is inferred from SQL timestamps.

The source contracts and verification method are the same as those cited above. This researcher made no UI action, model request, business write, administrator login, migration, service operation or changes outside this appended research section.

## Follow-up: twelve-section generation and one real Todo query

### Correlation and verification boundary

The main session reports an ordinary native submission from PID **49271** with this exact input:

> 连续生成阅读验收：仅查询一次现有待办，不创建、编辑或删除任何记录。先用一句话说明查询结果，再写十二段桌面整理指南，每段约180字，段首依次标注第1段至第12段。请完整写完十二段，不要询问我是否继续。

The researcher waited for the main session's submitted/active-status confirmation before any database query. The first read-only, repeatable-read transaction at **`2026-09-15T07:41:36.473778Z`** required exact input equality, current session `d24a882d-334a-467e-a285-681de2a33205`, creation in `07:38:36.425433Z`–`07:41:41.425433Z`, and a run ordinal after known prior run `97045ec4-7738-47b9-b4f2-281db4449136`. The query allowed at most two matches and returned exactly one. That first snapshot was already **completed**; the researcher did not independently capture a running database snapshot.

A second bounded read-only transaction at `07:42:43.068493Z` pinned the exact new run UUID and session, rechecked the full input, and derived answer structure, bound endpoint, tool linkage and elapsed measurements. Both transactions used normal server Settings internally, read-only connections, repeatable-read isolation, 5-second connect/statement and 1-second lock timeouts. No credentials, connection strings, full answer text or unrelated conversation bodies were output. No model, API, UI, administrator, migration, service or business-write action was performed by this researcher.

### New run, actual stream and durable answer

| Field | Independently observed result |
| --- | --- |
| Run ID | `71bbce86-f1b9-4b59-a365-0c5847a46f10` |
| Request ID | `fb788c1e-4dba-4252-9051-9e12701f9856` |
| Accepted | `07:40:30.013349Z` |
| Started | `07:40:31.107984Z` |
| Completed | `07:41:01.189332Z` |
| Terminal state | `completed`, no stored error |
| Lifecycle | One accepted, started and completed event; no failed/interrupted event |
| Durable messages | Exactly 2; exactly one user message equals the full input |
| Text deltas | **1223 events**, summed text length **1802** |
| First / last persisted delta | `07:40:38.373304Z` / `07:41:00.284672Z` |
| Persisted text-event span | **21911.368 ms**, approximately 21.911 seconds |
| Acceptance → completion | **31175.983 ms** |
| Last delta → terminal event | **904.660 ms** |
| Durable assistant length | **1802 total characters**, including formatting; **1551 Chinese ideographs** |
| Stream consistency | Ordered delta text exactly equals the durable assistant answer |
| Answer SHA-256 | `189be58e6322956804601ed86ca6cddeb9d7f4a6ca5e422919ccff64f72b8e83` |
| Section labels | Exactly `第1段` through `第12段`, in order, detected at section starts |

Section lengths, including each section heading, are **145 / 144 / 145 / 149 / 144 / 140 / 140 / 142 / 146 / 145 / 149 / 151** total characters. The corresponding Chinese-ideograph counts are **129 / 124 / 125 / 115 / 131 / 126 / 122 / 128 / 126 / 129 / 135 / 136**. All twelve sections are present, but they are shorter than the requested approximately 180 characters each. Do not report exact compliance with that nominal length or confuse the 1223 events with answer characters.

### Actual model → tool → model execution

The run binds unchanged immutable version **`1291fa94-d7b7-4d9a-87e9-659aa234a6a3`**. Its narrowly read, allowlisted provider endpoint is **`http://127.0.0.1:8080/v1`** and model **`gpt-5.6-luna`**. Both actual model steps succeeded with provider usage:

| Trace field | Step 0: select query | Step 1: generate answer |
| --- | --- | --- |
| Call ID | `9b5da5a7-816b-46da-8f43-7b86a58b28b9` | `d520c931-76d0-46a3-aced-354724c4f96b` |
| Status | `succeeded` | `succeeded` |
| Recorded start | `07:40:31.245471Z` | `07:40:35.681335Z` |
| Recorded end | `07:40:35.627921Z` | `07:41:01.173826Z` |
| Reported duration | 4378 ms | 25482 ms |
| First generated block | 3389 ms | 2702 ms |
| First visible text | Unavailable; tool-selection step | 2702 ms |
| Usage source | `provider` | `provider` |
| Input / output / total tokens | 2688 / 55 / 2743 | 2870 / 1268 / 4138 |
| Provider token details | 39 reasoning output tokens | 1792 cache-read input tokens; 32 reasoning output tokens |
| Stored error type/status | None | None |

Exactly **one tool row** exists: **`todo.list`**, ID **`558bd021-7448-5043-a62b-293809f2889c`**, arguments `{}`, status `completed`, no stored error. Its result contains **two items**. The tool event timestamps are **`07:40:35.622068Z` → `07:40:35.646133Z`**, an event span of **24.065 ms**. `tool_trace_links` explicitly connects it to the step-0 model call. The step count is exactly **2**, and trace integrity is **complete**, expected 2, collected 2, no gap; final update `07:41:01.197592Z`.

Reported model durations and trace timestamps are separate telemetry fields; the linkage records establish step/tool association rather than inferring exact sequencing from async trace-write wall-clock fields. The short tool event span does not prove a running tool card was visible to the user. No mutating tool type appeared, so no additional Todo query or fingerprint refresh was performed. Earlier preservation checkpoints are not relabeled as current checks.

### Main-session native observations and remaining scroll evidence

The main session reports that its post-Return CUA observation contained the exact accepted prompt, thinking state, an empty composer and disabled `正在回复` control. In the same tool call it obtained the new `聊天记录` accessibility container, clicked it and issued Page Up. The returned filtered diff contained no content. That establishes the submitted action sequence and observed acknowledgement; an empty filtered diff does not independently prove that the reading area moved or retained its position.

The database establishes that actual text events continued until **`07:41:00.284672Z`**. To accept active-stream manual-scroll protection, the main session still needs an observed reading position while generation remains active and evidence that later visible/durable deltas arrived without pulling that position back. CUA action timestamps and the final database interval can support correlation, but neither an attempted Page Up nor the final text alone proves that interaction. A brief running tool card likewise remains unobserved unless the main session supplies an actual capture.

This section reports one new real run and its bounded checks. It introduces no seeded record, substitute backend, extra model request or source change.

Main-session follow-up for this same run: one later native capture showed the twelfth section still incomplete, with the composer offering the next draft and the spinner/helper still indicating `正在回复`. The Todo card was already **completed**, not running. This establishes visible intermediate prose, independently of the SQL event count; it does not establish that the native running-tool card was observed.

The initial click+Page Up attempt did not show a latest control in the returned diff, and the later capture remained at the bottom. It therefore neither passes active-stream reading-position protection nor establishes an auto-scroll bug. After completion, an independent click on `聊天记录` followed by the valid `Page_Up` key did visibly move to sections 5–9 and show the latest control. Two `tool.scroll` attempts returned `noWindowsAvailable`, and the `PageUp` alias returned `keyNotFound`; these are automation failures, not demonstrated product scrolling defects. `Page_Up` worked in the subsequent completed-state check.

The approximately 180-character section length was used to obtain a longer real response and is **not a hard UI acceptance criterion**. The shorter observed lengths are reported accurately without treating them as a UI blocker. The remaining uncertainty is the actual manual reading-position behavior across subsequent incoming deltas, not whether this scoped real model/Todo request completed or produced all twelve sections.

## Follow-up: verified old-reading-position protection across real incoming text

### Scope, identity and read-only method

The main session submitted this exact input from the reviewed ordinary frontend asset **`index-DH-v2eQj.js`**:

> 上翻保护复验：不要调用工具。请以“复验开始”开头，连续写十二段桌面整理建议，每段约180字，依次标注第1段到第12段。完整输出，不要询问是否继续。

The researcher waited for the main session's submitted notice before querying. At **`2026-09-15T07:58:24.667016Z`**, candidate selection required the current session `d24a882d-334a-467e-a285-681de2a33205`, exact full input, creation in `07:56:36.190Z`–`07:58:02.827Z`, and an ordinal after prior run `71bbce86-f1b9-4b59-a365-0c5847a46f10`. It allowed at most two candidates and found exactly one. That first database snapshot was already completed. A second bounded read-only transaction at `07:59:27.608356Z` pinned the same UUID/session and rechecked the exact input, answer structure and later capture correlation.

Both checks used normal server Settings internally, read-only/repeatable-read PostgreSQL transactions, 5-second connect/statement and 1-second lock timeouts. No full answer, credentials, connection strings, unrelated history or Todo data was output. The researcher made no model request, UI action, administrator login, migration, service operation, database mutation or fingerprint refresh.

| Field | Independently observed result |
| --- | --- |
| Run ID | **`9b76b8a5-5032-4854-a052-52cc2aaf098c`** |
| Request ID | `2332f60b-8919-4b94-8d47-1485cdba3132` |
| Accepted | `07:56:41.323403Z` |
| Started | `07:56:42.363613Z` |
| Completed | `07:57:12.027140Z` |
| Terminal state | `completed`, no stored error |
| Lifecycle | One accepted, started and completed event; no failed/interrupted event |
| Durable messages | Exactly 2; one user message equals the full supplied input |
| Tools | **0**; no tool events |
| Text deltas | **1249**, summed text length **1841** |
| First / last persisted delta | `07:56:48.160843Z` / `07:57:10.728399Z` |
| Persisted delta span | **22567.556 ms** |
| Acceptance → completion | **30703.737 ms** |
| Durable assistant | **1841 total characters**, **1598 Chinese ideographs** |
| Delta-to-message comparison | Exact ordered-text equality |
| Answer fingerprint | SHA-256 `90b19be58d66cbc660ad8847145567c6e4ad6097df116f38f60663ba9cc6b1bd` |
| Requested structure | Starts with `复验开始`; section labels exactly 1–12, in order |

Each section's total character count, including its heading, is **151 / 150 / 143 / 163 / 149 / 149 / 150 / 147 / 157 / 152 / 145 / 157**. The approximate requested section length served to obtain sustained output and is not a hard UI acceptance gate.

### Actual model/provider trace

There is exactly **one** real model step, call **`abe9104d-08da-4e1d-aecb-4c1fcf69b345`**, step 0, model **`gpt-5.6-luna`**, status **`succeeded`**. Run and trace bind version **`1291fa94-d7b7-4d9a-87e9-659aa234a6a3`**; its allowlisted endpoint is **`http://127.0.0.1:8080/v1`**. The trace starts at `07:56:42.869122Z`, ends at `07:57:12.002487Z`, and reports duration **29128 ms** with first generated/visible text **5294 ms**. Usage is returned by the provider: input **3983**, output **1296**, total **5279** tokens, including **36** reasoning output tokens. No stored error type/status is present. Trace integrity is **complete**, expected **1**, collected **1**, no gap; final update `07:57:12.049225Z`.

### Main-session native observations correlated with actual later deltas

The following UI observations and epoch-millisecond anchors were supplied by the main session, which owns the CUA operations/screenshots. This researcher independently queried the matching new run's events at those UTC cutoffs. No exact sub-millisecond synchronization between host capture and database clocks was measured; the multi-second spans and observed native state establish the bounded ordering, while counts use the supplied cutoff timestamps.

| Host observation time (UTC) | Main-session native observation | Independent event correlation |
| --- | --- | --- |
| `07:56:41.190Z` | Before Return | Run accepted at `41.323403Z` afterward |
| `07:56:42.015Z` | Exact input acknowledged, thinking/replying, empty composer | Accepted run exists; execution starts at `42.363613Z` |
| `07:56:42.883Z` | `Page_Up` key action | No text delta had yet been persisted |
| **`07:56:43.765Z`** | Old run's section 7 tail and sections 8–11 visible; latest control visible; composer still replying | **0 text deltas** at this first old-position capture |
| **`07:57:02.827Z`** | Screenshot retains the same old section 7 tail/8–11 anchor and latest control; composer still replying. AX has added new-run sections 2–6 and partial section 7 | **743 new deltas / 1083 characters** arrived after the first old-position capture and by this cutoff. They span `07:56:48.160843Z`–`07:57:02.823106Z` |
| **`07:57:45.689Z`** | Completion/new section 12 appears in AX; screenshot still at the same old anchor, latest retained, empty composer/send disabled | A further **506 deltas / 758 characters** arrived after the active capture, through `07:57:10.728399Z`; run completed at `07:57:12.027140Z`, before this capture |
| **`07:58:00.797Z`** | After explicitly clicking latest: screenshot shows the new reply's section 8 tail/9–12 and complete final sentence; latest disappears; empty composer | Final durable answer was already complete; this is an explicit navigation observation, not another model request |

The two delta groups sum exactly to **1249 events / 1841 characters**. Thus actual new text arrived after the initial upward navigation and continued after the second, still-replying capture; both later screenshots reported the same old reading anchor until the user explicitly returned to latest.

### Bounded acceptance result

**Pass for this ordinary build, this machine, and this one native flow:** navigate upward while the accepted request is generating/thinking → retain the chosen old reading position while real subsequent text arrives → retain it after completion → explicitly return to the complete latest answer. This combines main-session native observations with independent real-run persistence/provider evidence; neither source is presented as the other.

The upward key action occurred **before the first visible-text delta**, not after an already displayed partial new answer. This test therefore establishes protection of a user-selected old position across subsequent streaming and completion; it does not by itself verify every wheel/touchpad gesture, upward navigation after partial text is already displayed, another display/host, or repeated stress cases. It contains zero tools and adds no evidence about a running tool card. Earlier ambiguous attempts remain ambiguous; this new run supplies the successful scoped evidence rather than relabeling their observations.
