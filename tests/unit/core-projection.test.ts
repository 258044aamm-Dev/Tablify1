/**
 * The active-table projection — R3 step 2's gate.
 *
 * ADR-0012 says the document is the only authoritative state and the table a pane shows is *derived*
 * from it. This file is where that stops being a sentence: the projection hands back the document's
 * own row and field objects, the lookup functions distinguish "no value" from "no such row", a row's
 * number comes from the manual order and is never stored, and a saved view's sort produces a
 * sequence of row ids without touching a byte of the document.
 *
 * Three claims here are exit criteria of R3 as a whole, so they are asserted by name:
 *
 *   - **isolation** — a view that belongs to one table sorts that table and only that table;
 *   - **never on a path** — the projection's vocabulary is ids, and the only path-shaped thing in the
 *     file is the fixture it reads from disk;
 *   - **determinism** — the same document revision produces the same sequence, twice.
 *
 * The last test pins the module to the shipped `rows-views` fixture: a two-table database with a
 * sorted view, a filtered view, links and a generated inverse, so the projection is proven against
 * the same file the parser is.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseDocument } from '../../src/core/database/index';
import type { DatabaseDocument } from '../../src/core/database/index';
import { cellRef, cellKey, sameCell } from '../../src/core/database/refs';
import type { CellRef } from '../../src/core/database/refs';
import {
	canonicalComparison,
	cellOf,
	compareCanonical,
	displayOrder,
	fieldAt,
	projectTable,
	rowAt,
	rowNumber,
	sortRowIds,
	viewAt,
} from '../../src/core/database/projection';
import type { ActiveTableSnapshot } from '../../src/core/database/projection';

function fixtureText(): string {
	return readFileSync(new URL('../fixtures/tablify/rows-views.tablify', import.meta.url), 'utf8');
}

function fixture(): DatabaseDocument {
	const loaded = parseDocument(fixtureText());
	if (!loaded.ok) {
		throw new Error(
			`the rows-views fixture must load: ${loaded.errors.map((error) => error.code).join(', ')}`,
		);
	}
	return loaded.document;
}

/** The `id` of one entry of a list, or a refusal that names the fixture rather than an assertion. */
function idOf(entries: readonly { readonly id: string | null }[], index: number): string {
	const found = entries[index]?.id;
	if (found === undefined || found === null) {
		throw new Error(`the fixture must have an entry at index ${String(index)} with an id`);
	}
	return found;
}

/**
 * The fixture's ids, read out of the fixture and never composed here: an id written from memory is
 * an id that disagrees with the file, which is how three fixture ids were once a character short.
 */
const FIXTURE = fixture();
const SHOOTS = FIXTURE.tables[0];
const CLIENTS = FIXTURE.tables[1];
if (SHOOTS === undefined || CLIENTS === undefined) {
	throw new Error('the rows-views fixture must carry two tables');
}
const T_SHOOTS = SHOOTS.id;
const T_CLIENTS = CLIENTS.id;
const F_TITLE = idOf(SHOOTS.fields, 0);
const F_GRADE = idOf(SHOOTS.fields, 4);
const V_SORTED = idOf(SHOOTS.views, 0);
const V_UNSCHEDULED = idOf(SHOOTS.views, 1);
const R_ONE = idOf(SHOOTS.rows, 0);
const R_TWO = idOf(SHOOTS.rows, 1);
const R_THREE = idOf(SHOOTS.rows, 2);
const CLIENT_ROW = idOf(CLIENTS.rows, 0);
const CLIENT_IDS = CLIENTS.rows.map((row) => row.id);

function snapshotOf(document: DatabaseDocument, tableId: string): ActiveTableSnapshot {
	const snapshot = projectTable(document, tableId);
	if (snapshot === null) {
		throw new Error(`the fixture must have the table ${tableId}`);
	}
	return snapshot;
}

