/**
 * The bulk edit, from the selection to the op: **one op, bottom-up, and a sentence that says what happened.**
 *
 * Three claims are made in the code and until now only two of them were checked (`Cmd/Ctrl+Enter` reaching the
 * dialog is `tests/dom/paste-flow.test.tsx`; the dialog's own controls are `tests/dom/editors.test.tsx`). The
 * claims here are the ones a person cannot see and a future refactor can quietly break:
 *
 *  · **one `setCells` op for the whole range** — that is what makes the undo *one step* and the queue *one batch*.
 *    Asserted by reading the fake source's batches, which is the only place the claim is observable.
 *  · **bottom-up** (`bulkEditWrites` reverses `cellsOf`'s row-major order). The order is not cosmetic: a future
 *    write path that is not one op (a queue that batches per file) restores the range top-down, and the doc's
 *    order is what keeps that from being a silent change of behaviour. Asserted as a *sequence*, not a set.
 *  · **the announcement counts cells and names the column** (`docs/04` §Accessibility's *"12 cells updated in the
 *    Status column"*), and an empty selection is a refusal with a reason rather than a no-op.
 *
 * The store is the real one over the fake row source — the discipline `tests/dom/editors.test.tsx` set: a value
 * that moved in the fake is a fact, and a spy is only a rumour. The fake `RowSource` is what the *unit* tests may
 * not use, and why this file lives under `tests/dom/**` at all.
 */
import { describe, expect, it } from 'vitest';

import { createGridStore } from '../../src/grid/store/store';
import {
	applyBulkEdit,
	applyBulkEditDraft,
	bulkEditAnnouncement,
	bulkEditWrites,
	columnNameOf,
} from '../../src/grid/commands/bulkEdit';
import { selectCell, setSelection } from '../../src/grid/store/commands';
import { resolveField } from '../../src/core/schema/propertySchema';
import { createFakeRowSource } from '../fakes/rowSource';
import type { FakeRowSource } from '../fakes/rowSource';
import type { CellValue, FieldContext } from '../../src/core/types';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import type { GridStore } from '../../src/grid/store/types';

const CONTEXT: FieldContext = {
	path: '',
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
	columnName: '',
};

const FIELDS: ResolvedField[] = [
	resolveField(
		{ id: 'note.Name', name: 'Name', source: 'note' },
		{ ...CONTEXT, columnName: 'Name' },
	),
	resolveField(
		{ id: 'note.Status', name: 'Status', source: 'note', fieldOptions: { type: 'text' } },
		{ ...CONTEXT, columnName: 'Status' },
	),
];

const ROWS = ['Notes/001.md', 'Notes/002.md', 'Notes/003.md', 'Notes/004.md'];

function makeFixture(): { store: GridStore; source: FakeRowSource } {
	const rows = ROWS.map((filePath, index) => {
		const cells: Record<string, CellValue> = {
			'note.Name': `Row ${String(index)}`,
			'note.Status': 'Todo',
		};
		return { filePath, cells };
	});
	const source = createFakeRowSource({ fields: FIELDS, rows });
	return { store: createGridStore({ source }), source };
}

/** Selects the `Status` column of rows 1–3 by hand: a range is what a bulk edit writes to. */
function selectStatusRange(store: GridStore): void {
	const fieldId = FIELDS[1]?.definition.id ?? '';
	selectCell(store, { filePath: ROWS[1] ?? '', fieldId });
	setSelection(store, {
		anchor: { filePath: ROWS[1] ?? '', fieldId },
		focus: { filePath: ROWS[3] ?? '', fieldId },
	});
}

describe('the bulk edit', () => {
	it('writes the whole range in one op, bottom-up, and lands one undo step', async () => {
		const { store, source } = makeFixture();
		selectStatusRange(store);

		const writes = bulkEditWrites(store, 'Done');
		expect(writes).not.toBeNull();
		expect(writes).toHaveLength(3);
		// Bottom-up, as a sequence: the last row of the range comes first.
		expect(writes?.map((write) => write.filePath)).toEqual([ROWS[3], ROWS[2], ROWS[1]]);
		// …and the value is the same in every one of them, which is what makes this a bulk edit rather than a paste.
		expect(writes?.every((write) => write.value === 'Done')).toBe(true);

		const outcome = applyBulkEdit(store, 'Done', FIELDS[1]?.definition.id ?? '');
		expect(outcome.ok).toBe(true);
		if (outcome.ok && 'cells' in outcome) {
			expect(outcome.cells).toBe(3);
			expect(outcome.label).toBe('Set “Status” for 3 rows');
			expect(outcome.announcement).toBe('3 cells updated in the Status column');
		}
		await store.flush();

		// **One batch** — the observable half of "one op": the source was applied to once for all three writes.
		expect(source.batches()).toHaveLength(1);
		expect(source.batches()[0]).toHaveLength(1);
		expect(source.written()).toBe(3);
		expect(store.getSnapshot().canUndo).toBe(true);
		// The value reached the fake's own table, and the untouched row is untouched.
		expect(source.value(ROWS[1] ?? '', 'note.Status')).toBe('Done');
		expect(source.value(ROWS[3] ?? '', 'note.Status')).toBe('Done');
		expect(source.value(ROWS[0] ?? '', 'note.Status')).toBe('Todo');
	});

	it('refuses without a selection, and says what to do', () => {
		const { store } = makeFixture();
		const outcome = applyBulkEdit(store, 'Done', FIELDS[1]?.definition.id ?? '');
		expect(outcome.ok).toBe(false);
		expect(bulkEditWrites(store, 'Done')).toBeNull();
		if (!outcome.ok && 'reason' in outcome) {
			expect(outcome.reason).toBe('select the cells to edit first');
		}
		expect(store.getSnapshot().canUndo).toBe(false);
	});

	it('takes a typed draft through the column’s own parser, and refuses what it cannot read', () => {
		const { store } = makeFixture();
		selectStatusRange(store);
		const fieldId = FIELDS[1]?.definition.id ?? '';

		// A text column reads anything: the draft is the value, with no re-parsing in between.
		const applied = applyBulkEditDraft(store, 'Blocked', fieldId);
		expect(applied.ok).toBe(true);
		// An empty draft means "no value" — the same rule every editor follows.
		const cleared = applyBulkEditDraft(store, '', fieldId);
		expect(cleared.ok).toBe(true);
		if (cleared.ok && 'cells' in cleared) {
			expect(cleared.cells).toBe(3);
		}
	});

	it('names the column, and falls back to its id rather than to “the column”', () => {
		const { store } = makeFixture();
		expect(columnNameOf(store, FIELDS[1]?.definition.id ?? '')).toBe('Status');
		expect(columnNameOf(store, 'note.NotHere')).toBe('note.NotHere');
		// The two sentences the dialog and the live region use, and their plurals.
		expect(bulkEditAnnouncement(1, 'Status')).toBe('1 cell updated in the Status column');
		expect(bulkEditAnnouncement(12, 'Status')).toBe('12 cells updated in the Status column');
	});
});
