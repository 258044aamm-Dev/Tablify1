/**
 * One row: the gutter (when it rides in this lane) and the row's cells.
 *
 * Two things about it are structural rather than cosmetic:
 *
 *  - **The gutter is optional**, because §P21 moves it. On a wide pane the gutter belongs to the frozen lane
 *    (it never scrolls sideways); in a narrow pane the frozen lane does not exist at all and the gutter rides
 *    in the scrolling lane with the cells. One row component serves both, which is what keeps the two lanes
 *    from drifting apart in geometry.
 *  - **`memo` plus a stable `columns` array** is the scroll rule. The parent builds `columns` from the
 *    snapshot (so its identity changes only when the snapshot does), and a scroll does not touch the
 *    snapshot — so a scroll that mounts new rows leaves the mounted ones untouched, which is what
 *    `tests/dom/gridview.test.tsx` measures.
 */
import { memo, useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';

import { Cell } from './Cell';
import { useRowFlags } from '../store/selectors';
import type { GridStore } from '../store/types';
import type { RowId } from '../../core/ops/types';
import type { CellRef } from '../../core/ops/types';
import type { ResolvedField } from '../../core/schema/propertySchema';

/** One renderable column: what it is, and how wide it is. Built once per revision by the grid. */
export type ColumnView = {
	readonly field: ResolvedField;
	readonly width: number;
};

export type RowProps = {
	readonly store: GridStore;
	readonly filePath: RowId;
	/** Zero-based flat row index. Stable while the row set is unchanged, which is what keeps `memo` quiet. */
	readonly rowIndex: number;
	/** The columns this lane draws — all of them, or all but the pinned one. */
	readonly columns: readonly ColumnView[];
	/** The render-order index of `columns[0]`, so `aria-colindex` counts the whole row, not this lane. */
	readonly columnOffset: number;
	/** True when the gutter belongs to this lane (unpinned panes); false when the frozen lane owns it. */
	readonly gutter: boolean;
	readonly onActivate: (ref: CellRef, extend: boolean) => void;
	readonly onToggleRow: (filePath: RowId, checked: boolean) => void;
};

function RowView(props: RowProps): ReactElement {
	const { store, filePath, rowIndex, columns, columnOffset, gutter, onActivate, onToggleRow } =
		props;
	const flags = useRowFlags(store, filePath);

	const onGutterToggle = useCallback(
		(checked: boolean): void => {
			onToggleRow(filePath, checked);
		},
		[onToggleRow, filePath],
	);

	const onGutterPointer = useCallback(
		(event: ReactPointerEvent<HTMLLabelElement>): void => {
			// The gutter is also a selection surface: a press on it focuses the row's first column, which is
			// what makes "drag the row number to reorder" (step 20) and "click to select the row" (step 22)
			// start from the same place.
			event.stopPropagation();
			const first = columns[0];
			if (first !== undefined) {
				onActivate({ filePath, fieldId: first.field.definition.id }, event.shiftKey);
			}
		},
		[columns, onActivate, filePath],
	);

	const className = `grid-row${flags.checked ? ' is-checked' : ''}${flags.active ? ' is-active' : ''}`;

	return (
		<div
			className={className}
			role="row"
			aria-rowindex={rowIndex + 1}
			aria-selected={flags.checked}
			data-row={filePath}
		>
			{gutter ? (
				<div className="gutter">
					<label className="gutter-check" onPointerDown={onGutterPointer}>
						<input
							className="row-check"
							type="checkbox"
							checked={flags.checked}
							aria-label={`Row ${String(rowIndex + 1)} selected`}
							onChange={(event) => {
								onGutterToggle(event.target.checked);
							}}
						/>
					</label>
					<span className="gutter-index">{rowIndex + 1}</span>
				</div>
			) : null}
			{columns.map((column, at) => (
				<Cell
					key={column.field.definition.id}
					store={store}
					filePath={filePath}
					fieldId={column.field.definition.id}
					width={column.width}
					rowIndex={rowIndex}
					columnIndex={columnOffset + at}
					readOnly={column.field.readOnly || !column.field.descriptor.editable}
					onActivate={onActivate}
				/>
			))}
			{/* A row with pending writes says so on the row, not only on the cells (docs/02 §write states). */}
			{flags.dirty ? <span className="row-pending" aria-hidden="true" /> : null}
		</div>
	);
}

export const Row = memo(RowView);
