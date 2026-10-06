/**
 * The header band: the scrolling column headers, and the fixed corner that covers the gutter and the pinned
 * column.
 *
 * Both are **layers above the scroller**, not content inside it, so nothing the browser does to the scroll
 * position can move them: the header lane is translated by `-scrollLeft` and by nothing else, and the corner
 * is not translated at all. That is the structure `docs/04` §The layout contract asks for, and it is why the
 * frozen column can be exact to the pixel: its geometry is never derived from a scroll calculation that could
 * round differently.
 *
 * A header cell carries no behaviour in this step (there is no resize handle and no menu until step 20); what
 * it must get right now is geometry — a fixed width per column, exactly the column's render width — because
 * every later feature measures against it.
 */
import { memo } from 'react';
import type { ReactElement } from 'react';

import type { ColumnView } from './rows/Row';

export type HeaderLaneProps = {
	/** The columns this lane draws (all of them, or all but the pinned one). */
	readonly columns: readonly ColumnView[];
	/** Render-order index of `columns[0]`, so `aria-colindex` counts the whole row. */
	readonly columnOffset: number;
	/**
	 * True when the gutter rides in *this* lane, i.e. in a narrow pane with nothing pinned. `docs/08` §P21:
	 * below the threshold the gutter scrolls sideways with everything else, which is what makes a 389 px pane
	 * usable — the row number is then a thing you scroll to, not a thing that eats a third of the width.
	 */
	readonly gutter: boolean;
};

function HeaderLaneView(props: HeaderLaneProps): ReactElement {
	const { columns, columnOffset, gutter } = props;
	return (
		<div className="tablify-lane" role="row">
			{gutter ? (
				<div className="hcell gutter-head" role="columnheader" aria-colindex={0}>
					<span className="hcell-name">#</span>
				</div>
			) : null}
			{columns.map((column, at) => (
				<div
					key={column.field.definition.id}
					className="hcell"
					style={{ width: `${String(column.width)}px` }}
					role="columnheader"
					aria-colindex={columnOffset + at + 1}
					title={column.field.definition.name}
					data-field={column.field.definition.id}
				>
					<span className="hcell-name">{column.field.definition.name}</span>
					{/*
					 * The resize edge. A 6 px target at the column's right edge, invisible until hovered — the
					 * prototype's `.hcell-resize`, and the only part of the header that is a drag rather than a
					 * click. `data-resize` names the column so one delegated handler can start the drag.
					 */}
					<span className="hcell-resize" data-resize={column.field.definition.id} />
				</div>
			))}
		</div>
	);
}

export const HeaderLane = memo(HeaderLaneView);

export type CornerProps = {
	/** The columns pinned out of the scrolling lane — empty when nothing is pinned. */
	readonly columns: readonly ColumnView[];
	/** True when the gutter rides in the frozen lane, i.e. when the gutter header belongs here too. */
	readonly gutter: boolean;
};

/**
 * The corner is the third sticky surface: it sits above both the header lane and the frozen column, and it is
 * what a user actually sees at the top-left. When nothing is pinned it holds only the gutter's `#`.
 */
function CornerView(props: CornerProps): ReactElement {
	const { columns, gutter } = props;
	return (
		<div className="tablify-lane">
			{gutter ? (
				<div className="hcell gutter-head" role="columnheader" aria-colindex={1}>
					<span className="hcell-name">#</span>
				</div>
			) : null}
			{columns.map((column, at) => (
				<div
					key={column.field.definition.id}
					className="hcell"
					style={{ width: `${String(column.width)}px` }}
					role="columnheader"
					aria-colindex={(gutter ? 1 : 0) + at + 1}
					title={column.field.definition.name}
					data-field={column.field.definition.id}
				>
					<span className="hcell-name">{column.field.definition.name}</span>
					<span className="hcell-resize" data-resize={column.field.definition.id} />
				</div>
			))}
		</div>
	);
}

export const Corner = memo(CornerView);
