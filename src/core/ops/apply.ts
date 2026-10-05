/**
 * Applying an op: the pure reducer that turns a `TableState` plus one op into the next state.
 *
 * It is total and silent about nothing. Every piece of an op that cannot be carried out — a cell in a row
 * that was deleted a moment ago, a field the view no longer has, a row that already exists — comes back in
 * `skipped` with a reason a person can read. That matters more than it sounds: undo runs against a state
 * that has moved on (another pane deleted a note, a sync pulled a change), and an undo that silently drops
 * half a paste must be able to say so instead of looking like it worked.
 *
 * Cost: one pass per op, over the rows it touches. `setCells` and `importBlock` are single-pass by design —
 * a 400-cell paste is one op and one pass, not 400 — and every op returns the untouched row objects
 * themselves, so nothing downstream that compares identities sees spurious changes.
 */
import type { CellValue, PropertyId } from '../types';
import type { FieldState, Op, RowId, RowState, TableState, ViewPatch } from './types';
import type { Applied, Before, CellWrite, Skipped } from './types';

/** Reads one cell, with a missing key and an empty cell normalised to `null`. */
export function cellOf(row: RowState, fieldId: PropertyId): CellValue {
	return row.cells[fieldId] ?? null;
}

/** The row with this path, or `undefined`. */
export function rowAt(state: TableState, filePath: RowId): RowState | undefined {
	return state.rows.find((row) => row.filePath === filePath);
}

/** The column with this id, or `undefined`. */
export function fieldAt(state: TableState, fieldId: PropertyId): FieldState | undefined {
	return state.fields.find((field) => field.id === fieldId);
}

/** Clamps an index into `[0, length]`, which is what makes a stale index a placement, not a crash. */
export function clampIndex(index: number, length: number): number {
	if (!Number.isFinite(index)) {
		return length;
	}
	return Math.min(Math.max(Math.trunc(index), 0), length);
}

/**
 * A row with one cell removed entirely. `null` means "no value", and a row with no value for a column holds
 * no key for it — the same rule `docs/03` §write rules gives the write queue ("clearing a value **removes**
 * the key rather than writing `""`"). Keeping `null` out of the map is what makes "empty" one thing instead
 * of two, and it is why an undo of a write into an empty cell restores the *absence* exactly.
 */
function withoutCell(row: RowState, fieldId: PropertyId): RowState {
	const cells: Record<PropertyId, CellValue> = {};
	for (const key of Object.keys(row.cells)) {
		if (key === fieldId) {
			continue;
		}
		const value = row.cells[key];
		if (value !== undefined) {
			cells[key] = value;
		}
	}
	return { filePath: row.filePath, cells };
}

/**
 * A row with one cell replaced, copying nothing else. Writing `null` removes the key (see above); every other
 * value, including `false`, `0` and `''`, is stored as itself.
 */
function withCell(row: RowState, fieldId: PropertyId, value: CellValue): RowState {
	if (value === null) {
		return withoutCell(row, fieldId);
	}
	const cells: Record<PropertyId, CellValue> = { ...row.cells, [fieldId]: value };
	return { filePath: row.filePath, cells };
}

/** Inserts `item` at `at`, clamped. Returns a new array; the input is never touched. */
function insertAt<T>(items: readonly T[], item: T, at: number): readonly T[] {
	const index = clampIndex(at, items.length);
	return [...items.slice(0, index), item, ...items.slice(index)];
}

/** Inserts a run of items at `at`, keeping their order. Used by block imports and block moves. */
function insertRun<T>(items: readonly T[], run: readonly T[], at: number): readonly T[] {
	const index = clampIndex(at, items.length);
	return [...items.slice(0, index), ...run, ...items.slice(index)];
}

/** Builds a `Skipped` record with a count, so a paste over deleted rows reports the real number. */
function skip(op: Op, count: number, reason: string): Skipped {
	return { op, count, reason };
}

/** Grouped writes, so a matrix write touches each row once and reads a row's data once. */
function groupWrites(writes: readonly CellWrite[]): Map<RowId, Map<PropertyId, CellValue>> {
	const byRow = new Map<RowId, Map<PropertyId, CellValue>>();
	for (const write of writes) {
		let row = byRow.get(write.filePath);
		if (row === undefined) {
			row = new Map<PropertyId, CellValue>();
			byRow.set(write.filePath, row);
		}
		row.set(write.fieldId, write.value);
	}
	return byRow;
}

