# Implementation plan

User-approved task remains in progress; current correction is driven by repeated onscreen whole-cat dropout.

1. DONE: capture visible baseline and isolate display policy then redundant focus. Both repeated A/B cases fail; no more speculative CSS or flag trials.
2. Implement fixed main cat window plus existing chat integrated surface; acknowledgements, hidden preparation, crop, focus/order, reminders and drag coordination.
3. Review affected frontend/native flow and relevant invariants. Run focused geometry/interaction/state tests, pnpm build and native app packaging because both frontend and Rust changed.
4. Real onscreen open/close and10 settings cycles, cat frame invariance, focus/draft and native drag. Rank source-frame cat changes and inspect anomalous frames without resampling. No fabricated business data.
5. Correct any runtime failures before final claim. Update spec/research/journal, local commit. Archive only when accepted scope is verified; record any remaining platform gaps honestly.

Affected files: src/App.tsx, src/styles.css, src-tauri/src/lib.rs, src-tauri/tauri.conf.json, targeted transition tests; component props only if required. Preserve unrelated llm-dual-mode task.
