/**
 * The stored form of a filter: the JSON shape a `.base` sidecar carries, and the constructors the AST is
 * built with.
 *
 * This file exists because the document path is the *untrusted* one. A DSL string was typed by a person who
 * is looking at the error message while they type; a sidecar was hand-edited, or written by an older build,
 * or synced from a vault where someone pasted YAML from elsewhere. So the rule under test is simple and
 * absolute: **decoding never throws, always answers, and names what it dropped.** A filter that quietly
 * becomes something else is worse than one that reports itself as broken.
 */
import { describe, expect, it } from 'vitest';
import {
	andOf,
	comparison,
	decodeQueryDocument,
	emptyOf,
	encodeQueryDocument,
	fieldById,
	fieldByName,
	fieldsMentioned,
	isFilterOpId,
	notOf,
	orOf,
	QUERY_DOCUMENT_VERSION,
	unparsedOf,
} from '../../src/core/query/ast';
import type { Expr, QueryContext } from '../../src/core/query/ast';
import { resolveField } from '../../src/core/schema/propertySchema';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import { makeContext } from './field-contract.suite';

const base = makeContext();

const fields: readonly ResolvedField[] = [
	resolveField(
		{
			id: 'note.Status',
			name: 'Status',
			source: 'database',
			fieldOptions: { type: 'singleSelect' },
		},
		base,
	),
	resolveField(
		{ id: 'note.Number', name: 'Number', source: 'database', fieldOptions: { type: 'number' } },
		base,
	),
];

const ctx: QueryContext = { fields };

describe('the AST constructors', () => {
	it('flattens nested groups of the same kind', () => {
		const inner = andOf([
			comparison('note.Number', 'gt', 1),
			comparison('note.Number', 'lt', 9),
		]);
		const outer = andOf([inner, comparison('note.Status', 'is', 'Doing')]);
		expect(outer.kind).toBe('and');
		expect(outer.kind === 'and' ? outer.parts : []).toHaveLength(3);
	});

	it('collapses a single part, so `and` of one thing *is* that thing', () => {
		const only = comparison('note.Number', 'is', 4);
		expect(andOf([only])).toBe(only);
		expect(orOf([andOf([only, only])])).toEqual(andOf([only, only]));
	});

	it('leaves an empty group empty, and documents what it means', () => {
		// An empty `and` is true and an empty `or` is false — the identity elements, deliberately kept as
		// empty groups rather than invented truth nodes. `serialize` writes nothing for either.
		expect(andOf([])).toEqual({ kind: 'and', parts: [] });
		expect(orOf([])).toEqual({ kind: 'or', parts: [] });
	});

	it('builds the leaf nodes as plain values', () => {
		expect(notOf(emptyOf('note.Number'))).toEqual({
			kind: 'not',
			part: { kind: 'empty', fieldId: 'note.Number' },
		});
		expect(unparsedOf('garbage')).toEqual({ kind: 'unparsed', text: 'garbage' });
		expect(comparison('note.Status', 'is', 'Doing')).toEqual({
			kind: 'cmp',
			fieldId: 'note.Status',
			op: 'is',
			operand: 'Doing',
		});
	});

	it('finds a column by id, and by name case-insensitively', () => {
		expect(fieldById(ctx, 'note.Status')?.definition.name).toBe('Status');
		expect(fieldById(ctx, 'note.Gone')).toBeUndefined();
		expect(fieldByName(ctx, 'number')?.definition.id).toBe('note.Number');
		expect(fieldByName(ctx, '  NUMBER  ')?.definition.id).toBe('note.Number');
		expect(fieldByName(ctx, 'Gone')).toBeUndefined();
	});

	it('recognises exactly the operators this build knows', () => {
		expect(isFilterOpId('startsWith')).toBe(true);
		expect(isFilterOpId('lte')).toBe(true);
		expect(isFilterOpId('EQUALS')).toBe(false);
		expect(isFilterOpId(4)).toBe(false);
		expect(isFilterOpId(undefined)).toBe(false);
	});

	it('lists the columns a filter names, once each, in the order they appear', () => {
		const expr: Expr = {
			kind: 'and',
			parts: [
				{ kind: 'cmp', fieldId: 'note.Number', op: 'gt', operand: 1 },
				{ kind: 'not', part: { kind: 'empty', fieldId: 'note.Status' } },
				{ kind: 'unparsed', text: 'nonsense' },
				{ kind: 'cmp', fieldId: 'note.Number', op: 'lt', operand: 9 },
			],
		};
		expect(fieldsMentioned(expr)).toEqual(['note.Number', 'note.Status']);
		expect(fieldsMentioned(null)).toEqual([]);
	});
});

