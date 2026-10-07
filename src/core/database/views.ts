/**
 * Saved views — R1 step 5, second half.
 *
 * A view is a saved presentation: a filter, a sort stack, a grouping, a column arrangement, widths,
 * and collapsed group keys. It is **not** the plugin's preferences and not the cell data: nothing in
 * this module reads global theme, motion or row-density settings, and nothing a view holds can
 * rewrite a cell. `docs/03` is explicit that opening or focusing a view must not create a write,
 * and this schema keeps that promise cheaply — there is nothing to write, because the view is only
 * read when asked for.
 *
 * The filter reuses the core query AST verbatim (R1 step 5: "saved-view queries must use the
 * existing core AST"). The raw stored document is preserved **as it is** — that is what a round trip
 * owes a newer build's filter node — and a decoded copy plus the decoder's findings travel beside
 * it. Field references are checked against the table's schema here, without importing anything from
 * the UI: an id that names no field is a warning with the reference kept, never a silent drop.
 *
 * Two things a view deliberately does **not** store: row density and the frozen primary column.
 * Both are presentation, both were presentation-only in the Bases era too (`BasesSource`), and a
 * saved view that quietly froze someone's row height per view would be the plugin preference
 * problem wearing a view's name.
 */
import type { Expr } from '../query/ast';
import { decodeQueryDocument, fieldsMentioned } from '../query/ast';
import type { SortDirection } from '../view/pipeline';
import type { TableField } from './fields';
import { findDuplicates, isIdOfKind } from './ids';
import type { JsonValue, UnknownEntry } from './json';
import { describeJson, isJsonArray, isJsonObject, toCanonicalObject, unknownEntries } from './json';
import type { LoadError, LoadWarning } from './result';

/** One level of a view's sort stack. */
export interface ViewSort {
	readonly fieldId: string;
	readonly direction: SortDirection;
	readonly unknown: readonly UnknownEntry[];
}

/** A saved view in the document. */
export interface TableView {
	readonly id: string;
	readonly name: string;
	/** The stored filter document, preserved exactly as written (`null` means no filter). */
	readonly filter: JsonValue | null;
	/** The decoded expression, for evaluation and reference checking; `null` for no filter. */
	readonly filterExpr: Expr | null;
	/** What the query decoder could not read. Each finding also becomes a load warning. */
	readonly filterProblems: readonly string[];
	readonly sorts: readonly ViewSort[];
	readonly groupBy: string | null;
	readonly hiddenFieldIds: readonly string[];
	readonly columnOrder: readonly string[];
	readonly collapsedKeys: readonly string[];
	readonly widths: ReadonlyMap<string, number>;
	readonly unknown: readonly UnknownEntry[];
}

/** The keys a view object owns. */
const VIEW_KEYS: readonly string[] = [
	'id',
	'name',
	'filter',
	'sorts',
	'groupBy',
	'hiddenFieldIds',
	'columnOrder',
	'collapsedKeys',
	'widths',
];

/** The keys one sort entry owns. */
const SORT_KEYS: readonly string[] = ['fieldId', 'direction'];

const DIRECTIONS: readonly SortDirection[] = ['asc', 'desc'];

/** Read an array of field-id strings. Structural problems refuse; the list itself is returned otherwise. */
function readFieldIdList(
	value: JsonValue | undefined,
	path: string,
	what: string,
	errors: LoadError[],
): readonly string[] {
	if (value === undefined) {
		return [];
	}
	if (!isJsonArray(value)) {
		errors.push({
			code: 'invalid-view-fields',
			message: `${what} must be an array of field ids, not ${describeJson(value)}.`,
			path,
		});
		return [];
	}
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string' || !isIdOfKind('field', item)) {
			errors.push({
				code: 'invalid-view-fields',
				message: `${what} must contain field ids shaped like fld_, and one entry is not.`,
				path,
			});
			return [];
		}
		out.push(item);
	}
	return out;
}

/** Read the sort stack. */
function readSorts(
	value: JsonValue | undefined,
	path: string,
	errors: LoadError[],
): readonly ViewSort[] {
	if (value === undefined) {
		return [];
	}
	if (!isJsonArray(value)) {
		errors.push({
			code: 'invalid-view-sorts',
			message: `The sorts list must be an array, not ${describeJson(value)}.`,
			path,
		});
		return [];
	}
	const sorts: ViewSort[] = [];
	for (const [index, item] of value.entries()) {
		const itemPath = `${path}[${index}]`;
		if (!isJsonObject(item)) {
			errors.push({
				code: 'invalid-view-sort',
				message: `Every sort must be a JSON object, not ${describeJson(item)}.`,
				path: itemPath,
			});
			return [];
		}
		const fieldId = item['fieldId'];
		const direction = item['direction'];
		const chosen =
			typeof direction === 'string' ? DIRECTIONS.find((d) => d === direction) : undefined;
		if (typeof fieldId !== 'string' || !isIdOfKind('field', fieldId) || chosen === undefined) {
			errors.push({
				code: 'invalid-view-sort',
				message: `A sort needs a fieldId shaped like fld_ and a direction of asc or desc; ${itemPath} does not have both.`,
				path: itemPath,
			});
			return [];
		}
		sorts.push({ fieldId, direction: chosen, unknown: unknownEntries(item, SORT_KEYS) });
	}
	return sorts;
}

