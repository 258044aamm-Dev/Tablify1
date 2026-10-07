/**
 * The pipeline: order, grouping, search, and the two properties that make a 5,000-row grid usable —
 * determinism and a budget.
 *
 * What is asserted here, and why each one is worth a test:
 *
 * - **Sort stability with the file-path tiebreak.** Two rows that compare equal must not swap places
 *   between two calls, or the grid appears to shuffle under the cursor. The tiebreak is the row's path,
 *   ascending, *regardless of the sort's direction*, so a `desc` sort is exactly as deterministic.
 * - **The search box reads `formatPlain`.** That is the documented choice, and the only way to keep it from
 *   quietly regressing to `formatDisplay` is to assert both halves: the machine spelling finds the row, and
 *   the locale-shaped spelling does not.
 * - **Collapsing hides rows from `rows` without losing them from the group.** The grid windows over `rows`,
 *   so a collapsed group must contribute no height; the group still reports every row it has.
 * - **Purity.** The input array, the row objects and the config are not touched: the caller may render from
 *   them again, and a second `buildView` on the same input gives the same answer.
 * - **The budget.** 5,000 rows through filter + search + sort + group stays under 50 ms. It is a smoke
 *   budget, not a benchmark, and the machine it was measured on is named in PROGRESS.md.
 */
import { describe, expect, it } from 'vitest';
import type { QueryContext } from '../../src/core/query/ast';
import { parseQueryString } from '../../src/core/query/parse';
import type { RowView } from '../../src/core/query/evaluate';
import { resolveField } from '../../src/core/schema/propertySchema';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import type { ViewConfig } from '../../src/core/view/pipeline';
import { buildView } from '../../src/core/view/pipeline';
import { makeContext } from './field-contract.suite';

const base = makeContext();

/** The columns of the fixture view: enough shapes to sort, group and search differently. */
const fields: readonly ResolvedField[] = [
	resolveField(
		{ id: 'note.Name', name: 'Name', source: 'note', fieldOptions: { type: 'text' } },
		base,
	),
	resolveField(
		{
			id: 'note.Status',
			name: 'Status',
			source: 'note',
			fieldOptions: {
				type: 'singleSelect',
				options: [
					{ id: 'o1', name: 'Todo' },
					{ id: 'o2', name: 'Doing' },
					{ id: 'o3', name: 'Done' },
				],
			},
		},
		base,
	),
	resolveField(
		{ id: 'note.Size', name: 'Size', source: 'note', fieldOptions: { type: 'number' } },
		base,
	),
	resolveField(
		{ id: 'note.Due', name: 'Due', source: 'note', fieldOptions: { type: 'date' } },
		base,
	),
	resolveField(
		{
			id: 'note.Tags',
			name: 'Tags',
			source: 'note',
			fieldOptions: {
				type: 'multiSelect',
				options: [
					{ id: 'o1', name: 'draft' },
					{ id: 'o2', name: 'urgent' },
				],
			},
		},
		base,
	),
];

const ctx: QueryContext = { fields };

function row(rowId: string, cells: Record<string, RowView['cells'][string]>): RowView {
	return { rowId, cells };
}

/** Four rows, deliberately including a tie on every sorted column and a row with no values at all. */
const rows: readonly RowView[] = [
	row('Rows/d.md', {
		'note.Name': 'Delta',
		'note.Status': 'Doing',
		'note.Size': 2,
		'note.Due': '2026-01-05',
		'note.Tags': ['urgent'],
	}),
	row('Rows/a.md', {
		'note.Name': 'Alpha',
		'note.Status': 'Done',
		'note.Size': 2,
		'note.Due': '2025-12-31',
		'note.Tags': ['draft'],
	}),
	row('Rows/c.md', {
		'note.Name': 'Charlie',
		'note.Status': 'Todo',
		'note.Size': 8,
		'note.Due': '2026-02-01',
		'note.Tags': ['draft', 'urgent'],
	}),
	row('Rows/b.md', {
		'note.Name': 'Bravo',
		'note.Status': 'Done',
		'note.Size': 2,
		'note.Due': '2025-11-20',
	}),
];

const paths = (result: { readonly rows: readonly RowView[] }): readonly string[] =>
	result.rows.map((entry) => entry.rowId);

const EMPTY_VIEW: ViewConfig = {};

