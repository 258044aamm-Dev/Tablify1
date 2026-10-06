/**
 * The fill handle: drag the corner of the selection, see what will be written, release once.
 *
 * **Copy, never series inference.** `docs/01` says the fill pair *copies* the first row/column of the range, and
 * the prompt repeats it — *"no series inference — the doc says copy, so copy"*. So `1, 2, 3` dragged down produces
 * `3, 3, 3`, not `4, 5, 6`. That is not a missing feature: a spreadsheet's series detection is a guess about
 * intent, and this grid's one non-negotiable rule is that a write never guesses.
 *
 * The gesture has three parts, and the middle one is why this is its own module rather than a call to
 * `commands.fillDown`:
 *
 *  1. **The plan.** {@link fillPlan} answers, for a selection and a hovered cell, which direction the drag is
 *     going and **exactly which cells would be written**. It is pure — it reads values through a callback — so the
 *     preview and the commit are the same function, and "what the preview showed" cannot drift from "what was
 *     written".
 *  2. **The preview.** While the pointer moves, the caller paints the plan's target range (the `.is-fill-preview`
 *     class on those cells). No store write, no React state per move: the class goes on the DOM, exactly like a
 *     scroll transform.
 *  3. **The commit.** One `setCells` with every write in the plan, so the whole drag is **one undo step** — the
 *     property the prompt asks to be asserted.
 */
import { cellPosition, cellsOf, normalize } from '../../core/selection/range';
import type { Range, RangeOrder } from '../../core/selection/range';
import { createDragSession } from './dragSession';
import type { DragSession } from './dragSession';
import type { CellRef, RowId } from '../../core/ops/types';
import type { CellValue, PropertyId } from '../../core/types';

/** A cell write, as the fill plans it — the same shape `setCells` takes. */
export type FillWrite = {
	readonly filePath: RowId;
	readonly fieldId: PropertyId;
	readonly value: CellValue;
};

/** What a fill would do: which way, where it lands, and every value it would write. */
export type FillPlan = {
	/** The axis the drag chose. `down` copies the range's top row; `right` copies its left column. */
	readonly direction: 'down' | 'right';
	/** The selection including the extension — what the preview paints. */
	readonly target: Range;
	/** Only the cells *outside* the selection: the ones the release would actually write. */
	readonly writes: readonly FillWrite[];
};

/** The plan a dragged fill handle describes, or `null` when the drag points nowhere useful. */
export function fillPlan(input: {
	readonly selection: Range;
	readonly order: RangeOrder;
	readonly over: CellRef | null;
	readonly valueOf: (filePath: RowId, fieldId: PropertyId) => CellValue;
}): FillPlan | null {
	const { selection, order, over, valueOf } = input;
	const bounds = normalize(selection, order);
	const at = over === null ? null : cellPosition(over, order);
	if (bounds === null || at === null) {
		return null;
	}
	// The handle is at the bottom-right corner; a drag goes further down or further right. A drag *back into* the
	// selection is not a fill, and neither is a drag that leaves the grid.
	const down = at.row - bounds.bottom;
	const right = at.field - bounds.right;
	if (down <= 0 && right <= 0) {
		return null;
	}
	// The dominant axis decides. `down` wins ties because it is the gesture a person makes first, and a tie means
	// the pointer is on the diagonal where either answer draws the same rectangle.
	const direction: 'down' | 'right' = down >= right ? 'down' : 'right';
	// `focus` has to be a real cell, and dragging past the last row/column means "to the edge": the arithmetic
	// clamps to what the view actually has rather than inventing an index.
	const focus: CellRef = {
		filePath:
			order.rows[
				Math.min(
					order.rows.length - 1,
					direction === 'down' ? bounds.bottom + down : bounds.bottom,
				)
			] ?? '',
		fieldId:
			order.fields[
				Math.min(
					order.fields.length - 1,
					direction === 'right' ? bounds.right + right : bounds.right,
				)
			] ?? '',
	};
	if (focus.filePath === '' || focus.fieldId === '') {
		return null;
	}
	const extended: Range = { anchor: selection.anchor, focus };

	const extension = cellsOf(extended, order).filter((cell) => {
		const position = cellPosition(cell, order);
		return position !== null && (position.row > bounds.bottom || position.field > bounds.right);
	});
	if (extension.length === 0) {
		return null;
	}

	const writes: FillWrite[] = [];
	if (direction === 'down') {
		const sourceRow = order.rows[bounds.top];
		if (sourceRow === undefined) {
			return null;
		}
		for (const cell of extension) {
			const position = cellPosition(cell, order);
			const fieldId = position === null ? undefined : order.fields[position.field];
			if (fieldId === undefined) {
				continue;
			}
			writes.push({ filePath: cell.filePath, fieldId, value: valueOf(sourceRow, fieldId) });
		}
	} else {
		const sourceField = order.fields[bounds.left];
		if (sourceField === undefined) {
			return null;
		}
		for (const cell of extension) {
			writes.push({
				filePath: cell.filePath,
				fieldId: cell.fieldId,
				value: valueOf(cell.filePath, sourceField),
			});
		}
	}
	return { direction, target: extended, writes };
}

export type FillDragPort = {
	/** The handle element — the small square at the selection's corner. */
	readonly element: HTMLElement;
	readonly event: PointerEvent;
	readonly selection: Range;
	readonly order: RangeOrder;
	/** The cell under the pointer, or `null` outside the grid. */
	readonly cellAt: (clientX: number, clientY: number) => CellRef | null;
	readonly valueOf: (filePath: RowId, fieldId: PropertyId) => CellValue;
	/** Paints the preview: the cells the plan would write, or `null` to clear it. */
	readonly onPreview: (writes: readonly FillWrite[] | null) => void;
	/** The one write, on release. The plan is handed over whole so the commit cannot disagree with the preview. */
	readonly onCommit: (plan: FillPlan) => void;
};

/** The fill handle's threshold: 4 px, like every other gesture. */
export const FILL_THRESHOLD_PX = 4;

/** Starts a fill drag from the handle. */
export function beginFillDrag(port: FillDragPort): DragSession | null {
	const { element, event, selection, order, cellAt, valueOf, onPreview, onCommit } = port;
	let plan: FillPlan | null = null;
	const session = createDragSession({
		element,
		threshold: FILL_THRESHOLD_PX,
		onStart: () => {
			element.classList.add('is-dragging');
		},
		onMove: (point) => {
			const next = fillPlan({
				selection,
				order,
				over: cellAt(point.clientX, point.clientY),
				valueOf,
			});
			if (next === null) {
				if (plan !== null) {
					plan = null;
					onPreview(null);
				}
				return;
			}
			plan = next;
			onPreview(next.writes);
		},
		onEnd: (outcome) => {
			element.classList.remove('is-dragging');
			onPreview(null);
			if (!outcome.moved || outcome.cancelled || plan === null || plan.writes.length === 0) {
				return;
			}
			onCommit(plan);
		},
	});
	return session.begin(event) ? session : null;
}
