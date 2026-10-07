/**
 * The envelope reader and writer — R1 step 1.
 *
 * `readDocument` validates the top of a `.tablify` file: the literal format tag, the document
 * schema version, the database identity and name, and the table list (each table's id and name at
 * this step). It collects **every** problem it can see rather than stopping at the first, because
 * the repair screen shows a list and a list of one is not a diagnosis.
 *
 * The rules that outrank convenience here:
 *
 *   - a file with a newer `version` is refused with the version named — never migrated down, never
 *     rewritten (R1 step 8's posture, enforced from the first reader onward);
 *   - unknown keys survive; they are collected as {@link UnknownEntry}s on their object and
 *     re-emitted by {@link serializeDocument} after the keys this version owns;
 *   - nothing in this module throws for bad input. `parseDocument` turns unparseable text into the
 *     same `{ ok: false }` shape as a structurally invalid document, with the raw text left where
 *     it was — the caller still owns the bytes (R1 step 7).
 */
import type { JsonObject, JsonValue } from './json';
import {
	describeJson,
	isJsonArray,
	isJsonObject,
	parseJsonText,
	stringifyJson,
	toCanonicalObject,
	unknownEntries,
} from './json';
import { isIdOfKind } from './ids';
import { readFields, serializeField } from './fields';
import { readRows, serializeRow } from './rows';
import { readViews, serializeView } from './views';
import type { DocumentLoad, LoadError, LoadWarning } from './result';
import type { DatabaseDocument, DatabaseTable } from './schema';
import { FORMAT_TAG, SUPPORTED_DOCUMENT_VERSIONS } from './schema';

/** The keys the envelope owns. Everything else at the root is preserved as unknown. */
const DOCUMENT_KEYS: readonly string[] = ['format', 'version', 'databaseId', 'name', 'tables'];

/** The keys a table owns. Everything else on a table is preserved as unknown. */
const TABLE_KEYS: readonly string[] = ['id', 'name', 'fields', 'rows', 'views'];

/** What a string field of an object turned out to be. `absent` and `wrong` need different errors. */
type StringField =
	| { readonly kind: 'string'; readonly value: string }
	| { readonly kind: 'absent' }
	| { readonly kind: 'wrong'; readonly described: string };

function stringField(record: JsonObject, key: string): StringField {
	const value = record[key];
	if (value === undefined) {
		return { kind: 'absent' };
	}
	if (typeof value !== 'string') {
		return { kind: 'wrong', described: describeJson(value) };
	}
	return { kind: 'string', value };
}

/** Read one table object. `path` is the table's full JSONPath, for every error it produces. */
function readTable(
	value: JsonObject,
	path: string,
	errors: LoadError[],
	warnings: LoadWarning[],
): DatabaseTable | undefined {
	let failed = false;
	const id = stringField(value, 'id');
	if (id.kind === 'absent') {
		errors.push({
			code: 'missing-table-id',
			message: 'Every table needs an id.',
			path: `${path}.id`,
		});
		failed = true;
	} else if (id.kind === 'wrong') {
		errors.push({
			code: 'invalid-table-id',
			message: `The table id must be a non-empty string, not ${id.described}.`,
			path: `${path}.id`,
		});
		failed = true;
	} else if (id.value.trim() === '') {
		errors.push({
			code: 'invalid-table-id',
			message: 'The table id must be a non-empty string.',
			path: `${path}.id`,
		});
		failed = true;
	} else if (!isIdOfKind('table', id.value)) {
		errors.push({
			code: 'malformed-table-id',
			message: `The table id must be shaped like tbl_ followed by lowercase letters and digits, and "${id.value}" is not.`,
			path: `${path}.id`,
		});
		failed = true;
	}

	const name = stringField(value, 'name');
	if (name.kind === 'absent') {
		errors.push({
			code: 'missing-table-name',
			message: 'Every table needs a name.',
			path: `${path}.name`,
		});
		failed = true;
	} else if (name.kind === 'wrong') {
		errors.push({
			code: 'invalid-table-name',
			message: `The table name must be a non-empty string, not ${name.described}.`,
			path: `${path}.name`,
		});
		failed = true;
	} else if (name.value.trim() === '') {
		errors.push({
			code: 'invalid-table-name',
			message: 'The table name must be a non-empty string.',
			path: `${path}.name`,
		});
		failed = true;
	}

	if (failed || id.kind !== 'string' || name.kind !== 'string') {
		return undefined;
	}
	const fields = readFields(value['fields'], `${path}.fields`, errors, warnings);
	const rows = readRows(value['rows'], `${path}.rows`, fields, errors, warnings);
	const views = readViews(value['views'], `${path}.views`, fields, errors, warnings);
	return {
		id: id.value,
		name: name.value,
		fields,
		rows,
		views,
		unknown: unknownEntries(value, TABLE_KEYS),
	};
}

