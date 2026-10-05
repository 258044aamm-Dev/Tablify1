/**
 * Fixtures for the operation tests: one small table, and a deterministic sample of every op kind.
 *
 * This is a module, not a suite (the same shape as `field-contract.suite.ts`): the inventory table in
 * `ops.test.ts` and the property generator in `ops-inverse.property.test.ts` both build from here, so a kind
 * that gains a new required field fails in one place instead of two.
 */
import {
	deleteFieldOp,
	deleteRowsOp,
	moveRowOp,
	moveRowsOp,
	viewConfigOp,
} from '../../src/core/ops/build';
import type { FieldState, Op, OpKind, RowState, TableState } from '../../src/core/ops/types';
import type { PropertyId } from '../../src/core/types';

/** Three columns and three rows: enough for a reorder, a deletion and a group collapse to be interesting. */
export function freshState(): TableState {
	return {
		fields: [
			{ id: 'note.Name', name: 'Name', options: {}, width: 160 },
			{ id: 'note.Status', name: 'Status', options: { type: 'singleSelect' }, width: null },
			{
				id: 'note.Effort',
				name: 'Effort',
				options: { type: 'duration', unit: 'minutes' },
				width: 90,
			},
		],
		rows: [
			{ filePath: 'Notes/A.md', cells: { 'note.Name': 'Alpha', 'note.Status': 'Todo' } },
			{ filePath: 'Notes/B.md', cells: { 'note.Name': 'Beta', 'note.Effort': 45 } },
			{ filePath: 'Notes/C.md', cells: {} },
		],
		view: {
			search: '',
			sorts: [{ fieldId: 'note.Name', direction: 'asc' }],
			collapsedKeys: ['doing'],
		},
	};
}

/** One column, or a loud failure — a fixture that silently returns undefined hides a broken test. */
export function fieldOf(state: TableState, fieldId: PropertyId): FieldState {
	const field = state.fields.find((candidate) => candidate.id === fieldId);
	if (field === undefined) {
		throw new Error(`the fixture has no column "${fieldId}"`);
	}
	return field;
}

/** One row, or a loud failure. */
export function rowOf(state: TableState, filePath: string): RowState {
	const row = state.rows.find((candidate) => candidate.filePath === filePath);
	if (row === undefined) {
		throw new Error(`the fixture has no row "${filePath}"`);
	}
	return row;
}

/** Any surviving column, or `undefined` when the generated sequence has deleted them all. */
function anyField(state: TableState): FieldState | undefined {
	return state.fields[0];
}

/** A distinct value per seed, so a generated sequence keeps writing something new. */
function valueFor(seed: number): string {
	return `v${String(seed)}`;
}

/**
 * One op of the given kind, valid against `freshState()` (or against the state a caller passes, for the two
 * kinds that read positions out of it). `seed` makes repeated calls distinct: new row paths, new values.
 */
