/**
 * Parser/validator/serializer result types — R1 step 7's gate.
 *
 * The guide's step 7 asks for three properties, and this file proves each with the shape of the
 * result rather than with prose:
 *
 *   1. **Successful load, warnings and fatal errors are three different things.** A refusal is
 *      `{ ok: false, errors, rawTextPreserved }` and never carries a document; a load is
 *      `{ ok: true, document, warnings }` and never carries errors. Nothing in between exists.
 *   2. **Ordinary bad input is never an exception.** Every prefix of a valid document and a list
 *      of hostile inputs all come back as a `DocumentLoad`; a refusal always says what was wrong
 *      (`code`, `message`, `path`) in a shape a repair screen can render.
 *   3. **The raw text is the caller's, and the parser touches nothing it was given.** A refusal
 *      says `rawTextPreserved: true`; `readDocument` leaves the value it was handed byte-for-byte
 *      unchanged, so a host can keep the original text and offer repair/export without this core
 *      ever overwriting it.
 *
 * The last tests walk the "required validation" list of step 7 and assert each item is live, so
 * the list cannot rot into documentation: every category has a real code, and every document that
 * loads can be written back and read again.
 */
import { describe, expect, it } from 'vitest';

import {
	parseDocument,
	parseJsonText,
	readDocument,
	serializeDocument,
	toJsonValue,
} from '../../src/core/database/index';
import type { DocumentLoad, JsonValue } from '../../src/core/database/index';

const DATABASE_ID = 'db_' + 'z'.repeat(26);
const TABLE_ID = 'tbl_' + 'z'.repeat(26);
const T_OTHER = 'tbl_' + 'y'.repeat(26);
const F_TITLE = 'fld_' + 'a'.repeat(26);
const F_GHOST = 'fld_' + 'q'.repeat(26);
const T_GHOST = 'tbl_' + 'q'.repeat(26);
const R_A = 'row_' + 'a'.repeat(26);
const V_ALL = 'viw_' + 'a'.repeat(26);

/** A minimal but complete document. */
function validText(): string {
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: DATABASE_ID,
		name: 'Test',
		tables: [
			{
				id: TABLE_ID,
				name: 'Tasks',
				fields: [{ id: F_TITLE, name: 'Title', type: 'text' }],
				rows: [{ id: 'row_' + 'a'.repeat(26), cells: { [F_TITLE]: 'First' } }],
				views: [{ id: V_ALL, name: 'All' }],
			},
		],
	});
}

/** A document that loads with warnings: an unknown field type and a view naming a missing field. */
function warningText(): string {
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: DATABASE_ID,
		name: 'Test',
		tables: [
			{
				id: TABLE_ID,
				name: 'Tasks',
				fields: [{ id: F_TITLE, name: 'Summary', type: 'aiSummary' }],
				rows: [{ id: 'row_' + 'a'.repeat(26), cells: { [F_TITLE]: { model: 'x' } } }],
				views: [
					{ id: V_ALL, name: 'All', sorts: [{ fieldId: F_GHOST, direction: 'asc' }] },
				],
			},
		],
	});
}

/** One table, spliced into a legal envelope. */
function documentOfTables(tables: JsonValue): string {
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: DATABASE_ID,
		name: 'Test',
		tables,
	});
}

function warningCodes(text: string): readonly string[] {
	const result = parseDocument(text);
	if (!result.ok) {
		throw new Error(
			`expected a load; got ${result.errors.map((error) => error.code).join(', ')}`,
		);
	}
	return result.warnings.map((warning) => warning.code);
}

function errorCodes(text: string): readonly string[] {
	const result = parseDocument(text);
	if (result.ok) {
		throw new Error('the test expected a refusal, and the document parsed');
	}
	return result.errors.map((error) => error.code);
}

/** The shape every result must have, whichever branch it takes. */
function assertResultShape(result: DocumentLoad): void {
	if (result.ok) {
		expect(result.document.format).toBe('tablify');
		expect(Number.isInteger(result.document.version)).toBe(true);
		expect(Object.keys(result)).toEqual(['ok', 'document', 'warnings']);
		return;
	}
	expect(result.rawTextPreserved).toBe(true);
	expect(result.errors.length).toBeGreaterThan(0);
	for (const error of result.errors) {
		expect(error.code.length).toBeGreaterThan(0);
		expect(error.message.length).toBeGreaterThan(0);
		expect(error.path.startsWith('$')).toBe(true);
	}
}

describe('ordinary bad input is a value, not an exception', () => {
	it('answers every prefix of a valid document with a result', () => {
		const text = validText();
		for (let end = 0; end <= text.length; end += 1) {
			assertResultShape(parseDocument(text.slice(0, end)));
		}
		expect(parseDocument(text).ok).toBe(true);
	});

	it('refuses every hostile input, and every refusal keeps the text and explains itself', () => {
		const hostile: readonly string[] = [
			'',
			'   \n\t ',
			'{',
			'{"format":',
			'{"format":"tablify",',
			'not json at all',
			'null',
			'true',
			'42',
			'"a string"',
			'[]',
			'[[]]',
			'{"a":NaN}',
			'{"a":Infinity}',
			'\uFEFF{"format":"tablify"}',
			'{"format":"tablify","version":1}',
			'{"format":"tablify","version":"1","databaseId":1,"name":null,"tables":{}}',
			'{"format":"base","version":2,"databaseId":"x","name":"y","tables":[]}',
			documentOfTables('none'),
			documentOfTables([[]]),
		];
		for (const input of hostile) {
			const result = parseDocument(input);
			expect(result.ok).toBe(false);
			assertResultShape(result);
		}
	});

	it('keeps the two branches apart', () => {
		const loaded = parseDocument(validText());
		expect(loaded.ok).toBe(true);
		assertResultShape(loaded);
		const refused = parseDocument('{}');
		expect(refused.ok).toBe(false);
		assertResultShape(refused);
	});
});

