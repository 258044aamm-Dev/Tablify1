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
import { encodeQueryDocument } from '../../src/core/query/ast';
import type { Expr, QueryContext } from '../../src/core/query/ast';
import { evaluate, operandProblems, cellOf } from '../../src/core/query/evaluate';
import type { RowView } from '../../src/core/query/evaluate';
import { parseQueryString } from '../../src/core/query/parse';
import { toQueryString } from '../../src/core/query/serialize';
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
			source: 'note',
			fieldOptions: { type: id, ...sample.options },
		},
		base,
	);
}

/** The columns of the behaviour table's view: one per registered type, plus an always-empty column. */
const tableFields: readonly ResolvedField[] = [
	...DOCS_03_TYPES.map((id) => fieldFor(id)),
	resolveField(
		{ id: 'note.Nothing', name: 'Nothing', source: 'note', fieldOptions: { type: 'text' } },
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
		it(`${testCase.label} parses, evaluates, and agrees with the descriptor`, () => {
			const parsed = parseQueryString(testCase.dsl, tableCtx);
			expect(parsed.errors).toEqual([]);
			expect(parsed.ast).not.toBeNull();
			expect(encodeQueryDocument(parsed.ast)).toEqual(encodeQueryDocument(testCase.expected));
			expect(evaluate(parsed.ast, sampleRow, tableCtx)).toBe(testCase.answer);
			// The dispatcher must ask the *column* the same question the column answers: no coercion, no
			// re-interpretation of an operator on the way through.
			expect(evaluate(parsed.ast, sampleRow, tableCtx)).toBe(testCase.descriptorAnswer);
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

	const table: readonly {
		readonly dsl: string;
		readonly answer: boolean;
		readonly why: string;
	}[] = [
		{ dsl: 'Text:"Widening the road"', answer: true, why: 'a quoted value, bare operator' },
		{ dsl: 'Text = "Widening the road"', answer: true, why: 'infix equality' },
		{ dsl: 'Text != Narrowing', answer: true, why: 'inequality' },
		{ dsl: 'Number >= 4', answer: true, why: 'numerals, greater-or-equal' },
		{ dsl: 'Number > 4', answer: false, why: 'strictly greater' },
		{ dsl: 'Number < 5', answer: true, why: 'strictly less' },
		{ dsl: 'Number:>3', answer: true, why: 'the legacy spelling of the same thing' },
		{ dsl: 'Text ~ the', answer: true, why: 'contains' },
		{ dsl: 'Text is "Widening the road"', answer: true, why: 'the `is` keyword' },
		{ dsl: 'Text is not Narrowing', answer: true, why: '`is not`' },
		{ dsl: 'Text is not empty', answer: true, why: 'the empty operator, negated' },
		{ dsl: 'Nothing is empty', answer: true, why: 'a column with no value is empty' },
		{ dsl: 'Checkbox:true', answer: true, why: 'booleans' },
		{ dsl: 'Checkbox = false', answer: false, why: 'booleans, the other way' },
		{ dsl: 'Due < 2026-01-01', answer: true, why: 'dates compare chronologically' },
		{ dsl: 'Due > 2026-01-01', answer: false, why: 'dates compare chronologically' },
		{ dsl: 'Status:Doing', answer: true, why: 'a select value' },
		{ dsl: 'Status != Done', answer: true, why: 'select inequality' },
		{ dsl: 'Status:Doing or Status:Todo', answer: true, why: 'or' },
		{ dsl: 'Status:Doing and Number > 100', answer: false, why: 'and, short-circuited' },
		{ dsl: 'not (Status:Doing)', answer: false, why: 'not' },
		{ dsl: 'Status:Doing Tags:draft', answer: true, why: 'juxtaposition is and' },
		{
			dsl: '(Status:Doing or Status:Todo) and Number >= 4',
			answer: true,
			why: 'parenthesised groups',
		},
		{
			dsl: 'Tags:draft,urgent',
			answer: true,
			why: 'a comma list is an or, as the legacy README says',
		},
		{ dsl: 'Tags:!~pdf', answer: true, why: 'not contains on a list column' },
		{ dsl: 'empty(Nothing)', answer: true, why: 'the function spelling' },
		{ dsl: 'notEmpty(Nothing)', answer: false, why: 'the negated function spelling' },
		{ dsl: 'startsWith(Text, "Widening")', answer: true, why: 'an anchor, function form' },
		{ dsl: 'endsWith(Text, "road")', answer: true, why: 'an anchor, function form' },
		{ dsl: 'Estimate:45m', answer: true, why: 'a duration reads its unit' },
		{ dsl: 'Estimate > 30m', answer: true, why: 'durations compare in seconds' },
		{ dsl: 'Progress:25%', answer: true, why: 'a percent reads its sign' },
		{ dsl: 'Budget:4.50', answer: true, why: 'a currency reads its precision' },
	];

	for (const row of table) {
		it(`reads "${row.dsl}" — ${row.why}`, () => {
			const parsed = parseQueryString(row.dsl, tableCtx);
			expect(parsed.errors).toEqual([]);
			expect(evaluate(parsed.ast, tableRow, tableCtx)).toBe(row.answer);
		});
	}

	it('writes the filter back out in a form that parses to the same tree', () => {
		const parsed = parseQueryString('(Status:Doing or Status:Todo) and Number >= 4', tableCtx);
		const text = toQueryString(parsed.ast, tableCtx);
		const again = parseQueryString(text, tableCtx);
		expect(again.errors).toEqual([]);
		expect(encodeQueryDocument(again.ast)).toEqual(encodeQueryDocument(parsed.ast));
	});

	it('keeps a filter whose column is gone — it reports, and it hides nothing', () => {
		const parsed = parseQueryString('Vanished:1 and Status:Doing', tableCtx);
		expect(parsed.errors.map((error) => error.message).join()).toContain(
			'no column named "Vanished"',
		);
		// The readable half still applies: the reported half is `unparsed`, which is true.
		expect(evaluate(parsed.ast, tableRow, tableCtx)).toBe(true);
	});
});

describe('bad input is reported, not obeyed', () => {
	const bad: readonly {
		readonly dsl: string;
		readonly message: string;
		readonly answer: boolean;
	}[] = [
		{ dsl: 'Nope:1', message: 'there is no column named "Nope"', answer: true },
		{ dsl: 'Number ~ 4', message: 'cannot be filtered with "contains"', answer: true },
		{ dsl: 'Number:>', message: 'is missing its value', answer: true },
		{ dsl: 'Number:>=x', message: 'is not a value Number can hold', answer: true },
		{ dsl: '"unterminated', message: 'never closed', answer: true },
		{ dsl: 'Text:(', message: 'has nothing after it', answer: true },
		{ dsl: 'Status:Doing and', message: '', answer: true },
	];

	for (const testCase of bad) {
		it(`reports "${testCase.dsl}"`, () => {
			const parsed = parseQueryString(testCase.dsl, tableCtx);
			const messages = parsed.errors.map((error) => error.message).join(' | ');
			if (testCase.message === '') {
				expect(messages).not.toBe('');
			} else {
				expect(messages).toContain(testCase.message);
			}
			for (const error of parsed.errors) {
				expect(error.start).toBeGreaterThanOrEqual(0);
				expect(error.end).toBeLessThanOrEqual(testCase.dsl.length);
				expect(error.end).toBeGreaterThanOrEqual(error.start);
			}
			// An unreadable fragment never hides a row: it reports, and the rest of the filter still works.
			expect(evaluate(parsed.ast, sampleRow, tableCtx)).toBe(testCase.answer);
		});
	}

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

	it('reports nothing for a filter the parser produced', () => {
		const parsed = parseQueryString('Status:Doing and Number >= 4', tableCtx);
		expect(operandProblems(parsed.ast, tableCtx)).toEqual([]);
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
			definition: { id: 'note.Narrow', name: 'Narrow', source: 'note' },
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
		// And the parser says the same thing about the text form of it.
		const parsed = parseQueryString('Narrow:empty', ctx);
		expect(parsed.errors.map((error) => error.message).join()).toContain('has no empty state');
	});

	it('reads a column with no value as empty, and a missing cell as no value', () => {
		const row: RowView = { rowId: 'Empty.md', cells: {} };
		expect(cellOf(row, 'note.Nothing')).toBeNull();
		const parsed = parseQueryString('Nothing:empty', tableCtx);
		expect(evaluate(parsed.ast, row, tableCtx)).toBe(true);
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

/**
 * The parser is total: this generator attacks it with strings no human would type. Two thousand inputs —
 * a deterministic PRNG, so a failure is reproducible from the seed rather than "sometimes" — each of which
 * must produce a result object, with errors whose spans are inside the input, in well under the time a
 * runaway loop would take. Half of them are built by gluing real DSL fragments together; half are raw
 * characters from the DSL's own alphabet, which is where a lexer bug would show up first.
 */
const PROPERTY_INPUTS = 2_000;

/** A tiny deterministic PRNG (mulberry32). Not random enough for cryptography, exactly enough for this. */
function pseudoRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

const FRAGMENTS: readonly string[] = [
	'Status',
	'Status:',
	'"Owner Name"',
	'Tags',
	'Number',
	'Due',
	'',
	'"',
	'(',
	')',
	' and ',
	' or ',
	' not ',
	'!=',
	'>=',
	'<=',
	'=',
	'>',
	'<',
	'~',
	'!',
	',',
	':',
	'empty',
	'notEmpty',
	'startsWith',
	'endsWith',
	'draft',
	'draft,urgent',
	'4',
	'2026-01-01',
	'true',
	'Doing',
	'\\',
	'\n',
	'\t',
];

const ALPHABET = 'Status:"()!~<>=, \n\tdraft urgent 2026-01-01 and or not empty 4';

/** Column-and-value pairs that are valid together, so a generated filter can be expected to parse. */
const VALID_ATOMS: readonly string[] = [
	'Status:Doing',
	'Number:4',
	'Due:2026-01-01',
	'Text:"Widening the road"',
	'Tags:draft',
	'Estimate:45m',
	'Checkbox:true',
	'Owner:empty',
	'Wait:>=2026-01-01',
];

function generatedInputs(count: number): readonly string[] {
	const next = pseudoRandom(20_261_005);
	const pickFrom = (list: readonly string[]): string =>
		list[Math.floor(next() * list.length)] ?? '';
	const inputs: string[] = [];
	for (let index = 0; index < count; index += 1) {
		const roll = index % 3;
		if (roll === 1) {
			// A well-formed filter: one to three atoms joined by `and`, `or` or nothing, sometimes bracketed.
			const atoms: string[] = [];
			const pieces = 1 + Math.floor(next() * 3);
			for (let piece = 0; piece < pieces; piece += 1) {
				atoms.push(pickFrom(VALID_ATOMS));
			}
			const joined = atoms
				.map((atom, position) => (position > 0 && next() < 0.4 ? `(${atom})` : atom))
				.join(next() < 0.35 ? ' and ' : next() < 0.5 ? ' or ' : ' ');
			inputs.push(next() < 0.15 ? `not (${joined})` : joined);
			continue;
		}
		if (roll === 2) {
			// Raw characters from the DSL's own alphabet: where a lexer bug shows up first.
			const length = Math.floor(next() * 40);
			let text = '';
			for (let char = 0; char < length; char += 1) {
				text += ALPHABET.charAt(Math.floor(next() * ALPHABET.length));
			}
			inputs.push(text);
			continue;
		}
		// Glued fragments: nearly always broken, which is exactly what a total parser must survive.
		const parts: string[] = [];
		const pieces = 1 + Math.floor(next() * 6);
		for (let piece = 0; piece < pieces; piece += 1) {
			parts.push(pickFrom(FRAGMENTS));
		}
		inputs.push(parts.join(''));
	}
	return inputs;
}

const GENERATED = generatedInputs(PROPERTY_INPUTS);

/**
 * Counted once at module load, so the numbers appear *in the test names* — this repo forbids `console.*`
 * everywhere, including tests, so a test that wants to report a count has to put it where the runner will
 * print it. Counting up here is deterministic (the PRNG is seeded), and a hypothetical throw while counting
 * would fail the whole file rather than one test, which is a louder signal than a silent zero.
 */
function analyse(inputs: readonly string[]): {
	readonly withErrors: number;
	readonly cleanRounds: number;
} {
	let withErrors = 0;
	let cleanRounds = 0;
	for (const input of inputs) {
		const first = parseQueryString(input, tableCtx);
		if (first.errors.length > 0) {
			withErrors += 1;
			continue;
		}
		if (first.ast === null) {
			continue;
		}
		const second = parseQueryString(toQueryString(first.ast, tableCtx), tableCtx);
		const same =
			second.errors.length === 0 &&
			JSON.stringify(encodeQueryDocument(second.ast)) ===
				JSON.stringify(encodeQueryDocument(first.ast));
		if (same) {
			cleanRounds += 1;
		}
	}
	return { withErrors, cleanRounds };
}

const ANALYSIS = analyse(GENERATED);

describe('the parser is total', () => {
	it(`never throws and never hangs for any of the ${String(PROPERTY_INPUTS)} generated inputs, ${String(ANALYSIS.withErrors)} of which are broken`, () => {
		const started = performance.now();
		let parsed = 0;
		let withErrors = 0;
		for (const input of GENERATED) {
			let result: ReturnType<typeof parseQueryString> | undefined;
			// The only assertion that matters: a result comes back, for every input, without an exception.
			expect(
				() => {
					result = parseQueryString(input, tableCtx);
				},
				`parseQueryString threw on ${JSON.stringify(input)}`,
			).not.toThrow();
			expect(result, `no result for ${JSON.stringify(input)}`).toBeDefined();
			if (result === undefined) {
				return;
			}
			parsed += 1;
			if (result.errors.length > 0) {
				withErrors += 1;
			}
			for (const error of result.errors) {
				expect(error.start, JSON.stringify(input)).toBeGreaterThanOrEqual(0);
				expect(error.end, JSON.stringify(input)).toBeLessThanOrEqual(
					Math.max(input.length, error.start),
				);
			}
		}
		expect(parsed).toBe(PROPERTY_INPUTS);
		// A generator that produced only valid filters, or only invalid ones, would be testing nothing.
		expect(withErrors).toBe(ANALYSIS.withErrors);
		expect(withErrors).toBeGreaterThan(0);
		expect(withErrors).toBeLessThan(PROPERTY_INPUTS);
		// A loop that never ended would not fail an assertion, it would hang the run; this is the guard.
		expect(performance.now() - started).toBeLessThan(2_000);
	});

	it(`reads back what it writes, for the ${String(ANALYSIS.cleanRounds)} generated inputs that parsed cleanly`, () => {
		let roundTripped = 0;
		for (const input of GENERATED) {
			const first = parseQueryString(input, tableCtx);
			if (first.errors.length > 0 || first.ast === null) {
				continue;
			}
			const text = toQueryString(first.ast, tableCtx);
			const second = parseQueryString(text, tableCtx);
			expect(second.errors, `${JSON.stringify(input)} → ${JSON.stringify(text)}`).toEqual([]);
			expect(encodeQueryDocument(second.ast)).toEqual(encodeQueryDocument(first.ast));
			roundTripped += 1;
		}
		// The count in the test name and the count here are the same walk of the same inputs.
		expect(roundTripped).toBe(ANALYSIS.cleanRounds);
		expect(roundTripped).toBeGreaterThan(400);
	});
});

describe('the serialiser round-trips the AST fixture table', () => {
	/** Every shape the union has, including the ones the DSL can only write one way. */
	const fixtures: readonly {
		readonly label: string;
		readonly ast: Expr;
		readonly readable?: boolean;
	}[] = [
		{
			label: 'a comparison',
			ast: { kind: 'cmp', fieldId: 'note.Status', op: 'is', operand: 'Doing' },
		},
		{
			label: 'an inequality',
			ast: { kind: 'cmp', fieldId: 'note.Status', op: 'isNot', operand: 'Done' },
		},
		{
			label: 'contains',
			ast: { kind: 'cmp', fieldId: 'note.Name', op: 'contains', operand: 'road' },
		},
		{
			label: 'not contains',
			ast: { kind: 'cmp', fieldId: 'note.Name', op: 'notContains', operand: 'bridge' },
		},
		{
			label: 'a quoted value',
			ast: { kind: 'cmp', fieldId: 'note.Name', op: 'is', operand: 'Widening the road' },
		},
		{
			label: 'a quoted column',
			ast: { kind: 'cmp', fieldId: 'note.Long text', op: 'contains', operand: 'line' },
		},
		{
			label: 'startsWith',
			ast: { kind: 'cmp', fieldId: 'note.Name', op: 'startsWith', operand: 'Wid' },
		},
		{
			label: 'endsWith',
			ast: { kind: 'cmp', fieldId: 'note.Name', op: 'endsWith', operand: 'ing' },
		},
		{
			label: 'greater than',
			ast: { kind: 'cmp', fieldId: 'note.Number', op: 'gt', operand: 3 },
		},
		{
			label: 'greater than a date',
			ast: { kind: 'cmp', fieldId: 'note.Due', op: 'gte', operand: '2026-01-01' },
		},
		{
			label: 'less than a duration',
			ast: { kind: 'cmp', fieldId: 'note.Estimate', op: 'lt', operand: 1800 },
		},
		{
			label: 'a boolean',
			ast: { kind: 'cmp', fieldId: 'note.Checkbox', op: 'is', operand: true },
		},
		{
			label: 'a list operand',
			ast: { kind: 'cmp', fieldId: 'note.Tags', op: 'contains', operand: 'urgent' },
		},
		{ label: 'emptiness', ast: { kind: 'empty', fieldId: 'note.Owner' } },
		{
			label: 'the negation of emptiness',
			ast: { kind: 'not', part: { kind: 'empty', fieldId: 'note.Owner' } },
		},
		{
			label: 'a conjunction',
			ast: {
				kind: 'and',
				parts: [
					{ kind: 'cmp', fieldId: 'note.Status', op: 'is', operand: 'Doing' },
					{ kind: 'cmp', fieldId: 'note.Number', op: 'gte', operand: 4 },
				],
			},
		},
		{
			label: 'a disjunction inside a conjunction',
			ast: {
				kind: 'and',
				parts: [
					{
						kind: 'or',
						parts: [
							{ kind: 'cmp', fieldId: 'note.Status', op: 'is', operand: 'Doing' },
							{ kind: 'cmp', fieldId: 'note.Status', op: 'is', operand: 'Todo' },
						],
					},
					{ kind: 'cmp', fieldId: 'note.Number', op: 'gte', operand: 4 },
				],
			},
		},
		{
			label: 'a negation',
			ast: {
				kind: 'not',
				part: { kind: 'cmp', fieldId: 'note.Status', op: 'is', operand: 'Done' },
			},
		},
		{
			label: 'an inequality with a value that needs quotes',
			ast: { kind: 'cmp', fieldId: 'note.Status', op: 'isNot', operand: 'Done and dusted' },
		},
		{
			label: 'contains with a value that needs quotes',
			ast: { kind: 'cmp', fieldId: 'note.Name', op: 'contains', operand: 'two words' },
		},
		{
			label: 'not contains with a value that needs quotes',
			ast: { kind: 'cmp', fieldId: 'note.Name', op: 'notContains', operand: 'two words' },
		},
		{
			label: 'a comparison against a quoted instant',
			ast: { kind: 'cmp', fieldId: 'note.When', op: 'gt', operand: '2026-05-04T09:30:00Z' },
		},
		// The one shape that round-trips as itself *and* reports again: an unreadable fragment is stored
		// verbatim, so re-reading it produces the same node and the same complaint. That is the point of
		// keeping it — a half-typed filter survives a save, with its error still named.
		{
			label: 'an unreadable fragment',
			ast: { kind: 'unparsed', text: 'whatever this is' },
			readable: false,
		},
	];

	// The columns the fixture table names, so the serialiser can use their display spelling.
	const fixtureFields: readonly ResolvedField[] = [
		resolveField(
			{
				id: 'note.Status',
				name: 'Status',
				source: 'note',
				fieldOptions: {
					type: 'singleSelect',
					options: [
						{ id: 'o1', name: 'Doing' },
						{ id: 'o2', name: 'Done' },
					],
				},
			},
			base,
		),
		resolveField(
			{ id: 'note.Name', name: 'Name', source: 'note', fieldOptions: { type: 'text' } },
			base,
		),
		resolveField(
			{
				id: 'note.Long text',
				name: 'Long text',
				source: 'note',
				fieldOptions: { type: 'longText' },
			},
			base,
		),
		resolveField(
			{ id: 'note.Number', name: 'Number', source: 'note', fieldOptions: { type: 'number' } },
			base,
		),
		resolveField(
			{ id: 'note.Due', name: 'Due', source: 'note', fieldOptions: { type: 'date' } },
			base,
		),
		resolveField(
			{
				id: 'note.Estimate',
				name: 'Estimate',
				source: 'note',
				fieldOptions: { type: 'duration' },
			},
			base,
		),
		resolveField(
			{
				id: 'note.Checkbox',
				name: 'Checkbox',
				source: 'note',
				fieldOptions: { type: 'checkbox' },
			},
			base,
		),
		resolveField(
			{
				id: 'note.Tags',
				name: 'Tags',
				source: 'note',
				fieldOptions: { type: 'multiSelect', options: [{ id: 'o1', name: 'urgent' }] },
			},
			base,
		),
		resolveField(
			{ id: 'note.Owner', name: 'Owner', source: 'note', fieldOptions: { type: 'text' } },
			base,
		),
		resolveField(
			{ id: 'note.When', name: 'When', source: 'note', fieldOptions: { type: 'datetime' } },
			base,
		),
	];

	const fixtureCtx: QueryContext = { fields: fixtureFields };

	for (const fixture of fixtures) {
		it(`writes and re-reads ${fixture.label}`, () => {
			const text = toQueryString(fixture.ast, fixtureCtx);
			expect(text).not.toBe('');
			const again = parseQueryString(text, fixtureCtx);
			if (fixture.readable !== false) {
				expect(again.errors, text).toEqual([]);
			}
			expect(encodeQueryDocument(again.ast), text).toEqual(encodeQueryDocument(fixture.ast));
		});
	}

	it('writes a value no column can format as text, which is the one documented loss', () => {
		// A hand-edited sidecar can hold an object as an operand. It is written as its JSON text, so the
		// query box shows something a person can edit, and it reads back as text — the loss is listed in
		// the serialiser's own header, and `operandProblems` reports the stored shape as broken either way.
		const lost: Expr = {
			kind: 'cmp',
			fieldId: 'note.Number',
			op: 'is',
			operand: { broken: true },
		};
		const text = toQueryString(lost, fixtureCtx);
		expect(text).toBe('Number = "{\\"broken\\":true}"');
		const again = parseQueryString(text, fixtureCtx);
		// The number column cannot read that text, so the filter becomes an unreadable fragment that reports
		// itself — the same behaviour as a typo, and the reason the loss is acceptable.
		expect(again.ast).toEqual({ kind: 'unparsed', text: '{"broken":true}' });
		expect(again.errors.length).toBeGreaterThan(0);
	});

	it('writes nothing for the empty identities, which parse back as no filter', () => {
		expect(toQueryString(null, fixtureCtx)).toBe('');
		expect(toQueryString({ kind: 'and', parts: [] }, fixtureCtx)).toBe('');
		expect(parseQueryString('', fixtureCtx)).toEqual({ ast: null, errors: [] });
	});
});
