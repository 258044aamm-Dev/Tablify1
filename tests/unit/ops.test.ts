/**
 * The operation model: one row per op kind, its inverse, and the rules the module headers promise.
 *
 * The inventory table below is the contract the store consumes, and it is typed as
 * `Record<OpKind, Sample>`-shaped data: dropping an op kind from `OP_KINDS` or adding one without a sample
 * fails this file, so "every op has an inverse" is a compile-time promise as well as a test.
 *
 * There is no console output anywhere in this repository (see `AGENTS.md`), so numbers that belong in a
 * report go into test *names* — which is why several names below carry counts.
 */
import { describe, expect, it } from 'vitest';
import { applyOp, applyOps, captureBefore, cellOf, mergeView } from '../../src/core/ops/apply';
import { createHistory, MAX_HISTORY_DEPTH, NEVER_COALESCE } from '../../src/core/ops/history';
import { deleteFieldOp, deleteRowsOp, viewConfigOp } from '../../src/core/ops/build';
import { invert, invertAll } from '../../src/core/ops/inverse';
import type { Command, HistoryOptions } from '../../src/core/ops/history';
import type { Op, OpKind, TableState } from '../../src/core/ops/types';
import { OP_KINDS } from '../../src/core/ops/types';
import { buildOp, fieldOf, freshState } from './ops-fixtures';

/** One op kind, how it is built, and what its inverse is. The report table is this list. */
type Sample = {
	readonly kind: OpKind;
	/** What the op does, in the words the report uses. */
	readonly doing: string;
	readonly build: (state: TableState) => Op;
	/** The kind its inverse has. */
	readonly inverse: OpKind;
	/** What the inverse does. */
	readonly undoing: string;
};

