/**
 * The export serialisers: **one TSV writer, two modes, and a typed cell per field type.**
 *
 * Three claims, and the third is the one a product gets wrong quietly:
 *
 *  1. **The TSV an export writes is the TSV a copy writes.** The hostile matrix from
 *     `tests/unit/clipboard-roundtrip.test.ts` — a tab, a newline, a formula, a quote, `007`, astral Unicode, an
 *     empty cell in the middle and one at the end — goes through `toTsv` here and is compared with the same
 *     string literal that file asserts, so a divergence between "copy" and "export" is a red test rather than two
 *     products with one name.
 *  2. **`display` and `raw` differ, and each is right.** One table of seven columns (currency, date, percent,
 *     checkbox, multiSelect, number, text) is exported twice; the table below is the assertion, type by type,
 *     with the strings spelled out.
 *  3. **A typed cell is typed, and a string that is not a number stays a string.** `xlsxCell` is asserted per
 *     field type, including the two honest failures: `€1,200.00` (a *displayed* currency) and `n/a` in a number
 *     column are both text cells, because turning either into `1200` would be inventing data.
 */
import { describe, expect, it } from 'vitest';

import {
	cellText,
	countExport,
	toHtml,
	toMatrix,
	toTsv,
	toXlsxData,
	xlsxCell,
	xlsxCellKind,
} from '../../src/core/export/serialize';
import type { ExportTable } from '../../src/core/export/serialize';
import { toHtml as coreToHtml, toTsv as coreToTsv } from '../../src/core/selection/clipboard';
import { runExport } from '../../src/plugin/export/runExport';
import { resolveField } from '../../src/core/schema/propertySchema';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import type { CellValue, FieldTypeId } from '../../src/core/types';
import type { Matrix } from '../../src/core/selection/clipboard';

/** The hostile block from the clipboard's own round-trip fixture. Byte-for-byte the same input. */
const HOSTILE: Matrix = [
	['plain', 'a\tb', 'line 1\nline 2'],
	['=SUM(A1:A2)', '"quoted"', '007'],
	['🎉 party', '', 'after the hole'],
	['trailing', 'cells', ''],
];

const CONTEXT = {
	path: 'Rows/Row 1.md',
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
};

/** A resolved field for one column, built exactly as the grid builds them. */
function field(
	name: string,
	type: FieldTypeId,
	options: Record<string, unknown> = {},
): ResolvedField {
	return resolveField(
		{ id: `note.${name}`, name, source: 'note', fieldOptions: { type, ...options } },
		{ ...CONTEXT, columnName: name, fieldOptions: { type, ...options } },
	);
}

/** The seven-column table every mode assertion uses. Values are canonical, not text. */
const COLUMNS: readonly {
	readonly name: string;
	readonly type: FieldTypeId;
	readonly options?: Record<string, unknown>;
}[] = [
	{ name: 'Title', type: 'text' },
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
	{ name: 'Weight', type: 'number' },
];

const VALUES: readonly CellValue[] = [
	'A shipment',
	1200,
	'2026-03-01',
	25,
	true,
	['Alpha', 'Beta'],
	12.5,
];

function sample(): ExportTable {
	return {
		fields: COLUMNS.map((column) => field(column.name, column.type, column.options ?? {})),
		rows: [VALUES, [null, null, null, null, null, null, null]],
	};
}

describe('the TSV an export writes is the TSV a copy writes', () => {
	it('round-trips the hostile matrix unchanged', () => {
		// Byte for byte what `clipboard-roundtrip.test.ts` asserts of the same matrix: the tab and the newline
		// cells are quoted (they *are* the format's structure), `007` is not, and the two empty cells survive.
		expect(toTsv(HOSTILE)).toBe(
			[
				'plain\t"a\tb"\t"line 1\nline 2"',
				'"=SUM(A1:A2)"\t"""quoted"""\t007',
				'🎉 party\t\tafter the hole',
				'trailing\tcells\t',
			].join('\n'),
		);
	});

	it('keeps the four cells that would otherwise change the block’s shape quoted', () => {
		const text = toTsv(HOSTILE);
		expect(text).toContain('"a\tb"');
		expect(text).toContain('"line 1\nline 2"');
		expect(text).toContain('"""quoted"""');
		expect(text).toContain('"=SUM(A1:A2)"');
		expect(text).toContain('\t007');
	});

	it('is the clipboard module’s own writer, not a second one', () => {
		// Identity, not equality: `src/core/export/serialize.ts` re-exports the clipboard's writers instead of
		// implementing them, so this assertion fails the moment somebody adds a second escaping rule.
		expect(toTsv).toBe(coreToTsv);
		expect(toHtml).toBe(coreToHtml);
	});
});

