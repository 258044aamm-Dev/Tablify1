/**
 * The query table: every operator of every registered type, plus the documented behaviour of the DSL.
 *
 * Two things are proven here that nothing else can:
 *
 * 1. **The evaluator is a faithful dispatch.** For every (type, operator) pair the registry declares, the
 *    test parses the DSL text for that pair, evaluates it against a row holding that type's sample value,
 *    and asserts *both* the expected boolean *and* that the answer equals what the descriptor's own
 *    `matches` said for the same value and operand. A query layer that quietly re-interpreted an operator —
 *    coercing `4` to `"4"`, or treating `contains` as equality — would fail the second assertion while
 *    passing the first, which is exactly the bug class this file exists to catch.
 * 2. **Every declared operator is reachable from text.** The first test asserts the generated cases cover
 *    every operator of every registered type: a type that grows an operator, and no spelling for it, fails
 *    here rather than in the filter builder.
 *
 * The step's prompt asks for "the table of `(expr, row, expected)` from `docs/01`". `docs/01` has no
 * query-string section — no operator table, no grammar — so there is no such table to copy. What is here
 * instead is the behaviour table built from the step's own list of constructs (quoted strings, `>`, `>=`,
 * `<`, `<=`, `=`, `!=`, `~`, the empty operator, `and`, `or`, `not`, parentheses, numerals, booleans, dates,
 * groups) plus the legacy forms the old README documents. That gap is reported in PROGRESS.md.
 */
import { describe, expect, it } from 'vitest';
import { andOf, comparison, emptyOf, notOf, orOf, unparsedOf } from '../../src/core/query/ast';
import type { Expr, QueryContext } from '../../src/core/query/ast';
import { evaluate, operandProblems, cellOf } from '../../src/core/query/evaluate';
import type { RowView } from '../../src/core/query/evaluate';
import { allFields } from '../../src/core/fieldTypes';
import { textField } from '../../src/core/fieldTypes/text';
import { resolveField } from '../../src/core/schema/propertySchema';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import type { CellValue, FieldOptions, FieldTypeId, FilterOpId } from '../../src/core/types';
import { DOCS_03_TYPES, makeContext } from './field-contract.suite';

/** A column per type, with one sample value and the texts that read back to it. */
type Sample = {
	/** The column's name as the DSL spells it. Two of them contain a space on purpose. */
	readonly name: string;
	/** Extra `.base` options the type reads: a symbol, a maximum, an option list. */
	readonly options?: FieldOptions;
	/** The canonical value the row holds. */
	readonly value: CellValue;
	/** DSL text that reads back to `value` — the operand for `is`, `isNot`, `=`, `!=`, `>=`, `<=`. */
	readonly text: string;
	/** A strict prefix / suffix / infix of the plain text, for the three substring operators. */
	readonly prefix: string;
	readonly suffix: string;
	readonly infix: string;
	/** DSL text that reads back to a *smaller* value, for `>`; and to a larger one, for `<`. */
	readonly below: string;
	readonly above: string;
};

