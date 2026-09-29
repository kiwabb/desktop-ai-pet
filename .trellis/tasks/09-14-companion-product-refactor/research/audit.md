# Current source audit
Read-only reviewers: inspect_pet_surfaces, review_conversation, review_utilities.
- Shell: dual NSPanel levels 5/4, cat 232x380.9; mac chat 940x760; compact content 475x278; expanded ~676x665. Dimensions duplicated. Missing work-area fit. Preserve serialized group drag, request/ack/timeout recovery and single cat.
- Chat: compact lacks history access; terminal empty replies; historical run failure absent; full snapshot reprojects/reparses; per-message tool filter; unlimited DOM; draft disabled during generation; broad live announcements; Escape hierarchy; reader state lacks session boundary.
- Existing correct chat: accepted inserts user/assistant placeholders, tools visible; request_id/ack/IME locks; safe markdown/clipboard.
- Settings: model fetch stale results; save field races; help follows saved not editing mode; immediate close hides save outcome.
- Todo: background refresh clears edit; Escape propagates; pending delete becomes invisible; focus lost when rows move/remove; tonight reminder label after cutoff incorrect. Preserve generation fences/CAS.
- Admin inventory: login/overview/accounts/devices/runs/sessions/todos/reminders/models/tools/audit. Audit as separate operator flow.
- Dirty CSS: global warm WebKit scrollbar and removed component scrollbar overrides; preserve.
