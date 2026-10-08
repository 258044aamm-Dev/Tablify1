/**
 * The active-table projection — R3 step 1's decision, made concrete.
 *
 * ADR-0012 fixes the boundary: one authoritative state (the document), one *derived* view of the
 * table a pane is showing. This module is that derivation. It builds the index maps a renderer needs
 * (fields by id, rows by id, a row's index, views by id) **from** the document and never the other
 * way round: a projection is recomputed when it is asked for, is frozen, and has no method that
 * mutates anything. An edit does not go through it — an edit is an operation addressed by id
 * (`ops.ts`) applied to the document, and the projection of the next revision is derived again.
 *
 * Three derived facts live here because they are questions about *order and presentation*, not about
 * storage:
 *
 *   - **A row's display number** is its 1-based position in the selected view's visible row-id order
 *     (the manual array order for the no-view default). It is derived, never stored as an auto-number
 *     identity, and filtered/collapsed rows have no display number (R3 step 7).
 *   - **A display sequence** for a saved view's sort stack: stable, multi-key, and tie-broken by the
 *     explicit row order and then the row id (ADR-0003 §4). Evaluating a view never writes anything
 *     back: the sequence is a list of row ids in memory, and that is all it ever is.
 *   - **Value lookup** that distinguishes "no value" from "no such row/field": `cellOf` returns the
 *     stored `CellState` (absent = no value, per ADR-0004), while `rowAt`/`fieldAt` answer
 *     `undefined` for an id this table does not have.
 *
 * Comparison of values is *injected* for sorting, with a canonical default below. Sorting by type is
 * a field-type concern (a date compares as a day, a currency as a number, a select by its option
 * order in R4), and duplicating those rules here would give the codebase two answers to one question.
 * The default compares canonical values without knowing their type, which is exactly right for
 * `number`/`text`/`checkbox`, and is documented as the fallback the renderer may override.
 */
import type { CellState, TableRow } from './rows';
import { isInvalidCell } from './values';
import type { DatabaseDocument, DatabaseTable } from './schema';
import type { TableField } from './fields';
import type { TableView, ViewSort } from './views';

/**
 * One table, indexed. Every map is built on demand from `table`, and every member holds the same row
 * and field objects the document holds — nothing is copied, so a projection cannot drift from the
 * document it was derived from.
 */
export interface ActiveTableSnapshot {
	readonly tableId: string;
	readonly table: DatabaseTable;
	readonly fields: readonly TableField[];
	/** Fields this build understands, by id. An unsupported field is present but keeps its type name. */
	readonly fieldById: ReadonlyMap<string, TableField>;
	readonly rows: readonly TableRow[];
	readonly rowById: ReadonlyMap<string, TableRow>;
	/** A row's 0-based position in the explicit manual order (ADR-0003): the sort tie-break. */
	readonly rowIndexById: ReadonlyMap<string, number>;
	readonly views: readonly TableView[];
	readonly viewById: ReadonlyMap<string, TableView>;
	readonly rowCount: number;
}

/** The projection of one table, or `null` when the document has no table with that id. */
export function projectTable(
	document: DatabaseDocument,
	tableId: string,
): ActiveTableSnapshot | null {
	const table = document.tables.find((candidate) => candidate.id === tableId);
	if (table === undefined) {
		return null;
	}
	const fieldById = new Map<string, TableField>();
	for (const field of table.fields) {
		if (field.id !== null) {
			fieldById.set(field.id, field);
		}
	}
	const rowById = new Map<string, TableRow>();
	const rowIndexById = new Map<string, number>();
	table.rows.forEach((row, index) => {
		rowById.set(row.id, row);
		rowIndexById.set(row.id, index);
	});
	const viewById = new Map<string, TableView>();
	for (const view of table.views) {
		viewById.set(view.id, view);
	}
	return {
		tableId: table.id,
		table,
		fields: table.fields,
		fieldById,
		rows: table.rows,
		rowById,
		rowIndexById,
		views: table.views,
		viewById,
		rowCount: table.rows.length,
	};
}

/** One row of this table, or `undefined` when the id belongs to no row here. */
export function rowAt(snapshot: ActiveTableSnapshot, rowId: string): TableRow | undefined {
	return snapshot.rowById.get(rowId);
}

