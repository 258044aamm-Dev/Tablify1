/**
 * The real-file check: **the shipped writer produces a file, and a second library reads the types back.**
 *
 * `docs/07` §acceptance asks for the export to be *"reproduced by eye in Excel"*, and no test can do that — a test
 * cannot open a spreadsheet. What it can do is the next best thing, and it is stronger than a screenshot in one
 * respect: the file is real (a zip on disk, written by the **shipped** `writeXlsxSheet`, whose dynamic import of
 * `write-excel-file/browser` is the same code path the plugin runs), and it is read back by a *different* library
 * (`read-excel-file`), so a mistake in our typing cannot be self-consistent.
 *
 * What that proves and what it does not, stated plainly:
 *
 *   · **Proves**: a `number` comes back as a JS number, a `date` as a `Date` at UTC midnight, a `checkbox` as a
 *     boolean, a `multiSelect` as its label list, and empty cells as `null` — i.e. Excel's own cell types, which
 *     is what "so a spreadsheet can sum and sort them" depends on.
 *   · **Does not prove**: how it *looks*. The number formats (`#,##0.00`, `yyyy-mm-dd`, `0"%"`) are in
 *     `xl/styles.xml` — the step's report quotes `unzip` output for them — but whether Excel renders `25 %` with
 *     the space a person expects is a human's eye, and this file says so instead of pretending.
 *
 * The temp file is written to the OS temp directory and removed afterwards; nothing here touches a vault, the
 * network, or the repository.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import readXlsxFile from 'read-excel-file/node';

import { toMatrix, toXlsxData } from '../../src/core/export/serialize';
import type { ExportTable } from '../../src/core/export/serialize';
import { writeXlsxSheet } from '../../src/plugin/export/xlsx';
import { resolveField } from '../../src/core/schema/propertySchema';
import type { CellValue, FieldTypeId } from '../../src/core/types';

const CONTEXT = {
	path: 'Rows/Row 1.md',
	now: () => Date.UTC(2026, 9, 6),
	timezone: 'UTC',
	locale: 'en-GB',
};

function field(name: string, type: FieldTypeId, options: Record<string, unknown> = {}) {
	return resolveField(
		{ id: `note.${name}`, name, source: 'note', fieldOptions: { type, ...options } },
		{ ...CONTEXT, fieldOptions: { type, ...options }, columnName: name },
	);
}

/** One column per cell type the writer claims to handle, plus a text column for the note's own words. */
const COLUMNS: readonly {
	readonly name: string;
	readonly type: FieldTypeId;
	readonly options?: Record<string, unknown>;
}[] = [
	{ name: 'Task', type: 'text' },
	{ name: 'Cost', type: 'currency', options: { symbol: '€' } },
	{ name: 'Due', type: 'date' },
	{ name: 'Share', type: 'percent' },
	{ name: 'Done', type: 'checkbox' },
	{
		name: 'Tags',
		type: 'multiSelect',
		options: {
			options: [
				{ id: 'a', name: 'Alpha' },
				{ id: 'b', name: 'Beta' },
			],
		},
	},
];

const ROWS: readonly (readonly CellValue[])[] = [
	['Ship the export', 1200, '2026-03-01', 25, true, ['Alpha', 'Beta']],
	['Another row', 980.5, '2026-03-04', 12.5, false, ['Beta']],
	['Nothing filled in', null, null, null, null, null],
];

const directory = mkdtempSync(join(tmpdir(), 'tablify-export-'));

afterAll(() => {
	rmSync(directory, { recursive: true, force: true });
});

/** The table, serialised in raw mode — the mode an export writes when a person wants numbers to stay numbers. */
function sheetOf(mode: 'raw' | 'display' = 'raw'): ExportTable {
	return {
		fields: COLUMNS.map((column) => field(column.name, column.type, column.options ?? {})),
		rows: ROWS,
	};
}

describe('a real .xlsx, written and read back', () => {
	it('is a zip, and its typed cells arrive as their own JavaScript types', async () => {
		const table = sheetOf();
		const matrix = toMatrix(table, { mode: 'raw' });
		const sheet = toXlsxData(
			matrix,
			COLUMNS.map((column) => ({ name: column.name, type: column.type })),
		);
		const result = await writeXlsxSheet(sheet, 'Tablify export 2026-10-06 1432.xlsx');
		const path = join(directory, 'export.xlsx');
		// A `Uint8Array` view over the writer's `ArrayBuffer`: no `Buffer`, which is not a global in this file's
		// lint environment and would be a warning on every run.
		writeFileSync(path, new Uint8Array(result.bytes));

		// A real archive: `PK\x03\x04` is the local-file-header signature of every zip, and an .xlsx is a zip.
		const bytes = readFileSync(path);
		expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
		expect(result.writer).toContain('write-excel-file 4.1.1');
		expect(result.name).toBe('Tablify export 2026-10-06 1432.xlsx');

		const sheets = await readXlsxFile(path);
		const rows = sheets[0]?.data ?? [];
		expect(rows).toHaveLength(ROWS.length + 1);
		expect(rows[0]).toEqual(['Task', 'Cost', 'Due', 'Share', 'Done', 'Tags']);

		const [, cost, due, share, done, tags] = rows[1] ?? [];
		expect(cost).toBe(1200);
		expect(typeof cost).toBe('number');
		expect(due).toBeInstanceOf(Date);
		expect(due instanceof Date ? due.toISOString() : null).toBe('2026-03-01T00:00:00.000Z');
		expect(share).toBe(25);
		expect(done).toBe(true);
		expect(tags).toBe('Alpha, Beta');

		// The second row proves the decimal and the `false` survive, not just the round numbers.
		const [, cost2, , share2, done2] = rows[2] ?? [];
		expect(cost2).toBe(980.5);
		expect(share2).toBe(12.5);
		expect(done2).toBe(false);

		// A row that holds one value and five empty cells keeps its shape: the *cells* are `null`, not `''`, and
		// the row is not shortened — which is what stops a half-filled row from shifting its columns left.
		expect(rows[3]).toEqual(['Nothing filled in', null, null, null, null, null]);
	});

	it('keeps a displayed currency as text, because rewriting it would be inventing a value', async () => {
		const table = sheetOf('display');
		const matrix = toMatrix(table, { mode: 'display' });
		const sheet = toXlsxData(
			matrix,
			COLUMNS.map((column) => ({ name: column.name, type: column.type })),
		);
		const result = await writeXlsxSheet(sheet, 'display.xlsx');
		const path = join(directory, 'display.xlsx');
		// A `Uint8Array` view over the writer's `ArrayBuffer`: no `Buffer`, which is not a global in this file's
		// lint environment and would be a warning on every run.
		writeFileSync(path, new Uint8Array(result.bytes));

		const rows = (await readXlsxFile(path))[0]?.data ?? [];
		expect(rows[1]?.[1]).toBe('€1,200.00');
		expect(rows[1]?.[2]).toBeInstanceOf(Date);
		// The date still types, because `formatDisplay`'s date is one the parser reads back.
		expect(rows[1]?.[5]).toBe('Alpha, Beta');
	});
});
