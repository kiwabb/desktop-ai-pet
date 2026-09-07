# Approved HTML shell migration — 2026-09-07

## Baseline and scope

- Local Git initialized on `main`; baseline `e773d91` committed before any visual source edits. Runtime secrets, `.env`, dependencies and verification output were excluded.
- Final user reference: `references/preview-v2-approved.html`, copied byte-for-byte from `/Users/zhoujiaangyao/Downloads/preview (2).html`; SHA256 `12986e7ed4e101228ef120ab51efa0af20e350effeb05b8f12310bb2aad536b4`.
- Reference browser screenshots: `output/playwright/reference-v2.png` (chat) and `output/playwright/reference-v2-settings.png` (settings). These show the user-provided HTML's labeled **demo state**, not project service/model evidence.
- Existing paw measurement after entrance: x5.109375/y-4 relative to the outer frame, size53.296875×59.265625 CSS px; filter `drop-shadow(rgba(191, 103, 47, 0.3) 0px 5px 6px) drop-shadow(rgba(191, 103, 47, 0.2) 0px 1px 2px)`.
- Browser QA uses the existing Vite server at127.0.0.1:1421, neutral frame slots and actual ChatPanel with explicit unconfigured state. No generated conversation or service configuration is needed for visual acceptance.
- Initial process path was `src-tauri/target/debug/bundle/macos/橘伴.app`. CUA selection by display name resolved an older Desktop copy; that extra copy was closed. Selecting the exact project bundle path confirmed the active native window loads `127.0.0.1:1421/`, with a closed pet button. Process/bundle path alone did not establish packaged-asset loading.

## Acceptance evidence

### Settings reference content (R15)

Implemented the approved reference's connection card plus status, guide and
security cards, with a compact footer, in `AssistantSettings`. The shared frame,
cat/platform, seven settings footprints and existing badge geometry/filter are
preserved. The status card renders saved endpoint, model configuration and
device registration separately using actual AgentView fields. There is no
simulated test-connection action or copied demo state. Native save and return
flow stay in ChatPanel; new controls only disclose help and toggle visibility
of the in-memory credential entry.

Browser QA uses the actual unconfigured state: no model, endpoint or credential
is presented as connected. Full-width columns measured392.25/237.734px with a
12px gap; list height595px and scrollHeight596px. Entering/reentering settings
starts at scrollTop0. Screenshot: `output/playwright/reference-v2/settings-implemented.png`.
The source screenshot `settings-source.png` contains the original HTML demo,
and is design evidence only. Help disclosure and password/text toggle passed
without entering any credential. Clicking Save with a required empty credential
produced native browser validity.valueMissing=true, without a service request.
At500px content width, cards stack into one500px column without horizontal
overflow and the security card remains scroll-accessible. Returning to chat
retains475×278; reopening settings resets scrolling to the top.

Fixed two existing issues found during this work: chat auto-scroll could scroll
settings to the bottom; and status snapshots could overwrite an edited URL
while retaining the credential for a different server. Auto-scroll now excludes
settings/todos, and URL synchronization depends only on endpoint changes, which
also clear the credential. The latter is source-review evidence, not a fabricated
status-update demo. The QA submit guard now recognizes the extracted form.
Final read-only review passed. Existing lightweight checks, TSX syntax checks,
and one full TypeScript/Vite build passed. Tauri packaged the existing dist;
the exact project application was restarted and confirmed loading the bundled
`tauri://localhost` page. New settings visual/interaction evidence remains the
browser results above. No native connection setting was saved and no model was
invoked during this work.

### Restrained surface refinement (R14)

Unified the compact quick actions into warm-white surfaces with left-aligned
icons/text, lighter border/shadow treatment and a single orange send emphasis.
Title weight is720; subtitle and input placeholder colors are more readable.
Normal action text contrast exceeds6:1; subtitle and placeholder exceed4.5:1
against the lightest/darkest relevant cream surfaces. No geometry, actions,
native dimensions, images or decorations were changed.

Browser runtime confirmed frame475×278, input429×78, the exact baseline badge
offset/size/filter and five prints. Prompt fill/clear, keyboard focus outline
and settings return passed in the actual unconfigured QA state. Under reduced
motion, the hovered action measured an identity transform and0.00001s transition.
Screenshot: `output/playwright/reference-v2/compact-refined.png`.
Scoped review and existing lightweight static checks passed; error sizing
remains source-based verification. No service/model data or fixtures were added.
Vite assets and the local Tauri app bundle were regenerated. The exact project
application was restarted and confirmed loading `tauri://localhost`; native
closed-state loading is verified, while this round's open-frame visual evidence
is the browser screenshot. The previously documented native opening-automation
limitation was not re-investigated for these cosmetic changes.

### Compact composition refinement

This replaces the spacing-only treatment below after the user rejected its
overall appearance. The475×278 shell now has an88px header,429×78px input,
14px group gap and a two-column/two-row action group (210.5×32px controls,
8px gutters). Input and actions share22px inner insets; bottom clearance is
25px to the outer frame. Softer fills and borders keep the send action primary.
Final screenshot: `output/playwright/reference-v2/compact-polished.png`.

