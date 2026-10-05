/**
 * The `.tabula` reader: text plus a path in, a value out. Never a throw, never a guess.
 *
 * The two rules this file exists to keep:
 *
 *  1. **Nothing is invented.** The version comes from the content, the field types keep the spelling the file
 *     had, and every irregularity is either a `TabulaError` (the file cannot be read at all) or a
 *     `TabulaWarning` (it was read, and here is what looked odd). The step's STOP clause is about a fixture
 *     needing a rule that is not in `docs/03`; there is no such fixture, so there is no such rule.
 *  2. **Nothing throws.** `JSON.parse` is guarded, a truncated file produces a position and an excerpt
 *     instead of a stack trace, and the whole body is pure — no vault, no `App`, no DOM, no clock.
 *
 * Two of the fork's behaviours are deliberately not ported (they are the reason this is a rewrite rather
 * than a port; the report names them):
 *
 *  - `parseTableDocument(raw)` in the fork calls `JSON.parse` unguarded and **throws** `"Invalid table
 *    document"`; the migration path then has to catch it, so a corrupt file reaches the user as a raw
 *    engine message or as a default table. Here a corrupt file returns a `TabulaError` with a line, a
 *    column and an excerpt — and a zero-byte file is an error rather than a silently empty table.
 *  - the fork's normalizer maps an unknown field type to `'text'` **silently** and replaces a malformed v2
 *    table entry with `{}`, which becomes an empty table. Here an unknown type keeps the column and sets
 *    `unknown: true` (reported by the dry-run), and a malformed entry is an error naming the entry.
 */
import type { CellValue } from '../../core/types';
import type {
	TabulaCell,
	TabulaDoc,
	TabulaError,
	TabulaField,
	TabulaFilterCondition,
	TabulaFilterGroup,
	TabulaOption,
	TabulaResult,
	TabulaRow,
	TabulaSort,
	TabulaSync,
	TabulaTable,
	TabulaView,
	TabulaWarning,
} from './model';
import { EXCERPT_LIMIT, LEGACY_TYPES } from './model';

/** A narrow, honest read of a parsed JSON value: an object, not an array, not `null`. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `Reflect.get` returns `any`; this function's declared return type narrows it to `unknown` at the boundary.
 * That assignment — rather than a type assertion — is what keeps the whole adapter free of `as`, which the
 * step's constraints require.
 */
function read(source: Record<string, unknown>, key: string): unknown {
	const value: unknown = Reflect.get(source, key);
	return value;
}

/**
 * The array arm, as a type predicate: `Array.isArray` on an `unknown` gives `any[]`, and every element read
 * from it would then be `any`. Going through this helper keeps the elements `unknown`, which is what the
 * `isRecord`/`asString`/`asNumber` guards below are for.
 */
function asArray(value: unknown): readonly unknown[] | null {
	return Array.isArray(value) ? value : null;
}

function asString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
	return typeof value === 'boolean' ? value : null;
}

/** The 1-based line and column of a character offset, and the line itself, trimmed to the excerpt limit. */
function locate(text: string, offset: number): { line: number; column: number; excerpt: string } {
	const clamped = Math.max(0, Math.min(offset, text.length));
	const before = text.slice(0, clamped);
	const lastBreak = before.lastIndexOf('\n');
	const line = before.split('\n').length;
	const column = clamped - lastBreak;
	const end = text.indexOf('\n', clamped);
	const raw = text.slice(lastBreak + 1, end < 0 ? text.length : end).replace(/\r$/, '');
	return { line, column, excerpt: trimToLimit(raw.trim()) };
}

/** Finds a needle in the text and describes where it is. Used to point at a bad table entry. */
function locateNeedle(
	text: string,
	needle: string,
): { line: number; column: number; excerpt: string } | null {
	const at = text.indexOf(needle);
	return at < 0 ? null : locate(text, at);
}

