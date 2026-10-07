/**
 * Rows — R1 step 5's first gate.
 *
 * What is being proven, in the order the file proves it:
 *
 *   1. **The document order of the rows array is the manual order** (amended ADR-0003): no second
 *      list of ids exists, so there is nothing to fall out of sync.
 *   2. **"No value" has one spelling.** An absent cell, an explicit `null`, and an empty list all
 *      read as absence and *do not survive into the model as null entries* — so the model cannot
 *      compare unequal to itself after a round trip.
 *   3. **Cells the reader cannot place are preserved, not deleted**: a value the field type refuses,
 *      a field id the table lacks, a cell for an unreadable field type.
 *   4. **Row timestamps are the row's own** and must carry their own offset.
 *
 * The generator at the end closes the loop for values that are all legal: parse → write → parse
 * lands on the same model, and writing again produces the same text.
 */
import { describe, expect, it } from 'vitest';

import { parseDocument, serializeDocument } from '../../src/core/database/index';
import type { JsonValue, LoadError, LoadWarning, TableRow } from '../../src/core/database/index';

const DATABASE_ID = 'db_' + 'z'.repeat(26);
const TABLE_ID = 'tbl_' + 'z'.repeat(26);
const F_TITLE = 'fld_' + 'a'.repeat(26);
const F_WHEN = 'fld_' + 'b'.repeat(26);
const F_GRADE = 'fld_' + 'c'.repeat(26);
const F_COVER = 'fld_' + 'd'.repeat(26);
const F_STATUS = 'fld_' + 'e'.repeat(26);
const F_CREATED = 'fld_' + 'f'.repeat(26);
const OPT_A = 'opt_' + 'a'.repeat(26);

function fieldsJson(): JsonValue {
	return [
		{ id: F_TITLE, name: 'Title', type: 'text' },
		{ id: F_WHEN, name: 'When', type: 'date' },
		{ id: F_GRADE, name: 'Grade', type: 'rating', max: 5 },
		{ id: F_COVER, name: 'Cover', type: 'attachment' },
		{ id: F_STATUS, name: 'Status', type: 'singleSelect', options: [{ id: OPT_A, name: 'A' }] },
		{ id: F_CREATED, name: 'Created', type: 'createdTime' },
	];
}

function documentText(rows: JsonValue): string {
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: DATABASE_ID,
		name: 'Test',
		tables: [{ id: TABLE_ID, name: 'Tasks', fields: fieldsJson(), rows, views: [] }],
	});
}

function rowsOf(rows: JsonValue): readonly TableRow[] {
	const result = parseDocument(documentText(rows));
	if (!result.ok) {
		throw new Error(
			`expected a load; got ${result.errors.map((error) => `${error.code} at ${error.path}`).join(', ')}`,
		);
	}
	return result.document.tables[0]?.rows ?? [];
}

function errorsOf(rows: JsonValue): readonly LoadError[] {
	const result = parseDocument(documentText(rows));
	if (result.ok) {
		throw new Error('the test expected a refusal, and the document parsed');
	}
	return result.errors;
}

function warningsOf(rows: JsonValue): readonly LoadWarning[] {
	const result = parseDocument(documentText(rows));
	if (!result.ok) {
		throw new Error('the test expected a load');
	}
	return result.warnings;
}

describe('empty values and one spelling of absence', () => {
	it('keeps empty strings, zeroes and empty lists out of the model as absence', () => {
		const [row] = rowsOf([
			{
				id: 'row_' + 'a'.repeat(26),
				cells: {
					[F_TITLE]: '',
					[F_GRADE]: 0,
					[F_COVER]: [],
				},
			},
		]);
		// '' and 0 are *values* (ADR-0004 §2); [] reads as no value (§matrix), so only the first two
		// are entries.
		expect(row?.cells.get(F_TITLE)).toBe('');
		expect(row?.cells.get(F_GRADE)).toBe(0);
		expect(row?.cells.has(F_COVER)).toBe(false);
	});

	it('reads an explicit null as absence, silently — no entry, no warning', () => {
		const rows = [{ id: 'row_' + 'a'.repeat(26), cells: { [F_WHEN]: null } }];
		const [row] = rowsOf(rows);
		expect(row?.cells.size).toBe(0);
		expect(warningsOf(rows)).toEqual([]);
	});

	it('omits no-value cells on write, so re-reading changes nothing', () => {
		const text = documentText([{ id: 'row_' + 'a'.repeat(26), cells: { [F_WHEN]: null } }]);
		const first = parseDocument(text);
		if (!first.ok) {
			throw new Error('expected a load');
		}
		const once = serializeDocument(first.document);
		expect(once).not.toContain('"cells"');
		const second = parseDocument(once);
		expect(second.ok).toBe(true);
		if (second.ok) {
			expect(second.document.tables[0]?.rows).toEqual(first.document.tables[0]?.rows);
		}
	});
});

