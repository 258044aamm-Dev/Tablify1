import { describe, expect, it } from 'vitest';

import { fromCsv, toCsv } from '../../src/core/export/csv';
import type { DatabaseDocument, DatabaseTable } from '../../src/core/database';
import { projectTable } from '../../src/core/database/projection';
import type { TableField } from '../../src/core/database/fields';
import type { CellState, TableRow } from '../../src/core/database/rows';
import { invalidCell } from '../../src/core/database/values';
import { nativeTableMatrix } from '../../src/core/database/export/nativeMatrix';

const ENV = {
	now: () => Date.parse('2026-10-08T10:20:30.000Z'),
	timezone: 'UTC',
	locale: 'en-GB',
};

const NAME: TableField = {
	kind: 'field',
	id: 'fld_name',
	name: 'Name',
	type: 'text',
	settings: {},
	unknown: [],
};
const DONE: TableField = {
	kind: 'field',
	id: 'fld_done',
	name: 'Done',
	type: 'checkbox',
	settings: {},
	unknown: [],
};
const LINK: TableField = {
	kind: 'field',
	id: 'fld_link',
	name: 'Refers',
	type: 'link',
	settings: {},
	unknown: [],
};
const FUTURE: TableField = {
	kind: 'unsupported',
	id: 'fld_future',
	name: 'Future',
	typeName: 'future',
	raw: {},
};
const STATUS: TableField = {
	kind: 'field',
	id: 'fld_status',
	name: 'Status',
	type: 'singleSelect',
	settings: { options: [{ id: 'opt_a', name: 'Alpha', color: null, unknown: [] }] },
	unknown: [],
};

function rowOf(id: string, cells: ReadonlyMap<string, CellState>): TableRow {
	return { id, cells, createdAt: null, updatedAt: null, unknown: [] };
}

function documentWith(fields: readonly TableField[], rows: readonly TableRow[]): DatabaseDocument {
	const table: DatabaseTable = {
		id: 'tbl_main',
		name: 'Main',
		fields,
		rows,
		views: [],
		unknown: [],
	};
	return {
		format: 'tablify',
		version: 1,
		databaseId: `db_${'e'.repeat(26)}`,
		name: 'Export test',
		tables: [table],
		unknown: [],
	};
}

function projectedTable(document: DatabaseDocument) {
	const snapshot = projectTable(document, 'tbl_main');
	if (snapshot === null) {
		throw new Error('the fixture table must project');
	}
	return snapshot;
}

describe('native table export matrix', () => {
	const document = documentWith(
		[NAME, DONE, LINK, FUTURE, STATUS],
		[
			rowOf(
				'row_one',
				new Map<string, CellState>([
					['fld_name', 'Ada, Countess'],
					['fld_done', true],
					['fld_status', 'opt_a'],
				]),
			),
			rowOf(
				'row_two',
				new Map<string, CellState>([
					['fld_name', '=SUM(A1:A9)'],
					['fld_done', false],
					['fld_status', 'opt_zz'],
				]),
			),
		],
	);

	it('exports supported fields in table order, and counts what it omits instead of hiding it', () => {
		const result = nativeTableMatrix(projectedTable(document), 'display', ENV);
		expect(result.exportedFields).toEqual(['Name', 'Done', 'Status']);
		expect(result.omittedLinks).toBe(1);
		expect(result.omittedUnsupported).toBe(1);
		expect(result.rowCount).toBe(2);
		expect(result.matrix[0]).toEqual(['Name', 'Done', 'Status']);
		expect(result.matrix).toHaveLength(3);
	});

	it('shows select options by name in display mode, and says so for an unknown option id', () => {
		const result = nativeTableMatrix(projectedTable(document), 'display', ENV);
		expect(result.matrix[1]?.[2]).toBe('Alpha');
		expect(result.matrix[2]?.[2]).toBe('Unknown option · opt_zz');
	});

	it('keeps formula-shaped text as text, and survives the CSV round trip exactly', () => {
		const result = nativeTableMatrix(projectedTable(document), 'raw', ENV);
		expect(result.matrix[2]?.[0]).toBe('=SUM(A1:A9)');
		expect(fromCsv(toCsv(result.matrix))).toEqual(result.matrix);
	});

	it('writes an invalid stored value visibly, in both modes, and never as a silent blank', () => {
		const withInvalid = documentWith(
			[NAME],
			[
				rowOf(
					'row_bad',
					new Map<string, CellState>([['fld_name', invalidCell({ x: 1 }, 'not text')]]),
				),
			],
		);
		for (const mode of ['display', 'raw'] as const) {
			const result = nativeTableMatrix(projectedTable(withInvalid), mode, ENV);
			expect(result.matrix[1]?.[0]).toBe('Invalid value · {"x":1}');
		}
	});

	it('exports no rows when no field is exportable, rather than a header over nothing', () => {
		const onlyLinks = documentWith([LINK, FUTURE], [rowOf('row_x', new Map())]);
		const result = nativeTableMatrix(projectedTable(onlyLinks), 'display', ENV);
		expect(result.matrix).toEqual([]);
		expect(result.omittedLinks + result.omittedUnsupported).toBe(2);
	});

	it('writes an empty cell as empty text, not a placeholder', () => {
		const sparse = documentWith([NAME], [rowOf('row_blank', new Map())]);
		const result = nativeTableMatrix(projectedTable(sparse), 'display', ENV);
		expect(result.matrix).toEqual([['Name'], ['']]);
	});
});
