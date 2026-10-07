/**
 * The envelope reader and writer — R1 step 1's gate.
 *
 * Three kinds of assertion live here:
 *
 * 1. **Acceptance** against the first two committed fixtures (`minimal`, `unknown-v1-key`), with the
 *    unknown-key fixture doing double duty: it proves the round trip preserves keys this version
 *    does not read, *including* `fields`/`rows` inside a table — which steps 4–5 will start reading
 *    and whose fixtures then move from `unknown` to parsed structure. The case is written so that
 *    move is a visible test edit, not a silent pass.
 * 2. **The refusal matrix**: every way the envelope can be wrong, one case each, asserting the code
 *    and the JSONPath. The messages themselves are asserted only by substring where the wording is
 *    part of the contract a person sees.
 * 3. **A generator property** (mulberry32, seeded, like `ops-inverse.property.test.ts`): serialize →
 *    parse → serialize is the identity for 200 generated documents, which is the reproducible form
 *    of "the round trip loses nothing".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseDocument, serializeDocument } from '../../src/core/database/envelope';
import type { JsonValue, LoadError } from '../../src/core/database/index';
import type { DatabaseDocument, DatabaseTable } from '../../src/core/database/schema';
import { FORMAT_TAG } from '../../src/core/database/schema';

const DIRECTORY = new URL('../fixtures/tablify/', import.meta.url);

function textOf(name: string): string {
	return readFileSync(new URL(`${name}.tablify`, DIRECTORY), 'utf8');
}

function documentOf(name: string): DatabaseDocument {
	const result = parseDocument(textOf(name));
	if (!result.ok) {
		throw new Error(
			`fixture ${name}.tablify did not parse: ${result.errors
				.map((error) => `${error.code} at ${error.path}`)
				.join(', ')}`,
		);
	}
	return result.document;
}

/** Parse text that is expected to be refused, and hand back the errors. */
function errorsOf(text: string): readonly LoadError[] {
	const result = parseDocument(text);
	if (result.ok) {
		throw new Error('the test expected a refusal, and the text parsed');
	}
	return result.errors;
}

function codesOf(text: string): readonly string[] {
	return errorsOf(text).map((error) => error.code);
}

/** A minimal but complete envelope, as text, with `extra` spliced in at a chosen depth. */
function envelopeText(overrides: Record<string, JsonValue> = {}): string {
	const base: Record<string, JsonValue> = {
		format: FORMAT_TAG,
		version: 1,
		databaseId: 'db_test0000000000000000000',
		name: 'Test',
		tables: [],
	};
	return JSON.stringify({ ...base, ...overrides });
}

describe('the committed fixtures', () => {
	it('loads the smallest database', () => {
		const document = documentOf('minimal');
		expect(document.format).toBe(FORMAT_TAG);
		expect(document.version).toBe(1);
		expect(document.databaseId).toBe('db_01h8x3kq7vbody0pve4z9m2r4t');
		expect(document.name).toBe('Notes');
		expect(document.tables).toEqual([]);
		expect(document.unknown).toEqual([]);
	});

	it('loads a document with unknown keys and reports no warnings', () => {
		const result = parseDocument(textOf('unknown-v1-key'));
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.warnings).toEqual([]);
		expect(result.document.tables.map((table) => table.id)).toEqual([
			'tbl_01h8x3kq7vbody0pve4z9m2r4u',
			'tbl_01h8x3kq7vbody0pve4z9m2r4v',
		]);
	});

	it('keeps root unknown keys, in document order, with their values', () => {
		const document = documentOf('unknown-v1-key');
		expect(document.unknown).toEqual([{ key: 'sidebar', value: { collapsed: false } }]);
	});

	it('keeps table unknown keys — including fields and rows, which later steps will claim', () => {
		const document = documentOf('unknown-v1-key');
		const tasks = document.tables[0];
		expect(tasks?.unknown).toEqual([
			{ key: 'color', value: 'blue' },
			{ key: 'fields', value: [] },
			{ key: 'rows', value: [] },
		]);
		const projects = document.tables[1];
		expect(projects?.unknown).toEqual([
			{ key: 'fields', value: [] },
			{ key: 'rows', value: [] },
		]);
	});
});

