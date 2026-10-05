/**
 * Ranges: the one focus concept the grid has (`docs/01` §Core interaction model — "an active cell inside a
 * range").
 *
 * A range is an anchor and a focus, where focus is the active cell. Everything else — which rows, which
 * columns, whether the selection is reversed — is derived from the *order* the view currently has, so a
 * range means the same thing after a re-sort even though the rows moved. Nothing here holds a snapshot of
 * the rows: a range that survives a re-query is exactly a range whose two cells still exist.
 *
 * The Tier-3 rule from `docs/07` §Tier 3 — "it degrades predictably (to the nearest surviving row) when rows
 * are removed" — is `clampTo`: endpoints are looked up in the *previous* order to learn where they were, and
 * then re-seated at the same position in the new order, which is the nearest row that survived. A selection
 * whose rows are all gone comes back as `null`, which the grid reads as "no selection" instead of a range
 * pointing at nothing.
 */
import type { CellRef, RowId } from '../ops/types';
import type { PropertyId } from '../types';

/** The two axes a range is expressed against, in render order. */
export type RangeOrder = {
	readonly rows: readonly RowId[];
	readonly fields: readonly PropertyId[];
};

/** An anchor (where the selection started) and a focus (the active cell). */
export type Range = {
	readonly anchor: CellRef;
	readonly focus: CellRef;
};

/** A range reduced to positions. `top`/`bottom` are row indexes, `left`/`right` column indexes. */
export type Bounds = {
	readonly top: number;
	readonly bottom: number;
	readonly left: number;
	readonly right: number;
};

/** How `expandTo` moves the focus. Arrows and the Home/End family, named the way the keyboard does. */
export type Edge =
	'up' | 'down' | 'left' | 'right' | 'rowStart' | 'rowEnd' | 'tableStart' | 'tableEnd';

/** Index lookup for one axis, built once per call. */
function indexOf(values: readonly string[]): Map<string, number> {
	const map = new Map<string, number>();
	for (const [index, value] of values.entries()) {
		map.set(value, index);
	}
	return map;
}

/** The position of a cell, or `null` when either of its ends is not in this order. */
export function cellPosition(
	cell: CellRef,
	order: RangeOrder,
): { readonly row: number; readonly field: number } | null {
	const row = indexOf(order.rows).get(cell.filePath);
	const field = indexOf(order.fields).get(cell.fieldId);
	if (row === undefined || field === undefined) {
		return null;
	}
	return { row, field };
}

/**
 * The range as positions, normalised so `top ≤ bottom` and `left ≤ right` whatever the drag direction was.
 * `null` when an endpoint is not in this order — a range over a row that has gone.
 */
export function normalize(range: Range, order: RangeOrder): Bounds | null {
	const rows = indexOf(order.rows);
	const fields = indexOf(order.fields);
	const anchorRow = rows.get(range.anchor.filePath);
	const anchorField = fields.get(range.anchor.fieldId);
	const focusRow = rows.get(range.focus.filePath);
	const focusField = fields.get(range.focus.fieldId);
	if (anchorRow === undefined || anchorField === undefined) {
		return null;
	}
	if (focusRow === undefined || focusField === undefined) {
		return null;
	}
	return {
		top: Math.min(anchorRow, focusRow),
		bottom: Math.max(anchorRow, focusRow),
		left: Math.min(anchorField, focusField),
		right: Math.max(anchorField, focusField),
	};
}

/** Whether the cell is inside the range. One pair of index maps per call; see the note in PROGRESS.md. */
export function contains(range: Range, cell: CellRef, order: RangeOrder): boolean {
	const rows = indexOf(order.rows);
	const fields = indexOf(order.fields);
	const anchorRow = rows.get(range.anchor.filePath);
	const anchorField = fields.get(range.anchor.fieldId);
	const focusRow = rows.get(range.focus.filePath);
	const focusField = fields.get(range.focus.fieldId);
	const row = rows.get(cell.filePath);
	const field = fields.get(cell.fieldId);
	if (
		anchorRow === undefined ||
		anchorField === undefined ||
		focusRow === undefined ||
		focusField === undefined ||
		row === undefined ||
		field === undefined
	) {
		return false;
	}
	return (
		row >= Math.min(anchorRow, focusRow) &&
		row <= Math.max(anchorRow, focusRow) &&
		field >= Math.min(anchorField, focusField) &&
		field <= Math.max(anchorField, focusField)
	);
}

/** The row ids the range covers, in render order. */
export function rowsOf(range: Range, order: RangeOrder): readonly RowId[] {
	const bounds = normalize(range, order);
	return bounds === null ? [] : order.rows.slice(bounds.top, bounds.bottom + 1);
}

/** The column ids the range covers, in render order. */
export function fieldsOf(range: Range, order: RangeOrder): readonly PropertyId[] {
	const bounds = normalize(range, order);
	return bounds === null ? [] : order.fields.slice(bounds.left, bounds.right + 1);
}

/** Every cell of the range, row by row — the shape the clipboard and a bulk edit consume. */
export function cellsOf(range: Range, order: RangeOrder): readonly CellRef[] {
	const bounds = normalize(range, order);
	if (bounds === null) {
		return [];
	}
	const cells: CellRef[] = [];
	for (let row = bounds.top; row <= bounds.bottom; row += 1) {
		const filePath = order.rows[row];
		if (filePath === undefined) {
			continue;
		}
		for (let field = bounds.left; field <= bounds.right; field += 1) {
			const fieldId = order.fields[field];
			if (fieldId !== undefined) {
				cells.push({ filePath, fieldId });
			}
		}
	}
	return cells;
}

