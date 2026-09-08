# Research: native window evidence boundary

- Query: Interpret CGWindowList observations against locked tauri-nspanel conversion mechanics.
- Scope: internal, dependency source plus main-session read-only system evidence
- Date: 2026-09-08

## Findings

Main-session evidence: process41181 is the latest bundle. All-window CGWindowList reports main24514 at232×381,x1306/y583,layer4; chat24515 at360×164,layer4; another untitled window24519 at500×500,layer0. On-screen-only enumeration contains no window owned by the app. AX Raise did not visibly change this.

Locked tauri-nspanel c9ec213 does **not** create a replacement NSWindow when converting a Tauri window. Its `panel.rs:559-598` retrieves the existing ns_window pointer, records its class, calls `object_setClass` on that same object, and retains the same pointer as the panel. `lib.rs:232-243` stores this panel handle under the original label. `panel.rs:610-625` enables width/height autoresizing on existing content subviews. Therefore conversion itself does not explain a second hidden original main window versus a separately resized panel. The500×500 untitled window cannot be identified as a replacement pet window from this source or the supplied dimensions.

The all-window bounds are real system evidence that the recorded main window had closed-sized native bounds **at that sampling time**. They do not show whether an expanded transition previously succeeded, rolled back, or never reached the native command. Absence from on-screen-only enumeration means the window was not included as on-screen at capture time; a different Space/hidden ordering is consistent with that observation. The exact cause of exclusion is not established.

AX elements and cached/retained window imagery can still provide information while the window is not in the current visible scene. With no on-screen app window, the prior CUA screenshot/AX content cannot establish the fresh currently-painted state of an expanded window. This is an evidence limitation, not proof that CUA is stale or that product rendering is broken.

### Bounded conclusion and next boundary

- Keep the native send→expand acceptance item **unverified**, recording the non-visible-window condition and actual232×381 native bound.
- Do not patch AppKit resizing or replace the NSPanel conversion based on these observations alone.
- Re-establish a genuinely on-screen main window in the user's intended Space, then compare its same CGWindowID/bounds before and after one controlled transition; correlate with actual mode/invoke/paint checkpoints if the symptom repeats.
- The source-proven unbounded RAF liveness issue from `native-resize-stall.md` remains a valid separate defensive finding. It is not a confirmed explanation for this CGWindowList state.
- A no-op AX Raise does not prove setFrame failure. Avoid repeated broad automation until visibility/state provenance is clear.

## Caveats / Not Found

Only the dependency source was read in this subtask. CGWindowList values were supplied by the main session. No product code, native windows, processes, Space selection, or user data were changed. No reliable identity was established for untitled window24519.