export function buildOp(kind: OpKind, seed: number, state: TableState = freshState()): Op {
	switch (kind) {
		case 'setCell': {
			return {
				kind: 'setCell',
				filePath: 'Notes/A.md',
				fieldId: 'note.Name',
				value: valueFor(seed),
			};
		}
		case 'setCells': {
			return {
				kind: 'setCells',
				writes: [
					{ filePath: 'Notes/A.md', fieldId: 'note.Status', value: valueFor(seed) },
					{ filePath: 'Notes/B.md', fieldId: 'note.Name', value: `${valueFor(seed)}-b` },
				],
			};
		}
		case 'clearCells': {
			return {
				kind: 'clearCells',
				cells: [
					{ filePath: 'Notes/A.md', fieldId: 'note.Name' },
					{ filePath: 'Notes/C.md', fieldId: 'note.Effort' },
				],
			};
		}
		case 'addRow': {
			return {
				kind: 'addRow',
				at: seed % (state.rows.length + 1),
				row: {
					filePath: `Notes/New-${String(seed)}.md`,
					cells: { 'note.Name': valueFor(seed) },
				},
			};
		}
		case 'deleteRows': {
			const path =
				state.rows.length === 0
					? undefined
					: state.rows[seed % state.rows.length]?.filePath;
			const built = deleteRowsOp(state, path === undefined ? [] : [path]);
			return built.ok ? built.op : viewConfigOp(state, {});
		}
		case 'moveRow': {
			const row = state.rows[seed % Math.max(state.rows.length, 1)];
			const built = moveRowOp(
				state,
				row?.filePath ?? 'Notes/A.md',
				seed % Math.max(state.rows.length, 1),
			);
			return built.ok ? built.op : viewConfigOp(state, {});
		}
		case 'moveRows': {
			// A real block: the first two surviving rows, dropped somewhere in the current order.
			const paths = state.rows.slice(0, 2).map((row) => row.filePath);
			const built = moveRowsOp(state, paths, seed % Math.max(state.rows.length, 1));
			return built.ok ? built.op : viewConfigOp(state, {});
		}
		case 'setFieldOptions': {
			const field =
				state.fields.find((candidate) => candidate.id === 'note.Status') ?? anyField(state);
			if (field === undefined) {
				return viewConfigOp(state, {});
			}
			return {
				kind: 'setFieldOptions',
				fieldId: field.id,
				from: field.options,
				to: {
					type: 'singleSelect',
					options: [
						{ id: 'o1', name: 'Todo', color: 'gray' },
						{ id: `o${String(seed)}`, name: valueFor(seed), color: 'blue' },
					],
				},
			};
		}
		case 'addField': {
			return {
				kind: 'addField',
				at: seed % (state.fields.length + 1),
				field: {
					id: `note.Extra${String(seed)}`,
					name: `Extra ${String(seed)}`,
					options: {},
					width: null,
				},
				values: [
					{
						filePath: 'Notes/A.md',
						fieldId: `note.Extra${String(seed)}`,
						value: valueFor(seed),
					},
				],
			};
		}
		case 'deleteField': {
			// The generator deletes columns as it goes, so this asks the state which one exists now.
			const field = anyField(state);
			if (field === undefined) {
				return viewConfigOp(state, {});
			}
			const built = deleteFieldOp(state, field.id);
			return built.ok ? built.op : viewConfigOp(state, {});
		}
		case 'renameField': {
			const field = anyField(state);
			if (field === undefined) {
				return viewConfigOp(state, {});
			}
			return {
				kind: 'renameField',
				fieldId: field.id,
				from: field.name,
				to: `Name ${String(seed)}`,
			};
		}
		case 'resizeColumn': {
			const field = anyField(state);
			if (field === undefined) {
				return viewConfigOp(state, {});
			}
			return {
				kind: 'resizeColumn',
				fieldId: field.id,
				from: field.width,
				to: 100 + (seed % 200),
			};
		}
		case 'reorderColumn': {
			const index = seed % state.fields.length;
			const field = state.fields[index];
			if (field === undefined) {
				return viewConfigOp(state, {});
			}
			return {
				kind: 'reorderColumn',
				fieldId: field.id,
				from: index,
				to: seed % state.fields.length,
			};
		}
		case 'setGroupCollapse': {
			const collapsed = state.view.collapsedKeys ?? [];
			// Only ever a *change*: apply is idempotent, and the inverse of a no-op would be a lie.
			const key = collapsed.includes('doing') ? 'todo' : 'doing';
			return { kind: 'setGroupCollapse', key, collapsed: !collapsed.includes(key) };
		}
		case 'setViewConfig': {
			return viewConfigOp(
				state,
				seed % 2 === 0 ? { search: `q${String(seed)}` } : { groupBy: 'note.Status' },
			);
		}
		case 'importBlock': {
			return {
				kind: 'importBlock',
				rows: [
					{
						at: state.rows.length,
						row: {
							filePath: `Notes/I${String(seed)}-1.md`,
							cells: { 'note.Name': 'I1' },
						},
					},
					{
						at: state.rows.length + 1,
						row: {
							filePath: `Notes/I${String(seed)}-2.md`,
							cells: { 'note.Name': 'I2' },
						},
					},
				],
			};
		}
	}
}
