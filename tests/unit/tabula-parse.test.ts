/**
 * The `.tabula` reader, against the seven committed fixtures.
 *
 * Snapshots are of the **parse result** — the structure the migration consumes — and they are committed
 * (`tests/unit/__snapshots__/`), so a change in the reader's output is a visible diff rather than a passing
 * run. The prose in a warning is part of that output on purpose: it is what the dialog shows.
 *
 * The fixtures are hand-written to the on-disk shapes `docs/03` §the `.tabula` format records (v1 bare
 * document, v2 `{version: 2, tables: [{id, table}]}` envelope, option **ids** in select cells, the 19-type
 * union), because the fork's own test data is not in this repository and copying it would mean copying its
 * normalizer's bugs along with it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { parseTabulaFile } from '../../src/adapters/tabulaFile/parse';
import { orphanSelections } from '../../src/adapters/tabulaFile/model';
import type { TabulaDoc, TabulaError } from '../../src/adapters/tabulaFile/model';

const DIRECTORY = new URL('../fixtures/tabula/', import.meta.url);

function textOf(name: string): string {
	return readFileSync(new URL(`${name}.tabula`, DIRECTORY), 'utf8');
}

function documentOf(name: string): TabulaDoc {
	const result = parseTabulaFile(textOf(name), `${name}.tabula`);
	if (!result.ok) {
		throw new Error(`fixture ${name}.tabula did not parse: ${result.error.message}`);
	}
	return result.doc;
}

function errorOf(name: string): TabulaError {
	const result = parseTabulaFile(textOf(name), `${name}.tabula`);
	if (result.ok) {
		throw new Error(`fixture ${name}.tabula parsed; the test expected a refusal`);
	}
	// The engine's own error travels as `cause`, and it is left out of every comparison here: its wording
	// differs between runtimes (V8 says "Unexpected end of JSON input", Bun says "Expected '}'"), and the
	// reader's job is to produce the same message regardless of who parsed the JSON.
	return {
		path: result.error.path,
		message: result.error.message,
		excerpt: result.error.excerpt,
		...(result.error.line === undefined ? {} : { line: result.error.line }),
		...(result.error.column === undefined ? {} : { column: result.error.column }),
	};
}

/** A minimal v1 document, so a test can state exactly the irregularity it is about. */
function document(parts: {
	readonly version?: number | null;
	readonly fields?: unknown;
	readonly rows?: unknown;
	readonly tables?: unknown;
}): string {
	const body: Record<string, unknown> = {};
	if (parts.version !== null) {
		body.version = parts.version ?? 1;
	}
	if (parts.tables !== undefined) {
		body.tables = parts.tables;
	} else {
		body.fields = parts.fields ?? [{ id: 'f_a', name: 'A', type: 'text' }];
		body.rows = parts.rows ?? [{ id: 'r_1', cells: { f_a: 'x' } }];
	}
	return JSON.stringify(body, null, '\t');
}

describe('the fixtures, parsed', () => {
	it('reads every fixture the step names', () => {
		const names = readdirSync(DIRECTORY)
			.filter((entry) => entry.endsWith('.tabula'))
			.map((entry) => entry.replace(/\.tabula$/u, ''));
		expect(names.sort()).toEqual([
			'crlf-bom',
			'empty',
			'orphan-options',
			'truncated',
			'unknown-types',
			'v1-simple',
			'v2-three-tables',
		]);
	});

	for (const name of [
		'v1-simple',
		'v2-three-tables',
		'unknown-types',
		'orphan-options',
		'empty',
		'crlf-bom',
	]) {
		it(`parses ${name}.tabula`, () => {
			expect(documentOf(name)).toMatchSnapshot();
		});
	}
});

