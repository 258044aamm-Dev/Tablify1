/**
 * The R1 fixture matrix — step 9's ledger.
 *
 * Every `.tablify` file in `tests/fixtures/tablify/` appears exactly once in {@link MATRIX}, with
 * the exact outcome the core is contracted to produce: a load with precisely these
 * `code@path` findings, or a refusal with precisely these `code@path` errors. Two kinds of drift
 * fail loudly:
 *
 *   - a fixture on disk that the matrix does not name (nothing may be added silently),
 *   - a behavior change that moves any code or path (the ledger is the contract's shadow).
 *
 * Beyond the ledger, each loadable fixture is held to the round-trip promises: parse → serialize →
 * parse is model-identical, serializing twice is byte-identical, and `parseAndMigrate` agrees with
 * `parseDocument` on both branches. The refusals additionally prove `rawTextPreserved`, because a
 * future host has to be able to offer repair/export without overwriting the original bytes.
 */
import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseAndMigrate, parseDocument, serializeDocument } from '../../src/core/database/index';
import type { DocumentLoad } from '../../src/core/database/index';
import { DOCUMENT_FIELD_TYPE_IDS } from '../../src/core/database/schema';

const DIRECTORY = new URL('../fixtures/tablify/', import.meta.url);

type Expectation =
	| { readonly outcome: 'ok'; readonly findings: readonly string[] }
	| { readonly outcome: 'refuse'; readonly errors: readonly string[] };

/**
 * One entry per fixture file: `code@path` for every finding (load) or every error (refusal), in
 * the order the core reports them. The order is part of the ledger: parse-time findings come in
 * document order, then the document-wide link scan, then the option scan.
 */
const MATRIX: Readonly<Record<string, Expectation>> = {
	// --- loadable ---------------------------------------------------------------------------
	'all-field-types': { outcome: 'ok', findings: [] },
	'attachment-paths': { outcome: 'ok', findings: [] },
	'empty-table': { outcome: 'ok', findings: [] },
	'empty-values': { outcome: 'ok', findings: [] },
	'fields-basic': {
		outcome: 'ok',
		findings: ['unsupported-field-type@$.tables[0].fields[6]'],
	},
	minimal: { outcome: 'ok', findings: [] },
	'rows-views': { outcome: 'ok', findings: [] },
	'unknown-field-type': {
		outcome: 'ok',
		findings: ['unsupported-field-type@$.tables[0].fields[1]'],
	},
	'unknown-v1-key': { outcome: 'ok', findings: [] },
	'invalid-values': {
		outcome: 'ok',
		findings: [
			'invalid-cell-value@$.tables[0].rows[0].cells.fld_badtext0000000000000000000',
			'invalid-cell-value@$.tables[0].rows[0].cells.fld_badnumber00000000000000000',
			'invalid-cell-value@$.tables[0].rows[0].cells.fld_baddate0000000000000000000',
			'invalid-cell-value@$.tables[0].rows[0].cells.fld_badcheckbox000000000000000',
			'invalid-cell-value@$.tables[0].rows[0].cells.fld_badselect00000000000000000',
			'invalid-cell-value@$.tables[0].rows[0].cells.fld_badmultiselect000000000000',
			'invalid-cell-value@$.tables[0].rows[0].cells.fld_badlink0000000000000000000',
			'invalid-cell-value@$.tables[0].rows[0].cells.fld_badcreatedtime000000000000',
		],
	},
	'dangling-refs': {
		outcome: 'ok',
		findings: [
			'view-unknown-field@$.tables[0].views[0].sorts[0].fieldId',
			'view-unknown-field@$.tables[0].views[0].columnOrder[1]',
			'unresolved-link@$.tables[0].rows[0].cells.fld_dangclient0000000000000000',
			'unknown-link-target-table@$.tables[0].fields[1].targetTableId',
			'unknown-option@$.tables[0].rows[0].cells.fld_dangstatus0000000000000000',
			'unknown-option@$.tables[0].rows[0].cells.fld_dangtags000000000000000000[1]',
		],
	},

	// --- refusals ---------------------------------------------------------------------------
	'duplicate-row-id': { outcome: 'refuse', errors: ['duplicate-row-id@$.tables[0].rows[1]'] },
	'duplicate-table-id': { outcome: 'refuse', errors: ['duplicate-table-id@$.tables[1]'] },
	'future-version': { outcome: 'refuse', errors: ['unsupported-version@$.version'] },
	truncated: { outcome: 'refuse', errors: ['invalid-json@$'] },
};