/** A small document built in the test, for the cases a fixture would make harder to read. */
function tinyText(): string {
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: 'db_' + 'z'.repeat(26),
		name: 'Tiny',
		tables: [
			{
				id: 'tbl_' + 'a'.repeat(26),
				name: 'Tasks',
				fields: [
					{ id: 'fld_' + 'a'.repeat(26), name: 'Title', type: 'text' },
					{ id: 'fld_' + 'b'.repeat(26), name: 'Stars', type: 'number' },
				],
				rows: [
					{
						id: 'row_' + 'a'.repeat(26),
						cells: { ['fld_' + 'a'.repeat(26)]: 'Third', ['fld_' + 'b'.repeat(26)]: 3 },
					},
					{
						id: 'row_' + 'b'.repeat(26),
						cells: { ['fld_' + 'a'.repeat(26)]: 'First', ['fld_' + 'b'.repeat(26)]: 1 },
					},
					{ id: 'row_' + 'c'.repeat(26), cells: { ['fld_' + 'a'.repeat(26)]: 'Second' } },
				],
				views: [
					{
						id: 'viw_' + 'a'.repeat(26),
						name: 'By stars',
						sorts: [{ fieldId: 'fld_' + 'b'.repeat(26), direction: 'asc' }],
					},
				],
			},
		],
	});
}

function tiny(): { readonly document: DatabaseDocument; readonly snapshot: ActiveTableSnapshot } {
	const loaded = parseDocument(tinyText());
	if (!loaded.ok) {
		throw new Error('the tiny document must load');
	}
	return {
		document: loaded.document,
		snapshot: snapshotOf(loaded.document, 'tbl_' + 'a'.repeat(26)),
	};
}

describe('a projection is derived, not copied', () => {
	it('hands back the document’s own table, rows and fields', () => {
		const document = fixture();
		const snapshot = snapshotOf(document, T_SHOOTS);
		expect(snapshot.table).toBe(document.tables[0]);
		expect(snapshot.rows[0]).toBe(document.tables[0]?.rows[0]);
		expect(snapshot.fields[0]).toBe(document.tables[0]?.fields[0]);
		expect(snapshot.fields).toBe(document.tables[0]?.fields);
	});

	it('resolves nothing for a table this document does not have', () => {
		expect(projectTable(fixture(), 'tbl_' + 'x'.repeat(26))).toBeNull();
	});

	it('indexes every field id, including a type this build does not read', () => {
		const text = fixtureText().replace('"type": "rating"', '"type": "colourSwatch"');
		const loaded = parseDocument(text);
		if (!loaded.ok) {
			throw new Error('the patched fixture must still load');
		}
		const snapshot = snapshotOf(loaded.document, T_SHOOTS);
		expect(snapshot.fieldById.get(F_GRADE)?.kind).toBe('unsupported');
		expect(fieldAt(snapshot, F_GRADE)?.kind).toBe('unsupported');
	});

	it('answers undefined for a row or a field of another table', () => {
		const document = fixture();
		const shoots = snapshotOf(document, T_SHOOTS);
		const clientRow = CLIENT_ROW;
		expect(rowAt(shoots, clientRow)).toBeUndefined();
		expect(fieldAt(shoots, 'fld_' + 'q'.repeat(26))).toBeUndefined();
		expect(viewAt(shoots, 'viw_' + 'z'.repeat(26))).toBeUndefined();
	});

	it('a view id from one table does not resolve in the other', () => {
		const document = fixture();
		expect(viewAt(snapshotOf(document, T_SHOOTS), V_SORTED)?.name).toBe('All');
		expect(viewAt(snapshotOf(document, T_CLIENTS), V_SORTED)).toBeUndefined();
	});
});

describe('a cell lookup separates “no value” from “no such row”', () => {
	it('reads a stored value', () => {
		expect(cellOf(snapshotOf(fixture(), T_SHOOTS), R_ONE, F_TITLE)).toBe('Rooftop, dawn');
	});

	it('reads a stored empty string as a value, not as absence', () => {
		// ADR-0004: `""` is a value (the falsy matrix is explicit about it).
		expect(cellOf(snapshotOf(fixture(), T_SHOOTS), R_TWO, F_TITLE)).toBe('');
	});

	it('answers undefined when the row or the field is not in this table', () => {
		const snapshot = snapshotOf(fixture(), T_SHOOTS);
		expect(cellOf(snapshot, 'row_' + 'x'.repeat(26), F_TITLE)).toBeUndefined();
		expect(cellOf(snapshot, R_ONE, 'fld_' + 'x'.repeat(26))).toBeUndefined();
	});
});

