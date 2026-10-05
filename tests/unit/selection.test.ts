/**
 * Ranges: normalisation, the derived rows and columns, edges, and what happens when the rows move under the
 * selection. The degradation rule is `docs/07` §Tier 3 — "it degrades predictably (to the nearest surviving
 * row) when rows are removed" — and the boundary case (nothing survives) is a test, not a comment.
 */
import { describe, expect, it } from 'vitest';
import {
	allOf,
	cellsOf,
	clampTo,
	columnRange,
	contains,
	expandTo,
	fieldsOf,
	isSingleCell,
	isWholeColumn,
	isWholeRow,
	normalize,
	rowRange,
	rowsOf,
	sizeOf,
} from '../../src/core/selection/range';
import type { Range, RangeOrder } from '../../src/core/selection/range';

const ORDER: RangeOrder = {
	rows: ['Notes/a.md', 'Notes/b.md', 'Notes/c.md', 'Notes/d.md'],
	fields: ['note.Name', 'note.Status', 'note.Effort'],
};

/** A range between two cells, by row path and column id. */
function range(
	anchorRow: string,
	anchorField: string,
	focusRow: string,
	focusField: string,
): Range {
	return {
		anchor: { filePath: anchorRow, fieldId: anchorField },
		focus: { filePath: focusRow, fieldId: focusField },
	};
}

describe('normalisation', () => {
	it('reads a range the same way whichever corner the drag started in', () => {
		const down = normalize(
			range('Notes/a.md', 'note.Name', 'Notes/c.md', 'note.Effort'),
			ORDER,
		);
		const up = normalize(range('Notes/c.md', 'note.Effort', 'Notes/a.md', 'note.Name'), ORDER);
		expect(down).toEqual({ top: 0, bottom: 2, left: 0, right: 2 });
		expect(up).toEqual(down);
	});

	it('reads a single cell as one row, one column', () => {
		const single = normalize(
			range('Notes/b.md', 'note.Status', 'Notes/b.md', 'note.Status'),
			ORDER,
		);
		expect(single).toEqual({ top: 1, bottom: 1, left: 1, right: 1 });
	});

	it('answers null for an endpoint the order does not have, rather than inventing a position', () => {
		expect(
			normalize(range('Notes/gone.md', 'note.Name', 'Notes/a.md', 'note.Name'), ORDER),
		).toBeNull();
		expect(
			normalize(range('Notes/a.md', 'note.Gone', 'Notes/a.md', 'note.Name'), ORDER),
		).toBeNull();
	});

	it('answers null against an empty order', () => {
		const empty: RangeOrder = { rows: [], fields: [] };
		expect(
			normalize(range('Notes/a.md', 'note.Name', 'Notes/a.md', 'note.Name'), empty),
		).toBeNull();
		expect(allOf(empty)).toBeNull();
		expect(rowRange('Notes/a.md', empty)).toBeNull();
		expect(columnRange('note.Name', empty)).toBeNull();
	});
});

