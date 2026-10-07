/**
 * Internal schema versioning — R1 step 8's gate.
 *
 * The guide's step 8 fixes four properties, and this file proves each against the real engine
 * rather than against a promise:
 *
 *   1. **`parseAndMigrate` is `parseDocument` plus the version walk.** For a current-version file
 *      the outcome is identical to `parseDocument` — same document, same warnings — and calling it
 *      twice produces equal documents: the walk is deterministic.
 *   2. **A newer file is never migrated down.** Version 2 is refused with the version named and the
 *      raw text kept, before any migration could be considered.
 *   3. **Migrations are pure `vN → vN+1` steps.** Proven with a stand-in step for a version no
 *      released schema produces: the input model is untouched, the output declares the next
 *      version, and the step's own warning plus the walk's `migrated` note both come back.
 *   4. **A broken or absent step is a refusal, not a throw.** A version with no step, a step that
 *      claims to skip a version, and a step that returns the wrong version each produce a named
 *      error on `$.version`.
 *
 * There is deliberately no `.base`, frontmatter or `.tabula` case that *works*: those files are
 * not this migrator's input, and the tests say so by asserting they are refused as invalid JSON.
 */
import { describe, expect, it } from 'vitest';

import {
	FORMAT_TAG,
	migrateDocument,
	parseAndMigrate,
	parseDocument,
	serializeDocument,
} from '../../src/core/database/index';
import type {
	DatabaseDocument,
	DocumentMigration,
	LoadWarning,
} from '../../src/core/database/index';

const DATABASE_ID = 'db_' + 'z'.repeat(26);
const TABLE_ID = 'tbl_' + 'z'.repeat(26);
const F_TITLE = 'fld_' + 'a'.repeat(26);

function versionOneText(): string {
	return JSON.stringify({
		format: FORMAT_TAG,
		version: 1,
		databaseId: DATABASE_ID,
		name: 'Test',
		tables: [
			{
				id: TABLE_ID,
				name: 'Tasks',
				fields: [{ id: F_TITLE, name: 'Title', type: 'text' }],
				rows: [{ id: 'row_' + 'a'.repeat(26), cells: { [F_TITLE]: 'First' } }],
				views: [],
			},
		],
	});
}

/** A hand-built model at a version no parser would produce, for the engine's own tests. */
function modelAt(version: number): DatabaseDocument {
	return {
		format: FORMAT_TAG,
		version,
		databaseId: DATABASE_ID,
		name: 'Test',
		tables: [],
		unknown: [],
	};
}

/** A stand-in step: version 0 → version 1, with its own warning. */
const stepZeroToOne: DocumentMigration = {
	from: 0,
	to: 1,
	apply: (document) => ({
		document: { ...document, version: 1, name: 'Upgraded' },
		warnings: [{ code: 'test-step', message: 'A stand-in step ran.', path: '$' }],
	}),
};

const stepZeroToTwo: DocumentMigration = {
	from: 0,
	to: 2,
	apply: (document) => ({ document: { ...document, version: 2 }, warnings: [] }),
};

const stepLyingAboutItsOutput: DocumentMigration = {
	from: 0,
	to: 1,
	apply: (document) => ({ document: { ...document, version: 0 }, warnings: [] }),
};