function failure(
	path: string,
	message: string,
	options: {
		readonly at?: { line: number; column: number; excerpt: string };
		readonly cause?: unknown;
	} = {},
): TabulaResult {
	const error: TabulaError = {
		path,
		message,
		excerpt: options.at?.excerpt ?? '',
		...(options.at === undefined ? {} : { line: options.at.line, column: options.at.column }),
		...(options.cause === undefined ? {} : { cause: options.cause }),
	};
	return { ok: false, error };
}

/** Parses JSON, and turns a syntax error into a position and an excerpt rather than a stack trace. */
function parseJson(
	text: string,
	path: string,
):
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly result: TabulaResult } {
	try {
		const value: unknown = JSON.parse(text);
		return { ok: true, value };
	} catch (error) {
		// V8's message carries both a position and, since Node 20, a line/column pair. Prefer the pair; fall
		// back to the position; if neither is there, the error still names the problem and the file.
		const message = error instanceof Error ? error.message : String(error);
		const pair = /\(line (\d+) column (\d+)\)/.exec(message);
		if (pair !== null) {
			const line = Number(pair[1]);
			const column = Number(pair[2]);
			const at = locateAtLine(text, line, column);
			return {
				ok: false,
				result: failure(path, jsonMessage(text), { at, cause: error }),
			};
		}
		const position = /position (\d+)/.exec(message);
		const at = position === null ? locateEnd(text) : locateFrom(text, Number(position[1]));
		return {
			ok: false,
			result: failure(path, jsonMessage(text), { at, cause: error }),
		};
	}
}

/**
 * The last line that has anything on it. A syntax error with no position in the engine's message — V8 says
 * "Unexpected end of JSON input", Bun says "Expected '}'" — is almost always a file that stops early, and the
 * end of the file is the honest place to point at.
 */
function locateEnd(text: string): { line: number; column: number; excerpt: string } {
	const lines = text.split('\n');
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index] ?? '';
		if (line.trim() !== '') {
			// The **start** of that line: `locate` walks the text up to this offset, so a line offset would
			// land on the empty line after it and read as "no excerpt".
			const offset = lines.slice(0, index).reduce((sum, entry) => sum + entry.length + 1, 0);
			return locate(text, offset);
		}
	}
	return locate(text, 0);
}

/**
 * The description of a position the engine reported. V8 points at the *end of the input* for a truncated
 * document — the last byte, where there is no text — so a position that lands on nothing is answered with the
 * last line that has content instead. That is what makes the reader's output the same on every engine.
 */
function locateFrom(
	text: string,
	offset: number,
): { line: number; column: number; excerpt: string } {
	const at = locate(text, offset);
	return at.excerpt === '' ? locateEnd(text) : at;
}

/** Is the document cut short? A complete JSON document ends with `}` or `]`. */
function looksTruncated(text: string): boolean {
	const tail = text.trimEnd();
	return !(tail.endsWith('}') || tail.endsWith(']'));
}

/** A sentence for the user, deterministic across runtimes: the engine's own wording is in `cause`. */
function jsonMessage(text: string): string {
	return looksTruncated(text)
		? 'the file is not valid JSON — it stops before the document ends, so it is truncated or only partly saved'
		: 'the file is not valid JSON';
}

/**
 * The line/column a V8 message reports, turned into the same shape `locate` returns.
 *
 * A JSON error is often reported at the *end* of the input — "line 10, column 1" of a file whose last line is
 * empty, because the parser ran out of text — and an empty excerpt tells a person nothing. So when the
 * reported line has no content, the excerpt comes from the nearest line above it that does. The position
 * itself is reported as the engine gave it.
 */
function locateAtLine(
	text: string,
	line: number,
	column: number,
): { line: number; column: number; excerpt: string } {
	const lines = text.split('\n');
	const index = Math.max(0, Math.min(line - 1, lines.length - 1));
	const excerpt = trimToLimit((lines[index] ?? '').trim());
	if (excerpt !== '') {
		return { line, column, excerpt };
	}
	// The engine pointed at a line with nothing on it — a truncated document ends at a blank line, so the
	// syntax error is reported one line past the text. Point at the last line that has content instead, and
	// report *that* line's number: the answer is then the same whatever parsed the JSON, and it is a line a
	// person can go and look at.
	for (let above = index - 1; above >= 0; above -= 1) {
		const candidate = trimToLimit((lines[above] ?? '').trim());
		if (candidate !== '') {
			return { line: above + 1, column: 1, excerpt: candidate };
		}
	}
	return { line, column, excerpt };
}

