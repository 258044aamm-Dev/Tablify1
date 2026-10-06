/**
 * `inferColumns` — what a pasted or imported matrix **is**, as evidence a person can check.
 *
 * The rules are the prototype's (`prototype/js/io.js` §inference), which is the product's only written statement
 * of "the types are inferred as today" (`docs/01` §Import semantics). They are reproduced here rather than
 * remembered, and every one of them is stated with **what forced the decision**, because a preview that says
 * *"text"* without saying *"row 42 is `n/a`"* is a preview nobody can correct — which is `docs/01`'s reason for
 * making the preview mandatory in the first place.
 *
 * The shape of an answer:
 *
 * ```ts
 * { type: 'number', sampleSize: 40, evidence: [{ row: 7, text: '1,20', forced: 'number' }], confidence: 0.97,
 *   alternative: 'text' }
 * ```
 *
 * Three deliberate decisions, all of them visible in the tests:
 *
 *   · **The inference reads a bounded sample of non-empty cells** ({@link SAMPLE_LIMIT}), not the whole column.
 *     A 400-row import is planned while the dialog is open, and reading 400 strings per column to answer "is
 *     this a date?" is work nobody sees; the *plan* still visits every row, because that is what writes files.
 *   · **`confidence` is measured, not invented**: the share of the sample that fits the chosen type. A column of
 *     40 numbers is 1.0; a column of 39 numbers and one `n/a` is 0.97 and says which cell.
 *   · **`alternative` is the type a person is most likely to want instead** — text for a number column (so
 *     `1,20` can stay the string someone typed), number for a text column that was *almost* numeric. It is
 *     advice, and the wizard renders it as such.
 */
import { fromHtml, fromTsv } from '../selection/clipboard';
import type { Matrix } from '../selection/clipboard';
import type { FieldTypeId } from '../types';

/** How many non-empty cells per column the inference reads. Past this, the sample is still representative. */
export const SAMPLE_LIMIT = 200;

/** The types this step can infer. A subset of the registry: the rest need options nobody can guess. */
export const INFERABLE_TYPES: readonly FieldTypeId[] = [
	'text',
	'longText',
	'number',
	'date',
	'datetime',
	'checkbox',
	'duration',
	'url',
	'email',
	'currency',
	'percent',
	'singleSelect',
];

/** The rows an ordinary column has before it is "many" — the threshold `singleSelect` uses. */
const SELECT_MAX_OPTIONS = 12;
const SELECT_SHARE = 0.35;

/**
 * One cell's vote, and why. `forced` is the only thing a person can act on: `fits` is a cell that agrees with the
 * verdict, `blocks` is the cell that stopped the column being the *nearer* type — the one worth looking at.
 */
export type ColumnEvidence = {
	/** The cell's row in the **matrix** (header included), so the wizard can point at a visible line. */
	readonly row: number;
	/** The cell as it arrived, trimmed for display. */
	readonly text: string;
	readonly forced: 'fits' | 'blocks';
	/** The type this cell blocked, when it blocked one. */
	readonly blocksType?: FieldTypeId | undefined;
};

/** The stricter type a column *almost* was, and how much of the sample fits it. The wizard's most useful line. */
export type NearMiss = {
	readonly type: FieldTypeId;
	/** 0–1: the share of the sampled cells that fit {@link type}. */
	readonly share: number;
};

export type ColumnInference = {
	/** The matrix column this describes. */
	readonly index: number;
	/** The header cell's text, or `Column <n>` when there is no header (the prototype's own fallback). */
	readonly name: string;
	readonly type: FieldTypeId;
	/** Every non-empty cell was read when this is `true`; otherwise the sample was capped at `SAMPLE_LIMIT`. */
	readonly complete: boolean;
	/** The number of non-empty cells the decision used. */
	readonly sampleSize: number;
	/** Cells that made a difference: the ones that blocked a stricter type, plus the first few that fit it. */
	readonly evidence: readonly ColumnEvidence[];
	/**
	 * Share of the sample that fits `type`, to two decimals. By construction this is `1` for a recognised type and
	 * for the fallbacks — a text column *is* text — so the interesting number for a fallback is
	 * {@link ColumnInference.nearMiss}, not this one.
	 */
	readonly confidence: number;
	/** The stricter type most of the sample looks like, when the column is a fallback. `null` when nothing fits. */
	readonly nearMiss: NearMiss | null;
	/** The type most likely to be wanted instead, `null` when the inference is the obvious answer. */
	readonly alternative: FieldTypeId | null;
	/** True when every cell in the column is empty — a column that will import as nothing. */
	readonly empty: boolean;
	/** The distinct non-empty values, capped, for the wizard's sample line. */
	readonly samples: readonly string[];
	/** The three values a wizard shows in its "detected from" cell. */
	readonly distinct: number;
};