describe('filters, then search', () => {
	it('applies the query before the search box, and reports both counts', () => {
		const ast = parseQueryString('Status:Done', ctx).ast;
		const result = buildView({
			fields,
			rows,
			view: { search: 'alpha' },
			queryAst: ast,
		});
		// Both rows with Status:Done match the query; only one of them matches the search too.
		expect(result.totalRows).toBe(4);
		expect(result.matchedRows).toBe(1);
		expect(paths(result)).toEqual(['Rows/a.md']);
	});

	it('searches the machine-plain form, not the locale-shaped display form', () => {
		const machine = buildView({ fields, rows, view: { search: '2026-01' }, queryAst: null });
		expect(paths(machine)).toEqual(['Rows/d.md']);
		// The same row rendered for a person reads "5 Jan 2026", and that is deliberately not searchable.
		const display = buildView({ fields, rows, view: { search: 'jan 2026' }, queryAst: null });
		expect(paths(display)).toEqual([]);
	});

	it('searches list columns by their labels, and skips hidden columns', () => {
		const tagged = buildView({ fields, rows, view: { search: 'urgent' }, queryAst: null });
		// No sort was asked for, so the source order stands: d before c.
		expect(paths(tagged)).toEqual(['Rows/d.md', 'Rows/c.md']);
		const hidden = buildView({
			fields,
			rows,
			view: { search: 'urgent', hiddenFieldIds: ['note.Tags'] },
			queryAst: null,
		});
		expect(paths(hidden)).toEqual([]);
	});

	it('ignores a search of only whitespace', () => {
		const result = buildView({ fields, rows, view: { search: '   ' }, queryAst: null });
		expect(result.matchedRows).toBe(4);
	});
});

describe('sorting', () => {
	it('breaks ties on the file path, ascending', () => {
		const result = buildView({
			fields,
			rows,
			view: { sorts: [{ fieldId: 'note.Size', direction: 'asc' }] },
			queryAst: null,
		});
		// Size 2 for a, b, d — so the path decides, and 8 for c comes last.
		expect(paths(result)).toEqual(['Rows/a.md', 'Rows/b.md', 'Rows/d.md', 'Rows/c.md']);
	});

	it('keeps the path tiebreak ascending even when the sort descends', () => {
		const result = buildView({
			fields,
			rows,
			view: { sorts: [{ fieldId: 'note.Size', direction: 'desc' }] },
			queryAst: null,
		});
		expect(paths(result)).toEqual(['Rows/c.md', 'Rows/a.md', 'Rows/b.md', 'Rows/d.md']);
	});

	it('applies sort levels in order, and the path decides what is left equal', () => {
		const result = buildView({
			fields,
			rows,
			view: {
				sorts: [
					{ fieldId: 'note.Status', direction: 'asc' },
					{ fieldId: 'note.Size', direction: 'asc' },
				],
			},
			queryAst: null,
		});
		// A select column sorts by its *text*, not by the order its options happen to be listed in: Doing
		// before Done before Todo. (The old build sorted by option index; that divergence is reported in
		// PROGRESS.md rather than changed here.) a and b are equal on both levels, so the path decides.
		expect(paths(result)).toEqual(['Rows/d.md', 'Rows/a.md', 'Rows/b.md', 'Rows/c.md']);
	});

	it('sorts a date column chronologically', () => {
		const result = buildView({
			fields,
			rows,
			view: { sorts: [{ fieldId: 'note.Due', direction: 'asc' }] },
			queryAst: null,
		});
		expect(paths(result)).toEqual(['Rows/b.md', 'Rows/a.md', 'Rows/d.md', 'Rows/c.md']);
	});

	it('puts the empty cell last, in every type that can hold one', () => {
		// One policy, three contracts: `compareNullableNumbers` and `compareNullableText` both answer +1 for
		// an absent value, and the list type follows the same rule. Asserted on a two-row fixture so the
		// empty cell's position cannot be confused with the data's natural order.
		const two: readonly RowView[] = [
			row('Rows/x.md', {}),
			row('Rows/y.md', {
				'note.Size': 1,
				'note.Due': '2026-01-01',
				'note.Tags': ['draft'],
			}),
		];
		for (const fieldId of ['note.Size', 'note.Due', 'note.Tags']) {
			const ascending = buildView({
				fields,
				rows: two,
				view: { sorts: [{ fieldId, direction: 'asc' }] },
				queryAst: null,
			});
			expect(paths(ascending), `${fieldId} ascending`).toEqual(['Rows/y.md', 'Rows/x.md']);
			const descending = buildView({
				fields,
				rows: two,
				view: { sorts: [{ fieldId, direction: 'desc' }] },
				queryAst: null,
			});
			expect(paths(descending), `${fieldId} descending`).toEqual(['Rows/x.md', 'Rows/y.md']);
		}
	});

	it('skips a sort level for a column the view does not have', () => {
		const result = buildView({
			fields,
			rows,
			view: {
				sorts: [
					{ fieldId: 'note.Vanished', direction: 'asc' },
					{ fieldId: 'note.Size', direction: 'desc' },
				],
			},
			queryAst: null,
		});
		expect(paths(result)).toEqual(['Rows/c.md', 'Rows/a.md', 'Rows/b.md', 'Rows/d.md']);
	});
});