describe('round trip', () => {
	it('serializes known keys in the contract order, unknown keys after them', () => {
		const text = serializeDocument(documentOf('unknown-v1-key'));
		const order = [
			'"format"',
			'"version"',
			'"databaseId"',
			'"name"',
			'"tables"',
			'"sidebar"',
		].map((key) => text.indexOf(key));
		expect(order.every((index) => index > -1)).toBe(true);
		expect(order).toEqual([...order].sort((a, b) => a - b));
	});

	it('serializes a table as id, name, then its unknown keys', () => {
		const text = serializeDocument(documentOf('unknown-v1-key'));
		// Slice from the `{` that opens the table holding "Tasks", so the root document's own keys
		// cannot be mistaken for the table's.
		const tableStart = text.lastIndexOf('{', text.indexOf('"Tasks"'));
		const table = text.slice(tableStart, text.indexOf('"tbl_01h8x3kq7vbody0pve4z9m2r4v"'));
		const idIndex = table.indexOf('"id"');
		const nameIndex = table.indexOf('"name"');
		const colorIndex = table.indexOf('"color"');
		const fieldsIndex = table.indexOf('"fields"');
		expect(idIndex).toBeGreaterThan(-1);
		expect(idIndex).toBeLessThan(nameIndex);
		expect(nameIndex).toBeLessThan(colorIndex);
		expect(colorIndex).toBeLessThan(fieldsIndex);
	});

	it('writes two-space JSON with one trailing newline', () => {
		const text = serializeDocument(documentOf('minimal'));
		expect(text.startsWith('{\n  "format"')).toBe(true);
		expect(text.endsWith('}\n')).toBe(true);
	});

	it('parse → serialize → parse is stable for the fixtures', () => {
		for (const name of ['minimal', 'unknown-v1-key']) {
			const once = serializeDocument(documentOf(name));
			const second = parseDocument(once);
			expect(second.ok).toBe(true);
			if (!second.ok) {
				continue;
			}
			expect(serializeDocument(second.document)).toBe(once);
		}
	});
});

describe('refusals', () => {
	it('turns unparseable text into an invalid-json refusal that keeps the raw text', () => {
		const result = parseDocument('{ not json');
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.rawTextPreserved).toBe(true);
		expect(result.errors.map((error) => error.code)).toEqual(['invalid-json']);
		expect(result.errors[0]?.path).toBe('$');
	});

	it('refuses a root that is not an object', () => {
		expect(codesOf('[]')).toEqual(['invalid-document']);
		expect(codesOf('"a string"')).toEqual(['invalid-document']);
		expect(codesOf('42')).toEqual(['invalid-document']);
	});

	it('reports every missing key of an empty object at once', () => {
		expect(codesOf('{}')).toEqual([
			'missing-format',
			'missing-version',
			'missing-database-id',
			'missing-name',
			'missing-tables',
		]);
	});

	it('refuses a wrong format tag', () => {
		const errors = errorsOf(envelopeText({ format: 'obsidian-bases' }));
		expect(errors.map((error) => error.code)).toEqual(['invalid-format']);
		expect(errors[0]?.message).toContain('"tablify"');
	});

	it('refuses malformed versions and names the version of a newer file', () => {
		expect(codesOf(envelopeText({ version: '1' }))).toEqual(['invalid-version']);
		expect(codesOf(envelopeText({ version: 0 }))).toEqual(['invalid-version']);
		expect(codesOf(envelopeText({ version: 1.5 }))).toEqual(['invalid-version']);
		const newer = errorsOf(envelopeText({ version: 2 }));
		expect(newer.map((error) => error.code)).toEqual(['unsupported-version']);
		expect(newer[0]?.message).toContain('version 2');
		expect(newer[0]?.path).toBe('$.version');
	});

	it('refuses a missing or empty identity and name', () => {
		expect(codesOf(envelopeText({ databaseId: '' }))).toEqual(['invalid-database-id']);
		expect(codesOf(envelopeText({ databaseId: 7 }))).toEqual(['invalid-database-id']);
		expect(codesOf(envelopeText({ name: '' }))).toEqual(['invalid-name']);
		expect(codesOf(envelopeText({ name: null }))).toEqual(['invalid-name']);
	});

	it('refuses a tables value that is not an array, and table entries that are not objects', () => {
		expect(codesOf(envelopeText({ tables: {} }))).toEqual(['invalid-tables']);
		expect(codesOf(envelopeText({ tables: [[]] }))).toEqual(['invalid-table']);
		expect(errorsOf(envelopeText({ tables: [[]] }))[0]?.path).toBe('$.tables[0]');
	});

	it('refuses tables without usable id and name, with one error per missing piece', () => {
		expect(codesOf(envelopeText({ tables: [{}] }))).toEqual([
			'missing-table-id',
			'missing-table-name',
		]);
		expect(codesOf(envelopeText({ tables: [{ id: 3, name: '' }] }))).toEqual([
			'invalid-table-id',
			'invalid-table-name',
		]);
		const errors = errorsOf(envelopeText({ tables: [{ id: 'tbl_a', name: '' }] }));
		expect(errors[0]?.path).toBe('$.tables[0].name');
	});

	it('collects errors from independent parts of the document', () => {
		expect(codesOf(envelopeText({ version: 9, tables: [{ id: '', name: 'X' }] }))).toEqual([
			'unsupported-version',
			'invalid-table-id',
		]);
	});

	it('never carries a document in a refusal', () => {
		const result = parseDocument('{}');
		expect(result.ok).toBe(false);
		expect(Object.keys(result)).toEqual(['ok', 'errors', 'rawTextPreserved']);
	});
});