describe('order and timestamps', () => {
	it('keeps the document order of the rows array as the manual order', () => {
		const ids = ['a', 'b', 'c'].map((letter) => 'row_' + letter.repeat(26));
		const rows = ids.map((id) => ({ id }));
		expect(rowsOf(rows).map((row) => row.id)).toEqual(ids);
	});

	it('keeps timestamps that carry their own offset and refuses ones that do not', () => {
		const [row] = rowsOf([
			{
				id: 'row_' + 'a'.repeat(26),
				createdAt: '2026-01-02T09:00:00Z',
				updatedAt: '2026-03-04T12:30:00+01:00',
			},
			{ id: 'row_' + 'b'.repeat(26) },
		]);
		expect(row?.createdAt).toBe('2026-01-02T09:00:00Z');
		expect(row?.updatedAt).toBe('2026-03-04T12:30:00+01:00');

		const errors = errorsOf([
			{ id: 'row_' + 'a'.repeat(26), createdAt: '2026-01-02T09:00:00' },
		]);
		expect(errors.map((error) => error.code)).toEqual(['invalid-row-timestamp']);
		expect(errors[0]?.path).toBe('$.tables[0].rows[0].createdAt');
	});
});

describe('row identity', () => {
	it('refuses a repeated row id, naming both positions', () => {
		const errors = errorsOf([{ id: 'row_' + 'a'.repeat(26) }, { id: 'row_' + 'a'.repeat(26) }]);
		expect(errors.map((error) => error.code)).toEqual(['duplicate-row-id']);
		expect(errors[0]?.message).toContain('rows[0] and rows[1]');
	});

	it('refuses a row id that is not shaped like one, and a row that is not an object', () => {
		expect(errorsOf([{ id: 'Tasks/1' }]).map((error) => error.code)).toEqual([
			'invalid-row-id',
		]);
		expect(errorsOf(['nope']).map((error) => error.code)).toEqual(['invalid-row']);
	});

	it('requires the rows list and refuses one that is not an array', () => {
		const text = JSON.stringify({
			format: 'tablify',
			version: 1,
			databaseId: DATABASE_ID,
			name: 'Test',
			tables: [{ id: TABLE_ID, name: 'Tasks', fields: fieldsJson(), views: [] }],
		});
		const result = parseDocument(text);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.map((error) => error.code)).toEqual(['missing-rows']);
		}
		expect(errorsOf({})).toEqual([
			expect.objectContaining({ code: 'invalid-rows', path: '$.tables[0].rows' }),
		]);
	});
});

