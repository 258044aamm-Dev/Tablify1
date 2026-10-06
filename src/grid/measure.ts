/**
 * Reading numbers off the DOM — the only place the grid does it.
 *
 * `docs/04` §The layout contract forbids the failure modes that make a grid negotiate its own height:
 * percentage chains, `100vh`, `ResizeObserver` writing height custom properties, `window.innerHeight` during
 * layout. What is left is honest measurement: **how wide is my pane**, and **how tall is the band I am
 * allowed to draw rows in**. Both come from the element itself, both are cheap, and both are read at a
 * moment that cannot cause a layout thrash (a scroll frame, or a resize callback — never inside a render).
 *
 * One token is read here as well: `--tablify-header-h`. The header band's height is a design value that
 * lives in `tokens.css` where the contrast gate and the CSS gate can see it, and the arithmetic needs it as
 * a number. Reading it keeps one source of truth; a hard-coded `40` in the renderer would be a second one.
 */
import { FALLBACK_HEADER_HEIGHT } from './layout';

/** A CSS custom property as a number of pixels, or the fallback. Never throws, never returns `NaN`. */
export function readPxToken(element: Element | null, name: string, fallback: number): number {
	if (element === null) {
		return fallback;
	}
	const view = element.ownerDocument.defaultView;
	if (view === null) {
		return fallback;
	}
	const raw = view.getComputedStyle(element).getPropertyValue(name).trim();
	const parsed = Number.parseFloat(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/** The header band's height for this grid: the token when it resolves, the documented fallback otherwise. */
export function readHeaderHeight(element: Element | null): number {
	return readPxToken(element, '--tablify-header-h', FALLBACK_HEADER_HEIGHT);
}

/**
 * The pane's own width, in CSS pixels. `clientWidth` is the padding box — the same box the absolutely
 * positioned root fills — so this is literally "the width the view owns", which is the number §P21 is
 * about. A hidden or not-yet-laid-out pane answers 0, and 0 is correct: nothing is pinned in a pane that has
 * no width yet.
 */
export function paneWidthOf(element: Element | null): number {
	return element === null ? 0 : Math.max(0, element.clientWidth);
}

/**
 * The band the rows may draw in: the scroller's height minus the header it slides under. Floored at 0 so a
 * pane that has not been laid out yet windows to "one row", not to a negative viewport.
 */
export function rowBandHeightOf(element: Element | null, headerHeight: number): number {
	if (element === null) {
		return 0;
	}
	return Math.max(0, element.clientHeight - headerHeight);
}
