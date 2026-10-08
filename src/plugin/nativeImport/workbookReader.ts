/**
 * Reads an `.xlsx` workbook for the native import wizard (R5 Part A item 4). The one place `read-excel-file` is
 * touched, behind a dynamic import, so the reader is evaluated only when a workbook is opened (the same reason the
 * XLSX writer loads late; see `../export/xlsx.ts`).
 *
 * Every worksheet is read once, as text, at open time. A sheet choice then costs nothing and cannot re-read the
 * file in a different state. A file the reader refuses gives a sentence, never an exception.
 */
import { workbookMatrix } from '../../core/import/workbook';
import type { WorkbookCell } from '../../core/import/workbook';
import type { WorksheetSource } from './model';

export type WorkbookReadResult =
	| { readonly ok: true; readonly sheets: readonly WorksheetSource[] }
	| { readonly ok: false; readonly reason: string };

/**
 * A cell as the reader gives it, narrowed by value. The library's declared type names the `Date` constructor for a
 * date cell, but the value is a `Date` instance, so each cell is checked at runtime rather than cast. Anything that
 * is none of the known shapes is blank.
 */
function cellOf(value: unknown): WorkbookCell {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		return value;
	}
	return value instanceof Date ? value : null;
}

/** Reads every worksheet of the workbook. Refusals are sentences the wizard can show. */
export async function readWorkbook(bytes: ArrayBuffer): Promise<WorkbookReadResult> {
	const module = await import('read-excel-file/browser');
	let sheets: readonly {
		readonly sheet: string;
		readonly data: readonly (readonly unknown[])[];
	}[];
	try {
		sheets = await module.default(bytes);
	} catch {
		return { ok: false, reason: 'This file is not a readable Excel workbook (.xlsx).' };
	}
	if (sheets.length === 0) {
		return { ok: false, reason: 'The workbook has no worksheets.' };
	}
	return {
		ok: true,
		sheets: sheets.map((sheet) => ({
			name: sheet.sheet,
			matrix: workbookMatrix(sheet.data.map((row) => row.map(cellOf))),
		})),
	};
}