describe('a row number is derived from the manual order', () => {
	it('numbers rows from one, in document order', () => {
		const snapshot = snapshotOf(fixture(), T_SHOOTS);
		expect(rowNumber(snapshot, R_ONE)).toBe(1);
		expect(rowNumber(snapshot, R_TWO)).toBe(2);
		expect(rowNumber(snapshot, R_THREE)).toBe(3);
	});

	it('answers null for a row that is not here, rather than inventing a number', () => {
		expect(rowNumber(snapshotOf(fixture(), T_SHOOTS), 'row_' + 'x'.repeat(26))).toBeNull();
	});
});

describe('ordering canonical values', () => {
	it('sorts numbers numerically and text by code unit', () => {
		expect(compareCanonical(2, 10)).toBeLessThan(0);
		expect(compareCanonical('b', 'a')).toBeGreaterThan(0);
		expect(compareCanonical('a', 'a')).toBe(0);
	});

	it('sorts “no value” last, whichever spelling it has', () => {
		expect(compareCanonical(null, 'x')).toBeGreaterThan(0);
		expect(compareCanonical(undefined, 'x')).toBeGreaterThan(0);
		expect(compareCanonical([], 'x')).toBeGreaterThan(0);
		expect(compareCanonical(null, undefined)).toBe(0);
	});

	it('orders booleans false first and lists item by item', () => {
		expect(compareCanonical(false, true)).toBeLessThan(0);
		expect(compareCanonical(['a'], ['a', 'b'])).toBeLessThan(0);
		expect(compareCanonical(['a', 'c'], ['a', 'b'])).toBeGreaterThan(0);
	});

	it('orders a preserved invalid value by its printed form instead of throwing', () => {
		const broken = { invalid: true as const, raw: { why: 'no' }, reason: 'not a string' };
		expect(compareCanonical(broken, 'x')).not.toBe(0);
		expect(compareCanonical(broken, broken)).toBe(0);
		expect(
			compareCanonical(
				{ invalid: true as const, raw: 1, reason: 'a' },
				{ invalid: true as const, raw: 2, reason: 'b' },
			),
		).toBeLessThan(0);
	});

	it('orders two values of different shapes deterministically', () => {
		// A document that disagrees with its own field type still sorts the same way twice.
		expect(compareCanonical(1, 'a')).toBe(compareCanonical(1, 'a'));
		expect(compareCanonical(1, 'a')).not.toBe(0);
	});
});

