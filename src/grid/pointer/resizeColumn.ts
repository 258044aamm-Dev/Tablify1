/**
 * Column resize: the edge handle, the live width, and the one write at the end.
 *
 * The gesture is the prototype's (`prototype/js/grid.js` §beginColumnResize), with the two things the audit and
 * `docs/04` both asked for made structural:
 *
 *  · **The width changes live, the store does not.** While the pointer is down the header and the column's cells
 *    are written to directly (`onPreview`), exactly as the scroll frame writes a transform: 60 `resizeColumn`
 *    commands for one drag would be 60 undo steps, and the drag is one gesture. The store hears about it **once**,
 *    in `onCommit`, on release.
 *  · **A minimum width, and no maximum.** `MIN_COLUMN_WIDTH` is 60 px (the prototype's own floor): narrower than
 *    that and the header's name has nowhere to go and the resize handle is wider than the column it resizes. There
 *    is deliberately no upper clamp on a *drag* — a person dragging a column wide is making a decision — while
 *    {@link autoFitWidth} caps itself at {@link MAX_AUTOFIT_WIDTH}, because an estimate should not eat the pane.
 *
 * `autoFitWidth` is arithmetic on character counts, which is honest about being an estimate: `docs/04` §The layout
 * contract keeps text measurement out of the render path, and a canvas measure per column on a double-click is
 * step 21's to add if the numbers turn out wrong. The two constants below are its coefficients (`8 px`/char for a
 * header, `7.4 px`/char for a value, `44 px`/`26 px` of padding), and they are the prototype's, so the number a
 * person gets matches the number the prototype showed them.
 */
import { createDragSession } from './dragSession';
import type { DragSession } from './dragSession';
import type { PropertyId } from '../../core/types';

/** The narrowest a column may be dragged: the prototype's floor, kept because it is also the handle's comfort. */
export const MIN_COLUMN_WIDTH = 60;

/** The widest an auto-fit may go — an estimate should not take the whole pane. */
export const MAX_AUTOFIT_WIDTH = 520;

/** The narrowest an auto-fit may go, so double-clicking a one-letter column does not make it a sliver. */
export const MIN_AUTOFIT_WIDTH = 90;

/** Per-character width estimate for a header's name (semibold, so a little wider than a value). */
const HEADER_CHAR_PX = 8;
/** Padding around a header's name: the sort affordance and the resize handle live in it. */
const HEADER_PADDING_PX = 44;
/** Per-character width estimate for a cell's text. */
const CELL_CHAR_PX = 7.4;
/** Padding around a cell's text: the cell's own inline padding plus a little air. */
const CELL_PADDING_PX = 26;

/** Rounds and floors a dragged width. `NaN` (a pointer with no `clientX`) is the current floor, never `NaN`. */
export function clampColumnWidth(width: number): number {
	if (!Number.isFinite(width)) {
		return MIN_COLUMN_WIDTH;
	}
	return Math.max(MIN_COLUMN_WIDTH, Math.round(width));
}

/** The width a drag of `deltaX` pixels from `startWidth` asks for. */
export function draggedWidth(startWidth: number, deltaX: number): number {
	return clampColumnWidth(startWidth + deltaX);
}

/**
 * The width that makes a column fit its widest visible value — a double-click on the edge.
 *
 * The header's name counts too: a column whose values are all `1` but whose header says "Estimated remaining
 * effort" is exactly the column a person double-clicks, and fitting it to the values would be useless.
 */
export function autoFitWidth(header: string, values: readonly string[]): number {
	let widest = header.length * HEADER_CHAR_PX + HEADER_PADDING_PX;
	for (const value of values) {
		widest = Math.max(widest, value.length * CELL_CHAR_PX + CELL_PADDING_PX);
	}
	return Math.min(MAX_AUTOFIT_WIDTH, Math.max(MIN_AUTOFIT_WIDTH, Math.round(widest)));
}

export type ColumnResizePort = {
	/** The handle element the pointer grabbed. It takes capture and hears the moves. */
	readonly element: HTMLElement;
	readonly fieldId: PropertyId;
	/** The width the column had when the drag began. */
	readonly startWidth: number;
	readonly event: PointerEvent;
	/** The live width, applied to the DOM and **not** to the store. Called for every move past the threshold. */
	readonly onPreview: (fieldId: PropertyId, width: number) => void;
	/** The one write, on release, and only when the width actually changed. */
	readonly onCommit: (fieldId: PropertyId, width: number) => void;
	/** Undoes the preview. Called only when the drag was cancelled. */
	readonly onCancel: () => void;
};

/** The drag threshold for a resize: 4 px, the same quiet-hand threshold every gesture in the grid uses. */
export const RESIZE_THRESHOLD_PX = 4;

/**
 * Starts a resize. Returns the session so a caller can cancel it (a view closing mid-drag, a test): the session
 * is otherwise self-contained and reports through the port.
 */
export function beginColumnResize(port: ColumnResizePort): DragSession | null {
	const { element, fieldId, startWidth, event, onPreview, onCommit, onCancel } = port;
	const session = createDragSession({
		element,
		threshold: RESIZE_THRESHOLD_PX,
		onStart: () => {
			// The pointer stays a resize arrow for the whole gesture: without this the cursor flickers back to the
			// header's own as soon as the pointer leaves the 6 px handle.
			element.classList.add('is-resizing');
		},
		onMove: (point) => {
			onPreview(fieldId, draggedWidth(startWidth, point.clientX - event.clientX));
		},
		onEnd: (outcome) => {
			element.classList.remove('is-resizing');
			if (outcome.cancelled) {
				onCancel();
				return;
			}
			const width = draggedWidth(startWidth, outcome.point.clientX - event.clientX);
			// A click on the edge moved nothing: no command, no undo step, no "Resize column to 240px" for a
			// gesture that was a click. The threshold already makes this rare; this makes it impossible.
			if (!outcome.moved || width === startWidth) {
				onCancel();
				return;
			}
			onCommit(fieldId, width);
		},
	});
	// `null` when the session refused the event (a second pointer, a non-primary button): the caller then leaves
	// the event alone, which is what keeps a two-finger gesture from launching two resizes.
	return session.begin(event) ? session : null;
}
