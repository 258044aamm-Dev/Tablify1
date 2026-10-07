/**
 * The four Tier-3 rules from `docs/07` §Tier 3, against the real store and a fake `RowSource`.
 *
 * The render-count rule is measured in `store-render.test.tsx`, where React is — a store can only promise
 * *notifications*, and this file measures those exactly (how many listeners fired), which is the mechanism
 * the React measurement depends on. Both numbers are in the step's report.
 *
 * The store is imported from `src/grid/**`, so this file lives under `tests/dom/`: the repository's own
 * architecture rule keeps `tests/unit/**` away from the grid (see `tests/unit/boundaries.test.ts`, which
 * asserts that rule fires).
 */
import { describe, expect, it } from 'vitest';

import { createGridStore } from '../../src/grid/store/store';
import { createFakeRowSource } from '../fakes/rowSource';
import {
	setCell,
	setCells,
	clearSelection,
	deleteRows,
	moveRowBy,
	fillDown,
	undo as undoCommand,
} from '../../src/grid/store/commands';
import {
	selectCellDisplay,
	selectSelectionRows,
	selectStatusSummary,
} from '../../src/grid/store/selectors';
import { resolveField } from '../../src/core/schema/propertySchema';
import type { FieldContext } from '../../src/core/types';
import type { CellRef } from '../../src/core/ops/types';
import type { GridStore } from '../../src/grid/store/types';

const CONTEXT: FieldContext = {
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
	columnName: '',
};

const NAME = resolveField({ id: 'note.Name', name: 'Name', source: 'note' }, CONTEXT);
const STATUS = resolveField({ id: 'note.Status', name: 'Status', source: 'note' }, CONTEXT);
const FIELDS = [NAME, STATUS];

/** A view of `count` rows, `Notes/000.md` … , with a Name and a Status. */
function harness(count = 12) {
	const rows = Array.from({ length: count }, (_unused, index) => ({
		filePath: `Notes/${String(index).padStart(3, '0')}.md`,
		cells: {
			'note.Name': `Row ${String(index)}`,
			'note.Status': index % 2 === 0 ? 'Todo' : 'Done',
		},
	}));
	const source = createFakeRowSource({ fields: FIELDS, rows });
	const store = createGridStore({ source });
	return {
		source,
		store,
		rows,
		refOf: (index: number, fieldId = 'note.Name'): CellRef => ({
			filePath: rows[index]?.filePath ?? '',
			fieldId,
		}),
	};
}

/** Lets the store's microtask (the apply) run. */
const settle = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
};

/*
 * The bulk window (step 29). `beginBulk`/`endBulk` exist because an import created 400 notes and therefore 400
 * commits in step 27's profile; the rules asserted here are the four the type documents, and the *render* half is
 * measured in the layout suite (tier-4 #17), where React is.
 */