describe('a saved view sorts without writing', () => {
	it('returns the manual order when there is no sort', () => {
		const snapshot = snapshotOf(fixture(), T_SHOOTS);
		expect(sortRowIds(snapshot, [])).toEqual([R_ONE, R_TWO, R_THREE]);
	});

	it('sorts by the view’s own sort, ascending and descending', () => {
		const { snapshot } = tiny();
		const ascending = sortRowIds(snapshot, [
			{ fieldId: 'fld_' + 'b'.repeat(26), direction: 'asc', unknown: [] },
		]);
		expect(ascending).toEqual([
			'row_' + 'b'.repeat(26),
			'row_' + 'a'.repeat(26),
			'row_' + 'c'.repeat(26),
		]);
		const descending = sortRowIds(snapshot, [
			{ fieldId: 'fld_' + 'b'.repeat(26), direction: 'desc', unknown: [] },
		]);
		// Descending is the mirror of ascending, which is what the legacy descriptors already do
		// (`compareNullableNumbers` sorts "no value" last and the pipeline negates the result for
		// `desc` — see `docs/02`, "keep the existing pure pipeline"). So "no value" sits at the far
		// end of the ordering in both directions: last going up, first going down.
		expect(descending).toEqual([
			'row_' + 'c'.repeat(26),
			'row_' + 'a'.repeat(26),
			'row_' + 'b'.repeat(26),
		]);
	});

	it('tie-breaks equal keys on the manual order, then on the row id', () => {
		const { snapshot } = tiny();
		const byTitleFirstLetter = sortRowIds(snapshot, [
			{ fieldId: 'fld_' + 'a'.repeat(26), direction: 'asc', unknown: [] },
		]);
		expect(byTitleFirstLetter).toEqual([
			'row_' + 'b'.repeat(26),
			'row_' + 'c'.repeat(26),
			'row_' + 'a'.repeat(26),
		]);

		// Two rows whose keys are equal both lack a value in the sorted field: the manual order decides.
		const empty = [
			{ id: 'row_' + 'd'.repeat(26), cells: {} },
			{ id: 'row_' + 'e'.repeat(26), cells: {} },
		];
		const text = JSON.stringify({
			format: 'tablify',
			version: 1,
			databaseId: 'db_' + 'z'.repeat(26),
			name: 'Empty keys',
			tables: [
				{
					id: 'tbl_' + 'a'.repeat(26),
					name: 'Tasks',
					fields: [{ id: 'fld_' + 'b'.repeat(26), name: 'When', type: 'date' }],
					rows: empty,
					views: [],
				},
			],
		});
		const loaded = parseDocument(text);
		if (!loaded.ok) {
			throw new Error('the empty-key document must load');
		}
		const flat = snapshotOf(loaded.document, 'tbl_' + 'a'.repeat(26));
		expect(
			sortRowIds(flat, [{ fieldId: 'fld_' + 'b'.repeat(26), direction: 'asc', unknown: [] }]),
		).toEqual(['row_' + 'd'.repeat(26), 'row_' + 'e'.repeat(26)]);
	});

	it('never mutates the document, and returns the same sequence twice', () => {
		const document = fixture();
		const snapshot = snapshotOf(document, T_SHOOTS);
		const before = JSON.stringify(document);
		const first = displayOrder(snapshot, V_SORTED);
		const second = displayOrder(snapshot, V_SORTED);
		expect(second).toEqual(first);
		expect(JSON.stringify(document)).toBe(before);
		expect(snapshot.rows.map((row) => row.id)).toEqual([R_ONE, R_TWO, R_THREE]);
	});

	it('falls back to the manual order for a view id it cannot resolve', () => {
		const document = fixture();
		expect(displayOrder(snapshotOf(document, T_SHOOTS), 'viw_' + 'q'.repeat(26))).toEqual([
			R_ONE,
			R_TWO,
			R_THREE,
		]);
		expect(displayOrder(snapshotOf(document, T_CLIENTS), null)).toEqual(CLIENT_IDS);
	});

	it('lets a caller inject the field type’s own comparison', () => {
		// The renderer may know that a `singleSelect` orders by its option list; the projection only
		// asks. This comparison puts "Third" first, which no canonical comparison would do.
		const { snapshot } = tiny();
		const reversed: typeof canonicalComparison = (fieldId, a, b) => {
			void fieldId;
			return compareCanonical(b, a);
		};
		expect(
			sortRowIds(
				snapshot,
				[{ fieldId: 'fld_' + 'b'.repeat(26), direction: 'asc', unknown: [] }],
				reversed,
			),
		).toEqual(['row_' + 'c'.repeat(26), 'row_' + 'a'.repeat(26), 'row_' + 'b'.repeat(26)]);
	});
});

describe('view output is isolated to its own table', () => {
	it('sorts the sorted table and leaves the other table’s order alone', () => {
		const document = fixture();
		const shoots = snapshotOf(document, T_SHOOTS);
		const clients = snapshotOf(document, T_CLIENTS);
		const shootsOrder = displayOrder(shoots, V_SORTED);
		const clientsOrder = displayOrder(clients, V_SORTED);
		expect(shootsOrder).toHaveLength(3);
		expect(clientsOrder).toEqual(CLIENT_IDS);
		// The shoots view is not the clients table's view, and the clients table has no views at all.
		expect(clients.views).toEqual([]);
		expect(shoots.views.map((view) => view.id)).toEqual([V_SORTED, V_UNSCHEDULED]);
	});

	it('keeps two projections of one document independent', () => {
		const document = fixture();
		const first = snapshotOf(document, T_SHOOTS);
		const second = snapshotOf(document, T_SHOOTS);
		expect(second.tableId).toBe(first.tableId);
		expect(second.rowById).not.toBe(first.rowById);
		expect(second.rowById.get(R_ONE)).toBe(first.rowById.get(R_ONE));
	});
});

describe('references are ids, and the module says so', () => {
	it('builds and compares a cell reference', () => {
		const one: CellRef = cellRef('tbl_a', 'row_a', 'fld_a');
		expect(sameCell(one, cellRef('tbl_a', 'row_a', 'fld_a'))).toBe(true);
		expect(sameCell(one, cellRef('tbl_a', 'row_a', 'fld_b'))).toBe(false);
		expect(sameCell(one, cellRef('tbl_b', 'row_a', 'fld_a'))).toBe(false);
		expect(cellKey(one)).toBe('tbl_a/row_a/fld_a');
	});
});