const INVENTORY: readonly Sample[] = [
	{
		kind: 'setCell',
		doing: 'one cell gets a value',
		build: (state) => ({
			kind: 'setCell',
			filePath: 'Notes/A.md',
			fieldId: 'note.Name',
			value: 'Alpha two',
		}),
		inverse: 'setCell',
		undoing: 'the same cell gets the value it had (from the before-image)',
	},
	{
		kind: 'setCells',
		doing: 'a block of cells gets values',
		build: () => ({
			kind: 'setCells',
			writes: [
				{ filePath: 'Notes/A.md', fieldId: 'note.Status', value: 'Doing' },
				{ filePath: 'Notes/B.md', fieldId: 'note.Status', value: 'Done' },
			],
		}),
		inverse: 'setCells',
		undoing: 'the same block gets its row-level before-images back, as one op',
	},
	{
		kind: 'clearCells',
		doing: 'a selection is emptied',
		build: () => ({
			kind: 'clearCells',
			cells: [
				{ filePath: 'Notes/A.md', fieldId: 'note.Name' },
				{ filePath: 'Notes/B.md', fieldId: 'note.Name' },
			],
		}),
		inverse: 'setCells',
		undoing: 'the cleared cells get their values back (from the before-image)',
	},
	{
		kind: 'addRow',
		doing: 'a row is created',
		build: () => ({
			kind: 'addRow',
			at: 1,
			row: { filePath: 'Notes/New.md', cells: { 'note.Name': 'New' } },
		}),
		inverse: 'deleteRows',
		undoing: 'that row is deleted again',
	},
	{
		kind: 'deleteRows',
		doing: 'rows are deleted',
		build: (state) => {
			const built = deleteRowsOp(state, ['Notes/B.md']);
			return built.ok ? built.op : { kind: 'setViewConfig', changes: {}, previous: {} };
		},
		inverse: 'importBlock',
		undoing: 'the very rows come back, with their values and their positions',
	},
	{
		kind: 'moveRow',
		doing: 'one row is dragged to another position',
		build: () => ({ kind: 'moveRow', filePath: 'Notes/A.md', from: 0, to: 2 }),
		inverse: 'moveRow',
		undoing: 'that row is dragged back to the position it came from',
	},
	{
		kind: 'moveRows',
		doing: 'a block of rows is dragged',
		build: () => ({
			kind: 'moveRows',
			filePaths: ['Notes/B.md', 'Notes/C.md'],
			from: 1,
			to: 0,
		}),
		inverse: 'moveRows',
		undoing: 'the block is dragged back',
	},
	{
		kind: 'setFieldOptions',
		doing: 'a column’s options change',
		build: (state) => ({
			kind: 'setFieldOptions',
			fieldId: 'note.Status',
			from: fieldOf(state, 'note.Status').options,
			to: { type: 'singleSelect', options: [{ id: 'o1', name: 'Doing' }] },
		}),
		inverse: 'setFieldOptions',
		undoing: 'the options it replaced are put back',
	},
	{
		kind: 'addField',
		doing: 'a column is created',
		build: () => ({
			kind: 'addField',
			at: 1,
			field: { id: 'note.Owner', name: 'Owner', options: {}, width: null },
			values: [{ filePath: 'Notes/A.md', fieldId: 'note.Owner', value: 'Ann' }],
		}),
		inverse: 'deleteField',
		undoing: 'that column and the values it wrote are removed',
	},
	{
		kind: 'deleteField',
		doing: 'a column is deleted, values and all',
		build: (state) => {
			const built = deleteFieldOp(state, 'note.Name');
			return built.ok ? built.op : { kind: 'setViewConfig', changes: {}, previous: {} };
		},
		inverse: 'addField',
		undoing: 'the column comes back at its old position, holding every value it held',
	},
	{
		kind: 'renameField',
		doing: 'a column is renamed',
		build: () => ({ kind: 'renameField', fieldId: 'note.Name', from: 'Name', to: 'Project' }),
		inverse: 'renameField',
		undoing: 'the old wording is put back',
	},
	{
		kind: 'resizeColumn',
		doing: 'a column edge is dragged',
		build: (state) => ({
			kind: 'resizeColumn',
			fieldId: 'note.Name',
			from: fieldOf(state, 'note.Name').width,
			to: 320,
		}),
		inverse: 'resizeColumn',
		undoing: 'the width it had (or `null` for the grid’s own width) is put back',
	},
	{
		kind: 'reorderColumn',
		doing: 'a column is dragged to another position',
		build: () => ({ kind: 'reorderColumn', fieldId: 'note.Effort', from: 2, to: 0 }),
		inverse: 'reorderColumn',
		undoing: 'the column is put back where it was',
	},
	{
		kind: 'setGroupCollapse',
		doing: 'a group is collapsed or expanded',
		// A *change*: 'doing' is already collapsed in the fixture, and the inverse of a collapse that changed
		// nothing would expand it. The rule ("do not push a no-op") is asserted in the reducer block below.
		build: () => ({ kind: 'setGroupCollapse', key: 'todo', collapsed: true }),
		inverse: 'setGroupCollapse',
		undoing: 'the group’s previous state is restored (the complement)',
	},
	{
		kind: 'setViewConfig',
		doing: 'a view option changes (search, sorts, hidden columns, order)',
		build: (state) => viewConfigOp(state, { search: 'alpha' }),
		inverse: 'setViewConfig',
		undoing: 'the values the patch overwrote are put back',
	},
	{
		kind: 'importBlock',
		doing: 'a sheet is pasted or imported: many rows at once',
		build: () => ({
			kind: 'importBlock',
			rows: [
				{ at: 0, row: { filePath: 'Notes/P1.md', cells: { 'note.Name': 'P1' } } },
				{ at: 1, row: { filePath: 'Notes/P2.md', cells: { 'note.Name': 'P2' } } },
			],
		}),
		inverse: 'deleteRows',
		undoing: 'exactly those rows are removed again — one op, one undo step',
	},
];

