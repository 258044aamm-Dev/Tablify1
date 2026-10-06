/**
 * The harness's data: 5,000 rows × 20 columns, generated from a seed.
 *
 * Three properties, and each one is a choice:
 *
 *  - **Deterministic.** `mulberry32` from a fixed seed, so the same page renders the same bytes on every run. A
 *    screenshot baseline is only meaningful if the thing it photographs is reproducible, and a fixture that
 *    shuffled its data would turn assertion 13 into a coin toss.
 *  - **Wide and tall enough to be honest.** 5,000 rows is past the point where every row has an element (the
 *    windowing is doing real work), and 20 columns is past the point where one pane can show them all, so the
 *    horizontal scroll and the pinned column are exercised rather than simulated.
 *  - **All sixteen field types appear.** A harness that only had text columns would not exercise `formatDisplay`
 *    for a currency, a rating or a checkbox — and the tooltip/pill/star rendering is exactly where a layout bug
 *    hides. The first column is the row's own name (`file.name`), because that is what a row *is* (`docs/01`).
 */
import { createFakeRowSource } from '../tests/fakes/rowSource';
import { resolveField } from '../src/core/schema/propertySchema';
import type { FieldContext, CellValue } from '../src/core/types';
import type { ResolvedField } from '../src/core/schema/propertySchema';
import type { RowSource } from '../src/adapters/RowSource';

/** The seed. One number, so "the same fixture" is a fact rather than a hope. */
export const SEED = 0x5eed_1234;

/** 5,000 rows: enough that no viewport mounts them all. */
export const TOTAL_ROWS = 5_000;

/** A tiny, fast, well-known PRNG. Not cryptography — reproducibility. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b_79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

/** One column of the fixture: the id a `.base` file would write, and the type. */
type ColumnSpec = {
	readonly id: string;
	readonly name: string;
	readonly type: string;
	readonly options?: Readonly<Record<string, unknown>>;
};

/**
 * Twenty columns, of which the first is the row's name. The order is the order the grid renders them in, so the
 * horizontal scroll arithmetic has a stable target.
 */
export const COLUMNS: readonly ColumnSpec[] = [
	{ id: 'file.name', name: 'Name', type: 'text' },
	{
		id: 'note.Status',
		name: 'Status',
		type: 'singleSelect',
		options: {
			options: [
				{ id: 'Backlog', name: 'Backlog', color: 'grey' },
				{ id: 'Doing', name: 'Doing', color: 'blue' },
				{ id: 'Blocked', name: 'Blocked', color: 'red' },
				{ id: 'Done', name: 'Done', color: 'green' },
			],
		},
	},
	{ id: 'note.Owner', name: 'Owner', type: 'text' },
	{ id: 'note.Due', name: 'Due', type: 'date' },
	{ id: 'note.Estimate', name: 'Estimate', type: 'duration', options: { unit: 'hours' } },
	{ id: 'note.Spent', name: 'Spent', type: 'duration', options: { unit: 'hours' } },
	{ id: 'note.Budget', name: 'Budget', type: 'currency', options: { symbol: '€', precision: 0 } },
	{ id: 'note.Progress', name: 'Progress', type: 'percent' },
	{ id: 'note.Score', name: 'Score', type: 'rating', options: { max: 5 } },
	{ id: 'note.Urgent', name: 'Urgent', type: 'checkbox' },
	{
		id: 'note.Tags',
		name: 'Tags',
		type: 'multiSelect',
		options: {
			options: [
				{ id: 'frontend', name: 'frontend', color: 'purple' },
				{ id: 'backend', name: 'backend', color: 'orange' },
				{ id: 'docs', name: 'docs', color: 'yellow' },
			],
		},
	},
	{ id: 'note.Notes', name: 'Notes', type: 'longText' },
	{ id: 'note.Link', name: 'Link', type: 'url' },
	{ id: 'note.Contact', name: 'Contact', type: 'email' },
	{ id: 'note.Phone', name: 'Phone', type: 'phone' },
	{ id: 'note.File', name: 'File', type: 'attachment' },
	{ id: 'note.Created', name: 'Created', type: 'datetime' },
	{ id: 'note.Priority', name: 'Priority', type: 'number' },
	{ id: 'note.Weight', name: 'Weight', type: 'number', options: { precision: 2 } },
	{ id: 'note.Verified', name: 'Verified', type: 'datetime' },
];

