/**
 * One pointer-capture drag, from the first move that counts to the last one.
 *
 * Every drag in the grid — a column edge, a header, a row handle, the fill handle, a scroll thumb — has the same
 * four traps, and they are the whole reason this is a module instead of five copies of the same six listeners:
 *
 *  1. **A threshold.** Below it, the gesture is a click: a mouse that travelled two pixels between `pointerdown`
 *     and `pointerup` is a click with a shaky hand, and a finger that taps a row handle is a tap. Without the
 *     threshold, nothing stands between a person and a column that resized itself while they were clicking its
 *     header. The default is {@link DRAG_THRESHOLD_PX}; the row-reorder gesture passes the prototype's own 4 px
 *     (`prototype/js/grid.js` §beginRowDrag) and the column reorder its 5 px — the numbers differ on purpose,
 *     because the axis a person is dragging along is the axis that has to be quiet.
 *  2. **Pointer capture.** The drag has to survive the pointer leaving the element, the scroller and the window:
 *     resize a column by dragging past the pane's right edge and the pointer is over something else entirely.
 *     Capture is also what keeps `pointermove` from being a game of whack-a-mole with listeners on ancestors.
 *  3. **Exactly one `onEnd`.** Released, cancelled by the system (`pointercancel`: the OS took the gesture, a
 *     second finger landed, the browser started scrolling), the capture lost, or `Escape` pressed — the owner
 *     hears about it once and never twice. A drag either commits once or not at all.
 *  4. **Extra touch points are ignored.** Only the pointer that began the drag is followed. A second finger
 *     landing during a column resize is not a second resize, and `event.isPrimary === false` is a pointer the
 *     browser itself says is not the one this gesture is about.
 *
 * **`Escape` needs a key listener, and that is the one exception to "no `document` listeners" in this repository.**
 * A drag owns the pointer, not the keyboard: with capture held, key events still go to whatever has focus, which
 * during a header drag may be the grid root and during a thumb drag is wherever the person was last. So the
 * session adds a **capture-phase `keydown` listener for exactly as long as a drag is active** — added on
 * `begin`, removed in `finish`, and never present while nothing is being dragged. {@link DragSession.cancel} is
 * the other half: an owner that already has a keyboard channel can cancel without this listener at all
 * (`cancelOnEscape: false`), which is what the scroll thumbs do.
 */

/** A point in client coordinates — the only two numbers every drag needs from an event. */
export type DragPoint = {
	readonly clientX: number;
	readonly clientY: number;
};

/** How a drag ended. `moved` is false for a click; a cancelled drag must never commit anything. */
export type DragOutcome = {
	/** The pointer travelled past the threshold at least once. */
	readonly moved: boolean;
	/** `Escape`, a `pointercancel` from the system, or a lost capture. */
	readonly cancelled: boolean;
	/** Where the pointer was when the drag ended — its last position while dragging. */
	readonly point: DragPoint;
};

export type DragHandlers = {
	/** The element that takes pointer capture and receives the moves. */
	readonly element: HTMLElement;
	/** Travel, in pixels, before the gesture stops being a click. */
	readonly threshold: number;
	/** Called once, on the move that crossed the threshold. */
	readonly onStart?: (() => void) | undefined;
	/** Called for every move after the threshold, and for the crossing move itself. */
	readonly onMove: (point: DragPoint) => void;
	/** Called exactly once, whatever ended the drag. */
	readonly onEnd: (outcome: DragOutcome) => void;
	/**
	 * Whether `Escape` cancels this drag. `true` by default; the scroll thumbs pass `false` because a thumb drag
	 * has nothing to abandon — it is the scroller's own position, moved continuously.
	 */
	readonly cancelOnEscape?: boolean | undefined;
};

export type DragSession = {
	/**
	 * Starts a drag from a `pointerdown`. `false` means this event is not the drag's (a second pointer, a
	 * non-primary button) and the caller should let it be.
	 */
	readonly begin: (event: PointerEvent) => boolean;
	/** Cancels an active drag, as if `Escape` had been pressed. A no-op when nothing is being dragged. */
	readonly cancel: () => void;
	readonly active: () => boolean;
};

/** The default activation threshold, in pixels: one number for every axis, and 4 px is where a hand stops. */
export const DRAG_THRESHOLD_PX = 4;

/**
 * The same threshold for a **finger**, which is 8 px and not 4.
 *
 * `docs/04` §Touch asks for the drag thresholds to be at least 8 px on touch, and the reason is the gesture
 * beside it: 4 px is a mouse's idea of "still", and a finger resting on glass moves 4 px without being asked.
 * With a 4 px threshold, a tap on a cell in **Select range** mode would start a drag and a scroll would begin a
 * reorder — the two failure modes a person blames the app for rather than the gesture for. `pen` gets the touch
 * number too: a stylus wobbles like a finger, not like a mouse.
 */
export const TOUCH_DRAG_THRESHOLD_PX = 8;

/**
 * The threshold a press gets, by pointer type. A pure function of two numbers so the rule is a unit test rather
 * than a comment, and `Math.max` rather than a lookup table: a gesture that asked for a *larger* threshold than
 * the touch floor (the column reorder, at 5 px, does not) must not be made twitchier by this rule.
 */
