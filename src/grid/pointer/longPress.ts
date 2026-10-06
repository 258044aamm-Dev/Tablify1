/**
 * Long-press: **the touch path to the context menu, with the threshold that was missing.**
 *
 * `docs/04` §Touch: *"Long-press (≈500 ms) with visual feedback before opening; also reachable from a toolbar
 * button, since long-press is not discoverable."* `docs/01` §touch lists the gesture as the touch twin of
 * right-click. Until step 27 the grid had the *menu* but not the gesture: every press on a phone went to the
 * range-selection branch and nothing ever fired a `contextmenu`, so the whole menu inventory was unreachable on the
 * device it is most needed on. This module is the gesture, and it is a module rather than four lines inside the
 * pointer handler because three of its rules are easy to get wrong and each one is a bug a person would feel:
 *
 *  1. **A mouse never long-presses.** A mouse press *is* the start of a drag or a click; a 500 ms hold with a
 *     mouse means "I am thinking", and opening a menu then would be hostile. Only `touch` and `pen` start a
 *     press, which is also what keeps every existing desktop test path byte-for-byte unchanged.
 *  2. **Movement cancels it.** The other thing a finger does is scroll. A press that travels more than
 *     {@link LONG_PRESS_SLOP_PX} is a scroll, and the timer is cleared — no menu, no delay, and the scroller
 *     keeps the gesture. The slop is 8 px because that is the same number the touch drag threshold uses
 *     ({@link TOUCH_DRAG_THRESHOLD_PX}); a gesture layer where "a scroll" means 8 px and "a long press" means
 *     4 px would fight itself.
 *  3. **It is a press, not a release.** The menu opens **while the finger is still down** (that is what "with
 *     visual feedback before opening" means), and `end()` reports whether it fired, so a caller that has a
 *     click-to-act path can swallow that one release. (This grid has none: a cell is selected on press, so the
 *     release after a long press has nothing left to do. The flag exists so a caller with such a path does not have
 *     to reimplement the state machine to find out.)
 *
 * The visual feedback is one attribute on the pressed element (`data-touch-press`), applied by the caller's
 * `onPressChange` — the same "the gesture writes the DOM, the store hears about it once" rule the resize drag
 * follows (`docs/04` §The layout contract), so a 500 ms hold costs zero React renders.
 */

/** How long a finger must rest before the press counts (`docs/04` §Touch: "≈500 ms"). */
export const LONG_PRESS_MS = 500;

/**
 * How far a press may travel and still be a press. **8 px**, the same number as the touch drag threshold: a
 * gesture layer where two "did the finger move?" answers disagree would cancel a press with one rule and start a
 * drag with the other on the same event.
 */
export const LONG_PRESS_SLOP_PX = 8;

/** A point in client coordinates, the only thing the trigger needs to place a menu. */
export type PressPoint = { readonly x: number; readonly y: number };

/** What a long press reports when it fires: where, on which element, and the press that caused it. */
export type LongPressTrigger = {
	readonly point: PressPoint;
	/** The element the press began on, as it was at `pointerdown` — a menu is chosen by what was pressed. */
	readonly target: Element;
	/**
	 * The `pointerdown` itself.
	 *
	 * Typed `MouseEvent` rather than `PointerEvent` on purpose: every consumer of a long press places something at
	 * a position — the grid hands it straight to `showMenu`'s `{kind: 'event'}` anchor — and `MouseEvent` is the
	 * narrowest type that carries `clientX`/`clientY` and `preventDefault`. A `PointerEvent` **is** a `MouseEvent`,
	 * so the caller passes what it has; the type only promises what is used, which is also what lets a jsdom test
	 * dispatch a plain `MouseEvent` where the platform has no `PointerEvent` constructor.
	 */
	readonly source: MouseEvent;
};

export type LongPressPorts = {
	/** The press became a hold: paint the feedback. */
	readonly onPressChange?: ((pressed: boolean) => void) | undefined;
	/** The hold counted: open the menu. Called **before** the finger is lifted, by design. */
	readonly onTrigger: (trigger: LongPressTrigger) => void;
};