/** Applies a set of cell writes in one pass. Missing rows are reported once each, not once per cell. */
function writeCells(
	rows: readonly RowState[],
	writes: readonly CellWrite[],
): { readonly rows: readonly RowState[]; readonly missing: readonly RowId[] } {
	const byRow = groupWrites(writes);
	const missing: RowId[] = [];
	const next = rows.map((row) => {
		const pending = byRow.get(row.filePath);
		if (pending === undefined) {
			return row;
		}
		byRow.delete(row.filePath);
		let updated = row;
		for (const [fieldId, value] of pending) {
			updated = withCell(updated, fieldId, value);
		}
		return updated;
	});
	// Whatever is left in the map names a row the view does not have.
	for (const filePath of byRow.keys()) {
		missing.push(filePath);
	}
	return { rows: next, missing };
}

/** Removes rows by path, reporting the ones that were not there. */
function removeRows(
	rows: readonly RowState[],
	paths: readonly RowId[],
): { readonly rows: readonly RowState[]; readonly missing: readonly RowId[] } {
	const wanted = new Set(paths);
	const missing = [...wanted].filter((path) => !rows.some((row) => row.filePath === path));
	return { rows: rows.filter((row) => !wanted.has(row.filePath)), missing };
}

/** Moves a block of rows to a new position, by identity. The block keeps its internal order. */
function moveBlock(
	rows: readonly RowState[],
	paths: readonly RowId[],
	to: number,
): { readonly rows: readonly RowState[]; readonly missing: readonly RowId[] } {
	const wanted = new Set(paths);
	const missing = paths.filter((path) => !rows.some((row) => row.filePath === path));
	const block = rows.filter((row) => wanted.has(row.filePath));
	if (block.length === 0) {
		return { rows, missing };
	}
	const rest = rows.filter((row) => !wanted.has(row.filePath));
	return { rows: insertRun(rest, block, to), missing };
}

/**
 * Reads one key of a patch the way the rule above says: absent means "leave it alone", present with
 * `undefined` means "remove the setting". Generic over the key, so the result keeps the precise type of that
 * one key instead of collapsing to a union of all six.
 */
function pick<K extends keyof ViewPatch>(
	patch: ViewPatch,
	key: K,
	current: ViewPatch[K],
): ViewPatch[K] {
	if (!Object.prototype.hasOwnProperty.call(patch, key)) {
		return current;
	}
	return patch[key];
}

/**
 * Merges a view patch. A key present with `undefined` removes the setting; an absent key is left alone.
 *
 * Keys whose value ends up `undefined` are *omitted* rather than written as `{ key: undefined }`, so a view
 * that had no `groupBy` still has none after a patch that did not mention it — "the same data" stays the
 * same object shape, which is what makes an undo land on a deep-equal state instead of an equal-looking one.
 */
export function mergeView(view: TableState['view'], patch: ViewPatch): TableState['view'] {
	const next: {
		search?: string;
		sorts?: TableState['view']['sorts'];
		groupBy?: PropertyId;
		collapsedKeys?: readonly string[];
		hiddenFieldIds?: readonly PropertyId[];
		columnOrder?: readonly PropertyId[];
	} = {
		search: pick(patch, 'search', view.search),
		sorts: pick(patch, 'sorts', view.sorts),
		groupBy: pick(patch, 'groupBy', view.groupBy),
		collapsedKeys: pick(patch, 'collapsedKeys', view.collapsedKeys),
		hiddenFieldIds: pick(patch, 'hiddenFieldIds', view.hiddenFieldIds),
		columnOrder: pick(patch, 'columnOrder', view.columnOrder),
	};
	const keys: readonly (keyof ViewPatch)[] = [
		'search',
		'sorts',
		'groupBy',
		'collapsedKeys',
		'hiddenFieldIds',
		'columnOrder',
	];
	for (const key of keys) {
		if (next[key] === undefined) {
			delete next[key];
		}
	}
	return next;
}