export function dragThresholdFor(pointerType: string, base: number): number {
	return pointerType === 'touch' || pointerType === 'pen'
		? Math.max(base, TOUCH_DRAG_THRESHOLD_PX)
		: base;
}

/**
 * Builds a drag session for one element. The element's own `pointerdown` handler calls {@link DragSession.begin};
 * everything else is the session's business until it calls `onEnd`.
 */
export function createDragSession(handlers: DragHandlers): DragSession {
	const { element, threshold, onMove, onEnd } = handlers;
	let active: {
		readonly pointerId: number;
		readonly startX: number;
		readonly startY: number;
		/** Frozen at `begin`: the threshold belongs to the pointer that started the drag, not to the next event. */
		readonly threshold: number;
		moved: boolean;
		point: DragPoint;
	} | null = null;
	let keyTarget: Document | null = null;

	function detach(pointerId: number): void {
		element.removeEventListener('pointermove', onPointerMove);
		element.removeEventListener('pointerup', onPointerUp);
		element.removeEventListener('pointercancel', onPointerCancel);
		element.removeEventListener('lostpointercapture', onLostCapture);
		if (
			typeof element.hasPointerCapture === 'function' &&
			element.hasPointerCapture(pointerId)
		) {
			element.releasePointerCapture(pointerId);
		}
		if (keyTarget !== null) {
			keyTarget.removeEventListener('keydown', onKeyDown, true);
			keyTarget = null;
		}
	}

	/** Ends the drag. Idempotent by construction: the state is cleared before anything is reported. */
	function finish(cancelled: boolean): DragOutcome | null {
		const state = active;
		if (state === null) {
			return null;
		}
		active = null;
		detach(state.pointerId);
		const outcome: DragOutcome = { moved: state.moved, cancelled, point: state.point };
		onEnd(outcome);
		return outcome;
	}

	function onPointerMove(event: PointerEvent): void {
		const state = active;
		if (state === null || event.pointerId !== state.pointerId) {
			return;
		}
		const point: DragPoint = { clientX: event.clientX, clientY: event.clientY };
		if (!state.moved) {
			const travel = Math.max(
				Math.abs(point.clientX - state.startX),
				Math.abs(point.clientY - state.startY),
			);
			if (travel < state.threshold) {
				return;
			}
			state.moved = true;
			handlers.onStart?.();
		}
		state.point = point;
		// The owner's move handler runs *after* the session's own state is updated, so a handler that asks
		// whether the drag has moved gets this event's answer rather than the previous one's.
		onMove(point);
		event.preventDefault();
	}

	function onPointerUp(event: PointerEvent): void {
		const state = active;
		if (state === null || event.pointerId !== state.pointerId) {
			return;
		}
		// The release's own coordinates are the last word on where the pointer is: a browser *usually* sends a final
		// `pointermove` before `pointerup`, but nothing guarantees it, and a resize that committed the width of the
		// previous move would be a pixel or two off every time.
		state.point = { clientX: event.clientX, clientY: event.clientY };
		finish(false);
	}

	function onPointerCancel(event: PointerEvent): void {
		const state = active;
		if (state === null || event.pointerId !== state.pointerId) {
			return;
		}
		// The system took the gesture: the browser started scrolling, or the OS decided the touch was not ours.
		// Never a commit — a cancelled drag that wrote would be the "it moved while I was scrolling" bug.
		finish(true);
	}

	function onLostCapture(event: PointerEvent): void {
		const state = active;
		if (state === null || event.pointerId !== state.pointerId) {
			return;
		}
		// Reached only when capture is lost *without* a `pointerup` (the element was removed, or the browser
		// revoked it). Reported as a cancel for the same reason as `pointercancel`: no commit without a release.
		finish(true);
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (active === null || event.key !== 'Escape') {
			return;
		}
		// The key stops here: a cancelled drag is not also a "close the popover" / "clear the selection" key.
		event.preventDefault();
		event.stopPropagation();
		finish(true);
	}

	return {
		begin(event: PointerEvent): boolean {
			if (active !== null) {
				return false;
			}
			// A second finger, a right-button press and a pointer the browser does not call primary are all
			// "not this gesture".
			if (event.button !== 0 || event.isPrimary === false) {
				return false;
			}
			active = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				threshold: dragThresholdFor(event.pointerType, threshold),
				moved: false,
				point: { clientX: event.clientX, clientY: event.clientY },
			};
			// jsdom does not implement pointer capture; every environment this plugin ships to does (Electron,
			// Chromium, WebKit). Guarded rather than replaced, because without capture the events still arrive on
			// the element while the pointer is over it — which is exactly what the tests exercise.
			if (typeof element.setPointerCapture === 'function') {
				element.setPointerCapture(event.pointerId);
			}
			element.addEventListener('pointermove', onPointerMove);
			element.addEventListener('pointerup', onPointerUp);
			element.addEventListener('pointercancel', onPointerCancel);
			element.addEventListener('lostpointercapture', onLostCapture);
			if (handlers.cancelOnEscape !== false) {
				// `Document`, not `EventTarget`: the document's own `addEventListener` overloads type a `keydown`
				// listener as one that takes a `KeyboardEvent`, which is what this handler is.
				keyTarget = element.ownerDocument;
				keyTarget.addEventListener('keydown', onKeyDown, true);
			}
			return true;
		},

		cancel(): void {
			finish(true);
		},

		active(): boolean {
			return active !== null;
		},
	};
}
