/**
 * Dragging a range: press on a cell, move, and the selection follows — including past the edge of the pane,
 * which is what makes a drag a way to select more than a screenful.
 *
 * The gesture is deliberately **not** built on the pointer-capture session in `src/grid/pointer/` (step 20's
 * `dragSession`), and the reason is the scroll: that session's contract is "the element under the pointer moves",
 * so it captures the pointer and reads deltas. A range drag instead asks *what is under the pointer* on every
 * move, because the answer changes when the grid scrolls under a finger that has not moved — and a captured
 * pointer does not re-hit-test. So this is the other shape, with the same three endings (up, cancel, blur) and
 * the same rule that a gesture reports exactly once.
 *
 * ## What it does not do
 *
 * It does not decide what a range *is* (the store's `Range` and `core/selection/range` do), it does not move the
 * active cell (the cell's own `pointerdown` already did), and it does not run on a touch device unless the
 * person turned **Select range** on: on a phone a drag on the grid is how you scroll, and `docs/04` §Touch is
 * explicit that range selection there is *"an explicit toolbar toggle (a drag would fight scrolling), then drag
 * sets the range"*. The caller enforces that; this file only knows how to drag.
 */
import { useCallback, useEffect, useState } from 'react';

/** How close to the edge a drag has to be before the grid starts scrolling itself. */
export const EDGE_PX = 36;

/** How far one auto-scroll frame moves. 24 px at 60 fps is ~1,400 px/s: fast enough to cross a table. */
export const STEP_PX = 24;

export type Point = { readonly x: number; readonly y: number };

export type Box = {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
};

/** What one auto-scroll frame should do, in CSS px. Pure, so it can be asserted without a browser. */
export function edgeScrollStep(
	box: Box,
	point: Point,
	edge: number = EDGE_PX,
	step: number = STEP_PX,
): { readonly dx: number; readonly dy: number } {
	// Inside the edge band on an axis → move that axis. The step shrinks as the pointer gets closer to the edge,
	// which is what keeps a drag near the boundary from overshooting the row a person is aiming at.
	const axis = (position: number, low: number, high: number): number => {
		if (position < low + edge) {
			const closeness = (low + edge - position) / edge;
			return -Math.round(step * Math.min(1, closeness));
		}
		if (position > high - edge) {
			const closeness = (position - (high - edge)) / edge;
			return Math.round(step * Math.min(1, closeness));
		}
		return 0;
	};
	return { dx: axis(point.x, box.left, box.right), dy: axis(point.y, box.top, box.bottom) };
}

export type RangeDragOptions = {
	readonly doc: Document;
	/** The one scroller: what auto-scroll scrolls, and the box the edge band is measured from. */
	readonly scroller: HTMLElement;
	/** "Which cell is at this point?" — `hitTest.cellAtPoint` in the product, a two-line function in a test. */
	readonly cellAt: (
		x: number,
		y: number,
	) => { readonly filePath: string; readonly fieldId: string } | null;
	/** Called with the cell the pointer is over, whenever that answer changes. */
	readonly onExtend: (ref: { readonly filePath: string; readonly fieldId: string }) => void;
	readonly edge?: number;
	readonly step?: number;
	/** Frame scheduling, injectable so a test can run the loop deterministically. */
	readonly schedule?: (callback: () => void) => number;
	readonly cancel?: (handle: number) => void;
};

/** A drag in progress: end it by calling `stop()`. Stopping twice is harmless and reports once. */
export type RangeDrag = { readonly stop: () => void };

/**
 * Starts a range drag. The caller has already moved the active cell (the cell's own `pointerdown`), so this
 * begins from the second cell the pointer touches — which is exactly what a drag means.
 */
