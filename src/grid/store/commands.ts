/**
 * The command layer: what the toolbar, the keyboard and the menus all call.
 *
 * Every function here is thin — it builds ops, or asks the state a question, and hands the result to
 * `store.dispatch`. Nothing touches the DOM, nothing imports `obsidian`, and nothing reaches into
 * `src/adapters/**`: the store owns the write path, and a command that wrote its own file would be a second
 * one. That is also why every function takes the store as its first argument instead of being a method: a
 * menu item, a key binding and a test all call the same function with the same signature.
 *
 * Two rules are visible in the return types:
 *
 *   · **A command that cannot run returns the reason**, never throws. `deleteRows` on rows that are not in
 *     the view, `moveRowBy` past either end, `undo` with an empty stack: each answers with a sentence the UI
 *     can show. (`core/ops/build.ts`'s builders already work this way; this layer keeps the property.)
 *   · **Labels are written once, here.** They are the wording of the undo step *and* of the toast, and two
 *     places inventing "Undo paste" and "Undo 400 cells" is how a UI starts sounding like two products.
 */
import { deleteRowsOp, moveRowOp, viewConfigOp } from '../../core/ops/build';
import { expandTo, cellsOf, normalize } from '../../core/selection/range';
import type { Edge, Range, RangeOrder } from '../../core/selection/range';
import type { CellRef, CellWrite, Op, PlacedRow, RowId } from '../../core/ops/types';
import type { CellValue, PropertyId } from '../../core/types';
import type { ViewPatch } from '../../core/ops/types';
import type { GridStore } from './types';

/** A command's answer: it ran, or here is why it did not. */
export type CommandResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const OK: CommandResult = { ok: true };
const no = (reason: string): CommandResult => ({ ok: false, reason });

/** The order a range is expressed against, read from the store's current snapshot. */
function orderOf(store: GridStore): RangeOrder {
	return store.getSnapshot().order;
}

/** How many rows a phrase should name: `1 row`, `400 rows`. */
function plural(count: number, one: string, many: string): string {
	return count === 1 ? `${String(count)} ${one}` : `${String(count)} ${many}`;
}

/* ── values ────────────────────────────────────────────────────────────────── */

/**
 * Writes one cell. The value is canonical (`CellValue`): turning text into a value is the cell editor's job,
 * and doing it here would put the registry's parsing on a path three callers share.
 */
export function setCell(
	store: GridStore,
	ref: CellRef,
	value: CellValue,
	label?: string,
): CommandResult {
	const before = store.state().table.rows.find((row) => row.filePath === ref.filePath);
	if (before === undefined) {
		return no(`the row "${ref.filePath}" is not in this view`);
	}
	if (!store.getSnapshot().order.fields.includes(ref.fieldId)) {
		return no(`the column "${ref.fieldId}" is not in this view`);
	}
	store.dispatch({
		label: label ?? 'Edit cell',
		ops: [{ kind: 'setCell', filePath: ref.filePath, fieldId: ref.fieldId, value }],
	});
	return OK;
}

/** Writes many cells as one step: a paste, a bulk column edit, a fill. */
export function setCells(
	store: GridStore,
	writes: readonly CellWrite[],
	label: string,
): CommandResult {
	if (writes.length === 0) {
		return no('there is nothing to write');
	}
	return writeWrites(store, writes, label);
}

function writeWrites(store: GridStore, writes: readonly CellWrite[], label: string): CommandResult {
	const known = new Set(store.getSnapshot().rows);
	const live = writes.filter((write) => known.has(write.filePath));
	if (live.length === 0) {
		return no('none of those rows are in this view');
	}
	const ops: Op[] =
		live.length === 1 && live[0] !== undefined
			? [
					{
						kind: 'setCell',
						filePath: live[0].filePath,
						fieldId: live[0].fieldId,
						value: live[0].value,
					},
				]
			: [{ kind: 'setCells', writes: live }];
	store.dispatch({ label, ops });
	return OK;
}

/**
 * Clears every cell in the range. One op, so it is one undo step and one queue batch — the shape of a
 * 400-cell clear is the shape of a 400-cell paste.
 */
export function clearSelection(store: GridStore): CommandResult {
	const snapshot = store.getSnapshot();
	if (snapshot.selection === null) {
		return no('nothing is selected');
	}
	const cells = cellsOf(snapshot.selection, snapshot.order);
	if (cells.length === 0) {
		return no('the selection holds no cells');
	}
	store.dispatch({
		label: `Clear ${plural(cells.length, 'cell', 'cells')}`,
		ops: [{ kind: 'clearCells', cells }],
	});
	return OK;
}

/**
 * Fills the top row of the range down over the rest of it, or the left column across.
 *
 * The direction is decided by the range, not by an argument: a one-row range cannot fill down and a
 * one-column range cannot fill right, and both answer with a sentence instead of writing nothing.
 */
export function fillDown(store: GridStore): CommandResult {
	return fill(store, 'down');
}