describe('warnings are shaped for the same screen as errors', () => {
	it('gives every warning a code, a message and a path', () => {
		const result = parseDocument(warningText());
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.warnings.map((warning) => warning.code)).toEqual([
			'unsupported-field-type',
			'view-unknown-field',
		]);
		for (const warning of result.warnings) {
			expect(warning.code.length).toBeGreaterThan(0);
			expect(warning.message.length).toBeGreaterThan(0);
			expect(warning.path.startsWith('$')).toBe(true);
		}
	});
});

describe("the raw text stays the caller's", () => {
	it('reads a value without mutating it, on both branches', () => {
		const parsed = parseJsonText(validText());
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) {
			return;
		}
		const snapshot = JSON.stringify(parsed.value);
		expect(readDocument(parsed.value).ok).toBe(true);
		expect(JSON.stringify(parsed.value)).toBe(snapshot);

		const refusing = parseJsonText('{"format":"tablify","version":1}');
		expect(refusing.ok).toBe(true);
		if (!refusing.ok) {
			return;
		}
		const before = JSON.stringify(refusing.value);
		expect(readDocument(refusing.value).ok).toBe(false);
		expect(JSON.stringify(refusing.value)).toBe(before);
	});
});

describe('the step-7 required validation list is live', () => {
	it('covers syntax, format, version, ids, options and non-finite numbers', () => {
		expect(errorCodes('{')).toContain('invalid-json');
		expect(
			errorCodes(
				JSON.stringify({
					format: 'x',
					version: 1,
					databaseId: DATABASE_ID,
					name: 'N',
					tables: [],
				}),
			),
		).toContain('invalid-format');
		expect(
			errorCodes(
				JSON.stringify({
					format: 'tablify',
					version: 9,
					databaseId: DATABASE_ID,
					name: 'N',
					tables: [],
				}),
			),
		).toContain('unsupported-version');
		expect(
			errorCodes(
				JSON.stringify({
					format: 'tablify',
					version: 1,
					databaseId: DATABASE_ID,
					name: 'N',
					tables: [{ id: '', name: 'T', fields: [], rows: [], views: [] }],
				}),
			),
		).toContain('invalid-table-id');
		expect(
			errorCodes(
				JSON.stringify({
					format: 'tablify',
					version: 1,
					databaseId: DATABASE_ID,
					name: 'N',
					tables: [
						{ id: TABLE_ID, name: 'T', fields: [], rows: [], views: [] },
						{ id: TABLE_ID, name: 'T', fields: [], rows: [], views: [] },
					],
				}),
			),
		).toContain('duplicate-table-id');
		expect(
			errorCodes(
				documentOfTables([
					{
						id: TABLE_ID,
						name: 'T',
						fields: [
							{
								id: F_TITLE,
								name: 'S',
								type: 'singleSelect',
								options: [{ id: 'Planned', name: 'P' }],
							},
						],
						rows: [],
						views: [],
					},
				]),
			),
		).toContain('invalid-option-id');
		expect(toJsonValue(Number.POSITIVE_INFINITY)).toBeUndefined();
		expect(toJsonValue(Number.NaN)).toBeUndefined();
	});

	it('covers the reference checks: unknown type, broken target, wrong table, missing view field', () => {
		expect(warningCodes(warningText())).toContain('unsupported-field-type');
		expect(
			warningCodes(
				documentOfTables([
					{
						id: TABLE_ID,
						name: 'Tasks',
						fields: [
							{ id: F_TITLE, name: 'Client', type: 'link', targetTableId: T_GHOST },
							{ id: F_GHOST, name: 'Also', type: 'link', targetTableId: T_OTHER },
						],
						rows: [],
						views: [],
					},
				]),
			),
		).toContain('unknown-link-target-table');
		expect(
			warningCodes(
				documentOfTables([
					{
						id: TABLE_ID,
						name: 'Tasks',
						fields: [
							{ id: F_TITLE, name: 'Client', type: 'link', targetTableId: T_OTHER },
						],
						rows: [{ id: R_A, cells: { [F_TITLE]: R_A } }],
						views: [],
					},
					{
						id: T_OTHER,
						name: 'Clients',
						fields: [],
						rows: [{ id: 'row_' + 'c'.repeat(26) }],
						views: [],
					},
				]),
			),
		).toContain('unresolved-link');
		expect(warningCodes(warningText())).toContain('view-unknown-field');
	});
});

describe('every document that loaded can be written back and read again', () => {
	it('serializes the valid and the warning documents, stably', () => {
		for (const text of [validText(), warningText()]) {
			const result = parseDocument(text);
			expect(result.ok).toBe(true);
			if (!result.ok) {
				continue;
			}
			const once = serializeDocument(result.document);
			const again = parseDocument(once);
			expect(again.ok).toBe(true);
			if (again.ok) {
				expect(serializeDocument(again.document)).toBe(once);
			}
		}
	});
});
