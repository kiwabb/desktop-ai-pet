# Rich theme check — 2026-10-03

Evidence: bounded source review, unit and static checks only; no native build, image request or UI acceptance.

## Fixed
- New theme names/auxiliary specimen labels used 11px; changed to minimum 12px.
- Rich-theme input boundaries used decorative companion-line (measured 1.18–1.26:1 against reading surface). Added companion-control-line, derived to >=3:1 against all generated surfaces. Mapped companion input-rule, customization input/color controls and specimen input, plus memo select. Decorative panel/card separators remain subtle. Legacy petTheme explicitly retains the previous line value, preserving saved legacy appearance and preventing token inheritance from a rich active theme into a legacy preview.

## Contracts reviewed
- Optional Preset.theme and defaulted colors preserve old JSON. Missing theme uses legacy palette exactly; migration extracts local candidates but does not change saved accent/theme or source files. New generated presets receive character theme.
- Theme: palette whitelist, six-digit primary/secondary, integer strength 0–100; omitted update preserves saved theme. Commit persists before replacing state; supplied theme primary is mirrored to accent.
- Six choices provide coordinated reading, chrome, action, selected, user and selection surfaces. Text >=4.5 and focus >=3; dedicated rich-theme input boundary >=3. Generated raster paw is unchanged; original SVG consumes theme tokens.
- Extraction excludes low-alpha and neighboring fringe; colorful significant clusters rank before neutrals, retains up to four separated candidates. This is deterministic pixel sampling, not semantic eye/coat detection.
- Theme draft stays local until explicit save/apply; hydration dependencies use saved primitive values and serialized theme, so unchanged polling does not rehydrate draft. Same-asset saved secondary-color changes update active context without sprite reload. Component handler tests disable ordinary effects, so they do not independently prove polling behavior; source inspection establishes the dependency guard, native acceptance remains necessary.
- Native details/summary keyboard semantics and label-wrapped range/color inputs retained. Native WKWebView activation/layout needs main-session verification.

## Verification
- Implementer reported frontend 29 and Rust customization 27 tests, TypeScript/rustfmt pass before review.
- Reviewer ran theme suite after changes: 11 passed, including 243 primary/secondary/strength combinations checking input boundary >=3 and text >=4.5 on all role surfaces.
- TypeScript app check: pass. git diff --check: pass. No configured frontend lint script.
- No remaining blocking source finding. Visual quality, every page, save/apply/reopen/restart and active pet pairing are not certified by these tests; main session owns native acceptance.

## Narrow followup — extraction/cache version 2
Source review found no blocker; no reviewer source edits or repeated test suite. Colorful clusters now require absolute chroma >=35 and relative chroma >=24%, ranked with integer sqrt(population) * chroma squared. Existing sample bounds, fringe exclusion, minimum significant population and deterministic sorting remain. COLORS_VERSION=2 is saved for new presets; missing version defaults to 0. Startup only refreshes outdated candidate caches after successful decode, preserving saved accent/theme/badge and source assets; current-version caches are not reprocessed. The synthetic warm-white-vs-orange regression and version1-cache/saved-theme preservation regression remain. Temporary real-file diagnostic code is absent. Actual real-image candidate values were reported by implementer, not independently reprobed by reviewer. Final Rust28 run belongs to implementer; main owns native verification.
