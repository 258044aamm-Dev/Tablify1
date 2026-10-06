/**
 * The toolbar: one row, never two (`docs/04` §The layout contract, §Mobile).
 *
 * This step gives it the three actions the grid can already honour — new row, undo, redo — plus the wordmark
 * slot the brand layer sizes. It deliberately does **not** invent the search box, the view menu or the import
 * button: those arrive with the surfaces that own them (steps 20–23), and a button that cannot do what it says
 * is worse than a button that is not there yet.
 *
 * The counts come from `selectStatusSummary` through a selector, so the toolbar re-renders when the numbers
 * change and not when a cell's value does.
 */
import { useCallback } from 'react';
import type { ReactElement } from 'react';

import { redo, undo } from './store/commands';
import { useStore } from './store/selectors';
import type { GridStore } from './store/types';

export type ToolbarProps = {
	readonly store: GridStore;
	/** Creates a note and adds it as a row. Absent when the host cannot create notes — see `GridView`. */
	readonly onNewRow?: (() => void) | undefined;
};

export function Toolbar(props: ToolbarProps): ReactElement {
	const { store, onNewRow } = props;
	const rows = useStore(store, (snapshot) => snapshot.rows.length);
	const canUndo = useStore(store, (snapshot) => snapshot.canUndo);
	const canRedo = useStore(store, (snapshot) => snapshot.canRedo);
	const undoLabel = useStore(store, (snapshot) => snapshot.undoLabel);

	const onUndo = useCallback((): void => {
		undo(store);
	}, [store]);
	const onRedo = useCallback((): void => {
		redo(store);
	}, [store]);

	return (
		<div className="tablify-toolbar" role="toolbar" aria-label="Tablify toolbar">
			<span className="tablify-wordmark" aria-hidden="true" />
			{onNewRow === undefined ? null : (
				<button className="tablify-btn" type="button" onClick={onNewRow}>
					New row
				</button>
			)}
			<button
				className="tablify-btn"
				type="button"
				onClick={onUndo}
				disabled={!canUndo}
				title={undoLabel === null ? 'Nothing to undo' : `Undo ${undoLabel}`}
			>
				Undo
			</button>
			<button
				className="tablify-btn"
				type="button"
				onClick={onRedo}
				disabled={!canRedo}
				title="Redo"
			>
				Redo
			</button>
			<span className="tablify-toolbar-spacer" />
			<span className="tablify-count">{rows} rows</span>
		</div>
	);
}
