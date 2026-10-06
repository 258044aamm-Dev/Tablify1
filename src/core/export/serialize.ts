/**
 * What an export **is**, as data: a table of cells in, a matrix of text out, and — for the one format that can
 * carry types — the typed cells a spreadsheet writer needs.
 *
 * Three rules, all of them from the docs rather than invented here:
 *
 *  1. **There is one TSV writer and one HTML writer, and they are the clipboard's.** `toTsv`/`toHtml` are the
 *     functions step 22's copy path put on the clipboard (`docs/01` §clipboard: *"copy out to Sheets"*), re-exported
 *     here rather than reimplemented. An export that escaped quotes differently from a copy would be two products
 *     with one name, and `tests/unit/export.test.ts` pins this file's output against the same fixtures
 *     `clipboard-roundtrip.test.ts` uses.
 *  2. **`mode` is explicit and comes from the dialog.** `display` is what the cell shows (`formatDisplay`), `raw`
 *     is the text a spreadsheet reads back unchanged (`formatPlain` — the descriptor's own "plain text for
 *     clipboard/TSV/export"). Nothing guesses: a currency column exports `€1,200.00` as *displayed* and `1200` as
 *     *raw*, and both are correct answers to different questions. `docs/07` §acceptance asks for the visible values,
 *     which is why `display` is the dialog's default.
 *  3. **Typing happens once, in `toXlsxData`, and it may fail.** A typed cell is built from the cell's *own* column
 *     type, and a text that does not parse stays a string — a `number` column exported in display mode carries a
 *     thousands separator or a currency symbol, and turning `1,200.00` into `1200` would be a silent reinterpretation
 *     of someone's data. Excel shows the text; that is the honest answer.
 *
 * No library is imported here, and no vault, host or clock is read: this file is arithmetic over values, which is
 * what makes the whole export path testable without a browser or a spreadsheet.
 */
import { toHtml, toTsv } from '../selection/clipboard';
import type { Matrix } from '../selection/clipboard';
import type { ResolvedField } from '../schema/propertySchema';
import type { CellValue, FieldTypeId } from '../types';

/** The two questions an export answers about every cell. Chosen by a person in the dialog, never inferred. */
export type ExportMode = 'display' | 'raw';

/** A table as the exporter needs it: the columns in render order, and one array of values per row, aligned. */
export type ExportTable = {
	readonly fields: readonly ResolvedField[];
	readonly rows: readonly (readonly CellValue[])[];
};

/** What `toTsv` and `toHtml` are: the clipboard's own writers, named here so callers need one import. */
export { toHtml, toTsv };
export type { Matrix };

/** A column, named for a header cell and typed for the writer. */
export type ExportColumn = {
	readonly name: string;
	readonly type: FieldTypeId;
};

/**
 * One row of cells, **aligned with the caller's columns**, in the shape a spreadsheet writer takes: an object with
 * a `value` (and, for a number or a date, a `format`), or `null` for an empty cell.
 *
 * The cell's **type is the JavaScript type of its value** — a number is a number cell, a `Date` is a date cell,
 * a `boolean` is a boolean cell — which is how `write-excel-file` itself decides (`detectValueType` in its
 * `sheet.xml/row.js`), so this file declares no `type` key at all: a second source for the same fact is a second
 * thing to get wrong. It also keeps this file free of any library import, which is what makes the typed cells
 * assertable in a unit test with no spreadsheet involved.
 */
export type XlsxCell =
	| { readonly value: string }
	| { readonly value: number; readonly format?: string }
	| { readonly value: boolean }
	| { readonly value: Date; readonly format: string }
	| null;

export type XlsxRow = readonly XlsxCell[];

/** The cell's type **as a name**, for a report or a test: `'Date'` for a date cell, `'empty'` for `null`. */
export function xlsxCellKind(cell: XlsxCell): 'String' | 'Number' | 'Boolean' | 'Date' | 'empty' {
	if (cell === null) {
		return 'empty';
	}
	if (typeof cell.value === 'string') {
		return 'String';
	}
	if (typeof cell.value === 'number') {
		return 'Number';
	}
	if (typeof cell.value === 'boolean') {
		return 'Boolean';
	}
	return 'Date';
}

/** How many rows, columns and cells an export will carry. The dialog states these before anything happens. */
export type ExportCounts = {
	readonly rows: number;
	readonly columns: number;
	readonly cells: number;
};