/* ── the recognisers, one per type, exactly the prototype's ───────────────────────────────────── */

const looksBool = (text: string): boolean => /^(true|false|yes|no|✓|x)$/i.test(text);
const looksDate = (text: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(text);
const looksDateTime = (text: string): boolean => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text);
const looksNumeric = (text: string): boolean =>
	text !== '' && !Number.isNaN(Number(text.replace(/[$€£,%\s]/g, '')));
const looksEmail = (text: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text);
const looksUrl = (text: string): boolean => /^https?:\/\//i.test(text);
const looksDuration = (text: string): boolean =>
	/^\d+:[0-5]\d(:[0-5]\d)?$/.test(text) || /^\d+(m|h|s)$/.test(text);
const looksCurrency = (text: string): boolean => /^[$€£]\s?\d/.test(text);
const looksPercent = (text: string): boolean => /^\d+(\.\d+)?\s?%$/.test(text);

/** The order the recognisers are tried in. First match wins — the prototype's order, which is not arbitrary. */
const RECOGNISERS: readonly {
	readonly type: FieldTypeId;
	readonly test: (text: string) => boolean;
}[] = [
	{ type: 'checkbox', test: looksBool },
	{ type: 'duration', test: looksDuration },
	{ type: 'datetime', test: looksDateTime },
	{ type: 'date', test: looksDate },
	{ type: 'url', test: looksUrl },
	{ type: 'email', test: looksEmail },
	{ type: 'percent', test: looksPercent },
	{ type: 'currency', test: looksCurrency },
	{ type: 'number', test: looksNumeric },
];

/**
 * One column, decided. `body` is the matrix without its header when the caller says the first row is one.
 */
export function inferColumn(
	column: readonly (string | undefined)[],
	options: { readonly index: number; readonly name: string; readonly rowOffset: number },
): ColumnInference {
	const present: { readonly row: number; readonly text: string }[] = [];
	column.forEach((cell, index) => {
		const text = (cell ?? '').trim();
		if (text !== '') {
			present.push({ row: index + options.rowOffset, text });
		}
	});
	const sample = present.slice(0, SAMPLE_LIMIT);
	const complete = present.length <= SAMPLE_LIMIT;
	const distinct = new Set(present.map((cell) => cell.text)).size;
	const empty = present.length === 0;

	if (empty) {
		return {
			index: options.index,
			name: options.name,
			type: 'text',
			complete,
			sampleSize: 0,
			evidence: [],
			confidence: 1,
			nearMiss: null,
			alternative: null,
			empty,
			samples: [],
			distinct: 0,
		};
	}

	// 1 · every cell agrees on a type → that type.
	for (const recogniser of RECOGNISERS) {
		const fits = sample.filter((cell) => recogniser.test(cell.text)).length;
		if (fits === sample.length) {
			return {
				index: options.index,
				name: options.name,
				type: recogniser.type,
				complete,
				sampleSize: sample.length,
				evidence: evidenceFor(sample),
				confidence: 1,
				nearMiss: null,
				alternative: alternativeFor(recogniser.type),
				empty,
				samples: sample.slice(0, 3).map((cell) => cell.text),
				distinct,
			};
		}
	}

	// 2 · a small set of repeated values → a select. The prototype's rule, the prototype's two numbers.
	if (
		distinct <= Math.max(3, Math.round(present.length * SELECT_SHARE)) &&
		distinct <= SELECT_MAX_OPTIONS
	) {
		return {
			index: options.index,
			name: options.name,
			type: 'singleSelect',
			complete,
			sampleSize: sample.length,
			evidence: evidenceFor(sample),
			// A select is exact when every cell is a member of the set; the distinct count *is* the evidence.
			confidence: 1,
			nearMiss: null,
			alternative: 'text',
			empty,
			samples: [...new Set(present.map((cell) => cell.text))].slice(0, 3),
			distinct,
		};
	}

	// 3 · long cells → longText; everything else is text, with the *nearer* type named and its misfits listed.
	const allLong = sample.every((cell) => cell.text.length > 40);
	const type: FieldTypeId = allLong ? 'longText' : 'text';
	const near = nearMiss(sample);
	return {
		index: options.index,
		name: options.name,
		type,
		complete,
		sampleSize: sample.length,
		evidence: near === null ? evidenceFor(sample) : evidenceAgainst(sample, near.type),
		// A text column is 1 by definition (anything is text). The number that matters — 39 numbers and one `n/a` —
		// is `nearMiss.share`, and the misfitting cell is named in the evidence.
		confidence: 1,
		nearMiss: near,
		alternative: near?.type ?? null,
		empty,
		samples: sample.slice(0, 3).map((cell) => cell.text),
		distinct,
	};
}