describe('grouping', () => {
	it('groups in first-appearance order, with counts and the same row objects', () => {
		const result = buildView({
			fields,
			rows,
			view: { groupBy: 'note.Status', sorts: [{ fieldId: 'note.Status', direction: 'asc' }] },
			queryAst: null,
		});
		// The sort is by the select's text, so the groups appear in that order: Doing, Done, Todo. The key is
		// the folded form a `.base` file stores; the label is what the column itself would display.
		expect(result.groups.map((group) => group.key)).toEqual(['doing', 'done', 'todo']);
		expect(result.groups.map((group) => group.label)).toEqual(['Doing', 'Done', 'Todo']);
		expect(result.groups.map((group) => group.count)).toEqual([1, 2, 1]);
		expect(result.groups[0]?.rows[0]).toBe(result.rows[0]);
	});

	it('carries the collapse state, keeps collapsed rows out of `rows`, and keeps them in the group', () => {
		const result = buildView({
			fields,
			rows,
			view: {
				groupBy: 'note.Status',
				sorts: [{ fieldId: 'note.Status', direction: 'asc' }],
				collapsedKeys: ['done'],
			},
			queryAst: null,
		});
		const done = result.groups.find((group) => group.key === 'done');
		expect(done?.collapsed).toBe(true);
		expect(done?.label).toBe('Done');
		expect(done?.count).toBe(2);
		expect(done?.rows).toHaveLength(2);
		// Matched is what the filter let through; `rows` is what has height on screen.
		expect(result.matchedRows).toBe(4);
		expect(paths(result)).toEqual(['Rows/d.md', 'Rows/c.md']);
	});

	it('does not group when the view does not ask for it, or the column is gone', () => {
		expect(buildView({ fields, rows, view: EMPTY_VIEW, queryAst: null }).groups).toEqual([]);
		expect(
			buildView({ fields, rows, view: { groupBy: 'note.Gone' }, queryAst: null }).groups,
		).toEqual([]);
	});

	it('groups a list column by its labels, and names the group that holds the empty values', () => {
		const result = buildView({
			fields,
			rows,
			view: { groupBy: 'note.Tags', sorts: [{ fieldId: 'note.Tags', direction: 'asc' }] },
			queryAst: null,
		});
		// Keys are the folded, joined labels — what a `.base` file can store and compare; labels are what the
		// column displays, so the header reads "draft, urgent" rather than "draft\u0000urgent".
		expect(result.groups.map((group) => group.key)).toEqual([
			'draft',
			'draft\u0000urgent',
			'urgent',
			'',
		]);
		expect(result.groups.map((group) => group.label)).toEqual([
			'draft',
			'draft, urgent',
			'urgent',
			'(empty)',
		]);
		// The empty group's key is `''` (what both textGroupKey and numericGroupKey use for "no value") and
		// its label is the one piece of wording this module owns, because a header cannot show nothing.
		expect(result.groups[3]?.count).toBe(1);
	});

	it('labels a date group the way the column displays it, and keys it the way it stores it', () => {
		const two: readonly RowView[] = [
			row('Rows/x.md', {}),
			row('Rows/y.md', { 'note.Due': '2026-01-01' }),
		];
		const result = buildView({
			fields,
			rows: two,
			view: { groupBy: 'note.Due' },
			queryAst: null,
		});
		expect(result.groups.map((group) => group.key)).toEqual(['', '2026-01-01']);
		expect(result.groups.map((group) => group.label)).toEqual(['(empty)', '1 Jan 2026']);
	});

	it('sorts the empty cell last for a list column, as that contract says', () => {
		const result = buildView({
			fields,
			rows,
			view: { sorts: [{ fieldId: 'note.Tags', direction: 'asc' }] },
			queryAst: null,
		});
		// a (draft), c (draft, urgent), d (urgent), then b, which has no tags at all.
		expect(paths(result)).toEqual(['Rows/a.md', 'Rows/c.md', 'Rows/d.md', 'Rows/b.md']);
	});
});

