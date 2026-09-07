# Research: approved V2 settings content

- Query: Extract settings card hierarchy and visual proportions for the existing expanded 676 × 665 panel, keeping all displayed state real.
- Scope: internal, static reference/source inspection
- Date: 2026-09-07

## Findings

### Files found

- Task `references/preview-v2-approved.html:135-148`: full settings DOM. CSS line 8 is the base style; lines 12 and 21 override it. No embedded images were printed or changed.
- `src/components/ChatPanel.tsx:124-141,279-309`: current settings submit and single-card form; saving uses the existing native API, clears the entered credential, closes settings and returns to compact mode.
- `src/lib/agent.ts:55-89`: actual `AgentView`, `connectionLabel`, and `saveAgentSettings` contracts. No independent test-connection frontend function is present here.

### Exact reference hierarchy

Settings body is a column: scrollable two-column grid followed by a fixed-height decorative footer. Base logical panel is 1022 × 882. Header height111; body padding top13/right20/bottom10/left22; grid gap17; left card flexible (~602px), right column360px. Grid occupies remaining body height and scrolls when needed.

1. Left **连接助手服务** card, height689, round24, inner horizontal padding25. Intro: 80 × 78 cream shield tile, gap23, title27px, body15.5px line1.7. Service field starts at y147, credential y303, model block y458, actions y570. Inputs57px high, radius15, text21px; labels20px. Model is a warm chip47px high with model name19px plus a secondary server-configured caption. Two equal-width buttons97px tall, radius19: outlined **测试连接** and brown **保存并连接**, each with icon/title and a subordinate purpose line.
2. Right **连接状态** card, height246, padding17/18. Title22px and compact state tag. Full-width state banner86px high/radius15 with circular icon51px, state title21px and smaller explanation13px. Below it, a cream inset details box83px high/radius16 shows service address and credential-presence rows; labels16px, values15px, values right aligned and truncated.
3. Right **使用说明** card, height193, padding17/19. Three numbered peach circles29px; steps16px/1.6: fill endpoint; replace credential only when needed; test then save.
4. Right **安全提示** card, height220, padding16/19. Bulb heading, three small green check circles25px, body15.5px/1.5. Notes cover credential secrecy, trusted endpoint, and connection troubleshooting. Bottom inset note36px high/radius18 says “有任何问题，助手都会陪着你～”, with small paw.
5. Footer49px high: left muted paw43px plus hand-lettered “有助手 · 每一天都更可爱”17px and heart; center paw43px at55%; right `STAY WITH YOU · ALWAYS CUTE`10px with heart. This footer is decorative, not an operational status. Use Lucide Heart rather than a text heart/emoji per project rules; corner paw position/shadow remains untouched.

Right column gap15px. All four cards share `border:1px solid #eee7e2`, cream-white gradient `#fff → #fffefd → #fffdfb`, shadow `0 6px 13px #b8865010`. Ink `#4b1d0b`; muted text `#8c8481`; warm brown `#a24e20`; line `#f1ded1`.

Input border `#dedada`; focus border `#eba77e` and ring `#ffe8d555`. Primary gradient `#aa582d → #9e4a20 → #a4582f`, border `#904219`, text `#fff8eb`. Secondary cream `#fffdf9 → #fff5e9`, border `#ffc59f`, text `#9a481b`. Success banner `#f4fcf1 → #f2fcf5`, border `#aee5be`, green `#009747`. Idle is muted cream; connecting amber; errors warm red. These colors must follow actual connection state, not the static reference's success state.

### Recommended adaptation to current 676 × 665 panel

The width ratio is 676/1022 = .6614, but globally scaling text would reduce body text to10px. Recreate the proportions in normal-flow CSS instead:

- Retain the existing shared-frame header and paw. Settings interior horizontal padding16px; resulting644px grid = left394px + gap12px + right238px (about61:37, close to reference62:37).
- Card radius16px, padding16px left and12px right. Grid gap12px; right-stack gap10px. Target main card around480-500px high with its contents flowing naturally; match right total height. Let the grid scroll when actual header, errors, content wrapping, or height leave less room.
- Intro tile48-52px, icon26px; title20px; body12-13px/1.55. Labels14px; inputs44px high/radius11 with14px text. Field spacing18-22px. Avoid reference absolute top offsets.
- Model row chip32px high and13px text; allow model/caption wrapping or ellipsis. Buttons ~62px high, radius12, gap8; title14-15px and purpose11px. Preserve actual busy/disabled/error states.
- Right title15px, status banner60px, icon32px, main state14px, details11-12px; facts inset ~62px. Status card around164px; guide around130px; security around166px, growing if text wraps. Use12px explanatory text rather than literal .661-scaled10px.
- Footer32-36px, left tagline11-12px, paw25-28px, right English8-9px. At this width omit center paw first if cramped, preserving the left/right overall composition.
- Keep two columns at676px. The reference's literal `data-narrow` threshold890 would stack everything; that threshold belongs to its larger logical coordinate system. A local ~600px breakpoint is appropriate for this smaller panel; below it use one column and retain scroll access to all cards/footer.

### Real state and migration boundary

The reference starts in demo success mode (`gpt-5.6-luna`, “连接正常”, “演示状态 · 尚未连接真实服务”). None of those literals may become application truth.

- Show model only from `status.model`; use configured/unknown empty text when absent.
- Use `connectionLabel(status)` plus `connection`, `model_configured`, `node_connected` and existing errors. Green success requires real connected state; chat connection versus device registration are distinct.
- Endpoint facts show saved `status.endpoint`, not an unsaved draft presented as a verified address. Draft address stays in input.
- Never expose credential contents. `configured` can support “已配置” wording, but `AgentView` exposes no actual secret or secret-presence field. Avoid a fabricated masked token string.
- The app stores credentials in a native private file, so keep its existing explanation. Do not copy the reference's browser-session-only credential claim.
- No standalone “测试连接” API is exported by `src/lib/agent.ts`; do not implement this by calling save silently or use the HTML simulated adapter. Main/implementation must decide whether to add a real non-saving backend path or omit that action and adjust guide wording to the existing real Save flow.
- Status details may be static semantic content unless a meaningful details interaction exists. Do not retain a decorative button that opens fake logs.
- Existing save flow closes settings after success. Restyling alone should preserve it; any changed flow needs deliberate ownership.

### Related specs

- `.trellis/spec/frontend/component-guidelines.md`: React props/state contracts, existing Lucide icons, accessibility, native credential handling, no fake data.
- `.trellis/spec/frontend/quality-guidelines.md`: actual UI flow and evidence classification; source/build checks alone are not visual acceptance.

## Caveats / Not Found

- This is static extraction with layout recommendations; no screenshots or real connection/model verification were performed.
- The right-column/footer content is explicitly present in the approved reference. The suggested smaller sizes are adaptation guidance, not measured current-browser values.
- No source/CSS/business code or approved image was modified.
