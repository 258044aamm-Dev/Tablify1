/**
 * The migration test: every filter spelling the old build documented must still select the same rows.
 *
 * The strings come from the old README's "Query syntax" table — `status:Done tags:urgent,design name:~ship`
 * is its own example — plus the two function forms it advertised (`empty(Field)`, `notEmpty(Field)`) and
 * the quote rule for a field name with a space. Nothing here is invented: each case names the row set the
 * old engine produced for that column.
 *
 * Two behaviours are asserted *because* they are surprising, and each is the reason a mapping decision went
 * the way it did:
 *
 * - `Status:!Done` is `isNot` on a select and therefore does **not** match a row with no status (the old
 *   engine checked emptiness first, and so does every type's contract). `not (Status:Done)` *does* match
 *   it, because `not` negates the question — that is the one place the new and old systems deliberately
 *   differ, and the legacy spelling keeps the old meaning.
 * - `Tags:urgent,design` is "any of", which the new AST expresses as `or`, one comparison per option. A
 *   multi-select row with a *subset* of the named options still matches, exactly as before.
 */
import { describe, expect, it } from 'vitest';
import type { QueryContext } from '../../src/core/query/ast';
import { evaluate } from '../../src/core/query/evaluate';
import type { RowView } from '../../src/core/query/evaluate';
import { parseQueryString } from '../../src/core/query/parse';
import { resolveField } from '../../src/core/schema/propertySchema';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import { makeContext } from './field-contract.suite';

const base = makeContext();

/** One column per legacy example, named exactly as the old README spells it. */
const definitions: readonly { readonly id: string; readonly fieldOptions?: unknown }[] = [
	{
		id: 'note.status',
		fieldOptions: {
			type: 'singleSelect',
			options: [
				{ id: 'o1', name: 'Todo' },
				{ id: 'o2', name: 'Done' },
				{ id: 'o3', name: 'Blocked' },
			],
		},
	},
	{
		id: 'note.tags',
		fieldOptions: {
			type: 'multiSelect',
			options: [
				{ id: 'o1', name: 'urgent' },
				{ id: 'o2', name: 'design' },
				{ id: 'o3', name: 'ops' },
			],
		},
	},
	{ id: 'note.name', fieldOptions: { type: 'text' } },
	{ id: 'note.Estimate', fieldOptions: { type: 'number' } },
	{ id: 'note.Owner', fieldOptions: { type: 'text' } },
	{ id: 'note.due', fieldOptions: { type: 'date' } },
	{ id: 'note.Notes', fieldOptions: { type: 'longText' } },
	{
		id: 'note.Owner Name',
		fieldOptions: {
			type: 'singleSelect',
			options: [
				{ id: 'o1', name: 'Ann' },
				{ id: 'o2', name: 'Bo' },
			],
		},
	},
];

const fields: readonly ResolvedField[] = definitions.map((definition) =>
	resolveField(
		{
			id: definition.id,
			name: definition.id.replace(/^note\./, ''),
			source: 'note',
			...(definition.fieldOptions === undefined
				? {}
				: { fieldOptions: definition.fieldOptions }),
		},
		base,
	),
);

const ctx: QueryContext = { fields };

/** Six rows whose values between them exercise every branch of every legacy operator. */
const rows: readonly RowView[] = [
	{
		filePath: 'Rows/a.md',
		cells: {
			'note.status': 'Done',
			'note.tags': ['urgent', 'design'],
			'note.name': 'ship the release',
			'note.Estimate': 8,
			'note.Owner': 'Ann',
			'note.due': '2025-09-24',
			'note.Notes': 'waiting on review',
			'note.Owner Name': 'Ann',
		},
	},
	{
		filePath: 'Rows/b.md',
		cells: {
			'note.status': 'Todo',
			'note.tags': ['design'],
			'note.name': 'design the schema',
			'note.Estimate': 3,
			'note.due': '2026-03-01',
			'note.Notes': 'not started',
			'note.Owner Name': 'Bo',
		},
	},
	{
		filePath: 'Rows/c.md',
		cells: {
			'note.status': 'Blocked',
			'note.tags': ['ops'],
			'note.name': 'ship and hope',
			'note.Estimate': 13,
			'note.Notes': 'blocked on the vendor',
			'note.Owner Name': 'Ann',
		},
	},
	{
		filePath: 'Rows/d.md',
		cells: {
			'note.status': 'Done',
			'note.tags': ['urgent'],
			'note.name': 'write the migration notes',
			'note.Estimate': 5,
			'note.Owner': 'Bo',
			'note.due': '2026-01-01',
			'note.Notes': 'done',
			'note.Owner Name': 'Bo',
		},
	},
	{
		filePath: 'Rows/e.md',
		cells: {
			'note.tags': [],
			'note.name': 'unscheduled idea',
			'note.Estimate': 1,
			'note.Owner Name': 'Ann',
		},
	},
	{
		filePath: 'Rows/f.md',
		cells: {
			'note.status': 'Todo',
			'note.tags': ['urgent', 'ops'],
			'note.name': 'ship the follow-up',
			'note.Estimate': 21,
			'note.Notes': 'not reviewed yet',
			'note.Owner Name': 'Bo',
		},
	},
];