describe('columns', () => {
	it('orders the configured columns first, then the schema, and names each column once', () => {
		const result = buildView({
			fields,
			rows,
			view: { columnOrder: ['note.Size', 'note.Gone', 'note.Status', 'note.Size'] },
			queryAst: null,
		});
		expect(result.columnOrder).toEqual([
			'note.Size',
			'note.Status',
			'note.Name',
			'note.Due',
			'note.Tags',
		]);
	});

	it('keeps only the hidden ids the view has, in order, without duplicates', () => {
		const result = buildView({
			fields,
			rows,
			view: { hiddenFieldIds: ['note.Tags', 'note.Gone', 'note.Tags'] },
			queryAst: null,
		});
		expect(result.hiddenFieldIds).toEqual(['note.Tags']);
	});
});

describe('the pipeline is pure', () => {
	it('does not touch the rows, the order or the config', () => {
		const config: ViewConfig = {
			sorts: [{ fieldId: 'note.Size', direction: 'desc' }],
			groupBy: 'note.Status',
			search: 'a',
			hiddenFieldIds: ['note.Tags'],
		};
		const before = JSON.stringify({ rows, config });
		const first = buildView({
			fields,
			rows,
			view: config,
			queryAst: parseQueryString('Size >= 2', ctx).ast,
		});
		const second = buildView({
			fields,
			rows,
			view: config,
			queryAst: parseQueryString('Size >= 2', ctx).ast,
		});
		expect(JSON.stringify({ rows, config })).toBe(before);
		expect(paths(second)).toEqual(paths(first));
		expect(second.groups.map((group) => group.key)).toEqual(
			first.groups.map((group) => group.key),
		);
	});

	it('answers for a row with no cells at all', () => {
		const empty: readonly RowView[] = [{ rowId: 'Rows/empty.md', cells: {} }];
		const filtered = buildView({
			fields,
			rows: empty,
			view: {},
			queryAst: parseQueryString('Name:empty', ctx).ast,
		});
		expect(paths(filtered)).toEqual(['Rows/empty.md']);
		const sorted = buildView({
			fields,
			rows: empty,
			view: { sorts: [{ fieldId: 'note.Size', direction: 'asc' }], groupBy: 'note.Status' },
			queryAst: null,
		});
		expect(sorted.groups).toHaveLength(1);
	});
});

describe('the 5,000-row budget', () => {
	/** Eight columns of mixed types, the way a real view looks; values chosen to make ties common. */
	function stressRows(count: number): readonly RowView[] {
		const statuses = ['Todo', 'Doing', 'Done'];
		const generated: RowView[] = [];
		for (let index = 0; index < count; index += 1) {
			generated.push({
				rowId: `Rows/row-${String(index).padStart(5, '0')}.md`,
				cells: {
					'note.Name': `Row ${String(index)}`,
					'note.Status': statuses[index % statuses.length] ?? 'Todo',
					'note.Size': index % 97,
					'note.Due': `2026-0${String((index % 9) + 1)}-1${String(index % 9)}`,
					'note.Tags': index % 3 === 0 ? ['draft', 'urgent'] : ['draft'],
				},
			});
		}
		return generated;
	}

	it('filters, searches, sorts and groups 5,000 rows in under 50 ms', () => {
		const many = stressRows(5_000);
		const ast = parseQueryString('Status:Done and Size >= 10', ctx).ast;
		const view: ViewConfig = {
			search: 'row 1',
			sorts: [
				{ fieldId: 'note.Size', direction: 'asc' },
				{ fieldId: 'note.Due', direction: 'desc' },
			],
			groupBy: 'note.Status',
			hiddenFieldIds: [],
		};
		// One warm-up run, so the measurement is of the pipeline rather than of the first-call overhead.
		const warm = buildView({ fields, rows: many, view, queryAst: ast });
		const started = performance.now();
		const measured = buildView({ fields, rows: many, view, queryAst: ast });
		const elapsed = performance.now() - started;
		expect(measured.matchedRows).toBe(warm.matchedRows);
		expect(measured.rows).toHaveLength(warm.rows.length);
		expect(elapsed).toBeLessThan(50);
	});
});