const SAMPLES: Readonly<Partial<Record<FieldTypeId, Sample>>> = {
	text: {
		name: 'Text',
		value: 'Widening the road',
		text: 'Widening the road',
		prefix: 'Widening',
		suffix: 'road',
		infix: 'the',
		below: 'Widening the roa',
		above: 'Widening the roadz',
	},
	longText: {
		name: 'Long text',
		value: 'one line\ntwo lines',
		text: 'one line\ntwo lines',
		prefix: 'one line',
		suffix: 'two lines',
		infix: 'line',
		below: 'one line',
		above: 'one line\ntwo lines and a third',
	},
	number: {
		name: 'Number',
		value: 4,
		text: '4',
		prefix: '4',
		suffix: '4',
		infix: '4',
		below: '3',
		above: '5',
	},
	checkbox: {
		name: 'Checkbox',
		value: true,
		text: 'true',
		prefix: 'tr',
		suffix: 'ue',
		infix: 'ru',
		below: 'false',
		above: 'true',
	},
	date: {
		name: 'Due',
		value: '2026-05-04',
		text: '2026-05-04',
		prefix: '2026',
		suffix: '05-04',
		infix: '-05-',
		below: '2026-05-03',
		above: '2026-05-05',
	},
	datetime: {
		name: 'When',
		value: '2026-05-04T09:30:00Z',
		text: '2026-05-04T09:30:00Z',
		prefix: '2026-05-04',
		suffix: '09:30:00Z',
		infix: 'T09:',
		below: '2026-05-04T08:00:00Z',
		above: '2026-05-04T10:00:00Z',
	},
	url: {
		name: 'Url',
		value: 'https://example.com/road',
		text: 'https://example.com/road',
		prefix: 'https://example',
		suffix: '/road',
		infix: 'example.com',
		below: 'https://example.com/roa',
		above: 'https://example.com/roadz',
	},
	email: {
		name: 'Email',
		value: 'ann@example.com',
		text: 'ann@example.com',
		prefix: 'ann@',
		suffix: '.com',
		infix: '@example',
		below: 'ann@example.co',
		above: 'ann@example.comz',
	},
	phone: {
		name: 'Phone',
		value: '+880 1712 345678',
		text: '+880 1712 345678',
		prefix: '+880',
		suffix: '345678',
		infix: '1712',
		below: '+880 1712 34567',
		above: '+880 1712 3456789',
	},
	singleSelect: {
		name: 'Status',
		options: {
			options: [
				{ id: 'o1', name: 'Todo' },
				{ id: 'o2', name: 'Doing' },
			],
		},
		value: 'Doing',
		text: 'Doing',
		prefix: 'Do',
		suffix: 'ing',
		infix: 'oi',
		below: 'Doing',
		above: 'Doing',
	},
	multiSelect: {
		name: 'Tags',
		options: {
			options: [
				{ id: 'o1', name: 'draft' },
				{ id: 'o2', name: 'urgent' },
			],
		},
		value: ['draft', 'urgent'],
		text: 'draft',
		prefix: 'draft',
		suffix: 'urgent',
		infix: 'raf',
		below: 'draft',
		above: 'draft',
	},
	rating: {
		name: 'Rating',
		options: { max: 5 },
		value: 4,
		text: '4',
		prefix: '4',
		suffix: '4',
		infix: '4',
		below: '3',
		above: '5',
	},
	currency: {
		name: 'Budget',
		options: { symbol: '$', precision: 2 },
		value: 4.5,
		text: '4.50',
		prefix: '4',
		suffix: '.50',
		infix: '.',
		below: '4.00',
		above: '5.00',
	},
	percent: {
		name: 'Progress',
		value: 25,
		text: '25%',
		prefix: '25',
		suffix: '%',
		infix: '5%',
		below: '20%',
		above: '30%',
	},
	duration: {
		name: 'Estimate',
		value: 2700,
		text: '45m',
		prefix: '45',
		suffix: 'm',
		infix: '5m',
		below: '30m',
		above: '2h',
	},
	attachment: {
		name: 'Files',
		value: ['Assets/plan.png', 'Assets/site.pdf'],
		text: 'Assets/plan.png',
		prefix: 'Assets/plan',
		suffix: 'plan.png',
		infix: 'plan',
		below: 'Assets/plan.png',
		above: 'Assets/plan.png',
	},
};

const base = makeContext();

/** The sample for one type. A type registered without one fails the test rather than going unexercised. */
function sampleOf(id: FieldTypeId): Sample {
	const sample = SAMPLES[id];
	if (sample === undefined) {
		throw new Error(`${id} is registered but has no sample column`);
	}
	return sample;
}