/** How many rows and columns the range covers. */
export function sizeOf(
	range: Range,
	order: RangeOrder,
): { readonly rows: number; readonly fields: number } {
	const bounds = normalize(range, order);
	if (bounds === null) {
		return { rows: 0, fields: 0 };
	}
	return { rows: bounds.bottom - bounds.top + 1, fields: bounds.right - bounds.left + 1 };
}

/** True when the anchor and the focus are the same cell. */
export function isSingleCell(range: Range): boolean {
	return (
		range.anchor.filePath === range.focus.filePath &&
		range.anchor.fieldId === range.focus.fieldId
	);
}

/** True when the range covers every column, whatever the rows. Drives the row handle's context menu. */
export function isWholeRow(range: Range, order: RangeOrder): boolean {
	const bounds = normalize(range, order);
	if (bounds === null) {
		return false;
	}
	return bounds.left === 0 && bounds.right === order.fields.length - 1;
}

/** True when the range covers every row. Drives the column menu's "select column". */
export function isWholeColumn(range: Range, order: RangeOrder): boolean {
	const bounds = normalize(range, order);
	if (bounds === null) {
		return false;
	}
	return bounds.top === 0 && bounds.bottom === order.rows.length - 1;
}

/** The whole table as a range: `Cmd/Ctrl+A` (`docs/01` — "Select all rows in the current view"). */
export function allOf(order: RangeOrder): Range | null {
	const first = order.rows[0];
	const last = order.rows[order.rows.length - 1];
	const firstField = order.fields[0];
	const lastField = order.fields[order.fields.length - 1];
	if (
		first === undefined ||
		last === undefined ||
		firstField === undefined ||
		lastField === undefined
	) {
		return null;
	}
	return {
		anchor: { filePath: first, fieldId: firstField },
		focus: { filePath: last, fieldId: lastField },
	};
}

/** One row, all columns. */
export function rowRange(filePath: RowId, order: RangeOrder): Range | null {
	const firstField = order.fields[0];
	const lastField = order.fields[order.fields.length - 1];
	if (firstField === undefined || lastField === undefined) {
		return null;
	}
	return { anchor: { filePath, fieldId: firstField }, focus: { filePath, fieldId: lastField } };
}

/** One column, all rows. */
export function columnRange(fieldId: PropertyId, order: RangeOrder): Range | null {
	const firstRow = order.rows[0];
	const lastRow = order.rows[order.rows.length - 1];
	if (firstRow === undefined || lastRow === undefined) {
		return null;
	}
	return { anchor: { filePath: firstRow, fieldId }, focus: { filePath: lastRow, fieldId } };
}

/**
 * Moves the focus to an edge, keeping the anchor — Shift+Arrow, Home/End, Ctrl+Home/Ctrl+End. An edge that
 * leaves the grid is clamped to it rather than refused: holding Shift+Down at the last row keeps selecting
 * the last row, which is what every spreadsheet does.
 */
export function expandTo(range: Range, edge: Edge, order: RangeOrder): Range {
	const focus = cellPosition(range.focus, order) ?? cellPosition(range.anchor, order);
	if (focus === null) {
		return range;
	}
	const lastRow = order.rows.length - 1;
	const lastField = order.fields.length - 1;
	let row = focus.row;
	let field = focus.field;
	switch (edge) {
		case 'up':
			row = focus.row - 1;
			break;
		case 'down':
			row = focus.row + 1;
			break;
		case 'left':
			field = focus.field - 1;
			break;
		case 'right':
			field = focus.field + 1;
			break;
		case 'rowStart':
			field = 0;
			break;
		case 'rowEnd':
			field = lastField;
			break;
		case 'tableStart':
			row = 0;
			field = 0;
			break;
		case 'tableEnd':
			row = lastRow;
			field = lastField;
			break;
	}
	const filePath = order.rows[Math.min(Math.max(row, 0), lastRow)];
	const fieldId = order.fields[Math.min(Math.max(field, 0), lastField)];
	if (filePath === undefined || fieldId === undefined) {
		return range;
	}
	return { anchor: range.anchor, focus: { filePath, fieldId } };
}

/**
 * Re-seats a range in a new order. An endpoint that survived keeps its cell; an endpoint whose row or column
 * is gone takes the nearest surviving position — the same index, or the last one when the new order is
 * shorter (`docs/07` §Tier 3). `null` when nothing survives, which the grid shows as "no selection".
 */
export function clampTo(range: Range, previous: RangeOrder, next: RangeOrder): Range | null {
	const seat = (cell: CellRef): CellRef | null => {
		if (next.rows.length === 0 || next.fields.length === 0) {
			return null;
		}
		const wasAt = cellPosition(cell, previous);
		// A row that survived keeps its own cell, wherever it moved to in the new order; only an endpoint whose
		// row is gone is re-seated, at the index it used to hold (clamped to the shorter list).
		const survivedRow = next.rows.indexOf(cell.filePath);
		const survivedField = next.fields.indexOf(cell.fieldId);
		const row =
			survivedRow !== -1
				? survivedRow
				: wasAt === null
					? 0
					: Math.min(wasAt.row, next.rows.length - 1);
		const field =
			survivedField !== -1
				? survivedField
				: wasAt === null
					? 0
					: Math.min(wasAt.field, next.fields.length - 1);
		const filePath = next.rows[row];
		const fieldId = next.fields[field];
		if (filePath === undefined || fieldId === undefined) {
			return null;
		}
		return { filePath, fieldId };
	};
	const anchor = seat(range.anchor);
	const focus = seat(range.focus);
	if (anchor === null || focus === null) {
		return null;
	}
	return { anchor, focus };
}