describe('display and raw, type by type', () => {
	const cases: readonly {
		readonly type: FieldTypeId;
		readonly value: CellValue;
		readonly display: string;
		readonly raw: string;
		readonly options?: Record<string, unknown>;
	}[] = [
		{ type: 'text', value: 'A shipment', display: 'A shipment', raw: 'A shipment' },
		{
			type: 'currency',
			value: 1200,
			display: '€1,200.00',
			raw: '1200',
			options: { symbol: '€' },
		},
		{ type: 'date', value: '2026-03-01', display: '1 Mar 2026', raw: '2026-03-01' },
		{ type: 'percent', value: 25, display: '25%', raw: '25' },
		{ type: 'checkbox', value: true, display: 'Yes', raw: 'true' },
		{
			type: 'multiSelect',
			value: ['Alpha', 'Beta'],
			display: 'Alpha, Beta',
			raw: 'Alpha, Beta',
		},
		{ type: 'number', value: 12.5, display: '12.5', raw: '12.5' },
	];

	for (const testCase of cases) {
		it(`${testCase.type}: displayed “${testCase.display}”, raw “${testCase.raw}”`, () => {
			const resolved = field('Column', testCase.type, testCase.options ?? {});
			expect(cellText(testCase.value, resolved, 'display')).toBe(testCase.display);
			expect(cellText(testCase.value, resolved, 'raw')).toBe(testCase.raw);
		});
	}

	it('differs for the four types the step names, in one table', () => {
		const table: ExportTable = {
			fields: cases.map((testCase, index) =>
				field(`Column ${String(index)}`, testCase.type, testCase.options ?? {}),
			),
			rows: [cases.map((testCase) => testCase.value)],
		};
		expect(toMatrix(table, { mode: 'display' })[1]).toEqual(
			cases.map((testCase) => testCase.display),
		);
		expect(toMatrix(table, { mode: 'raw' })[1]).toEqual(cases.map((testCase) => testCase.raw));
	});

	it('writes the header as the column’s name in both modes', () => {
		const table = sample();
		expect(toMatrix(table, { mode: 'display' })[0]).toEqual(
			COLUMNS.map((column) => column.name),
		);
		expect(toMatrix(table, { mode: 'raw' })[0]).toEqual(COLUMNS.map((column) => column.name));
	});

	it('an absent value is an empty cell in both modes, never “null”', () => {
		const table = sample();
		expect(toMatrix(table, { mode: 'display' })[2]).toEqual(['', '', '', '', '', '', '']);
		expect(toMatrix(table, { mode: 'raw' })[2]).toEqual(['', '', '', '', '', '', '']);
	});
});

