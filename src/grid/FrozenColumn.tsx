/**
 * The frozen lane: the gutter and the primary column, pinned out of the horizontal scroll.
 *
 * It only exists when `pinnedPrimary` says so, and when it exists the *row lane stops drawing those columns*
 * — the two lanes partition the row rather than overlap it. That is the difference between a frozen column
 * that lines up and one that nearly lines up: there is no second copy of a cell to keep in sync.
 *
 * It draws its rows with the **same `Row` component** the scrolling lane uses, handed a one-column slice and
 * `columnOffset = 0`. There is deliberately no `FrozenCell`: a second cell implementation is a second place
 * for formatting, subscription and read-only rules to drift, and the frozen column is exactly where a drift
 * would be invisible until someone compared the two.
 *
 * Vertically the layer is translated by `headerHeight - scrollTop`, which is the same expression the row lane
 * gets for free from being inside the scroller (it sits at `headerHeight` in the content, and the browser adds
 * `-scrollTop`). Writing it out here is what keeps the two lanes locked to the pixel — and it is why the
 * frozen column cannot drift against the header, which is `docs/07` §Tier 4 assertion 4.
 */
import { memo } from 'react';
import type { ReactElement } from 'react';

import { Row } from './rows/Row';
import type { ColumnView } from './rows/Row';
import type { GridStore } from './store/types';
import type { CellRef, RowId } from '../core/ops/types';

export type FrozenLaneProps = {
	readonly store: GridStore;
	/** The rows this lane draws: the same slice the row lane draws, so the two cannot disagree. */
	readonly rows: readonly RowId[];
	/** The row index of `rows[0]` in the flat row order, for `aria-rowindex` and the gutter's numbers. */
	readonly firstRowIndex: number;
	/** The columns it owns: exactly the primary column when pinned. */
	readonly columns: readonly ColumnView[];
	readonly onActivate: (ref: CellRef, extend: boolean) => void;
	readonly onToggleRow: (filePath: RowId, checked: boolean) => void;
};

function FrozenLaneView(props: FrozenLaneProps): ReactElement {
	const { store, rows, firstRowIndex, columns, onActivate, onToggleRow } = props;
	return (
		<div className="tablify-lane is-column">
			{rows.map((filePath, at) => (
				<Row
					key={filePath}
					store={store}
					filePath={filePath}
					rowIndex={firstRowIndex + at}
					columns={columns}
					columnOffset={0}
					gutter
					onActivate={onActivate}
					onToggleRow={onToggleRow}
				/>
			))}
		</div>
	);
}

export const FrozenLane = memo(FrozenLaneView);