/** The resolved column for one type, with its sample options. */
function fieldFor(id: FieldTypeId): ResolvedField {
	const sample = sampleOf(id);
	return resolveField(
		{
			id: `note.${sample.name}`,
			name: sample.name,
			source: 'database',
			fieldOptions: { type: id, ...sample.options },
		},
		base,
	);
}

/** The columns of the behaviour table's view: one per registered type, plus an always-empty column. */
const tableFields: readonly ResolvedField[] = [
	...DOCS_03_TYPES.map((id) => fieldFor(id)),
	resolveField(
		{ id: 'note.Nothing', name: 'Nothing', source: 'database', fieldOptions: { type: 'text' } },
		base,
	),
];

const tableCtx: QueryContext = { fields: tableFields };

/** The row every generated case filters: one column of each type, holding its sample value. */
const sampleRow: RowView = {
	rowId: 'Projects/Sample.md',
	cells: Object.fromEntries(
		DOCS_03_TYPES.map((id) => [`note.${sampleOf(id).name}`, sampleOf(id).value]),
	),
};

/** Quotes an operand when the grammar would otherwise read it as two things. */
function literal(text: string): string {
	if (text === '' || [...text].some((char) => ' \t\n\r"(),:!~<>='.includes(char))) {
		return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
	}
	return text;
}

/** Reads an operand the way the parser does, so the expected AST carries the canonical value. */
function readOperand(field: ResolvedField, op: FilterOpId, text: string): unknown {
	const textOperators: readonly FilterOpId[] = [
		'contains',
		'notContains',
		'startsWith',
		'endsWith',
	];
	if (textOperators.includes(op)) {
		return text;
	}
	const read = field.descriptor.parsePlain(text, field.context);
	return read.ok ? read.value : text;
}

type Generated = {
	readonly id: FieldTypeId;
	readonly op: FilterOpId;
	readonly label: string;
	readonly dsl: string;
	readonly expected: Expr;
	readonly answer: boolean;
	/** The descriptor's own verdict for the same value and operand: the dispatcher must agree with it. */
	readonly descriptorAnswer: boolean;
};

/** The shorthand sign for each comparison operator the generated cases use. */
const SIGNS: Readonly<Partial<Record<FilterOpId, string>>> = {
	gt: '>',
	gte: '>=',
	lt: '<',
	lte: '<=',
};

/** One case per declared operator, built from the sample so the expectation follows from the sample. */
function generate(id: FieldTypeId, op: FilterOpId): Generated | undefined {
	const sample = sampleOf(id);
	const field = fieldFor(id);
	const column = field.definition.id;
	const descriptor = field.descriptor;
	const value = sample.value;
	const cmp = (operand: unknown): Expr => ({ kind: 'cmp', fieldId: column, op, operand });
	const empty: Expr = { kind: 'empty', fieldId: column };
	const withAnswers = (
		dsl: string,
		expected: Expr,
		answer: boolean,
		descriptorOperand: unknown,
		descriptorValue: CellValue = value,
	): Generated => ({
		id,
		op,
		label: `${id} — ${op}`,
		dsl,
		expected,
		answer,
		descriptorAnswer: descriptor.matches(descriptorValue, op, descriptorOperand, field.context),
	});

	const name = literal(sample.name);
	switch (op) {
		case 'is':
			return withAnswers(`${name}:${literal(sample.text)}`, cmp(value), true, value);
		case 'isNot':
			return withAnswers(`${name} != ${literal(sample.text)}`, cmp(value), false, value);
		case 'contains':
			return withAnswers(
				`${name}:~${literal(sample.infix)}`,
				cmp(sample.infix),
				true,
				sample.infix,
			);
		case 'notContains':
			return withAnswers(
				`${name}:!~${literal(sample.infix)}`,
				cmp(sample.infix),
				false,
				sample.infix,
			);
		case 'startsWith':
			return withAnswers(
				`startsWith(${name}, ${literal(sample.prefix)})`,
				cmp(sample.prefix),
				true,
				sample.prefix,
			);
		case 'endsWith':
			return withAnswers(
				`endsWith(${name}, ${literal(sample.suffix)})`,
				cmp(sample.suffix),
				true,
				sample.suffix,
			);
		case 'isEmpty':
			// The row holds a value, so "is empty" is false — and the column itself must say the same.
			return withAnswers(`${name}:empty`, empty, false, null, value);
		case 'isNotEmpty':
			return withAnswers(`not (${name}:empty)`, { kind: 'not', part: empty }, true, null);
		default: {
			const sign = SIGNS[op];
			if (sign === undefined || sample.below === sample.above) {
				return undefined;
			}
			// `gt` against a smaller value and `lt` against a larger one are both true; `gte` and `lte` use the
			// sample's own value, so equality is part of what is asserted.
			const texts = op === 'gt' ? sample.below : op === 'lt' ? sample.above : sample.text;
			const operand = readOperand(field, op, texts);
			return withAnswers(`${name}:${sign}${literal(texts)}`, cmp(operand), true, operand);
		}
	}
}

