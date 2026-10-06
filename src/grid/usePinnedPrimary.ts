/**
 * `pinnedPrimary`, as a hook that re-renders **only when the answer flips**.
 *
 * The rule is one line (`pinnedPrimary(desired, paneWidth)`, `docs/08` §P21); the interesting part is when it
 * is allowed to cost a render. A pane resize fires continuously while a sidebar handle is dragged, and the
 * answer changes exactly once in that whole gesture. So this hook keeps the width in a ref, re-evaluates on
 * every observer callback, and calls `setState` only when the boolean differs — the "re-render on flip, not on
 * resize" requirement, implemented as the smallest possible state.
 *
 * `initialWidth` is not a convenience: the view measures its container **before** mounting (step 17's item 6,
 * so the first frame is already windowed), and handing that number in means the first paint is already right.
 * Without it a phone would paint a pinned column and then take it away, which is precisely the kind of
 * first-frame flicker the layout contract exists to prevent.
 */
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { pinnedPrimary } from './layout';
import { paneWidthOf } from './measure';

export function usePinnedPrimary(
	area: RefObject<HTMLElement | null>,
	desired: boolean,
	initialWidth = 0,
): boolean {
	const [pinned, setPinned] = useState(() => pinnedPrimary(desired, initialWidth));
	const pinnedRef = useRef(pinned);

	useEffect(() => {
		const element = area.current;
		if (element === null || element === undefined) {
			return;
		}
		/** One re-evaluation: read the pane, compare, and only then decide whether React needs to know. */
		const evaluate = (): void => {
			const width = paneWidthOf(element);
			if (width <= 0) {
				// Unmeasurable — jsdom, `display: none`, or a pane that has not been laid out yet. Zero is not a
				// narrow pane, it is *no answer*, and the honest response is to keep the one we were handed.
				return;
			}
			const next = pinnedPrimary(desired, width);
			if (next !== pinnedRef.current) {
				pinnedRef.current = next;
				setPinned(next);
			}
		};
		evaluate();

		if (typeof ResizeObserver !== 'function') {
			return;
		}
		const observer = new ResizeObserver(evaluate);
		observer.observe(element);
		return () => {
			observer.disconnect();
		};
	}, [area, desired]);

	// The wish itself can change (the View dialog's freeze toggle) without any resize happening.
	useEffect(() => {
		const element = area.current;
		const measured = element === null ? 0 : paneWidthOf(element);
		const next = pinnedPrimary(desired, measured > 0 ? measured : initialWidth);
		if (next !== pinnedRef.current) {
			pinnedRef.current = next;
			setPinned(next);
		}
	}, [area, desired]);

	return pinned;
}
