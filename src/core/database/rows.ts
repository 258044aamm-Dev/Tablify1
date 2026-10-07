/**
 * Rows — R1 step 5, first half: identity, cells, and the row's own timestamps.
 *
 * Three decisions are visible in this file, and each one exists because the alternative loses
 * something:
 *
 *   1. **The `rows` array's document order is the manual order** (ADR-0003, amended). There is no
 *      second list of ids beside it; reordering rows is reordering this array, and nothing here
 *      depends on object-key order — a row is a document element with a position, not a map entry.
 *   2. **"No value" has one representation: the absence of a cell entry.** An explicit `null` in
 *      the file reads as absence (ADR-0004 §1), and is *not* stored as a null entry, so the model
 *      cannot hold two spellings of "empty" that would compare unequal to themselves.
 *   3. **Every cell keeps its own provenance.** A value the field cannot represent is stored as its
 *      preserved raw JSON with a reason and warns once; a cell whose field id this table does not
 *      have is preserved too, and is never deleted just because this build cannot place it.
 *
 * The row's `createdAt`/`updatedAt` are the row's own — never the database file's mtime — because
 * two rows of one file were not created at the same instant, and a `createdTime` column that claims
 * they were is a wrong answer, not a missing one (ADR-0004 §5).
 */
import { hasOffset, instantOf } from '../format/iso';
import type { TableField } from './fields';
import { isIdOfKind } from './ids';
import type { JsonValue, UnknownEntry } from './json';
import { describeJson, isJsonArray, isJsonObject, toCanonicalObject, unknownEntries } from './json';
import type { LoadError, LoadWarning } from './result';
import type { CanonicalCell, InvalidCell } from './values';
import { decodeCell, encodeCell, invalidCell, isInvalidCell } from './values';

/** One cell as the model holds it: a canonical value, or the preserved invalid one. */
export type CellState = CanonicalCell | InvalidCell;

/** One row: identity, its cells by field id, its own timestamps, and preserved unknown keys. */
export interface TableRow {
	readonly id: string;
	readonly cells: ReadonlyMap<string, CellState>;
	readonly createdAt: string | null;
	readonly updatedAt: string | null;
	readonly unknown: readonly UnknownEntry[];
}

/** The keys a row object owns. Everything else is preserved as unknown. */
const ROW_KEYS: readonly string[] = ['id', 'cells', 'createdAt', 'updatedAt'];

/** Read a timestamp: an instant that carries its own offset, or null for absent. */
function readTimestamp(
	value: JsonValue | undefined,
	path: string,
	errors: LoadError[],
): string | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value === 'string' && hasOffset(value) && instantOf(value) !== undefined) {
		return value;
	}
	errors.push({
		code: 'invalid-row-timestamp',
		message: `A row timestamp must be an instant with its own offset, not ${describeJson(value)}.`,
		path,
	});
	return null;
}

/** Read one row's `cells` map. `byId` is the table's field lookup, built once per table. */
function readCells(
	value: JsonValue | undefined,
	path: string,
	byId: ReadonlyMap<string, TableField>,
	errors: LoadError[],
	warnings: LoadWarning[],
): ReadonlyMap<string, CellState> {
	const cells = new Map<string, CellState>();
	if (value === undefined) {
		return cells;
	}
	if (!isJsonObject(value)) {
		errors.push({
			code: 'invalid-cells',
			message: `The cells of a row must be a JSON object, not ${describeJson(value)}.`,
			path,
		});
		return cells;
	}
	for (const [fieldId, raw] of Object.entries(value)) {
		const cellPath = `${path}.${fieldId}`;
		const field = byId.get(fieldId);
		if (field === undefined) {
			warnings.push({
				code: 'unknown-cell-field',
				message: `No field in this table has the id "${fieldId}"; the cell is preserved exactly as it is.`,
				path: cellPath,
			});
			cells.set(fieldId, invalidCell(raw, 'no field in this table has this id'));
			continue;
		}
		if (field.kind === 'unsupported') {
			// The field-level `unsupported-field-type` warning already named this column; the value
			// needs no second warning, only preservation.
			cells.set(
				fieldId,
				invalidCell(raw, 'the field type this cell belongs to is not read by this build'),
			);
			continue;
		}
		const decoded = decodeCell(field.type, raw);
		if (decoded.kind === 'value') {
			if (decoded.value !== null) {
				cells.set(fieldId, decoded.value);
			}
			continue;
		}
		warnings.push({
			code: 'invalid-cell-value',
			message: `The value in "${field.name}" is kept exactly as it is: ${decoded.value.reason}.`,
			path: cellPath,
		});
		cells.set(fieldId, decoded.value);
	}
	return cells;
}

