/**
 * Focus: where the keyboard is, where it goes, and the one tab stop.
 *
 * `docs/04` §Accessibility states the model in one line: *"Roving `tabindex`: the grid is one tab stop; arrows
 * move focus; `aria-activedescendant` is **not** used, real focus moves"*. This module is that sentence as
 * functions, and each of its three jobs exists because a naive version of it fails in a way that is invisible
 * until someone uses a keyboard for an hour:
 *
 *  1. **Exactly one thing is tabbable** ({@link rootTabIndex}, {@link cellTabIndex}): the grid itself while
     nothing is selected, and the active cell afterwards. A grid where *no* element is tabbable is a grid a
     keyboard user cannot enter at all; a grid where every cell is tabbable is 5,000 tab stops between a user and
     the next button.
  2. **Every move ends inside a mounted cell.** Rows are windowed, so "the active cell" is regularly a cell
 *     with no element: `Ctrl+End` on a 5,000-row view moves focus to a cell 4,900 rows below the window. The
 *     reveal maths here is the windowing's own band — the rows may not draw under the header
 *     (`clientHeight - headerHeight`, `store/window.ts`) — inverted: given a row, what `scrollTop` puts it in
 *     that band? One `requestAnimationFrame` later the row exists, and focus lands on it.
 *  3. **`Tab` leaves the grid at the edge** ({@link tabStop}). The doc's rule for `Tab` is *"move within the
 *     grid, and leave the grid at the last cell"*: while there is a next cell, `Tab` is the grid's; at the last
 *     cell the key is **not handled**, so the browser's own focus order takes over and the user is not trapped
 *     in a grid with 5,000 cells.
 *
 * Nothing here reads the store or knows what a cell contains: it is arithmetic, a selector and two calls to
 * `focus()`. `handler.ts` decides *when*; this file decides *where*.
 */
import { cellPosition } from '../../core/selection/range';
import type { RangeOrder } from '../../core/selection/range';
import type { CellRef } from '../../core/ops/types';

/** The `tabindex` of the one cell the browser may tab to. */
export const ACTIVE_TAB_INDEX = 0;

/** The `tabindex` of every other cell: reachable by code and by arrows, never by `Tab`. */
export const IDLE_TAB_INDEX = -1;

/** The attribute that identifies a cell in the DOM. `filePath::fieldId` — the same key the editors use. */
export function cellKey(ref: CellRef): string {
	return `${ref.filePath}::${ref.fieldId}`;
}

/** The cell's element, or `null` when it is not mounted (the windowing has not reached it yet). */
export function queryCell(root: ParentNode | null, ref: CellRef): HTMLElement | null {
	if (root === null) {
		return null;
	}
	return root.querySelector<HTMLElement>(`[data-cell="${cellKey(ref)}"]`);
}

/**
 * The `tabindex` of the grid's own element: **0 while nothing is selected**, which makes the grid itself the one
 * tab stop a fresh view offers, and `-1` once a cell is active, so `Tab` goes from the grid back out to the rest
 * of the application instead of stopping twice in one table.
 */
export function rootTabIndex(selection: boolean): number {
	return selection ? IDLE_TAB_INDEX : ACTIVE_TAB_INDEX;
}

/**
 * The `tabindex` of one cell: 0 for the active cell, `-1` for every other cell.
 *
 * Together with {@link rootTabIndex} this is the whole roving model, and the invariant is the interesting part:
 * **exactly one thing in the grid is ever tabbable** — the root before the first selection, one cell afterwards.
 * A test asserts it on the rendered DOM, because "arrows move focus" is only true if `Tab` can get in.
 */
export function cellTabIndex(active: boolean): number {
	return active ? ACTIVE_TAB_INDEX : IDLE_TAB_INDEX;
}

/** Which way `Tab` moves. `Shift+Tab` is `backward`. */
export type TabDirection = 'forward' | 'backward';

/**
 * The cell `Tab`/`Shift+Tab` moves to, or `null` at the edge of the grid — where the key stops being ours.
 *
 * Row-major, wrapping at the end of a row, which is what "next cell" means to a person. `null` is the whole
 * point of the function: it is how `Tab` at the last cell (and `Shift+Tab` at the first) hands the key back to
 * the browser, exactly as `docs/01` §Core interaction model asks.
 */
export function tabStop(order: RangeOrder, from: CellRef, direction: TabDirection): CellRef | null {
	const at = cellPosition(from, order);
	if (at === null) {
		return null;
	}
	const columnCount = order.fields.length;
	const rowCount = order.rows.length;
	const flat = at.row * columnCount + at.field + (direction === 'forward' ? 1 : -1);
	if (flat < 0 || flat >= rowCount * columnCount) {
		return null;
	}
	const filePath = order.rows[Math.floor(flat / columnCount)];
	const fieldId = order.fields[flat % columnCount];
	if (filePath === undefined || fieldId === undefined) {
		return null;
	}
	return { filePath, fieldId };
}