/** One line, trimmed to the excerpt limit. Shared so every excerpt in this file obeys the same rule. */
function trimToLimit(line: string): string {
	return line.length > EXCERPT_LIMIT ? `${line.slice(0, EXCERPT_LIMIT - 1)}…` : line;
}

/** Normalizes a cell: scalars pass, a list of scalars becomes a list, anything else is `null` plus a warning. */
function readCell(value: unknown): { readonly cell: TabulaCell; readonly dropped: boolean } {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		return { cell: value, dropped: false };
	}
	if (Array.isArray(value)) {
		const list: string[] = [];
		let dropped = false;
		for (const entry of value) {
			if (typeof entry === 'string') {
				list.push(entry);
			} else if (typeof entry === 'number' || typeof entry === 'boolean') {
				list.push(String(entry));
			} else {
				dropped = true;
			}
		}
		return { cell: list, dropped };
	}
	return { cell: null, dropped: true };
}

/**
 * A filter operand, in the canonical cell shape. A list becomes a list of labels, because that is what the
 * legacy operators (`isAnyOf`, `containsAny`) hold; an operand this build cannot express — a nested object,
 * which the legacy filter builder never produced — is reported as empty rather than stringified into a value
 * nobody wrote.
 */
function readFilterValue(value: unknown): CellValue {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		return value;
	}
	if (Array.isArray(value)) {
		const list: string[] = [];
		for (const entry of value) {
			if (entry === null) {
				list.push('');
			} else if (typeof entry === 'string') {
				list.push(entry);
			} else if (typeof entry === 'number' || typeof entry === 'boolean') {
				list.push(String(entry));
			}
		}
		return list;
	}
	return null;
}

function readOptions(field: Record<string, unknown>): readonly TabulaOption[] {
	const raw = asArray(read(field, 'options'));
	if (raw === null) {
		return [];
	}
	const options: TabulaOption[] = [];
	for (const entry of raw) {
		if (!isRecord(entry)) {
			continue;
		}
		const id = asString(read(entry, 'id'));
		const name = asString(read(entry, 'name'));
		if (id === null || name === null) {
			continue;
		}
		options.push({ id, name, color: asString(read(entry, 'color')) });
	}
	return options;
}

function readFields(
	table: Record<string, unknown>,
	tableLabel: string,
	tableIndex: number,
	warnings: TabulaWarning[],
): readonly TabulaField[] {
	const raw = asArray(read(table, 'fields'));
	if (raw === null) {
		return [];
	}
	const fields: TabulaField[] = [];
	raw.forEach((entry, index) => {
		if (!isRecord(entry)) {
			warnings.push({
				code: 'missing-field-id',
				tableIndex,
				where: `${tableLabel} column ${String(index + 1)}`,
				message: 'a column entry is not an object; it was skipped',
			});
			return;
		}
		const givenId = asString(read(entry, 'id'));
		const id = givenId ?? `f_missing_${String(index + 1)}`;
		if (givenId === null) {
			warnings.push({
				code: 'missing-field-id',
				tableIndex,
				where: `${tableLabel} column ${String(index + 1)}`,
				message: `a column has no id; it was given “${id}” so its values keep an address`,
			});
		}
		const givenName = asString(read(entry, 'name'));
		if (givenName === null) {
			warnings.push({
				code: 'missing-field-name',
				tableIndex,
				where: `${tableLabel} column ${String(index + 1)}`,
				message: 'a column has no name; it will be named after its position',
			});
		}
		const legacyType = asString(read(entry, 'type')) ?? 'text';
		const unknown = !LEGACY_TYPES.includes(legacyType);
		if (unknown) {
			warnings.push({
				code: 'unknown-type',
				tableIndex,
				where: `${tableLabel} column “${givenName ?? id}”`,
				message: `the type “${legacyType}” is not a legacy type this build knows; the column is kept as text`,
			});
		}
		fields.push({
			id,
			name: givenName ?? '',
			legacyType,
			unknown,
			options: readOptions(entry),
			symbol: asString(read(entry, 'symbol')),
			max: asNumber(read(entry, 'max')),
		});
	});
	return fields;
}