/** Read the per-field widths map. Keys may name fields this table does not have (warned, kept). */
function readWidths(
	value: JsonValue | undefined,
	path: string,
	errors: LoadError[],
): ReadonlyMap<string, number> {
	const widths = new Map<string, number>();
	if (value === undefined) {
		return widths;
	}
	if (!isJsonObject(value)) {
		errors.push({
			code: 'invalid-view-widths',
			message: `The widths must be a JSON object of field ids to pixel widths, not ${describeJson(value)}.`,
			path,
		});
		return widths;
	}
	for (const [fieldId, width] of Object.entries(value)) {
		if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
			errors.push({
				code: 'invalid-view-width',
				message: `The width of "${fieldId}" must be a positive number, not ${describeJson(width)}.`,
				path: `${path}.${fieldId}`,
			});
			continue;
		}
		widths.set(fieldId, width);
	}
	return widths;
}

/** Read one view. `fieldIds` is the table's schema, for reference checks. */
function readView(
	value: JsonValue,
	path: string,
	fieldIds: ReadonlySet<string>,
	errors: LoadError[],
	warnings: LoadWarning[],
): TableView | undefined {
	if (!isJsonObject(value)) {
		errors.push({
			code: 'invalid-view',
			message: `Every view must be a JSON object, not ${describeJson(value)}.`,
			path,
		});
		return undefined;
	}

	const id = value['id'];
	if (typeof id !== 'string' || !isIdOfKind('view', id)) {
		errors.push({
			code: 'invalid-view-id',
			message:
				'Every view needs an id shaped like viw_ followed by lowercase letters and digits.',
			path: `${path}.id`,
		});
		return undefined;
	}
	const name = value['name'];
	if (typeof name !== 'string' || name === '') {
		errors.push({
			code: 'invalid-view-name',
			message: 'Every view needs a non-empty name.',
			path: `${path}.name`,
		});
		return undefined;
	}

	const rawFilter = value['filter'];
	let filter: JsonValue | null = null;
	let filterExpr: Expr | null = null;
	let filterProblems: readonly string[] = [];
	if (rawFilter !== undefined && rawFilter !== null) {
		if (!isJsonObject(rawFilter)) {
			errors.push({
				code: 'invalid-view-filter',
				message: `A view filter must be a stored query object, not ${describeJson(rawFilter)}.`,
				path: `${path}.filter`,
			});
			return undefined;
		}
		filter = rawFilter;
		const decoded = decodeQueryDocument(rawFilter);
		filterExpr = decoded.expr;
		filterProblems = decoded.problems;
		for (const problem of decoded.problems) {
			warnings.push({
				code: 'view-filter-problem',
				message: `The filter of "${name}" could not be read in full: ${problem}.`,
				path: `${path}.filter`,
			});
		}
	}

	const sorts = readSorts(value['sorts'], `${path}.sorts`, errors);
	const hiddenFieldIds = readFieldIdList(
		value['hiddenFieldIds'],
		`${path}.hiddenFieldIds`,
		'The hidden fields list',
		errors,
	);
	const columnOrder = readFieldIdList(
		value['columnOrder'],
		`${path}.columnOrder`,
		'The column order',
		errors,
	);
	const collapsedValue = value['collapsedKeys'];
	const collapsedKeys: string[] = [];
	if (collapsedValue !== undefined) {
		if (!isJsonArray(collapsedValue)) {
			errors.push({
				code: 'invalid-view-collapsed',
				message: `The collapsed group keys must be an array of strings, not ${describeJson(collapsedValue)}.`,
				path: `${path}.collapsedKeys`,
			});
			return undefined;
		}
		for (const item of collapsedValue) {
			if (typeof item !== 'string') {
				errors.push({
					code: 'invalid-view-collapsed',
					message: 'Every collapsed group key must be a string.',
					path: `${path}.collapsedKeys`,
				});
				return undefined;
			}
			collapsedKeys.push(item);
		}
	}

	const groupByValue = value['groupBy'];
	let groupBy: string | null = null;
	if (groupByValue !== undefined && groupByValue !== null) {
		if (typeof groupByValue !== 'string' || !isIdOfKind('field', groupByValue)) {
			errors.push({
				code: 'invalid-view-group',
				message: `A view's groupBy must be a field id shaped like fld_, not ${describeJson(groupByValue)}.`,
				path: `${path}.groupBy`,
			});
			return undefined;
		}
		groupBy = groupByValue;
	}

	const widths = readWidths(value['widths'], `${path}.widths`, errors);

	// Reference checks: every field id this view names must exist in the table. A reference that
	// does not is kept — the user may restore the field, or a newer build may — and warned about.
	const reference = (fieldId: string, at: string): void => {
		if (!fieldIds.has(fieldId)) {
			warnings.push({
				code: 'view-unknown-field',
				message: `The view "${name}" refers to the field "${fieldId}", which this table does not have; the reference is kept as it is.`,
				path: at,
			});
		}
	};
	sorts.forEach((sort, index) => reference(sort.fieldId, `${path}.sorts[${index}].fieldId`));
	if (groupBy !== null) {
		reference(groupBy, `${path}.groupBy`);
	}
	hiddenFieldIds.forEach((fieldId, index) =>
		reference(fieldId, `${path}.hiddenFieldIds[${index}]`),
	);
	columnOrder.forEach((fieldId, index) => reference(fieldId, `${path}.columnOrder[${index}]`));
	for (const fieldId of widths.keys()) {
		reference(fieldId, `${path}.widths.${fieldId}`);
	}
	for (const fieldId of fieldsMentioned(filterExpr)) {
		reference(fieldId, `${path}.filter`);
	}

	// A field id listed twice in one arrangement is a warning, not a refusal: nothing is lost by
	// keeping it, and the duplicate is visible in the message.
	const checkDuplicates = (list: readonly string[], at: string, what: string): void => {
		for (const fieldId of findDuplicates(list)) {
			warnings.push({
				code: 'view-duplicate-field',
				message: `The ${what} of "${name}" lists the field "${fieldId}" more than once.`,
				path: at,
			});
		}
	};
	checkDuplicates(
		sorts.map((sort) => sort.fieldId),
		`${path}.sorts`,
		'sort stack',
	);
	checkDuplicates(columnOrder, `${path}.columnOrder`, 'column order');
	checkDuplicates(hiddenFieldIds, `${path}.hiddenFieldIds`, 'hidden fields list');

	return {
		id,
		name,
		filter,
		filterExpr,
		filterProblems,
		sorts,
		groupBy,
		hiddenFieldIds,
		columnOrder,
		collapsedKeys,
		widths,
		unknown: unknownEntries(value, VIEW_KEYS),
	};
}

