/**
 * The row-window table.
 *
 * `docs/02` §Grid rendering: "Row heights are enumerated and fixed per density, so visible range is
 * arithmetic on `scrollTop` — no measurement pass. Overscan 8 rows." This is that arithmetic, checked
 * against a table of offsets that includes every edge a real scroller can reach: the top, the first page
 * boundary, the middle, the last screen, past the end, before the beginning, and the two degenerate grids
 * (no rows, no measured viewport).
 *
 * It lives under `tests/dom/` because the repository's own `no-restricted-imports` rule keeps `tests/unit/**`
 * away from `src/grid/**` ("Only tests/dom may import src/grid") — the arithmetic has no DOM in it, but the
 * architecture rule is about the directory, and the rule is right: the grid is one module with one test home.
 */
import { describe, expect, it } from 'vitest';

import {
	OVERSCAN_ROWS,
	ROW_HEIGHTS,
	rowHeightOf,
	rowIndexAt,
	rowWindow,
	windowSlice,
} from '../../src/grid/store/window';

/** The fixture: 100 rows of medium height in a viewport exactly 20 rows tall. */
const ROWS = 100;
const ROW_H = ROW_HEIGHTS.medium;
const VIEWPORT = ROW_H * 20;
/** The furthest the scroller can actually go: 4000 − 800. */
const MAX_SCROLL = ROWS * ROW_H - VIEWPORT;

const windowAt = (scrollTop: number): ReturnType<typeof rowWindow> =>
	rowWindow({ scrollTop, viewportHeight: VIEWPORT, rowHeight: ROW_H, rowCount: ROWS });

const ids = Array.from(
	{ length: ROWS },
	(_unused, index) => `Notes/${String(index).padStart(3, '0')}.md`,
);

