/**
 * The shared contract suite, pointed at **every** descriptor in the shipped registry.
 *
 * The step-06 file ran the suite against `text` alone, because `text` was the only type that existed. This
 * file is the registry-wide version: it iterates `allFields()`, which means a type that registers itself is
 * proven by the same assertions the moment it exists, and a type that quietly stops honouring the contract
 * fails here rather than in the grid.
 *
 * It also states, as a test, the thing the step is really about: **the registered set equals the list in
 * `docs/03`**, in that order. A missing type is then a failing test rather than a discovery made in
 * production. `createdTime` and `lastModifiedTime` are absent as ordinary cell descriptors: legacy Bases
 * reads file timestamps (P11), while native tables derive them from row metadata (R3 step 7).
 */
import { describe, expect, it } from 'vitest';
import type { CellValue, FieldContext, FieldTypeId } from '../../src/core/types';
import { allFields, getField } from '../../src/core/fieldTypes';
import {
	DOCS_03_TYPES,
	NEVER_STORED_FIELD_IDS,
	makeContext,
	runFieldContractSuite,
} from './field-contract.suite';
import type { FieldFixture } from './field-contract.suite';

/** Timestamp ids handled as metadata by each adapter, not registered as ordinary cell types. */
const NEVER_STORED: readonly FieldTypeId[] = [...NEVER_STORED_FIELD_IDS];

const base = makeContext();

/** A context per type, so an option-dependent type is exercised with the options it actually reads. */
const contexts: Readonly<Partial<Record<FieldTypeId, FieldContext>>> = {
	currency: makeContext({ fieldOptions: { symbol: '$', precision: 2 } }),
	rating: makeContext({ fieldOptions: { max: 5 } }),
	singleSelect: makeContext({
		fieldOptions: {
			options: [
				{ id: 'o1', name: 'Todo' },
				{ id: 'o2', name: 'Doing' },
			],
		},
	}),
	multiSelect: makeContext({
		fieldOptions: {
			options: [
				{ id: 'o1', name: 'Draft' },
				{ id: 'o2', name: 'Research' },
			],
		},
	}),
};

