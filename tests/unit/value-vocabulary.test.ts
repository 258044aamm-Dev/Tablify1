/**
 * One value vocabulary — R3 step 3's gate.
 *
 * R3 step 3 replaces YAML/frontmatter value conversion in the field types with the document's JSON.
 * This file is where that stops being a claim in a doc comment and becomes something a build can fail:
 *
 *   1. **There is one canonical cell type, not two.** `CellValue` (the core vocabulary) and
 *      `CanonicalCell` (the document's codec) are asserted *mutually assignable*, so a change to either
 *      union that lets them drift apart fails at the typecheck, not at a user's file.
 *   2. **No YAML vocabulary is left in a descriptor.** A source scan over `src/**` proves the type
 *      names `YamlValue`/`YamlScalar`/`YamlList` and the method name `toYaml` appear nowhere; the
 *      descriptors declare `toJson` instead, and the contract still requires `parsePlain`/`formatPlain`
 *      for clipboard and spreadsheet interchange. YAML *text* is still written in exactly one place —
 *      the Markdown note path R6 deletes — and that is a boundary, not the core.
 *   3. **A descriptor's stored form is a value a `.tablify` document can hold.** For every registered
 *      field type and a sample of canonical values, `encodeCell(id, descriptor.toJson(v, ctx))` must
 *      accept the value (write it, or omit the key) rather than refusing it — proving the two halves
 *      agree without either importing the other. The two select types are the deliberate exception and
 *      are asserted as such: a document's cell holds an `opt_…` id, so the label a note path considers
 *      canonical is refused, loudly, instead of being written where an id belongs.
 *   4. **Option identity follows the store, and renaming rewrites nothing.** A fixture document is
 *      loaded, its option is renamed in the field's metadata, and the serialized cells are asserted
 *      byte-identical — `docs/03` §1's *"label/color changes do not rewrite cell values"*. A label
 *      written where an id belongs is an invalid cell, preserved exactly rather than repaired.
 *   5. **The context carries no path.** `FieldContext` is checked to have no `path` property at the type
 *      level: a descriptor cannot address a file, which is what step 3 removes.
 *   6. **The numeric conventions are unchanged.** `percent` stores percent points (`25` is 25 %) and
 *      `duration` stores seconds, through both the descriptor and the document codec.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, expectTypeOf, it } from 'vitest';

import type { FieldContext, FieldDescriptor, FieldTypeId } from '../../src/core/types';
import type { CellValue } from '../../src/core/types';
import { allFields, getField } from '../../src/core/fieldTypes';
import { parseDocument, serializeDocument } from '../../src/core/database/index';
import type { DatabaseDocument } from '../../src/core/database/index';
import { decodeCell, encodeCell } from '../../src/core/database/values';
import type { CanonicalCell } from '../../src/core/database/values';

const REGISTERED: readonly FieldTypeId[] = allFields().map((field) => field.id);

/**
 * Writes one canonical value as the other union, and back.
 *
 * Both directions exist so the compiler proves the two names are one type; the functions are referenced
 * below so the lint (rightly) does not call them dead code.
 */
function asCanonicalCell(cell: CellValue): CanonicalCell {
	return cell;
}

function asCellValue(cell: CanonicalCell): CellValue {
	return cell;
}

function contextOf(overrides: Partial<FieldContext> = {}): FieldContext {
	return {
		now: () => Date.UTC(2026, 9, 7),
		timezone: 'UTC',
		locale: 'en-GB',
		fieldOptions: {},
		columnName: 'A column',
		...overrides,
	};
}

/** Every file under `src`, relative to the repository root, for the vocabulary scan. */
function sourceFiles(): readonly string[] {
	const found: string[] = [];
	const walk = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				walk(path);
				continue;
			}
			if (entry.name.endsWith('.ts')) {
				found.push(path);
			}
		}
	};
	walk('src');
	return found;
}

/** A few canonical values per registered type, chosen to reach every shape a type can produce. */
const SAMPLES: readonly {
	readonly id: FieldTypeId;
	readonly values: readonly CellValue[];
	readonly ctx?: Partial<FieldContext>;
}[] = [
	{ id: 'text', values: [null, '', 'Widening', '道路', 'line\nbreak'] },
	{ id: 'longText', values: [null, 'First line\nSecond line'] },
	{ id: 'number', values: [null, 0, -12.5, 1e21] },
	{ id: 'checkbox', values: [null, true, false] },
	{ id: 'date', values: [null, '2026-02-14'] },
	{ id: 'datetime', values: [null, '2026-02-14T09:30:00Z', '2026-03-04T12:30:00+01:00'] },
	{ id: 'url', values: [null, 'https://example.com/a?b=1'] },
	{ id: 'email', values: [null, 'a@example.com'] },
	{ id: 'phone', values: [null, '+31 20 123 4567'] },
	{ id: 'rating', values: [null, 0, 4.5], ctx: { fieldOptions: { max: 5 } } },
	{
		id: 'currency',
		values: [null, 0, 1250.5],
		ctx: { fieldOptions: { symbol: '€', precision: 2 } },
	},
	{ id: 'percent', values: [null, 0, 25, 12.5] },
	{ id: 'duration', values: [null, 0, 90, 1.5] },
	{ id: 'attachment', values: [null, ['Assets/wireframe.png'], ['Cover art/übersicht 🙂.png']] },
];

