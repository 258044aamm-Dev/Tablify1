/**
 * One cell.
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
 * The editor is a **placeholder** in this step (step 18 replaces it with the registry): an input that shows
 * the current text and refuses to commit — `Escape` and blur both cancel. It exists now so the focus and
 * geometry rules can be measured against a real input (16 px, inside a 40 px row) before the editors that
 * will multiply it arrive.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
	CSSProperties,
	KeyboardEvent as ReactKeyboardEvent,
	PointerEvent as ReactPointerEvent,
	ReactElement,
} from 'react';

import { useCellDisplay, useCellFlags, useEditing } from '../store/selectors';
import type { GridStore } from '../store/types';
import type { CellRef, RowId } from '../../core/ops/types';
import type { PropertyId } from '../../core/types';

export type CellProps = {
	readonly store: GridStore;
	readonly filePath: RowId;
	readonly fieldId: PropertyId;
	/** The render width, already clamped by `columnWidthOf`. */
	readonly width: number;
	/** Zero-based position in the flat row order, for `aria-rowindex`. */
	readonly rowIndex: number;
	/** Zero-based position in render order, for `aria-colindex`. */
	readonly columnIndex: number;
	/** The column is read-only: the value is shown, the editor is never opened (docs/01 §editing). */
	readonly readOnly: boolean;
	readonly onActivate: (ref: CellRef, extend: boolean) => void;
};

function CellView(props: CellProps): ReactElement {
	const { store, filePath, fieldId, width, rowIndex, columnIndex, readOnly, onActivate } = props;
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

	return (
		<div
			className={className}
			style={style}
			role="gridcell"
			aria-rowindex={rowIndex + 1}
			aria-colindex={columnIndex + 1}
			aria-selected={flags.inRange}
			{...(readOnly ? { 'aria-readonly': true, title: 'This column is read-only' } : {})}
			data-cell={`${filePath}::${fieldId}`}
			onPointerDown={onPointerDown}
		>
			{editing ? (
				<PlaceholderEditor store={store} initial={text} />
			) : (
				<span className="cell-text">{text}</span>
			)}
		</div>
	);
}

/**
 * Step 17's stand-in for a real editor: it takes focus, it accepts typing, and it commits **nothing**.
 * `Escape` and blur both cancel, which is the behaviour step 18's state machine formalises. Keeping the
 * input mounted rather than the span is deliberate — the geometry rules (16 px text in a 40 px row, the
 * caret not moving the scroll) are measured against the real element from the day it exists.
 */
function PlaceholderEditor({
	store,
	initial,
}: {
	readonly store: GridStore;
	readonly initial: string;
}): ReactElement {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [draft, setDraft] = useState(initial);

	useEffect(() => {
		const input = inputRef.current;
		if (input === null) {
			return;
		}
		input.focus();
		input.select();
	}, []);

	const onKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLInputElement>): void => {
			if (event.key === 'Escape') {
				event.stopPropagation();
				store.setEditing(null);
			}
		},
		[store],
	);

	return (
		<input
			ref={inputRef}
			className="cell-editor"
			value={draft}
			onChange={(event) => {
				setDraft(event.target.value);
			}}
			onKeyDown={onKeyDown}
			onBlur={() => {
				store.setEditing(null);
			}}
			aria-label="Cell value"
		/>
	);
}

/**
 * `memo` without a comparator: every prop is a primitive, a stable store reference or a `useCallback` from
 * the row above. That is what lets a scroll mount new rows without re-rendering the ones already on screen.
 */
export const Cell = memo(CellView);
