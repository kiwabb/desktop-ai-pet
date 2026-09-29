# Visual refinement independent check — 2026-09-26

Scope: compare this visual revision against `/var/folders/ys/cjf2rbtd03lg_fclhtmcmgn80000gn/T/companion-visual-baseline-llogexje`, using `visual-refinement-2026-09-26.md`, current DESIGN and companion spec. Historical dirty-tree changes are excluded. This report contains source/static evidence, not native visual acceptance.

## Findings (fixed)

- P3 — `src/components/ChatInteraction.css`: navigation buttons were 30px high and the composer recovery button inherited 28px, below the current 32px companion contract. Reported to the active presentation owner, who corrected both to 32px before source stabilization. No behavior change.
- Runtime follow-up — `TodoReminders.css` and `MemoList.css`: coordinator observed oversized error-only reminder bands/scrollbars and inconsistent Memo select chrome. Presentation owner removed card scrolling/max-height from error-only notices, retained their complete text/ARIA, gave the Memo body its bounded flex slot, and styled the semantic select at 40px with a subtle CSS chevron. Reviewer read the exact two-file correction and independently reran its `diff --check`; no TSX/data path changed. Final native visual confirmation is still separate.

## Findings (not fixed)

No additional source defect found in the scoped independent pass or the two-file correction. Final native confirmation of the reminder/select corrections remains pending; this reviewer does not claim their rendered result from source alone.

The coordinator reports honest offline compact/expanded/Todo/Memo/settings navigation and draft checks passed on the new bundle. No visual quality score, streaming success or tray recovery claim is inferred from the static checks here.

## Review evidence

- `App.tsx`, `ChatPanel.tsx`, `ChatComposer.tsx`, `ConversationFeed.tsx` and `companion-behavior.ts` match the turn baseline byte-for-byte. Window/open/menu lifecycle, drafts, streaming, navigation and backend paths were not rewritten in this visual pass.
- PetStage renders one masked color-image node. `idle.png`, `sleeping.png` and `idle-mask.png` are each 1207×1303; the two RGB poses require the shared luminance matte. Sleeping is decoded before source replacement; rejection retains idle, and disposal fences late completion. No companion vector eye patch, crossfade or second visible cat remains. The two source portraits were inspected; composed native registration remains runtime evidence.
- Blink timers and listeners are bounded and cleaned up; reduced-motion/hidden/disabled modes suspend blinking. Rest stays closed-eyed and waking restores the idle source. Accessible wake labels and real errors remain; the persistent visual rest label is removed.
- Compact host is 408×332 inside the unchanged backing and retains side-aware alignment/work-area maxima. Frame content still uses `auto auto minmax(0,1fr) auto`, a zero-minimum body and scrollable reading/utility regions, preserving the composer slot. New palette and utility refinements are scoped to `.is-companion`; legacy appearances retain their rules.
- Cat action group fits all three existing backing sizes; its top sits 4px below the hitbox and 1px below the artwork container before motion. Focus rules and labelled controls remain explicit. These are CSS relationships, not measured screen results.

## Verification

- Lint: no project lint script; independent scoped `git diff --check` passed. Presentation owner reports all eight changed CSS files parsed successfully.
- TypeCheck/build: coordinator reports `tsc`, Vite and native app build passed; log `/tmp/companion-visual-refinement-build-20260926.log` (Rust stage 14.89s). No duplicate build started by this reviewer. Subsequent presentation corrections still require their final coherent package/confirmation.
- Tests: presentation owner reports 22 ChatPanel/ConversationFeed/AssistantSettings tests passed. Reviewer independently ran `node tools/verify-companion-interaction.mjs`: pet/menu handlers, exclusive menu lifecycle, sprite decode/failure/unmount/wake and blink cleanup all passed; no runtime service or business data involved.
- No app, service, fixture backend or business records were created by this review. The only reviewer-authored file in this pass is this report.


Coordinator final confirmation: correction package passed TypeScript/Vite/Tauri and was installed with matching executable hash. Installed native Memo observation confirmed both visual corrections; full scope, unsent-draft cleanup, composed capture and offline limitation are in `visual-refinement-native-2026-09-26.md`. This addendum is coordinator runtime evidence, separate from independent source review.