describe('parseAndMigrate is parseDocument plus the version walk', () => {
	it('returns the same outcome as parseDocument for a current-version file', () => {
		const text = versionOneText();
		const parsed = parseDocument(text);
		const migrated = parseAndMigrate(text);
		expect(parsed.ok).toBe(true);
		expect(migrated.ok).toBe(true);
		if (!parsed.ok || !migrated.ok) {
			return;
		}
		expect(migrated.document).toEqual(parsed.document);
		expect(migrated.warnings).toEqual(parsed.warnings);
	});

	it('is deterministic — two calls produce equal documents and equal text', () => {
		const first = parseAndMigrate(versionOneText());
		const second = parseAndMigrate(versionOneText());
		expect(first.ok).toBe(true);
		expect(second.ok).toBe(true);
		if (!first.ok || !second.ok) {
			return;
		}
		expect(serializeDocument(first.document)).toBe(serializeDocument(second.document));
	});

	it('carries the load findings across — a warning must not be lost by taking this path', () => {
		// An unsupported field type is a load warning this build already produces; whatever the
		// findings are, the migration path must return the same ones as the plain parse.
		const text = JSON.stringify({
			format: FORMAT_TAG,
			version: 1,
			databaseId: DATABASE_ID,
			name: 'Test',
			tables: [
				{
					id: TABLE_ID,
					name: 'Tasks',
					fields: [
						{ id: F_TITLE, name: 'Title', type: 'text' },
						{ id: 'fld_' + 'b'.repeat(26), name: 'Formula', type: 'formula' },
					],
					rows: [],
					views: [],
				},
			],
		});
		const parsed = parseDocument(text);
		const migrated = parseAndMigrate(text);
		expect(parsed.ok).toBe(true);
		expect(migrated.ok).toBe(true);
		if (!parsed.ok || !migrated.ok) {
			return;
		}
		expect(migrated.warnings.map((warning) => `${warning.code}@${warning.path}`)).toEqual(
			parsed.warnings.map((warning) => `${warning.code}@${warning.path}`),
		);
		expect(parsed.warnings.map((warning) => warning.code)).toEqual(['unsupported-field-type']);
	});

	it('never throws, whatever the text is', () => {
		const hostile: readonly string[] = [
			'',
			'{',
			'null',
			'views:\n  - type: table\n', // a `.base`-shaped file: not this migrator's input
			'---\ntitle: x\n---\n', // frontmatter: not this migrator's input
		];
		for (const input of hostile) {
			const result = parseAndMigrate(input);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.rawTextPreserved).toBe(true);
				expect(result.errors.length).toBeGreaterThan(0);
			}
		}
	});
});

describe('a newer file is never migrated down', () => {
	it('refuses version 2 through parseAndMigrate, naming the version and keeping the text', () => {
		const text = JSON.stringify({
			format: FORMAT_TAG,
			version: 2,
			databaseId: DATABASE_ID,
			name: 'From the future',
			tables: [],
		});
		const result = parseAndMigrate(text);
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.errors.map((error) => error.code)).toEqual(['unsupported-version']);
		expect(result.errors[0]?.message).toContain('version 2');
		expect(result.errors[0]?.message).toContain('never migrated down');
		expect(result.rawTextPreserved).toBe(true);
	});

	it('refuses a hand-built newer model too', () => {
		const result = migrateDocument(modelAt(2));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.map((error) => error.code)).toEqual(['unsupported-version']);
		}
	});
});

describe('migrations are pure vN → vN+1 steps', () => {
	it('applies a stand-in step, reports it, and leaves the input untouched', () => {
		const before = modelAt(0);
		const result = migrateDocument(before, [stepZeroToOne]);
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.document.version).toBe(1);
		expect(result.document.name).toBe('Upgraded');
		expect(result.warnings.map((warning) => warning.code)).toEqual(['test-step', 'migrated']);
		const migratedNote: LoadWarning | undefined = result.warnings[1];
		expect(migratedNote?.message).toContain('version 0 to 1');
		expect(migratedNote?.path).toBe('$.version');
		// The step received a document and returned a new one; nothing mutated the original.
		expect(before.version).toBe(0);
		expect(before.name).toBe('Test');
	});

	it('refuses a version it has no step for, naming that version', () => {
		const result = migrateDocument(modelAt(0));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.map((error) => error.code)).toEqual(['missing-migration']);
			expect(result.errors[0]?.path).toBe('$.version');
			expect(result.errors[0]?.message).toContain('version 0');
		}
	});

	it('refuses a step that claims to skip a version', () => {
		const result = migrateDocument(modelAt(0), [stepZeroToTwo]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.map((error) => error.code)).toEqual(['invalid-migration']);
			expect(result.errors[0]?.message).toContain('exactly the next version');
		}
	});

	it('refuses a step whose output does not declare the version it claims', () => {
		const result = migrateDocument(modelAt(0), [stepLyingAboutItsOutput]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.map((error) => error.code)).toEqual(['invalid-migration']);
			expect(result.errors[0]?.message).toContain('declares version 0');
		}
	});

	it('ships no migrations for version 1 — it is the first schema', () => {
		const result = migrateDocument(modelAt(1));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.document.version).toBe(1);
			expect(result.warnings).toEqual([]);
		}
	});
});
