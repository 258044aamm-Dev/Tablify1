/**
 * The keys an open editor owns: `Escape`, `Enter`, `Tab`.
 *
 * While an editor is open **it** is the keyboard's owner, and that is not a detail — it is what makes the grid's
 * own handler (step 19) and the editor's agree instead of fighting. `docs/01` §Core interaction model states the
 * contract from the grid's side: *Enter — edit the cell; committing moves down one row*, *Tab — commit and move
 * right / left*. So an open editor's Enter/Tab **commit**, and the movement is the grid's follow-up (a move is a
 * selection change, and the selection belongs to the store; step 19 adds it where the store's commands are).
 *
 * `Escape` is routed through the session rather than handled here, because "what Escape cancels" is a state
 * machine question: with an option list open it closes the list, and only the next press closes the editor
 * (`editSession.escape()` answers which one happened). The event is always stopped, so the first Escape cannot
 * also reach the grid and deselect a range the user was not done with.
 *
 * This lives in the editors rather than in `Cell` on purpose: a checkbox's control, a select's popover and a
 * text input each have their own focus target, and one hook wired into each of them is what keeps the keys
 * identical across all eight.
 */
import { useCallback } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { EditSession } from '../editSession';

export function useEditorKeys(
	session: EditSession,
	commit: () => void,
): (event: ReactKeyboardEvent<HTMLElement>) => void {
	return useCallback(
		(event: ReactKeyboardEvent<HTMLElement>): void => {
			switch (event.key) {
				case 'Escape':
					event.preventDefault();
					event.stopPropagation();
					session.escape();
					return;
				case 'Enter':
					// Enter commits. ⌘/Ctrl+Enter is the same thing here — the multi-line case is the long-text
					// popover, which commits with its own button, so there is no second meaning to give it.
					event.preventDefault();
					event.stopPropagation();
					commit();
					return;
				case 'Tab':
					event.preventDefault();
					event.stopPropagation();
					commit();
					return;
				default:
					return;
			}
		},
		[session, commit],
	);
}
