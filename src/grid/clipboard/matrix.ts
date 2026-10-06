/**
 * What is on the clipboard, and what the selection looks like when it gets there — the two conversions that
 * stand between a range of cells and a spreadsheet.
 *
 * This file is **pure**: it takes a payload (two strings) and a snapshot, and it gives back a matrix of strings.
 * Everything that needs a browser (the clipboard API, the `paste` event, a textarea fallback) lives in
 * `host.ts`, and everything that needs a decision lives in `pastePlan.ts`. That split is what makes the rules
 * testable without a browser: the escaping rules in `core/selection/clipboard` are already covered from step 12,
 * and this layer is the part that turns *cells* into text and text into *cells*.
 *
 * The direction out (`matrixOfSelection`) goes through each column's own `formatPlain`, never through the cell's
 * rendered text: the rendered text is truncated and ellipsised by the renderer, and a copy that carried
 * `Task 0001…` would be a copy of the display, not of the value. The direction in (`parsePayload`) goes through
 * `fromHtml` first, then TSV, then CSV — the order the prototype reads them and the order `docs/01` states:
 * *"paste TSV from any spreadsheet; paste HTML tables"*.
 */
import { cellAt } from '../store/store';
import { selectField } from '../store/selectors';
import { fieldsOf, rowsOf } from '../../core/selection/range';
import { fromHtml, fromTsv, toHtml, toTsv } from '../../core/selection/clipboard';
import type { GridState } from '../store/types';
import type { Range, RangeOrder } from '../../core/selection/range';
import type { Matrix } from '../../core/selection/clipboard';

export type { Matrix };
import type { ResolvedField } from '../../core/schema/propertySchema';

/** The two flavours a paste event can carry. Either may be empty; both may be present. */
export type ClipboardPayload = {
	/** `text/html` — a spreadsheet's faithful copy, with its line breaks and non-breaking spaces. */
	readonly html: string;
	/** `text/plain` — TSV and CSV both arrive here, and TSV is the one to prefer. */
	readonly text: string;
};

/** Which reader actually produced a matrix. Reported, never guessed at afterwards. */
export type PayloadFlavour = 'html' | 'tsv' | 'csv' | 'empty';

/** A payload, read. `matrix` is empty when nothing readable was there. */
export type ReadPayload = {
	readonly matrix: Matrix;
	readonly flavour: PayloadFlavour;
};

/**
 * The plain text of a payload: what goes on the clipboard as `text/plain`. TSV, because that is what a
 * spreadsheet reads back without ambiguity (a comma is a value in half the world's locales).
 */
export function payloadTsv(matrix: Matrix): string {
	return toTsv(matrix);
}

/** The HTML flavour of a payload: one real `<table>`, which is what Sheets and Excel read back best. */
export function payloadHtml(matrix: Matrix): string {
	return toHtml(matrix);
}

/**
 * The selection as a matrix, **for reading only** — a read-only column's value is copied like any other; it is
 * writing that the column refuses, and a copy is not a write.
 *
 * Order matters: rows down, columns across, both in *render* order, so a copy of a filtered/grouped view pastes
 * back in the same shape a person sees.
 */
export function matrixOfSelection(
	state: GridState,
	order: RangeOrder,
	range: Range | null,
): Matrix {
	if (range === null) {
		return [];
	}
	const rows = rowsOf(range, order);
	const fields = fieldsOf(range, order);
	const matrix: string[][] = [];
	for (const filePath of rows) {
		const line: string[] = [];
		for (const fieldId of fields) {
			// A column the grid cannot resolve is copied as an empty cell rather than skipped: dropping it would
			// shift every cell after it one column to the left, which is a *wrong* matrix, not a smaller one.
			const field = selectField(state, fieldId);
			line.push(
				field === undefined
					? ''
					: field.descriptor.formatPlain(cellAt(state, filePath, fieldId), field.context),
			);
		}
		matrix.push(line);
	}
	return matrix;
}

