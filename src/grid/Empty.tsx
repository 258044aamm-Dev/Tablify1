/**
 * The two empty states, with the copy the prototype already established.
 *
 * They are different states and say different things, which is the point: "nothing matches your filter" is a
 * problem the user caused and can undo in one click, while "this table is empty" means there are no notes
 * behind the view yet. Showing one message for both is how a user ends up hunting for a filter they never set.
 *
 * No illustration and no animation (`docs/04` §Motion: a rare state may be pleasant, but an empty grid is
 * reached by filtering, which is frequent, and a thing you see many times a day must not perform).
 */
import type { ReactElement } from 'react';

export type EmptyProps = {
	/** Rows the source offered before the query: `> 0` means a filter is hiding them. */
	readonly totalRows: number;
	/** True when the view has a filter, a search term or a grouping that could be cleared. */
	readonly filtered: boolean;
	/** Absent when the host cannot create notes; the button then does not exist rather than doing nothing. */
	readonly onNewRow?: (() => void) | undefined;
	readonly onClearFilters?: (() => void) | undefined;
};

/** `1 row` / `2 rows`. The count is written out because "empty" is a claim, and a claim should be checkable. */
function rows(count: number): string {
	return `${String(count)} ${count === 1 ? 'row' : 'rows'}`;
}

export function Empty(props: EmptyProps): ReactElement {
	const { totalRows, filtered, onNewRow, onClearFilters } = props;
	return (
		<div className="tablify-empty" role="status">
			<div className="tablify-empty-title">
				{filtered ? 'No rows match this view' : 'This table is empty'}
			</div>
			<div className="tablify-empty-body">
				{filtered
					? `Nothing survives the current filter, query or search — ${rows(totalRows)} are in the table.`
					: `${rows(totalRows)} in this view · rows are notes in your vault. Create one here, or import a CSV, XLSX or .tabula file.`}
			</div>
			<div className="tablify-empty-actions">
				{onNewRow === undefined ? null : (
					<button className="tablify-btn is-primary" type="button" onClick={onNewRow}>
						New row
					</button>
				)}
				{filtered && onClearFilters !== undefined ? (
					<button className="tablify-btn" type="button" onClick={onClearFilters}>
						Clear filter, sort and search
					</button>
				) : null}
			</div>
		</div>
	);
}
