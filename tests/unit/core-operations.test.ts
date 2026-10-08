/**
 * The database-scoped operation algebra — R3 step 4's gate.
 *
 * The promises R3 makes about mutations are all here, and each one is a test rather than a sentence:
 *
 *   1. **Pure and shared.** Applying an operation never touches its input (asserted by comparing the
 *      serialized bytes before and after), and an untouched table or row comes back by reference — so
 *      a cell edit copies one row rather than the document.
 *   2. **Reversible, exactly.** For every operation the suite builds, applying the returned inverses
 *      restores the document *byte for byte*. That is the guide's "property test" half; the seeded
 *      sweep at the bottom runs the same assertion over randomly generated sequences, including
 *      sequences that delete rows other rows point at.
 *   3. **Id-addressed, never name-addressed.** A stale id is a refusal (`no-such-row`), never a write
 *      to whoever carries that name now; renaming a table or a column rewrites no cell and no
 *      reference, which is the identity half of the guide's step-2 bullet surviving into step 4.
 *   4. **One logical action, one transaction.** A batch is applied as a unit: the first refusal stops
 *      it, the input survives untouched, and the inverses come back in undo order.
 *   5. **The ADRs, as behaviour.** `docs/adr/ADR-0002` decides what deleting a row or a table does
 *      (clear inbound links in the same transaction; refuse a referenced table), `ADR-0003` decides
 *      what reordering means, and `ADR-0001` decides what a link write may store (one side stores,
 *      the inverse is derived, order is preserved).
 *
 * A note on the fixture: it is built as JSON text and parsed, because a document built by hand in a
 * test can accidentally differ from one a file produces — unknown keys, in particular, exist to prove
 * that an operation does not quietly drop them.
 */
import { describe, expect, it } from 'vitest';

import {
	applyOperation,
	applyOperations,
	parseDocument,
	serializeDocument,
	validateLinks,
} from '../../src/core/database/index';
import type { DatabaseDocument, DatabaseOperation } from '../../src/core/database/index';
import type { ViewDensity } from '../../src/core/database/index';

const TASKS = 'tbl_' + 'a'.repeat(26);
const PEOPLE = 'tbl_' + 'b'.repeat(26);
const F_TITLE = 'fld_' + 'c'.repeat(26);
const F_STATUS = 'fld_' + 'd'.repeat(26);
const F_OWNER = 'fld_' + 'e'.repeat(26);
const F_TAGS = 'fld_' + 'f'.repeat(26);
const F_STARS = 'fld_' + 'g'.repeat(26);
const F_WEIRD = 'fld_' + 'h'.repeat(26);
const F_BACKLINKS = 'fld_' + 'j'.repeat(26);
const V_ALL = 'viw_' + 'k'.repeat(26);
const V_LATE = 'viw_' + 'm'.repeat(26);
const R_ONE = 'row_' + 'n'.repeat(26);
const R_TWO = 'row_' + 'p'.repeat(26);
const R_THREE = 'row_' + 'q'.repeat(26);
const P_ADA = 'row_' + 'r'.repeat(26);
const P_GRACE = 'row_' + 's'.repeat(26);
const OPT_TODO = 'opt_' + 't'.repeat(26);
const OPT_DOING = 'opt_' + 'u'.repeat(26);
const NEW_TABLE = 'tbl_' + 'v'.repeat(26);
const NEW_FIELD = 'fld_' + 'w'.repeat(26);
const NEW_ROW = 'row_' + 'x'.repeat(26);
const NEW_VIEW = 'viw_' + 'y'.repeat(26);
const NOTES = 'tbl_' + '2'.repeat(26);
const TIMED_TABLE = 'tbl_' + '9'.repeat(26);
const TIMED_TITLE = 'fld_' + '3'.repeat(26);
const TIMED_CREATED = 'fld_' + '4'.repeat(26);
const TIMED_MODIFIED = 'fld_' + '6'.repeat(26);
const TIMED_ROW = 'row_' + '9'.repeat(26);
const TIMED_NEW_ROW = 'row_' + '8'.repeat(26);
const NEW_FIELD_TWO = 'fld_' + '5'.repeat(26);
const NEW_ROW_TWO = 'row_' + '6'.repeat(26);
const NEW_ROW_THREE = 'row_' + '8'.repeat(26);
const NEW_VIEW_TWO = 'viw_' + '7'.repeat(26);

/**
 * The document every test in this file works on: two tables, a multi link and a single link between
 * them, a generated inverse, a select, a number, an unsupported column, unknown keys at every level,
 * three rows and two views.
 */