describe('the typed cells an XLSX carries', () => {
	const cells: readonly {
		readonly type: FieldTypeId;
		readonly text: string;
		readonly kind: string;
		readonly value?: unknown;
		readonly format?: string;
	}[] = [
		{ type: 'text', text: 'A shipment', kind: 'String', value: 'A shipment' },
		{ type: 'number', text: '12.5', kind: 'Number', value: 12.5 },
		{ type: 'number', text: 'n/a', kind: 'String', value: 'n/a' },
		{ type: 'currency', text: '1200', kind: 'Number', value: 1200, format: '#,##0.00' },
		{ type: 'currency', text: '€1,200.00', kind: 'String', value: '€1,200.00' },
		{ type: 'percent', text: '25', kind: 'Number', value: 25, format: '0"%"' },
		{ type: 'duration', text: '3600', kind: 'Number', value: 3600, format: '[h]:mm:ss' },
		{ type: 'rating', text: '4', kind: 'Number', value: 4, format: '0' },
		{ type: 'checkbox', text: 'true', kind: 'Boolean', value: true },
		{ type: 'checkbox', text: 'false', kind: 'Boolean', value: false },
		{ type: 'checkbox', text: '', kind: 'empty' },
		{ type: 'multiSelect', text: 'Alpha, Beta', kind: 'String', value: 'Alpha, Beta' },
	];

	for (const testCase of cells) {
		it(`${testCase.type} “${testCase.text}” → ${testCase.kind}`, () => {
			const cell = xlsxCell(testCase.text, testCase.type);
			expect(xlsxCellKind(cell)).toBe(testCase.kind);
			if (testCase.value !== undefined) {
				expect(cell).toMatchObject({ value: testCase.value });
			}
			if (testCase.format !== undefined) {
				expect(cell).toMatchObject({ format: testCase.format });
			}
		});
	}

	it('a date becomes an instant at UTC midnight with a date format', () => {
		const cell = xlsxCell('2026-03-01', 'date');
		expect(xlsxCellKind(cell)).toBe('Date');
		// The instant, by identity, and the format beside it — one `toMatchObject`, because the union's members
		// do not all carry a `format` and a property read on the union would not type-check.
		expect(cell).toMatchObject({
			value: new Date('2026-03-01T00:00:00.000Z'),
			format: 'yyyy-mm-dd',
		});
	});

	it('a datetime keeps its own instant', () => {
		expect(xlsxCell('2026-03-01T09:30:00Z', 'datetime')).toMatchObject({
			value: new Date('2026-03-01T09:30:00.000Z'),
			format: 'yyyy-mm-dd hh:mm',
		});
	});

	it('the sheet is the header as strings and every other cell typed by its column', () => {
		const table = sample();
		const rows = toXlsxData(
			toMatrix(table, { mode: 'raw' }),
			COLUMNS.map((column) => ({
				name: column.name,
				type: column.type,
			})),
		);
		expect(rows[0]?.map(xlsxCellKind)).toEqual([
			'String',
			'String',
			'String',
			'String',
			'String',
			'String',
			'String',
		]);
		expect(rows[1]?.map(xlsxCellKind)).toEqual([
			'String',
			'Number',
			'Date',
			'Number',
			'Boolean',
			'String',
			'Number',
		]);
		// A row with no values is a row of empty cells, so the sheet's shape is the selection's shape.
		expect(rows[2]?.map(xlsxCellKind)).toEqual([
			'empty',
			'empty',
			'empty',
			'empty',
			'empty',
			'empty',
			'empty',
		]);
	});

	it('the same table in display mode keeps the display strings that are not numbers as text', () => {
		const table = sample();
		const rows = toXlsxData(
			toMatrix(table, { mode: 'display' }),
			COLUMNS.map((column) => ({
				name: column.name,
				type: column.type,
			})),
		);
		expect(rows[1]?.map(xlsxCellKind)).toEqual([
			'String',
			// `€1,200.00` displayed: a number cell would mean rewriting the value, so it stays text.
			'String',
			'Date',
			// `25%` — the same: the cell text carries the sign, so it is text rather than 25.
			'String',
			// `Yes` is not `true`; the boolean cell is the raw mode's, and displayed stays honest too.
			'String',
			'String',
			'Number',
		]);
	});
});

describe('the counts', () => {
	it('counts rows, columns and cells from the table itself', () => {
		expect(countExport(sample())).toEqual({ rows: 2, columns: 7, cells: 14 });
		expect(countExport({ fields: [], rows: [] })).toEqual({ rows: 0, columns: 0, cells: 0 });
	});
});

