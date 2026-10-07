/**
 * Linked-record invariants — R1 step 6's gate.
 *
 * [ADR-0001](../docs/adr/ADR-0001-link-cardinality.md) promised this file by name, and the promise
 * shapes what is proven here:
 *
 *   1. **A coherent document has no findings.** Both cardinalities, an explicit generated inverse,
 *      and a self-referencing link all load silently — including the two shipped fixtures, so the
 *      fixtures and the validator are proven against each other.
 *   2. **A broken reference is kept and reported, not repaired.** The `unresolved-link` finding
 *      distinguishes *no such row* from *a row of another table* by naming the table that does own
 *      the id, and the stored value survives the round trip untouched.
 *   3. **The declaration checks are findings too, never refusals.** A dangling or non-link
 *      `inverseFieldId`, an inverse that points elsewhere, an inverse that is not marked generated,
 *      a stored value on a generated field, a cardinality contradiction, a link into a table this
 *      document does not have — each is one warning on a document that still opens.
 *   4. **The value layer keeps its monopoly on value shapes.** A link cell that is not a row id, or
 *      a list with a duplicate, is reported once by the value layer and never again by this scan.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
	FORMAT_TAG,
	parseDocument,
	serializeDocument,
	validateLinks,
} from '../../src/core/database/index';
import type {
	DatabaseDocument,
	JsonValue,
	LinkFinding,
	LoadWarning,
	TableField,
} from '../../src/core/database/index';

const DATABASE_ID = 'db_' + 'z'.repeat(26);
const TA = 'tbl_' + 'a'.repeat(26);
const TB = 'tbl_' + 'b'.repeat(26);
const TC = 'tbl_' + 'c'.repeat(26);
const GHOST_TABLE = 'tbl_' + 'q'.repeat(26);
const F_TITLE = 'fld_' + 't'.repeat(26);
const F_NAME = 'fld_' + 'n'.repeat(26);
const F_CLIENT = 'fld_' + 'c'.repeat(26);
const F_TEAM = 'fld_' + 'm'.repeat(26);
const F_INVERSE = 'fld_' + 'i'.repeat(26);
const F_BUDDY = 'fld_' + 'b'.repeat(26);
const F_GHOST = 'fld_' + 'q'.repeat(26);
const R_A1 = 'row_' + 'a'.repeat(26);
const R_A2 = 'row_' + 'b'.repeat(26);
const R_B1 = 'row_' + 'c'.repeat(26);
const R_B2 = 'row_' + 'd'.repeat(26);
const R_GHOST = 'row_' + 'z'.repeat(26);
const R_GHOST_2 = 'row_' + 'y'.repeat(26);

function text(id: string, name: string): JsonValue {
	return { id, name, type: 'text' };
}

function link(id: string, name: string, settings: Readonly<Record<string, JsonValue>>): JsonValue {
	return { id, name, type: 'link', ...settings };
}

function row(id: string, cells: Readonly<Record<string, JsonValue>> = {}): JsonValue {
	return Object.keys(cells).length === 0 ? { id } : { id, cells };
}

function docTable(id: string, name: string, fields: JsonValue, rows: JsonValue = []): JsonValue {
	return { id, name, fields, rows, views: [] };
}

function docText(tables: readonly JsonValue[]): string {
	return JSON.stringify({
		format: FORMAT_TAG,
		version: 1,
		databaseId: DATABASE_ID,
		name: 'Test',
		tables,
	});
}

function loadOf(tables: readonly JsonValue[]): DatabaseDocument {
	const result = parseDocument(docText(tables));
	if (!result.ok) {
		throw new Error(
			`expected a load; got ${result.errors.map((error) => `${error.code} at ${error.path}`).join(', ')}`,
		);
	}
	return result.document;
}

function findingsOf(tables: readonly JsonValue[]): readonly LinkFinding[] {
	return validateLinks(loadOf(tables));
}

function warningsOf(tables: readonly JsonValue[]): readonly LoadWarning[] {
	const result = parseDocument(docText(tables));
	if (!result.ok) {
		throw new Error('the test expected a load');
	}
	return result.warnings;
}

/** The coherent pair: a single link and a multi link into Clients, whose inverse is generated. */
function baseTables(): readonly JsonValue[] {
	return [
		docTable(
			TA,
			'Shoots',
			[
				text(F_TITLE, 'Title'),
				link(F_CLIENT, 'Client', { targetTableId: TB, inverseFieldId: F_INVERSE }),
				link(F_TEAM, 'Team', { targetTableId: TB, allowMultiple: true }),
			],
			[row(R_A1, { [F_CLIENT]: R_B1, [F_TEAM]: [R_B1] }), row(R_A2)],
		),
		docTable(
			TB,
			'Clients',
			[
				text(F_NAME, 'Name'),
				link(F_INVERSE, 'Shoots', {
					targetTableId: TA,
					allowMultiple: true,
					generated: true,
				}),
			],
			[row(R_B1), row(R_B2)],
		),
	];
}