/** Applies one op. Pure: `state` and everything reachable from it is left untouched. */
export function applyOp(state: TableState, op: Op): Applied {
	switch (op.kind) {
		case 'setCell': {
			const row = rowAt(state, op.filePath);
			if (row === undefined) {
				return {
					state,
					skipped: [
						skip(
							op,
							1,
							`the row "${op.filePath}" is not in this view any more, so the value was not written`,
						),
					],
				};
			}
			const rows = state.rows.map((candidate) =>
				candidate.filePath === op.filePath
					? withCell(candidate, op.fieldId, op.value)
					: candidate,
			);
			return { state: { ...state, rows }, skipped: [] };
		}

		case 'setCells': {
			const result = writeCells(state.rows, op.writes);
			return {
				state: { ...state, rows: result.rows },
				skipped:
					result.missing.length === 0
						? []
						: [
								skip(
									op,
									result.missing.length,
									`${String(result.missing.length)} of the rows in this write are not in this view any more`,
								),
							],
			};
		}

		case 'clearCells': {
			const writes: CellWrite[] = op.cells.map((cell) => ({
				filePath: cell.filePath,
				fieldId: cell.fieldId,
				value: null,
			}));
			const result = writeCells(state.rows, writes);
			return {
				state: { ...state, rows: result.rows },
				skipped:
					result.missing.length === 0
						? []
						: [
								skip(
									op,
									result.missing.length,
									`${String(result.missing.length)} of the rows in this clear are not in this view any more`,
								),
							],
			};
		}

		case 'addRow': {
			if (rowAt(state, op.row.filePath) !== undefined) {
				return {
					state,
					skipped: [
						skip(
							op,
							1,
							`a row for "${op.row.filePath}" already exists, so the row was not added twice`,
						),
					],
				};
			}
			return {
				state: { ...state, rows: insertAt(state.rows, op.row, op.at) },
				skipped: [],
			};
		}

		case 'deleteRows': {
			const paths = op.rows.map((placed) => placed.row.filePath);
			const result = removeRows(state.rows, paths);
			return {
				state: { ...state, rows: result.rows },
				skipped:
					result.missing.length === 0
						? []
						: [
								skip(
									op,
									result.missing.length,
									`${String(result.missing.length)} of the rows to delete were not in this view any more`,
								),
							],
			};
		}

		case 'moveRow':
		case 'moveRows': {
			const paths: readonly RowId[] = op.kind === 'moveRow' ? [op.filePath] : op.filePaths;
			const result = moveBlock(state.rows, paths, op.to);
			return {
				state: { ...state, rows: result.rows },
				skipped:
					result.missing.length === 0
						? []
						: [
								skip(
									op,
									result.missing.length,
									`${String(result.missing.length)} of the rows to move were not in this view any more`,
								),
							],
			};
		}

		case 'setFieldOptions': {
			const field = fieldAt(state, op.fieldId);
			if (field === undefined) {
				return {
					state,
					skipped: [
						skip(
							op,
							1,
							`the column "${op.fieldId}" is not in this view any more, so its options were not set`,
						),
					],
				};
			}
			const fields = state.fields.map((candidate) =>
				candidate.id === op.fieldId ? { ...candidate, options: op.to } : candidate,
			);
			return { state: { ...state, fields }, skipped: [] };
		}

		case 'addField': {
			if (fieldAt(state, op.field.id) !== undefined) {
				return {
					state,
					skipped: [
						skip(
							op,
							1,
							`the column "${op.field.id}" already exists, so it was not added twice`,
						),
					],
				};
			}
			const fields = insertAt(state.fields, op.field, op.at);
			const result = writeCells(state.rows, op.values);
			return { state: { ...state, fields, rows: result.rows }, skipped: [] };
		}

		case 'deleteField': {
			if (fieldAt(state, op.field.id) === undefined) {
				return {
					state,
					skipped: [
						skip(op, 1, `the column "${op.field.id}" is not in this view any more`),
					],
				};
			}
			const fields = state.fields.filter((field) => field.id !== op.field.id);
			const rows = state.rows.map((row) => withoutCell(row, op.field.id));
			return { state: { ...state, fields, rows }, skipped: [] };
		}

		case 'renameField': {
			const field = fieldAt(state, op.fieldId);
			if (field === undefined) {
				return {
					state,
					skipped: [
						skip(op, 1, `the column "${op.fieldId}" is not in this view any more`),
					],
				};
			}
			const fields = state.fields.map((candidate) =>
				candidate.id === op.fieldId ? { ...candidate, name: op.to } : candidate,
			);
			return { state: { ...state, fields }, skipped: [] };
		}

		case 'resizeColumn': {
			const field = fieldAt(state, op.fieldId);
			if (field === undefined) {
				return {
					state,
					skipped: [
						skip(op, 1, `the column "${op.fieldId}" is not in this view any more`),
					],
				};
			}
			const fields = state.fields.map((candidate) =>
				candidate.id === op.fieldId ? { ...candidate, width: op.to } : candidate,
			);
			return { state: { ...state, fields }, skipped: [] };
		}

		case 'reorderColumn': {
			const field = fieldAt(state, op.fieldId);
			if (field === undefined) {
				return {
					state,
					skipped: [
						skip(op, 1, `the column "${op.fieldId}" is not in this view any more`),
					],
				};
			}
			const rest = state.fields.filter((candidate) => candidate.id !== op.fieldId);
			return { state: { ...state, fields: insertAt(rest, field, op.to) }, skipped: [] };
		}

		case 'setGroupCollapse': {
			const current = state.view.collapsedKeys ?? [];
			const already = current.includes(op.key);
			if (op.collapsed === already) {
				return { state, skipped: [] };
			}
			const collapsedKeys = op.collapsed
				? [...current, op.key]
				: current.filter((key) => key !== op.key);
			return { state: { ...state, view: { ...state.view, collapsedKeys } }, skipped: [] };
		}

		case 'setViewConfig': {
			return { state: { ...state, view: mergeView(state.view, op.changes) }, skipped: [] };
		}

		case 'importBlock': {
			const fresh = op.rows.filter(
				(placed) => rowAt(state, placed.row.filePath) === undefined,
			);
			const duplicates = op.rows.length - fresh.length;
			let rows = state.rows;
			// Ascending `at`, so each insertion lands where the caller meant despite the ones before it.
			for (const placed of [...fresh].sort((a, b) => a.at - b.at)) {
				rows = insertAt(rows, placed.row, placed.at);
			}
			return {
				state: { ...state, rows },
				skipped:
					duplicates === 0
						? []
						: [
								skip(
									op,
									duplicates,
									`${String(duplicates)} of the imported rows already exist and were left alone`,
								),
							],
			};
		}
	}
}