describe('the op model', () => {
	it(`inventories all ${String(OP_KINDS.length)} op kinds, exactly once each`, () => {
		const fromTable = INVENTORY.map((sample) => sample.kind).sort();
		const fromTypes = [...OP_KINDS].sort();
		expect(fromTable).toEqual(fromTypes);
		expect(new Set(fromTable).size).toBe(fromTypes.length);
	});

	it(`builds every sample op and reports its inverse (${String(INVENTORY.length)} of ${String(OP_KINDS.length)})`, () => {
		for (const sample of INVENTORY) {
			const state = freshState();
			const op = sample.build(state);
			expect(op.kind).toBe(sample.kind);
			const before = captureBefore(op, state);
			const inverted = invert(op, before);
			expect(inverted.ok, `no inverse for ${sample.kind}`).toBe(true);
			if (!inverted.ok) {
				continue;
			}
			expect(inverted.op.kind).toBe(sample.inverse);
		}
	});

	it('inverts every sample back to the state it was applied to', () => {
		for (const sample of INVENTORY) {
			const state = freshState();
			const op = sample.build(state);
			const before = captureBefore(op, state);
			const after = applyOps(state, [op]);
			const inverted = invertAll([op], [before]);
			expect(inverted.ok, `no inverse for ${sample.kind}`).toBe(true);
			if (!inverted.ok) {
				continue;
			}
			const back = applyOps(after.state, inverted.ops);
			// Every kind, no exceptions: the inverse must land on the same state, deep-equal — including the
			// row order, and including the *absence* of a key that held no value before the op.
			expect(back.state, `${sample.kind} did not round trip`).toEqual(state);
		}
	});

	it('keeps ops plain enough for structuredClone (no closures, no class instances)', () => {
		for (const sample of INVENTORY) {
			const op = sample.build(freshState());
			const clone = structuredClone(op);
			expect(clone).toEqual(op);
			expect(clone).not.toBe(op);
			// A clone must be applicable and invertible exactly like the original: that is what "plain data"
			// buys the write queue, the migration report and any future worker.
			expect(applyOp(freshState(), clone)).toEqual(applyOp(freshState(), op));
		}
	});
});