/** One legacy spelling, the rows the old build selected with it, and why those rows. */
type Legacy = {
	readonly dsl: string;
	readonly matches: readonly string[];
	readonly why: string;
};

const cases: readonly Legacy[] = [
	{
		dsl: 'status:Done',
		matches: ['Rows/a.md', 'Rows/d.md'],
		why: 'a bare value on a select is `is`',
	},
	{
		dsl: 'STATUS:done',
		matches: ['Rows/a.md', 'Rows/d.md'],
		why: 'a column name is case-insensitive; the value is folded by the select',
	},
	{
		dsl: 'status:!Done',
		matches: ['Rows/b.md', 'Rows/c.md', 'Rows/f.md'],
		why: '`!` on a select is `isNot` — and a row with no status is not `isNot Done`',
	},
	{
		dsl: 'not (status:Done)',
		matches: ['Rows/b.md', 'Rows/c.md', 'Rows/e.md', 'Rows/f.md'],
		why: '`not` negates the question, so the row with no status matches',
	},
	{
		dsl: 'name:~ship',
		matches: ['Rows/a.md', 'Rows/c.md', 'Rows/f.md'],
		why: '`~` is a substring search on a text column',
	},
	{
		dsl: 'name:"ship the release"',
		matches: ['Rows/a.md'],
		why: 'a bare value on text is `is`, not a search — the quoted form says so',
	},
	{
		dsl: 'Estimate:>4',
		matches: ['Rows/a.md', 'Rows/c.md', 'Rows/d.md', 'Rows/f.md'],
		why: '`>` is greater-than on a number',
	},
	{
		dsl: 'Estimate:<4',
		matches: ['Rows/b.md', 'Rows/e.md'],
		why: '`<` is less-than',
	},
	{
		dsl: 'Estimate:5',
		matches: ['Rows/d.md'],
		why: 'a bare number is equality',
	},
	{
		dsl: 'tags:urgent,design',
		matches: ['Rows/a.md', 'Rows/b.md', 'Rows/d.md', 'Rows/f.md'],
		why: 'a comma list is "any of", which is `or` of one comparison per option',
	},
	{
		dsl: 'tags:urgent tags:design',
		matches: ['Rows/a.md'],
		why: 'juxtaposition is AND, so both options must be present',
	},
	{
		dsl: 'Owner:empty',
		matches: ['Rows/b.md', 'Rows/c.md', 'Rows/e.md', 'Rows/f.md'],
		why: '`:empty` is emptiness, which includes a missing key',
	},
	{
		dsl: 'empty(Owner)',
		matches: ['Rows/b.md', 'Rows/c.md', 'Rows/e.md', 'Rows/f.md'],
		why: 'the function spelling means the same thing',
	},
	{
		dsl: 'notEmpty(Owner)',
		matches: ['Rows/a.md', 'Rows/d.md'],
		why: 'and its negation means the other thing',
	},
	{
		dsl: 'due:<2026-01-01',
		matches: ['Rows/a.md'],
		why: 'on a date, `<` is "before"',
	},
	{
		dsl: 'due:>2026-01-01',
		matches: ['Rows/b.md'],
		why: 'on a date, `>` is "after"',
	},
	{
		dsl: '"Owner Name":Ann',
		matches: ['Rows/a.md', 'Rows/c.md', 'Rows/e.md'],
		why: 'a column name with a space is quoted',
	},
	{
		dsl: 'Notes:!reviewed',
		matches: ['Rows/a.md', 'Rows/b.md', 'Rows/c.md', 'Rows/d.md'],
		why: '`!` on text is "does not contain", as the old README table says',
	},
	{
		dsl: 'status:Done tags:urgent,design name:~ship',
		matches: ['Rows/a.md'],
		why: "the README's own example: three conditions, juxtaposed",
	},
	{
		dsl: 'status:Done or status:Blocked',
		matches: ['Rows/a.md', 'Rows/c.md', 'Rows/d.md'],
		why: '`or` is a union',
	},
];

describe('the legacy query syntax still selects the same rows', () => {
	for (const legacy of cases) {
		it(`"${legacy.dsl}" — ${legacy.why}`, () => {
			const parsed = parseQueryString(legacy.dsl, ctx);
			expect(parsed.errors).toEqual([]);
			const matched = rows
				.filter((row) => evaluate(parsed.ast, row, ctx))
				.map((row) => row.filePath);
			expect(matched).toEqual([...legacy.matches]);
		});
	}

	it(`covers every spelling in the old README's table, across ${String(cases.length)} strings`, () => {
		// The README's seven table rows, one by one: a bare value, `~`, `>`/`<`, `!`, the comma list,
		// `:empty`, and the quote rule. Plus the two function forms and the README's own example.
		const strings = cases.map((legacy) => legacy.dsl);
		for (const shape of [
			'status:Done',
			'name:~ship',
			'Estimate:>4',
			'Estimate:<4',
			'status:!Done',
			'tags:urgent,design',
			'Owner:empty',
			'"Owner Name":Ann',
			'empty(Owner)',
			'notEmpty(Owner)',
			'status:Done tags:urgent,design name:~ship',
		]) {
			expect(strings).toContain(shape);
		}
		expect(cases.length).toBeGreaterThanOrEqual(20);
	});
});