/** A date `n` days after 2026-01-01, as the ISO day `date` columns store. */
function day(n: number): string {
	const base = Date.UTC(2026, 0, 1);
	const at = new Date(base + n * 86_400_000);
	return at.toISOString().slice(0, 10);
}

export type HarnessFixture = {
	readonly source: RowSource;
	readonly fields: readonly ResolvedField[];
	readonly totalRows: number;
};

/**
 * Builds the fixture. `rows` is capped by the caller (`window.__harness.setRows(n)`) so a test can shrink the
 * table to something a screenshot can hold — the *fields* never change, because a screenshot baseline that
 * depended on the column count would break every time a column moved.
 */
export function createHarnessFixture(rowCount = TOTAL_ROWS): HarnessFixture {
	const context: FieldContext = {
		path: '',
		now: () => Date.UTC(2026, 9, 6),
		timezone: 'UTC',
		locale: 'en-GB',
		fieldOptions: {},
		columnName: '',
	};
	const fields = COLUMNS.map((column) =>
		resolveField(
			{
				id: column.id,
				name: column.name,
				source: column.id.startsWith('file.') ? 'file' : 'note',
				fieldOptions: { type: column.type, ...column.options },
			},
			{ ...context, columnName: column.name },
		),
	);
	const random = mulberry32(SEED);
	const statuses = ['Backlog', 'Doing', 'Blocked', 'Done'] as const;
	const owners = ['Ada', 'Grace', 'Linus', 'Margaret', 'Barbara'] as const;
	const tags = ['frontend', 'backend', 'docs'] as const;

	const rows = Array.from({ length: rowCount }, (_unused, index) => {
		const cells: Record<string, CellValue> = {};
		const status = statuses[Math.floor(random() * statuses.length)] ?? 'Backlog';
		const owner = owners[Math.floor(random() * owners.length)] ?? 'Ada';
		const tagCount = Math.floor(random() * 3);
		cells['file.name'] = `Task ${String(index + 1).padStart(4, '0')}`;
		cells['note.Status'] = status;
		cells['note.Owner'] = owner;
		cells['note.Due'] = day(30 + Math.floor(random() * 300));
		cells['note.Estimate'] = Math.round(random() * 40);
		cells['note.Spent'] = Math.round(random() * 40);
		cells['note.Budget'] = Math.round(random() * 20_000);
		cells['note.Progress'] = Math.round(random() * 100);
		cells['note.Score'] = 1 + Math.floor(random() * 5);
		cells['note.Urgent'] = random() < 0.15;
		cells['note.Tags'] = tags.slice(0, tagCount);
		cells['note.Notes'] =
			`${owner} asked about the ${status.toLowerCase()} column on this row.`;
		cells['note.Link'] = `https://example.invalid/tasks/${String(index + 1)}`;
		cells['note.Contact'] = `${owner.toLowerCase()}@example.invalid`;
		cells['note.Phone'] = `+31 20 555 ${String(1000 + index).slice(-4)}`;
		cells['note.File'] = index % 4 === 0 ? [`Attachments/brief-${String(index + 1)}.pdf`] : [];
		cells['note.Created'] = `${day(index % 200)}T09:30:00+00:00`;
		cells['note.Priority'] = 1 + Math.floor(random() * 5);
		cells['note.Weight'] = Math.round(random() * 1000) / 100;
		cells['note.Verified'] = index % 3 === 0 ? `${day(index % 200)}T14:00:00+00:00` : null;
		return { filePath: `Tasks/Task ${String(index + 1).padStart(4, '0')}.md`, cells };
	});

	return { source: createFakeRowSource({ fields, rows }), fields, totalRows: rows.length };
}