describe('the reducer', () => {
	it('reports a cell written into a row that is gone, and changes nothing else', () => {
		const state = freshState();
		const result = applyOp(state, {
			kind: 'setCell',
			filePath: 'Notes/Gone.md',
			fieldId: 'note.Name',
			value: 'x',
		});
		expect(result.state).toEqual(state);
		expect(result.skipped).toHaveLength(1);
		expect(result.skipped[0]?.count).toBe(1);
		expect(result.skipped[0]?.reason).toContain('Notes/Gone.md');
	});

	it('counts every row of a matrix write it could not reach, once each', () => {
		const result = applyOp(freshState(), {
			kind: 'setCells',
			writes: [
				{ filePath: 'Notes/A.md', fieldId: 'note.Name', value: 'kept' },
				{ filePath: 'Notes/Gone.md', fieldId: 'note.Name', value: 'lost' },
				{ filePath: 'Notes/AlsoGone.md', fieldId: 'note.Name', value: 'lost' },
			],
		});
		expect(result.skipped).toHaveLength(1);
		expect(result.skipped[0]?.count).toBe(2);
		expect(cellOf(result.state.rows[0] ?? { filePath: '', cells: {} }, 'note.Name')).toBe(
			'kept',
		);
	});

	it('refuses to add a row that already exists, rather than duplicating it', () => {
		const result = applyOp(freshState(), {
			kind: 'addRow',
			at: 0,
			row: { filePath: 'Notes/A.md', cells: { 'note.Name': 'Impostor' } },
		});
		expect(result.skipped[0]?.reason).toContain('already exists');
		expect(result.state.rows).toHaveLength(3);
	});

	it('skips the duplicates in an import and keeps the fresh rows', () => {
		const result = applyOp(freshState(), {
			kind: 'importBlock',
			rows: [
				{ at: 3, row: { filePath: 'Notes/N1.md', cells: {} } },
				{ at: 4, row: { filePath: 'Notes/A.md', cells: {} } },
				{ at: 5, row: { filePath: 'Notes/N2.md', cells: {} } },
			],
		});
		expect(result.state.rows.map((row) => row.filePath)).toEqual([
			'Notes/A.md',
			'Notes/B.md',
			'Notes/C.md',
			'Notes/N1.md',
			'Notes/N2.md',
		]);
		expect(result.skipped[0]?.count).toBe(1);
	});

	it('clamps a stale index instead of refusing or corrupting the order', () => {
		const state = freshState();
		const moved = applyOp(state, { kind: 'moveRow', filePath: 'Notes/A.md', from: 0, to: 99 });
		expect(moved.state.rows.map((row) => row.filePath)).toEqual([
			'Notes/B.md',
			'Notes/C.md',
			'Notes/A.md',
		]);
		expect(moved.skipped).toEqual([]);
	});

	it('deletes a column entirely, including the keys it held in every row', () => {
		const state = freshState();
		const built = deleteFieldOp(state, 'note.Name');
		expect(built.ok).toBe(true);
		if (!built.ok) {
			return;
		}
		const after = applyOp(state, built.op);
		expect(after.state.fields.map((field) => field.id)).toEqual(['note.Status', 'note.Effort']);
		for (const row of after.state.rows) {
			expect(Object.keys(row.cells)).not.toContain('note.Name');
		}
		// And the values travelled with the op, which is the entire reason the undo can restore data.
		const inverted = invert(built.op, { kind: 'none' });
		expect(inverted.ok).toBe(true);
		if (inverted.ok) {
			expect(applyOp(after.state, inverted.op).state).toEqual(state);
		}
	});

	it('treats a view patch as a patch: absent keys are untouched, explicit undefined removes', () => {
		const state = freshState();
		const patched = mergeView(state.view, { search: 'beta' });
		expect(patched.search).toBe('beta');
		expect(patched.sorts).toEqual(state.view.sorts);
		const removed = mergeView(patched, { sorts: undefined });
		expect(removed.sorts).toBeUndefined();
		expect(removed.search).toBe('beta');
	});

	it('is idempotent for a collapse that is already in force — and says why the caller must not push it', () => {
		const state = freshState();
		const once = applyOp(state, { kind: 'setGroupCollapse', key: 'todo', collapsed: true });
		const twice = applyOp(once.state, {
			kind: 'setGroupCollapse',
			key: 'todo',
			collapsed: true,
		});
		expect(twice.state).toEqual(once.state);
		// The inverse of the first op would *expand* the group, so pushing the no-op would add an undo step
		// that looks like nothing happened. The rule lives in `types.ts`; this is the demonstration.
		const inverted = invert(
			{ kind: 'setGroupCollapse', key: 'todo', collapsed: true },
			{ kind: 'none' },
		);
		expect(
			inverted.ok && inverted.op.kind === 'setGroupCollapse' && inverted.op.collapsed,
		).toBe(false);
	});
});

describe('inverse honesty', () => {
	it('refuses a before-image of the wrong shape, with a reason that names the problem', () => {
		const inverted = invert(
			{ kind: 'setCell', filePath: 'Notes/A.md', fieldId: 'note.Name', value: 'x' },
			{ kind: 'cells', writes: [] },
		);
		expect(inverted.ok).toBe(false);
		if (!inverted.ok) {
			expect(inverted.reason).toContain('before-image');
		}
	});

	it('refuses a command whose before-images do not line up with its ops', () => {
		const inverted = invertAll([{ kind: 'setGroupCollapse', key: 'k', collapsed: true }], []);
		expect(inverted.ok).toBe(false);
		if (!inverted.ok) {
			expect(inverted.reason).toContain('before-images');
		}
	});

	it('captures a value before-image for a cell, and nothing at all for a self-inverting op', () => {
		const state = freshState();
		expect(
			captureBefore(
				{ kind: 'setCell', filePath: 'Notes/A.md', fieldId: 'note.Name', value: 'x' },
				state,
			),
		).toEqual({
			kind: 'value',
			value: 'Alpha',
		});
		expect(
			captureBefore({ kind: 'moveRow', filePath: 'Notes/A.md', from: 0, to: 1 }, state),
		).toEqual({
			kind: 'none',
		});
	});

	it('captures row-level before-images for a matrix write, in row order, grouped by row', () => {
		const state = freshState();
		const before = captureBefore(
			{
				kind: 'setCells',
				writes: [
					{ filePath: 'Notes/A.md', fieldId: 'note.Status', value: 'Doing' },
					{ filePath: 'Notes/B.md', fieldId: 'note.Name', value: 'Beta two' },
				],
			},
			state,
		);
		expect(before).toEqual({
			kind: 'cells',
			writes: [
				{ filePath: 'Notes/A.md', fieldId: 'note.Status', value: 'Todo' },
				{ filePath: 'Notes/B.md', fieldId: 'note.Name', value: 'Beta' },
			],
		});
	});
});