/**
 * Read a table's view list.
 *
 * The guide asks for "one or more saved views"; an empty list is accepted rather than refused —
 * a table whose only view was deleted is a state a UI can produce, and refusing the file would
 * turn a UI bug into a load failure. R4's table creation writes one view; the reader does not
 * require it.
 */
export function readViews(
	source: JsonValue | undefined,
	path: string,
	fields: readonly TableField[],
	errors: LoadError[],
	warnings: LoadWarning[],
): readonly TableView[] {
	if (source === undefined) {
		errors.push({
			code: 'missing-views',
			message: 'Every table needs a views list, even when it is empty.',
			path,
		});
		return [];
	}
	if (!isJsonArray(source)) {
		errors.push({
			code: 'invalid-views',
			message: `The views list must be an array, not ${describeJson(source)}.`,
			path,
		});
		return [];
	}

	const fieldIds = new Set<string>();
	for (const field of fields) {
		if (field.id !== null) {
			fieldIds.add(field.id);
		}
	}

	const views: TableView[] = [];
	const firstIndexById = new Map<string, number>();
	source.forEach((item, index) => {
		const view = readView(item, `${path}[${index}]`, fieldIds, errors, warnings);
		if (view === undefined) {
			return;
		}
		const first = firstIndexById.get(view.id);
		if (first !== undefined) {
			errors.push({
				code: 'duplicate-view-id',
				message: `The view id "${view.id}" is used by both views[${first}] and views[${index}].`,
				path: `${path}[${index}]`,
			});
			return;
		}
		firstIndexById.set(view.id, index);
		views.push(view);
	});
	return views;
}

/** Serialize one sort entry. */
function serializeSort(sort: ViewSort): JsonValue {
	return toCanonicalObject(
		[
			['fieldId', sort.fieldId],
			['direction', sort.direction],
		],
		sort.unknown,
	);
}

/**
 * Write one view back, with the widths object keyed in the table's field order first (a readable
 * diff), then any width whose field the table does not have, in the order the map holds it.
 */
export function serializeView(view: TableView, fieldOrder: readonly string[]): JsonValue {
	let widths: JsonValue | undefined;
	if (view.widths.size > 0) {
		const entries: (readonly [string, JsonValue | undefined])[] = [];
		const claimed = new Set<string>();
		for (const fieldId of fieldOrder) {
			const width = view.widths.get(fieldId);
			if (width !== undefined) {
				claimed.add(fieldId);
				entries.push([fieldId, width]);
			}
		}
		for (const [fieldId, width] of view.widths) {
			if (!claimed.has(fieldId)) {
				entries.push([fieldId, width]);
			}
		}
		widths = toCanonicalObject(entries, []);
	}

	return toCanonicalObject(
		[
			['id', view.id],
			['name', view.name],
			['filter', view.filter ?? undefined],
			['sorts', view.sorts.length === 0 ? undefined : view.sorts.map(serializeSort)],
			['groupBy', view.groupBy ?? undefined],
			['hiddenFieldIds', view.hiddenFieldIds.length === 0 ? undefined : view.hiddenFieldIds],
			['columnOrder', view.columnOrder.length === 0 ? undefined : view.columnOrder],
			['collapsedKeys', view.collapsedKeys.length === 0 ? undefined : view.collapsedKeys],
			['widths', widths],
		],
		view.unknown,
	);
}
