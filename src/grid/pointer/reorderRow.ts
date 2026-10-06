/**
 * Row reorder: drag the gutter handle, drop it above or below another row, one undo step.
 *
 * The audit's finding is the reason the two entry points are separate functions here. The prototype's row drag
 * listened for `.cell, .gutter, .grid-row` on drop and then looked for a `[data-r]` ancestor — so **the gutter was
 * a drop target**, which is right (the row-number column is the widest, easiest part of a row to aim at) **and**
 * it meant a drop over the frozen gutter resolved through a different ancestor chain than a drop over a cell.
 * {@link rowDropIndex} takes the hovered row id and the side, never the element: whatever the pointer was over,
 * the answer is the same, and the caller's job is only to say which row that was.
 *
 * Like the column case, the interesting property is `null`: a drop that would not change the order writes nothing,
 * and a drop outside the lane writes nothing at all.
 *
 * The prototype's row threshold is 4 px (`prototype/js/grid.js` §beginRowDrag: `Math.abs(ev.clientY - startY) < 4`
 * selects the row instead of moving it). That click-select behaviour is `GridView`'s: it acts on
 * `outcome.moved === false`.
 */
import { createDragSession } from './dragSession';
import type { DragSession } from './dragSession';
import type { RowId } from '../../core/ops/types';

/** The row-reorder threshold: the prototype's 4 px, which is also the grid's default drag threshold. */
export const ROW_DRAG_THRESHOLD_PX = 4;

/**
 * Where a row would land, as an index into `order` **as it is now**, or `null` when the drop is a no-op.
 *
 * `over === null` is "outside the lane": the gesture is abandoned rather than guessed at, which is the audit's
 * other finding — a drop in the toolbar used to move the row to the end of the table.
 */
export function rowDropIndex(
	order: readonly RowId[],
	from: RowId,
	over: RowId | null,
	side: 'before' | 'after',
): number | null {
	if (over === null) {
		return null;
	}
	const at = order.indexOf(over);
	const fromAt = order.indexOf(from);
	if (at === -1 || fromAt === -1) {
		return null;
	}
	const insertAt = side === 'before' ? at : at + 1;
	if (insertAt === fromAt || insertAt === fromAt + 1) {
		return null;
	}
	return insertAt;
}

export type RowReorderPort = {
	/** The gutter handle that was grabbed. */
	readonly element: HTMLElement;
	readonly filePath: RowId;
	readonly event: PointerEvent;
	/** The row order as it is at the start of the drag. */
	readonly order: readonly RowId[];
	/**
	 * The row under the pointer and which half of it, or `null` outside the row lane.
	 *
	 * `half` is `'before'` for the upper half and `'after'` for the lower one, which is what the audit's "insertion
	 * line follows the pointer's half, not the row" asked for.
	 */
	readonly rowAt: (
		clientX: number,
		clientY: number,
	) => { filePath: RowId; half: 'before' | 'after' } | null;
	/** The insertion line, or `null` to clear it. */
	readonly onIndicator: (target: { filePath: RowId; half: 'before' | 'after' } | null) => void;
	/** Told once when the drag starts, with the label the ghost/overlay should show. */
	readonly onStart?: (() => void) | undefined;
	readonly onCommit: (filePath: RowId, to: number) => void;
	/**
	 * A press that never moved: a **click on the row handle**, which selects the row (the prototype's
	 * `selectRowId` — `prototype/js/grid.js` §beginRowDrag, *"`if (Math.abs(ev.clientY - startY) < 4) {
	 * selectRowId(rowId); return; }`"*). The grid's pointer-down on the gutter already did that; this keeps the
	 * gesture honest when the press arrives on the handle itself.
	 */
	readonly onClick?: ((filePath: RowId) => void) | undefined;
};

/** Starts a gutter drag. */
export function beginRowReorder(port: RowReorderPort): DragSession | null {
	const { element, filePath, event, order, rowAt, onIndicator, onCommit, onStart, onClick } =
		port;
	let target: { filePath: RowId; half: 'before' | 'after' } | null = null;
	const session = createDragSession({
		element,
		threshold: ROW_DRAG_THRESHOLD_PX,
		onStart: () => {
			element.classList.add('is-dragging');
			onStart?.();
		},
		onMove: (point) => {
			const over = rowAt(point.clientX, point.clientY);
			if (over === null) {
				if (target !== null) {
					target = null;
					onIndicator(null);
				}
				return;
			}
			if (target !== null && target.filePath === over.filePath && target.half === over.half) {
				return;
			}
			target = over;
			onIndicator(over);
		},
		onEnd: (outcome) => {
			element.classList.remove('is-dragging');
			onIndicator(null);
			if (!outcome.moved && !outcome.cancelled) {
				onClick?.(filePath);
				return;
			}
			if (outcome.cancelled || target === null) {
				return;
			}
			const to = rowDropIndex(order, filePath, target.filePath, target.half);
			if (to === null) {
				return;
			}
			onCommit(filePath, to);
		},
	});
	return session.begin(event) ? session : null;
}
