/**
 * Column reorder: drag a header, drop it between two others, one undo step.
 *
 * Two rules come from the prototype and the audit, and both are enforced by the **pure** half of this file so a
 * test can state them without a DOM:
 *
 *  1. **Dropping a column where it already is must do nothing.** Not "move it one to the left and back": nothing —
 *     no command, no undo step, no re-render. The prototype's `moveField` had exactly one bug class here (its
 *     `to -= 1` compensation), and {@link columnDropIndex} answers `null` for both positions that mean "already
 *     there" so the caller cannot get it wrong.
 *  2. **The drop index is stated in the array as it is now, before the lifted column is removed** — which is what
 *     a person means by "between these two", and what a drop indicator is drawing. The command converts it; this
 *     module never guesses at the conversion.
 *
 * The accessible alternative the prompt asks for is the header menu's "Move left"/"Move right" items
 * (`src/grid/menus/headerMenu.ts`), which call the same command with `index ± 1`. A drag is never the only way.
 */
import { createDragSession, DRAG_THRESHOLD_PX } from './dragSession';
import type { DragSession } from './dragSession';
import type { PropertyId } from '../../core/types';

/** Which half of the hovered header the pointer is over. */
export type DropSide = 'before' | 'after';

/**
 * The threshold for a header drag. 5 px, the prototype's own number (`prototype/js/grid.js`
 * §beginColumnDrag): a header click also sorts, so the axis that separates "click" from "drag" is the
 * horizontal one and it can afford to be a little deaf.
 */
export const COLUMN_DRAG_THRESHOLD_PX = 5;

/** The half of an element a point is over, from the element's own box. The caller measures; this decides. */
export function dropSideOf(box: { left: number; width: number }, clientX: number): DropSide {
	return clientX < box.left + box.width / 2 ? 'before' : 'after';
}

/**
 * Where a column would land, as an index into `order` **as it is now**, or `null` when the drop is a no-op.
 *
 * `null` covers three cases that all mean "nothing to do": the pointer is not over a column, the hovered column
 * *is* the dragged one, and the insertion point is one of the two positions the column already occupies (its own
 * index, or the index just after it).
 */
export function columnDropIndex(
	order: readonly PropertyId[],
	from: PropertyId,
	over: PropertyId | null,
	side: DropSide,
): number | null {
	if (over === null || over === from) {
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

export type ColumnReorderPort = {
	/** The header cell that was grabbed. It takes capture and is the element the moves arrive on. */
	readonly element: HTMLElement;
	readonly fieldId: PropertyId;
	readonly event: PointerEvent;
	/** The render order as it is at the start of the drag. */
	readonly order: readonly PropertyId[];
	/** The column under the pointer, or `null` when the pointer is outside the header lane. */
	readonly columnAt: (
		clientX: number,
		clientY: number,
	) => { fieldId: PropertyId; box: { left: number; width: number } } | null;
	/** Shows the drop indicator (`'before'`/`'after'` of a column), or clears it with `null`. */
	readonly onIndicator: (target: { fieldId: PropertyId; side: DropSide } | null) => void;
	/** The one command, on release, and only when the drop changes the order. */
	readonly onCommit: (fieldId: PropertyId, to: number) => void;
	/**
	 * A press that never crossed the threshold: a **click on the header**, which is the prototype's
	 * `onHeaderClick` — it opens the header menu at the pointer (`prototype/js/harness.js`:32). The event is the
	 * original `pointerdown`, whose coordinates are still where the person pressed.
	 */
	readonly onClick?: ((event: PointerEvent) => void) | undefined;
};

/**
 * Starts a header drag. Below the threshold nothing at all happens — no indicator, no class, no state — which is
 * what lets the same pointerdown also be a click that sorts: the caller decides that in `onEnd` via
 * `outcome.moved === false` (see `GridView` §onHeaderPointerUp).
 */
export function beginColumnReorder(port: ColumnReorderPort): DragSession | null {
	const { element, fieldId, event, order, columnAt, onIndicator, onCommit, onClick } = port;
	let target: { fieldId: PropertyId; side: DropSide } | null = null;
	const session = createDragSession({
		element,
		threshold: COLUMN_DRAG_THRESHOLD_PX,
		onStart: () => {
			element.classList.add('is-dragging');
		},
		onMove: (point) => {
			const over = columnAt(point.clientX, point.clientY);
			if (over === null || over.fieldId === fieldId) {
				if (target !== null) {
					target = null;
					onIndicator(null);
				}
				return;
			}
			const side = dropSideOf(over.box, point.clientX);
			if (target !== null && target.fieldId === over.fieldId && target.side === side) {
				return;
			}
			target = { fieldId: over.fieldId, side };
			onIndicator(target);
		},
		onEnd: (outcome) => {
			element.classList.remove('is-dragging');
			onIndicator(null);
			if (!outcome.moved && !outcome.cancelled) {
				onClick?.(event);
				return;
			}
			if (outcome.cancelled || target === null) {
				return;
			}
			const to = columnDropIndex(order, fieldId, target.fieldId, target.side);
			if (to === null) {
				return;
			}
			onCommit(fieldId, to);
		},
	});
	return session.begin(event) ? session : null;
}

/** Re-exported so callers do not import two modules to name the same threshold. */
export { DRAG_THRESHOLD_PX };
