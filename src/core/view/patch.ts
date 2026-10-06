/**
 * The view patch as it travels to and from a `.base` sidecar.
 *
 * `ViewPatch` (`src/core/ops/types.ts`) is what a `setViewConfig` op carries and what `BasesSource` writes into
 * the view's own config under `tablifyViewConfig`. This module is the **read** side of that trip, and it is the
 * one piece of the path that cannot trust its input: the sidecar is a YAML string in a file the user owns and can
 * edit by hand, and `docs/03` §Storage is explicit that a hand-edited sidecar must not break the grid.
 *
 * So `parseViewPatch` is *total*: it never throws, it never guesses, and it drops anything it does not recognise
 * rather than coercing it. A string where an array belongs means that key is absent, not that the view should
 * start with a one-character group-by. Everything rejected is simply "the setting did not survive", which is the
 * behaviour a person can recover from by setting it again — as opposed to a grid that will not open.
 *
 * The writer's side is deliberately still `JSON.stringify(patch)` in `BasesSource`: a key whose value is
 * `undefined` means *remove this setting* (see `ViewPatch`'s own doc) and `JSON.stringify` drops it, which is the
 * convention Obsidian's `setConfig(key, value: string)` can express. This module reads what that wrote — it does
 * not re-specify it.
 */
import type { PropertyId } from '../types';
import type { SortDirection } from './pipeline';
import type { ViewPatch } from '../ops/types';

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** A sort direction, or `null` for anything that is not one. Narrowing, not a cast: the literal union is named. */
const sortDirection = (value: unknown): SortDirection | null =>
	value === 'asc' || value === 'desc' ? value : null;

/** A string array, with every non-string entry dropped. `null` for "this is not a string array". */
function stringArray(value: unknown): string[] | null {
	if (!Array.isArray(value)) {
		return null;
	}
	const out: string[] = [];
	for (const entry of value) {
		if (typeof entry === 'string') {
			out.push(entry);
		}
	}
	return out;
}

/**
 * A patch from whatever the sidecar holds: a JSON string (what the write path produces), an already-parsed object
 * (what a test passes), or anything else (which yields `{}`).
 */
export function parseViewPatch(raw: unknown): ViewPatch {
	let source: unknown = raw;
	if (typeof raw === 'string') {
		if (raw.trim() === '') {
			return {};
		}
		try {
			source = JSON.parse(raw);
		} catch {
			// A truncated or hand-mangled JSON string is an absent patch, never an error the grid has to survive.
			return {};
		}
	}
	if (!isObject(source)) {
		return {};
	}

	const patch: {
		search?: string;
		sorts?: { fieldId: PropertyId; direction: SortDirection }[];
		groupBy?: PropertyId;
		collapsedKeys?: string[];
		hiddenFieldIds?: PropertyId[];
		columnOrder?: PropertyId[];
	} = {};

	const search = source['search'];
	if (typeof search === 'string') {
		patch.search = search;
	}

	const sorts = source['sorts'];
	if (Array.isArray(sorts)) {
		const parsed: { fieldId: PropertyId; direction: SortDirection }[] = [];
		for (const entry of sorts) {
			if (!isObject(entry)) {
				continue;
			}
			const fieldId = entry['fieldId'];
			const direction = sortDirection(entry['direction']);
			if (typeof fieldId === 'string' && direction !== null) {
				parsed.push({ fieldId, direction });
			}
		}
		patch.sorts = parsed;
	}

	const groupBy = source['groupBy'];
	if (typeof groupBy === 'string') {
		patch.groupBy = groupBy;
	}

	const collapsedKeys = stringArray(source['collapsedKeys']);
	if (collapsedKeys !== null) {
		patch.collapsedKeys = collapsedKeys;
	}
	const hiddenFieldIds = stringArray(source['hiddenFieldIds']);
	if (hiddenFieldIds !== null) {
		patch.hiddenFieldIds = hiddenFieldIds;
	}
	const columnOrder = stringArray(source['columnOrder']);
	if (columnOrder !== null) {
		patch.columnOrder = columnOrder;
	}

	return patch;
}

/** Whether a parsed patch asks for anything at all. The view uses it to skip a no-op store option. */
export function isEmptyViewPatch(patch: ViewPatch): boolean {
	return Object.keys(patch).length === 0;
}