/** The two select types, whose stored spelling depends on the store (see `FieldOption` in `types.ts`). */
const SELECTS: readonly FieldTypeId[] = ['singleSelect', 'multiSelect'];

describe('one canonical cell type, not two', () => {
	it('asserts CellValue and CanonicalCell mutually assignable at the type level', () => {
		const cell: CellValue = 'Widening';
		const canonical: CanonicalCell = asCanonicalCell(cell);
		const back: CellValue = asCellValue(canonical);
		expect(back).toBe('Widening');
		expect(asCellValue(asCanonicalCell(null))).toBeNull();
	});

	it('keeps the document’s codec and the descriptor vocabulary in step for every sample', () => {
		for (const sample of SAMPLES) {
			const field = getField(sample.id);
			if (field === undefined) {
				throw new Error(`the registry must have ${sample.id}`);
			}
			const ctx = contextOf(sample.ctx ?? {});
			for (const value of sample.values) {
				// `getField` hands back a `FieldDescriptor` over `CellValue`, so a sample from the table
				// needs no cast: the sample table is typed to the same union the contract is.
				const stored = field.toJson(value, ctx);
				const encode = encodeCell(sample.id, stored);
				expect(
					encode.kind,
					`${sample.id} toJson(${JSON.stringify(value)}) = ${JSON.stringify(stored)} must be a value a document can hold`,
				).not.toBe('unwritable');
				// A stored value must survive JSON verbatim: no `undefined`, no `Date`, no class instance.
				const json: unknown = JSON.parse(JSON.stringify(stored));
				expect(json).toEqual(stored);
			}
		}
	});
});

describe('no YAML vocabulary is left in a descriptor', () => {
	it('names no YAML value type anywhere in src', () => {
		const offenders: string[] = [];
		for (const path of sourceFiles()) {
			const text = readFileSync(path, 'utf8');
			if (/\bYaml(Value|Scalar|List)\b/.test(text)) {
				offenders.push(path);
			}
		}
		expect(offenders).toEqual([]);
	});

	it('declares no toYaml method and keeps toJson, parsePlain and formatPlain', () => {
		const offenders: string[] = [];
		for (const path of sourceFiles()) {
			const text = readFileSync(path, 'utf8');
			// The marker is spelled in two halves on purpose: this file must not itself read as a use.
			if (/\btoYam\u006c\b/.test(text)) {
				offenders.push(path);
			}
		}
		expect(offenders).toEqual([]);
		for (const field of allFields()) {
			expect(typeof field.toJson).toBe('function');
			expect(typeof field.parsePlain).toBe('function');
			expect(typeof field.formatPlain).toBe('function');
		}
	});

	it('is a contract the compiler carries, not just a scan', () => {
		// If a later step reinstates a YAML method on the contract, this fails to compile.
		expectTypeOf<FieldDescriptor>().toHaveProperty('toJson');
		expectTypeOf<FieldDescriptor>().not.toHaveProperty('toYaml');
		expectTypeOf<FieldDescriptor>().toHaveProperty('parsePlain');
		expectTypeOf<FieldDescriptor>().toHaveProperty('formatPlain');
	});
});

describe('a descriptor cannot address a file', () => {
	it('has no path on FieldContext', () => {
		expectTypeOf<FieldContext>().not.toHaveProperty('path');
		expectTypeOf<FieldContext>().toHaveProperty('columnName');
		expectTypeOf<FieldContext>().toHaveProperty('timezone');
		expectTypeOf<FieldContext>().toHaveProperty('locale');
		expect(Object.keys(contextOf())).not.toContain('path');
	});
});

