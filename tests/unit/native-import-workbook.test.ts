import { describe, expect, it } from 'vitest';

import writeXlsxFile from 'write-excel-file/browser';

import { readWorkbook } from '../../src/plugin/nativeImport/workbookReader';
import { initialDraft, previewOf } from '../../src/plugin/nativeImport/model';
import type { ImportDraft } from '../../src/plugin/nativeImport/model';

/** A real two-sheet workbook, written by the same library the export uses. */
async function workbookBytes(): Promise<ArrayBuffer> {
	const blob = await writeXlsxFile([
		{
			sheet: 'People',
			data: [
				[{ value: 'Name' }, { value: 'Qty' }],
				[{ value: 'Ada' }, { value: 2 }],
				[{ value: 'Grace' }, { value: 3 }],
			],
		},
		{
			sheet: 'Stock',
			data: [[{ value: 'Item' }], [{ value: 'Lamp' }]],
		},
	]).toBlob();
	return blob.arrayBuffer();
}

function draftWith(overrides: Partial<ImportDraft>): ImportDraft {
	return { ...initialDraft({ sourceName: 'book.xlsx', activeTableId: null }), ...overrides };
}

describe('native import workbook reader', () => {
	it('reads every worksheet, in the workbook order, as text', async () => {
		const read = await readWorkbook(await workbookBytes());
		expect(read.ok).toBe(true);
		if (!read.ok) {
			throw new Error('the workbook must read');
		}
		expect(read.sheets.map((sheet) => sheet.name)).toEqual(['People', 'Stock']);
		expect(read.sheets[0]?.matrix).toEqual([
			['Name', 'Qty'],
			['Ada', '2'],
			['Grace', '3'],
		]);
	});

	it('refuses a file that is not a workbook with a sentence, not an exception', async () => {
		const read = await readWorkbook(new TextEncoder().encode('Name\tQty\n').buffer);
		expect(read.ok).toBe(false);
		if (read.ok) {
			throw new Error('a text file is not a workbook');
		}
		expect(read.reason).toContain('not a readable Excel workbook');
	});

	it('previews the worksheet that was chosen, not the first one', async () => {
		const read = await readWorkbook(await workbookBytes());
		if (!read.ok) {
			throw new Error('the workbook must read');
		}
		const stock = previewOf(
			draftWith({ sheets: read.sheets, sheetName: 'Stock', hasHeader: true }),
		);
		expect(stock.ok).toBe(true);
		if (!stock.ok) {
			throw new Error('the Stock sheet must preview');
		}
		expect(stock.columns.map((column) => column.name)).toEqual(['Item']);
		expect(stock.rowCount).toBe(1);

		const people = previewOf(
			draftWith({ sheets: read.sheets, sheetName: 'People', hasHeader: true }),
		);
		if (!people.ok) {
			throw new Error('the People sheet must preview');
		}
		expect(people.columns.map((column) => column.name)).toEqual(['Name', 'Qty']);
	});

	it('keeps the pasted text as the source when no worksheet is chosen', () => {
		const preview = previewOf(draftWith({ text: 'Name\tQty\nAda\t2\n' }));
		expect(preview.ok).toBe(true);
		if (!preview.ok) {
			throw new Error('the text source must preview');
		}
		expect(preview.columns.map((column) => column.name)).toEqual(['Name', 'Qty']);
	});
});