describe('a coherent document', () => {
	it('produces no findings — single and multi links, an explicit generated inverse', () => {
		expect(findingsOf(baseTables())).toEqual([]);
		expect(warningsOf(baseTables())).toEqual([]);
	});

	it('accepts a link into its own table', () => {
		const tables = [
			docTable(
				TA,
				'Shoots',
				[link(F_BUDDY, 'Buddy', { targetTableId: TA })],
				[row(R_A1, { [F_BUDDY]: R_A2 }), row(R_A2)],
			),
		];
		expect(findingsOf(tables)).toEqual([]);
	});

	it('leaves the shipped fixtures without findings — their links all resolve', () => {
		for (const name of ['rows-views', 'fields-basic']) {
			const fixture = new URL(`../fixtures/tablify/${name}.tablify`, import.meta.url);
			const result = parseDocument(readFileSync(fixture, 'utf8'));
			expect(result.ok).toBe(true);
			if (!result.ok) {
				continue;
			}
			expect(validateLinks(result.document)).toEqual([]);
		}
	});
});

describe('a reference that resolves to no row', () => {
	it('is kept and reported as unresolved, naming the field, the id and the target table', () => {
		const tables = [
			docTable(
				TA,
				'Shoots',
				[link(F_CLIENT, 'Client', { targetTableId: TB, inverseFieldId: F_INVERSE })],
				[row(R_A1, { [F_CLIENT]: R_GHOST })],
			),
			docTable(
				TB,
				'Clients',
				[
					link(F_INVERSE, 'Shoots', {
						targetTableId: TA,
						allowMultiple: true,
						generated: true,
					}),
				],
				[row(R_B1)],
			),
		];
		const findings = findingsOf(tables);
		expect(findings.map((finding) => finding.code)).toEqual(['unresolved-link']);
		expect(findings[0]?.path).toBe(`$.tables[0].rows[0].cells.${F_CLIENT}`);
		expect(findings[0]?.message).toContain(R_GHOST);
		expect(findings[0]?.message).toContain('"Clients"');
		expect(findings[0]?.message).toContain('no row with that id');
		expect(serializeDocument(loadOf(tables))).toContain(R_GHOST);
	});

	it('distinguishes a row of another table, and names that table', () => {
		const tables = [
			docTable(
				TA,
				'Shoots',
				[link(F_CLIENT, 'Client', { targetTableId: TB, inverseFieldId: F_INVERSE })],
				[row(R_A1, { [F_CLIENT]: R_A2 }), row(R_A2)],
			),
			docTable(
				TB,
				'Clients',
				[
					link(F_INVERSE, 'Shoots', {
						targetTableId: TA,
						allowMultiple: true,
						generated: true,
					}),
				],
				[row(R_B1)],
			),
		];
		const findings = findingsOf(tables);
		expect(findings.map((finding) => finding.code)).toEqual(['unresolved-link']);
		expect(findings[0]?.message).toContain(R_A2);
		expect(findings[0]?.message).toContain('"Shoots"');
		expect(findings[0]?.message).toContain('rather than');
	});

	it('reports findings in document order — rows in the order the file lists them', () => {
		const tables = [
			docTable(
				TA,
				'Shoots',
				[link(F_CLIENT, 'Client', { targetTableId: TB, inverseFieldId: F_INVERSE })],
				[row(R_A1, { [F_CLIENT]: R_GHOST }), row(R_A2, { [F_CLIENT]: R_GHOST_2 })],
			),
			docTable(
				TB,
				'Clients',
				[
					link(F_INVERSE, 'Shoots', {
						targetTableId: TA,
						allowMultiple: true,
						generated: true,
					}),
				],
				[row(R_B1)],
			),
		];
		const findings = findingsOf(tables);
		expect(findings.map((finding) => finding.path)).toEqual([
			`$.tables[0].rows[0].cells.${F_CLIENT}`,
			`$.tables[0].rows[1].cells.${F_CLIENT}`,
		]);
	});
});