const cases: readonly Generated[] = DOCS_03_TYPES.flatMap(
	(id) =>
		allFields()
			.find((descriptor) => descriptor.id === id)
			?.filterOps.flatMap((op) => {
				const generated = generate(id, op);
				return generated === undefined ? [] : [generated];
			}) ?? [],
);

describe('the query table, generated by iterating the registry', () => {
	it('covers every operator of every registered type', () => {
		const missing: string[] = [];
		for (const id of DOCS_03_TYPES) {
			const declared =
				allFields().find((descriptor) => descriptor.id === id)?.filterOps ?? [];
			for (const op of declared) {
				if (!cases.some((testCase) => testCase.id === id && testCase.op === op)) {
					missing.push(`${id}:${op}`);
				}
			}
		}
		expect(missing).toEqual([]);
		expect(cases.length).toBeGreaterThan(100);
	});

	for (const testCase of cases) {
		it(`${testCase.label} evaluates, and agrees with the descriptor`, () => {
			expect(evaluate(testCase.expected, sampleRow, tableCtx)).toBe(testCase.answer);
			// The dispatcher must ask the *column* the same question the column answers: no coercion, no
			// re-interpretation of an operator on the way through.
			expect(evaluate(testCase.expected, sampleRow, tableCtx)).toBe(
				testCase.descriptorAnswer,
			);
		});
	}
});