export type RevealInput = {
	/** The scroller's current offset on this axis. */
	readonly offset: number;
	/** The scroller's `clientHeight` (rows) or `clientWidth` (columns). */
	readonly clientSize: number;
	/** The band that is always covered: `headerHeight` for rows, `0` for columns. */
	readonly lead: number;
	/** The item's position in the scroller's **content** coordinates (before the offset is applied). */
	readonly itemStart: number;
	readonly itemEnd: number;
	/** The content's size on this axis: `scrollHeight`/`scrollWidth`. */
	readonly contentSize: number;
};

/**
 * The offset that brings an item into the visible band, clamped to the range the scroller can have.
 *
 * The band is `[offset + lead, offset + clientSize]`: rows may not draw under the header band, which is the
 * same subtraction the windowing does (`rowBandHeightOf`), inverted. An item taller than the band (a column
 * wider than the pane) is aligned to its **start** — the second branch wins, and that is the useful edge: you
 * want to see the beginning of a column you are about to read, not its end.
 */
export function revealOffset(input: RevealInput): number {
	let next = input.offset;
	if (input.itemEnd > next + input.clientSize) {
		next = input.itemEnd - input.clientSize;
	}
	if (input.itemStart < next + input.lead) {
		next = input.itemStart - input.lead;
	}
	const max = Math.max(0, input.contentSize - input.clientSize);
	return Math.min(Math.max(0, next), max);
}

/**
 * Scrolls the scroller so a mounted element is inside its visible band, on both axes when the element lives
 * inside the scroller. A cell in the frozen lane is a child of a *sibling* layer, so only the vertical axis is
 * ours there — the lane is pinned horizontally by definition.
 *
 * `lead` is passed in rather than read from the DOM: the caller (the grid) already holds the header band's
 * height as state, and one number with one owner is what this repository keeps choosing over a second read.
 *
 * Rects rather than offsets on purpose: a rect is the truth after transforms, borders and any future
 * density change, and the arithmetic this feeds is still the windowing's band. No `scrollIntoView()`: it walks
 * up every ancestor — including Obsidian's panes — which is exactly the "something lines up until it does not"
 * failure the layout contract exists to prevent.
 */
export function revealElement(
	scroller: HTMLElement | null,
	target: HTMLElement | null,
	lead: number,
): boolean {
	if (scroller === null || target === null) {
		return false;
	}
	const box = scroller.getBoundingClientRect();
	const item = target.getBoundingClientRect();
	const insideScroller = scroller.contains(target);

	const nextTop = revealOffset({
		offset: scroller.scrollTop,
		clientSize: scroller.clientHeight,
		lead,
		itemStart: item.top - box.top + scroller.scrollTop,
		itemEnd: item.bottom - box.top + scroller.scrollTop,
		contentSize: scroller.scrollHeight,
	});
	let moved = nextTop !== scroller.scrollTop;
	scroller.scrollTop = nextTop;

	if (insideScroller) {
		const nextLeft = revealOffset({
			offset: scroller.scrollLeft,
			clientSize: scroller.clientWidth,
			lead: 0,
			itemStart: item.left - box.left + scroller.scrollLeft,
			itemEnd: item.right - box.left + scroller.scrollLeft,
			contentSize: scroller.scrollWidth,
		});
		moved = moved || nextLeft !== scroller.scrollLeft;
		scroller.scrollLeft = nextLeft;
	}
	return moved;
}

/**
 * The same reveal for a row that has **no element** — the `Ctrl+End` case. The cell cannot be measured, so the
 * row's geometry is the windowing's own: `headerHeight + index × rowHeight`. The caller then waits one frame
 * for the window to catch up (see `GridView`).
 */
export function revealRowIndex(
	scroller: HTMLElement | null,
	headerHeight: number,
	itemIndex: number,
	rowHeight: number,
): boolean {
	if (scroller === null || itemIndex < 0) {
		return false;
	}
	const itemStart = headerHeight + itemIndex * rowHeight;
	const next = revealOffset({
		offset: scroller.scrollTop,
		clientSize: scroller.clientHeight,
		lead: headerHeight,
		itemStart,
		itemEnd: itemStart + rowHeight,
		contentSize: scroller.scrollHeight,
	});
	const moved = next !== scroller.scrollTop;
	scroller.scrollTop = next;
	return moved;
}

/**
 * Puts DOM focus on a cell, returning what actually received it — `'cell'` when the element was there and took
 * focus, `'root'` when the fallback container did. `'none'` means neither can (a detached view).
 *
 * The fallback is not a nicety: if the cell could not be mounted — a row that vanished under a filter while the
 * key was in flight — focus on the grid root keeps every following key going to the grid instead of to
 * `document.body`, where the arrows would scroll the whole app.
 */
export function focusCell(root: HTMLElement | null, ref: CellRef | null): 'cell' | 'root' | 'none' {
	if (root === null) {
		return 'none';
	}
	const cell = ref === null ? null : queryCell(root, ref);
	if (cell !== null) {
		// `preventScroll` because the scroller was already moved deliberately by `revealElement`; without it the
		// browser scrolls every ancestor to "help", which is how a grid ends up jumping the app around.
		cell.focus({ preventScroll: true });
		return 'cell';
	}
	root.focus({ preventScroll: true });
	return root.ownerDocument.activeElement === root ? 'root' : 'none';
}
