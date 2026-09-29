# Companion distance independent check — 2026-09-26

## Disposition and scope

**SOURCE-STABLE: no material blocker.** Build release was sent before this report. Authority: `../companion-distance-2026-09-26.md`; baseline: `/var/folders/ys/cjf2rbtd03lg_fclhtmcmgn80000gn/T/companion-distance-baseline-9_ngbuwl`.

Independent baseline comparison confirms only `src-tauri/src/window_geometry.rs` changed. `lib.rs`, frontend silhouette/layout/hit bounds, state handlers and native lifecycle are unchanged. All 10 frozen cat/artwork/behavior/paw hashes match. Review evidence is source and isolated geometry verification; no reviewer app, model, service, fixture, preference write or native build.

## Geometry review

- `LEFT_CHAT_GAP = -36` and `RIGHT_CHAT_GAP = -48` are independent of the unchanged screen-safe `EDGE = 12`. Both side-space selection and fitted-width calculation use the same signed distances as actual adjacent placement, scaled once by the existing display scale.
- The chosen side therefore has the space that its placement calculation expects. Left mode moves chat 48 logical pixels closer than the previous +12 gap; right mode moves it 60 pixels closer. The existing constrain/safe-area rules, side preference and narrow-display fallback are retained.
- Cat position/size is returned unchanged. Nominal chat dimensions remain 720×680; the existing small-display width fitting now correctly uses the available space from the closer placement. Anchor projection, API fields, drag/refit behavior, show/focus/hide and lifecycle functions are untouched.
- With the accepted frontend 44px body reservation and 16px tip inset, the normal left body ends 8px outside the pet rectangle and its tip enters the transparent margin by 20px. The normal right body starts 4px inside the pet rectangle and its tip enters by 32px. The measured matte sample remains outside the body at each preset.
- The standard-size right body-to-tail-fur gap is approximately 7.8px; with the same fixed CSS insets it is about 6.2px at 80% and 9.4px at 120%. The reviewer notified the coordinator to avoid describing this as a universal ≥8px guarantee. This is a documentation precision correction, not a reason to widen the accepted gap.
- On genuinely narrow work areas the preexisting clamped-overlap fallback remains; source evidence does not imply that every possible screen can fit both complete surfaces without overlap. The selected ordinary placements and measured fur samples have positive clearance, while real current-desktop composition remains the native acceptance gate.

## Findings (fixed)

No reviewer source fixes required. The coordinator received the preset-specific clearance wording correction before release.

## Findings (not fixed)

No material implementation defect identified. Real compact/expanded composition must verify that the reduced gap is visually sufficient and that cat/control overlap does not occur at the current desktop position. Existing draft close/reopen acceptance remains with the coordinator. Alternate-display and mirrored runtime behavior are not established by pure tests.

## Verification

- Independent source scope and frozen hash checks: pass; only the authorized native geometry file changed, 10/10 frozen hashes match.
- Syntax/type verification: owner-reported standalone `rustc --test` compilation passes for the changed geometry module; no duplicate full native build/type check by the reviewer.
- Lint hygiene: owner-reported scoped diff check passes.
- Tests: owner-reported all 16 geometry/anchor tests pass. Updates cover exact spacing, side-width fitting and the current measured desktop placement; added combinations cover left/right, 80/100/120%, scale 1/1.25/1.5/2, negative origins, unchanged pet, screen fit, idempotence and measured matte clearance. Existing projection/clamp tests remain green. Tests were not rerun by the reviewer.
- No live runtime or model/business-flow completion claim is made here. The coordinator owns the coherent build and actual compact/expanded/draft close-reopen verification.
