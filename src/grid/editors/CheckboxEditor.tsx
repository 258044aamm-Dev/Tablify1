/**
 * `CheckboxEditor` — a checkbox cell is never *text-edited*, and this component is what that looks like in the
 * registry.
 *
 * `docs/01` §Core interaction model: *Space on a checkbox cell — toggle without entering edit mode*. The
 * prototype agrees (`prototype/js/grid.js` — `beginEdit` toggles and returns before any input is built), so a
 * checkbox has no draft, no parser and no blur: it has a **control**, and using the control is the write.
 *
 * The control is reached two ways, and both end the same way (one boolean write, then focus back to the grid):
 *  · `Space` / `Enter` from the grid opens this editor on the cell (step 19 routes the key), or a double-click
 *    does;
 *  · a click on the control itself — which is the pointer path a person actually uses.
 *
 * "The opposite of the current value" is read from the column's **own parser**, not from a table of words here:
 * the cell shows `Yes`/`No` (`checkboxField.formatDisplay`), `readCheckbox` accepts those words and `true`/`1`/
 * `on`, and inverting a value the descriptor could not parse is not this component's business — an unreadable
 * checkbox cell becomes `true`, which is what a person toggling a broken cell means.
 */
import { useCallback } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';

import { useEditState } from './useEditState';
import type { EditorProps } from './registry';

export function CheckboxEditor(props: EditorProps): ReactElement {
	const { session, field } = props;
	const state = useEditState(session);

	const current = field.descriptor.parse(state.draft, field.context);
	const next = current.ok && current.value === true ? false : true;

	const toggle = useCallback((): void => {
		session.commit(next);
	}, [session, next]);

	/** Space and Enter are the documented keys; both are "use the control", not "type into it". */
	const onKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLInputElement>): void => {
			if (event.key === ' ' || event.key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
				toggle();
			}
		},
		[toggle],
	);

	return (
		<span className="cell-editor-check">
			<input
				className="cell-check"
				type="checkbox"
				defaultChecked={next === false}
				// Autofocus is deliberate: the editor is opened *by* a gesture on this cell, so the control the
				// user is about to use is the one that should have the keyboard.
				autoFocus
				aria-label={field.definition.name}
				onKeyDown={onKeyDown}
				onChange={toggle}
			/>
		</span>
	);
}
