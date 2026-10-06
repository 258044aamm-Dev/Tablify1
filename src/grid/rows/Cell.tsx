/**
 * One cell, and the place the editor is mounted.
 *
 * The cell is where the render-budget rule is won or lost, so it is worth being explicit about how:
 *
 *  - It takes **primitives** (`filePath`, `fieldId`, `width`, indices), never objects. A `CellRef` built by a
 *    parent would be a new object on every parent render, which would defeat `memo` on the row above it.
 *  - It subscribes to **two narrow channels** through the step-16 hooks: the value channel (`useCellDisplay`,
 *    a string) and the selection channel (`useCellFlags`, a small object compared field by field). A
 *    keystroke therefore wakes this cell and the ones beside it, and only this one re-renders — the others
 *    run their read functions, find their value unchanged, and render nothing.
 *  - It renders `selectCellDisplay`, which formats through the column's own descriptor. There is no
 *    `String(value)` anywhere in the grid: a currency, a date and a multi-select each decide how they look.
 *
 * **The editor comes from the registry** (`editors/registry.tsx`, step 18), chosen from the field descriptor's
 * declared editor id — this file never branches on a type. A double-click opens it: the pointer path. The
 * keyboard path (`Enter`, typing on an unfocused cell, `Space` on a checkbox) belongs to step 19's handler,
 * which opens the same session and therefore the same editor.
 *
 * The row's height is not negotiable, so an open editor is drawn **over** the cell rather than inside its flow:
 * `.cell` is the positioning context and the editor fills it, which is what keeps a 6-row popover and a
 * one-line input from each deciding what a row is.
 */
import { memo, useCallback, useMemo } from 'react';
import type {
	CSSProperties,
	MouseEvent as ReactMouseEvent,
	PointerEvent as ReactPointerEvent,
	ReactElement,
} from 'react';

import { editorFor } from '../editors/registry';
import { cellRoleProps } from '../a11y/roles';
import { cellTabIndex } from '../keyboard/focus';
import { useCellDisplay, useCellFlags, useEditing } from '../store/selectors';
import type { GridStore } from '../store/types';
import type { EditSession } from '../editSession';
import type { ResolvedField } from '../../core/schema/propertySchema';
import type { PropertyId } from '../../core/types';
import type { CellRef, RowId } from '../../core/ops/types';

export type CellProps = {
	readonly store: GridStore;
	readonly filePath: RowId;
	readonly fieldId: PropertyId;
	/** The render width, already clamped by `columnWidthOf`. */
	readonly width: number;
	/** The resolved column: its descriptor chooses the editor and parses the draft. */
	readonly field: ResolvedField;
	/** Zero-based position in the flat row order, for `aria-rowindex`. */
	readonly rowIndex: number;
	/** Zero-based position in render order, for `aria-colindex`. */
	readonly columnIndex: number;
	/** The column is read-only: the value is shown, the editor is never opened (docs/01 §editing). */
	readonly readOnly: boolean;
	readonly onActivate: (ref: CellRef, extend: boolean) => void;
	/** The one edit session of this grid: opening a cell is opening this. */
	readonly session: EditSession;
	/** Where a popover editor is appended (the grid area, outside the scroller). Stable callback. */
	readonly popoverHost: () => HTMLElement | null;
	/** Resolves an attachment path in the vault, when the host can answer. */
	readonly resolveLink?: ((path: string) => boolean) | undefined;
};

function CellView(props: CellProps): ReactElement {
	const { store, filePath, fieldId, width, field, rowIndex, columnIndex, readOnly, onActivate } =
		props;
	const { session, popoverHost, resolveLink } = props;
	const text = useCellDisplay(store, { filePath, fieldId });
	const flags = useCellFlags(store, { filePath, fieldId });
	const editing = useEditing(store, { filePath, fieldId });

	const onPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>): void => {
			// The range model is step 22's; what matters here is that the active cell moves on the way down
			// rather than on the click, so a drag that starts in this cell begins from this cell.
			onActivate({ filePath, fieldId }, event.shiftKey);
		},
		[onActivate, filePath, fieldId],
	);

	/**
	 * Double-click opens the editor — the pointer half of `docs/01` §Core interaction model (*Enter — edit the
	 * cell*); the keyboard half is step 19. A read-only column has no editor to open and says so through the
	 * cell's own `aria-readonly`/tooltip, which is where the docs put it: *disabled cells with a tooltip, never
	 * as editable inputs that silently discard input*.
	 */
	const onDoubleClick = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>): void => {
			if (readOnly) {
				return;
			}
			event.stopPropagation();
			session.open({ filePath, fieldId }, text);
		},
		[session, readOnly, filePath, fieldId, text],
	);

	const className = useMemo(() => {
		const names = ['cell'];
		if (flags.number) {
			names.push('is-number');
		}
		if (flags.inRange) {
			names.push('in-range');
		}
		if (flags.active) {
			names.push('is-active');
		}
		if (flags.pending) {
			names.push('is-pending');
		}
		return names.join(' ');
	}, [flags.number, flags.inRange, flags.active, flags.pending]);

	const style = useMemo<CSSProperties>(() => ({ width: `${String(width)}px` }), [width]);
	/** Resolved once per column: a read-only column answers `null`, and no editor is mounted for it. */
	const Editor = useMemo(() => editorFor(field), [field]);

	return (
		<div
			className={className}
			style={style}
			{...cellRoleProps({
				rowIndex,
				columnIndex,
				selected: flags.inRange,
				readOnly,
			})}
			data-cell={`${filePath}::${fieldId}`}
			// The column, named separately from the cell key: a pointer hit test asks "which column is under me?"
			// and reading it out of `data-cell` would mean parsing a key that contains a file path.
			data-field={fieldId}
			// The roving tab stop (step 19): the active cell is the grid's one tab-reachable cell, and every other
			// cell is reachable only by arrows or by code. Nothing else in the grid is tabbable, which is what
			// keeps `Tab` from walking 5,000 cells.
			tabIndex={cellTabIndex(flags.active)}
			onPointerDown={onPointerDown}
			onDoubleClick={onDoubleClick}
		>
			{editing && Editor !== null ? (
				<Editor
					field={field}
					ref={{ filePath, fieldId }}
					width={width}
					initial={text}
					session={session}
					popoverHost={popoverHost}
					{...(resolveLink === undefined ? {} : { resolveLink })}
				/>
			) : (
				<span className="cell-text">{text}</span>
			)}
		</div>
	);
}

/**
 * `memo` without a comparator: every prop is a primitive, a stable store reference or a `useCallback` from
 * the row above. That is what lets a scroll mount new rows without re-rendering the ones already on screen.
 */
export const Cell = memo(CellView);
