/**
 * Relation-graph properties — the R1 exit criterion "property-based tests cover … relation graph
 * validation", written as the reproducible form of what the example-based suites assert.
 *
 * A seeded generator builds two to three tables of text, number, select and link fields — the links
 * pointing at real tables, half of them with a declared generated inverse, the rows carrying both
 * well-shaped and deliberately broken references — and then checks the promises that must hold for
 * *every* document, not just the fixtures:
 *
 *   1. **The scan never throws and never depends on a previous call.** Two runs over one document
 *      return the same findings, in the same order.
 *   2. **A coherent graph has no findings.** If the generator injected nothing, the load is silent.
 *   3. **Every injected break is reported, and only as a warning.** The load still succeeds, the
 *      injected id is still in the written text, and some finding names it.
 *   4. **The parser's findings are exactly the scans' findings.** What `parseDocument` attaches is
 *      `validateLinks` then `validateOptions`, in that order — the property that keeps the scan the
 *      single source of truth.
 */
import { describe, expect, it } from 'vitest';

import { parseDocument, serializeDocument } from '../../src/core/database/index';
import { validateLinks } from '../../src/core/database/links';
import { validateOptions } from '../../src/core/database/options';
import type { LoadWarning } from '../../src/core/database/index';

const ITERATIONS = 150;

/** Seeded PRNG, the same one the other property suites use. */
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

function body(counter: number): string {
	return counter.toString(36).padStart(26, '0');
}

function id(kind: string, counter: number): string {
	return `${kind}_${body(counter)}`;
}

const WORDS = ['dawn', 'roof', 'lens', 'edit', 'reel', 'call', 'mood', 'tint'] as const;

/** A row id the generator made up on purpose: no table will contain it. */
function ghostRowId(random: () => number): string {
	return id('row', 900000 + Math.floor(random() * 1000));
}

/** An option id no field declares. */
function ghostOptionId(random: () => number): string {
	return id('opt', 900000 + Math.floor(random() * 1000));
}

type Injection =
	| { readonly kind: 'dangling-row'; readonly id: string }
	| { readonly kind: 'wrong-table-row'; readonly id: string }
	| { readonly kind: 'ghost-option'; readonly id: string }
	| { readonly kind: 'cardinality' };

interface Built {
	readonly text: string;
	readonly injections: readonly Injection[];
}

interface DraftField {
	id: string;
	name: string;
	type: string;
	targetTableId?: string;
	allowMultiple?: boolean;
	inverseFieldId?: string;
	generated?: boolean;
	options?: readonly { readonly id: string; readonly name: string }[];
}

interface DraftTable {
	readonly id: string;
	readonly name: string;
	readonly fields: DraftField[];
	readonly extraFields: DraftField[];
	readonly rows: { id: string; cells: Record<string, unknown> }[];
}

/** Build one document: some values are coherent, some are broken on purpose. */
function build(seed: number): Built {
	const random = mulberry32(seed);
	const int = (bound: number): number => Math.floor(random() * bound);
	const injections: Injection[] = [];

	let nextField = 0;
	let nextRow = 0;
	let nextOption = 0;

	const tableCount = 2 + int(2);
	const tables: DraftTable[] = [];
	for (let index = 0; index < tableCount; index += 1) {
		tables.push({
			id: id('tbl', index),
			name: `Table ${String(index)}`,
			fields: [],
			extraFields: [],
			rows: [],
		});
	}

	for (const [tableIndex, table] of tables.entries()) {
		const fieldCount = 1 + int(4);
		for (let index = 0; index < fieldCount; index += 1) {
			const roll = int(4);
			const fieldId = id('fld', nextField);
			nextField += 1;
			if (roll === 0) {
				table.fields.push({ id: fieldId, name: `Text ${String(index)}`, type: 'text' });
				continue;
			}
			if (roll === 1) {
				table.fields.push({ id: fieldId, name: `Number ${String(index)}`, type: 'number' });
				continue;
			}
			if (roll === 2) {
				const optionCount = 1 + int(2);
				const options = [];
				for (let option = 0; option < optionCount; option += 1) {
					options.push({ id: id('opt', nextOption), name: `Option ${String(option)}` });
					nextOption += 1;
				}
				table.fields.push({
					id: fieldId,
					name: `Status ${String(index)}`,
					type: 'singleSelect',
					options,
				});
				continue;
			}
			// A link field. Its target exists, or the graph would be broken by construction; the
			// breakage this property injects is in the values, where a user edit would put it.
			const targetIndex = int(tables.length);
			const target = tables[targetIndex];
			if (target === undefined) {
				continue;
			}
			const field: DraftField = {
				id: fieldId,
				name: `Link ${String(index)}`,
				type: 'link',
				targetTableId: target.id,
				allowMultiple: random() < 0.5,
			};
			if (random() < 0.6) {
				// Declare a generated inverse on the target table, pointing back here.
				const inverseId = id('fld', nextField);
				nextField += 1;
				field.inverseFieldId = inverseId;
				target.extraFields.push({
					id: inverseId,
					name: `Inverse ${String(tableIndex)}`,
					type: 'link',
					targetTableId: table.id,
					allowMultiple: true,
					generated: true,
				});
			}
			table.fields.push(field);
		}
	}
	for (const table of tables) {
		table.fields.push(...table.extraFields);
	}

	// Rows: one to six per table; every stored cell is a value of its field's type — or a
	// deliberately broken reference.
	for (const table of tables) {
		const rowCount = 1 + int(6);
		for (let index = 0; index < rowCount; index += 1) {
			table.rows.push({ id: id('row', nextRow), cells: {} });
			nextRow += 1;
		}
	}
	for (const table of tables) {
		for (const field of table.fields) {
			if (field.generated === true) {
				continue;
			}
			const target = tables.find((candidate) => candidate.id === field.targetTableId);
			for (const row of table.rows) {
				if (field.type === 'text') {
					row.cells[field.id] = WORDS[int(WORDS.length)] ?? 'word';
					continue;
				}
				if (field.type === 'number') {
					row.cells[field.id] = int(1000) / 4;
					continue;
				}
				if (field.type === 'singleSelect') {
					const options = field.options ?? [];
					const declared = options[int(options.length)];
					if (declared !== undefined && random() < 0.85) {
						row.cells[field.id] = declared.id;
					} else {
						const ghost = ghostOptionId(random);
						injections.push({ kind: 'ghost-option', id: ghost });
						row.cells[field.id] = ghost;
					}
					continue;
				}
				if (field.type !== 'link' || target === undefined) {
					continue;
				}
				const reference = int(10);
				let value: string;
				if (reference < 2) {
					const ghost = ghostRowId(random);
					injections.push({ kind: 'dangling-row', id: ghost });
					value = ghost;
				} else if (reference < 3) {
					// A row id that exists — but in another table.
					const other = tables.find(
						(candidate) => candidate.id !== target.id && candidate.rows.length > 0,
					);
					const otherRow = other?.rows[int(other.rows.length)];
					if (otherRow === undefined) {
						continue;
					}
					injections.push({ kind: 'wrong-table-row', id: otherRow.id });
					value = otherRow.id;
				} else {
					const targetRow = target.rows[int(target.rows.length)];
					if (targetRow === undefined) {
						continue;
					}
					value = targetRow.id;
				}
				if (random() < 0.12) {
					// The shape contradicts the declared cardinality.
					injections.push({ kind: 'cardinality' });
					row.cells[field.id] = field.allowMultiple === true ? value : [value];
				} else {
					row.cells[field.id] = field.allowMultiple === true ? [value] : value;
				}
			}
		}
	}

	const document = {
		format: 'tablify',
		version: 1,
		databaseId: id('db', seed),
		name: `Generated ${String(seed)}`,
		tables: tables.map((table) => ({
			id: table.id,
			name: table.name,
			fields: table.fields,
			rows: table.rows,
			views: [],
		})),
	};
	return { text: `${JSON.stringify(document, null, 2)}\n`, injections };
}