function textOf(name: string): string {
	return readFileSync(new URL(`${name}.tablify`, DIRECTORY), 'utf8');
}

function loadOf(name: string): DocumentLoad {
	return parseDocument(textOf(name));
}

function stampsOf(entries: readonly { readonly code: string; readonly path: string }[]): string[] {
	return entries.map((entry) => `${entry.code}@${entry.path}`);
}

describe('the fixture matrix covers the directory', () => {
	it('names every fixture on disk, and nothing else', () => {
		const onDisk = readdirSync(DIRECTORY)
			.filter((entry) => entry.endsWith('.tablify'))
			.map((entry) => entry.slice(0, -'.tablify'.length))
			.sort();
		expect(onDisk).toEqual(Object.keys(MATRIX).sort());
	});
});

for (const [name, expectation] of Object.entries(MATRIX)) {
	describe(`fixture ${name}`, () => {
		if (expectation.outcome === 'ok') {
			const expected = expectation.findings;

			it(`loads with exactly: ${expected.length === 0 ? 'no findings' : expected.join(', ')}`, () => {
				const result = loadOf(name);
				expect(result.ok).toBe(true);
				if (!result.ok) {
					return;
				}
				expect(stampsOf(result.warnings)).toEqual(expected);
			});

			it('round-trips: parse → serialize → parse is model-identical and bytes are stable', () => {
				const first = loadOf(name);
				if (!first.ok) {
					throw new Error(`fixture ${name} was expected to load`);
				}
				const once = serializeDocument(first.document);
				expect(serializeDocument(first.document)).toBe(once);
				const second = parseDocument(once);
				expect(second.ok).toBe(true);
				if (!second.ok) {
					return;
				}
				expect(second.document).toEqual(first.document);
				expect(serializeDocument(second.document)).toBe(once);
			});

			it('migrates exactly as it loads', () => {
				const migrated = parseAndMigrate(textOf(name));
				expect(migrated.ok).toBe(true);
				if (!migrated.ok) {
					return;
				}
				const plain = loadOf(name);
				expect(plain.ok).toBe(true);
				if (!plain.ok) {
					return;
				}
				expect(migrated.document).toEqual(plain.document);
				expect(stampsOf(migrated.warnings)).toEqual(stampsOf(plain.warnings));
			});
		} else {
			const expected = expectation.errors;

			it(`is refused with exactly: ${expected.join(', ')}`, () => {
				const result = loadOf(name);
				expect(result.ok).toBe(false);
				if (result.ok) {
					return;
				}
				expect(stampsOf(result.errors)).toEqual(expected);
				expect(result.rawTextPreserved).toBe(true);
				for (const error of result.errors) {
					expect(error.message.length).toBeGreaterThan(0);
					expect(error.path.startsWith('$')).toBe(true);
				}
			});

			it('is refused the same way by the migration path — never downgraded', () => {
				const migrated = parseAndMigrate(textOf(name));
				expect(migrated.ok).toBe(false);
				if (migrated.ok) {
					return;
				}
				expect(stampsOf(migrated.errors)).toEqual(expected);
				expect(migrated.rawTextPreserved).toBe(true);
			});
		}
	});
}