function documentText(): string {
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: 'db_' + 'z'.repeat(26),
		name: 'Studio',
		futureTopLevel: { keep: true },
		tables: [
			{
				id: TASKS,
				name: 'Tasks',
				futureTableKey: 7,
				fields: [
					{ id: F_TITLE, name: 'Title', type: 'text' },
					{
						id: F_STATUS,
						name: 'Status',
						type: 'singleSelect',
						options: [
							{ id: OPT_TODO, name: 'Todo', color: 'grey' },
							{ id: OPT_DOING, name: 'Doing', color: 'blue' },
						],
					},
					{
						id: F_OWNER,
						name: 'Owner',
						type: 'link',
						targetTableId: PEOPLE,
						allowMultiple: false,
					},
					{
						id: F_TAGS,
						name: 'Tagged',
						type: 'link',
						targetTableId: PEOPLE,
						allowMultiple: true,
						inverseFieldId: F_BACKLINKS,
					},
					{ id: F_STARS, name: 'Stars', type: 'number' },
					{ id: F_WEIRD, name: 'Legacy', type: 'colourSwatch', someSetting: 1 },
				],
				rows: [
					{
						id: R_ONE,
						createdAt: '2026-01-02T09:00:00Z',
						cells: {
							[F_TITLE]: 'Widening',
							[F_STATUS]: OPT_TODO,
							[F_OWNER]: P_ADA,
							[F_TAGS]: [P_GRACE, P_ADA],
							[F_STARS]: 3,
						},
						futureRowKey: 'kept',
					},
					{ id: R_TWO, cells: { [F_TITLE]: 'Bridge', [F_TAGS]: [P_ADA] } },
					{ id: R_THREE, cells: { [F_TITLE]: '' } },
				],
				views: [
					{
						id: V_ALL,
						name: 'All',
						sorts: [{ fieldId: F_TITLE, direction: 'asc' }],
						density: 'tall',
						futureViewKey: true,
					},
					{ id: V_LATE, name: 'Late', hiddenFieldIds: [F_STARS] },
				],
			},
			{
				id: NOTES,
				name: 'Notes',
				fields: [{ id: 'fld_' + '3'.repeat(26), name: 'Body', type: 'longText' }],
				rows: [
					{ id: 'row_' + '4'.repeat(26), cells: { ['fld_' + '3'.repeat(26)]: 'A note' } },
				],
				views: [],
			},
			{
				id: PEOPLE,
				name: 'People',
				fields: [
					{ id: 'fld_' + '1'.repeat(26), name: 'Name', type: 'text' },
					{
						id: F_BACKLINKS,
						name: 'Tasks',
						type: 'link',
						targetTableId: TASKS,
						allowMultiple: true,
						generated: true,
					},
				],
				rows: [
					{ id: P_ADA, cells: { ['fld_' + '1'.repeat(26)]: 'Ada' } },
					{ id: P_GRACE, cells: { ['fld_' + '1'.repeat(26)]: 'Grace' } },
				],
				views: [],
			},
		],
	});
}

function load(text = documentText()): DatabaseDocument {
	const result = parseDocument(text);
	if (!result.ok) {
		throw new Error(
			`the fixture must load: ${result.errors.map((error) => error.code).join(', ')}`,
		);
	}
	return result.document;
}

function taskTitle(document: DatabaseDocument): string | undefined {
	return titleOf(document, R_ONE);
}

/** One row's title, found by id rather than by position — a reorder must not change what this reads. */
function titleOf(document: DatabaseDocument, rowId: string): string | undefined {
	const row = document.tables[0]?.rows.find((candidate) => candidate.id === rowId);
	const stored = row?.cells.get(F_TITLE);
	return typeof stored === 'string' ? stored : undefined;
}

/** Apply one operation and hand back the document it produced, failing loudly if it refused. */
function applied(document: DatabaseDocument, operation: DatabaseOperation): DatabaseDocument {
	const result = applyOperation(document, operation);
	if (!result.ok) {
		throw new Error(`expected "${operation.kind}" to apply; it refused with ${result.code}`);
	}
	return result.document;
}

/** Apply an operation, then its inverses, and assert the document came back byte for byte. */
function expectReversible(document: DatabaseDocument, operation: DatabaseOperation): void {
	const before = serializeDocument(document);
	const result = applyOperation(document, operation);
	if (!result.ok) {
		throw new Error(`expected "${operation.kind}" to apply; it refused with ${result.code}`);
	}
	expect(result.inverses.length).toBeGreaterThan(0);
	const undone = applyOperations(result.document, result.inverses);
	if (!undone.ok) {
		throw new Error(`the inverse of "${operation.kind}" refused with ${undone.code}`);
	}
	expect(serializeDocument(undone.document)).toBe(before);
	// And the operation left its input alone on the way through.
	expect(serializeDocument(document)).toBe(before);
}

describe('an operation is pure, shared and reversible', () => {
	it('never touches the document it was given', () => {
		const document = load();
		const before = serializeDocument(document);
		applied(document, {
			kind: 'set-cells',
			tableId: TASKS,
			rowId: R_ONE,
			edits: [{ fieldId: F_TITLE, value: 'Changed' }],
		});
		expect(serializeDocument(document)).toBe(before);
	});

	it('shares every table it did not change', () => {
		const document = load();
		const next = applied(document, {
			kind: 'set-cells',
			tableId: TASKS,
			rowId: R_ONE,
			edits: [{ fieldId: F_TITLE, value: 'Changed' }],
		});
		expect(next.tables[1]).toBe(document.tables[1]);
		expect(next.tables).not.toBe(document.tables);
		expect(next.tables[0]?.rows[1]).toBe(document.tables[0]?.rows[1]);
		expect(next.tables[0]?.rows[0]).not.toBe(document.tables[0]?.rows[0]);
	});

	it('preserves unknown keys at every level through every kind of change', () => {
		const document = load();
		const next = applied(document, { kind: 'rename-table', tableId: TASKS, name: 'Work' });
		const text = serializeDocument(next);
		expect(text).toContain('"futureTopLevel"');
		expect(text).toContain('"futureTableKey"');
		expect(text).toContain('"futureRowKey"');
		expect(text).toContain('"futureViewKey"');
	});

	it('refuses a stale id instead of writing to whoever holds that name', () => {
		const document = load();
		const missing = `row_${'9'.repeat(26)}`;
		const result = applyOperation(document, {
			kind: 'set-cells',
			tableId: TASKS,
			rowId: missing,
			edits: [{ fieldId: F_TITLE, value: 'x' }],
		});
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.code).toBe('no-such-row');
		expect(result.message).toContain(missing);
		expect(serializeDocument(document)).toBe(serializeDocument(load()));
	});

	it('answers a refusal as a value, with a code a caller can branch on', () => {
		const document = load();
		const cases: readonly { readonly operation: DatabaseOperation; readonly code: string }[] = [
			{
				operation: { kind: 'rename-table', tableId: TASKS, name: '  ' },
				code: 'invalid-name',
			},
			{
				operation: { kind: 'rename-table', tableId: TASKS, name: 'Tasks' },
				code: 'no-change',
			},
			{
				operation: { kind: 'rename-table', tableId: `tbl_${'9'.repeat(26)}`, name: 'X' },
				code: 'no-such-table',
			},
			{
				operation: {
					kind: 'rename-field',
					tableId: TASKS,
					fieldId: F_TITLE,
					name: 'Title',
				},
				code: 'no-change',
			},
			{
				operation: { kind: 'rename-field', tableId: TASKS, fieldId: F_WEIRD, name: 'X' },
				code: 'cell-not-writable',
			},
			{
				operation: { kind: 'move-record', tableId: TASKS, rowId: R_ONE, toIndex: 9 },
				code: 'index-out-of-range',
			},
			{
				operation: { kind: 'move-record', tableId: TASKS, rowId: R_ONE, toIndex: 0 },
				code: 'no-change',
			},
			{
				operation: { kind: 'create-table', tableId: TASKS, name: 'Clash' },
				code: 'duplicate-id',
			},
			{
				operation: { kind: 'set-cells', tableId: TASKS, rowId: R_ONE, edits: [] },
				code: 'no-change',
			},
			{
				operation: {
					kind: 'set-cells',
					tableId: TASKS,
					rowId: R_ONE,
					edits: [
						{ fieldId: F_TITLE, value: 'a' },
						{ fieldId: F_TITLE, value: 'b' },
					],
				},
				code: 'duplicate-edit',
			},
			{
				operation: {
					kind: 'set-cells',
					tableId: TASKS,
					rowId: R_ONE,
					edits: [{ fieldId: F_STARS, value: 'three' }],
				},
				code: 'cell-not-writable',
			},
		];
		for (const entry of cases) {
			const result = applyOperation(document, entry.operation);
			expect([entry.operation.kind, result.ok ? 'ok' : result.code]).toEqual([
				entry.operation.kind,
				entry.code,
			]);
		}
	});
});

