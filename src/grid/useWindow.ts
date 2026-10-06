/**
 * The scroll listener: one per grid, passive, `requestAnimationFrame`-coalesced, and **not React state**.
 *
 * `docs/02` §Grid rendering: "sticky header and frozen first column are separate absolutely-positioned layers
 * inside the same scroll container, offset by `scrollTop`/`scrollLeft` in a `requestAnimationFrame`, applied
 * via CSS transform (never a layout-triggering property)". This hook is that rAF: it reads the offset off the
 * DOM element, hands it to a callback (which writes transforms), and only then decides whether the *window*
 * changed enough to be worth a React render.
 *
 * The distinction is the whole performance contract:
 *
 *   · a scroll that stays inside the window's overscan slack ⇒ **zero** renders; transforms only;
 *   · a scroll that crosses a window boundary ⇒ one render of the row lane, whose rows are keyed by row id,
 *     so the mounted rows keep their element identity and — because they are `memo`ed and their props have
 *     not changed — do not re-render. Rows entering the window mount.
 *
 * The window's start is the only thing kept in state, which is why a 2,000 px scroll costs one render rather
 * than one per frame: `rowWindow` is called every frame, but `setStart` only fires at a boundary crossing.
 *
 * Two structural facts about the DOM this drives, both established in step 17 and both load-bearing:
 *
 *  1. **The rows live *inside* the scroller.** They are absolutely positioned in the content, so the browser
 *     scrolls them natively: wheel, trackpad, touch pan, momentum, `PageDown` — all the platform's, none of
 *     ours. (The prototype kept the row lane *outside* the scroller and had to forward `wheel` by hand; that
 *     forwarding is still here, but now only for the bands that genuinely sit above the scroller: the header,
 *     the frozen column and the corner.)
 *  2. **The sticky lanes live outside it**, so their transforms are the only thing that moves them, and the
 *     user's scroll never touches their layout.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { rowWindow } from './store/window';
import type { RowWindow } from './store/window';

/** A scroll offset, as handed to the transform writer. */
export type ScrollPosition = {
	readonly scrollTop: number;
	readonly scrollLeft: number;
};

export type UseWindowOptions = {
	/** The one scroller. Its `clientHeight` is the pane, its `scrollTop` is the truth. */
	readonly scroller: RefObject<HTMLElement | null>;
	/**
	 * The wrapper the sticky lanes sit in. Its only job here is wheel forwarding: a wheel event that lands on
	 * a lane has no scrollable ancestor, so without forwarding, hovering the header or the frozen column and
	 * scrolling would do nothing at all. Events that land inside the scroller are left alone — the browser's
	 * own path is better than ours.
	 */
	readonly area?: RefObject<HTMLElement | null> | undefined;
	readonly rowHeight: number;
	readonly rowCount: number;
	readonly overscan?: number | undefined;
	/** The header band the rows slide under; it is subtracted from the scroller's height. */
	readonly headerHeight: number;
	/** Called once per frame, before the React decision, with the offset that is true right now. */
	readonly onScroll?: ((position: ScrollPosition) => void) | undefined;
};

export type UseWindow = {
	/** The rows to mount, and where their block sits. Recomputed per frame, but only *stably* per window. */
	readonly window: RowWindow;
	/** The band the rows may draw in — measured, never assumed. */
	readonly viewportHeight: number;
	/** Reads the DOM now and applies everything above. Safe to call from a layout effect. */
	readonly sync: () => void;
	/** Scrolls by a delta, clamped by the element itself. Used by wheel forwarding and by step 19. */
	readonly scrollBy: (dx: number, dy: number) => void;
};

