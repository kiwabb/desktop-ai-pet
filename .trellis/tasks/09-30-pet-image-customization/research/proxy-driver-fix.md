# Proxy image driver repair — 2026-10-02

## Evidence
Actual gpt-image-2 edits calls were rejected upstream because the proxy hardcoded gpt-5.4-mini as Responses orchestration model. Changing to repository-recommended gpt-5.4 was also rejected by the actual account. Final implementation adds OPENAI_IMAGES_RESPONSES_MAIN_MODEL; local deployment explicitly selects gpt-5.6-luna, which is the configured chat model. Image-tool support still requires the live request result.

## Contract
Both native Images conversion and image-only Responses conversion call resolveOpenAIImagesResponsesMainModel. Override is trimmed, limited to128 ASCII model-ID characters; blank/invalid uses default gpt-5.4. The image tool model remains requested gpt-image-2. No automatic paid retry or capability success assumption. Tests assert override survives later Codex normalization.

## Deployment
Focused Go tests pass (65456), independent scoped review found no issue. Linux arm64 embedded build19699 passed. Image sub2api:latest sha256:9dab3386e6e0e0d1c113613ab380117632aab2ccc1dc9bac1caaa1f1fc204c6e built from original runtime base plus rebuilt binary and env. Existing container Config/HostConfig/networks were copied in memory with only image and model override changed; secrets were never printed. Replacement /health returned ok. Old stopped container sub2api-before-image-config-20261002 retained; original image sub2api:before-image-driver-fix-20261002 retained. Binary backup /tmp/sub2api-image-driver-fix/sub2api.before.

## Targeted local failure-state correction
Account140 extra.model_rate_limits.gpt-image-2 had reason upstream_400_codex_plan_gated_model. Removed only this JSON member with an exact reason/account guard and inserted account_changed into scheduler_outbox atomically. One row changed. Real quota and other model limits untouched.

## Limits
Binary was rebuilt from the current gateway checkout with existing unrelated local changes preserved. No GitHub push. Build/health and static tests do not establish real image generation; inspect subsequent task evidence.

## Real runtime verification — 2026-10-02
- Scoped proxy commit: `c19075838` (local only; not pushed).
- Actual job `dd84773e-3883-40d0-8077-0e5a9266606c` completed base/closed/happy/talk with status ready and no error. Seven cumulative requests comprise three failed attempts and four successful generations. No fixture or mock images were used.
- All four states were inspected in the native preview. Applied 小虎 through the native Apply button; UI confirmed “已应用到桌宠和所有面板。” and persisted active_id matches this job.
- Native desktop visibly renders the generated gray tabby; chat panel and pet action controls visibly use its gray theme. This verifies apply and chat theme only; restart, remaining panels, and the broader acceptance matrix remain separate checks.