describe('the bulk window defers notifications, never state', () => {
	it('notifies a global listener once for a hundred changes, and not before the window closes', () => {
		const { store } = harness(4);
		let whole = 0;
		let rowFires = 0;
		store.subscribe(() => {
			whole += 1;
		});
		store.subscribeRow('Notes/000.md', () => {
			rowFires += 1;
		});

		store.beginBulk();
		for (let index = 0; index < 100; index += 1) {
			// A hundred ordinary edits inside one window — the shape an import has, minus the notes.
			setCell(
				store,
				{ filePath: 'Notes/000.md', fieldId: 'note.Name' },
				`Row ${String(index)}`,
			);
		}
		expect(whole, 'nothing is announced while the window is open').toBe(0);
		expect(rowFires, 'and no narrow channel either').toBe(0);

		store.endBulk();
		expect(whole, 'one announcement for the whole window').toBe(1);
		expect(rowFires, 'including the channels that changed').toBe(1);
	});

	it('keeps the state correct *during* the window, so a reader is never lied to', () => {
		const { store, source } = harness(4);
		let fires = 0;
		store.subscribe(() => {
			fires += 1;
		});
		const valueOf = (): unknown =>
			store.state().table.rows.find((row) => row.filePath === 'Notes/001.md')?.cells[
				'note.Name'
			];

		store.beginBulk();
		// An external change arrives *during* the window — another pane, another plugin, or (the case this exists
		// for) the vault telling us an imported note now exists. The fake notifies only when asked, which is what
		// makes this a test of the store rather than of the fake.
		source.setQuietly('Notes/001.md', 'note.Name', 'Changed mid-window');
		source.notify();
		expect(fires, 'the window is silent').toBe(0);
		// And the state moved anyway: what is deferred is the announcement, never the state. A reader during a
		// window — a command, a dialog, a test — is never lied to.
		expect(valueOf()).toBe('Changed mid-window');
		store.endBulk();
		expect(fires, 'the close announces what the window held').toBe(1);
	});

	it('counts nesting: an inner window that closes does not announce on behalf of an outer one', () => {
		const { store } = harness(4);
		let fires = 0;
		store.subscribe(() => {
			fires += 1;
		});
		store.beginBulk();
		store.beginBulk();
		setCell(store, { filePath: 'Notes/002.md', fieldId: 'note.Name' }, 'Nested');
		store.endBulk();
		expect(fires, 'the inner close holds the outer window open').toBe(0);
		store.endBulk();
		expect(fires, 'the outer close is the one that speaks').toBe(1);
	});

	it('does nothing when a window is ended without being begun, and nothing when nothing changed', () => {
		const { store } = harness(4);
		let fires = 0;
		store.subscribe(() => {
			fires += 1;
		});
		store.endBulk(); // A caller that ends a window it never began: not an error, and not a crash mid-import.
		store.beginBulk();
		store.endBulk(); // Opened and closed with no change in between: no wake-up is owed.
		expect(fires).toBe(0);
	});

	it('announces nothing after dispose, even if a window was open', () => {
		const { store } = harness(4);
		let fires = 0;
		store.subscribe(() => {
			fires += 1;
		});
		store.beginBulk();
		setCell(store, { filePath: 'Notes/003.md', fieldId: 'note.Name' }, 'After dispose');
		store.dispose();
		store.endBulk();
		expect(fires).toBe(0);
	});
});

describe('rule 1 — a keystroke notifies one cell', () => {
	it('fires the edited cell’s listener, the row’s, and nothing else', async () => {
		const { store, source, refOf } = harness(60);
		const fired: string[] = [];
		const offs: (() => void)[] = [];

		// Every cell and every row in the view subscribes, exactly as the grid's components do.
		for (const filePath of source.rows()) {
			offs.push(store.subscribeRow(filePath, () => fired.push(`row:${filePath}`)));
			for (const field of FIELDS) {
				const fieldId = field.definition.id;
				offs.push(
					store.subscribeCell(filePath, fieldId, () =>
						fired.push(`cell:${filePath}:${fieldId}`),
					),
				);
			}
		}

		const target = refOf(7);
		setCell(store, target, 'Renamed');
		await settle();

		// 120 cells and 60 rows are subscribed. One keystroke wakes exactly one cell and exactly one row —
		// `new Set`: the cell is notified twice, on purpose, because there are two moments in a write (the
		// optimistic value, then its confirmation) and the cell has something to say about both. Every other
		// cell in the view is not woken at all.
		const wokenCells = [...new Set(fired.filter((entry) => entry.startsWith('cell:')))];
		expect(wokenCells).toEqual([`cell:${target.filePath}:note.Name`]);
		expect(fired.filter((entry) => entry.startsWith('cell:'))).toHaveLength(2);
		expect([...new Set(fired.filter((entry) => entry.startsWith('row:')))]).toEqual([
			`row:${target.filePath}`,
		]);

		for (const off of offs) {
			off();
		}
	});

	it('does not wake a selection listener for a value change, or a value listener for a selection change', () => {
		const { store, refOf } = harness(4);
		let selectionFired = 0;
		let cellFired = 0;
		const offSelection = store.subscribeSelection(() => {
			selectionFired += 1;
		});
		const offCell = store.subscribeCell(refOf(1).filePath, 'note.Name', () => {
			cellFired += 1;
		});

		store.select({ anchor: refOf(0), focus: refOf(2) });
		expect(selectionFired).toBe(1);
		expect(cellFired).toBe(0);

		setCell(store, refOf(1), 'Only this cell');
		expect(selectionFired).toBe(1);
		expect(cellFired).toBe(1);

		offSelection();
		offCell();
	});
});