describe('the stored document', () => {
	it('writes a versioned shape, and reads it back unchanged', () => {
		const expr: Expr = {
			kind: 'or',
			parts: [
				{ kind: 'cmp', fieldId: 'note.Status', op: 'is', operand: 'Doing' },
				{ kind: 'not', part: { kind: 'empty', fieldId: 'note.Number' } },
				{ kind: 'unparsed', text: 'half-typed' },
			],
		};
		const document = encodeQueryDocument(expr);
		expect(document.version).toBe(QUERY_DOCUMENT_VERSION);
		expect(JSON.parse(JSON.stringify(document))).toEqual(document);
		const decoded = decodeQueryDocument(JSON.parse(JSON.stringify(document)));
		expect(decoded.problems).toEqual([]);
		expect(decoded.expr).toEqual(expr);
	});

	it('writes `null` for no filter, and reads that back as no filter', () => {
		expect(encodeQueryDocument(null)).toEqual({ version: QUERY_DOCUMENT_VERSION, expr: null });
		expect(decodeQueryDocument(encodeQueryDocument(null))).toEqual({
			expr: null,
			problems: [],
		});
		expect(decodeQueryDocument(null)).toEqual({ expr: null, problems: [] });
		expect(decodeQueryDocument(undefined)).toEqual({ expr: null, problems: [] });
	});

	it('refuses what it cannot understand, by name, without throwing', () => {
		const cases: readonly {
			readonly label: string;
			readonly raw: unknown;
			readonly problem: string;
		}[] = [
			{ label: 'a string', raw: 'not a document', problem: 'not an object' },
			{ label: 'a list', raw: [1, 2, 3], problem: 'not an object' },
			{ label: 'no version', raw: { expr: null }, problem: 'no version' },
			{ label: 'another version', raw: { version: 99, expr: null }, problem: 'version 99' },
		];
		for (const testCase of cases) {
			const decoded = decodeQueryDocument(testCase.raw);
			expect(decoded.expr, testCase.label).toBeNull();
			expect(decoded.problems.join(' '), testCase.label).toContain(testCase.problem);
		}
	});

	it('drops one broken node and keeps the rest of the filter', () => {
		const raw = {
			version: QUERY_DOCUMENT_VERSION,
			expr: {
				kind: 'and',
				parts: [
					{ kind: 'cmp', fieldId: 'note.Number', op: 'gt', operand: 1 },
					{ kind: 'nonsense' },
					{ kind: 'cmp', fieldId: 'note.Number' },
					{ kind: 'cmp', op: 'is', operand: 'x' },
					{ kind: 'cmp', fieldId: 'note.Number', op: 'equals', operand: 1 },
					{ kind: 'empty', fieldId: 7 },
					{ kind: 'cmp', fieldId: 'note.Status', op: 'is', operand: 'Doing' },
				],
			},
		};
		const decoded = decodeQueryDocument(raw);
		expect(decoded.expr).toEqual({
			kind: 'and',
			parts: [
				{ kind: 'cmp', fieldId: 'note.Number', op: 'gt', operand: 1 },
				{ kind: 'cmp', fieldId: 'note.Status', op: 'is', operand: 'Doing' },
			],
		});
		const problems = decoded.problems.join(' | ');
		expect(problems).toContain('unknown kind');
		expect(problems).toContain('no field id');
		expect(problems).toContain('unknown operator');
		expect(problems).toContain('has no field id');
	});

	it('drops a broken `parts` list and a broken `not`, and keeps an unparsed node readable', () => {
		expect(
			decodeQueryDocument({
				version: 1,
				expr: { kind: 'and', parts: 'nope' },
			}).problems.join(),
		).toContain('no parts list');
		expect(
			decodeQueryDocument({ version: 1, expr: { kind: 'not', part: { kind: 'nope' } } }).expr,
		).toBeNull();
		expect(
			decodeQueryDocument({
				version: 1,
				expr: { kind: 'not', part: { kind: 'empty', fieldId: 'note.Number' } },
			}).expr,
		).toEqual({ kind: 'not', part: { kind: 'empty', fieldId: 'note.Number' } });
		expect(
			decodeQueryDocument({ version: 1, expr: { kind: 'unparsed', text: 42 } }).expr,
		).toEqual({
			kind: 'unparsed',
			text: '',
		});
		expect(
			decodeQueryDocument({ version: 1, expr: { kind: 'unparsed', text: 'kept' } }).expr,
		).toEqual({
			kind: 'unparsed',
			text: 'kept',
		});
		expect(decodeQueryDocument({ version: 1, expr: 12 }).problems.join()).toContain(
			'not an object',
		);
	});
});