describe('the runner', () => {
	/** A vault in memory, and a clipboard that records what it was handed. */
	function ports(overrides: { readonly writeFails?: boolean } = {}) {
		const files = new Map<string, unknown>();
		const folders = new Set<string>();
		const clipboard: { tsv: string; html: string }[] = [];
		const messages: string[] = [];
		return {
			files,
			folders,
			clipboard,
			messages,
			ports: {
				clipboard: {
					write: async (payload: { tsv: string; html: string }) => {
						clipboard.push(payload);
						return 'clipboard-api' as const;
					},
				},
				vault: {
					exists: (path: string) => files.has(path) || folders.has(path),
					createFolder: async (path: string) => {
						folders.add(path);
					},
					create: async (path: string, file: string | ArrayBuffer) => {
						files.set(path, file);
					},
				},
				now: () => new Date(2026, 9, 6, 14, 32),
				announce: (message: string) => {
					messages.push(message);
				},
				...(overrides.writeFails === true
					? {
							writeXlsx: async () => {
								throw new Error('the zipper gave up');
							},
						}
					: {}),
			},
		};
	}

	const view = (): ExportTable => ({
		fields: [field('Title', 'text'), field('Weight', 'number')],
		rows: [
			['A shipment', 12.5],
			['Another', 3],
		],
	});

	it('writes both clipboard flavours and says how many cells left', async () => {
		const harness = ports();
		const summary = await runExport(
			{ scope: 'view', format: 'tsv', destination: 'clipboard', mode: 'raw' },
			view(),
			harness.ports,
		);
		expect(summary.ok).toBe(true);
		expect(summary.clipboardPath).toBe('clipboard-api');
		expect(summary.message).toBe('Exported 2 × 2 to the clipboard.');
		expect(harness.clipboard).toHaveLength(1);
		expect(harness.clipboard[0]?.tsv).toBe('Title\tWeight\nA shipment\t12.5\nAnother\t3');
		expect(harness.clipboard[0]?.html).toContain('<table>');
		expect(harness.files.size).toBe(0);
	});

	it('refuses XLSX to the clipboard before writing anything', async () => {
		const harness = ports();
		const summary = await runExport(
			{ scope: 'view', format: 'xlsx', destination: 'clipboard', mode: 'raw' },
			view(),
			harness.ports,
		);
		expect(summary.ok).toBe(false);
		expect(summary.message).toBe(
			'An .xlsx is a file, not text — choose File, or export TSV to the clipboard.',
		);
		expect(harness.clipboard).toHaveLength(0);
	});

	it('refuses an empty selection rather than exporting the whole view', async () => {
		const harness = ports();
		const summary = await runExport(
			{ scope: 'selection', format: 'tsv', destination: 'file', mode: 'display' },
			{ fields: [], rows: [] },
			harness.ports,
		);
		expect(summary.ok).toBe(false);
		expect(summary.message).toBe('Nothing to export yet.');
		expect(harness.files.size).toBe(0);
		expect(harness.messages).toHaveLength(0);
	});

	it('writes a TSV file into the documented folder, named with the moment', async () => {
		const harness = ports();
		const summary = await runExport(
			{ scope: 'view', format: 'tsv', destination: 'file', mode: 'raw' },
			view(),
			harness.ports,
		);
		expect(summary.path).toBe('Tablify exports/Tablify export 2026-10-06 1432.tsv');
		expect(harness.folders.has('Tablify exports')).toBe(true);
		expect(harness.files.get('Tablify exports/Tablify export 2026-10-06 1432.tsv')).toBe(
			'Title\tWeight\nA shipment\t12.5\nAnother\t3',
		);
		expect(summary.message).toBe(
			'Exported 2 × 2 to “Tablify exports/Tablify export 2026-10-06 1432.tsv”.',
		);
	});

	it('never overwrites: a second export at the same moment gets “ 2”', async () => {
		const harness = ports();
		const request = {
			scope: 'view',
			format: 'tsv',
			destination: 'file',
			mode: 'display',
		} as const;
		const first = await runExport(request, view(), harness.ports);
		const second = await runExport(request, view(), harness.ports);
		expect(first.path).toBe('Tablify exports/Tablify export 2026-10-06 1432.tsv');
		expect(second.path).toBe('Tablify exports/Tablify export 2026-10-06 1432 2.tsv');
		expect(harness.files.size).toBe(2);
	});

	it('hands the workbook writer typed rows and writes the bytes it answers with', async () => {
		const harness = ports();
		const seen: { rows: number; columns: number; name: string }[] = [];
		const summary = await runExport(
			{ scope: 'view', format: 'xlsx', destination: 'file', mode: 'raw' },
			view(),
			{
				...harness.ports,
				writeXlsx: async (rows, name) => {
					seen.push({ rows: rows.length, columns: rows[0]?.length ?? 0, name });
					return { bytes: new ArrayBuffer(64), name, writer: 'fake 0.0.0' };
				},
			},
		);
		expect(summary.ok).toBe(true);
		expect(summary.bytes).toBe(64);
		expect(seen).toEqual([
			{ rows: 3, columns: 2, name: 'Tablify export 2026-10-06 1432.xlsx' },
		]);
		expect(
			harness.files.get('Tablify exports/Tablify export 2026-10-06 1432.xlsx'),
		).toBeInstanceOf(ArrayBuffer);
	});

	it('reports a writer that fails, and writes no file', async () => {
		const harness = ports({ writeFails: true });
		const summary = await runExport(
			{ scope: 'view', format: 'xlsx', destination: 'file', mode: 'raw' },
			view(),
			harness.ports,
		);
		expect(summary.ok).toBe(false);
		expect(summary.message).toBe('The spreadsheet writer failed: the zipper gave up');
		expect(harness.files.size).toBe(0);
		expect(harness.messages).toEqual(['The spreadsheet writer failed: the zipper gave up']);
	});
});