describe('rule 2 — selection survives a re-query, and degrades to the nearest survivor', () => {
	it('keeps the same range when the row set is unchanged', () => {
		const { store, source, refOf } = harness(8);
		store.select({ anchor: refOf(2), focus: refOf(5) });
		const before = store.getSnapshot().selection;

		// Nothing changed on disk; the query ran again anyway (a search box keystroke, a sort, a collapse).
		source.notify();

		expect(store.getSnapshot().selection).toEqual(before);
		expect(selectSelectionRows(store.getSnapshot())).toEqual([
			'Notes/002.md',
			'Notes/003.md',
			'Notes/004.md',
			'Notes/005.md',
		]);
	});

	it('re-seats a range whose anchor was removed onto the nearest surviving row', () => {
		const { store, source, refOf } = harness(8);
		store.select({ anchor: refOf(3), focus: refOf(5) });

		source.removeQuietly('Notes/003.md');
		source.notify();

		// The anchor was at index 3 of 8; index 3 of the new order is `Notes/004.md`, so the range is re-seated
		// there and still runs to `Notes/005.md` — five rows of eight became four, and the selection followed.
		expect(store.getSnapshot().selection).toEqual({
			anchor: { filePath: 'Notes/004.md', fieldId: 'note.Name' },
			focus: { filePath: 'Notes/005.md', fieldId: 'note.Name' },
		});
	});

	it('clears the range when every row of it is gone', () => {
		const { store, source, refOf } = harness(3);
		store.select({ anchor: refOf(0), focus: refOf(2) });
		for (const filePath of ['Notes/000.md', 'Notes/001.md', 'Notes/002.md']) {
			source.removeQuietly(filePath);
		}
		source.notify();
		expect(store.getSnapshot().selection).toBeNull();
		expect(store.getSnapshot().rows).toEqual([]);
	});

	it('drops an edit target that has left the view', () => {
		const { store, source, refOf } = harness(4);
		store.select({ anchor: refOf(1), focus: refOf(1) });
		store.setEditing(refOf(1));
		expect(store.getSnapshot().editing).not.toBeNull();
		source.removeQuietly(refOf(1).filePath);
		source.notify();
		expect(store.getSnapshot().editing).toBeNull();
	});
});

describe('rule 3 — one paste, one batch, one undo step', () => {
	/** A paste over four notes: 4 rows × 2 columns × 50 values = 400 cells in 4 files. */
	function paste400() {
		const { store, source, rows } = harness(4);
		const writes = [];
		for (const row of rows) {
			for (let column = 0; column < 100; column += 1) {
				writes.push({
					filePath: row.filePath,
					fieldId: column % 2 === 0 ? 'note.Name' : 'note.Status',
					value: `v${String(column)}`,
				});
			}
		}
		return { store, source, writes, rows };
	}

	it('queues one batch for the paste and one for the undo, and writes each file once per batch', async () => {
		const { store, source, writes } = paste400();
		expect(writes).toHaveLength(400);

		setCells(store, writes, 'Paste 400 cells');
		await settle();
		expect(source.batches()).toHaveLength(1);
		// Every write of a batch lands on its file in one pass: the count is cells, the *files* are distinct.
		expect(source.written()).toBe(400);
		expect(source.filesTouched()).toEqual([
			'Notes/000.md',
			'Notes/001.md',
			'Notes/002.md',
			'Notes/003.md',
		]);

		undoCommand(store);
		await settle();
		expect(source.batches()).toHaveLength(2);
		expect(source.written()).toBe(800);

		// One action is one history step: after one undo there is nothing left to undo.
		expect(store.getSnapshot().canUndo).toBe(false);
		expect(store.getSnapshot().canRedo).toBe(true);
	});

	it('names the step, so the menu can say what will be undone', () => {
		const { store, writes } = paste400();
		setCells(store, writes, 'Paste 400 cells');
		expect(store.getSnapshot().undoLabel).toBe('Paste 400 cells');
	});
});