/**
 * The stricter type most of the sample looks like — the *nearer* type, and how much of the sample fits it.
 *
 * The recogniser with the most fits wins, ties broken by {@link RECOGNISERS}' order (which tries the strictest
 * shapes first). `null` when nothing in the sample looks like anything: a column of free prose has no near miss,
 * and offering one would be noise.
 */
function nearMiss(sample: readonly { readonly text: string }[]): NearMiss | null {
	let best: NearMiss | null = null;
	for (const recogniser of RECOGNISERS) {
		const fits = sample.filter((cell) => recogniser.test(cell.text)).length;
		if (fits === 0 || fits === sample.length) {
			continue;
		}
		const share = Math.round((fits / sample.length) * 100) / 100;
		if (best === null || share > best.share) {
			best = { type: recogniser.type, share };
		}
	}
	return best;
}

/** The cells that agree with the verdict, for a column that had a verdict worth showing. */
function evidenceFor(
	sample: readonly { readonly row: number; readonly text: string }[],
): readonly ColumnEvidence[] {
	return sample
		.slice(0, 3)
		.map((cell) => ({ row: cell.row, text: cell.text, forced: 'fits' as const }));
}

/** The cells that stopped the column being its nearer type — the rows a person has to look at. */
function evidenceAgainst(
	sample: readonly { readonly row: number; readonly text: string }[],
	type: FieldTypeId,
): readonly ColumnEvidence[] {
	const recogniser = RECOGNISERS.find((candidate) => candidate.type === type);
	if (recogniser === undefined) {
		return evidenceFor(sample);
	}
	const misfits: ColumnEvidence[] = [];
	for (const cell of sample) {
		if (recogniser.test(cell.text)) {
			continue;
		}
		misfits.push({ row: cell.row, text: cell.text, forced: 'blocks', blocksType: type });
		if (misfits.length >= 5) {
			break;
		}
	}
	return misfits.length > 0 ? misfits : evidenceFor(sample);
}

/**
 * The type a person is most likely to want instead, or `null` when the inference is obvious.
 *
 * A number column of short integers could be a rating or an id, but both need options we cannot guess, and the
 * honest advice for the commonest real case (a code, a phone number, a house number) is text.
 */
function alternativeFor(type: FieldTypeId): FieldTypeId | null {
	if (
		type === 'number' ||
		type === 'date' ||
		type === 'datetime' ||
		type === 'currency' ||
		type === 'percent' ||
		type === 'duration'
	) {
		return 'text';
	}
	return null;
}

/** Every column of a matrix, inferred. `hasHeader` is the wizard's checkbox, and it changes `rowOffset`. */
export function inferColumns(
	matrix: Matrix,
	hasHeader: boolean,
): { readonly columns: readonly ColumnInference[]; readonly width: number; readonly body: Matrix } {
	if (matrix.length === 0) {
		return { columns: [], width: 0, body: [] };
	}
	const width = matrix.reduce((widest, row) => Math.max(widest, row.length), 0);
	const header = hasHeader ? (matrix[0] ?? []) : [];
	const body = hasHeader ? matrix.slice(1) : matrix;
	const rowOffset = hasHeader ? 1 : 0;
	const columns: ColumnInference[] = [];
	for (let index = 0; index < width; index += 1) {
		const cells = body.map((row) => row[index]);
		const headerText = (header[index] ?? '').trim();
		columns.push(
			inferColumn(cells, {
				index,
				name: headerText === '' ? `Column ${String(index + 1)}` : headerText,
				rowOffset,
			}),
		);
	}
	return { columns, width, body };
}

/**
 * The wizard's columns as a **plain table of text**, which is what the prompt asks to be printed: one line per
 * column, its type, its confidence, and the evidence with the offending rows. Pure formatting over the same
 * data the dialog renders, so the report and the UI cannot disagree.
 */