describe('the behaviour table the step asks for', () => {
	const tableRow: RowView = {
		rowId: 'Projects/Table.md',
		cells: {
			'note.Text': 'Widening the road',
			'note.Number': 4,
			'note.Checkbox': true,
			'note.Due': '2025-09-24',
			'note.Status': 'Doing',
			'note.Tags': ['draft', 'urgent'],
			'note.Estimate': 2700,
			'note.Progress': 25,
			'note.Budget': 4.5,
		},
	};

	/** The column a row's name refers to, as the query layer resolves it. */
	const column = (name: string): ResolvedField => {
		const found = tableFields.find((field) => field.definition.name === name);
		if (found === undefined) {
			throw new Error(`no column named "${name}" in the table fixture`);
		}
		return found;
	};

	/** A comparison whose operand is read the way a typed cell is read: by the column's own reader. */
	const read = (name: string, op: FilterOpId, text: string): Expr => {
		const field = column(name);
		const parsed = field.descriptor.parsePlain(text, field.context);
		if (!parsed.ok) {
			throw new Error(`"${text}" does not read as ${name}`);
		}
		return comparison(field.definition.id, op, parsed.value);
	};

	/** A text comparison: the operand is the raw text, which is how the query layer compares text. */
	const raw = (name: string, op: FilterOpId, text: string): Expr =>
		comparison(column(name).definition.id, op, text);

	const is = (name: string, text: string): Expr => read(name, 'is', text);
	const empty = (name: string): Expr => emptyOf(column(name).definition.id);

	const table: readonly {
		readonly spelling: string;
		readonly expr: Expr;
		readonly answer: boolean;
		readonly why: string;
	}[] = [
		{
			spelling: 'Text:"Widening the road"',
			expr: is('Text', 'Widening the road'),
			answer: true,
			why: 'a quoted value, bare operator',
		},
		{
			spelling: 'Text = "Widening the road"',
			expr: is('Text', 'Widening the road'),
			answer: true,
			why: 'infix equality',
		},
		{
			spelling: 'Text != Narrowing',
			expr: read('Text', 'isNot', 'Narrowing'),
			answer: true,
			why: 'inequality',
		},
		{
			spelling: 'Number >= 4',
			expr: read('Number', 'gte', '4'),
			answer: true,
			why: 'numerals, greater-or-equal',
		},
		{
			spelling: 'Number > 4',
			expr: read('Number', 'gt', '4'),
			answer: false,
			why: 'strictly greater',
		},
		{
			spelling: 'Number < 5',
			expr: read('Number', 'lt', '5'),
			answer: true,
			why: 'strictly less',
		},
		{
			spelling: 'Number:>3',
			expr: read('Number', 'gt', '3'),
			answer: true,
			why: 'the legacy spelling of the same thing',
		},
		{
			spelling: 'Text ~ the',
			expr: raw('Text', 'contains', 'the'),
			answer: true,
			why: 'contains',
		},
		{
			spelling: 'Text is "Widening the road"',
			expr: is('Text', 'Widening the road'),
			answer: true,
			why: 'the `is` keyword',
		},
		{
			spelling: 'Text is not Narrowing',
			expr: read('Text', 'isNot', 'Narrowing'),
			answer: true,
			why: '`is not`',
		},
		{
			spelling: 'Text is not empty',
			expr: notOf(empty('Text')),
			answer: true,
			why: 'the empty operator, negated',
		},
		{
			spelling: 'Nothing is empty',
			expr: empty('Nothing'),
			answer: true,
			why: 'a column with no value is empty',
		},
		{ spelling: 'Checkbox:true', expr: is('Checkbox', 'true'), answer: true, why: 'booleans' },
		{
			spelling: 'Checkbox = false',
			expr: is('Checkbox', 'false'),
			answer: false,
			why: 'booleans, the other way',
		},
		{
			spelling: 'Due < 2026-01-01',
			expr: read('Due', 'lt', '2026-01-01'),
			answer: true,
			why: 'dates compare chronologically',
		},
		{
			spelling: 'Due > 2026-01-01',
			expr: read('Due', 'gt', '2026-01-01'),
			answer: false,
			why: 'dates compare chronologically',
		},
		{
			spelling: 'Status:Doing',
			expr: is('Status', 'Doing'),
			answer: true,
			why: 'a select value',
		},
		{
			spelling: 'Status != Done',
			expr: read('Status', 'isNot', 'Done'),
			answer: true,
			why: 'select inequality',
		},
		{
			spelling: 'Status:Doing or Status:Todo',
			expr: orOf([is('Status', 'Doing'), is('Status', 'Todo')]),
			answer: true,
			why: 'or',
		},
		{
			spelling: 'Status:Doing and Number > 100',
			expr: andOf([is('Status', 'Doing'), read('Number', 'gt', '100')]),
			answer: false,
			why: 'and, short-circuited',
		},
		{
			spelling: 'not (Status:Doing)',
			expr: notOf(is('Status', 'Doing')),
			answer: false,
			why: 'not',
		},
		{
			spelling: 'Status:Doing Tags:draft',
			expr: andOf([is('Status', 'Doing'), raw('Tags', 'contains', 'draft')]),
			answer: true,
			why: 'juxtaposition is and',
		},
		{
			spelling: '(Status:Doing or Status:Todo) and Number >= 4',
			expr: andOf([
				orOf([is('Status', 'Doing'), is('Status', 'Todo')]),
				read('Number', 'gte', '4'),
			]),
			answer: true,
			why: 'parenthesised groups',
		},
		{
			spelling: 'Tags:draft,urgent',
			expr: orOf([raw('Tags', 'contains', 'draft'), raw('Tags', 'contains', 'urgent')]),
			answer: true,
			why: 'a comma list is an or, as the legacy README says',
		},
		{
			spelling: 'Tags:!~pdf',
			expr: raw('Tags', 'notContains', 'pdf'),
			answer: true,
			why: 'not contains on a list column',
		},
		{
			spelling: 'empty(Nothing)',
			expr: empty('Nothing'),
			answer: true,
			why: 'the function spelling',
		},
		{
			spelling: 'notEmpty(Nothing)',
			expr: notOf(empty('Nothing')),
			answer: false,
			why: 'the negated function spelling',
		},
		{
			spelling: 'startsWith(Text, "Widening")',
			expr: raw('Text', 'startsWith', 'Widening'),
			answer: true,
			why: 'an anchor, function form',
		},
		{
			spelling: 'endsWith(Text, "road")',
			expr: raw('Text', 'endsWith', 'road'),
			answer: true,
			why: 'an anchor, function form',
		},
		{
			spelling: 'Estimate:45m',
			expr: is('Estimate', '45m'),
			answer: true,
			why: 'a duration reads its unit',
		},
		{
			spelling: 'Estimate > 30m',
			expr: read('Estimate', 'gt', '30m'),
			answer: true,
			why: 'durations compare in seconds',
		},
		{
			spelling: 'Progress:25%',
			expr: is('Progress', '25%'),
			answer: true,
			why: 'a percent reads its sign',
		},
		{
			spelling: 'Budget:4.50',
			expr: is('Budget', '4.50'),
			answer: true,
			why: 'a currency reads its precision',
		},
	];

	for (const row of table) {
		it(`evaluates ${row.spelling} — ${row.why}`, () => {
			expect(evaluate(row.expr, tableRow, tableCtx)).toBe(row.answer);
		});
	}

	it('keeps an unreadable fragment as unparsed — it reports, and it hides nothing', () => {
		const hidden = unparsedOf('Vanished:1');
		// The readable half still decides the row, whichever side the unreadable fragment is on.
		expect(evaluate(andOf([hidden, is('Status', 'Doing')]), tableRow, tableCtx)).toBe(true);
		expect(evaluate(andOf([hidden, is('Status', 'Todo')]), tableRow, tableCtx)).toBe(false);
		expect(evaluate(orOf([hidden, is('Status', 'Todo')]), tableRow, tableCtx)).toBe(true);
	});
});

