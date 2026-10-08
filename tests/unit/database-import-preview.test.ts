/**
 * The native-table import's source-only preview. This exercises the new boundary without routing through the
 * legacy note plan: the same readers/inference, but no folders, note paths, or vault environment.
 */
import { describe, expect, it } from 'vitest';

import { previewDatabaseImport } from '../../src/core/database';
import type { DatabaseImportPreview } from '../../src/core/database';
import type { Matrix } from '../../src/core/selection/clipboard';
import type { FieldTypeId } from '../../src/core/types';

function requirePreview(result: ReturnType<typeof previewDatabaseImport>): DatabaseImportPreview {
	if (!result.ok) {
		throw new Error(result.reason);
	}
	return result;
}

describe('native database import source preview', () => {
	it('reuses the CSV reader, header handling, and type inference with exact dimensions', () => {
		const result = requirePreview(
			previewDatabaseImport(
				{
					kind: 'text',
					name: 'tasks.csv',
					text: 'Task,Due,Count\r\n"Fix, parser",2026-10-08,12\r\nShip,2026-10-09,18\r\n',
				},
				{ hasHeader: true },
			),
		);

		expect(result.flavour).toBe('csv');
		expect(result.sourceName).toBe('tasks.csv');
		expect(result.width).toBe(3);
		expect(result.rowCount).toBe(2);
		expect(result.matrix[1]).toEqual(['Fix, parser', '2026-10-08', '12']);
		expect(result.body).toEqual([
			['Fix, parser', '2026-10-08', '12'],
			['Ship', '2026-10-09', '18'],
		]);
		expect(result.columns.map((column) => [column.name, column.type])).toEqual([
			['Task', 'singleSelect'],
			['Due', 'date'],
			['Count', 'number'],
		]);
		expect(result.columns.every((column) => column.included)).toBe(true);
	});

	it('reuses TSV parsing and reports fallback column names when the first row is data', () => {
		const result = requirePreview(
			previewDatabaseImport(
				{
					kind: 'text',
					name: 'clipboard.tsv',
					text: '2026-10-08\t14\n2026-10-09\t18',
				},
				{ hasHeader: false },
			),
		);

		expect(result.flavour).toBe('tsv');
		expect(result.hasHeader).toBe(false);
		expect(result.rowCount).toBe(2);
		expect(result.columns.map((column) => [column.name, column.type])).toEqual([
			['Column 1', 'date'],
			['Column 2', 'number'],
		]);
		expect(result.body).toEqual([
			['2026-10-08', '14'],
			['2026-10-09', '18'],
		]);
	});

	it('keeps clipboard HTML table parsing on the same source-preview path', () => {
		const result = requirePreview(
			previewDatabaseImport(
				{
					kind: 'text',
					name: 'clipboard.html',
					text: '<table><tbody><tr><th>Title</th><th>Done</th></tr><tr><td>Review</td><td>true</td></tr></tbody></table>',
				},
				{ hasHeader: true },
			),
		);

		expect(result.flavour).toBe('html');
		expect(result.body).toEqual([['Review', 'true']]);
		expect(result.columns.map((column) => column.name)).toEqual(['Title', 'Done']);
		expect(result.columns.map((column) => column.type)).toEqual(['singleSelect', 'checkbox']);
	});

	it('applies per-column overrides and exclusions without replacing inference evidence or source cells', () => {
		const matrix: Matrix = [
			['Name', 'Amount', 'Status'],
			...Array.from({ length: 14 }, (_unused, index) => [
				`Row ${String(index + 1)}`,
				String(index + 1),
				'Open',
			]),
			['Last', 'n/a', 'Done'],
		];
		const overrides = new Map<number, FieldTypeId>([[1, 'number']]);
		const result = requirePreview(
			previewDatabaseImport(
				{ kind: 'matrix', matrix, name: 'sheet 1.xlsx' },
				{ hasHeader: true, overrides, excluded: new Set([2]) },
			),
		);

		expect(result.flavour).toBe('given');
		expect(result.columns[1]?.inference.type).toBe('text');
		expect(result.columns[1]?.type).toBe('number');
		expect(result.columns[1]?.inference.evidence).toEqual([
			{ row: 15, text: 'n/a', forced: 'blocks', blocksType: 'number' },
		]);
		expect(result.columns[2]?.type).toBe('singleSelect');
		expect(result.columns[2]?.included).toBe(false);
		expect(result.matrix).toEqual(matrix);
	});

	it('accepts an already-parsed worksheet matrix as an XLSX adapter seam', () => {
		const matrix: Matrix = [
			['Item', 'Ready'],
			['Notebook', 'true'],
		];
		const result = requirePreview(
			previewDatabaseImport(
				{ kind: 'matrix', matrix, name: 'inventory.xlsx · Inventory' },
				{ hasHeader: true },
			),
		);

		expect(result.flavour).toBe('given');
		expect(result.sourceName).toBe('inventory.xlsx · Inventory');
		expect(result.columns.map((column) => column.type)).toEqual(['singleSelect', 'checkbox']);
	});

	it('keeps empty-source errors at the source boundary', () => {
		const result = previewDatabaseImport(
			{ kind: 'text', text: ' \n ', name: 'empty.csv' },
			{ hasHeader: true },
		);

		expect(result).toEqual({
			ok: false,
			sourceName: 'empty.csv',
			reason: 'there is nothing to import',
		});
	});

	it('has no note-destination or vault-collision inputs in its successful preview contract', () => {
		const result = requirePreview(
			previewDatabaseImport(
				{ kind: 'matrix', matrix: [['Name'], ['Ada']], name: 'people.xlsx' },
				{ hasHeader: true },
			),
		);

		for (const noteOnly of [
			'folder',
			'template',
			'frontmatter',
			'notePaths',
			'vault',
			'environment',
		]) {
			expect(result).not.toHaveProperty(noteOnly);
		}
		expect(result).not.toHaveProperty('collisions');
		expect(result).not.toHaveProperty('notes');
		expect(result).not.toHaveProperty('plan');
	});
});