describe('a document’s select cells hold option ids, and labels are metadata', () => {
	function fixture(): {
		readonly document: DatabaseDocument;
		readonly tableId: string;
		readonly fieldId: string;
		readonly optionId: string;
		readonly rowId: string;
	} {
		const text = readFileSync(
			new URL('../fixtures/tablify/rows-views.tablify', import.meta.url),
			'utf8',
		);
		const loaded = parseDocument(text);
		if (!loaded.ok) {
			throw new Error('the rows-views fixture must load');
		}
		const table = loaded.document.tables[0];
		// Found by type, not by index: an index is how a fixture column moves without anyone noticing.
		const found = table?.fields.find(
			(candidate) => candidate.kind === 'field' && candidate.type === 'singleSelect',
		);
		const row = table?.rows[0];
		if (
			table === undefined ||
			found === undefined ||
			found.kind !== 'field' ||
			row === undefined
		) {
			throw new Error('the fixture must carry the status column and a row');
		}
		const field = found;
		const optionId = field.settings.options?.[0]?.id;
		if (optionId === undefined) {
			throw new Error('the status column must have options');
		}
		return {
			document: loaded.document,
			tableId: table.id,
			fieldId: field.id,
			optionId,
			rowId: row.id,
		};
	}

	it('stores an option id in the cell and reads the label and colour from the field', () => {
		const { document, tableId, fieldId, optionId, rowId } = fixture();
		const table = document.tables.find((candidate) => candidate.id === tableId);
		const field = table?.fields.find((candidate) => candidate.id === fieldId);
		const row = table?.rows.find((candidate) => candidate.id === rowId);
		// The stored state *is* the option id — not a label, and not an object with presentation on it.
		expect(row?.cells.get(fieldId)).toBe(optionId);
		expect(decodeCell('singleSelect', optionId)).toEqual({ kind: 'value', value: optionId });
		expect(field?.kind === 'field' ? field.settings.options?.[0]?.name : undefined).toBe(
			'Planned',
		);
		expect(field?.kind === 'field' ? field.settings.options?.[0]?.color : undefined).toBe(
			'blue',
		);
	});

	it('renames an option without touching one cell', () => {
		const { document, tableId, fieldId, optionId } = fixture();
		const before = serializeDocument(document);
		const renamed = {
			...document,
			tables: document.tables.map((table) =>
				table.id !== tableId
					? table
					: {
							...table,
							fields: table.fields.map((field) =>
								field.id !== fieldId || field.kind !== 'field'
									? field
									: {
											...field,
											settings: {
												...field.settings,
												options: (field.settings.options ?? []).map(
													(option) =>
														option.id === optionId
															? {
																	...option,
																	name: 'Scheduled',
																	color: 'red',
																}
															: option,
												),
											},
										},
							),
						},
			),
		};
		const after = serializeDocument(renamed);
		const cellsOf = (text: string): string =>
			text.slice(text.indexOf('"rows"'), text.indexOf('"views"'));
		expect(cellsOf(after)).toBe(cellsOf(before));
		expect(after).toContain('"name": "Scheduled"');
		expect(after).not.toContain('"name": "Planned"');
	});

	it('preserves a label written where an id belongs instead of repairing it', () => {
		const decoded = decodeCell('singleSelect', 'Planned');
		expect(decoded.kind).toBe('invalid');
		expect(decoded.kind === 'invalid' ? decoded.value.raw : undefined).toBe('Planned');
		// And the same value is exactly what a note path's label would be: the two identities are never
		// silently exchanged, which is the point of keeping them apart.
		const noteLabel = getField('singleSelect');
		const noteCtx = contextOf({
			fieldOptions: { options: [{ id: 'opt_1', name: 'Planned' }] },
		});
		expect(noteLabel?.toJson('Planned', noteCtx)).toBe('Planned');
	});

	it('refuses a label where the document requires an id, and writes an id it knows', () => {
		expect(encodeCell('singleSelect', 'Planned').kind).toBe('unwritable');
		expect(encodeCell('singleSelect', 'opt_' + 'a'.repeat(26))).toEqual({
			kind: 'write',
			json: 'opt_' + 'a'.repeat(26),
		});
		expect(SELECTS.length).toBe(2);
	});
});

describe('the numeric conventions are unchanged', () => {
	it('stores percent as percent points', () => {
		const percent = getField('percent');
		const parsed = percent?.parsePlain('25%', contextOf());
		expect(parsed?.ok ? parsed.value : undefined).toBe(25);
		expect(percent?.toJson(25, contextOf())).toBe(25);
		expect(encodeCell('percent', 25)).toEqual({ kind: 'write', json: 25 });
	});

	it('stores duration as seconds, whatever the column displays in', () => {
		const duration = getField('duration');
		const minutes = contextOf({ fieldOptions: { unit: 'minutes' } });
		// A bare number is read in the column's own unit: `1.5` minutes is 90 seconds, and seconds are
		// what is stored (`docs/03` §3) — the unit is a display/input convention, never the value.
		const bare = duration?.parsePlain('1.5', minutes);
		expect(bare?.ok ? bare.value : undefined).toBe(90);
		// A clock form is absolute, not column-relative: `1:30` is 1 h 30 m whatever the column shows in.
		const clock = duration?.parsePlain('1:30', minutes);
		expect(clock?.ok ? clock.value : undefined).toBe(5400);
		expect(duration?.toJson(90, minutes)).toBe(90);
		expect(encodeCell('duration', 90)).toEqual({ kind: 'write', json: 90 });
	});
});

describe('the vocabulary scan sees the whole tree', () => {
	it('finds the files it is supposed to read', () => {
		const files = sourceFiles();
		expect(files.length).toBeGreaterThan(80);
		expect(files.some((path) => path.endsWith('core/types.ts'))).toBe(true);
		expect(REGISTERED.length).toBe(16);
		expect(REGISTERED).not.toContain('createdTime');
	});
});