function readRows(
	table: Record<string, unknown>,
	fields: readonly TabulaField[],
	tableLabel: string,
	tableIndex: number,
	warnings: TabulaWarning[],
): readonly TabulaRow[] {
	const raw = asArray(read(table, 'rows'));
	if (raw === null) {
		return [];
	}
	const known = new Set(fields.map((field) => field.id));
	let extraColumns = 0;
	let firstExtra: string | null = null;
	const rows: TabulaRow[] = [];
	raw.forEach((entry, index) => {
		if (!isRecord(entry)) {
			warnings.push({
				code: 'missing-row-cells',
				tableIndex,
				where: `${tableLabel} row ${String(index + 1)}`,
				message: 'a row is not an object; it was skipped',
			});
			return;
		}
		const id = asString(read(entry, 'id')) ?? `r_missing_${String(index + 1)}`;
		const cellsRaw = read(entry, 'cells');
		if (!isRecord(cellsRaw)) {
			warnings.push({
				code: 'missing-row-cells',
				tableIndex,
				where: `${tableLabel} row ${String(index + 1)}`,
				message: `row “${id}” has no cells object; it was kept as an empty row`,
			});
		}
		const cells: Record<string, TabulaCell> = {};
		if (isRecord(cellsRaw)) {
			for (const key of Object.keys(cellsRaw)) {
				if (!known.has(key)) {
					extraColumns += 1;
					firstExtra ??= key;
					continue;
				}
				const read1 = readCell(read(cellsRaw, key));
				cells[key] = read1.cell;
			}
		}
		rows.push({ id, cells });
	});
	if (extraColumns > 0) {
		warnings.push({
			code: 'extra-cell-column',
			tableIndex,
			where: `${tableLabel} rows`,
			message: `${String(extraColumns)} value(s) belong to a column the table does not have (first: “${String(firstExtra)}”); they are not carried`,
		});
	}
	return rows;
}

function readSorts(
	view: Record<string, unknown>,
	tableLabel: string,
	tableIndex: number,
	warnings: TabulaWarning[],
): readonly TabulaSort[] {
	const raw = asArray(read(view, 'sorts'));
	if (raw === null) {
		return [];
	}
	const sorts: TabulaSort[] = [];
	for (const entry of raw) {
		if (!isRecord(entry)) {
			continue;
		}
		const fieldId = asString(read(entry, 'fieldId'));
		const direction = asString(read(entry, 'direction')) ?? 'asc';
		if (fieldId === null) {
			continue;
		}
		if (direction !== 'asc' && direction !== 'desc') {
			warnings.push({
				code: 'unknown-sort-direction',
				tableIndex,
				where: `${tableLabel} sort on “${fieldId}”`,
				message: `the sort direction “${direction}” is not one of asc/desc; it is reported as ascending`,
			});
		}
		sorts.push({ fieldId, direction });
	}
	return sorts;
}

function readFilters(view: Record<string, unknown>): TabulaFilterGroup {
	const raw = read(view, 'filters');
	if (!isRecord(raw)) {
		return { logic: 'and', conditions: [] };
	}
	const logic = asString(read(raw, 'logic')) ?? 'and';
	const conditionsRaw = asArray(read(raw, 'conditions'));
	const conditions: TabulaFilterCondition[] = [];
	if (conditionsRaw !== null) {
		for (const entry of conditionsRaw) {
			if (!isRecord(entry)) {
				continue;
			}
			const fieldId = asString(read(entry, 'fieldId'));
			const operator = asString(read(entry, 'operator'));
			if (fieldId === null || operator === null) {
				continue;
			}
			conditions.push({ fieldId, operator, value: readFilterValue(read(entry, 'value')) });
		}
	}
	return { logic, conditions };
}

