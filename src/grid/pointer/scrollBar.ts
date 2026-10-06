/**
 * The two docked scroll thumbs: drag one, and the scroller follows.
 *
 * The grid draws its own bars (`.tablify-hbar` / `.tablify-vbar`) because the platform's are inside the scroller
 * and would scroll away with the rows, and because a 5,000-row view needs a handle a finger can find. `GridView`
 * already *places* them (`placeThumb`, driven by the scroll frame); this module is the other half — the drag.
 *
 * The arithmetic is the prototype's (`prototype/js/grid.js` §beginBarDrag), which is the one part of the prototype
 * worth copying verbatim because it is pure proportion and easy to get subtly wrong:
 *
 *   `next = startOffset + (delta / (trackLength - thumbLength)) × maxOffset`
 *
 * The denominator is the thumb's **travel**, not the track: a person dragging the thumb to the far end expects
 * `maxOffset`, and dividing by the track length instead would leave the last 15 % of the table unreachable — the
 * classic "I cannot scroll to the bottom of a dialog" bug, in a grid.
 *
 * `cancelOnEscape` is `false` here, and that is deliberate: a thumb drag has nothing to abandon. There is no draft
 * and no command — the scroller's position **is** the state, and refusing to move it back on `Escape` would be a
 * second, invisible undo stack for something nobody expects to undo. The session can still be cancelled
 * programmatically (`GridView` does on unmount), which is why the port returns the session.
 */
import { createDragSession, DRAG_THRESHOLD_PX } from './dragSession';
import type { DragSession } from './dragSession';

/** The thumb's own geometry, and the offset range it can express. */
export type ThumbGeometry = {
	/** The thumb's length along the track, in pixels. */
	readonly size: number;
	/** How far the thumb may travel: `trackLength - size`, floored at 0. */
	readonly travel: number;
	/** The scroller's own maximum offset on this axis. */
	readonly maxOffset: number;
};

/**
 * The thumb's geometry, given the numbers the DOM reports. A content that fits its viewport has `maxOffset === 0`
 * and a full-length thumb — no travel, nothing to drag, which is the correct answer rather than a disabled bar.
 */
export function thumbGeometry(input: {
	readonly trackLength: number;
	readonly viewLength: number;
	readonly contentLength: number;
	/** The floor `GridView` paints with: a huge table still needs something to grab. */
	readonly minSize?: number | undefined;
}): ThumbGeometry {
	const { trackLength, viewLength, contentLength } = input;
	const minSize = input.minSize ?? 12;
	const maxOffset = Math.max(0, contentLength - viewLength);
	if (trackLength <= 0 || contentLength <= 0) {
		return { size: Math.max(minSize, trackLength), travel: 0, maxOffset };
	}
	const ratio = Math.min(1, Math.max(0.05, viewLength / contentLength));
	const size = Math.min(trackLength, Math.max(minSize, Math.round(trackLength * ratio)));
	return { size, travel: Math.max(0, trackLength - size), maxOffset };
}

/**
 * Where the scroller goes for a drag that has moved `delta` pixels from where it began.
 *
 * Clamped to `[0, maxOffset]`, so a drag past either end parks at the end. `delta` of 0 is the start offset, and a
 * zero-travel thumb (nothing to scroll) is always offset 0.
 */
export function offsetForThumbDrag(input: {
	readonly startOffset: number;
	readonly delta: number;
	readonly geometry: ThumbGeometry;
}): number {
	const { startOffset, delta, geometry } = input;
	if (geometry.travel <= 0 || geometry.maxOffset <= 0) {
		return 0;
	}
	const next = startOffset + (delta / geometry.travel) * geometry.maxOffset;
	return Math.min(geometry.maxOffset, Math.max(0, next));
}

export type ScrollBarPort = {
	/** The thumb element: capture, moves, `is-dragging`. */
	readonly element: HTMLElement;
	readonly event: PointerEvent;
	/** Which axis this thumb belongs to. The two bars differ only here. */
	readonly axis: 'x' | 'y';
	readonly geometry: ThumbGeometry;
	/** The scroller's offset on this axis when the drag began. */
	readonly startOffset: number;
	/** Moves the scroller: `scroller.scrollTop`/`scrollLeft` and the frame's own `sync` call, per move. */
	readonly onScroll: (offset: number) => void;
};

/** Starts a thumb drag. Returns the session so a caller can cancel it on unmount. */
export function beginScrollDrag(port: ScrollBarPort): DragSession | null {
	const { element, event, axis, geometry, startOffset, onScroll } = port;
	const horizontal = axis === 'x';
	const start = horizontal ? event.clientX : event.clientY;
	const session = createDragSession({
		element,
		// The track's own click-to-page is a separate gesture (`onTrackPointerDown`); the thumb needs the same
		// quiet-hand threshold, or a click on a fat thumb scrolls by whatever the hand jittered.
		threshold: DRAG_THRESHOLD_PX,
		cancelOnEscape: false,
		onStart: () => {
			element.classList.add('is-dragging');
		},
		onMove: (point) => {
			onScroll(
				offsetForThumbDrag({
					startOffset,
					delta: (horizontal ? point.clientX : point.clientY) - start,
					geometry,
				}),
			);
		},
		onEnd: () => {
			element.classList.remove('is-dragging');
		},
	});
	return session.begin(event) ? session : null;
}

/**
 * Clicking the track beside the thumb pages by one viewport, towards the click — the prototype's `trackPage`, and
 * the behaviour every scroll bar in every application has. Returns the offset the click asks for, or `null` when
 * the click was *on* the thumb (which starts a drag instead).
 */
export function offsetForTrackClick(input: {
	readonly clientPos: number;
	readonly thumbStart: number;
	readonly thumbEnd: number;
	readonly offset: number;
	readonly maxOffset: number;
	readonly viewLength: number;
}): number | null {
	const { clientPos, thumbStart, thumbEnd, offset, maxOffset, viewLength } = input;
	if (clientPos >= thumbStart && clientPos <= thumbEnd) {
		return null;
	}
	const delta = clientPos < thumbStart ? -viewLength : viewLength;
	return Math.min(maxOffset, Math.max(0, offset + delta));
}
