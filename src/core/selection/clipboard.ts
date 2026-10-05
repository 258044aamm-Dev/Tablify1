/**
 * The clipboard matrix: plain text in, plain text out, twice — as TSV and as an HTML table.
 *
 * Both directions exist because spreadsheets write both flavours and read both flavours: copying out of
 * Excel gives you `text/plain` (TSV) *and* `text/html`, and pasting into Excel works best from `text/html`
 * (a TSV paste loses its tabs on macOS Excel). So the grid puts both on the clipboard, and accepts either
 * one coming back, preferring the HTML when it is there — `docs/01` §Feature scope: "Copy range as TSV
 * **and** HTML (spreadsheet-compatible in both directions); paste TSV from any spreadsheet; paste HTML
 * tables".
 *
 * This module is deliberately type-blind: a cell here is a **string**, already formatted by the column's
 * `formatPlain` and parsed back by its `parsePlain`. That is what keeps `2026-01-01` and `4.50` round
 * tripping through a text channel without the clipboard having to know what a date is.
 *
 * ## Escaping, and the one thing the quotes cannot do
 *
 * TSV follows the spreadsheet convention: a cell containing a tab, a newline, a carriage return or a quote
 * is wrapped in double quotes, and inner quotes are doubled. On top of that, a cell starting with `=`, `+`,
 * `-` or `@` is *also* quoted, because those characters make a spreadsheet treat the text as a formula
 * (the "CSV injection" case). Quoting is the mitigation the text format allows; it is **not a guarantee** —
 * Excel unquotes and re-evaluates `=1+1` on paste no matter what we do, and `docs/07` §"What is
 * deliberately not tested" already lists real clipboard payloads from the real apps as untestable here.
 * The complementary guarantee is on our side: `fromTsv` and `fromHtml` never evaluate anything. A cell
 * arriving as `=SUM(A1:A9)` is stored as that text, in a text column, forever.
 *
 * In HTML the same leading characters are handled the way Excel documents it — the cell is written with
 * `mso-number-format:'\@'`, which marks the cell as text. (ASSUMED: that this style is honoured on paste by
 * every Excel build; it is the documented shape, and the parsed reading is unaffected either way.)
 */
/** A block of cells as plain text: rows of columns. What the clipboard actually carries. */
export type Matrix = readonly (readonly string[])[];

/** Characters that make a spreadsheet treat a cell as a formula rather than as text. */
const FORMULA_START = ['=', '+', '-', '@'];

/** Whether a cell must be quoted in TSV: structure, or a formula-leading character. */
function needsQuotes(cell: string): boolean {
	if (cell.includes('\t') || cell.includes('\n') || cell.includes('\r') || cell.includes('"')) {
		return true;
	}
	const first = cell.charAt(0);
	return FORMULA_START.includes(first);
}

/** One TSV field, quoted per the rules above. */
function tsvField(cell: string): string {
	if (!needsQuotes(cell)) {
		return cell;
	}
	return `"${cell.replace(/"/g, '""')}"`;
}

/**
 * The matrix as text: rows split by `\n`, columns by `\t`, no trailing newline. Every cell is written,
 * including the empty ones at the end of a row, so the matrix keeps its width.
 */
export function toTsv(cells: Matrix): string {
	const text = cells.map((row) => row.map(tsvField).join('\t')).join('\n');
	// One empty cell would produce empty text, which is indistinguishable from "nothing was copied" — so it is
	// written as a quoted empty field. Every spreadsheet reads `""` as an empty cell, and `fromTsv` round-trips
	// it. (A matrix with no cells at all is genuinely empty text and stays that way.)
	if (text === '' && cells.length === 1 && cells[0]?.length === 1) {
		return '""';
	}
	return text;
}

/**
 * Text as a matrix. Handles quoted fields (including a quoted newline inside one cell), CRLF and CR line
 * endings, and drops the empty last row that a trailing newline produces — the one normalisation a
 * spreadsheet's own output requires. Each cell keeps its text verbatim; nothing is interpreted.
 */