describe('the stored shape against the declared cardinality', () => {
	it('reports a list stored in a single link, keeping the value', () => {
		const tables = [
			docTable(
				TA,
				'Shoots',
				[link(F_CLIENT, 'Client', { targetTableId: TB, inverseFieldId: F_INVERSE })],
				[row(R_A1, { [F_CLIENT]: [R_B1] })],
			),
			docTable(
				TB,
				'Clients',
				[
					link(F_INVERSE, 'Shoots', {
						targetTableId: TA,
						allowMultiple: true,
						generated: true,
					}),
				],
				[row(R_B1)],
			),
		];
		const findings = findingsOf(tables);
		expect(findings.map((finding) => finding.code)).toEqual(['link-cardinality-mismatch']);
		expect(findings[0]?.path).toBe(`$.tables[0].rows[0].cells.${F_CLIENT}`);
		expect(findings[0]?.message).toContain('declared single');
		expect(findings[0]?.message).toContain('list of 1');
	});

	it('reports a single id stored in a multi link', () => {
		const tables = [
			docTable(
				TA,
				'Shoots',
				[link(F_TEAM, 'Team', { targetTableId: TB, allowMultiple: true })],
				[row(R_A1, { [F_TEAM]: R_B1 })],
			),
			docTable(TB, 'Clients', [text(F_NAME, 'Name')], [row(R_B1)]),
		];
		const findings = findingsOf(tables);
		expect(findings.map((finding) => finding.code)).toEqual(['link-cardinality-mismatch']);
		expect(findings[0]?.message).toContain('declared multi');
	});
});

describe('the inverse declaration', () => {
	it('reports an inverse id the target table does not have, and keeps the declaration', () => {
		const tables = [
			docTable(
				TA,
				'Shoots',
				[link(F_CLIENT, 'Client', { targetTableId: TB, inverseFieldId: F_GHOST })],
				[],
			),
			docTable(TB, 'Clients', [text(F_NAME, 'Name')], []),
		];
		const findings = findingsOf(tables);
		expect(findings.map((finding) => finding.code)).toEqual(['missing-inverse-field']);
		expect(findings[0]?.path).toBe(`$.tables[0].fields[0].inverseFieldId`);
		expect(findings[0]?.message).toContain(F_GHOST);
		expect(findings[0]?.message).toContain('"Clients"');
	});

	it('reports an inverse that names a field which is not a link', () => {
		const tables = [
			docTable(
				TA,
				'Shoots',
				[link(F_CLIENT, 'Client', { targetTableId: TB, inverseFieldId: F_INVERSE })],
				[],
			),
			docTable(TB, 'Clients', [text(F_INVERSE, 'Inbound')], []),
		];
		const findings = findingsOf(tables);
		expect(findings.map((finding) => finding.code)).toEqual(['inverse-not-a-link']);
		expect(findings[0]?.message).toContain('"text"');
	});

	it('reports an inverse that points into a third table, naming it', () => {
		const tables = [
			docTable(
				TA,
				'Shoots',
				[link(F_CLIENT, 'Client', { targetTableId: TB, inverseFieldId: F_INVERSE })],
				[],
			),
			docTable(
				TB,
				'Clients',
				[
					text(F_NAME, 'Name'),
					link(F_INVERSE, 'Shoots', {
						targetTableId: TC,
						allowMultiple: true,
						generated: true,
					}),
				],
				[],
			),
			docTable(TC, 'Archive', [text(F_TITLE, 'Title')], []),
		];
		const findings = findingsOf(tables);
		expect(findings.map((finding) => finding.code)).toEqual(['inverse-target-mismatch']);
		expect(findings[0]?.path).toBe(`$.tables[1].fields[1].targetTableId`);
		expect(findings[0]?.message).toContain('"Archive"');
	});

	it('reports an inverse that is not marked generated', () => {
		const tables = [
			docTable(
				TA,
				'Shoots',
				[link(F_CLIENT, 'Client', { targetTableId: TB, inverseFieldId: F_INVERSE })],
				[],
			),
			docTable(
				TB,
				'Clients',
				[
					text(F_NAME, 'Name'),
					link(F_INVERSE, 'Shoots', { targetTableId: TA, allowMultiple: true }),
				],
				[],
			),
		];
		const findings = findingsOf(tables);
		expect(findings.map((finding) => finding.code)).toEqual(['inverse-not-generated']);
		expect(findings[0]?.path).toBe(`$.tables[1].fields[1].generated`);
		expect(findings[0]?.message).toContain('"generated"');
	});
});