describe('every kind is reversible, exactly', () => {
	const cases: readonly { readonly label: string; readonly operation: DatabaseOperation }[] = [
		{ label: 'database name', operation: { kind: 'set-document-name', name: 'Atelier' } },
		{
			label: 'create table',
			operation: { kind: 'create-table', tableId: NEW_TABLE, name: 'Notes' },
		},
		{
			label: 'rename table',
			operation: { kind: 'rename-table', tableId: TASKS, name: 'Work' },
		},
		{ label: 'move table', operation: { kind: 'move-table', tableId: TASKS, toIndex: 1 } },
		{ label: 'delete table', operation: { kind: 'delete-table', tableId: NOTES } },
		{
			label: 'create field',
			operation: {
				kind: 'create-field',
				tableId: TASKS,
				fieldId: NEW_FIELD,
				name: 'Owner email',
				type: 'email',
			},
		},
		{
			label: 'create field with settings',
			operation: {
				kind: 'create-field',
				tableId: TASKS,
				fieldId: NEW_FIELD_TWO,
				name: 'Effort',
				type: 'rating',
				settings: { max: 5 },
			},
		},
		{
			label: 'rename field',
			operation: { kind: 'rename-field', tableId: TASKS, fieldId: F_TITLE, name: 'Subject' },
		},
		{
			label: 'reconfigure field (type)',
			operation: {
				kind: 'reconfigure-field',
				tableId: TASKS,
				fieldId: F_STARS,
				type: 'currency',
				settings: { symbol: '€', precision: 2 },
			},
		},
		{
			label: 'reconfigure field (options)',
			operation: {
				kind: 'reconfigure-field',
				tableId: TASKS,
				fieldId: F_STATUS,
				settings: {
					options: [{ id: OPT_TODO, name: 'To do', color: 'grey', unknown: [] }],
				},
			},
		},
		{
			label: 'move field',
			operation: { kind: 'move-field', tableId: TASKS, fieldId: F_TITLE, toIndex: 4 },
		},
		{
			label: 'delete field with values',
			operation: { kind: 'delete-field', tableId: TASKS, fieldId: F_TAGS },
		},
		{
			label: 'delete empty field',
			operation: { kind: 'delete-field', tableId: TASKS, fieldId: F_WEIRD },
		},
		{
			label: 'create record',
			operation: { kind: 'create-record', tableId: TASKS, rowId: NEW_ROW },
		},
		{
			label: 'create record at an index with cells',
			operation: {
				kind: 'create-record',
				tableId: TASKS,
				rowId: NEW_ROW_TWO,
				toIndex: 1,
				cells: [
					{ fieldId: F_TITLE, value: 'Roof survey' },
					{ fieldId: F_TAGS, value: [P_GRACE] },
				],
			},
		},
		{
			label: 'duplicate record',
			operation: {
				kind: 'duplicate-record',
				tableId: TASKS,
				rowId: R_ONE,
				newRowId: NEW_ROW_THREE,
			},
		},
		{
			label: 'set one cell',
			operation: {
				kind: 'set-cells',
				tableId: TASKS,
				rowId: R_ONE,
				edits: [{ fieldId: F_TITLE, value: 'Widened' }],
			},
		},
		{
			label: 'clear one cell',
			operation: {
				kind: 'set-cells',
				tableId: TASKS,
				rowId: R_ONE,
				edits: [{ fieldId: F_TITLE, value: null }],
			},
		},
		{
			label: 'set many cells at once',
			operation: {
				kind: 'set-cells',
				tableId: TASKS,
				rowId: R_TWO,
				edits: [
					{ fieldId: F_TITLE, value: 'Bridge II' },
					{ fieldId: F_STARS, value: 4 },
					{ fieldId: F_STATUS, value: null },
				],
			},
		},
		{
			label: 'move record',
			operation: { kind: 'move-record', tableId: TASKS, rowId: R_THREE, toIndex: 0 },
		},
		{
			label: 'delete record',
			operation: { kind: 'delete-record', tableId: TASKS, rowId: R_TWO },
		},
		{
			label: 'delete a record others link to',
			operation: { kind: 'delete-record', tableId: PEOPLE, rowId: P_ADA },
		},
		{
			label: 'create view',
			operation: { kind: 'create-view', tableId: TASKS, viewId: NEW_VIEW, name: 'Mine' },
		},
		{
			label: 'rename view',
			operation: { kind: 'rename-view', tableId: TASKS, viewId: V_ALL, name: 'Everything' },
		},
		{
			label: 'duplicate view',
			operation: {
				kind: 'duplicate-view',
				tableId: TASKS,
				viewId: V_LATE,
				newViewId: NEW_VIEW_TWO,
				name: 'Late (copy)',
			},
		},
		{
			label: 'delete view',
			operation: { kind: 'delete-view', tableId: TASKS, viewId: V_LATE },
		},
		{
			label: 'update view presentation',
			operation: {
				kind: 'update-view',
				tableId: TASKS,
				viewId: V_ALL,
				patch: {
					hiddenFieldIds: [F_WEIRD],
					columnOrder: [F_STATUS, F_TITLE],
					widths: new Map([[F_TITLE, 240]]),
					density: 'short',
					frozenPrimary: true,
					groupBy: F_STATUS,
					collapsedKeys: [OPT_TODO],
					sorts: [{ fieldId: F_STARS, direction: 'desc', unknown: [] }],
				},
			},
		},
		{
			label: 'update view filter',
			operation: {
				kind: 'update-view',
				tableId: TASKS,
				viewId: V_LATE,
				patch: { filter: { version: 1, expr: { kind: 'empty', fieldId: F_STARS } } },
			},
		},
		{
			label: 'clear a view filter',
			operation: {
				kind: 'update-view',
				tableId: TASKS,
				viewId: V_ALL,
				patch: { filter: null },
			},
		},
		{
			label: 'set a multiple link',
			operation: {
				kind: 'set-link',
				tableId: TASKS,
				rowId: R_TWO,
				fieldId: F_TAGS,
				rowIds: [P_GRACE, P_ADA],
			},
		},
		{
			label: 'set a single link',
			operation: {
				kind: 'set-link',
				tableId: TASKS,
				rowId: R_TWO,
				fieldId: F_OWNER,
				rowIds: [P_GRACE],
			},
		},
		{
			label: 'clear a link',
			operation: {
				kind: 'set-link',
				tableId: TASKS,
				rowId: R_ONE,
				fieldId: F_TAGS,
				rowIds: [],
			},
		},
	];

	it('has a case for every user-facing kind', () => {
		const kinds = new Set(cases.map((entry) => entry.operation.kind));
		expect([...kinds].sort()).toEqual([
			'create-field',
			'create-record',
			'create-table',
			'create-view',
			'delete-field',
			'delete-record',
			'delete-table',
			'delete-view',
			'duplicate-record',
			'duplicate-view',
			'move-field',
			'move-record',
			'move-table',
			'reconfigure-field',
			'rename-field',
			'rename-table',
			'rename-view',
			'set-cells',
			'set-document-name',
			'set-link',
			'update-view',
		]);
	});

	for (const entry of cases) {
		it(`restores the document after "${entry.label}"`, () => {
			expectReversible(load(), entry.operation);
		});
	}

	it('restores a document after each kind in turn, on one document, in sequence', () => {
		// A history, not a pair: apply everything, then undo everything in reverse order. This is the
		// shape the real history stack has, and it is where a wrong inverse ordering would show up.
		const document = load();
		const start = serializeDocument(document);
		let current = document;
		const undo: DatabaseOperation[] = [];
		// Deletions last: a sequence that removes a column and then edits it is a *refusal*, which the
		// refusals test covers. What this test is about is a long history undone in reverse.
		const ordered = [
			...cases.filter((entry) => !entry.operation.kind.startsWith('delete')),
			...cases.filter((entry) => entry.operation.kind.startsWith('delete')),
		];
		for (const entry of ordered) {
			const result = applyOperation(current, entry.operation);
			if (!result.ok) {
				throw new Error(`"${entry.label}" refused with ${result.code} in the sequence`);
			}
			current = result.document;
			undo.unshift(...result.inverses);
		}
		expect(serializeDocument(current)).not.toBe(start);
		const undone = applyOperations(current, undo);
		if (!undone.ok) {
			throw new Error(`the sequence undo refused with ${undone.code}`);
		}
		expect(serializeDocument(undone.document)).toBe(start);
	});
});