describe('cells the reader cannot place are preserved', () => {
	it('keeps a value the field type refuses, with a reason, and writes it back verbatim', () => {
		const rows = [{ id: 'row_' + 'a'.repeat(26), cells: { [F_WHEN]: 'yesterday' } }];
		const [row] = rowsOf(rows);
		const cell = row?.cells.get(F_WHEN);
		expect(cell).toEqual({ invalid: true, raw: 'yesterday', reason: 'not a calendar date' });

		const warnings = warningsOf(rows);
		expect(warnings.map((warning) => warning.code)).toEqual(['invalid-cell-value']);
		expect(warnings[0]?.path).toBe(`$.tables[0].rows[0].cells.${F_WHEN}`);
		expect(warnings[0]?.message).toContain('When');

		const result = parseDocument(documentText(rows));
		if (!result.ok) {
			throw new Error('expected a load');
		}
		expect(serializeDocument(result.document)).toContain('"yesterday"');
	});

	it('keeps a cell whose field id the table does not have', () => {
		const ghost = 'fld_' + 'q'.repeat(26);
		const rows = [{ id: 'row_' + 'a'.repeat(26), cells: { [ghost]: { odd: [1, 2] } } }];
		const [row] = rowsOf(rows);
		expect(row?.cells.get(ghost)).toEqual({
			invalid: true,
			raw: { odd: [1, 2] },
			reason: 'no field in this table has this id',
		});
		const warnings = warningsOf(rows);
		expect(warnings.map((warning) => warning.code)).toEqual(['unknown-cell-field']);
		expect(warnings[0]?.path).toBe(`$.tables[0].rows[0].cells.${ghost}`);
	});

	it('keeps a stored value in a read-only time column, warned once per cell', () => {
		const rows = [
			{ id: 'row_' + 'a'.repeat(26), cells: { [F_CREATED]: '2025-01-01T00:00:00Z' } },
		];
		const [row] = rowsOf(rows);
		expect(row?.cells.get(F_CREATED)).toEqual({
			invalid: true,
			raw: '2025-01-01T00:00:00Z',
			reason: 'a read-only time column; its value comes from the file',
		});
		expect(warningsOf(rows).map((warning) => warning.code)).toEqual(['invalid-cell-value']);
	});

	it('keeps a cell for an unreadable field type without a second warning', () => {
		const text = JSON.stringify({
			format: 'tablify',
			version: 1,
			databaseId: DATABASE_ID,
			name: 'Test',
			tables: [
				{
					id: TABLE_ID,
					name: 'Tasks',
					fields: [{ id: F_TITLE, name: 'Summarized', type: 'aiSummary' }],
					rows: [{ id: 'row_' + 'a'.repeat(26), cells: { [F_TITLE]: { score: 0.5 } } }],
					views: [],
				},
			],
		});
		const result = parseDocument(text);
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		// One warning, from the field — not one per cell.
		expect(result.warnings.map((warning) => warning.code)).toEqual(['unsupported-field-type']);
		const cell = result.document.tables[0]?.rows[0]?.cells.get(F_TITLE);
		expect(cell).toEqual({
			invalid: true,
			raw: { score: 0.5 },
			reason: 'the field type this cell belongs to is not read by this build',
		});
	});
});

describe('cells are written in field order', () => {
	it('serializes cells by schema order, not by the order the file happened to list them', () => {
		const text = documentText([
			{
				id: 'row_' + 'a'.repeat(26),
				cells: {
					[F_GRADE]: 4,
					[F_WHEN]: '2026-02-14',
					[F_TITLE]: 'First',
				},
			},
		]);
		const result = parseDocument(text);
		if (!result.ok) {
			throw new Error('expected a load');
		}
		const once = serializeDocument(result.document);
		const rowStart = once.indexOf('"row_' + 'a'.repeat(20));
		const row = once.slice(rowStart);
		const indexes = [F_TITLE, F_WHEN, F_GRADE].map((fieldId) => row.indexOf(`"${fieldId}"`));
		expect(indexes.every((index) => index > -1)).toBe(true);
		expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
	});
});

describe('the generated round trip', () => {
	const DOCUMENTS = 60;
	const ROWS = 6;

	function mulberry32(seed: number): () => number {
		let state = seed >>> 0;
		return () => {
			state = (state + 0x6d2b79f5) >>> 0;
			let t = state;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	it(`parses, writes and re-parses ${DOCUMENTS} documents of ${ROWS} rows without drift`, () => {
		const roll = mulberry32(20260105);
		for (let index = 0; index < DOCUMENTS; index += 1) {
			const rows: JsonValue[] = [];
			for (let rowIndex = 0; rowIndex < ROWS; rowIndex += 1) {
				const cells: Record<string, JsonValue> = {};
				if (roll() < 0.8) {
					cells[F_TITLE] = `Title ${Math.floor(roll() * 1000)}`;
				}
				if (roll() < 0.6) {
					cells[F_WHEN] = '2026-02-14';
				}
				if (roll() < 0.6) {
					cells[F_GRADE] = Math.floor(roll() * 6);
				}
				if (roll() < 0.4) {
					cells[F_COVER] = [`dir with space/ü.${Math.floor(roll() * 9)}.png`];
				}
				if (roll() < 0.4) {
					cells[F_STATUS] = OPT_A;
				}
				const row: Record<string, JsonValue> = {
					id: `row_${rowIndex}${'a'.repeat(20)}${index}`,
					cells,
				};
				if (roll() < 0.4) {
					row['createdAt'] = '2026-01-02T09:00:00Z';
				}
				rows.push(row);
			}
			const first = parseDocument(documentText(rows));
			expect(first.ok).toBe(true);
			if (!first.ok) {
				return;
			}
			expect(first.warnings).toEqual([]);
			const once = serializeDocument(first.document);
			const second = parseDocument(once);
			expect(second.ok).toBe(true);
			if (!second.ok) {
				return;
			}
			expect(second.document).toEqual(first.document);
			expect(serializeDocument(second.document)).toBe(once);
		}
	});
});