function readView(table: Record<string, unknown>): TabulaView {
	const raw = read(table, 'view');
	const view = isRecord(raw) ? raw : {};
	const widthsRaw = read(view, 'columnWidths');
	const columnWidths: Record<string, number> = {};
	if (isRecord(widthsRaw)) {
		for (const key of Object.keys(widthsRaw)) {
			const width = asNumber(read(widthsRaw, key));
			if (width !== null) {
				columnWidths[key] = width;
			}
		}
	}
	const groupByRaw = read(view, 'groupBy');
	const groupBy = isRecord(groupByRaw) ? asString(read(groupByRaw, 'fieldId')) : null;
	const hiddenRaw = asArray(read(view, 'hiddenFieldIds'));
	const hiddenFieldIds: string[] = [];
	if (hiddenRaw !== null) {
		for (const entry of hiddenRaw) {
			const id = asString(entry);
			if (id !== null) {
				hiddenFieldIds.push(id);
			}
		}
	}
	return {
		sorts: [],
		filters: { logic: 'and', conditions: [] },
		search: asString(read(view, 'search')) ?? '',
		query: asString(read(view, 'query')) ?? '',
		hiddenFieldIds,
		groupBy,
		columnWidths,
		rowHeight: asString(read(view, 'rowHeight')) ?? 'medium',
		frozenPrimary: asBoolean(read(view, 'frozenPrimary')) ?? false,
	};
}

function readSync(table: Record<string, unknown>): TabulaSync | null {
	const raw = read(table, 'sync');
	if (!isRecord(raw)) {
		return null;
	}
	const baseId = asString(read(raw, 'baseId'));
	const tableId = asString(read(raw, 'tableId'));
	if (baseId === null || tableId === null) {
		return null;
	}
	const countKeys = (key: string): number => {
		const value = read(raw, key);
		return isRecord(value) ? Object.keys(value).length : 0;
	};
	return {
		baseId,
		tableId,
		baseName: asString(read(raw, 'baseName')),
		tableName: asString(read(raw, 'tableName')),
		mappedFields: countKeys('fieldMap'),
		mappedRecords: countKeys('recordMap'),
	};
}

/** One table, from its raw object. `label` is what warnings call it, so they read like the file does. */
function readTable(
	raw: Record<string, unknown>,
	tableId: string,
	label: string,
	tableIndex: number,
	warnings: TabulaWarning[],
): TabulaTable {
	// A v2 entry's id is on the **entry** (`{ id, table }`), not inside the table document; `readTables`
	// passes it in after reading it from the right place.
	const id = tableId;
	const name = asString(read(raw, 'name')) ?? label;
	const fields = readFields(raw, label, tableIndex, warnings);
	const viewRaw = read(raw, 'view');
	const view: TabulaView = isRecord(viewRaw)
		? {
				...readView(raw),
				sorts: readSorts(viewRaw, label, tableIndex, warnings),
				filters: readFilters(viewRaw),
			}
		: readView(raw);
	return {
		id,
		name,
		fields,
		rows: readRows(raw, fields, label, tableIndex, warnings),
		view,
		autoNumberNext: asNumber(read(raw, 'autoNumberNext')),
		sync: readSync(raw),
	};
}

/**
 * A v2 envelope: `{ version: 2, tables: [{ id, table }] }`.
 *
 * Returns a wrapped result rather than a union of "tables or a failure": a union would need a type
 * assertion to narrow, and assertions are banned here (`Array.isArray` does not narrow a `readonly` array).
 */