describe('identity survives renames and moves', () => {
	it('renames a table without touching a cell, a row id or a link', () => {
		const document = load();
		const next = applied(document, { kind: 'rename-table', tableId: TASKS, name: 'Work' });
		const before = document.tables[0];
		const after = next.tables[0];
		expect(after?.name).toBe('Work');
		expect(after?.id).toBe(TASKS);
		expect(after?.rows.map((row) => row.id)).toEqual(before?.rows.map((row) => row.id));
		expect(taskTitle(next)).toBe(taskTitle(document));
		expect(serializeDocument(next).replace('"Work"', '"Tasks"')).toBe(
			serializeDocument(document),
		);
	});

	it('renames a column without rewriting a cell or a saved view reference', () => {
		const document = load();
		const next = applied(document, {
			kind: 'rename-field',
			tableId: TASKS,
			fieldId: F_TITLE,
			name: 'Subject',
		});
		expect(
			next.tables[0]?.fields[0]?.kind === 'field' ? next.tables[0].fields[0].name : undefined,
		).toBe('Subject');
		expect(taskTitle(next)).toBe('Widening');
		// The saved sort still names the field by id, so the rename cannot break it.
		expect(JSON.stringify(next.tables[0]?.views[0]?.sorts)).toContain(F_TITLE);
		expect(serializeDocument(next).replace('"Subject"', '"Title"')).toBe(
			serializeDocument(document),
		);
	});

	it('reorders rows without changing any cell value', () => {
		const document = load();
		const next = applied(document, {
			kind: 'move-record',
			tableId: TASKS,
			rowId: R_THREE,
			toIndex: 0,
		});
		expect(next.tables[0]?.rows.map((row) => row.id)).toEqual([R_THREE, R_ONE, R_TWO]);
		// The values travelled with their rows, and the moved row is the one that owns the empty title.
		expect(titleOf(next, R_ONE)).toBe('Widening');
		expect(titleOf(next, R_THREE)).toBe('');
		expect(next.tables[0]?.rows[2]).toBe(document.tables[0]?.rows[1]);
	});
});