/** Applies a sequence, in order, stopping at nothing — a skipped op is recorded and the rest still run. */
export function applyOps(state: TableState, ops: readonly Op[]): Applied {
	let current = state;
	const skipped: Skipped[] = [];
	for (const op of ops) {
		const result = applyOp(current, op);
		current = result.state;
		for (const note of result.skipped) {
			skipped.push(note);
		}
	}
	return { state: current, skipped };
}

/**
 * Captures the before-image an inverse needs. The caller calls this **before** applying the op, with the
 * state as it is; for the thirteen self-inverting kinds it returns `{ kind: 'none' }` and reads nothing.
 */
export function captureBefore(op: Op, state: TableState): Before {
	switch (op.kind) {
		case 'setCell': {
			const row = rowAt(state, op.filePath);
			return { kind: 'value', value: row === undefined ? null : cellOf(row, op.fieldId) };
		}
		case 'setCells': {
			return { kind: 'cells', writes: op.writes.map((write) => beforeImage(state, write)) };
		}
		case 'clearCells': {
			return {
				kind: 'cells',
				writes: op.cells.map((cell) => beforeImage(state, { ...cell, value: null })),
			};
		}
		default: {
			return { kind: 'none' };
		}
	}
}

/** One cell's current value, as a write. The row-level before-image unit. */
function beforeImage(
	state: TableState,
	write: CellWrite,
): { readonly filePath: RowId; readonly fieldId: PropertyId; readonly value: CellValue } {
	const row = rowAt(state, write.filePath);
	return {
		filePath: write.filePath,
		fieldId: write.fieldId,
		value: row === undefined ? null : cellOf(row, write.fieldId),
	};
}
