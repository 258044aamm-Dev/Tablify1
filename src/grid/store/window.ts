/**
 * The row window: which rows are mounted for a given scroll position.
 *
 * Pure arithmetic on purpose (`docs/02` §Grid rendering: "Row heights are enumerated and fixed per density,
 * so visible range is arithmetic on `scrollTop` — no measurement pass"). Nothing here reads the DOM, which is
 * why the range can be computed for a scroll position that has not happened yet, and why its edge cases — an
 * empty grid, a viewport of zero, an offset past the end, a negative offset — are testable in a table.
 *
 * The one decision worth stating: **a scroll offset is clamped into the range the scroller can actually
 * have** (`totalHeight - viewportHeight`). A caller that hands in a larger offset is describing a viewport
 * that no longer exists — a row was deleted, or the pane shrank — and clamping lands on the *last screen*,
 * which is what the browser would have done silently. Returning a window past the end instead would mount
 * nothing and show a blank grid.
 */

/** Rows mounted above and below the visible ones. `docs/02` §Grid rendering names 8. */
export const OVERSCAN_ROWS = 8;

/** The three densities, in CSS pixels. `docs/02` §Grid rendering: short 32 / medium 40 / tall 64. */
export const ROW_HEIGHTS = { short: 32, medium: 40, tall: 64 } as const;

/** A density name. `appearance.defaultRowHeight` in the settings, and the per-view option in the `.base`. */
export type RowDensity = keyof typeof ROW_HEIGHTS;

/** The pixel height of a density, so callers never index the record themselves. */
export function rowHeightOf(density: RowDensity): number {
	return ROW_HEIGHTS[density];
}

/** What the renderer mounts, and where. */
export type RowWindow = {
	/** First mounted row index. Never negative. */
	readonly start: number;
	/** One past the last mounted row index. Never past `rowCount`. */
	readonly end: number;
	/** `start × rowHeight`: the `translateY` the mounted block sits at. */
	readonly offsetY: number;
	/** `rowCount × rowHeight`: the height of the scroll range, i.e. what the canvas is given. */
	readonly totalHeight: number;
	/** The offset the arithmetic used, after clamping. The renderer compares it against the real one. */
	readonly clampedScrollTop: number;
};

export type RowWindowInput = {
	readonly scrollTop: number;
	readonly viewportHeight: number;
	readonly rowHeight: number;
	readonly rowCount: number;
	/** Rows mounted beyond the visible range. Defaults to {@link OVERSCAN_ROWS}. */
	readonly overscan?: number;
};

/** The window for one scroll position. */
export function rowWindow(input: RowWindowInput): RowWindow {
	// A row height of zero would divide by zero; the smallest sensible value is one pixel. Likewise a
	// negative row count is a caller's bug, and the honest reading of it is "no rows".
	const rowHeight = Math.max(1, input.rowHeight);
	const rowCount = Math.max(0, Math.floor(input.rowCount));
	const overscan = Math.max(0, Math.floor(input.overscan ?? OVERSCAN_ROWS));
	const totalHeight = rowCount * rowHeight;

	const viewportHeight = Math.max(0, input.viewportHeight);
	const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
	const scrollTop = Number.isFinite(input.scrollTop) ? input.scrollTop : 0;
	const clampedScrollTop = Math.min(Math.max(0, scrollTop), maxScrollTop);

	if (rowCount === 0) {
		return { start: 0, end: 0, offsetY: 0, totalHeight: 0, clampedScrollTop };
	}

	const firstVisible = Math.floor(clampedScrollTop / rowHeight);
	// `ceil` of the bottom edge, so a viewport that ends mid-row still mounts that row. A viewport of zero
	// still mounts the first row: an unmeasured pane must show something, not an empty grid.
	const lastVisible = Math.max(
		firstVisible + 1,
		Math.ceil((clampedScrollTop + viewportHeight) / rowHeight),
	);

	const start = Math.max(0, firstVisible - overscan);
	const end = Math.min(rowCount, lastVisible + overscan);

	return { start, end, offsetY: start * rowHeight, totalHeight, clampedScrollTop };
}

/** The mounted slice of any list, given its window. Allocation is one `slice`. */
export function windowSlice<T>(items: readonly T[], window: RowWindow): readonly T[] {
	return items.slice(window.start, window.end);
}

/** Which row a point in the scroller's content box falls on, or `null` past the last row. */
export function rowIndexAt(offsetY: number, rowHeight: number, rowCount: number): number | null {
	if (rowHeight <= 0 || rowCount <= 0 || offsetY < 0) {
		return null;
	}
	const index = Math.floor(offsetY / rowHeight);
	return index >= rowCount ? null : index;
}