describe('what the fixtures are here to prove', () => {
	it('all-field-types carries every field type this build reads — the list grows, the fixture must', () => {
		const result = loadOf('all-field-types');
		if (!result.ok) {
			throw new Error('all-field-types must load');
		}
		const types = new Set<string>();
		for (const table of result.document.tables) {
			for (const field of table.fields) {
				types.add(field.kind === 'field' ? field.type : '(unsupported)');
			}
		}
		for (const type of DOCUMENT_FIELD_TYPE_IDS) {
			expect(types.has(type), `expected all-field-types to carry a "${type}" field`).toBe(
				true,
			);
		}
	});

	it('empty-values keeps every distinguishing value while collapsing absences', () => {
		const result = loadOf('empty-values');
		if (!result.ok) {
			throw new Error('empty-values must load');
		}
		const table = result.document.tables[0];
		const rows = table?.rows ?? [];
		const byId = new Map(rows.map((row) => [row.id, row]));

		// Ids are read out of the fixture file itself, never guessed; the four rows below are
		// `absent`, `voidcells`, `nulls` and `emptylists`, and the fields are `edgetext` and
		// `edgemultiselect` (see tests/fixtures/tablify/empty-values.tablify).
		const F_EDGE_TEXT = 'fld_edgetext000000000000000000';
		const F_EDGE_NUMBER = 'fld_edgenumber0000000000000000';
		const F_EDGE_CHECKBOX = 'fld_edgecheckbox00000000000000';
		const F_EDGE_SELECTION = 'fld_edgemultiselect00000000000';
		const R_ABSENT = 'row_absent00000000000000000000';
		const R_VOID = 'row_voidcells00000000000000000';
		const R_NULLS = 'row_nulls000000000000000000000';
		const R_EMPTY_STRING = 'row_emptystring000000000000000';
		const R_FALSE = 'row_false000000000000000000000';
		const R_ZERO = 'row_zero0000000000000000000000';
		const R_EMPTY_LISTS = 'row_emptylists0000000000000000';

		// Absent, empty-cells and explicit null are all "no value": no entries in the cell map.
		for (const [rowId, fieldId] of [
			[R_ABSENT, F_EDGE_TEXT],
			[R_VOID, F_EDGE_TEXT],
			[R_NULLS, F_EDGE_TEXT],
			[R_EMPTY_LISTS, F_EDGE_SELECTION],
		] as const) {
			const row = byId.get(rowId);
			expect(row?.cells.get(fieldId), `${rowId}.${fieldId}`).toBeUndefined();
		}
		// The written values that are not absences stay: "", false and 0.
		expect(byId.get(R_EMPTY_STRING)?.cells.get(F_EDGE_TEXT)).toBe('');
		expect(byId.get(R_FALSE)?.cells.get(F_EDGE_CHECKBOX)).toBe(false);
		expect(byId.get(R_ZERO)?.cells.get(F_EDGE_NUMBER)).toBe(0);

		// And the writer omits every no-value key rather than writing `null` or `[]`.
		const written = serializeDocument(result.document);
		for (const rowId of [R_NULLS, R_EMPTY_LISTS]) {
			const at = written.indexOf(rowId);
			expect(at).toBeGreaterThan(-1);
			const rowText = written.slice(at, written.indexOf('}', at));
			expect(rowText.includes('"cells"'), rowId).toBe(false);
		}
	});

	it('invalid-values re-writes the raw JSON verbatim, under its own warning', () => {
		const result = loadOf('invalid-values');
		if (!result.ok) {
			throw new Error('invalid-values must load');
		}
		const written = serializeDocument(result.document);
		for (const raw of ['42', '"5"', '"2026-02-30"', '"yes"']) {
			expect(written.includes(raw), `raw ${raw} survives`).toBe(true);
		}
	});

	it('attachment-paths keeps spaces, Unicode and nesting exactly', () => {
		const result = loadOf('attachment-paths');
		if (!result.ok) {
			throw new Error('attachment-paths must load');
		}
		const written = serializeDocument(result.document);
		for (const path of [
			'Cover art/übersicht 🙂.png',
			'Deep/nested/dir/file with  spaces.pdf',
			'Fotos/日本 – 京都.jpeg',
			'Missing/never-existed.png',
		]) {
			expect(written.includes(JSON.stringify(path).slice(1, -1))).toBe(true);
		}
	});

	it('unknown-field-type keeps the unsupported field and its cell value', () => {
		const result = loadOf('unknown-field-type');
		if (!result.ok) {
			throw new Error('unknown-field-type must load');
		}
		const written = serializeDocument(result.document);
		expect(written.includes('"formula"')).toBe(true);
		expect(written.includes('"expression"')).toBe(true);
		expect(written.includes('"computed"')).toBe(true);
	});
});