describe('rule 4 — an external change wins, and never resurrects a deleted row', () => {
	it('replaces values with the source’s, and keeps the store’s own pending values on top', async () => {
		const { store, source, refOf } = harness(5);
		setCell(store, refOf(0), 'Mine');
		await settle();

		// Somebody else edits a different row; the fake reveals it the way a vault watcher would.
		source.setQuietly('Notes/002.md', 'note.Name', 'Theirs');
		source.notify();

		expect(selectCellDisplay(store.state(), refOf(2))).toBe('Theirs');
		expect(selectCellDisplay(store.state(), refOf(0))).toBe('Mine');
	});

	it('drops pending values for rows that disappeared, so nothing is shown for them ever again', async () => {
		const { store, source, refOf } = harness(5);
		setCell(store, refOf(3), 'Typed, not yet written');
		// The apply has not run yet: the value is pending.
		expect(store.getSnapshot().pending).toBe(1);

		// The row is deleted elsewhere before our own write lands.
		source.removeQuietly(refOf(3).filePath);
		source.notify();

		expect(store.getSnapshot().pending).toBe(0);
		expect(store.getSnapshot().rows).not.toContain(refOf(3).filePath);
		expect(selectStatusSummary(store.getSnapshot()).pending).toBe(0);

		// And the late write must not bring the row back.
		await settle();
		expect(store.getSnapshot().rows).not.toContain(refOf(3).filePath);
	});

	it('settles a pending value the source confirms first, without waiting for the queue', async () => {
		const { store, source, refOf } = harness(4);
		const ref = refOf(1);
		setCell(store, ref, 'Written');
		// The file already holds it: this is the ordering a real vault watcher produces when it wins the race.
		source.setQuietly(ref.filePath, ref.fieldId, 'Written');
		source.notify();
		expect(store.getSnapshot().pending).toBe(0);
	});
});

describe('the store’s own contract', () => {
	it('hands back the same snapshot object until something changes', () => {
		const { store, source, refOf } = harness(4);
		const first = store.getSnapshot();
		expect(store.getSnapshot()).toBe(first);

		// A read-only source notification with no change to the data still rebuilds — refresh() is a change of
		// provenance — but the *identity rule* is what matters: two reads with nothing in between are equal.
		store.select({ anchor: refOf(0), focus: refOf(0) });
		const second = store.getSnapshot();
		expect(second).not.toBe(first);
		expect(store.getSnapshot()).toBe(second);
		expect(second.revision).toBe(first.revision + 1);

		// Selecting the same cell again is not a change: no new snapshot, no notification.
		let notified = 0;
		const off = store.subscribe(() => {
			notified += 1;
		});
		store.select({ anchor: refOf(0), focus: refOf(0) });
		expect(store.getSnapshot()).toBe(second);
		expect(notified).toBe(0);
		off();
		void source;
	});

	it('reports a command that cannot run instead of throwing', async () => {
		const { store, refOf } = harness(3);
		expect(deleteRows(store, ['Notes/999.md'])).toEqual({
			ok: false,
			reason: 'none of those rows are in this view',
		});
		expect(clearSelection(store)).toEqual({ ok: false, reason: 'nothing is selected' });
		expect(undoCommand(store)).toEqual({ ok: false, reason: 'there is nothing to undo' });
		expect(moveRowBy(store, 'Notes/000.md', -1)).toEqual({
			ok: false,
			reason: 'that row is already at the top',
		});
		store.select({ anchor: refOf(0), focus: refOf(0) });
		expect(fillDown(store)).toEqual({
			ok: false,
			reason: 'the selection needs more than one row to fill down',
		});
	});

	it('keeps the file’s values when a write is refused, and the reason in the report', async () => {
		const { store, source, refOf } = harness(3);
		const ref = refOf(1);
		source.refuse(ref.filePath, ref.fieldId, 'Created time is read-only');
		setCell(store, ref, 'Never written');
		await settle();

		const snapshot = store.getSnapshot();
		expect(snapshot.pending).toBe(0);
		expect(snapshot.lastApply?.refused).toHaveLength(1);
		expect(source.value(ref.filePath, ref.fieldId)).toBe('Row 1');
	});

	it('survives a source that throws, and says so', async () => {
		const { store, source, refOf } = harness(3);
		const broken: GridStore = store;
		source.apply = (): Promise<never> => Promise.reject(new Error('vault is on fire'));
		const ref = refOf(0);
		setCell(broken, ref, 'x');
		await settle();
		await settle();
		expect(broken.getSnapshot().lastError).toBe('vault is on fire');
		expect(broken.getSnapshot().pending).toBe(0);
	});
});