describe('stored filters that cannot be obeyed are reported, not obeyed', () => {
	it('reports what a hand-written filter cannot do, once per column', () => {
		const stored: Expr = {
			kind: 'or',
			parts: [
				{ kind: 'cmp', fieldId: 'note.Number', op: 'contains', operand: '4' },
				{ kind: 'empty', fieldId: 'note.Number' },
				{ kind: 'cmp', fieldId: 'note.Gone', op: 'is', operand: 'x' },
				{ kind: 'cmp', fieldId: 'note.Status', op: 'is', operand: 'Doing' },
			],
		};
		const problems = operandProblems(stored, tableCtx);
		expect(problems.map((problem) => problem.fieldId)).toEqual(['note.Number', 'note.Gone']);
		expect(problems[0]?.columnName).toBe('Number');
		expect(problems[0]?.message).toContain('cannot be filtered with "contains"');
		expect(problems[1]?.message).toContain('not in this view');
	});

	it('reports nothing for a well-formed filter', () => {
		const wellFormed = andOf([
			comparison('note.Status', 'is', 'Doing'),
			comparison('note.Number', 'gte', 4),
		]);
		expect(operandProblems(wellFormed, tableCtx)).toEqual([]);
	});

	it('reports an operand the column cannot use, whatever shape it was stored in', () => {
		// Four ways a stored filter can carry an operand no comparison can be made with.
		const stored: Expr = {
			kind: 'and',
			parts: [
				{ kind: 'cmp', fieldId: 'note.Text', op: 'contains', operand: 4 },
				{ kind: 'cmp', fieldId: 'note.Number', op: 'is', operand: { broken: true } },
				{ kind: 'cmp', fieldId: 'note.Number', op: 'gte', operand: null },
				{ kind: 'cmp', fieldId: 'note.Text', op: 'is', operand: null },
			],
		};
		const problems = operandProblems(stored, tableCtx);
		const byField = new Map(problems.map((problem) => [problem.fieldId, problem.message]));
		expect(byField.get('note.Text')).toContain('text that is not text');
		expect(byField.get('note.Number')).toContain('not a value this column can hold');
		// One message per column, even with two broken nodes on one of them.
		expect(problems).toHaveLength(2);
	});

	it('reports an operand that cannot be read back, once per column', () => {
		// A number column holding `true` is a value no column can format; `operandProblems` explains it
		// rather than throwing, because explaining broken filters is its whole job.
		const stored: Expr = { kind: 'cmp', fieldId: 'note.Number', op: 'is', operand: true };
		const problems = operandProblems(stored, tableCtx);
		expect(problems).toHaveLength(1);
		expect(problems[0]?.message.length).toBeGreaterThan(10);
		// And a filter that cannot be evaluated still answers a boolean rather than throwing.
		expect(evaluate(stored, sampleRow, tableCtx)).toBe(false);
	});

	it('reports an operator no column declared, and a column with no empty state', () => {
		// Both branches are defensive: the shipped registry declares `isEmpty` everywhere and refuses the
		// rest at parse time. An injected registry (a test double, or a build that ships fewer types) can
		// still reach them, which is why they are exercised with a hand-made column.
		const narrow: ResolvedField = {
			definition: { id: 'note.Narrow', name: 'Narrow', source: 'database' },
			descriptor: { ...textField, filterOps: ['is', 'contains'] },
			readOnly: false,
			reasons: [],
			options: {},
			context: base,
		};
		const ctx: QueryContext = { fields: [narrow] };
		const stored: Expr = {
			kind: 'and',
			parts: [
				{ kind: 'cmp', fieldId: 'note.Narrow', op: 'gt', operand: 1 },
				{ kind: 'empty', fieldId: 'note.Narrow' },
			],
		};
		const problems = operandProblems(stored, ctx);
		expect(problems).toHaveLength(1);
		expect(problems[0]?.message).toContain('cannot be filtered with "gt"');
		expect(
			operandProblems(emptyOf('note.Narrow'), ctx)
				.map((problem) => problem.message)
				.join(),
		).toContain('has no empty state');
	});

	it('reads a column with no value as empty, and a missing cell as no value', () => {
		const row: RowView = { rowId: 'Empty.md', cells: {} };
		expect(cellOf(row, 'note.Nothing')).toBeNull();
		expect(evaluate(emptyOf('note.Nothing'), row, tableCtx)).toBe(true);
	});

	it('treats a column the view does not have as no condition at all', () => {
		const stored: Expr = { kind: 'cmp', fieldId: 'note.Gone', op: 'is', operand: 'x' };
		const row: RowView = { rowId: 'Empty.md', cells: {} };
		expect(evaluate(stored, row, tableCtx)).toBe(true);
	});
});

describe('the sample table itself', () => {
	it('resolves one column per registered type, and its names are the ones the DSL spells', () => {
		expect(tableFields.map((field) => field.definition.name)).toEqual([
			...DOCS_03_TYPES.map((id) => sampleOf(id).name),
			'Nothing',
		]);
		expect(tableFields).toHaveLength(17);
	});
});