/**
 * Validate an already-parsed JSON value as a document envelope.
 *
 * Returns `{ ok: true }` with the model and any warnings, or `{ ok: false }` with every error found.
 * The refused branch never carries a half-built document: a document that cannot be trusted is not
 * handed out in pieces.
 */
export function readDocument(value: JsonValue): DocumentLoad {
	if (!isJsonObject(value)) {
		return {
			ok: false,
			errors: [
				{
					code: 'invalid-document',
					message: `A .tablify document must be a JSON object, not ${describeJson(value)}.`,
					path: '$',
				},
			],
			rawTextPreserved: true,
		};
	}

	const errors: LoadError[] = [];
	const warnings: LoadWarning[] = [];

	const format = value['format'];
	if (format === undefined) {
		errors.push({
			code: 'missing-format',
			message: `The document has no format tag. A .tablify document starts with "format": "${FORMAT_TAG}".`,
			path: '$.format',
		});
	} else if (format !== FORMAT_TAG) {
		errors.push({
			code: 'invalid-format',
			message: `The format tag must be "${FORMAT_TAG}", not ${describeJson(format)}.`,
			path: '$.format',
		});
	}

	const version = value['version'];
	if (version === undefined) {
		errors.push({
			code: 'missing-version',
			message: 'The document has no version.',
			path: '$.version',
		});
	} else if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
		errors.push({
			code: 'invalid-version',
			message: `The version must be a whole number of 1 or greater, not ${describeJson(version)}.`,
			path: '$.version',
		});
	} else if (!SUPPORTED_DOCUMENT_VERSIONS.includes(version)) {
		errors.push({
			code: 'unsupported-version',
			message: `This file uses .tablify format version ${version}, and this build reads version ${SUPPORTED_DOCUMENT_VERSIONS.join(', ')}. The file is not opened for writing and is never migrated down.`,
			path: '$.version',
		});
	}

	const databaseId = stringField(value, 'databaseId');
	if (databaseId.kind === 'absent') {
		errors.push({
			code: 'missing-database-id',
			message: 'The document has no databaseId. Identity is never derived from a path.',
			path: '$.databaseId',
		});
	} else if (databaseId.kind === 'wrong') {
		errors.push({
			code: 'invalid-database-id',
			message: `The databaseId must be a non-empty string, not ${databaseId.described}.`,
			path: '$.databaseId',
		});
	} else if (databaseId.value.trim() === '') {
		errors.push({
			code: 'invalid-database-id',
			message: 'The databaseId must be a non-empty string.',
			path: '$.databaseId',
		});
	} else if (!isIdOfKind('database', databaseId.value)) {
		errors.push({
			code: 'malformed-database-id',
			message: `The databaseId must be shaped like db_ followed by lowercase letters and digits, and "${databaseId.value}" is not.`,
			path: '$.databaseId',
		});
	}

	const name = stringField(value, 'name');
	if (name.kind === 'absent') {
		errors.push({
			code: 'missing-name',
			message: 'The document has no name.',
			path: '$.name',
		});
	} else if (name.kind === 'wrong') {
		errors.push({
			code: 'invalid-name',
			message: `The database name must be a non-empty string, not ${name.described}.`,
			path: '$.name',
		});
	} else if (name.value.trim() === '') {
		errors.push({
			code: 'invalid-name',
			message: 'The database name must be a non-empty string.',
			path: '$.name',
		});
	}

	const tablesValue = value['tables'];
	const tables: DatabaseTable[] = [];
	if (tablesValue === undefined) {
		errors.push({
			code: 'missing-tables',
			message: 'The document has no tables list. An empty database carries an empty list.',
			path: '$.tables',
		});
	} else if (!isJsonArray(tablesValue)) {
		errors.push({
			code: 'invalid-tables',
			message: `The tables list must be an array, not ${describeJson(tablesValue)}.`,
			path: '$.tables',
		});
	} else {
		// Duplicate ids are a document-level property: the table that repeats is reported at its
		// second occurrence, naming both positions, so the fix is obvious from the message alone.
		const firstIndexById = new Map<string, number>();
		tablesValue.forEach((item, index) => {
			const path = `$.tables[${index}]`;
			if (!isJsonObject(item)) {
				errors.push({
					code: 'invalid-table',
					message: `Every table must be a JSON object, not ${describeJson(item)}.`,
					path,
				});
				return;
			}
			const itemId = item['id'];
			if (typeof itemId === 'string' && itemId !== '') {
				const firstIndex = firstIndexById.get(itemId);
				if (firstIndex === undefined) {
					firstIndexById.set(itemId, index);
				} else {
					errors.push({
						code: 'duplicate-table-id',
						message: `The table id "${itemId}" is used by both tables[${firstIndex}] and tables[${index}].`,
						path,
					});
				}
			}
			const table = readTable(item, path, errors, warnings);
			if (table !== undefined) {
				tables.push(table);
			}
		});
	}

	if (
		errors.length > 0 ||
		format !== FORMAT_TAG ||
		typeof version !== 'number' ||
		databaseId.kind !== 'string' ||
		name.kind !== 'string'
	) {
		return { ok: false, errors, rawTextPreserved: true };
	}

	const document: DatabaseDocument = {
		format: FORMAT_TAG,
		version,
		databaseId: databaseId.value,
		name: name.value,
		tables,
		unknown: unknownEntries(value, DOCUMENT_KEYS),
	};
	return { ok: true, document, warnings };
}