/** Whether a field is in the resolution the grid renders — the same list the matrix is built from. */
export function fieldOf(
	fields: readonly ResolvedField[],
	fieldId: string,
): ResolvedField | undefined {
	return fields.find((candidate) => candidate.definition.id === fieldId);
}

/**
 * A CSV payload as a matrix: RFC 4180, which is what every spreadsheet writes and what the prototype's
 * `parseCSV` implements. Kept here rather than in the core because CSV is not a clipboard *shape* — it is one
 * app's text flavour, and a single-column paste is the only time it is the whole story.
 *
 * Quoted fields may contain commas, newlines and doubled quotes; a bare `\r` is a line ending; a trailing
 * newline is a terminator, not an empty row.
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
	let endedWithNewline = false;
	while (index < text.length) {
		const character = text.charAt(index);
		if (quoted) {
			if (character === '"') {
				if (text.charAt(index + 1) === '"') {
					cell += '"';
					index += 2;
					continue;
				}
				quoted = false;
				index += 1;
				continue;
			}
			cell += character;
			index += 1;
			continue;
		}
		if (character === '"' && cell === '') {
			quoted = true;
			index += 1;
			continue;
		}
		if (character === ',') {
			row.push(cell);
			cell = '';
			index += 1;
			endedWithNewline = false;
			continue;
		}
		if (character === '\n' || character === '\r') {
			const step = character === '\r' && text.charAt(index + 1) === '\n' ? 2 : 1;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
			index += step;
			endedWithNewline = true;
			continue;
		}
		cell += character;
		index += 1;
		endedWithNewline = false;
	}
	if (!endedWithNewline) {
		row.push(cell);
		rows.push(row);
	}
	if (endedWithNewline && rows.length > 0) {
		const last = rows[rows.length - 1];
		if (last !== undefined && last.length === 1 && last[0] === '') {
			rows.pop();
		}
	}
	return rows;
}

/**
 * A payload, read. **HTML wins when it is there**, and that is not a preference: a Google Sheets or Excel
 * `text/plain` copy loses tabs on some platforms (macOS Excel is the documented case) while the HTML flavour
 * keeps cell boundaries exactly. When there is no table in the HTML — a web page's paragraph, say — the text
 * flavour is still tried rather than answering "nothing".
 *
 * The text flavour is sniffed by its separator: a tab anywhere means TSV, otherwise CSV. A *single* value with
 * neither is still a 1 × 1 matrix, because pasting one cell into a selection is a real thing to do.
 */
export function parsePayload(payload: ClipboardPayload): ReadPayload {
	if (payload.html !== '') {
		const matrix = fromHtml(payload.html);
		if (matrix !== null && matrix.length > 0) {
			return { matrix, flavour: 'html' };
		}
	}
	if (payload.text === '') {
		return { matrix: [], flavour: 'empty' };
	}
	const normalised = payload.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	return normalised.includes('\t')
		? { matrix: fromTsv(payload.text), flavour: 'tsv' }
		: { matrix: fromCsv(payload.text), flavour: 'csv' };
}

/**
 * Whether a pasted block's first row reads as a header line for the view's own columns: at least two of its
 * cells name a column, case-insensitively. Two, not one, because a single match is a coincidence — the
 * prototype's threshold, and the reason `create` can promise "mapped by header" only when it means it.
 */
export function headerMatch(matrix: Matrix, fields: readonly ResolvedField[]): boolean {
	const first = matrix[0];
	if (first === undefined || matrix.length < 2) {
		return false;
	}
	const names = fields.map((field) => field.definition.name.trim().toLowerCase());
	return first.filter((cell) => names.includes(cell.trim().toLowerCase())).length >= 2;
}

/** The matrix width: the widest row, so a ragged block from a spreadsheet is not silently clipped. */
export function widthOf(matrix: Matrix): number {
	return matrix.reduce((widest, row) => Math.max(widest, row.length), 0);
}
