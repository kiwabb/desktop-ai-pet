# Todo Unicode input contract

The current ordinary build index-DH-v2eQj.js/PID56349 was checked through native CUA without saving a Todo. Existing storage rendered zero pending and two completed records. Pasting1001 repetitions of U+20BB7 (a supplementary-plane CJK character) into the new-title input retained1000 code points /2000 UTF-16 units in the returned accessibility value. The first parser incorrectly assumed Value preceded Placeholder and reported0; reading the captured line in its actual order established the1000-character value. The failed parser result is not application evidence.

Both create/title-edit JSX inputs had maxLength={2000}. Browser maxLength uses UTF-16 code units, whereas titleError uses Array.from(trimmed).length, Rust validates chars().count(), and the Python store validates len; the accepted contract is2000 code points. The two native maxlength attributes were removed. Pre-submit and backend validation remain unchanged, and invalid drafts remain visible. No API or storage contract changes are required.

The long field stayed inside its allocated width, the Add control remained visible, and Tab visibly focused Add. Shift-Tab returned to the input; select-all/delete cleared it, restoring the placeholder and disabled Add. No create, edit, complete, reminder or delete action was submitted. This does not verify a persisted long row or Chinese IME composition.

The change boundary is TodoList.tsx's two input attributes plus its explanatory validation comment and the corresponding frontend spec. Independent source review agrees that addTodo/saveTitle validate before locking or calling the API. Ordinary rebuilding and a native1001-character retention /2001-character rejection check are pending; no post-fix result is claimed yet.