/** One field of this table, or `undefined` when the id belongs to no field here. */
export function fieldAt(snapshot: ActiveTableSnapshot, fieldId: string): TableField | undefined {
	return snapshot.fieldById.get(fieldId);
}

/** One saved view of this table, or `undefined`. A view id from another table resolves to nothing. */
export function viewAt(snapshot: ActiveTableSnapshot, viewId: string): TableView | undefined {
	return snapshot.viewById.get(viewId);
}

/**
 * The stored state of a cell: a canonical value, a preserved invalid value, or `undefined`.
 *
 * `undefined` means "no value was stored" — ADR-0004's first state, which is the same thing as an
 * explicit `null` in the file. It is *not* an error: a row that never had that cell is the normal
 * case. Whether the row or the field even exist is a different question, asked with `rowAt`/`fieldAt`.
 */
export function cellOf(
	snapshot: ActiveTableSnapshot,
	rowId: string,
	fieldId: string,
): CellState | undefined {
	return snapshot.rowById.get(rowId)?.cells.get(fieldId);
}

/**
 * The value a native view should read for one field.
 *
 * Ordinary fields return their stored cell state (including a preserved invalid value). The two
 * read-only time fields are different: `createdTime` derives from `row.createdAt`, and
 * `lastModifiedTime` derives from `row.updatedAt`. An erroneous raw cell for either field remains
 * available through {@link cellOf} for lossless repair, but can never override row metadata.
 */
export function viewCellOf(
	snapshot: ActiveTableSnapshot,
	rowId: string,
	fieldId: string,
): CellState | undefined {
	const row = snapshot.rowById.get(rowId);
	const field = snapshot.fieldById.get(fieldId);
	if (row === undefined || field === undefined) {
		return undefined;
	}
	if (field.kind === 'field') {
		if (field.type === 'createdTime') {
			return row.createdAt;
		}
		if (field.type === 'lastModifiedTime') {
			return row.updatedAt;
		}
	}
	return row.cells.get(fieldId);
}

/**
 * A row's 1-based number in the current output order, or `null` when it is not in that order.
 *
 * Pass the visible row ids from the selected view result to number filtered/sorted output. Without that
 * argument, the default view uses the document's manual row order. The value is always derived; no
 * auto-number identity is stored in a row.
 */
export function rowNumber(
	snapshot: ActiveTableSnapshot,
	rowId: string,
	visibleRowIds?: readonly string[],
): number | null {
	if (visibleRowIds === undefined) {
		const index = snapshot.rowIndexById.get(rowId);
		return index === undefined ? null : index + 1;
	}
	let position = 0;
	for (const visibleRowId of visibleRowIds) {
		if (!snapshot.rowById.has(visibleRowId)) {
			continue;
		}
		position += 1;
		if (visibleRowId === rowId) {
			return position;
		}
	}
	return null;
}

/**
 * Order two canonical values the field-agnostic way.
 *
 * `null` (no value) sorts last in ascending order, which is how a spreadsheet reads: empty rows
 * collect at the bottom rather than pushing real values down. Numbers compare numerically, strings by
 * code units (the same order for every locale, so two machines never disagree about a saved view),
 * booleans false-before-true, and string lists lexicographically. A preserved invalid value is
 * compared by its printed form, so it participates instead of throwing — an unreadable cell must not
 * break the grid.
 */
export function compareCanonical(a: CellState | undefined, b: CellState | undefined): number {
	const left = comparable(a);
	const right = comparable(b);
	if (left === null && right === null) {
		return 0;
	}
	if (left === null) {
		return 1;
	}
	if (right === null) {
		return -1;
	}
	if (typeof left === 'number' && typeof right === 'number') {
		return left === right ? 0 : left < right ? -1 : 1;
	}
	if (typeof left === 'boolean' && typeof right === 'boolean') {
		return left === right ? 0 : left ? 1 : -1;
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		// Two lists compare item by item. `at()` is used rather than indexing so the types stay honest
		// under `noUncheckedIndexedAccess`: past the end it answers `undefined`, which is the "no value"
		// this comparator already handles — but the loop stops at the shorter list, so it never asks.
		const shortest = Math.min(left.length, right.length);
		for (let index = 0; index < shortest; index += 1) {
			const part = compareCanonical(cellAt(left, index), cellAt(right, index));
			if (part !== 0) {
				return part;
			}
		}
		return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
	}
	// Mixed shapes (a number against a string, say) are a document that disagrees with its field
	// type. They still order deterministically: by kind name, then by text.
	const leftKind = kindOf(left);
	const rightKind = kindOf(right);
	if (leftKind !== rightKind) {
		return leftKind < rightKind ? -1 : 1;
	}
	const leftText = String(left);
	const rightText = String(right);
	return leftText === rightText ? 0 : leftText < rightText ? -1 : 1;
}