export function useWindow(options: UseWindowOptions): UseWindow {
	const { scroller, area, rowHeight, rowCount, overscan, headerHeight, onScroll } = options;

	// The one piece of scroll state React holds, and it changes at window boundaries only.
	const [start, setStart] = useState(0);
	const [bandHeight, setBandHeight] = useState(0);

	const startRef = useRef(0);
	const bandRef = useRef(0);
	const frameRef = useRef(0);
	const callbackRef = useRef(onScroll);
	const optionsRef = useRef({ rowHeight, rowCount, overscan, headerHeight });
	optionsRef.current = { rowHeight, rowCount, overscan, headerHeight };

	useEffect(() => {
		callbackRef.current = onScroll;
	}, [onScroll]);

	/** One frame's work: publish the offset, then decide whether the window moved. */
	const read = useCallback((): void => {
		const element = scroller.current;
		if (element === null || element === undefined) {
			return;
		}
		const current = optionsRef.current;
		callbackRef.current?.({ scrollTop: element.scrollTop, scrollLeft: element.scrollLeft });

		const height = Math.max(0, element.clientHeight - current.headerHeight);
		if (height !== bandRef.current) {
			bandRef.current = height;
			setBandHeight(height);
		}
		const measured = rowWindow({
			scrollTop: element.scrollTop,
			viewportHeight: height,
			rowHeight: current.rowHeight,
			rowCount: current.rowCount,
			...(current.overscan === undefined ? {} : { overscan: current.overscan }),
		});
		if (measured.start !== startRef.current) {
			startRef.current = measured.start;
			setStart(measured.start);
		}
	}, [scroller]);

	/** Coalesces every scroll event in one frame into a single `read`. */
	const schedule = useCallback((): void => {
		if (frameRef.current !== 0) {
			return;
		}
		frameRef.current = window.requestAnimationFrame(() => {
			frameRef.current = 0;
			read();
		});
	}, [read]);

	const scrollBy = useCallback(
		(dx: number, dy: number): void => {
			const element = scroller.current;
			if (element === null || element === undefined) {
				return;
			}
			element.scrollLeft += dx;
			element.scrollTop += dy;
		},
		[scroller],
	);

	// The listeners. `passive: true` on scroll: we never prevent it, and a passive listener cannot be the
	// reason a scroll waits for JavaScript.
	useEffect(() => {
		const element = scroller.current;
		if (element === null || element === undefined) {
			return;
		}
		element.addEventListener('scroll', schedule, { passive: true });

		const target = area?.current ?? null;
		const onWheel = (event: WheelEvent): void => {
			if (event.ctrlKey || event.metaKey) {
				return; // pinch-zoom is the platform's, never ours (docs/04 §Gestures that must not exist)
			}
			const inner = event.target;
			if (inner instanceof Node && element.contains(inner)) {
				return; // the browser is already scrolling this, and better than we can
			}
			let dx = event.deltaX;
			let dy = event.deltaY;
			if (event.deltaMode === 1) {
				dx *= 16; // lines
				dy *= 16;
			} else if (event.deltaMode === 2) {
				dx *= element.clientWidth; // pages
				dy *= element.clientHeight;
			}
			if (event.shiftKey && Math.abs(dx) < Math.abs(dy)) {
				dx = dy; // shift = sideways, the convention every spreadsheet keeps
				dy = 0;
			}
			const fromLeft = element.scrollLeft;
			const fromTop = element.scrollTop;
			element.scrollLeft = fromLeft + dx;
			element.scrollTop = fromTop + dy;
			if (element.scrollLeft !== fromLeft || element.scrollTop !== fromTop) {
				event.preventDefault();
				read();
			}
		};
		if (target !== null) {
			target.addEventListener('wheel', onWheel, { passive: false });
		}

		return () => {
			element.removeEventListener('scroll', schedule);
			if (target !== null) {
				target.removeEventListener('wheel', onWheel);
			}
			if (frameRef.current !== 0) {
				window.cancelAnimationFrame(frameRef.current);
				frameRef.current = 0;
			}
		};
	}, [scroller, area, schedule, read]);

	/**
	 * A resize can change the band, the window, or both — and it can also arrive from a `ResizeObserver`
	 * rather than a window resize, which is the only way a *pane* resize is observable at all (Obsidian's
	 * sidebar handle emits no `window.resize`). The observer reads sizes; it never writes a height back into
	 * CSS, which is the thing `docs/04` forbids.
	 */
	useEffect(() => {
		const element = scroller.current;
		if (element === null || element === undefined || typeof ResizeObserver !== 'function') {
			return;
		}
		const observer = new ResizeObserver(() => {
			read();
		});
		observer.observe(element);
		return () => {
			observer.disconnect();
		};
	}, [scroller, read]);

	/**
	 * Before the first paint and after every render. The first call is what makes the first frame already
	 * windowed ("no flash of 5,000 rows"); the later ones re-apply the transforms to lanes that React has just
	 * created and that therefore have no transform yet.
	 */
	useLayoutEffect(() => {
		read();
	});

	const value = useMemo<RowWindow>(
		() =>
			rowWindow({
				// `start` is already a row index; converting it back to an offset is what makes
				// `offsetY === start * rowHeight` exactly true for the lane that consumes it.
				scrollTop: start * rowHeight,
				viewportHeight: bandHeight,
				rowHeight,
				rowCount,
				...(overscan === undefined ? {} : { overscan }),
			}),
		[start, rowHeight, rowCount, bandHeight, overscan],
	);

	return useMemo(
		() => ({ window: value, viewportHeight: bandHeight, sync: read, scrollBy }),
		[value, bandHeight, read, scrollBy],
	);
}
