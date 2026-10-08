/**
 * Worksheet cells as text (R5 Part A item 4). Pure: no library, no vault, no host.
 *
 * The XLSX reader (`read-excel-file`, behind a dynamic import in the plugin) hands back typed cells. This module
 * turns each one into the text the rest of the import reads, so an imported worksheet goes through the same
 * inference and planner as a pasted table. Nothing here guesses: a number stays the number Excel stored, and a
 * date keeps its calendar day.
 *
 * Dates: the reader gives a `Date` for a date-formatted cell. It is read in the host's local time zone, so the text
 * uses local calendar fields. A midnight value is written as a day only. ASSUMED, not verified against a real
 * workbook in a real host.
 */
import type { Matrix } from '../selection/clipboard';

/** One worksheet cell as the reader returns it. */
export type WorkbookCell = string | number | boolean | Date | null;

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

/** The text of one cell. Blank for an empty or invalid cell; booleans as the spreadsheet's own TRUE/FALSE. */
export function workbookCellText(value: WorkbookCell | undefined): string {
	if (value === undefined || value === null) {
		return '';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'boolean') {
		return value ? 'TRUE' : 'FALSE';
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? String(value) : '';
	}
	if (Number.isNaN(value.getTime())) {
		return '';
	}
	const day = `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
	const midnight =
		value.getHours() === 0 &&
		value.getMinutes() === 0 &&
		value.getSeconds() === 0 &&
		value.getMilliseconds() === 0;
	return midnight
		? day
		: `${day} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

/** A worksheet as a matrix of text. Short rows are padded with blanks, so every row has the same width. */
export function workbookMatrix(data: readonly (readonly WorkbookCell[])[]): Matrix {
	const width = data.reduce((most, row) => Math.max(most, row.length), 0);
	return data.map((row) => {
		const text: string[] = [];
		for (let column = 0; column < width; column += 1) {
			text.push(workbookCellText(row[column]));
		}
		return text;
	});
}