export type LongPressSession = {
	/**
	 * Begins watching a press. `false` means this press is not ours (a mouse, a second finger) and the caller
	 * should leave the event alone.
	 */
	readonly begin: (event: PointerEvent) => boolean;
	/** A move in client coordinates. Clears the press when the finger has travelled too far. */
	readonly move: (point: PressPoint) => void;
	/** The default browser lost the gesture (a `pointercancel`): abandon the press silently. */
	readonly cancel: () => void;
	/** The finger lifted. Always ends the press; `true` when it should also be swallowed as a click. */
	readonly end: () => boolean;
	/** Whether a press is being watched right now. */
	readonly pending: () => boolean;
};

export type LongPressOptions = {
	readonly delayMs?: number | undefined;
	readonly slopPx?: number | undefined;
	/** Injected so the tests' clock is the only clock, and so a test can fire the hold without waiting 500 ms. */
	readonly setTimer?: ((callback: () => void, ms: number) => number) | undefined;
	readonly clearTimer?: ((handle: number) => void) | undefined;
};

/**
 * One long-press session, for one element.
 *
 * The session holds exactly one press at a time, and every path out of the press state (fire, move, cancel, lift)
 * clears the timer and the feedback attribute — a press that leaked its timer would open a menu 500 ms after an
 * unrelated scroll, which is the classic version of this bug.
 */
export function createLongPressSession(
	ports: LongPressPorts,
	options: LongPressOptions = {},
): LongPressSession {
	const delayMs = options.delayMs ?? LONG_PRESS_MS;
	const slopPx = options.slopPx ?? LONG_PRESS_SLOP_PX;
	// `window.setTimeout` when nothing is injected: the browser's clock. `typeof window` is guarded because the
	// unit project is node, where a bare `setTimeout` would be a global this file has no business assuming.
	const setTimer =
		options.setTimer ??
		((callback, ms) => (typeof window === 'undefined' ? 0 : window.setTimeout(callback, ms)));
	const clearTimer =
		options.clearTimer ??
		((handle) => {
			if (typeof window !== 'undefined') {
				window.clearTimeout(handle);
			}
		});

	let press: {
		readonly pointerId: number;
		readonly startX: number;
		readonly startY: number;
		readonly target: Element;
		readonly timer: number;
		fired: boolean;
	} | null = null;

	/** The one way out: clears the timer, clears the feedback, forgets the press. */
	function release(): void {
		if (press === null) {
			return;
		}
		clearTimer(press.timer);
		press = null;
		ports.onPressChange?.(false);
	}

	return {
		begin(event: PointerEvent): boolean {
			if (press !== null) {
				return false; // one press at a time: a second finger is not this gesture
			}
			// The rule from the file header: a mouse does not long-press.
			if (event.pointerType === 'mouse') {
				return false;
			}
			if (event.button !== 0 || event.isPrimary === false) {
				return false;
			}
			const target = event.target;
			if (!(target instanceof Element)) {
				return false;
			}
			const startX = event.clientX;
			const startY = event.clientY;
			const entry = {
				pointerId: event.pointerId,
				startX,
				startY,
				target,
				timer: 0,
				fired: false,
			};
			entry.timer = setTimer(() => {
				if (press === null || press.fired) {
					return;
				}
				press.fired = true;
				// The feedback stays **on** while the menu is open (it is the "this is why the menu appeared"
				// cue); `release()` turns it off when the finger lifts.
				ports.onTrigger({ point: { x: startX, y: startY }, target, source: event });
			}, delayMs);
			press = entry;
			ports.onPressChange?.(true);
			return true;
		},

		move(point: PressPoint): void {
			if (press === null) {
				return;
			}
			const travel = Math.max(
				Math.abs(point.x - press.startX),
				Math.abs(point.y - press.startY),
			);
			if (travel > slopPx) {
				// A scroll, not a press. No menu, and no click swallowed: the scroller owns this gesture now.
				release();
			}
		},

		cancel(): void {
			release();
		},

		end(): boolean {
			const fired = press?.fired ?? false;
			release();
			// `true` only when a menu opened during this press: that release is the menu's, not a click's.
			return fired;
		},

		pending(): boolean {
			return press !== null;
		},
	};
}