describe('a generated field with stored values', () => {
	it('is reported once for the field, with the count and the first location', () => {
		const tables = [
			docTable(TA, 'Shoots', [text(F_TITLE, 'Title')], [row(R_A1)]),
			docTable(
				TB,
				'Clients',
				[
					text(F_NAME, 'Name'),
					link(F_INVERSE, 'Shoots', {
						targetTableId: TA,
						allowMultiple: true,
						generated: true,
					}),
				],
				[row(R_B1, { [F_INVERSE]: R_GHOST }), row(R_B2, { [F_INVERSE]: [R_A1] })],
			),
		];
		const findings = findingsOf(tables);
		expect(findings.map((finding) => finding.code)).toEqual(['generated-inverse-with-cells']);
		expect(findings[0]?.path).toBe(`$.tables[1].fields[1]`);
		expect(findings[0]?.message).toContain('2 rows still carry stored values');
		expect(findings[0]?.message).toContain(`$.tables[1].rows[0].cells.${F_INVERSE}`);
		// The stored values are not treated as references: the dangling id and the non-list shape
		// inside them add nothing, because a generated field is not a source of truth.
		expect(findings[0]?.message).not.toContain('unresolved');
		const once = serializeDocument(loadOf(tables));
		expect(once).toContain(R_GHOST);
		expect(once).toContain('"generated": true');
	});
});

describe('a link into a table this document does not have', () => {
	it('is one finding on the field — not one per stored value', () => {
		const tables = [
			docTable(
				TA,
				'Shoots',
				[
					link(F_CLIENT, 'Client', {
						targetTableId: GHOST_TABLE,
						inverseFieldId: F_INVERSE,
					}),
				],
				[row(R_A1, { [F_CLIENT]: R_A2 })],
			),
			docTable(TB, 'Clients', [text(F_NAME, 'Name')], []),
		];
		const findings = findingsOf(tables);
		expect(findings.map((finding) => finding.code)).toEqual(['unknown-link-target-table']);
		expect(findings[0]?.path).toBe(`$.tables[0].fields[0].targetTableId`);
		expect(findings[0]?.message).toContain(GHOST_TABLE);
	});
});

describe('the value layer keeps its monopoly on value shapes', () => {
	it('does not repeat a value the value layer already reported', () => {
		const badString = [
			docTable(
				TA,
				'Shoots',
				[link(F_CLIENT, 'Client', { targetTableId: TB })],
				[row(R_A1, { [F_CLIENT]: 'Tomorrow' })],
			),
			docTable(TB, 'Clients', [text(F_NAME, 'Name')], [row(R_B1)]),
		];
		expect(warningsOf(badString).map((warning) => warning.code)).toEqual([
			'invalid-cell-value',
		]);
		expect(findingsOf(badString)).toEqual([]);

		const duplicateList = [
			docTable(
				TA,
				'Shoots',
				[link(F_TEAM, 'Team', { targetTableId: TB, allowMultiple: true })],
				[row(R_A1, { [F_TEAM]: [R_B1, R_B1] })],
			),
			docTable(TB, 'Clients', [text(F_NAME, 'Name')], [row(R_B1)]),
		];
		expect(warningsOf(duplicateList).map((warning) => warning.code)).toEqual([
			'invalid-cell-value',
		]);
		expect(findingsOf(duplicateList)).toEqual([]);
	});
});

describe('the public contract of validateLinks', () => {
	it('works on a hand-assembled model and an empty document', () => {
		const field: TableField = {
			kind: 'field',
			id: F_CLIENT,
			name: 'Client',
			type: 'link',
			settings: {},
			unknown: [],
		};
		const document: DatabaseDocument = {
			format: FORMAT_TAG,
			version: 1,
			databaseId: DATABASE_ID,
			name: 'Hand-built',
			tables: [{ id: TA, name: 'Shoots', fields: [field], rows: [], views: [], unknown: [] }],
			unknown: [],
		};
		const findings = validateLinks(document);
		expect(findings.map((finding) => finding.code)).toEqual(['unknown-link-target-table']);
		expect(findings[0]?.message).toContain('names no table');

		const empty: DatabaseDocument = {
			format: FORMAT_TAG,
			version: 1,
			databaseId: DATABASE_ID,
			name: 'Empty',
			tables: [],
			unknown: [],
		};
		expect(validateLinks(empty)).toEqual([]);
	});
});
