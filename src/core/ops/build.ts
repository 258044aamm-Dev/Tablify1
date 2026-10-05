/**
 * Builders: the handful of ops whose payload has to be read *out of the state* rather than typed in.
 *
 * Three kinds carry a piece of the past with them — a deleted column's values, the rows a delete removed and
 * where they sat, the settings a view patch overwrites — and two carry a position that must be truthful for
 * the inverse to be a swap (`moveRow`, `moveRows`). Writing that by hand at every call site is where an undo
 * quietly restores the wrong thing, so each one has exactly one builder, here, next to the reason it exists.
 *
 * Every builder answers `{ ok: false, reason }` instead of throwing: a caller that asked to delete a column
 * the view does not have gets a sentence, and the store shows it.
 */
import { cellOf } from './apply';
import type { CellWrite, Op, RowId, SetViewConfigOp, TableState, ViewPatch } from './types';
import type { PropertyId } from '../types';

/** A builder's answer: the op, or why there isn't one. */
export type Built =
	{ readonly ok: true; readonly op: Op } | { readonly ok: false; readonly reason: string };

/**
 * A column-deleting op: the column's own state (so the undo restores its options and width too) plus every
 * value it holds. That list is a *column* pre-image, not a table pre-image.
 */
export function deleteFieldOp(state: TableState, fieldId: PropertyId): Built {
	const index = state.fields.findIndex((field) => field.id === fieldId);
	const field = index === -1 ? undefined : state.fields[index];
	if (field === undefined) {
		return { ok: false, reason: `there is no column "${fieldId}" in this view to delete` };
	}
	const values: CellWrite[] = [];
	for (const row of state.rows) {
		values.push({ filePath: row.filePath, fieldId: field.id, value: cellOf(row, field.id) });
	}
	return { ok: true, op: { kind: 'deleteField', at: index, field, values } };
}

/** A row-deleting op: the rows themselves, with the positions they held, so the undo restores data and order. */
export function deleteRowsOp(state: TableState, paths: readonly RowId[]): Built {
	const wanted = new Set(paths);
	const rows: { at: number; row: (typeof state.rows)[number] }[] = [];
	for (const [index, row] of state.rows.entries()) {
		if (wanted.has(row.filePath)) {
			rows.push({ at: index, row });
		}
	}
	if (rows.length === 0) {
		return { ok: false, reason: 'none of those rows are in this view' };
	}
	return { ok: true, op: { kind: 'deleteRows', rows } };
}

/**
 * A view-config op that already holds its own inverse: `previous` is read from the state for exactly the keys
 * the patch names, so `invert()` never needs a before-image for this kind. The alternative — the caller
 * assembling `previous` by hand — is where a "restore the search box" undo would quietly restore the wrong
 * value. A key that is absent from `changes` is never touched; a key set to `undefined` removes the setting.
 */
export function viewConfigOp(state: TableState, changes: ViewPatch): SetViewConfigOp {
	const has = (key: keyof ViewPatch): boolean =>
		Object.prototype.hasOwnProperty.call(changes, key);
	return {
		kind: 'setViewConfig',
		changes,
		previous: {
			...(has('search') ? { search: state.view.search } : {}),
			...(has('sorts') ? { sorts: state.view.sorts } : {}),
			...(has('groupBy') ? { groupBy: state.view.groupBy } : {}),
			...(has('collapsedKeys') ? { collapsedKeys: state.view.collapsedKeys } : {}),
			...(has('hiddenFieldIds') ? { hiddenFieldIds: state.view.hiddenFieldIds } : {}),
			...(has('columnOrder') ? { columnOrder: state.view.columnOrder } : {}),
		},
	};
}

/** The insertion index in the array *without* the moved block, from an index in the array as it is now. */
function insertionIndex(from: number, droppedAt: number, length: number): number {
	return droppedAt > from ? droppedAt - length : droppedAt;
}

/**
 * A single-row move. `from` is read from the state and `droppedAt` is the index the row was dropped on in the
 * current order; the stored `to` is the insertion index after the row is lifted out, which is the convention
 * that makes the inverse a plain swap.
 */
export function moveRowOp(state: TableState, filePath: RowId, droppedAt: number): Built {
	const from = state.rows.findIndex((row) => row.filePath === filePath);
	if (from === -1) {
		return { ok: false, reason: `the row "${filePath}" is not in this view` };
	}
	return {
		ok: true,
		op: { kind: 'moveRow', filePath, from, to: insertionIndex(from, droppedAt, 1) },
	};
}

/** A block move, by identity: the block keeps its internal order, and the target index is converted once. */
export function moveRowsOp(state: TableState, paths: readonly RowId[], droppedAt: number): Built {
	const first = paths[0];
	if (first === undefined) {
		return { ok: false, reason: 'there are no rows to move' };
	}
	const from = state.rows.findIndex((row) => row.filePath === first);
	if (from === -1) {
		return { ok: false, reason: `the row "${first}" is not in this view` };
	}
	return {
		ok: true,
		op: {
			kind: 'moveRows',
			filePaths: paths,
			from,
			to: insertionIndex(from, droppedAt, paths.length),
		},
	};
}
