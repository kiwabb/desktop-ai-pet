# Customization acceptance ledger

Status: implementation started after the user's explicit confirmation. Nothing below is claimed passed until evidence is entered.

Baseline publication: https://github.com/kiwabb/desktop-ai-pet, main 3f4e64898fdbaee0ee143758893d4b71324fcf21. The clean publication directory is the comparison baseline; original repository history includes private work and must not be pushed.

| Contract | Evidence required | Current state |
| --- | --- | --- |
| R1 actual ordinary-image import | Native file picker -> decoded images; replace/remove and invalid/oversize errors | Pending |
| R2 actual image generation | Configured real provider request -> four saved state images; inspect alpha, identity, bounds and alignment | Pending; no actual generation request made |
| R3 coordinated theme | Pet controls + compact/expanded chat + Todo/Memo/settings; focus/hover/error contrast | Pending |
| R4 generation lifecycle | Cancel during request; reject late result; explicit failed-stage retry; no implicit charging retry | Pending |
| R5 persistence | Activate, reopen chat, restart app, move original import files, switch saved presets and restore built-in | Pending |
| R6 provider/credentials | Independent endpoint/model settings; Keychain-backed save; no secret/image body in JSON/log | Pending |
| R7 isolation/failure | Prior appearance survives failed apply/save; original business store/config preserved | Pending |
| Static correctness | Focused race/asset/storage tests, full frontend tests/type check, Rust lib tests | Pending |
| Native bundle provenance | Built app path, executable hash, launched matching binary | Pending |

## Runtime conditions

Use the user's actual configured image service and images selected for this purpose. Do not seed a temporary business database, create a parallel demo service, or substitute pre-generated sprites to claim generation. Clearly label unit request fixtures. Record provider/model, request count, terminal status and asset checksums without API keys, source image contents or unrelated personal data.

Do not repeatedly rebuild unchanged code. One bounded native acceptance pass after static checks, a coherent fix batch if necessary, then verify affected paths. Actual paid generation requires the source images and configured image service to be established; report this precise limitation if unavailable.

## Existing behavior that must remain intact

Default cat rendering and mask, three sizes, always-on-top, dragging/petting, show/hide/tray recovery, compact/expanded chat, draft retention, real streaming/tool results, Todo/Memo current records. No scheduled automatic generation on restart.

## 2026-09-30 native and final static pass

- Frontend owner: 168 tests, production frontend build passed.
- Main: final Rust library 137/137 passed (session2558), source diff whitespace check clean.
- Native bundle built successfully. Binary/source manifest saved in native-build-manifest.json; one subsequent frontend focus fix is pending and will need updated bundle evidence.
- Real native default pet visible; existing local chat history restored; Chat navigation -> customization shows actual empty preset collection, disabled generation before provider setup, separate image-service form. No seeded presets or model responses.
- Native file picker opened successfully; no image selected. Window switched back to pet before selection completed; no generation request made.
- Opening provider configuration initially left the form below viewport; keyboard focus revealed the complete form. Frontend owner fixing auto-focus/scroll and return focus.
- Actual image endpoint/model/key and selected references remain unavailable. Full R1 import, R2–R5 live generated behavior and R6 service compatibility are unproven; do not mark task complete.

## Final bundle and native configuration recheck

- Final frontend: 23 files / 170 tests passed (session65686). Rust: 137 library tests passed (session2558). Final native app build completed successfully (session60838).
- Quit old process and launched final bundle from target/debug/bundle/macos/橘伴.app. Manifest refreshed with final binary and frontend hashes. /Applications installation was not replaced.
- Native check: chat -> customization -> Configure service focuses API address and scrolls it into view; Tab to model exposes full provider form including key and Save. Actual empty state remains; no credentials entered, images imported or generation called.
- Read-only comparison: all nine existing business table row counts unchanged. This proves row-count preservation only, not byte-for-byte content equality or generated-preset lifecycle.
- Still awaiting actual image endpoint/model, in-app credential entry and user-selected references. R1 full import and R2–R6 actual generation/activation/recovery remain unverified. Task remains in progress; customization has not been published to GitHub.

## 2026-10-02 explicit chat-connection reuse

- User confirmed image endpoint equals chat endpoint, then explicitly authorized reuse of the saved chat API key. This supersedes the prior need for manual independent key entry for this action; implicit reuse remains prohibited.
- Native chat model-list request returned 31 models; the actual datalist selection confirmed `gpt-image-2`. Chat model draft was restored without saving changes. The endpoint is loopback `http://127.0.0.1:8080/v1`.
- Implementing an explicit internal copy operation: no credential value crosses IPC into frontend or is exposed in logs. Model-list availability does not establish image editing/alpha compatibility. Actual reference images remain unselected.

### Explicit connection-copy implementation and runtime attempt

- Added explicit `customization_use_chat_connection({model})` Rust command and native UI button. Implementer and independent reviewer each passed Rust2/frontend3 focused tests; TypeScript check and native bundle build (session84607) passed. Review found no scoped blockers.
- Launched new bundle, entered `gpt-image-2`, clicked Use chat connection under direct user authorization. Native controls became busy; no saved-success state observed. App process remains live and a new SecurityAgent process exists. This supports a pending credential operation, not proof of a completed copy or of specific authorization-window contents. User asked to handle any system authorization prompt. Do not repeat copy while pending.
- No reference import or image generation request performed.

### Connection copy completed — native evidence

- Existing operation returned successfully without retry: native UI shows “已复制聊天地址和密钥并保存；尚未发起生成请求。” and “图片服务已配置”. Endpoint is `http://127.0.0.1:8080/v1`; image model is `gpt-image-2`; secure field indicates stored key. No secret was exposed.
- Reference input remains empty and Generate disabled. No actual image request or generated assets exist. Next requirement: user-selected reference image(s) or explicit source path for this purpose.

## Live gateway failure diagnosis — 2026-10-02

- Inspected bounded sub2api container logs. First edits request at 21:17:33 returned403. Explicit retry at21:22:04 passed gateway checks, routed through an OpenAI OAuth account, then upstream returned400 at21:22:20: gpt-5.4-mini is unsupported using Codex with a ChatGPT account. Gateway exhausted eligible accounts and returned502.
- Current gateway source confirms hardcoded driver: sub2api/backend/internal/service/openai_images.go constant openAIImagesResponsesMainModel = gpt-5.4-mini; openai_images_responses.go assigns it to the Responses model while handling gpt-image-2.
- This proves upstream model compatibility is the observed retry failure. It does not prove gpt-image-2 tools or transparency will work after changing the driver. No further billable request or gateway source/config mutation performed during diagnosis. Gateway repository already has extensive unrelated local changes.

## Real runtime verification — 2026-10-02
- Scoped proxy commit: `c19075838` (local only; not pushed).
- Actual job `dd84773e-3883-40d0-8077-0e5a9266606c` completed base/closed/happy/talk with status ready and no error. Seven cumulative requests comprise three failed attempts and four successful generations. No fixture or mock images were used.
- All four states were inspected in the native preview. Applied 小虎 through the native Apply button; UI confirmed “已应用到桌宠和所有面板。” and persisted active_id matches this job.
- Native desktop visibly renders the generated gray tabby; chat panel and pet action controls visibly use its gray theme. This verifies apply and chat theme only; restart, remaining panels, and the broader acceptance matrix remain separate checks.
