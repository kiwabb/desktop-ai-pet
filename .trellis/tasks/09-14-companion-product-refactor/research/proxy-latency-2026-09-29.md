# Research: sub2api proxy latency boundary

- Query: Determine whether four existing native desktop chat requests were delayed by proxy admission, forwarding, or upstream work.
- Scope: internal; existing runtime records plus narrowly selected local source.
- Date: 2026-09-29

## Findings

### Runtime identity and request path

- Running container: `sub2api`, image reference `sub2api:latest`.
- Image ID: `sha256:24911c7c6de2dc20096932420ab9140269dd54d015146e2807e35bbdbc2fdf96`.
- Runtime `--version` output: `Sub2API 0.1.162 (commit: docker, built: 2026-07-30T03:17:23Z)`.
- Container started at `2026-09-29T06:06:10.048698711Z`.
- The sole mounted application data destination is `/app/data`; no source-code or binary bind mount was present.
- Local `backend/cmd/server/VERSION` is also `0.1.162`, but the runtime's `docker` commit marker provides no exact source revision. Matching release strings do not establish matching source contents.
- All four access records are real `POST /v1/chat/completions` requests, `stream=true`, status 200, model `gpt-5.6-luna`.
- Read-only joins from those usage records identify the selected account platform/type as `openai`/`oauth`, with no account-level forward proxy configured. No account identifiers, credentials, prompt bodies, or private account content were printed or written.
- Current source routes OpenAI OAuth accounts through the Chat Completions to Responses conversion and `https://chatgpt.com/backend-api/codex/responses`; this describes the inspected source's route, not a captured outgoing HTTP URL from the July binary.

### Actual timing evidence

Times below are existing real requests. No new model call, synthetic request, service restart, or configuration change was performed.

| Completion time (UTC) | Proxy HTTP access latency | Proxy usage forward duration | Access minus forward | Proxy first_token_ms | Pet first visible text after model start |
|---|---:|---:|---:|---:|---:|
| 06:08:16 | 5,747 ms | 5,694 ms | 53 ms | 2,201 ms | 4,396 ms |
| 06:09:38 | 15,140 ms | 15,121 ms | 19 ms | 1,339 ms | 2,941 ms |
| 06:20:31 | 30,800 ms | 30,752 ms | 48 ms | 1,903 ms | 3,541 ms |
| 06:32:13 | 10,073 ms | 10,043 ms | 30 ms | 3,184 ms | 9,473 ms |

- The real access/forward differences are 19–53 ms. These four records do not exhibit seconds of proxy admission/routing delay outside forwarding.
- Correction: the final request's proxy `first_token_ms` is 3,184 ms and the pet's first visible text is 9,473 ms. Subtracting them does **not** establish 6,289 ms of proxy buffering: the timers have different start boundaries and do not necessarily measure the same event type. In the inspected source, the proxy metric starts at the first SSE data payload, which can precede assistant text; its exact semantics in the running July binary have not been established. Upstream generation, transport and proxy processing remain unseparated. The earlier claim that this difference identifies local buffering as the dominant delay is withdrawn.
- The final usage row contains 7,128 uncached input tokens plus 1,792 cache-read tokens, totaling the pet trace's 8,920 input tokens. The apparent input-token mismatch is accounting, not a different request.
- All four requested/model columns are `gpt-5.6-luna`; `upstream_model`, `reasoning_effort`, and `service_tier` are null. Null upstream model is missing recorded attribution, not proof of a renamed model.

### Logging boundary

- `docker logs` yielded no records for the four narrow UTC windows. Actual application logs reside at `deploy/data/logs/sub2api.log` (a mounted file).
- Only the last 8 MiB were read, and only the four request-minute windows and safe fields were emitted.
- Successful access records contain total `latency_ms`; they do not contain separate queue, upstream-header, first-body, or conversion timing fields.
- The request audit start/done records show the real endpoint and stream mode. They contain no measured queue duration.
- The exact four request IDs have no matching `ops_error_logs` rows within the bounded window, so no additional latency breakdown was recoverable there. Absence of an error row alone does not prove an absence of internal retries.

## Files found and code patterns

All proxy paths below are relative to `/Users/zhoujiaangyao/zhoujiangyao/AI/sub2api`.

- `backend/cmd/server/main.go:60`: read-only `--version` flag and build metadata output.
- `backend/cmd/server/VERSION:1`: checked-out release string.
- `Dockerfile:141`: built binary copied to `/app/sub2api`; the runtime is a compiled artifact.
- `backend/internal/server/middleware/logger.go:17`: request access timer begins before the handler and ends after it; output includes `latency_ms` at line 62.
- `backend/internal/handler/openai_chat_completions.go:201`: account-slot acquisition occurs before the forward timer; routing timing is assigned at line 209 and forward timing begins at line 210.
- `backend/internal/service/openai_gateway_chat_completions.go:94`: conversion path starts its forward duration timer before parsing and constructing the upstream request.
- `backend/internal/service/openai_gateway_chat_completions.go:278`: upstream HTTP call.
- `backend/internal/service/openai_gateway_chat_completions.go:551`: current code assigns `firstTokenMs` for the first SSE data payload before parsing its event type; the field is not restricted to visible assistant text.
- `backend/internal/service/openai_gateway_chat_completions.go:651`: current code converts upstream Responses events into Chat Completions chunks and flushes emitted chunks.
- `backend/internal/service/openai_silent_refusal.go:14`: current silent-refusal detector is enabled for request bodies of at least 64 KiB.
- `backend/internal/service/openai_silent_refusal.go:109`: current detector releases output once content, tools, usage, error, or reasoning has been observed; it contains no fixed-duration delay.
- `backend/internal/service/openai_gateway_forward.go:962`: current upstream URL selection by account type.
- `backend/internal/service/openai_gateway_service.go:30`: current OAuth upstream constant.
- `backend/ent/schema/usage_log.go:118`: persistent duration and first-token metric fields.

## Related specs

- `.trellis/spec/backend/server-agent.md`: separate real inference, service health, and desktop presentation evidence; preserve saved credentials and original service chain.
- `.trellis/spec/desktop/dual-mode-llm.md`: server mode uses the Rust transport to Python; local mode is a distinct Rust-owned model path.

## External references

- No web research was needed. Runtime container image metadata names the source repository as `https://github.com/Wei-Shaw/sub2api`.
- Source checkout and runtime both report `0.1.162`; only runtime build metadata was independently checked.

## Caveats / Not Found

- No precise source revision for the running July binary was available. Current source references are explanations of the inspected checkout, not proof of an identical running implementation.
- The first SSE payload's type was not retained for these historical requests. No network capture or per-event forwarding telemetry exists in the inspected records.
- No independent browser/native paint timestamp was part of this proxy investigation.
- No source code, services, configurations, model choices, or business data were modified. Only this research file was written.