/** Parse raw file text as a document. Unparseable text is an `invalid-json` refusal, not a throw. */
export function parseDocument(text: string): DocumentLoad {
	const parsed = parseJsonText(text);
	if (!parsed.ok) {
		return {
			ok: false,
			errors: [
				{
					code: 'invalid-json',
					message: `The file text is not valid JSON: ${parsed.error}`,
					path: '$',
				},
			],
			rawTextPreserved: true,
		};
	}
	return readDocument(parsed.value);
}

/**
 * Write a document back to text.
 *
 * Key order is a contract for the keys this version owns: `format`, `version`, `databaseId`,
 * `name`, `tables`, then the preserved unknown keys. Two-space indent, trailing newline — a file
 * whose diff is readable is a file whose changes can be reviewed.
 */
export function serializeDocument(document: DatabaseDocument): string {
	const tables: JsonValue = document.tables.map((table): JsonValue => {
		const fieldIds: string[] = [];
		for (const field of table.fields) {
			if (field.id !== null) {
				fieldIds.push(field.id);
			}
		}
		return toCanonicalObject(
			[
				['id', table.id],
				['name', table.name],
				['fields', table.fields.map((field) => serializeField(field))],
				['rows', table.rows.map((row) => serializeRow(row, table.fields))],
				['views', table.views.map((view) => serializeView(view, fieldIds))],
			],
			table.unknown,
		);
	});
	return stringifyJson(
		toCanonicalObject(
			[
				['format', document.format],
				['version', document.version],
				['databaseId', document.databaseId],
				['name', document.name],
				['tables', tables],
			],
			document.unknown,
		),
	);
}