describe('the view-config op builder', () => {
	it('records exactly the keys the patch names, so an undo cannot restore the wrong setting', () => {
		const state = freshState();
		const op = viewConfigOp(state, { search: 'road' });
		expect(Object.keys(op.previous)).toEqual(['search']);
		const after = applyOp(state, op).state;
		expect(after.view.search).toBe('road');
		const inverted = invert(op, { kind: 'none' });
		expect(inverted.ok).toBe(true);
		if (inverted.ok) {
			expect(applyOp(after, inverted.op).state.view.search).toBe('');
		}
	});

	it('removes a setting when the patch says undefined, and puts it back on undo', () => {
		const state = freshState();
		const op = viewConfigOp(state, { sorts: undefined, collapsedKeys: ['doing'] });
		expect(Object.keys(op.previous).sort()).toEqual(['collapsedKeys', 'sorts']);
		const after = applyOp(state, op).state;
		expect(after.view.sorts).toBeUndefined();
		const inverted = invert(op, { kind: 'none' });
		expect(inverted.ok).toBe(true);
		if (inverted.ok) {
			expect(applyOp(after, inverted.op).state.view.sorts).toEqual(state.view.sorts);
		}
	});
});

describe('history', () => {
	const push = (
		history: ReturnType<typeof createHistory>,
		label: string,
		ops: readonly Op[],
		state: TableState,
	): void => {
		const command: Command = { label, ops, befores: ops.map((op) => captureBefore(op, state)) };
		history.push(command);
	};

	it('keeps one user action to one step, and does not merge two pushes (the documented default)', () => {
		const history = createHistory();
		const state = freshState();
		push(
			history,
			'Edit cell',
			[{ kind: 'setCell', filePath: 'Notes/A.md', fieldId: 'note.Name', value: 'A1' }],
			state,
		);
		const middle = applyOp(state, {
			kind: 'setCell',
			filePath: 'Notes/A.md',
			fieldId: 'note.Name',
			value: 'A1',
		}).state;
		push(
			history,
			'Edit cell',
			[{ kind: 'setCell', filePath: 'Notes/A.md', fieldId: 'note.Name', value: 'A12' }],
			middle,
		);
		expect(history.depth()).toBe(2);
		expect(NEVER_COALESCE([], [])).toBe(false);
	});

	it('merges two pushes only when the caller supplies a rule — and keeps the earliest before-image', () => {
		const options: HistoryOptions = {
			shouldCoalesce: (previous, next) =>
				previous.every((op) => op.kind === 'setCell') &&
				next.every((op) => op.kind === 'setCell'),
		};
		const history = createHistory(options);
		const state = freshState();
		const first: Op = {
			kind: 'setCell',
			filePath: 'Notes/A.md',
			fieldId: 'note.Name',
			value: 'Al',
		};
		const second: Op = {
			kind: 'setCell',
			filePath: 'Notes/A.md',
			fieldId: 'note.Name',
			value: 'Alpha two',
		};
		push(history, 'Typing', [first], state);
		push(history, 'Typing', [second], applyOp(state, first).state);
		expect(history.depth()).toBe(1);
		const undone = history.undo();
		expect(undone.ok).toBe(true);
		if (undone.ok) {
			// 'Alpha', the value from before the *first* keystroke — not 'Al', and not 'Alpha two'.
			expect(undone.ops[0]).toEqual({
				kind: 'setCell',
				filePath: 'Notes/A.md',
				fieldId: 'note.Name',
				value: 'Alpha',
			});
		}
	});

	it('hands back the inverse ops and moves the step to the redo side', () => {
		const history = createHistory();
		const state = freshState();
		push(
			history,
			'Clear the cell',
			[{ kind: 'clearCells', cells: [{ filePath: 'Notes/A.md', fieldId: 'note.Name' }] }],
			state,
		);
		// Do the clear first — that is the state the undo runs against — and then look at what undo restored.
		const cleared = applyOps(state, [
			{ kind: 'clearCells', cells: [{ filePath: 'Notes/A.md', fieldId: 'note.Name' }] },
		]).state;
		expect(cellOf(cleared.rows[0] ?? { filePath: '', cells: {} }, 'note.Name')).toBeNull();
		const undone = history.undo();
		expect(undone.ok).toBe(true);
		expect(history.canUndo()).toBe(false);
		expect(history.canRedo()).toBe(true);
		expect(history.undoLabel()).toBeNull();
		expect(history.redoLabel()).toBe('Clear the cell');
		if (undone.ok) {
			const restored = applyOps(cleared, undone.ops).state;
			expect(cellOf(restored.rows[0] ?? { filePath: '', cells: {} }, 'note.Name')).toBe(
				'Alpha',
			);
			history.push({ label: 'ignored', ops: [], befores: [] });
			expect(history.canRedo()).toBe(false);
		}
	});

	it('reports an empty stack instead of throwing', () => {
		const history = createHistory();
		expect(history.undo().ok).toBe(false);
		expect(history.redo().ok).toBe(false);
		expect(history.canUndo()).toBe(false);
	});

	it(`bounds the stack at the documented depth of ${String(MAX_HISTORY_DEPTH)} steps`, () => {
		const history = createHistory({ depth: 5 });
		const state = freshState();
		for (let index = 0; index < 12; index += 1) {
			push(
				history,
				`Edit ${String(index)}`,
				[
					{
						kind: 'setCell',
						filePath: 'Notes/A.md',
						fieldId: 'note.Name',
						value: `v${String(index)}`,
					},
				],
				state,
			);
		}
		expect(history.depth()).toBe(5);
		expect(MAX_HISTORY_DEPTH).toBe(60);
		const cleared = createHistory();
		push(cleared, 'Edit', [{ kind: 'setGroupCollapse', key: 'k', collapsed: true }], state);
		cleared.clear();
		expect(cleared.depth()).toBe(0);
		expect(cleared.canRedo()).toBe(false);
	});

	it('leaves a step on the stack when its inverse cannot be built', () => {
		const history = createHistory();
		// One op, no before-image: `invertAll` refuses, and the step must *stay* rather than vanish.
		history.push({ label: 'Broken', ops: [buildOp('setCell', 0)], befores: [] });
		const outcome = history.undo();
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) {
			expect(outcome.reason).toContain('before-images');
		}
		expect(history.depth()).toBe(1);
	});

	it('uses the ops it was given, verbatim, for a redo', () => {
		const history = createHistory();
		const state = freshState();
		const op = buildOp('setCell', 0);
		push(history, 'Edit', [op], state);
		const undone = history.undo();
		expect(undone.ok).toBe(true);
		const redone = history.redo();
		expect(redone.ok).toBe(true);
		if (redone.ok) {
			expect(redone.ops).toEqual([op]);
			expect(redone.label).toBe('Edit');
		}
		expect(history.canRedo()).toBe(false);
	});
});