Browser runtime used the existing unconfigured QA state without messages or
fixtures. All four actions filled their original prompts; the unsent draft was
cleared. Keyboard Tab reached the next action with a2px visible outline.
Settings navigation/return, Escape hiding (`inert=true`) and reopening passed.
Settings remains676×665 with seven prints. Compact keeps five prints and the
exact baseline badge dimensions/offset/filter. Scoped CSS review found no
expanded/standalone/legacy rule changes. The real single-line error budget is
274.5px within276px according to source calculations, not a runtime failure
reproduction. The four action text colors were darkened after contrast review
to exceed4.5:1 against their respective fills.
Focused static checks and `git diff --check` passed. Vite generated updated
assets once, then Tauri packaged that dist without repeating the frontend build.
The exact project app was restarted and confirmed at `tauri://localhost`.
Native AX activation and keyboard activation did not open the compact frame;
coordinate activation returned `noWindowsAvailable`. The closed pet remains
visible. New open-frame visual/interaction evidence is browser-only this round;
no real model invocation or service-settings mutation was performed.

### Compact bottom spacing follow-up

The integrated compact shell remains475×278. Its header now takes remaining
space (minimum84px), the footer uses110px/48px rows, and the surface reserves
4px bottom padding. Browser measurements: header114px, composer77px,
composer-to-chip gap33px, chip height28px, chip-to-outer-frame bottom25–26px
(previously75px). Screenshot: `output/playwright/reference-v2/compact-spacing.png`.
The badge retains the exact baseline bounds/filter and all five prints remain.
Quick prompt filling, clearing the unsent draft, expanded settings navigation
and return to compact passed in the existing browser QA's real unconfigured
state. Expanded/settings remain676×665; settings retains seven prints.
The compact body uses natural block formatting so its actual error content can
contribute height; this correction is source/static evidence, not a reproduced
service failure. No messages were sent and no fixture data was introduced.
CSS-only verification uses the focused existing checks and visual measurement;
Vite assets and the local Tauri bundle are regenerated for delivery without a
redundant TypeScript check. The exact project app was restarted and confirmed
loading `tauri://localhost` in its closed state. Native open-frame visual
acceptance is not claimed for this spacing adjustment.

### Footprint completeness follow-up

The user identified missing decorative prints. Added five four-toe reference
motifs to integrated chat and two bottom motifs to expanded frames without a
footer slot. Browser results: compact5, expanded chat5, settings7. Inspected
`output/playwright/reference-v2/compact-footprints.png` and
`output/playwright/reference-v2/settings-footprints.png`; shoulder/curve/lower
prints, the faint upper print and the lower joint/footer prints are visible.
The floating print is intentionally mapped to the existing pet's status bubble
instead of being clipped outside the native compact window. Its rotated bounds
start around4.33px from the compact window top and363.33px in expanded mode.
All three modes retain the exact baseline badge bounds and filter recorded above.
Reference shape, count conditions, SVG ID scoping and pointer isolation passed
read-only review and focused static checks. One frontend build passed. No chat,
service, settings or todo data/actions were introduced or changed.
The updated frontend was packaged with Tauri using the existing dist, and the
project app was restarted at `tauri://localhost`. Native automation confirmed
the closed window but did not obtain a stable open-frame screenshot this round;
the new footprint visibility evidence is the browser screenshots above.

### Browser runtime

- Final screenshots: `output/playwright/reference-v2/compact.png`, `expanded.png`, `settings.png`, `todo.png`.
- Compact measured475×278; expanded/settings/todo measured676×665. All four measured the exact baseline paw bounds and filter above, one continuous shell and no legacy tail.
- Independent frame entry imports only component/QA styles. Two React frames had18 unique SVG IDs without duplicates. Resizing the first host from540px to420px and frame height340px updated the viewBox. A short second frame retained normal layout.
- Dock offsetX12/offsetY8/scale0.45 produced the expected translated scaled group. Explicit tail right0/width36 removed the new shell and rendered the configured legacy tail; reset restored the integrated shell. Hidden state was inert and visibility:hidden; standalone rendered neither shell nor tail.
- Todo browser preview showed its actual unavailable-native-invoke error. This proves error-layout containment only, not successful todo fetching. No fixture records were supplied.
- Review caught and fixed expanded frame z-index covering the cat, old content paint covering the new perimeter, geometry/root minimum mismatch, and missing horizontal offset in the tall geometry branch. Final short/tall boundary test uses407.9→408.1px height and offsetX13.3, checking stable connection x and y delta0.2.

### Native runtime and package

- In the exact project native window loading Vite, CUA verified compact opening, settings navigation, return to compact, quick prompt filling the composer, clearing that unsent draft, and Escape closing. Screenshots showed the complete cat above the integrated platform and retained paw corner/shadow.
- Settings displayed the existing real connection and an existing reminder; no message was sent, no credential or setting saved, and no reminder/todo was changed. Real-model invocation was not part of this validation.
- One `pnpm build` passed (TypeScript + Vite). Two focused checks passed, including approved PNG checksum/source-visible-pixel verification and geometry regression checks. Read-only review had no remaining findings.
- `pnpm tauri build --debug --bundles app --config '{"build":{"beforeBuildCommand":null}}'` packaged the already-built frontend without repeating its build. Bundle: `src-tauri/target/debug/bundle/macos/橘伴.app`.
- Restarted only the project application. CUA confirmed `tauri://localhost` and the compact chat controls in the newly packaged app, establishing bundled-asset loading. Later user UI activity was observed, so no further native actions were sent; current closed state was left intact.

The reference HTML's demo functions are retained only in the locked design-source artifact. Application source has no reference demo adapter/reply imports. Existing service and business state paths remain unchanged.
