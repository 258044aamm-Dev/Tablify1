/**
 * CSV text for a native table export (R5 Part B). Pure arithmetic over a matrix of text: no vault, no clock, no
 * library, so the whole writer is testable without a spreadsheet.
 *
 * Rules, each one a deliberate choice rather than an accident of the code:
 *
 *  1. **RFC 4180 quoting.** A cell containing a comma, a double quote, a carriage return or a line feed is wrapped
 *     in double quotes, and inner quotes are doubled. Nothing else is quoted for structure.
 *  2. **The formula rule is the clipboard's.** A cell whose first character is `=`, `+`, `-`, `@` or a tab is
 *     quoted too, the same rule `toTsv` applies (`src/core/selection/clipboard.ts`). This is the
 *     mitigation the text format allows, not a guarantee: a spreadsheet may still evaluate a quoted formula on
 *     open. The complementary guarantee lives in `fromCsv` below, which never evaluates anything.
 *  3. **Line endings are explicit.** RFC 4180 specifies CRLF, so that is the default. `lf` is offered for tools that
 *     expect Unix text. Every record, including the last, is terminated; an empty matrix is the empty string.
 *  4. **One empty cell is `""`.** Otherwise the text would be empty and look like nothing was exported, the same
 *     reason `toTsv` writes a quoted empty field.
 *
 * No byte-order mark is written. Whether a spreadsheet needs one to read non-ASCII text is ASSUMED and not
 * verified here; the caller can add it if a real-host check says so.
 */
import type { Matrix } from '../selection/clipboard';

export type CsvNewline = 'crlf' | 'lf';

export interface CsvOptions {
	readonly newline: CsvNewline;
}

export const DEFAULT_CSV_OPTIONS: CsvOptions = { newline: 'crlf' };

/** Characters that make a spreadsheet treat a cell as a formula rather than as text. */
const FORMULA_START = ['=', '+', '-', '@', '\t'];

/** Whether a cell must be quoted: structure, a formula-leading character, or an empty cell. */
function needsQuotes(cell: string): boolean {
	if (cell.includes(',') || cell.includes('"') || cell.includes('\r') || cell.includes('\n')) {
		return true;
	}
	if (cell === '') {
		return false;
	}
	return FORMULA_START.includes(cell.charAt(0));
}

function csvField(cell: string): string {
	if (!needsQuotes(cell)) {
		return cell;
	}
	return `"${cell.replace(/"/g, '""')}"`;
}

/** The matrix as CSV text, under the rules above. */
export function toCsv(cells: Matrix, options: CsvOptions = DEFAULT_CSV_OPTIONS): string {
	if (cells.length === 0) {
		return '';
	}
	const newline = options.newline === 'crlf' ? '\r\n' : '\n';
	// A matrix holding one empty cell would otherwise be empty text, which reads as "nothing exported".
	if (cells.length === 1 && cells[0]?.length === 1 && cells[0][0] === '') {
		return `""${newline}`;
	}
	return cells.map((row) => `${row.map(csvField).join(',')}${newline}`).join('');
}

/**
 * CSV text as a matrix. Accepts CRLF, LF and CR record endings, quoted fields with doubled quotes, and newlines
 * inside quoted fields. Each cell keeps its text verbatim: nothing is evaluated, trimmed, or typed. A single
 * trailing record terminator is not an extra empty record.
 */
export function fromCsv(text: string): Matrix {
	if (text === '') {
		return [];
	}
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	let index = 0;
	while (index < text.length) {
		const char = text.charAt(index);
		if (quoted) {
			if (char === '"') {
				if (text.charAt(index + 1) === '"') {
					cell += '"';
					index += 2;
					continue;
				}
				quoted = false;
				index += 1;
				continue;
			}
			cell += char;
			index += 1;
			continue;
		}
		if (char === '"' && cell === '') {
			quoted = true;
			index += 1;
			continue;
		}
		if (char === ',') {
			row.push(cell);
			cell = '';
			index += 1;
			continue;
		}
		if (char === '\r' || char === '\n') {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
			index += char === '\r' && text.charAt(index + 1) === '\n' ? 2 : 1;
			continue;
		}
		cell += char;
		index += 1;
	}
	// Text that does not end with a record terminator still has a last record to keep.
	if (cell !== '' || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}