describe('ADR-0002: deleting a row or a table with inbound links', () => {
	it('clears every inbound id in the same operation, and undo puts them back in order', () => {
		const document = load();
		const result = applyOperation(document, {
			kind: 'delete-record',
			tableId: PEOPLE,
			rowId: P_ADA,
		});
		if (!result.ok) {
			throw new Error(`deleting Ada refused with ${result.code}`);
		}
		const tasks = result.document.tables.find((table) => table.id === TASKS);
		const people = result.document.tables.find((table) => table.id === PEOPLE);
		// R_ONE's multi link was [Grace, Ada] and R_TWO's single link was Ada. Both lose Ada; Grace stays
		// exactly where she was, which is the ordering half of ADR-0001 §4.
		expect(tasks?.rows[0]?.cells.get(F_TAGS)).toEqual([P_GRACE]);
		expect(tasks?.rows[1]?.cells.has(F_OWNER)).toBe(false);
		expect(people?.rows.map((row) => row.id)).toEqual([P_GRACE]);
		expect(validateLinks(result.document)).toEqual([]);
	});

	it('restores the row, its position and the cleared values exactly', () => {
		expectReversible(load(), { kind: 'delete-record', tableId: PEOPLE, rowId: P_ADA });
	});

	it('refuses to delete a table another table links into, naming the referrers', () => {
		const document = load();
		const result = applyOperation(document, { kind: 'delete-table', tableId: PEOPLE });
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.code).toBe('referenced-table');
		expect(result.message).toContain('"Tasks"');
		expect(result.message).toContain('Owner');
		expect(result.message).toContain('Tagged');
	});

	it('deletes a table freely once nothing points at it, whole, and restores it whole', () => {
		const document = load();
		// Remove the two link fields that refer into People, then the delete is plain.
		const cleared = applied(document, {
			kind: 'delete-field',
			tableId: TASKS,
			fieldId: F_OWNER,
		});
		const withoutTags = applied(cleared, {
			kind: 'delete-field',
			tableId: TASKS,
			fieldId: F_TAGS,
		});
		expect(validateLinks(withoutTags)).toEqual([]);
		const deleted = applied(withoutTags, { kind: 'delete-table', tableId: PEOPLE });
		expect(deleted.tables.map((table) => table.id)).toEqual([TASKS, NOTES]);
		expectReversible(withoutTags, { kind: 'delete-table', tableId: PEOPLE });
	});

	it('leaves a document with dangling links readable, and refuses to delete the table they point at', () => {
		const dangling = documentText().replace(`"${P_ADA}"`, `"row_${'9'.repeat(26)}"`);
		const document = load(dangling);
		expect(validateLinks(document).some((finding) => finding.code === 'unresolved-link')).toBe(
			true,
		);
		const result = applyOperation(document, { kind: 'delete-table', tableId: PEOPLE });
		expect(result.ok ? 'ok' : result.code).toBe('referenced-table');
		// The dangling value itself is untouched by the refusal.
		expect(serializeDocument(document)).toBe(serializeDocument(load(dangling)));
	});
});