/** Every fixture, keyed by id. Two entries are missing on purpose — see {@link NEVER_STORED}. */
const fixtures: Readonly<Partial<Record<FieldTypeId, FieldFixture<CellValue>>>> = {
	text: {
		ctx: base,
		values: [null, 'Widening', '道路'],
		filterCases: [
			{ op: 'is', value: 'Widening', operand: 'widening', expect: true },
			{ op: 'isNot', value: 'Widening', operand: 'Narrowing', expect: true },
			{ op: 'contains', value: 'Widening the road', operand: 'the', expect: true },
			{ op: 'notContains', value: 'Widening the road', operand: 'bridge', expect: true },
			{ op: 'startsWith', value: 'Widening', operand: 'Wid', expect: true },
			{ op: 'endsWith', value: 'Widening', operand: 'ing', expect: true },
			{ op: 'isEmpty', value: null, operand: '', expect: true },
			{ op: 'isNotEmpty', value: 'Widening', operand: '', expect: true },
		],
	},
	longText: {
		ctx: base,
		values: [null, 'one line', 'two\nlines'],
		filterCases: [
			{ op: 'is', value: 'one line', operand: 'ONE LINE', expect: true },
			{ op: 'isNot', value: 'one line', operand: 'two lines', expect: true },
			{ op: 'contains', value: 'two\nlines', operand: 'lines', expect: true },
			{ op: 'notContains', value: 'two\nlines', operand: 'three', expect: true },
			{ op: 'startsWith', value: 'two\nlines', operand: 'two', expect: true },
			{ op: 'endsWith', value: 'two\nlines', operand: 'lines', expect: true },
			{ op: 'isEmpty', value: null, operand: '', expect: true },
			{ op: 'isNotEmpty', value: 'two\nlines', operand: '', expect: true },
		],
	},
	number: {
		ctx: base,
		values: [null, 0, 12, -3.5, 1234.5],
		filterCases: [
			{ op: 'is', value: 12, operand: 12, expect: true },
			{ op: 'isNot', value: 12, operand: 13, expect: true },
			{ op: 'isEmpty', value: null, operand: '', expect: true },
			{ op: 'isNotEmpty', value: 0, operand: '', expect: true },
			{ op: 'gt', value: 12, operand: 11.5, expect: true },
			{ op: 'gte', value: 12, operand: 12, expect: true },
			{ op: 'lt', value: 12, operand: 13, expect: true },
			{ op: 'lte', value: 12, operand: 12, expect: true },
		],
	},
	checkbox: {
		ctx: base,
		values: [null, true, false],
		filterCases: [
			{ op: 'is', value: true, operand: 'yes', expect: true },
			{ op: 'isNot', value: true, operand: 'no', expect: true },
			{ op: 'isEmpty', value: null, operand: '', expect: true },
			{ op: 'isNotEmpty', value: false, operand: '', expect: true },
		],
	},
	date: {
		ctx: base,
		values: [null, '2026-10-05', '2024-02-29', '1000-01-01', '9999-12-31'],
		filterCases: [
			{ op: 'is', value: '2026-10-05', operand: '2026-10-05', expect: true },
			{ op: 'isNot', value: '2026-10-05', operand: '2026-10-06', expect: true },
			{ op: 'isEmpty', value: null, operand: '', expect: true },
			{ op: 'isNotEmpty', value: '2026-10-05', operand: '', expect: true },
			{ op: 'gt', value: '2026-10-05', operand: '2026-10-04', expect: true },
			{ op: 'gte', value: '2026-10-05', operand: '2026-10-05', expect: true },
			{ op: 'lt', value: '2026-10-05', operand: '2026-10-06', expect: true },
			{ op: 'lte', value: '2026-10-05', operand: '2026-10-05', expect: true },
		],
	},
	datetime: {
		ctx: base,
		values: [null, '2026-10-05T09:30:00Z', '2026-01-01T00:00:00Z'],
		filterCases: [
			{
				op: 'is',
				value: '2026-10-05T09:30:00Z',
				operand: '2026-10-05T09:30:00Z',
				expect: true,
			},
			{
				op: 'is',
				value: '2026-10-05T09:30:00Z',
				operand: '2026-10-05T15:30:00+06:00',
				expect: true,
			},
			{
				op: 'isNot',
				value: '2026-10-05T09:30:00Z',
				operand: '2026-10-05T09:30:01Z',
				expect: true,
			},
			{ op: 'isEmpty', value: null, operand: '', expect: true },
			{ op: 'isNotEmpty', value: '2026-10-05T09:30:00Z', operand: '', expect: true },
			{
				op: 'gt',
				value: '2026-10-05T09:30:00Z',
				operand: '2026-10-05T09:00:00Z',
				expect: true,
			},
			{
				op: 'gte',
				value: '2026-10-05T09:30:00Z',
				operand: '2026-10-05T09:30:00Z',
				expect: true,
			},
			{
				op: 'lt',
				value: '2026-10-05T09:30:00Z',
				operand: '2026-10-05T10:00:00Z',
				expect: true,
			},
			{
				op: 'lte',
				value: '2026-10-05T09:30:00Z',
				operand: '2026-10-05T09:30:00Z',
				expect: true,
			},
		],
	},
	url: {
		ctx: base,
		values: [null, 'https://example.com/docs', 'www.example.com'],
		filterCases: [
			{
				op: 'is',
				value: 'https://example.com',
				operand: 'https://example.com',
				expect: true,
			},
			{
				op: 'isNot',
				value: 'https://example.com',
				operand: 'https://other.test',
				expect: true,
			},
			{ op: 'contains', value: 'https://example.com/docs', operand: 'example', expect: true },
			{ op: 'notContains', value: 'https://example.com/docs', operand: 'mail', expect: true },
			{ op: 'startsWith', value: 'https://example.com', operand: 'https://', expect: true },
			{ op: 'endsWith', value: 'https://example.com', operand: '.com', expect: true },
			{ op: 'isEmpty', value: null, operand: '', expect: true },
			{ op: 'isNotEmpty', value: 'https://example.com', operand: '', expect: true },
		],
	},
	email: {
		ctx: base,
		values: [null, 'sam@example.com'],
		filterCases: [
			{ op: 'is', value: 'sam@example.com', operand: 'SAM@EXAMPLE.COM', expect: true },
			{ op: 'isNot', value: 'sam@example.com', operand: 'other@example.com', expect: true },
			{ op: 'contains', value: 'sam@example.com', operand: 'example', expect: true },
			{ op: 'notContains', value: 'sam@example.com', operand: 'other', expect: true },
			{ op: 'startsWith', value: 'sam@example.com', operand: 'sam', expect: true },
			{ op: 'endsWith', value: 'sam@example.com', operand: '.com', expect: true },
			{ op: 'isEmpty', value: null, operand: '', expect: true },
			{ op: 'isNotEmpty', value: 'sam@example.com', operand: '', expect: true },
		],
	},
	phone: {
		ctx: base,
		values: [null, '+1 (415) 555-0132'],
		filterCases: [
			{ op: 'is', value: '4155550132', operand: '4155550132', expect: true },
			{ op: 'isNot', value: '4155550132', operand: '4155550133', expect: true },
			{ op: 'contains', value: '+1 (415) 555-0132', operand: '415', expect: true },
			{ op: 'notContains', value: '+1 (415) 555-0132', operand: '999', expect: true },
			{ op: 'startsWith', value: '+1 (415) 555-0132', operand: '+1', expect: true },
			{ op: 'endsWith', value: '+1 (415) 555-0132', operand: '0132', expect: true },
			{ op: 'isEmpty', value: null, operand: '', expect: true },
			{ op: 'isNotEmpty', value: '+1 (415) 555-0132', operand: '', expect: true },
		],
	},
	singleSelect: {
		ctx: contexts.singleSelect ?? base,
		values: [null, 'Todo', 'Doing', 'Someday'],
		filterCases: [
			{ op: 'is', value: 'Todo', operand: 'todo', expect: true },
			{ op: 'isNot', value: 'Todo', operand: 'Doing', expect: true },
			{ op: 'contains', value: 'Doing', operand: 'do', expect: true },
			{ op: 'notContains', value: 'Doing', operand: 'xyz', expect: true },
			{ op: 'isEmpty', value: null, operand: '', expect: true },
			{ op: 'isNotEmpty', value: 'Todo', operand: '', expect: true },
		],
	},
	multiSelect: {
		ctx: contexts.multiSelect ?? base,
		values: [null, ['Draft'], ['Draft', 'Research'], ['Berlin, Mitte']],
		filterCases: [
			{ op: 'contains', value: ['Draft', 'Research'], operand: 'res', expect: true },
			{ op: 'contains', value: ['Draft', 'Research'], operand: 'zeta', expect: false },
			{ op: 'notContains', value: ['Draft'], operand: 'zeta', expect: true },
			{ op: 'isEmpty', value: null, operand: '', expect: true },
			{ op: 'isNotEmpty', value: ['Draft'], operand: '', expect: true },
		],
	},
	rating: {
		ctx: contexts.rating ?? base,
		values: [null, 0, 3, 4.5, 4.3, 5],
		filterCases: [
			{ op: 'is', value: 4.5, operand: 4.5, expect: true },
			{ op: 'isNot', value: 4.5, operand: 3, expect: true },
			{ op: 'isEmpty', value: null, operand: '', expect: true },
			{ op: 'isNotEmpty', value: 3, operand: '', expect: true },
			{ op: 'gt', value: 4.5, operand: 4, expect: true },
			{ op: 'gte', value: 4.5, operand: 4.5, expect: true },
			{ op: 'lt', value: 4.5, operand: 5, expect: true },
			{ op: 'lte', value: 4.5, operand: 4.5, expect: true },
		],
	},
	currency: {
		ctx: contexts.currency ?? base,
		values: [null, 0, -3.5, 1234.5],
		filterCases: [
			{ op: 'is', value: 1234.5, operand: 1234.5, expect: true },
			{ op: 'isNot', value: 1234.5, operand: 1, expect: true },
			{ op: 'isEmpty', value: null, operand: '', expect: true },
			{ op: 'isNotEmpty', value: 0, operand: '', expect: true },
			{ op: 'gt', value: 1234.5, operand: 1000, expect: true },
			{ op: 'gte', value: 1234.5, operand: 1234.5, expect: true },
			{ op: 'lt', value: 1234.5, operand: 2000, expect: true },
			{ op: 'lte', value: 1234.5, operand: 1234.5, expect: true },
		],
	},
	percent: {
		ctx: base,
		values: [null, 0, 25, -4],
		filterCases: [
			{ op: 'is', value: 25, operand: 25, expect: true },
			{ op: 'isNot', value: 25, operand: 26, expect: true },
			{ op: 'isEmpty', value: null, operand: '', expect: true },
			{ op: 'isNotEmpty', value: 0, operand: '', expect: true },
			{ op: 'gt', value: 25, operand: 24, expect: true },
			{ op: 'gte', value: 25, operand: 25, expect: true },
			{ op: 'lt', value: 25, operand: 26, expect: true },
			{ op: 'lte', value: 25, operand: 25, expect: true },
		],
	},
	duration: {
		ctx: base,
		values: [null, 0, 45, 2700, 7200],
		filterCases: [
			{ op: 'is', value: 2700, operand: 2700, expect: true },
			{ op: 'isNot', value: 2700, operand: 45, expect: true },
			{ op: 'isEmpty', value: null, operand: '', expect: true },
			{ op: 'isNotEmpty', value: 90, operand: '', expect: true },
			// An operand may be written the way a person writes a duration, not only in seconds.
			{ op: 'gt', value: 2700, operand: '44m', expect: true },
			// The same duration is not greater than itself — the bug an unanchored parse would hide.
			{ op: 'gt', value: 2700, operand: '45m', expect: false },
			{ op: 'gte', value: 2700, operand: '2700', expect: true },
			{ op: 'lt', value: 2700, operand: '1h', expect: true },
			{ op: 'lte', value: 2700, operand: '45m', expect: true },
		],
	},
	attachment: {
		ctx: base,
		values: [
			null,
			['Assets/wireframe.png'],
			['Assets/a.png', 'Assets/b.pdf'],
			['Assets/plan (1).pdf'],
		],
		filterCases: [
			{ op: 'contains', value: ['Assets/wireframe.png'], operand: 'wire', expect: true },
			{ op: 'contains', value: ['Assets/wireframe.png'], operand: 'budget', expect: false },
			{ op: 'notContains', value: ['Assets/wireframe.png'], operand: 'budget', expect: true },
			{ op: 'isEmpty', value: null, operand: '', expect: true },
			{ op: 'isNotEmpty', value: ['Assets/wireframe.png'], operand: '', expect: true },
		],
	},
};

describe('the registry against the mapping table in docs/03', () => {
	it('registers exactly the sixteen types the table lists, in its order', () => {
		expect(allFields().map((field) => field.id)).toEqual([...DOCS_03_TYPES]);
		expect(allFields()).toHaveLength(16);
	});

	it('has a fixture for every registered type, so no type skips the shared suite', () => {
		const missing = allFields()
			.map((field) => field.id)
			.filter((id) => fixtures[id] === undefined);
		expect(missing).toEqual([]);
	});

	it('never registers the two file-metadata ids, which are read-only columns instead', () => {
		for (const id of NEVER_STORED) {
			expect(getField(id)).toBeUndefined();
		}
	});
});

for (const field of allFields()) {
	const fixture = fixtures[field.id];
	if (fixture === undefined) {
		// Unreachable: the test above fails first. Kept so a new type cannot silently skip its suite.
		describe(`${field.id} — the field contract`, () => {
			it('has a fixture', () => {
				throw new Error(
					`${field.id} is registered but field-contract.all.test.ts has no fixture for it`,
				);
			});
		});
		continue;
	}
	runFieldContractSuite(field, fixture);
}
