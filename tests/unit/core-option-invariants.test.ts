/**
 * Select-option membership — R1 step 6's other half.
 *
 * The value layer keeps any shaped option id (ADR-0004 §2: "an optionId string, even unknown") and
 * cannot judge membership, because the list belongs to the field. This file proves the judgment
 * lives exactly here, and that it has the same manners as the link scan:
 *
 *   1. **A coherent document has no findings** — single and multi selects whose cells name declared
 *      options, including the shipped fixtures.
 *   2. **An unknown id is reported and kept.** The finding names the field and the id, points at
 *      the exact cell (or the exact list position), and the stored value survives the round trip —
 *      deleting an option never rewrites the cells that named it.
 *   3. **A field that declares no options makes every stored id unknown** — the honest reading of
 *      an empty list, not a silent pass.
 *   4. **The value layer keeps its monopoly on value shapes**: a number stored in a select is one
 *      `invalid-cell-value`, and this scan adds nothing.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseDocument, serializeDocument, validateOptions } from '../../src/core/database/index';
import type { DatabaseDocument, JsonValue, OptionFinding } from '../../src/core/database/index';

const DATABASE_ID = 'db_' + 'z'.repeat(26);
const TABLE_ID = 'tbl_' + 'z'.repeat(26);
const F_TITLE = 'fld_' + 'a'.repeat(26);
const F_STATUS = 'fld_' + 'b'.repeat(26);
const F_TAGS = 'fld_' + 'c'.repeat(26);
const OPT_A = 'opt_' + 'a'.repeat(26);
const OPT_B = 'opt_' + 'b'.repeat(26);
const OPT_GHOST = 'opt_' + 'q'.repeat(26);
const R_ONE = 'row_' + 'a'.repeat(26);
const R_TWO = 'row_' + 'b'.repeat(26);

function text(id: string, name: string): JsonValue {
	return { id, name, type: 'text' };
}

function options(...ids: readonly string[]): JsonValue {
	return ids.map((id, index) => ({ id, name: `Option ${String(index)}` }));
}

function select(
	type: 'singleSelect' | 'multiSelect',
	id: string,
	name: string,
	opts: JsonValue,
): JsonValue {
	return { id, name, type, options: opts };
}

function row(id: string, cells: Readonly<Record<string, JsonValue>> = {}): JsonValue {
	return Object.keys(cells).length === 0 ? { id } : { id, cells };
}

function docTable(fields: JsonValue, rows: JsonValue = []): JsonValue {
	return { id: TABLE_ID, name: 'Tasks', fields, rows, views: [] };
}

function docText(tables: readonly JsonValue[]): string {
	return JSON.stringify({
		format: 'tablify',
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

function findingsOf(tables: readonly JsonValue[]): readonly OptionFinding[] {
	return validateOptions(loadOf(tables));
}

function warningCodesOf(tables: readonly JsonValue[]): readonly string[] {
	const result = parseDocument(docText(tables));
	if (!result.ok) {
		throw new Error('the test expected a load');
	}
	return result.warnings.map((warning) => warning.code);
}

describe('a coherent document', () => {
	it('produces no findings for declared option ids, single and multi', () => {
		const tables = [
			docTable(
				[
					text(F_TITLE, 'Title'),
					select('singleSelect', F_STATUS, 'Status', options(OPT_A, OPT_B)),
					select('multiSelect', F_TAGS, 'Tags', options(OPT_A, OPT_B)),
				],
				[row(R_ONE, { [F_STATUS]: OPT_A, [F_TAGS]: [OPT_A, OPT_B] })],
			),
		];
		expect(findingsOf(tables)).toEqual([]);
		expect(warningCodesOf(tables)).toEqual([]);
	});

	it('leaves the shipped fixtures without findings', () => {
		for (const name of ['rows-views', 'fields-basic']) {
			const fixture = new URL(`../fixtures/tablify/${name}.tablify`, import.meta.url);
			const result = parseDocument(readFileSync(fixture, 'utf8'));
			expect(result.ok).toBe(true);
			if (!result.ok) {
				continue;
			}
			expect(validateOptions(result.document)).toEqual([]);
		}
	});
});

describe('an option id the field does not declare', () => {
	it('is reported on a single select and kept, through the parser as a warning', () => {
		const tables = [
			docTable(
				[select('singleSelect', F_STATUS, 'Status', options(OPT_A))],
				[row(R_ONE, { [F_STATUS]: OPT_GHOST })],
			),
		];
		const findings = findingsOf(tables);
		expect(findings.map((finding) => finding.code)).toEqual(['unknown-option']);
		expect(findings[0]?.path).toBe(`$.tables[0].rows[0].cells.${F_STATUS}`);
		expect(findings[0]?.message).toContain('"Status"');
		expect(findings[0]?.message).toContain(OPT_GHOST);
		expect(warningCodesOf(tables)).toEqual(['unknown-option']);
		expect(serializeDocument(loadOf(tables))).toContain(OPT_GHOST);
	});

	it('is reported at its exact position inside a multi select', () => {
		const tables = [
			docTable(
				[select('multiSelect', F_TAGS, 'Tags', options(OPT_A, OPT_B))],
				[row(R_ONE, { [F_TAGS]: [OPT_A, OPT_GHOST, OPT_B] })],
			),
		];
		const findings = findingsOf(tables);
		expect(findings.map((finding) => finding.path)).toEqual([
			`$.tables[0].rows[0].cells.${F_TAGS}[1]`,
		]);
	});

	it('is reported for every stored id when the field declares an empty option list', () => {
		const tables = [
			docTable(
				[select('singleSelect', F_STATUS, 'Status', options())],
				[row(R_ONE, { [F_STATUS]: OPT_A })],
			),
		];
		const findings = findingsOf(tables);
		expect(findings.map((finding) => finding.code)).toEqual(['unknown-option']);
		expect(findings[0]?.message).toContain(OPT_A);
	});

	it('reports in document order — rows in the order the file lists them', () => {
		const tables = [
			docTable(
				[select('singleSelect', F_STATUS, 'Status', options(OPT_A))],
				[row(R_ONE, { [F_STATUS]: OPT_GHOST }), row(R_TWO, { [F_STATUS]: OPT_B })],
			),
		];
		expect(findingsOf(tables).map((finding) => finding.path)).toEqual([
			`$.tables[0].rows[0].cells.${F_STATUS}`,
			`$.tables[0].rows[1].cells.${F_STATUS}`,
		]);
	});
});

describe('the value layer keeps its monopoly on value shapes', () => {
	it('does not repeat a value the value layer already reported', () => {
		const tables = [
			docTable(
				[select('singleSelect', F_STATUS, 'Status', options(OPT_A))],
				[row(R_ONE, { [F_STATUS]: 42 })],
			),
		];
		expect(warningCodesOf(tables)).toEqual(['invalid-cell-value']);
		expect(findingsOf(tables)).toEqual([]);
	});
});