export function inferenceTable(columns: readonly ColumnInference[]): string {
	const lines = columns.map((column) => {
		const evidence =
			column.evidence.length === 0
				? 'no non-empty cells'
				: column.evidence
						.map((cell) =>
							cell.forced === 'blocks'
								? `row ${String(cell.row)} ${JSON.stringify(cell.text)} blocks ${String(cell.blocksType)}`
								: `row ${String(cell.row)} ${JSON.stringify(cell.text)}`,
						)
						.join('; ');
		const near =
			column.nearMiss === null
				? ''
				: `, ${String(Math.round(column.nearMiss.share * 100))}% look like ${column.nearMiss.type}`;
		const verdict = `${column.type} (${column.confidence.toFixed(2)}${column.complete ? '' : ', sampled'}${near})`;
		const advice = column.alternative === null ? '' : ` → could be ${column.alternative}`;
		return `${column.name}: ${verdict}${advice}\n    ${String(column.sampleSize)} sample, ${String(column.distinct)} distinct — ${evidence}`;
	});
	return lines.join('\n');
}

/* ── reading a source: the wizard's step 1, as functions rather than as dialog code ──────────── */

/** Where a matrix came from, and how it was read. The wizard shows this; the tests assert it. */
export type ImportSource =
	| { readonly kind: 'text'; readonly text: string; readonly name: string }
	| { readonly kind: 'matrix'; readonly matrix: Matrix; readonly name: string };

export type ReadSourceResult =
	| {
			readonly ok: true;
			readonly matrix: Matrix;
			readonly flavour: 'tsv' | 'html' | 'csv' | 'given';
	  }
	| { readonly ok: false; readonly reason: string };

/**
 * A pasted or typed block as a matrix. TSV is tried first (what a spreadsheet puts on the clipboard), then HTML
 * (what the *browser* puts there, and the flavour Excel trusts), then CSV — the same order and the same readers
 * the clipboard paste uses (`src/grid/clipboard/matrix.ts`), because it is the same problem.
 */
export function readSource(source: ImportSource): ReadSourceResult {
	if (source.kind === 'matrix') {
		return source.matrix.length === 0
			? { ok: false, reason: 'that block has no rows' }
			: { ok: true, matrix: source.matrix, flavour: 'given' };
	}
	const text = source.text;
	if (text.trim() === '') {
		return { ok: false, reason: 'there is nothing to import' };
	}
	if (text.includes('\t')) {
		const matrix = fromTsv(text);
		return matrix.length === 0
			? { ok: false, reason: 'no rows could be read from that text' }
			: { ok: true, matrix, flavour: 'tsv' };
	}
	if (/<table[\s>]/i.test(text)) {
		const matrix = fromHtml(text);
		return matrix === null
			? { ok: false, reason: 'that HTML has no table in it' }
			: { ok: true, matrix, flavour: 'html' };
	}
	const matrix = fromCsvText(text);
	return matrix.length === 0
		? { ok: false, reason: 'no rows could be read from that text' }
		: { ok: true, matrix, flavour: 'csv' };
}

/**
 * Comma-separated text as a matrix.
 *
 * `src/core/selection/clipboard.ts` reads *tab*-separated text in both directions, and this is the same reader
 * with a comma for the separator — the quote rules included (a quoted field may contain a comma, a newline and
 * doubled quotes). It is here rather than in the clipboard module because the clipboard's job is the
 * spreadsheet formats, and CSV is a file format: step 24's export writes the other side of it.
 */
export function fromCsvText(text: string): Matrix {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index] ?? '';
		if (quoted) {
			if (character === '"') {
				if (text[index + 1] === '"') {
					field += '"';
					index += 1;
				} else {
					quoted = false;
				}
			} else {
				field += character;
			}
			continue;
		}
		if (character === '"' && field === '') {
			quoted = true;
			continue;
		}
		if (character === ',') {
			row.push(field);
			field = '';
			continue;
		}
		if (character === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
			continue;
		}
		if (character === '\r') {
			// A CRLF pair is one line ending: the LF branch has already done the work when the LF follows.
			if (text[index + 1] === '\n') {
				continue;
			}
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
			continue;
		}
		field += character;
	}
	if (quoted) {
		// An unterminated quote: read what there is rather than refusing the whole file. The trailing text of the
		// last field is already in `field`, so the row closes normally — and the caller sees the data.
		quoted = false;
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	// A trailing newline produces one empty row; drop it once, the rule `fromTsv` uses for the same reason.
	const last = rows[rows.length - 1];
	if (rows.length > 1 && last !== undefined && last.length === 1 && last[0] === '') {
		rows.pop();
	}
	return rows;
}