describe('what a range covers', () => {
	const selection = range('Notes/b.md', 'note.Status', 'Notes/c.md', 'note.Effort');

	it('lists the rows and columns in render order, not in drag order', () => {
		expect(rowsOf(selection, ORDER)).toEqual(['Notes/b.md', 'Notes/c.md']);
		expect(fieldsOf(selection, ORDER)).toEqual(['note.Status', 'note.Effort']);
	});

	it('lists the cells row by row', () => {
		expect(cellsOf(selection, ORDER)).toEqual([
			{ filePath: 'Notes/b.md', fieldId: 'note.Status' },
			{ filePath: 'Notes/b.md', fieldId: 'note.Effort' },
			{ filePath: 'Notes/c.md', fieldId: 'note.Status' },
			{ filePath: 'Notes/c.md', fieldId: 'note.Effort' },
		]);
	});

	it('counts itself', () => {
		expect(sizeOf(selection, ORDER)).toEqual({ rows: 2, fields: 2 });
		expect(
			sizeOf(range('Notes/a.md', 'note.Name', 'Notes/d.md', 'note.Effort'), ORDER),
		).toEqual({
			rows: 4,
			fields: 3,
		});
	});

	it('knows one cell from many, and a whole row from a whole column', () => {
		expect(isSingleCell(range('Notes/a.md', 'note.Name', 'Notes/a.md', 'note.Name'))).toBe(
			true,
		);
		expect(isSingleCell(selection)).toBe(false);
		expect(
			isWholeRow(range('Notes/a.md', 'note.Name', 'Notes/a.md', 'note.Effort'), ORDER),
		).toBe(true);
		expect(isWholeRow(selection, ORDER)).toBe(false);
		expect(
			isWholeColumn(range('Notes/a.md', 'note.Status', 'Notes/d.md', 'note.Status'), ORDER),
		).toBe(true);
		expect(isWholeColumn(selection, ORDER)).toBe(false);
	});

	it('contains the cells inside it and nothing else', () => {
		expect(contains(selection, { filePath: 'Notes/b.md', fieldId: 'note.Status' }, ORDER)).toBe(
			true,
		);
		expect(contains(selection, { filePath: 'Notes/c.md', fieldId: 'note.Effort' }, ORDER)).toBe(
			true,
		);
		expect(contains(selection, { filePath: 'Notes/a.md', fieldId: 'note.Status' }, ORDER)).toBe(
			false,
		);
		expect(contains(selection, { filePath: 'Notes/b.md', fieldId: 'note.Name' }, ORDER)).toBe(
			false,
		);
		expect(
			contains(selection, { filePath: 'Notes/gone.md', fieldId: 'note.Name' }, ORDER),
		).toBe(false);
	});

	it('builds the "select all", whole-row and whole-column ranges, and nothing from an empty order', () => {
		expect(allOf(ORDER)).toEqual(range('Notes/a.md', 'note.Name', 'Notes/d.md', 'note.Effort'));
		expect(rowRange('Notes/c.md', ORDER)).toEqual(
			range('Notes/c.md', 'note.Name', 'Notes/c.md', 'note.Effort'),
		);
		expect(columnRange('note.Status', ORDER)).toEqual(
			range('Notes/a.md', 'note.Status', 'Notes/d.md', 'note.Status'),
		);
	});
});

describe('edges', () => {
	it('moves the focus, keeps the anchor, and clamps at the boundary instead of refusing', () => {
		const start = range('Notes/b.md', 'note.Status', 'Notes/b.md', 'note.Status');
		expect(expandTo(start, 'down', ORDER).focus).toEqual({
			filePath: 'Notes/c.md',
			fieldId: 'note.Status',
		});
		expect(expandTo(start, 'right', ORDER).focus).toEqual({
			filePath: 'Notes/b.md',
			fieldId: 'note.Effort',
		});
		expect(expandTo(start, 'left', ORDER).focus).toEqual({
			filePath: 'Notes/b.md',
			fieldId: 'note.Name',
		});
		expect(expandTo(start, 'up', ORDER).focus).toEqual({
			filePath: 'Notes/a.md',
			fieldId: 'note.Status',
		});
		expect(expandTo(start, 'up', ORDER).anchor).toEqual(start.anchor);

		const atTop = range('Notes/a.md', 'note.Name', 'Notes/a.md', 'note.Name');
		expect(expandTo(atTop, 'up', ORDER).focus).toEqual(atTop.focus);
		expect(expandTo(atTop, 'left', ORDER).focus).toEqual(atTop.focus);
		const atEnd = range('Notes/d.md', 'note.Effort', 'Notes/d.md', 'note.Effort');
		expect(expandTo(atEnd, 'down', ORDER).focus).toEqual(atEnd.focus);
		expect(expandTo(atEnd, 'right', ORDER).focus).toEqual(atEnd.focus);
	});

	it('handles the Home/End family: row start, row end, table start, table end', () => {
		const middle = range('Notes/b.md', 'note.Status', 'Notes/b.md', 'note.Status');
		expect(expandTo(middle, 'rowStart', ORDER).focus).toEqual({
			filePath: 'Notes/b.md',
			fieldId: 'note.Name',
		});
		expect(expandTo(middle, 'rowEnd', ORDER).focus).toEqual({
			filePath: 'Notes/b.md',
			fieldId: 'note.Effort',
		});
		expect(expandTo(middle, 'tableStart', ORDER).focus).toEqual({
			filePath: 'Notes/a.md',
			fieldId: 'note.Name',
		});
		expect(expandTo(middle, 'tableEnd', ORDER).focus).toEqual({
			filePath: 'Notes/d.md',
			fieldId: 'note.Effort',
		});
	});

	it('leaves a range over a vanished cell exactly as it was', () => {
		const orphan = range('Notes/gone.md', 'note.Name', 'Notes/gone.md', 'note.Name');
		expect(expandTo(orphan, 'down', ORDER)).toEqual(orphan);
	});
});

