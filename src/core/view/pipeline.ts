/**
 * The pipeline: rows + view config in, the visible, ordered, grouped row set out.
 *
 * Order is filter → search → sort → group, and each step is one pass:
 *
 * - **The query first, the search box second.** The query is the structured filter (cheap per row, and the
 *   thing the user wrote deliberately); the search box is a *substring* test over every visible value
 *   (`formatPlain`, see below). Doing the cheap structured cut first means the search only ever runs on the
 *   rows that survive it.
 * - **`formatPlain`, not `formatDisplay`, is what the search box reads.** `formatDisplay` is locale-shaped
 *   for humans (`31 Dec 2026`, `১,২৩৪.৫` in a Bengali vault) and `formatPlain` is the machine spelling
 *   (`2026-12-31`, `1234.5`). Searching the machine spelling means one search string finds the same rows in
 *   every vault, and it is the text `parsePlain` accepts — so a search that looks right can be pasted
 *   straight into a cell. The cost is honest: typing `$4` will not find `4.50` in a currency column.
 * - **Sorting is stable and its last key is the row's file path**, ascending, whatever the sort directions
 *   are. A 5,000-row grid must not shuffle two equal rows between renders, and "equal" is common (empty
 *   cells, the same date). The file path is the tiebreak because it is the row's identity.
 * - **`rows` holds data rows only, and only the ones that should be drawn.** Group headers are *derived*
 *   (`groups` carries the same row objects), because the grid windows over an array of known-height rows: a
 *   pseudo-row would have to be measured, distinguished and skipped by every selection, keyboard and
 *   clipboard path in the grid. A *collapsed* group's rows are left out of `rows` for the same reason —
 *   they have no height on screen — while the group still reports them (`count`, `rows`) so expanding needs
 *   no recomputation. `matchedRows` is therefore the number the filter and the search box let through, and
 *   `rows.length` is the number on screen; the two differ only when something is collapsed.
 *
 * Performance is a contract here, not a hope: filtering and searching are one pass with no per-row array
 * (the matched rows are pushed into a single result array), and the sort allocates one decorated array of
 * indices rather than copying rows. The sort's comparator resolves columns from a `Map` built once.
 */
import type { Expr, QueryContext } from '../query/ast';
import { cellOf, evaluate } from '../query/evaluate';
import type { RowView } from '../query/evaluate';
import type { ResolvedField } from '../schema/propertySchema';
import type { CellValue, PropertyId } from '../types';

/** Which way a column sorts. */
export type SortDirection = 'asc' | 'desc';

/** One level of the multi-sort, applied in order. */
export type SortSpec = {
	readonly fieldId: PropertyId;
	readonly direction: SortDirection;
};

/** The view options the pipeline reads. Everything else about a view is the grid's business. */
export type ViewConfig = {
	/** The toolbar's search box. Empty or absent means "no search". */
	readonly search?: string;
	/** Multi-sort, first entry wins. Absent means "the source order, untouched". */
	readonly sorts?: readonly SortSpec[];
	/** The column to group by, if the view groups at all. */
	readonly groupBy?: PropertyId;
	/** Group keys the user has collapsed. Carried from the `.base` sidecar, never recomputed. */
	readonly collapsedKeys?: readonly string[];
	/** Columns the user hid. They are not searched, because the search box promises visible values only. */
	readonly hiddenFieldIds?: readonly PropertyId[];
	/** The column order the user dragged into place. Ids the view does not have are dropped. */
	readonly columnOrder?: readonly PropertyId[];
};

/**
 * The label for the group that holds rows with no value. The key of that group is the empty string — both
 * `textGroupKey` and `numericGroupKey` use `''` for "no value" — and a header cannot show nothing, so the
 * pipeline names it. It is the one piece of user-facing text in this module; the renderer may replace it.
 */
export const EMPTY_GROUP_LABEL = '(empty)';