/**
 * The comparable form of a stored value.
 *
 * Three kinds of input become `null` — no value at all, an explicit `null`, and an empty list — which
 * is the same collapse the model makes everywhere else (ADR-0004: `[]` is no value for a list kind).
 * A preserved invalid value is compared by its printed JSON: an unreadable cell must participate in
 * a sort rather than throw, and two different unreadable values must still order deterministically.
 */
function comparable(
	value: CellState | undefined,
): string | number | boolean | readonly string[] | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (isInvalidCell(value)) {
		// A preserved invalid value, compared by the file's own spelling of it.
		return JSON.stringify(value.raw);
	}
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}
	return value.length === 0 ? null : value;
}

/** One item of a canonical list, as a cell value so it compares by the same rules. */
function cellAt(list: readonly string[], index: number): CellState | undefined {
	return list.at(index);
}

function kindOf(value: string | number | boolean | readonly string[]): string {
	if (typeof value === 'number') {
		return 'a';
	}
	if (typeof value === 'boolean') {
		return 'b';
	}
	if (Array.isArray(value)) {
		return 'c';
	}
	return 'd';
}

/** How one field's values compare. Injected so R4 can use the field type's own comparison. */
export type FieldComparison = (
	fieldId: string,
	a: CellState | undefined,
	b: CellState | undefined,
) => number;

/** The default comparison: canonical values, no type knowledge. */
export const canonicalComparison: FieldComparison = (_fieldId, a, b) => compareCanonical(a, b);

/**
 * The display sequence for a list of sorts: row ids, in order.
 *
 * The rules, in the order they apply (ADR-0003 §4):
 *
 *   1. the sort stack, first key first (`asc`/`desc` as the view stored them) — and `desc` is the
 *      mirror of `asc`, not a different ordering, so "no value" (the top of {@link compareCanonical})
 *      lands first going down and last going up, exactly as the legacy descriptors did;
 *   2. equal keys fall back to the table's **explicit manual order** — the rows array's order, which
 *      is the one sequence the document really has;
 *   3. and then to the row id, which is already unique per table, so this last rule is a statement of
 *      determinism rather than a case that happens.
 *
 * An empty sort stack returns the manual order unchanged. The result is a new array of ids: sorting
 * a view never touches the document, and re-running it on the same document revision returns the
 * same sequence (both are asserted).
 */
export function sortRowIds(
	snapshot: ActiveTableSnapshot,
	sorts: readonly ViewSort[],
	compare: FieldComparison = canonicalComparison,
): readonly string[] {
	const ids = snapshot.rows.map((row) => row.id);
	if (sorts.length === 0) {
		return ids;
	}
	const cellOfRow = (rowId: string, fieldId: string): CellState | undefined =>
		cellOf(snapshot, rowId, fieldId);
	const manual = (rowId: string): number =>
		snapshot.rowIndexById.get(rowId) ?? Number.MAX_SAFE_INTEGER;
	const byKeys = (leftId: string, rightId: string): number => {
		for (const sort of sorts) {
			const part = compare(
				sort.fieldId,
				cellOfRow(leftId, sort.fieldId),
				cellOfRow(rightId, sort.fieldId),
			);
			if (part !== 0) {
				return sort.direction === 'desc' ? -part : part;
			}
		}
		const position = manual(leftId) - manual(rightId);
		if (position !== 0) {
			return position;
		}
		return leftId === rightId ? 0 : leftId < rightId ? -1 : 1;
	};
	return ids.slice().sort(byKeys);
}

/** The saved view a display sequence was evaluated for, or the manual order when there is none. */
export function displayOrder(
	snapshot: ActiveTableSnapshot,
	viewId: string | null,
	compare: FieldComparison = canonicalComparison,
): readonly string[] {
	const view = viewId === null ? undefined : viewAt(snapshot, viewId);
	if (view === undefined) {
		return snapshot.rows.map((row) => row.id);
	}
	return sortRowIds(snapshot, view.sorts, compare);
}