describe('what it tolerates', () => {
	it('reads a BOM and CRLF line endings as if they were not there', () => {
		const text = textOf('crlf-bom');
		// The fixture's whole point is its bytes: a byte-order mark, and CRLF line endings. A tool that
		// "tidies" them away turns this test green and meaningless, so the bytes are asserted first.
		expect(text.charCodeAt(0)).toBe(0xfeff);
		expect(text).toContain('\r\n');
		expect(text).not.toContain('\n\r');

		const doc = documentOf('crlf-bom');
		expect(doc.version).toBe(1);
		expect(doc.tables[0]?.name).toBe('Windows file');
		expect(doc.tables[0]?.rows).toHaveLength(2);
		expect(doc.warnings).toEqual([]);
	});

	it('keeps a column whose type it does not know, and says so', () => {
		const table = documentOf('unknown-types').tables[0];
		const lookup = table?.fields.find((field) => field.legacyType === 'lookup');
		expect(lookup).toBeDefined();
		expect(lookup?.unknown).toBe(true);
		expect(table?.fields.map((field) => field.name)).toEqual([
			'Name',
			'Lookup owner',
			'Rolled up',
			'Number',
			'Created',
			'Last modified',
		]);
	});

	it('keeps a value whose option was deleted, and reports it against its column', () => {
		const table = documentOf('orphan-options').tables[0];
		expect(table).toBeDefined();
		if (table === undefined) {
			return;
		}
		expect(orphanSelections(table)).toEqual([
			{ rowId: 'r_1', fieldId: 'f_status', value: 'o_archived' },
			{ rowId: 'r_1', fieldId: 'f_tags', value: 'o_urgent' },
		]);
	});

	it('reads a table with zero rows', () => {
		const doc = documentOf('empty');
		expect(doc.tables[0]?.rows).toEqual([]);
		expect(doc.tables[0]?.fields).toHaveLength(2);
	});

	it('reads a document with no version field, and says which version it assumed', () => {
		const result = parseTabulaFile(document({ version: null }), 'NoVersion.tabula');
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.doc.version).toBe(1);
		expect(result.doc.warnings.map((warning) => warning.code)).toEqual(['missing-version']);
	});

	it('reads a tables array with no version field as the version-2 envelope', () => {
		const result = parseTabulaFile(
			document({ version: null, tables: [{ id: 't_a', table: { fields: [], rows: [] } }] }),
			'NoVersion.tabula',
		);
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.doc.version).toBe(2);
		expect(result.doc.tables[0]?.id).toBe('t_a');
	});

	it('skips a v2 entry with no table object, keeps the others, and reports the entry', () => {
		const result = parseTabulaFile(
			document({
				version: 2,
				tables: [
					{ id: 't_good', table: { name: 'Good', fields: [], rows: [] } },
					{ id: 't_broken' },
				],
			}),
			'Half.tabula',
		);
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.doc.tables.map((table) => table.id)).toEqual(['t_good']);
		expect(result.doc.warnings).toEqual([
			{
				code: 'skipped-table-entry',
				tableIndex: 1,
				where: 'table 2',
				message: 'table entry “t_broken” has no table object; it was skipped',
			},
		]);
	});

	it('reports two tables claiming the same id instead of silently re-keying one', () => {
		const result = parseTabulaFile(
			document({
				version: 2,
				tables: [
					{ id: 't_same', table: { name: 'One', fields: [], rows: [] } },
					{ id: 't_same', table: { name: 'Two', fields: [], rows: [] } },
				],
			}),
			'Same.tabula',
		);
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.doc.warnings.map((warning) => warning.code)).toEqual(['duplicate-table-id']);
	});

	it('reports a value that belongs to a column the table does not have', () => {
		const result = parseTabulaFile(
			document({ rows: [{ id: 'r_1', cells: { f_a: 'x', f_ghost: 'y' } }] }),
			'Ghost.tabula',
		);
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.doc.warnings.map((warning) => warning.code)).toEqual(['extra-cell-column']);
		expect(result.doc.tables[0]?.rows[0]?.cells).toEqual({ f_a: 'x' });
	});

	it('keeps a row that has no cells object as an empty row, and says so', () => {
		const result = parseTabulaFile(document({ rows: [{ id: 'r_1' }] }), 'Empty row.tabula');
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.doc.tables[0]?.rows).toEqual([{ id: 'r_1', cells: {} }]);
		expect(result.doc.warnings.map((warning) => warning.code)).toEqual(['missing-row-cells']);
	});

	it('warns about a sort direction it does not recognise rather than dropping the sort', () => {
		const result = parseTabulaFile(
			JSON.stringify({
				version: 1,
				fields: [{ id: 'f_a', name: 'A', type: 'text' }],
				rows: [],
				view: { sorts: [{ fieldId: 'f_a', direction: 'sideways' }] },
			}),
			'Sort.tabula',
		);
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.doc.tables[0]?.view.sorts).toEqual([
			{ fieldId: 'f_a', direction: 'sideways' },
		]);
		expect(result.doc.warnings.map((warning) => warning.code)).toEqual([
			'unknown-sort-direction',
		]);
	});
});