/** One group: its key, its label, and the rows in the order they were sorted into. */
export type ViewGroup = {
	/** The registry's `groupKey`: folded and stable, which is what a `.base` file stores. */
	readonly key: string;
	/**
	 * What the header shows: the column's own `formatDisplay` for the group's value, so a select reads
	 * "Doing" rather than the folded key "doing", and a date reads the way the vault formats dates.
	 */
	readonly label: string;
	readonly count: number;
	readonly collapsed: boolean;
	/** The rows of this group, in pipeline order — the same objects `ViewResult.rows` holds. */
	readonly rows: readonly RowView[];
};

/** Everything the grid needs to render one frame. */
export type ViewResult = {
	/** The flat, ordered rows the grid windows over: data rows only, collapsed groups left out. */
	readonly rows: readonly RowView[];
	/** Groups in first-appearance order. Empty when the view does not group. */
	readonly groups: readonly ViewGroup[];
	readonly hiddenFieldIds: readonly PropertyId[];
	/** Every column id in render order: the configured ones first, then the rest in schema order. */
	readonly columnOrder: readonly PropertyId[];
	/** Rows the source offered, before the query and the search box. For "312 of 5,000". */
	readonly totalRows: number;
	/**
	 * Rows the query and the search box let through. Equal to `rows.length` unless a group is collapsed, in
	 * which case `rows` is shorter — that is the difference between "matched" and "on screen".
	 */
	readonly matchedRows: number;
};

/** What `buildView` is called with. One object, so a caller cannot transpose two arrays by accident. */
export type BuildViewInput = {
	readonly fields: readonly ResolvedField[];
	readonly rows: readonly RowView[];
	readonly view: ViewConfig;
	readonly queryAst: Expr | null;
};

/** A row plus where it came from, so the sort can be total without depending on `Array.prototype.sort`. */
type Entry = {
	readonly row: RowView;
	readonly index: number;
};

/** Builds the visible row set. Pure: the input rows are never touched, and nothing is cached between calls. */
export function buildView(input: BuildViewInput): ViewResult {
	const ctx: QueryContext = { fields: input.fields };
	const byId = new Map<PropertyId, ResolvedField>();
	for (const field of input.fields) {
		byId.set(field.definition.id, field);
	}

	const hidden = collectIds(input.view.hiddenFieldIds, byId);
	const hiddenSet = new Set(hidden);
	const search = (input.view.search ?? '').trim().toLocaleLowerCase();

	// One pass, one array: filtering and searching share the loop, and the row objects are never copied.
	const matched: RowView[] = [];
	for (const row of input.rows) {
		if (!evaluate(input.queryAst, row, ctx)) {
			continue;
		}
		if (search !== '' && !matchesSearch(row, search, input.fields, hiddenSet)) {
			continue;
		}
		matched.push(row);
	}

	const ordered =
		input.view.sorts === undefined || input.view.sorts.length === 0
			? matched
			: sortRows(matched, input.view.sorts, byId);

	const groups = groupRows(ordered, input.view, byId);
	const collapsed = new Set(groups.filter((group) => group.collapsed).map((group) => group.key));
	const visible =
		collapsed.size === 0
			? ordered
			: ordered.filter((row) => !isCollapsedRow(row, groups, collapsed));

	return {
		rows: visible,
		groups,
		hiddenFieldIds: hidden,
		columnOrder: collectOrder(input.view.columnOrder, input.fields, byId),
		totalRows: input.rows.length,
		matchedRows: ordered.length,
	};
}

/** True when any visible column's machine-plain text contains the search text (already lower-cased). */
function matchesSearch(
	row: RowView,
	search: string,
	fields: readonly ResolvedField[],
	hidden: ReadonlySet<PropertyId>,
): boolean {
	for (const field of fields) {
		const id = field.definition.id;
		if (hidden.has(id)) {
			continue;
		}
		const text = field.descriptor.formatPlain(cellOf(row, id), field.context);
		if (text.toLocaleLowerCase().includes(search)) {
			return true;
		}
	}
	return false;
}

/** Sorts with the configured levels, then by file path, then by source index. Never mutates the input. */
function sortRows(
	rows: readonly RowView[],
	sorts: readonly SortSpec[],
	byId: ReadonlyMap<PropertyId, ResolvedField>,
): readonly RowView[] {
	const entries: Entry[] = rows.map((row, index) => ({ row, index }));
	entries.sort((left, right) => compareEntries(left, right, sorts, byId));
	return entries.map((entry) => entry.row);
}