function stampsOf(warnings: readonly LoadWarning[]): string[] {
	return warnings.map((warning) => `${warning.code}@${warning.path}`);
}

describe('every generated relation graph', () => {
	it(`holds the scan properties over ${String(ITERATIONS)} seeds`, () => {
		// The mix is counted, not assumed: a generator that silently stopped producing a case
		// would otherwise turn this property into a test of nothing.
		const totals = new Map<string, number>();
		const count = (kind: string): void => {
			totals.set(kind, (totals.get(kind) ?? 0) + 1);
		};

		for (let seed = 0; seed < ITERATIONS; seed += 1) {
			const built = build(seed);
			const at = `seed ${String(seed)}`;
			for (const injection of built.injections) {
				count(injection.kind);
			}
			if (built.injections.length === 0) {
				count('coherent');
			}

			const first = parseDocument(built.text);
			expect(first.ok, `${at}: the document must be structurally valid`).toBe(true);
			if (!first.ok) {
				continue;
			}

			// 1. Determinism: same document in, same findings out, twice.
			const again = parseDocument(built.text);
			expect(again.ok, at).toBe(true);
			if (!again.ok) {
				continue;
			}
			expect(stampsOf(again.warnings), `${at}: findings are not deterministic`).toEqual(
				stampsOf(first.warnings),
			);

			const document = first.document;
			const linkFindings = validateLinks(document);
			const optionFindings = validateOptions(document);

			// 4. The parser's findings are exactly the scans' findings, and never duplicated.
			expect(stampsOf(first.warnings), `${at}: parser findings != scans`).toEqual([
				...linkFindings.map((finding) => `${finding.code}@${finding.path}`),
				...optionFindings.map((finding) => `${finding.code}@${finding.path}`),
			]);
			const stamps = stampsOf(first.warnings);
			expect(new Set(stamps).size, `${at}: a finding is reported twice`).toBe(stamps.length);

			// 3. Every injected break is reported, and nothing was dropped from the text.
			const written = serializeDocument(document);
			for (const injection of built.injections) {
				if (injection.kind === 'cardinality') {
					expect(
						first.warnings.some(
							(warning) => warning.code === 'link-cardinality-mismatch',
						),
						`${at}: a cardinality mismatch went unreported`,
					).toBe(true);
					continue;
				}
				expect(
					written.includes(injection.id),
					`${at}: injected ${injection.kind} was dropped`,
				).toBe(true);
				expect(
					first.warnings.some((warning) => warning.message.includes(injection.id)),
					`${at}: injected ${injection.kind} ${injection.id} went unreported`,
				).toBe(true);
			}

			// 2. A document with nothing injected loads silently.
			if (built.injections.length === 0) {
				expect(first.warnings, `${at}: a coherent graph produced findings`).toEqual([]);
			}

			// The load is always a load: warnings never turn into a refusal, and writing is stable.
			expect(serializeDocument(document)).toBe(written);
		}

		for (const kind of [
			'coherent',
			'dangling-row',
			'wrong-table-row',
			'ghost-option',
			'cardinality',
		]) {
			expect(
				totals.get(kind) ?? 0,
				`the generator never produced a "${kind}" case`,
			).toBeGreaterThan(0);
		}
	});
});