function readTables(
	value: unknown,
	path: string,
	warnings: TabulaWarning[],
):
	| { readonly ok: true; readonly tables: readonly TabulaTable[] }
	| { readonly ok: false; readonly result: TabulaResult } {
	const entries = asArray(value);
	if (entries === null) {
		return {
			ok: false,
			result: failure(path, 'the file says version 2 but has no tables array'),
		};
	}
	const tables: TabulaTable[] = [];
	const seen = new Set<string>();
	entries.forEach((entry, index) => {
		const label = `table ${String(index + 1)}`;
		if (!isRecord(entry)) {
			return;
		}
		const inner = read(entry, 'table');
		if (!isRecord(inner)) {
			// The fork wrote `{}` here, which became a convincing empty table. An entry with no table is
			// reported as such, with the id it claimed.
			const claimed = asString(read(entry, 'id'));
			warnings.push({
				code: 'skipped-table-entry',
				tableIndex: index,
				where: label,
				message: `table entry${claimed === null ? '' : ` “${claimed}”`} has no table object; it was skipped`,
			});
			return;
		}
		const entryId = asString(read(entry, 'id')) ?? `t_${String(index + 1)}`;
		const table = readTable(inner, entryId, label, index, warnings);
		if (seen.has(table.id)) {
			warnings.push({
				code: 'duplicate-table-id',
				tableIndex: index,
				where: label,
				message: `two tables claim the id “${table.id}”; the second keeps its own values under the same id`,
			});
		}
		seen.add(table.id);
		tables.push(table);
	});
	if (tables.length === 0) {
		return {
			ok: false,
			result: failure(path, 'the file has a tables array with no readable table in it'),
		};
	}
	return { ok: true, tables };
}

/**
 * Reads a `.tabula` file. `text` is the whole file, `path` is used for the error and for nothing else.
 */
export function parseTabulaFile(text: string, path: string): TabulaResult {
	// A BOM is what a Windows editor leaves behind, and `JSON.parse` rejects it. Stripped before anything
	// else looks at the text, so no downstream rule has to know about it.
	const withoutBom = text.replace(/^\uFEFF/u, '');
	if (withoutBom.trim() === '') {
		return failure(path, 'the file is empty', {
			at: { line: 1, column: 1, excerpt: '' },
		});
	}
	const json = parseJson(withoutBom, path);
	if (!json.ok) {
		return json.result;
	}
	const root = json.value;
	if (!isRecord(root)) {
		return failure(path, 'the file does not contain a table document', {
			at: locate(withoutBom, 0),
		});
	}
	const warnings: TabulaWarning[] = [];
	const versionRaw = asNumber(read(root, 'version'));
	const tablesRaw = read(root, 'tables');
	if (versionRaw !== null && versionRaw > 2) {
		return failure(
			path,
			`the file was written by a newer version of the format (version ${String(versionRaw)}); this reader understands version 1 and 2`,
			{
				at:
					locateNeedle(withoutBom, `"version": ${String(versionRaw)}`) ??
					locate(withoutBom, 0),
			},
		);
	}
	const isEnvelope =
		versionRaw === 2 || (tablesRaw !== undefined && read(root, 'fields') === undefined);
	if (versionRaw === null) {
		warnings.push({
			code: 'missing-version',
			where: 'the document',
			message: `the file has no version field; it was read as version ${isEnvelope ? '2' : '1'} from its shape`,
		});
	}
	if (isEnvelope) {
		const envelope = readTables(tablesRaw, path, warnings);
		if (!envelope.ok) {
			return envelope.result;
		}
		const doc: TabulaDoc = { path, version: 2, tables: envelope.tables, warnings };
		return { ok: true, doc };
	}
	if (read(root, 'fields') === undefined && read(root, 'rows') === undefined) {
		return failure(path, 'the file has neither a fields/rows pair nor a tables array', {
			at: locate(withoutBom, 0),
		});
	}
	// A v1 document has no table id of its own — the file *is* the table — so the report's id is stable and
	// synthesised, never invented from the file name.
	const table = readTable(root, 't_1', 'table 1', 0, warnings);
	const doc: TabulaDoc = { path, version: 1, tables: [table], warnings };
	return { ok: true, doc };
}