export function fromTsv(text: string): Matrix {
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
		if (character === '\t') {
			row.push(cell);
			cell = '';
			index += 1;
			endedWithNewline = false;
			continue;
		}
		if (character === '\n' || character === '\r') {
			// CRLF is one line ending; a lone CR is one too.
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
	// A trailing newline is a line terminator, not an empty row — but if the payload ended with two, only the
	// terminator's row is dropped, so a matrix ending in an empty row survives one newline of noise.
	if (endedWithNewline && rows.length > 0) {
		const last = rows[rows.length - 1];
		if (last !== undefined && last.length === 1 && last[0] === '') {
			rows.pop();
		}
	}
	return rows;
}

/** HTML-escaping for text nodes, plus the `&nbsp;` rule below. */
function htmlText(cell: string): string {
	return cell
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/ /g, '&nbsp;');
}

/** The style a sheet uses to keep a formula-looking text cell as text. */
const TEXT_CELL_STYLE = "mso-number-format:'\\@'";

/**
 * The matrix as an HTML table. Spaces become `&nbsp;` and newlines become `<br>`, which is what spreadsheets
 * write for the same reason: HTML collapses runs of whitespace, so a cell's layout survives only if the
 * spaces are non-breaking. `fromHtml` reads both back, so our own output round trips exactly.
 */
export function toHtml(cells: Matrix): string {
	const rows = cells
		.map((row) => {
			const tds = row
				.map((cell) => {
					const style = FORMULA_START.includes(cell.charAt(0))
						? ` style="${TEXT_CELL_STYLE}"`
						: '';
					const text = htmlText(cell).replace(/\n/g, '<br>');
					// An empty cell is written as an empty `<td>`; a strictly empty string is what a reader
					// sees either way, and keeping it empty avoids inventing a non-breaking space.
					return `<td${style}>${text}</td>`;
				})
				.join('');
			return `<tr>${tds}</tr>`;
		})
		.join('');
	return `<table><tbody>${rows}</tbody></table>`;
}

/** The named entities this reader understands. Numeric entities are handled separately. */
const ENTITIES: Readonly<Record<string, string>> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	ensp: ' ',
	emsp: ' ',
	thinsp: '',
	zwnj: '\u200c',
	zwj: '\u200d',
	mdash: '\u2014',
	ndash: '\u2013',
	hellip: '\u2026',
	rsquo: '\u2019',
	lsquo: '\u2018',
	ldquo: '\u201c',
	rdquo: '\u201d',
};

/** `&amp;`, `&#65;` and `&#x41;` decoded. Unknown entities are left as written, which is what a browser
 * does with text it does not recognise. */
export function decodeEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
		if (body.startsWith('#')) {
			const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
			const digits = hex ? body.slice(2) : body.slice(1);
			const code = Number.parseInt(digits, hex ? 16 : 10);
			if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
				return whole;
			}
			return String.fromCodePoint(code);
		}
		return ENTITIES[body] ?? whole;
	});
}

/** Tags whose *content* must never reach a cell: styling and scripting, not data. */
const IGNORED_ELEMENTS = ['style', 'script', 'head', 'title', 'meta', 'colgroup'];

/** Removes comments, doctypes and the content of the elements above. */
function stripNoise(html: string): string {
	let out = html.replace(/<!--[\s\S]*?-->/g, '');
	out = out.replace(/<!\[[\s\S]*?\]>/g, '');
	for (const tag of IGNORED_ELEMENTS) {
		const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
		out = out.replace(pattern, '');
	}
	return out;
}

/** One token of the little scanner below. */
type Token =
	| { readonly kind: 'text'; readonly text: string }
	| {
			readonly kind: 'tag';
			readonly name: string;
			readonly closing: boolean;
			readonly selfClosing: boolean;
	  };