/**
 * The counts, from the table itself — the same object the runner serialises, so the dialog's numbers and the file's
 * numbers cannot disagree (the rule step 23 established for the import's estimate and plan).
 */
export function countExport(table: ExportTable): ExportCounts {
	const rows = table.rows.length;
	const columns = table.fields.length;
	return { rows, columns, cells: rows * columns };
}

/** One value, as text, in the requested mode. The descriptor owns the formatting; this only picks the method. */
export function cellText(value: CellValue, field: ResolvedField, mode: ExportMode): string {
	return mode === 'display'
		? field.descriptor.formatDisplay(value, field.context)
		: field.descriptor.formatPlain(value, field.context);
}

/**
 * The table as a matrix of strings, header row first.
 *
 * The header is the columns' **names** in both modes: a name is not a value, and a raw *header* would mean the
 * frontmatter key, which is a different string (`docs/03` §write rules 4) and not one a person wants in row 1.
 */
export function toMatrix(table: ExportTable, options: { readonly mode: ExportMode }): Matrix {
	const header = table.fields.map((field) => field.definition.name);
	const rows = table.rows.map((cells) =>
		cells.map((value, index) => {
			const field = table.fields[index];
			return field === undefined ? '' : cellText(value, field, options.mode);
		}),
	);
	return [header, ...rows];
}

/**
 * Which cell type a column's text becomes, and what number format rides with it.
 *
 * `percent` is the case worth reading twice: this product stores 25 for 25 % (`docs/08` §P12, *"human-first"*),
 * where a spreadsheet's own `0%` format multiplies by 100. The number therefore keeps our value and the format is
 * `0"%"` — a literal sign — so Excel *displays* 25 % and *holds* 25, i.e. the same number the note holds.
 */
const XLSX_FORMAT: Partial<Readonly<Record<FieldTypeId, string>>> = {
	currency: '#,##0.00',
	percent: '0"%"',
	duration: '[h]:mm:ss',
	rating: '0',
	date: 'yyyy-mm-dd',
	datetime: 'yyyy-mm-dd hh:mm',
};

/** The numeric field types: a plain number, in the note and in the sheet alike. */
const NUMERIC: readonly FieldTypeId[] = ['number', 'currency', 'percent', 'duration', 'rating'];

/** `Date` parsing: `2026-03-01` and `2026-03-01T09:30:00Z` both become an instant a spreadsheet understands. */
function instantOf(text: string): Date | null {
	const parsed = new Date(text);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A number, when the text is one; `null` when it is not — never `NaN`, never a silently rewritten value. */
function numberOf(text: string): number | null {
	if (text.trim() === '') {
		return null;
	}
	// `Number` rather than `parseFloat`: `parseFloat('1200 rows')` is 1200, which is a value the person did not
	// type. Only a string that *is* a number becomes a number cell.
	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : null;
}

/** One cell of the matrix as a typed cell. Exported for the tests, which assert it type by type. */
export function xlsxCell(text: string, type: FieldTypeId): XlsxCell {
	if (text === '') {
		return null;
	}
	if (NUMERIC.includes(type)) {
		const parsed = numberOf(text);
		if (parsed === null) {
			// Display mode's `€1,200.00` is not a number — and rewriting it to 1200 would be inventing data. The
			// cell stays text, which is what the person exported.
			return { value: text };
		}
		const format = XLSX_FORMAT[type];
		return format === undefined ? { value: parsed } : { value: parsed, format };
	}
	if (type === 'date' || type === 'datetime') {
		const parsed = instantOf(text);
		if (parsed === null) {
			return { value: text };
		}
		// A date column's `formatPlain` text is `yyyy-mm-dd`, read as UTC midnight, and the format shows that same
		// day in every timezone; a datetime keeps its own instant and shows it in the reader's.
		return { value: parsed, format: XLSX_FORMAT[type] ?? 'yyyy-mm-dd' };
	}
	if (type === 'checkbox') {
		if (text === 'true') {
			return { value: true };
		}
		if (text === 'false') {
			return { value: false };
		}
		return { value: text };
	}
	return { value: text };
}

/** The sheet the writer is handed: the header as strings, every other cell typed by its column. */
export function toXlsxData(matrix: Matrix, columns: readonly ExportColumn[]): readonly XlsxRow[] {
	return matrix.map((row, index) =>
		row.map((text, column) => {
			if (index === 0) {
				return text === '' ? null : { value: text };
			}
			const type = columns[column]?.type;
			return type === undefined ? null : xlsxCell(text, type);
		}),
	);
}
