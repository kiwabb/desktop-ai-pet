# Todo list visual correction

User rejected the initial utilitarian list/button appearance and explicitly asked to reference established todo products. This is a presentation correction to the existing authorized feature, not a new dashboard or backend scope.

## References inspected

- Things official features: https://culturedcode.com/things/features/ — task-focused white surfaces, left completion controls, quiet secondary information. Official screenshots (Today and Headings) were visually inspected; they are product illustrations from the site's 2017 media directory, not evidence of the latest OS-version appearance.
- Todoist official task introduction: https://www.todoist.com/help/todoist/features/introduction-to-tasks-080OAXric — click the circle next to a task to complete it.
- agent-reach Jina reads saved under /tmp/desktop-pet-*-reference.md. No third-party artwork will be shipped in the app.
- ui-ux-pro-max design-system query performed. Apply accessibility, restrained hierarchy and interaction checks; its generic landing-page/neumorphic/handwriting suggestions do not fit this established desktop UI and are not adopted.

## Accepted visual boundary from user feedback

- Replace the separate right-hand green action button with a compact left completion control, keeping a generous hit area and accessible label.
- Title is the primary text. Remove repeated pending/completed pills: checkbox/checkmark plus completed text treatment communicates status.
- Keep creation time available with a compact visible date and exact timestamp in title/accessibility; no invented due date or Today semantics.
- Calm task rows on the existing warm paper surface, consistent spacing, one restrained toolbar count and refresh control. Avoid nested cards, large heroes, dashboards, sidebar, or extra filters.
- Completed item remains visible with checked mark and subtle strike-through; no undo behavior is invented. Keep original server ordering to avoid surprising row jumps.
- Preserve all direct HTTP behavior, pending spinner, error states, duplicate-request guard, refresh exclusion and configuration-generation protection.
- Keep the existing pet artwork, frame/paw/tail geometry, window sizing and navigation. Only TodoList component and scoped CSS should change.

## Verification

Use actual data when rendering evidence; no seeded tasks or demo service. Source/build/static rendering must not be reported as native desktop acceptance. Preserve keyboard focus and reduced-motion behavior. The native Computer Use pipe has been unavailable; document that limitation if still unresolved.

## Subsequent user-authorized change: reopen

The earlier visual-only boundary excluding undo is superseded by the user's report that completed items cannot be unchecked. Completed checks now remain interactive and request pending through the authenticated reopen endpoint. Preserve the visual hierarchy and only report state changes after persistence.
