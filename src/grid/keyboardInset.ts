/**
 * The on-screen keyboard: **one number driving one token, and the cell that is being edited revealed.**
 *
 * `docs/04` §Keyboard and viewport is unusually prescriptive about this, and the prescription is the whole design:
 *
 *  - *"Listen to `window.visualViewport` (`resize` + `scroll`, passive) and drive **one** CSS variable:
 *    `--tablify-keyboard-inset`, applied as `padding-bottom` on `.tablify-root`. The document height is never
 *    renegotiated."* — hence {@link keyboardInsetOf} and a writer that sets exactly one custom property.
 *  - *"Scroll the active cell into view after the inset settles (one `requestAnimationFrame`), so editing a cell
 *    near the bottom does not hide it under the keyboard."* — hence the single frame in {@link createKeyboardInset}.
 *    **What** to reveal is the caller's job and is injected as one callback, because the answer is already written
 *    down once: `revealElement` in `keyboard/focus.ts` is what `Ctrl+End`, the arrow keys and the tab walk all
 *    use, and a second "is it in the band?" would be a second clamp to keep in step.
 *  - *Forbidden: `window.innerHeight` reads during layout, `height: 100%` chains, percentage heights, a
 *    `ResizeObserver` writing height custom properties* — none of which this file does: the inset is written on
 *    `resize`/`scroll` events only, never inside layout, and the value comes from `visualViewport`.
 *
 * `keyboardInsetOf` is pure and separate from the wiring on purpose: it is arithmetic a unit test can pin to the
 * pixel, and it is the number the historical failure was about — the 860 px → 389 px host squeeze that produced a
 * 260 px overlay (`harness/hosts.ts`, `phone-keyboard`).
 */

/** The token both the CSS and the harness know by name. */
export const KEYBOARD_INSET_PROPERTY = '--tablify-keyboard-inset';

/** The part of `VisualViewport` this needs. Structural, so a test can hand over three numbers. */
export type VisualViewportLike = {
	readonly height: number;
	readonly offsetTop: number;
	/** `undefined` on some engines (and on jsdom): treated as `0`. */
	readonly offsetLeft?: number | undefined;
	readonly addEventListener: (
		type: string,
		listener: () => void,
		options?: { readonly passive?: boolean },
	) => void;
	readonly removeEventListener: (type: string, listener: () => void) => void;
};

/**
 * How much of the pane the keyboard is covering: the window's height minus the visible viewport's, plus however
 * far the visible viewport has been pushed down.
 *
 * Both terms matter. On iOS the keyboard *shrinks* `visualViewport.height` while the layout viewport keeps its
 * size, so the first term is the keyboard. When the page itself is panned (focusing an input near the top does
 * this), `offsetTop` grows and the second term keeps the arithmetic honest. The result is clamped at `0` because a
 * browser mid-animation can report a viewport *taller* than the window, and a negative padding would pull the
 * layout up into the chrome.
 */
export function keyboardInsetOf(input: {
	readonly windowHeight: number;
	readonly viewportHeight: number;
	readonly viewportOffsetTop: number;
}): number {
	const covered = input.windowHeight - input.viewportHeight - input.viewportOffsetTop;
	return Math.max(0, Math.round(covered));
}

/** Everything the wiring touches. All injected, so a unit test drives it with numbers and no browser. */
export type KeyboardInsetPorts = {
	/** The element the token is written on — the view's own host, an ancestor of `.tablify-root`. */
	readonly host: { setProperty: (name: string, value: string) => void };
	readonly window: { readonly innerHeight: number };
	readonly viewport: VisualViewportLike | null;
	/**
	 * Scrolls whatever is being edited back into view. Called on the frame after every inset change, and given
	 * no arguments on purpose: the answer depends on the live DOM (the focused element, the scroller's box), and
	 * reading it at call time is the whole point — a captured element would be the one from before the editor
	 * moved.
	 */
	readonly reveal: () => void;
	/** One frame, injected so a test decides when "the inset has settled" is. */
	readonly frame?: ((callback: () => void) => void) | undefined;
};

export type KeyboardInset = {
	/** Attaches the two passive listeners and writes the current value once. */
	readonly start: () => void;
	/** Detaches both listeners and clears the token, so a disposed view leaves no inset behind. */
	readonly stop: () => void;
	/** Recomputes and applies right now. `start` calls it; a test calls it directly. */
	readonly sync: () => number;
};

/**
 * The wiring. Two listeners, one rAF, one custom property — and no `ResizeObserver`, because a keyboard is not a
 * resize (that is the doc's own distinction: the `ResizeObserver` is for the *pane*, and the keyboard has a
 * channel of its own).
 */
export function createKeyboardInset(ports: KeyboardInsetPorts): KeyboardInset {
	// `window.requestAnimationFrame`, not the bare global: the same rule the timers follow, and for the same
	// reason — an Obsidian pop-out window has its own `window`, and the frame must belong to the document the grid
	// is actually in.
	const frame =
		ports.frame ??
		((callback: () => void) => {
			if (typeof window !== 'undefined') {
				window.requestAnimationFrame(callback);
			}
		});
	let running = false;

	/**
	 * One frame after the inset changes: let the caller reveal whatever is being edited.
	 *
	 * A frame, not a timeout: the browser applies the padding in the same turn it fires the event, and a timeout
	 * would be a guess about how long "settles" takes. This is the doc's own instruction, once.
	 */
	function reveal(): void {
		frame(() => {
			ports.reveal();
		});
	}

	const sync = (): number => {
		const viewport = ports.viewport;
		const inset =
			viewport === null
				? 0
				: keyboardInsetOf({
						windowHeight: ports.window.innerHeight,
						viewportHeight: viewport.height,
						viewportOffsetTop: viewport.offsetTop,
					});
		ports.host.setProperty(KEYBOARD_INSET_PROPERTY, `${String(inset)}px`);
		reveal();
		return inset;
	};

	const onViewportChange = (): void => {
		if (running) {
			sync();
		}
	};

	return {
		start(): void {
			if (running) {
				return;
			}
			running = true;
			// Passive: the listener never calls `preventDefault`, and saying so keeps the browser able to scroll
			// while this runs — which matters on the one gesture this file exists for.
			ports.viewport?.addEventListener('resize', onViewportChange, { passive: true });
			ports.viewport?.addEventListener('scroll', onViewportChange, { passive: true });
			sync();
		},
		stop(): void {
			running = false;
			ports.viewport?.removeEventListener('resize', onViewportChange);
			ports.viewport?.removeEventListener('scroll', onViewportChange);
			ports.host.setProperty(KEYBOARD_INSET_PROPERTY, '0px');
		},
		sync,
	};
}
