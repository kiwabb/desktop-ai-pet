# Approved visual refinement — 2026-09-26

## Authority and scope
User: “方向感觉没问题 但是美观度需要大大提升”. Implement a substantial craft improvement within the accepted pet-first direction. Preserve interaction, navigation, native geometry/lifecycle, app data and providers. This is continued authorized implementation, not a new concept approval gate. Do not reintroduce a disk, decorated attached frame, status poster, heart/star effects or a second pet.

## Visual decision
An intimate, precise desktop companion: the white longhair cat remains the recognizable subject; independent warm-white panels use graphite text, restrained warm accents, refined system typography and coherent soft elevation. Remove heavy sepia outlines, bold labels everywhere, oversized form buttons and visually fragmented panel bands. No website hero styling, display fonts, ornamental glass, invented claims or sample content.

- Cat: retain the current silhouette/identity and main native dimensions. Bring the modest action strip nearer the feet; integrate chat/menu into one light, small control group. Keep the labelled chat action always discoverable and all targets keyboard accessible. Do not show a persistent visible resting label when closed eyes already communicate rest; keep the accessible wake label and real errors.
- Natural expressions: coordinator will generate a sibling sleeping image preserving the current portrait/canvas. Use only after checking registration/matte. Original art stays intact. Until approved asset is ready, retain current valid expression. No cartoon eye patches, ghost/duplicate cats or UI breathing.
- Compact panel: target at most 408×332 CSS px inside the unchanged720×680 native backing. Preserve its side-aware anchor and work-area clamp. Header/control hierarchy is compact and quiet:14px medium title,12px controls,14px readable body, consistent14–18px insets. The real empty/offline state and actionable recovery remain honest.
- Frame: current16px regular geometry retained. One shared soft elevation, subtly distinct surface/chrome/composer tones, no nested outlined cards. Crisp fine separators only where they clarify grouping. Sender focus is a restrained clear ring, not a dark double outline.
- Header/nav: preserve explicit history/read action, close and Todo/Memo/settings. Refine their visual grouping and selected states; Lucide14–16px strokes coherent. Do not hide required tools behind an experimental interaction.
- Composer/feed: visually connected to the panel. One understated writing surface, comfortable caret/text, modest send control, preserved stream/error/tools/reading/draft behavior.
- Utility pages: apply the same typography/control/surface vocabulary using companion-scoped CSS. Do not redesign data semantics or remove existing workflows.

## Ownership
Panel implementer owns panel/frame/composer/feed presentation and chat/utility CSS, plus new companion tokens in design-tokens.css. Avoid changing behavior contracts; adjust tests only for deliberate presentation changes.
Pet implementer owns PetStage/PetExpression and desktop-shell.css (including compact408×332 host geometry), coordinating tokens with panel owner. No App/native changes unless a demonstrated implementation defect requires coordination.
Coordinator owns assets, design/spec/task records, independent review, one coherent native build, installation and runtime acceptance. Preserve all pre-existing dirty work.

## Acceptance and bounded verification
Baseline is the currently installed app, viewed this turn. Review implementation once as a complete batch (idle pet, rest, compact actual offline/empty, expanded reading, settings/Todo/Memo and80/120% sizes); fix material findings together, confirm at most once. Do not spend cycles on unchanged screenshots or source-only “beauty scores”. No seeded messages or fake data to make the UI look full. Use focused checks, one normal build after source stability, real input/draft/navigation and composed desktop captures. Existing tray automation/model-service limitations stay explicit and are not reopened as a visual task.