/** Splits markup into text and tags. Attributes are read only far enough to find the end of the tag. */
function tokenize(html: string): readonly Token[] {
	const tokens: Token[] = [];
	let index = 0;
	let text = '';
	while (index < html.length) {
		const character = html.charAt(index);
		if (character !== '<') {
			text += character;
			index += 1;
			continue;
		}
		const end = html.indexOf('>', index);
		if (end === -1) {
			text += html.slice(index);
			break;
		}
		const raw = html.slice(index + 1, end).trim();
		const closing = raw.startsWith('/');
		const body = closing ? raw.slice(1).trim() : raw;
		const name = (body.split(/[\s/]/)[0] ?? '').toLowerCase();
		const selfClosing =
			raw.endsWith('/') || ['br', 'img', 'hr', 'meta', 'input'].includes(name);
		if (name !== '') {
			if (text !== '') {
				tokens.push({ kind: 'text', text });
				text = '';
			}
			tokens.push({ kind: 'tag', name, closing, selfClosing });
		}
		index = end + 1;
	}
	if (text !== '') {
		tokens.push({ kind: 'text', text });
	}
	return tokens;
}

/** Tags that end a line inside a cell. `</p>` and `</div>` are what Excel and Sheets use for a wrap. */
const LINE_BREAKS = ['br', 'p', 'div'];

/**
 * Reads the first HTML table out of a clipboard payload and returns it as a matrix, or `null` when there is
 * no table. Tolerant on purpose: real payloads arrive wrapped in `<google-sheets-html-origin>`, carry a
 * `<style>` block, `<colgroup>`s, `<tbody>`, and nest `<div>`s inside a cell (Google Sheets does exactly
 * that for a cell it thinks is a link). Cell text is trimmed — the whitespace between tags is indentation,
 * not data — and `<br>`/`</p>`/`</div>` become newlines inside the cell.
 *
 * Limitations, stated rather than hidden: a nested `<table>` inside a cell is skipped, `colspan`/`rowspan`
 * are ignored (the cell counts once), and a cell whose text is genuinely `&nbsp;`-only in the middle is
 * normalised to spaces, because that is what spreadsheets mean by it.
 */
export function fromHtml(html: string): Matrix | null {
	const tokens = tokenize(stripNoise(html));
	const rows: string[][] = [];
	let row: string[] | null = null;
	let cell: string | null = null;
	let tableDepth = 0;
	let nested = 0;
	for (const token of tokens) {
		if (token.kind === 'text') {
			if (cell !== null && nested === 0) {
				cell += token.text;
			}
			continue;
		}
		if (token.name === 'table') {
			if (token.closing) {
				if (nested > 0) {
					nested -= 1;
				} else if (tableDepth > 0) {
					tableDepth -= 1;
				}
				continue;
			}
			if (tableDepth > 0) {
				nested += 1;
			} else {
				tableDepth = 1;
			}
			continue;
		}
		if (tableDepth === 0) {
			continue;
		}
		if (token.name === 'tr') {
			if (token.closing) {
				if (row !== null && row.length > 0) {
					rows.push(row);
				}
				row = null;
			} else if (nested === 0) {
				row = [];
			}
			continue;
		}
		if (token.name === 'td' || token.name === 'th') {
			if (token.closing) {
				if (cell !== null && row !== null) {
					// Entities are decoded here rather than in a second pass, and the text is trimmed there:
					// `&nbsp;` becomes a space first, so a cell that only holds one reads as empty.
					row.push(decodeEntities(cell).trim());
					cell = null;
				}
				continue;
			}
			row ??= [];
			cell = '';
			continue;
		}
		if (cell !== null && nested === 0) {
			if (token.selfClosing && LINE_BREAKS.includes(token.name)) {
				cell += '\n';
			} else if (token.closing && LINE_BREAKS.includes(token.name)) {
				cell += '\n';
			}
		}
	}
	return rows.length === 0 ? null : rows;
}