describe('degradation when the rows or columns change', () => {
	it('keeps a surviving endpoint exactly where it was', () => {
		const selection = range('Notes/b.md', 'note.Status', 'Notes/c.md', 'note.Effort');
		const next: RangeOrder = {
			rows: ['Notes/a.md', 'Notes/c.md', 'Notes/e.md'],
			fields: ['note.Name', 'note.Status', 'note.Effort'],
		};
		const clamped = clampTo(selection, ORDER, next);
		expect(clamped?.anchor.filePath).toBe('Notes/c.md');
		expect(clamped?.focus.filePath).toBe('Notes/c.md');
	});

	it('re-seats a deleted endpoint at the nearest surviving row, which is the same index', () => {
		const selection = range('Notes/b.md', 'note.Name', 'Notes/b.md', 'note.Name');
		// 'Notes/b.md' is gone; the row that took its index is 'Notes/c.md'.
		const next: RangeOrder = {
			rows: ['Notes/a.md', 'Notes/c.md', 'Notes/d.md'],
			fields: ORDER.fields,
		};
		expect(clampTo(selection, ORDER, next)?.anchor.filePath).toBe('Notes/c.md');
	});

	it('falls back to the last surviving row when the new order is shorter', () => {
		const selection = range('Notes/d.md', 'note.Name', 'Notes/d.md', 'note.Name');
		const next: RangeOrder = { rows: ['Notes/a.md'], fields: ORDER.fields };
		expect(clampTo(selection, ORDER, next)?.anchor.filePath).toBe('Notes/a.md');
	});

	it('re-seats a deleted column the same way', () => {
		const selection = range('Notes/a.md', 'note.Effort', 'Notes/a.md', 'note.Effort');
		const next: RangeOrder = { rows: ORDER.rows, fields: ['note.Name', 'note.Status'] };
		expect(clampTo(selection, ORDER, next)?.anchor.fieldId).toBe('note.Status');
	});

	it('answers null when nothing survives, so the grid can show "no selection" instead of a dead range', () => {
		const selection = range('Notes/b.md', 'note.Name', 'Notes/c.md', 'note.Name');
		expect(clampTo(selection, ORDER, { rows: [], fields: ORDER.fields })).toBeNull();
		expect(clampTo(selection, ORDER, { rows: ORDER.rows, fields: [] })).toBeNull();
	});

	it('seats an endpoint with no previous position at the start rather than dropping it', () => {
		const orphan = range('Notes/new.md', 'note.Name', 'Notes/new.md', 'note.Name');
		const clamped = clampTo(orphan, ORDER, ORDER);
		expect(clamped?.anchor).toEqual({ filePath: 'Notes/a.md', fieldId: 'note.Name' });
	});
});