describe('ADR-0001: what a link write may store', () => {
	it('stores one id for a single link and an ordered list for a multi link', () => {
		const single = applied(load(), {
			kind: 'set-link',
			tableId: TASKS,
			rowId: R_TWO,
			fieldId: F_OWNER,
			rowIds: [P_ADA],
		});
		expect(single.tables[0]?.rows[1]?.cells.get(F_OWNER)).toBe(P_ADA);
		const multi = applied(load(), {
			kind: 'set-link',
			tableId: TASKS,
			rowId: R_TWO,
			fieldId: F_TAGS,
			rowIds: [P_GRACE, P_ADA],
		});
		expect(multi.tables[0]?.rows[1]?.cells.get(F_TAGS)).toEqual([P_GRACE, P_ADA]);
		const cleared = applied(load(), {
			kind: 'set-link',
			tableId: TASKS,
			rowId: R_ONE,
			fieldId: F_TAGS,
			rowIds: [],
		});
		expect(cleared.tables[0]?.rows[0]?.cells.has(F_TAGS)).toBe(false);
	});

	it('advances row metadata only when the host supplies a valid timestamp, and undo restores it', () => {
		const document = load();
		const before = serializeDocument(document);
		const updatedAt = '2026-08-09T10:11:12Z';
		const result = applyOperation(document, {
			kind: 'set-link',
			tableId: TASKS,
			rowId: R_TWO,
			fieldId: F_OWNER,
			rowIds: [P_ADA],
			updatedAt,
		});
		if (!result.ok) {
			throw new Error(`the timestamped link write refused with ${result.code}`);
		}
		expect(result.document.tables[0]?.rows[1]?.updatedAt).toBe(updatedAt);
		const undone = applyOperations(result.document, result.inverses);
		if (!undone.ok) {
			throw new Error(`undoing the timestamped link write refused with ${undone.code}`);
		}
		expect(serializeDocument(undone.document)).toBe(before);

		const unchanged = applied(document, {
			kind: 'set-link',
			tableId: TASKS,
			rowId: R_TWO,
			fieldId: F_OWNER,
			rowIds: [P_ADA],
		});
		expect(unchanged.tables[0]?.rows[1]?.updatedAt).toBeNull();
		expect(
			applyOperation(document, {
				kind: 'set-link',
				tableId: TASKS,
				rowId: R_TWO,
				fieldId: F_OWNER,
				rowIds: [P_ADA],
				updatedAt: '2026-08-09T10:11:12',
			}),
		).toMatchObject({ ok: false, code: 'invalid-row-timestamp' });
	});

	it('never writes the derived inverse side', () => {
		const next = applied(load(), {
			kind: 'set-link',
			tableId: TASKS,
			rowId: R_TWO,
			fieldId: F_TAGS,
			rowIds: [P_GRACE],
		});
		expect(next.tables[1]?.rows.every((row) => !row.cells.has(F_BACKLINKS))).toBe(true);
		const refused = applyOperation(load(), {
			kind: 'set-link',
			tableId: PEOPLE,
			rowId: P_ADA,
			fieldId: F_BACKLINKS,
			rowIds: [R_ONE],
		});
		expect(refused.ok ? 'ok' : refused.code).toBe('generated-field');
	});

	it('refuses an id that is not in the target table, and a duplicate in one list', () => {
		const missing = applyOperation(load(), {
			kind: 'set-link',
			tableId: TASKS,
			rowId: R_ONE,
			fieldId: F_TAGS,
			rowIds: [`row_${'9'.repeat(26)}`],
		});
		expect(missing.ok ? 'ok' : missing.code).toBe('unresolved-link');
		const wrongTable = applyOperation(load(), {
			kind: 'set-link',
			tableId: TASKS,
			rowId: R_ONE,
			fieldId: F_TAGS,
			rowIds: [R_TWO],
		});
		expect(wrongTable.ok ? 'ok' : wrongTable.code).toBe('unresolved-link');
		const twice = applyOperation(load(), {
			kind: 'set-link',
			tableId: TASKS,
			rowId: R_ONE,
			fieldId: F_TAGS,
			rowIds: [P_ADA, P_ADA],
		});
		expect(twice.ok ? 'ok' : twice.code).toBe('unresolved-link');
	});

	it('refuses two ids for a single link', () => {
		const result = applyOperation(load(), {
			kind: 'set-link',
			tableId: TASKS,
			rowId: R_TWO,
			fieldId: F_OWNER,
			rowIds: [P_ADA, P_GRACE],
		});
		expect(result.ok ? 'ok' : result.code).toBe('link-cardinality');
	});

	it('refuses a write to a column that is not a link', () => {
		const result = applyOperation(load(), {
			kind: 'set-link',
			tableId: TASKS,
			rowId: R_ONE,
			fieldId: F_TITLE,
			rowIds: [P_ADA],
		});
		expect(result.ok ? 'ok' : result.code).toBe('not-a-link-field');
	});
});

describe('a type change refuses to strand stored values', () => {
	it('refuses when a stored value cannot be written as the new type', () => {
		const result = applyOperation(load(), {
			kind: 'reconfigure-field',
			tableId: TASKS,
			fieldId: F_TITLE,
			type: 'date',
		});
		expect(result.ok ? 'ok' : result.code).toBe('type-change-loses-data');
	});

	it('allows it when nothing is stored, and restores the old type and settings on undo', () => {
		const document = load();
		const empty = applied(document, {
			kind: 'set-cells',
			tableId: TASKS,
			rowId: R_ONE,
			edits: [{ fieldId: F_STARS, value: null }],
		});
		expectReversible(empty, {
			kind: 'reconfigure-field',
			tableId: TASKS,
			fieldId: F_STARS,
			type: 'text',
		});
	});

	it('keeps option ids that the new option list does not know', () => {
		// ADR-0004: an unknown option id is kept and reported, never repaired. So a narrower option list
		// is allowed, and the stored ids stay exactly as they were.
		const next = applied(load(), {
			kind: 'reconfigure-field',
			tableId: TASKS,
			fieldId: F_STATUS,
			settings: { options: [{ id: OPT_TODO, name: 'To do', color: 'grey', unknown: [] }] },
		});
		expect(next.tables[0]?.rows[0]?.cells.get(F_STATUS)).toBe(OPT_TODO);
	});
});

describe('a batch is one transaction', () => {
	it('returns the inverses in undo order', () => {
		const document = load();
		const result = applyOperations(document, [
			{ kind: 'create-record', tableId: TASKS, rowId: NEW_ROW },
			{
				kind: 'set-cells',
				tableId: TASKS,
				rowId: NEW_ROW,
				edits: [{ fieldId: F_TITLE, value: 'New' }],
			},
			{ kind: 'rename-table', tableId: TASKS, name: 'Work' },
		]);
		if (!result.ok) {
			throw new Error(`the batch refused with ${result.code}`);
		}
		expect(result.inverses.map((operation) => operation.kind)).toEqual([
			'rename-table',
			'set-cells',
			'delete-record',
		]);
		const undone = applyOperations(result.document, result.inverses);
		if (!undone.ok) {
			throw new Error(`undoing the batch refused with ${undone.code}`);
		}
		expect(serializeDocument(undone.document)).toBe(serializeDocument(document));
	});

	it('stops at the first refusal and changes nothing at all', () => {
		const document = load();
		const before = serializeDocument(document);
		const result = applyOperations(document, [
			{ kind: 'rename-table', tableId: TASKS, name: 'Work' },
			{
				kind: 'set-cells',
				tableId: TASKS,
				rowId: `row_${'9'.repeat(26)}`,
				edits: [{ fieldId: F_TITLE, value: 'x' }],
			},
			{ kind: 'set-document-name', name: 'Never' },
		]);
		expect(result.ok ? 'ok' : result.code).toBe('no-such-row');
		expect(serializeDocument(document)).toBe(before);
	});

	it('applies an empty batch as a no-op with no inverses', () => {
		const document = load();
		const result = applyOperations(document, []);
		expect(result.ok && result.inverses).toEqual([]);
		expect(result.ok && serializeDocument(result.document)).toBe(serializeDocument(document));
	});
});

