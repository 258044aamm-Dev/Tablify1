import { describe, expect, it } from 'vitest';

import { workbookCellText, workbookMatrix } from '../../src/core/import/workbook';

describe('workbook cell text', () => {
	it('writes each stored value as the text a spreadsheet shows, and blanks what is empty', () => {
		expect(workbookCellText(null)).toBe('');
		expect(workbookCellText(undefined)).toBe('');
		expect(workbookCellText('Ada, Countess')).toBe('Ada, Countess');
		expect(workbookCellText(2)).toBe('2');
		expect(workbookCellText(1.5)).toBe('1.5');
		expect(workbookCellText(Number.NaN)).toBe('');
		expect(workbookCellText(true)).toBe('TRUE');
		expect(workbookCellText(false)).toBe('FALSE');
	});

	it('keeps a calendar day as a day, and a time as a local date and time', () => {
		expect(workbookCellText(new Date(2026, 9, 8))).toBe('2026-10-08');
		expect(workbookCellText(new Date(2026, 9, 8, 14, 5, 9))).toBe('2026-10-08 14:05:09');
		expect(workbookCellText(new Date(Number.NaN))).toBe('');
	});

	it('pads short rows to the widest row, so every row has the same width', () => {
		expect(
			workbookMatrix([
				['Name', 'Qty', 'Done'],
				['Ada', 2],
				[null, 3, true],
			]),
		).toEqual([
			['Name', 'Qty', 'Done'],
			['Ada', '2', ''],
			['', '3', 'TRUE'],
		]);
	});

	it('answers an empty worksheet with no rows', () => {
		expect(workbookMatrix([])).toEqual([]);
	});
});