/**
 * Read a table's rows, in document order — which *is* the manual order (ADR-0003).
 *
 * Row ids must be shaped like `row_…` and unique within the table; a repeat is refused at its second
 * occurrence with both positions named, exactly like duplicate table and field ids.
 */
export function readRows(
	source: JsonValue | undefined,
	path: string,
	fields: readonly TableField[],
	errors: LoadError[],
	warnings: LoadWarning[],
): readonly TableRow[] {
	if (source === undefined) {
		errors.push({
			code: 'missing-rows',
			message: 'Every table needs a rows list, even when it is empty.',
			path,
		});
		return [];
	}
	if (!isJsonArray(source)) {
		errors.push({
			code: 'invalid-rows',
			message: `The rows list must be an array, not ${describeJson(source)}.`,
			path,
		});
		return [];
	}

	const byId = new Map<string, TableField>();
	for (const field of fields) {
		if (field.id !== null) {
			byId.set(field.id, field);
		}
	}

	const rows: TableRow[] = [];
	const firstIndexById = new Map<string, number>();
	source.forEach((item, index) => {
		const rowPath = `${path}[${index}]`;
		if (!isJsonObject(item)) {
			errors.push({
				code: 'invalid-row',
				message: `Every row must be a JSON object, not ${describeJson(item)}.`,
				path: rowPath,
			});
			return;
		}
		const id = item['id'];
		if (typeof id !== 'string' || !isIdOfKind('row', id)) {
			errors.push({
				code: 'invalid-row-id',
				message:
					'Every row needs an id shaped like row_ followed by lowercase letters and digits.',
				path: `${rowPath}.id`,
			});
			return;
		}
		const first = firstIndexById.get(id);
		if (first !== undefined) {
			errors.push({
				code: 'duplicate-row-id',
				message: `The row id "${id}" is used by both rows[${first}] and rows[${index}].`,
				path: rowPath,
			});
			return;
		}
		firstIndexById.set(id, index);

		const cells = readCells(item['cells'], `${rowPath}.cells`, byId, errors, warnings);
		const createdAt = readTimestamp(item['createdAt'], `${rowPath}.createdAt`, errors);
		const updatedAt = readTimestamp(item['updatedAt'], `${rowPath}.updatedAt`, errors);
		rows.push({
			id,
			cells,
			createdAt,
			updatedAt,
			unknown: unknownEntries(item, ROW_KEYS),
		});
	});
	return rows;
}

/**
 * Write one row back.
 *
 * Cells are written in **field order** first — a readable diff follows the schema — and any cell
 * whose field this table does not have follows in the order the map holds it. No-value cells are
 * omitted (ADR-0004 §1); a preserved invalid value writes its raw JSON back unchanged.
 */
export function serializeRow(row: TableRow, fields: readonly TableField[]): JsonValue {
	const byId = new Map<string, TableField>();
	for (const field of fields) {
		if (field.id !== null) {
			byId.set(field.id, field);
		}
	}

	const entries: (readonly [string, JsonValue | undefined])[] = [];
	const pushCell = (key: string, cell: CellState): void => {
		if (isInvalidCell(cell)) {
			entries.push([key, cell.raw]);
			return;
		}
		const field = byId.get(key);
		if (field === undefined || field.kind === 'unsupported') {
			// Unreachable for a model this reader produced (such cells are InvalidCells); writing the
			// canonical value anyway is the non-lossy fallback if a caller assembles a row by hand.
			entries.push([key, cell]);
			return;
		}
		const encoded = encodeCell(field.type, cell);
		if (encoded.kind === 'write') {
			entries.push([key, encoded.json]);
		} else if (encoded.kind === 'unwritable') {
			entries.push([key, cell]);
		}
	};

	for (const field of fields) {
		if (field.id === null) {
			continue;
		}
		const cell = row.cells.get(field.id);
		if (cell !== undefined) {
			pushCell(field.id, cell);
		}
	}
	for (const [key, cell] of row.cells) {
		if (!byId.has(key)) {
			pushCell(key, cell);
		}
	}

	const cells = entries.length === 0 ? undefined : toCanonicalObject(entries, []);
	return toCanonicalObject(
		[
			['id', row.id],
			['createdAt', row.createdAt ?? undefined],
			['updatedAt', row.updatedAt ?? undefined],
			['cells', cells],
		],
		row.unknown,
	);
}