export function fillRight(store: GridStore): CommandResult {
	return fill(store, 'right');
}

function fill(store: GridStore, direction: 'down' | 'right'): CommandResult {
	const snapshot = store.getSnapshot();
	const bounds =
		snapshot.selection === null ? null : normalize(snapshot.selection, snapshot.order);
	if (bounds === null) {
		return no('nothing is selected');
	}
	const rows = snapshot.order.rows.slice(bounds.top, bounds.bottom + 1);
	const fields = snapshot.order.fields.slice(bounds.left, bounds.right + 1);
	const state = store.state();
	const writes: CellWrite[] = [];
	const cellValue = (filePath: RowId, fieldId: PropertyId): CellValue => {
		const row = state.table.rows.find((candidate) => candidate.filePath === filePath);
		return row === undefined ? null : (row.cells[fieldId] ?? null);
	};

	if (direction === 'down') {
		if (rows.length < 2) {
			return no('the selection needs more than one row to fill down');
		}
		const source = rows[0];
		if (source === undefined) {
			return no('the selection holds no rows');
		}
		for (const filePath of rows.slice(1)) {
			for (const fieldId of fields) {
				writes.push({ filePath, fieldId, value: cellValue(source, fieldId) });
			}
		}
	} else {
		if (fields.length < 2) {
			return no('the selection needs more than one column to fill right');
		}
		const source = fields[0];
		if (source === undefined) {
			return no('the selection holds no columns');
		}
		for (const fieldId of fields.slice(1)) {
			for (const filePath of rows) {
				writes.push({ filePath, fieldId, value: cellValue(filePath, source) });
			}
		}
	}

	return writeWrites(
		store,
		writes,
		`Fill ${direction} ${plural(writes.length, 'cell', 'cells')}`,
	);
}

/* ── rows ──────────────────────────────────────────────────────────────────── */

/**
 * Adds a row. The row itself is built by the caller — a note's path and its starting values are the source's
 * business (`docs/02` §Rows become notes: an adapter creates the note) — and this command is what makes the
 * insertion one undo step.
 */
export function addRow(store: GridStore, row: PlacedRow, label = 'Add row'): CommandResult {
	const known = new Set(store.getSnapshot().rows);
	if (known.has(row.row.filePath)) {
		return no(`the row "${row.row.filePath}" is already in this view`);
	}
	store.dispatch({ label, ops: [{ kind: 'addRow', at: row.at, row: row.row }] });
	return OK;
}

/** Removes rows, carrying their values so the undo is a real restore. */
export function deleteRows(store: GridStore, paths: readonly RowId[]): CommandResult {
	if (paths.length === 0) {
		return no('no rows were named');
	}
	const built = deleteRowsOp(store.state().table, paths);
	if (!built.ok) {
		return built;
	}
	store.dispatch({ label: `Delete ${plural(paths.length, 'row', 'rows')}`, ops: [built.op] });
	return OK;
}

/** Moves one row by a number of places: the arrow keys, and the "move up/down" menu items. */
export function moveRowBy(store: GridStore, filePath: RowId, delta: number): CommandResult {
	const order = store.getSnapshot().order.rows;
	const from = order.indexOf(filePath);
	if (from === -1) {
		return no(`the row "${filePath}" is not in this view`);
	}
	const to = Math.min(order.length - 1, Math.max(0, from + delta));
	if (to === from) {
		return no(
			delta < 0 ? 'that row is already at the top' : 'that row is already at the bottom',
		);
	}
	const built = moveRowOp(store.state().table, filePath, to);
	if (!built.ok) {
		return built;
	}
	store.dispatch({ label: `Move row ${delta < 0 ? 'up' : 'down'}`, ops: [built.op] });
	return OK;
}

/**
 * Moves a row to an absolute index in the **current** order — what a drag-and-drop drop means.
 *
 * `moveRowBy` is the keyboard's nudge and takes a delta; a drop names a place. Both end in the same `moveRow`
 * op, so a drag is one undo step like everything else, and neither is a special case in the store.
 */
export function moveRowTo(store: GridStore, filePath: RowId, to: number): CommandResult {
	const order = store.getSnapshot().order.rows;
	const from = order.indexOf(filePath);
	if (from === -1) {
		return no(`the row "${filePath}" is not in this view`);
	}
	if (to === from) {
		return no('the row is already there');
	}
	const target = to > from ? to - 1 : to;
	const built = moveRowOp(store.state().table, filePath, target);
	if (!built.ok) {
		return built;
	}
	store.dispatch({ label: 'Move row', ops: [built.op] });
	return OK;
}

/* ── columns and the view ──────────────────────────────────────────────────── */

/** Sets a column's width. `null` returns it to the grid's own default. */
export function resizeColumn(
	store: GridStore,
	fieldId: PropertyId,
	width: number | null,
): CommandResult {
	const field = store.state().table.fields.find((candidate) => candidate.id === fieldId);
	if (field === undefined) {
		return no(`there is no column "${fieldId}" in this view`);
	}
	if (field.width === width) {
		return no('the column is already that wide');
	}
	store.dispatch({
		label: width === null ? 'Reset column width' : `Resize column to ${String(width)}px`,
		ops: [{ kind: 'resizeColumn', fieldId, from: field.width, to: width }],
	});
	return OK;
}