/** A tiny deterministic generator: the sweep must fail the same way twice, or it is not evidence. */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return state / 2147483648;
	};
}

describe('row timestamp metadata is read-only and reversible', () => {
	function timestampDocument(): DatabaseDocument {
		return load(
			JSON.stringify({
				format: 'tablify',
				version: 1,
				databaseId: 'db_' + '5'.repeat(26),
				name: 'Timed rows',
				tables: [
					{
						id: TIMED_TABLE,
						name: 'Entries',
						fields: [
							{ id: TIMED_TITLE, name: 'Title', type: 'text' },
							{ id: TIMED_CREATED, name: 'Created', type: 'createdTime' },
							{ id: TIMED_MODIFIED, name: 'Modified', type: 'lastModifiedTime' },
						],
						rows: [
							{
								id: TIMED_ROW,
								createdAt: '2026-01-02T09:00:00Z',
								updatedAt: '2026-02-03T10:00:00+01:00',
								cells: {
									[TIMED_TITLE]: 'Before',
									[TIMED_CREATED]: 'stale created cell',
									[TIMED_MODIFIED]: 'stale modified cell',
								},
							},
						],
						views: [],
					},
				],
			}),
		);
	}

	it('accepts only host-supplied row instants and restores last-modified time on undo', () => {
		const document = timestampDocument();
		const before = serializeDocument(document);
		const modifiedAt = '2026-06-07T08:09:10Z';
		const result = applyOperation(document, {
			kind: 'set-cells',
			tableId: TIMED_TABLE,
			rowId: TIMED_ROW,
			edits: [{ fieldId: TIMED_TITLE, value: 'After' }],
			updatedAt: modifiedAt,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.document.tables[0]?.rows[0]?.updatedAt).toBe(modifiedAt);
		const undone = applyOperations(result.document, result.inverses);
		expect(undone.ok).toBe(true);
		if (undone.ok) {
			expect(serializeDocument(undone.document)).toBe(before);
		}

		const invalid = applyOperation(document, {
			kind: 'set-cells',
			tableId: TIMED_TABLE,
			rowId: TIMED_ROW,
			edits: [{ fieldId: TIMED_TITLE, value: 'Rejected' }],
			updatedAt: '2026-06-07T08:09:10',
		});
		expect(invalid).toMatchObject({ ok: false, code: 'invalid-row-timestamp' });
	});

	it('creates and duplicates rows with their own timestamps, never the source row timestamps', () => {
		const document = timestampDocument();
		const createdAt = '2026-04-05T12:00:00Z';
		const updatedAt = '2026-04-05T12:00:00Z';
		const create = applyOperation(document, {
			kind: 'create-record',
			tableId: TIMED_TABLE,
			rowId: TIMED_NEW_ROW,
			createdAt,
			updatedAt,
			cells: [{ fieldId: TIMED_TITLE, value: 'New' }],
		});
		expect(create.ok).toBe(true);
		if (!create.ok) {
			return;
		}
		expect(create.document.tables[0]?.rows[1]).toMatchObject({ createdAt, updatedAt });
		const undoneCreate = applyOperations(create.document, create.inverses);
		expect(undoneCreate.ok).toBe(true);
		if (undoneCreate.ok) {
			expect(serializeDocument(undoneCreate.document)).toBe(serializeDocument(document));
		}

		const duplicate = applyOperation(document, {
			kind: 'duplicate-record',
			tableId: TIMED_TABLE,
			rowId: TIMED_ROW,
			newRowId: TIMED_NEW_ROW,
			createdAt,
			updatedAt,
		});
		expect(duplicate.ok).toBe(true);
		if (duplicate.ok) {
			expect(duplicate.document.tables[0]?.rows[1]).toMatchObject({ createdAt, updatedAt });
			expect(duplicate.document.tables[0]?.rows[1]?.createdAt).not.toBe(
				document.tables[0]?.rows[0]?.createdAt,
			);
		}
	});

	it('refuses timestamp values but permits an explicit repair-clear of a stale raw cell', () => {
		const document = timestampDocument();
		for (const fieldId of [TIMED_CREATED, TIMED_MODIFIED]) {
			const result = applyOperation(document, {
				kind: 'set-cells',
				tableId: TIMED_TABLE,
				rowId: TIMED_ROW,
				edits: [{ fieldId, value: '2026-06-07T08:09:10Z' }],
			});
			expect(result).toMatchObject({ ok: false, code: 'cell-not-writable' });
		}

		const clear = applyOperation(document, {
			kind: 'set-cells',
			tableId: TIMED_TABLE,
			rowId: TIMED_ROW,
			edits: [{ fieldId: TIMED_CREATED, value: null }],
		});
		expect(clear.ok).toBe(true);
		if (clear.ok) {
			expect(clear.document.tables[0]?.rows[0]?.createdAt).toBe('2026-01-02T09:00:00Z');
			expect(clear.document.tables[0]?.rows[0]?.cells.has(TIMED_CREATED)).toBe(false);
			const restored = applyOperations(clear.document, clear.inverses);
			expect(restored.ok).toBe(true);
			if (restored.ok) {
				expect(serializeDocument(restored.document)).toBe(serializeDocument(document));
			}
		}

		const createWithEmptyTimeCell = applyOperation(document, {
			kind: 'create-record',
			tableId: TIMED_TABLE,
			rowId: TIMED_NEW_ROW,
			cells: [{ fieldId: TIMED_CREATED, value: null }],
		});
		expect(createWithEmptyTimeCell.ok).toBe(true);
		if (createWithEmptyTimeCell.ok) {
			expect(
				createWithEmptyTimeCell.document.tables[0]?.rows[1]?.cells.has(TIMED_CREATED),
			).toBe(false);
		}
	});
});

describe('the property sweep', () => {
	/** Every generator takes the document and a random source, and answers an operation. */
	const densities: readonly ViewDensity[] = ['short', 'medium', 'tall'];
	const rows: readonly string[] = [R_ONE, R_TWO, R_THREE];
	const generators: readonly ((next: () => number) => DatabaseOperation)[] = [
		(next) => ({
			kind: 'set-document-name',
			name: `Name ${String(Math.floor(next() * 1000))}`,
		}),
		() => ({
			kind: 'rename-table',
			tableId: TASKS,
			name: `Work ${String(Math.floor(Math.random() * 0))}`,
		}),
		(next) => ({
			kind: 'move-table',
			tableId: next() < 0.5 ? TASKS : PEOPLE,
			toIndex: Math.floor(next() * 2),
		}),
		(next) => ({
			kind: 'rename-field',
			tableId: TASKS,
			fieldId: F_TITLE,
			name: `Title ${String(Math.floor(next() * 100))}`,
		}),
		(next) => ({
			kind: 'move-field',
			tableId: TASKS,
			fieldId: F_STARS,
			toIndex: Math.floor(next() * 6),
		}),
		(next) => ({
			kind: 'set-cells',
			tableId: TASKS,
			rowId: rows[Math.floor(next() * 3)] ?? R_ONE,
			edits: [
				{
					fieldId: F_TITLE,
					value: next() < 0.2 ? null : `T${String(Math.floor(next() * 50))}`,
				},
				{ fieldId: F_STARS, value: next() < 0.2 ? null : Math.floor(next() * 6) },
				{
					fieldId: F_STATUS,
					value: next() < 0.5 ? null : next() < 0.5 ? OPT_TODO : OPT_DOING,
				},
			],
		}),
		(next) => ({
			kind: 'move-record',
			tableId: TASKS,
			rowId: R_THREE,
			toIndex: Math.floor(next() * 3),
		}),
		(next) => ({
			kind: 'set-link',
			tableId: TASKS,
			rowId: R_ONE,
			fieldId: F_TAGS,
			rowIds: next() < 0.3 ? [] : next() < 0.6 ? [P_ADA] : [P_GRACE, P_ADA],
		}),
		(next) => ({
			kind: 'set-link',
			tableId: TASKS,
			rowId: R_TWO,
			fieldId: F_OWNER,
			rowIds: next() < 0.3 ? [] : [P_GRACE],
		}),
		(next) => ({
			kind: 'update-view',
			tableId: TASKS,
			viewId: next() < 0.5 ? V_ALL : V_LATE,
			patch: { density: densities[Math.floor(next() * 3)] ?? 'short' },
		}),
		(next) => ({
			kind: 'move-record',
			tableId: PEOPLE,
			rowId: P_ADA,
			toIndex: next() < 0.5 ? 0 : 1,
		}),
		(next) => ({
			kind: 'duplicate-record',
			tableId: TASKS,
			rowId: R_ONE,
			newRowId: NEW_ROW,
			toIndex: Math.floor(next() * 4),
		}),
		(next) => ({
			kind: 'delete-record',
			tableId: TASKS,
			rowId: R_THREE,
			tableIsTasks: next() < 1,
		}),
		(next) => ({ kind: 'create-record', tableId: PEOPLE, rowId: NEW_ROW, cells: [] }),
		() => ({ kind: 'delete-view', tableId: TASKS, viewId: V_LATE }),
	];

	it('is deterministic for a given seed', () => {
		expect(seededRandom(7)()).toBe(seededRandom(7)());
	});

	it('apply-then-inverse restores the document for every generated operation', () => {
		for (let seed = 1; seed <= 60; seed += 1) {
			const next = seededRandom(seed);
			for (const generate of generators) {
				const document = load();
				const operation = generate(next);
				const before = serializeDocument(document);
				const result = applyOperation(document, operation);
				if (!result.ok) {
					continue;
				}
				// Nothing about the input moved, whatever the operation did.
				expect([seed, operation.kind, serializeDocument(document)]).toEqual([
					seed,
					operation.kind,
					before,
				]);
				const undone = applyOperations(result.document, result.inverses);
				if (!undone.ok) {
					throw new Error(
						`seed ${String(seed)}: the inverse of "${operation.kind}" refused with ${undone.code}`,
					);
				}
				expect([seed, operation.kind, serializeDocument(undone.document)]).toEqual([
					seed,
					operation.kind,
					before,
				]);
			}
		}
	});

	it('a random sequence undoes exactly, in reverse', () => {
		for (let seed = 100; seed <= 130; seed += 1) {
			const next = seededRandom(seed);
			const document = load();
			const before = serializeDocument(document);
			let current = document;
			const undo: DatabaseOperation[] = [];
			let appliedCount = 0;
			for (let step = 0; step < 12; step += 1) {
				const operation = (
					generators[Math.floor(next() * generators.length)] ?? generators[0]
				)?.(next);
				if (operation === undefined) {
					continue;
				}
				const result = applyOperation(current, operation);
				if (!result.ok) {
					continue;
				}
				appliedCount += 1;
				current = result.document;
				undo.unshift(...result.inverses);
			}
			const undone = applyOperations(current, undo);
			if (!undone.ok) {
				throw new Error(
					`seed ${String(seed)}: the sequence undo refused with ${undone.code}`,
				);
			}
			expect([seed, appliedCount > 0, serializeDocument(undone.document)]).toEqual([
				seed,
				true,
				before,
			]);
		}
	});
});
