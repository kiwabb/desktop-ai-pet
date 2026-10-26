# AI import theme check — 2026-10-03

## Evidence boundary
Independent cross-layer source review plus targeted unit/static verification. No real provider call, native build, UI interaction or runtime business fixture was created by reviewer. Native import/result/apply/restart remains main-session acceptance.

## Findings fixed
- Backend owner resolved review findings before freeze: validate frozen Job.theme on load; draft ID/selection/status/attempt/ready schema; design/source pair invariant; reject changed or invented AI provenance on update; checked request count addition.
- Frontend owner resolved same-revision theme_service refresh and visible-page read-only refresh, allowing configuration return without triggering another paid analysis.
- Reviewer reproduced material contrast failure: red/blue mixed paper/glaze surfaces could yield text contrast 4.40 despite role endpoints passing. Actual gradient tones now participate in text/control contrast correction, with a small rounding margin; regression covers differently colored surfaces.
- Legacy preview now explicitly resets material/inset/radius/control/border roles locally so a designed active app cannot leak AI styling into old saved-theme preview.
- Removed implementation-oriented px-radius chip from product preview.

## Contracts traced
- Tauri camelCase inputs match Rust snake_case: theme_prepare(images, selectionId), retry/clear(id), start(name, draftId, themeAttempt).
- Prepare validates/normalizes ordered refs into owned UUID paths. Frontend synchronously advances selection identity, serializes prepare/clear, aborts old reads, and clears late owned drafts. Only matching ready selection and attempt authorizes start.
- Rust checks current draft ID/attempt/status after key wait and completion; checks local source generation/config before dispatch and acceptance. Credentials stay in Rust outside customization locks. Bounded image downscale/response/time and disabled redirects; one request, no implicit retry.
- Start freezes refs/theme in one job snapshot. Saved generation and subsequent retries retain Theme.design/source; old jobs without theme retain legacy recovery. Restart marks running analysis interrupted without replay. Source metadata is server authored.
- Typed model output rejects unknown fields, invalid colors/material/control/radius/border/shadow. CSS uses whitelisted tokens only. Material feeds both SVG frame and DOM treatment; control style feeds actual buttons, frame/control geometry remains bounded. Existing generated raster paw unchanged.
- Fixed palette gallery removed from UI. Legacy themes remain compatible. Preview stays local; active theme metadata updates both windows without sprite reload. Cleanup removes design-only root tokens and data attribute on theme/default changes.

## Verification
- Backend owner frozen result: Rust customization 33/33 passed; reviewer inspected the tested paths without rerunning full suite.
- Frontend owner frozen result: focused 50 tests plus TypeScript passed before reviewer fixes.
- Reviewer after fixes: theme, queue and synchronization tests 26/26; new legacy preview isolation test 1/1. TypeScript app check passed. git diff --check passed. No frontend lint script configured.
- No remaining blocking source finding. Native material quality, actual service compatibility, before-upload disclosure, configuration-return behavior, request count, generated theme identity and apply/restart require actual native evidence.