export function startRangeDrag(options: RangeDragOptions): RangeDrag {
	const { doc, scroller, cellAt, onExtend } = options;
	const edge = options.edge ?? EDGE_PX;
	const step = options.step ?? STEP_PX;
	const schedule =
		options.schedule ??
		((callback: () => void): number => window.requestAnimationFrame(callback));
	const cancel =
		options.cancel ?? ((handle: number): void => window.cancelAnimationFrame(handle));
	let last: Point | null = null;
	let lastKey = '';
	let frame: number | null = null;
	let stopped = false;

	const report = (x: number, y: number): void => {
		const ref = cellAt(x, y);
		if (ref === null) {
			return;
		}
		const key = `${ref.filePath}::${ref.fieldId}`;
		if (key === lastKey) {
			return;
		}
		lastKey = key;
		onExtend(ref);
	};

	/**
	 * The auto-scroll loop. One frame at a time, scheduled only while the pointer is in an edge band: a timer
	 * that ran for the whole drag would keep scrolling after the finger stopped, and one that never ran would
	 * make "drag past the bottom" select nothing new.
	 */
	const tick = (): void => {
		frame = null;
		if (stopped || last === null) {
			return;
		}
		const rect = scroller.getBoundingClientRect();
		const { dx, dy } = edgeScrollStep(
			{ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
			last,
			edge,
			step,
		);
		if (dx === 0 && dy === 0) {
			return;
		}
		const beforeLeft = scroller.scrollLeft;
		const beforeTop = scroller.scrollTop;
		scroller.scrollLeft += dx;
		scroller.scrollTop += dy;
		// At the end of the table there is nothing left to scroll: stop the loop rather than spinning frames.
		if (scroller.scrollLeft === beforeLeft && scroller.scrollTop === beforeTop) {
			return;
		}
		report(last.x, last.y);
		frame = schedule(tick);
	};

	const onMove = (event: PointerEvent): void => {
		if (stopped) {
			return;
		}
		last = { x: event.clientX, y: event.clientY };
		report(event.clientX, event.clientY);
		const rect = scroller.getBoundingClientRect();
		const within =
			event.clientX < rect.left + edge ||
			event.clientX > rect.right - edge ||
			event.clientY < rect.top + edge ||
			event.clientY > rect.bottom - edge;
		if (within && frame === null) {
			frame = schedule(tick);
		}
	};

	const onEnd = (): void => {
		stop();
	};

	function stop(): void {
		if (stopped) {
			return;
		}
		stopped = true;
		if (frame !== null) {
			cancel(frame);
			frame = null;
		}
		doc.removeEventListener('pointermove', onMove);
		doc.removeEventListener('pointerup', onEnd);
		doc.removeEventListener('pointercancel', onEnd);
		doc.removeEventListener('blur', onEnd);
	}

	doc.addEventListener('pointermove', onMove);
	doc.addEventListener('pointerup', onEnd);
	doc.addEventListener('pointercancel', onEnd);
	doc.addEventListener('blur', onEnd);
	return { stop };
}

/**
 * Whether the pointer is coarse — i.e. whether this is a device where a drag on the grid means "scroll".
 *
 * `docs/04` §Touch is the reason this exists as a *query* rather than as a device check: the same build runs on
 * a laptop with a touchscreen, where a mouse drag selects and a finger drag scrolls, and only the media query
 * can tell the two apart. The listener is attached only when the window can report the query at all, and the
 * initial value is read synchronously so the first frame is not wrong.
 */
export function useCoarsePointer(): boolean {
	const read = useCallback((): boolean => {
		if (typeof window.matchMedia !== 'function') {
			return false;
		}
		return window.matchMedia('(pointer: coarse)').matches;
	}, []);
	const [coarse, setCoarse] = useState<boolean>(read);
	useEffect(() => {
		if (typeof window.matchMedia !== 'function') {
			return undefined;
		}
		const query = window.matchMedia('(pointer: coarse)');
		const onChange = (): void => {
			setCoarse(query.matches);
		};
		onChange();
		query.addEventListener('change', onChange);
		return () => {
			query.removeEventListener('change', onChange);
		};
	}, []);
	return coarse;
}