/**
 * Moves a column, as a **view** change — which is what a person dragging a column is asking for.
 *
 * This was the one real bug step 20's menu test found: the command used to dispatch the core `reorderColumn` op,
 * which reorders the *table's* fields, and the grid renders `ViewResult.columnOrder` — configured columns first,
 * then the rest in schema order (`docs/02` §the view pipeline). So the op moved an array nothing displayed and the
 * drag looked like it did nothing at all. The order a person drags into place is the **view's** order and belongs
 * in the `.base` sidecar (`docs/03` §where-things-live), next to the sort chain and the hidden columns — which is
 * also why it is one `setViewConfig` op: one command, one undo step, one thing to write back.
 *
 * `to` is an **insertion index into the order as it is right now**, which is what a drop indicator draws and what
 * the header menu's "Move right" means by `index + 1`. The core `reorderColumn` op keeps its own convention for
 * callers that reorder the schema itself; this command does the arithmetic for the view.
 */
export function reorderColumn(store: GridStore, fieldId: PropertyId, to: number): CommandResult {
	const order = store.getSnapshot().order.fields;
	const from = order.indexOf(fieldId);
	if (from === -1) {
		return no(`there is no column "${fieldId}" in this view`);
	}
	const clamped = Math.min(order.length - 1, Math.max(0, Math.round(to)));
	if (clamped === from) {
		return no('the column is already there');
	}
	const next = [...order];
	next.splice(from, 1);
	next.splice(clamped, 0, fieldId);
	store.dispatch({
		label: 'Reorder column',
		ops: [viewConfigOp(store.state().table, { columnOrder: next })],
	});
	return OK;
}

/** Writes view options through as one step, so "clear the search box" is undoable like anything else. */
export function setViewConfig(
	store: GridStore,
	patch: ViewPatch,
	label = 'Change view',
): CommandResult {
	const op = viewConfigOp(store.state().table, patch);
	store.dispatch({ label, ops: [op] });
	return OK;
}

/** Collapses or expands one group in a grouped view. */
export function toggleGroup(store: GridStore, key: string): CommandResult {
	const snapshot = store.getSnapshot();
	const group = snapshot.result.groups.find((candidate) => candidate.key === key);
	if (group === undefined) {
		return no(`there is no group "${key}" in this view`);
	}
	store.dispatch({
		label: group.collapsed ? 'Expand group' : 'Collapse group',
		ops: [{ kind: 'setGroupCollapse', key, collapsed: !group.collapsed }],
	});
	return OK;
}

/* ── selection ─────────────────────────────────────────────────────────────── */

/** Sets the range, or clears it with `null`. */
export function setSelection(store: GridStore, range: Range | null): CommandResult {
	store.select(range);
	return OK;
}

/** Selects one cell — the click path, and the landing spot of every arrow key. */
export function selectCell(store: GridStore, ref: CellRef): CommandResult {
	store.select({ anchor: ref, focus: ref });
	return OK;
}

/**
 * Moves the range's focus: the keyboard's arrows, Home/End, and the pointer's shift-drag. `extend` is what
 * makes Shift+Arrow a range rather than a move — the anchor stays where it was.
 */
export function extendSelection(store: GridStore, edge: Edge, extend = true): CommandResult {
	const snapshot = store.getSnapshot();
	const order = orderOf(store);
	const firstRow = order.rows[0];
	const firstField = order.fields[0];
	if (firstRow === undefined || firstField === undefined) {
		return no('this view has no cells to move through');
	}
	const start: CellRef = { filePath: firstRow, fieldId: firstField };
	const current: Range = snapshot.selection ?? { anchor: start, focus: start };
	const moved = expandTo(current, edge, order);
	return setSelection(store, extend ? moved : { anchor: moved.focus, focus: moved.focus });
}

/** The cells the current range covers — what the clipboard copies, and what a bulk write writes. */
export function selectionCells(store: GridStore): readonly CellRef[] {
	const snapshot = store.getSnapshot();
	return snapshot.selection === null ? [] : cellsOf(snapshot.selection, snapshot.order);
}

/* ── history and the queue ─────────────────────────────────────────────────── */

export function undo(store: GridStore): CommandResult {
	const label = store.getSnapshot().undoLabel;
	if (label === null) {
		return no('there is nothing to undo');
	}
	store.undo();
	return OK;
}

export function redo(store: GridStore): CommandResult {
	if (!store.getSnapshot().canRedo) {
		return no('there is nothing to redo');
	}
	store.redo();
	return OK;
}

/** Waits for every queued write. Called on blur, on view close, and before a bulk import. */
export function flush(store: GridStore): Promise<void> {
	return store.flush();
}