describe('the generated round trip', () => {
	const DOCUMENTS = 200;

	/** mulberry32, seeded here so a failing case is reproducible from its number alone. */
	function mulberry32(seed: number): () => number {
		let state = seed >>> 0;
		return () => {
			state = (state + 0x6d2b79f5) >>> 0;
			let t = state;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	function character(roll: () => number): string {
		const pool = 'abcdefghijklmnopqrstuvwxyz0123456789_- äöü漢字🙂';
		const index = Math.floor(roll() * pool.length);
		return pool.charAt(Math.min(index, pool.length - 1));
	}

	function word(roll: () => number, length: number): string {
		let out = '';
		for (let index = 0; index < length; index += 1) {
			out += character(roll);
		}
		return out;
	}

	function jsonValue(roll: () => number, depth: number): JsonValue {
		const kind = Math.floor(roll() * (depth > 0 ? 6 : 4));
		switch (kind) {
			case 0:
				return word(roll, 4);
			case 1:
				return Math.floor(roll() * 1000);
			case 2:
				return roll() < 0.5;
			case 3:
				return null;
			case 4: {
				const items: JsonValue[] = [];
				const count = Math.floor(roll() * 3);
				for (let index = 0; index < count; index += 1) {
					items.push(jsonValue(roll, depth - 1));
				}
				return items;
			}
			default: {
				const record: Record<string, JsonValue> = {};
				const count = 1 + Math.floor(roll() * 2);
				for (let index = 0; index < count; index += 1) {
					record[`u${index}`] = jsonValue(roll, depth - 1);
				}
				return record;
			}
		}
	}

	function document(roll: () => number, index: number): DatabaseDocument {
		const tables: DatabaseTable[] = [];
		const tableCount = Math.floor(roll() * 4);
		for (let tableIndex = 0; tableIndex < tableCount; tableIndex += 1) {
			const unknown: { key: string; value: JsonValue }[] = [];
			const unknownCount = Math.floor(roll() * 3);
			for (let unknownIndex = 0; unknownIndex < unknownCount; unknownIndex += 1) {
				unknown.push({ key: `extra${unknownIndex}`, value: jsonValue(roll, 2) });
			}
			tables.push({
				id: `tbl_${word(roll, 10)}`,
				name: word(roll, 6),
				unknown,
			});
		}
		const rootUnknown: { key: string; value: JsonValue }[] = [];
		const rootCount = Math.floor(roll() * 2);
		for (let unknownIndex = 0; unknownIndex < rootCount; unknownIndex += 1) {
			rootUnknown.push({ key: `top${unknownIndex}`, value: jsonValue(roll, 2) });
		}
		return {
			format: FORMAT_TAG,
			version: 1,
			databaseId: `db_${word(roll, 10)}_${index}`,
			name: word(roll, 8),
			tables,
			unknown: rootUnknown,
		};
	}

	it(`keeps serialize → parse → serialize stable over ${DOCUMENTS} documents`, () => {
		const roll = mulberry32(0x5eed2026);
		for (let index = 0; index < DOCUMENTS; index += 1) {
			const original = document(roll, index);
			const once = serializeDocument(original);
			const parsed = parseDocument(once);
			expect(parsed.ok).toBe(true);
			if (!parsed.ok) {
				return;
			}
			expect(serializeDocument(parsed.document)).toBe(once);
			expect(parsed.document).toEqual(original);
		}
	});
});