describe('the row window', () => {
	it('mounts the first screen and its overscan at the top', () => {
		const window = windowAt(0);
		expect(window.start).toBe(0);
		expect(window.end).toBe(20 + OVERSCAN_ROWS);
		expect(window.offsetY).toBe(0);
		expect(window.totalHeight).toBe(ROWS * ROW_H);
		expect(window.clampedScrollTop).toBe(0);
	});

	it('keeps a row that straddles the bottom edge mounted (one row down from the top)', () => {
		// scrolled one row: rows 1..21 are visible, so the window is 0..29 after overscan.
		const window = windowAt(ROW_H);
		expect(window.start).toBe(0);
		expect(window.end).toBe(21 + OVERSCAN_ROWS);
		expect(window.offsetY).toBe(0);
	});

	it('mounts a mid-list window with overscan on both sides', () => {
		const window = windowAt(400);
		// Row 10 is at the top edge; rows 10..29 are visible; 8 rows of overscan either side.
		expect(window.start).toBe(2);
		expect(window.end).toBe(38);
		expect(window.offsetY).toBe(2 * ROW_H);
		expect(windowSlice(ids, window)).toHaveLength(36);
		expect(windowSlice(ids, window)[0]).toBe('Notes/002.md');
		expect(windowSlice(ids, window).at(-1)).toBe('Notes/037.md');
	});

	it('mounts the last screen whole, without overscan past the end', () => {
		const window = windowAt(MAX_SCROLL);
		expect(window.start).toBe(80 - OVERSCAN_ROWS);
		expect(window.end).toBe(ROWS);
		expect(window.clampedScrollTop).toBe(MAX_SCROLL);
		expect(windowSlice(ids, window).at(-1)).toBe('Notes/099.md');
	});

	it('clamps an offset past the end to the last screen rather than mounting nothing', () => {
		const beyond = windowAt(999_999);
		expect(beyond.clampedScrollTop).toBe(MAX_SCROLL);
		expect(beyond).toEqual(windowAt(MAX_SCROLL));
	});

	it('clamps a negative offset to the top', () => {
		const negative = windowAt(-500);
		expect(negative.clampedScrollTop).toBe(0);
		expect(negative).toEqual(windowAt(0));
	});

	it('mounts exactly the rows that exist when there are fewer than one screen of them', () => {
		const window = rowWindow({
			scrollTop: 0,
			viewportHeight: VIEWPORT,
			rowHeight: ROW_H,
			rowCount: 3,
		});
		expect(window.start).toBe(0);
		expect(window.end).toBe(3);
		expect(window.totalHeight).toBe(3 * ROW_H);
	});

	it('mounts nothing, and has no scroll range, when the view has no rows', () => {
		const window = rowWindow({
			scrollTop: 120,
			viewportHeight: VIEWPORT,
			rowHeight: ROW_H,
			rowCount: 0,
		});
		expect(window.start).toBe(0);
		expect(window.end).toBe(0);
		expect(window.totalHeight).toBe(0);
		// A zero range cannot be scrolled, so the offset it reports back is zero, not the one it was given.
		expect(window.clampedScrollTop).toBe(0);
	});

	it('mounts the first row when the viewport has not been measured yet', () => {
		// An unmeasured pane (height 0) must still mount something: an empty grid with no explanation is the
		// failure mode this rule exists to prevent.
		const window = rowWindow({
			scrollTop: 0,
			viewportHeight: 0,
			rowHeight: ROW_H,
			rowCount: ROWS,
		});
		expect(window.start).toBe(0);
		expect(window.end).toBe(1 + OVERSCAN_ROWS);
	});

	it('treats a nonsensical row count or height as the nearest sensible value', () => {
		const negativeRows = rowWindow({
			scrollTop: 0,
			viewportHeight: VIEWPORT,
			rowHeight: ROW_H,
			rowCount: -5,
		});
		expect(negativeRows.end).toBe(0);
		// A row height of zero would divide by zero, so it is read as one pixel rather than throwing.
		const zeroHeight = rowWindow({
			scrollTop: 10,
			viewportHeight: VIEWPORT,
			rowHeight: 0,
			rowCount: 5,
		});
		expect(zeroHeight.totalHeight).toBe(5);
		const notFinite = rowWindow({
			scrollTop: Number.NaN,
			viewportHeight: VIEWPORT,
			rowHeight: ROW_H,
			rowCount: ROWS,
		});
		expect(notFinite.clampedScrollTop).toBe(0);
	});

	it('honours an explicit overscan, including none', () => {
		const window = rowWindow({
			scrollTop: 400,
			viewportHeight: VIEWPORT,
			rowHeight: ROW_H,
			rowCount: ROWS,
			overscan: 0,
		});
		expect(window.start).toBe(10);
		expect(window.end).toBe(30);
	});
});

describe('the three densities', () => {
	it('are the ones docs/02 names: 32, 40, 64', () => {
		expect(ROW_HEIGHTS.short).toBe(32);
		expect(ROW_HEIGHTS.medium).toBe(40);
		expect(ROW_HEIGHTS.tall).toBe(64);
		expect(rowHeightOf('tall')).toBe(64);
	});

	it('mount fewer rows of the taller density in the same viewport', () => {
		const medium = rowWindow({
			scrollTop: 0,
			viewportHeight: 800,
			rowHeight: rowHeightOf('medium'),
			rowCount: ROWS,
		});
		const tall = rowWindow({
			scrollTop: 0,
			viewportHeight: 800,
			rowHeight: rowHeightOf('tall'),
			rowCount: ROWS,
		});
		expect(medium.end).toBe(20 + OVERSCAN_ROWS);
		expect(tall.end).toBe(Math.ceil(800 / 64) + OVERSCAN_ROWS);
	});
});

describe('hit-testing a point', () => {
	it('answers the row a y offset falls on, and null past the end or above the top', () => {
		expect(rowIndexAt(0, ROW_H, ROWS)).toBe(0);
		expect(rowIndexAt(ROW_H - 1, ROW_H, ROWS)).toBe(0);
		expect(rowIndexAt(ROW_H, ROW_H, ROWS)).toBe(1);
		expect(rowIndexAt(ROW_H * 99 + 5, ROW_H, ROWS)).toBe(99);
		expect(rowIndexAt(ROW_H * 100, ROW_H, ROWS)).toBeNull();
		expect(rowIndexAt(-1, ROW_H, ROWS)).toBeNull();
		expect(rowIndexAt(10, ROW_H, 0)).toBeNull();
	});
});