describe('what it refuses', () => {
	it('refuses a truncated file with a sentence that says why, and a position to look at', () => {
		const error = errorOf('truncated');
		// The message and the excerpt are this reader's own output and are snapshot exactly.
		expect({ message: error.message, excerpt: error.excerpt }).toMatchSnapshot();
		// Where the engine stopped: V8 points at the last byte of the input (there is no text there), Bun
		// reports no position at all. Both land on line 9, the last line with content — the reader's job is
		// that this is the same on every engine, and this is the assertion that holds it to that.
		expect(error.line).toBe(9);
		// And the excerpt is never empty: an error with no text next to it is not a report a person can act on.
		expect(error.excerpt.length).toBeGreaterThan(0);
	});

	it('reports the same line for a truncated file whichever engine parsed the JSON', () => {
		// V8 names a position and a line/column pair; Bun names neither. The reader's answer must not depend
		// on that, so this asserts the rule directly: an engine that points one line *past* the text (which is
		// what V8 does for a truncated document — it stops at the last byte, where there is nothing) is
		// answered with the last line that has content, and the same line number either way.
		const text = textOf('truncated');
		const spy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
			throw new SyntaxError(
				"Expected ',' or '}' after property value in JSON at position 269 (line 10 column 1)",
			);
		});
		try {
			const result = parseTabulaFile(text, 'truncated.tabula');
			expect(result.ok).toBe(false);
			if (result.ok) {
				return;
			}
			expect(result.error.line).toBe(errorOf('truncated').line);
			expect(result.error.excerpt).toContain('the file stops here');
		} finally {
			spy.mockRestore();
		}
	});

	it('refuses an empty file rather than inventing an empty table', () => {
		const result = parseTabulaFile('   \n', 'Blank.tabula');
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.error.message).toBe('the file is empty');
		expect(result.error.line).toBe(1);
	});

	it('refuses JSON that is not an object', () => {
		const result = parseTabulaFile('[]', 'Array.tabula');
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.error.message).toBe('the file does not contain a table document');
	});

	it('refuses a document with neither fields/rows nor tables', () => {
		const result = parseTabulaFile('{"hello": "world"}', 'Nothing.tabula');
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.error.message).toBe(
			'the file has neither a fields/rows pair nor a tables array',
		);
	});

	it('refuses a newer format version instead of guessing at it', () => {
		const result = parseTabulaFile(document({ version: 3 }), 'Future.tabula');
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.error.message).toContain('newer version of the format');
		expect(result.error.message).toContain('version 3');
		expect(result.error.line).toBe(2);
	});

	it('refuses a v2 envelope whose tables array is missing', () => {
		const result = parseTabulaFile('{"version": 2}', 'NoTables.tabula');
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.error.message).toBe('the file says version 2 but has no tables array');
	});

	it('refuses a tables array with nothing readable in it', () => {
		const result = parseTabulaFile('{"version": 2, "tables": []}', 'Empty envelope.tabula');
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.error.message).toBe(
			'the file has a tables array with no readable table in it',
		);
	});
});