function compareEntries(
	left: Entry,
	right: Entry,
	sorts: readonly SortSpec[],
	byId: ReadonlyMap<PropertyId, ResolvedField>,
): number {
	for (const spec of sorts) {
		const field = byId.get(spec.fieldId);
		if (field === undefined) {
			// A sort level for a column the view does not have is skipped, like a filter for one.
			continue;
		}
		const result = field.descriptor.compare(
			cellOf(left.row, spec.fieldId),
			cellOf(right.row, spec.fieldId),
			field.context,
		);
		if (result !== 0) {
			return spec.direction === 'desc' ? -result : result;
		}
	}
	// The tiebreak: the row's own path, ascending, regardless of the sort's direction. Two rows that compare
	// equal therefore always come out in the same order, which is what makes the grid deterministic.
	if (left.row.rowId < right.row.rowId) {
		return -1;
	}
	if (left.row.rowId > right.row.rowId) {
		return 1;
	}
	return left.index - right.index;
}

/** Groups consecutive rows by the registry's `groupKey`, preserving the sorted order inside each group. */
function groupRows(
	rows: readonly RowView[],
	view: ViewConfig,
	byId: ReadonlyMap<PropertyId, ResolvedField>,
): readonly ViewGroup[] {
	const groupBy = view.groupBy;
	if (groupBy === undefined) {
		return [];
	}
	const field = byId.get(groupBy);
	if (field === undefined) {
		return [];
	}
	const collapsed = new Set(view.collapsedKeys ?? []);
	const order: string[] = [];
	const buckets = new Map<string, RowView[]>();
	const firstValue = new Map<string, CellValue>();
	for (const row of rows) {
		const value = cellOf(row, groupBy);
		const key = field.descriptor.groupKey(value, field.context);
		const bucket = buckets.get(key);
		if (bucket === undefined) {
			buckets.set(key, [row]);
			firstValue.set(key, value);
			order.push(key);
		} else {
			bucket.push(row);
		}
	}
	return order.map((key) => {
		const bucket = buckets.get(key) ?? [];
		const value = firstValue.get(key) ?? null;
		const shown = field.descriptor.formatDisplay(value, field.context);
		return {
			key,
			label: shown === '' ? EMPTY_GROUP_LABEL : shown,
			count: bucket.length,
			collapsed: collapsed.has(key),
			rows: bucket,
		};
	});
}

/**
 * True when this row belongs only to collapsed groups. A row is a member of exactly one group, so one
 * membership test is enough; the groups' own row lists carry the same objects, which is what makes the
 * identity check safe and cheap.
 */
function isCollapsedRow(
	row: RowView,
	groups: readonly ViewGroup[],
	collapsed: ReadonlySet<string>,
): boolean {
	for (const group of groups) {
		if (!collapsed.has(group.key)) {
			continue;
		}
		if (group.rows.includes(row)) {
			return true;
		}
	}
	return false;
}

/** The hidden ids that exist in this view, in the order the config lists them, without duplicates. */
function collectIds(
	ids: readonly PropertyId[] | undefined,
	byId: ReadonlyMap<PropertyId, ResolvedField>,
): readonly PropertyId[] {
	const seen: PropertyId[] = [];
	for (const id of ids ?? []) {
		if (byId.has(id) && !seen.includes(id)) {
			seen.push(id);
		}
	}
	return seen;
}

/**
 * The render order for this view's columns: the configured order first (dropping ids the view no longer
 * has), then every remaining column in schema order. The result always names every column exactly once,
 * which is what lets the grid render from it without a second "what did we forget" pass.
 */
function collectOrder(
	configured: readonly PropertyId[] | undefined,
	fields: readonly ResolvedField[],
	byId: ReadonlyMap<PropertyId, ResolvedField>,
): readonly PropertyId[] {
	const order: PropertyId[] = [];
	for (const id of configured ?? []) {
		if (byId.has(id) && !order.includes(id)) {
			order.push(id);
		}
	}
	for (const field of fields) {
		if (!order.includes(field.definition.id)) {
			order.push(field.definition.id);
		}
	}
	return order;
}
