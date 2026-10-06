/**
 * Selectors, and the only React in the store's half of the grid.
 *
 * A selector is a pure function from the store's state to one value a component needs. Two kinds live here,
 * and the split is deliberate:
 *
 *   · **narrow primitives** — `useCellDisplay`, `useCellValue`, `useCellFlags`, `useRowFlags`. What a cell
 *     subscribes to is a `string`, a `CellValue`, or a small object compared field by field. React compares
 *     the previous value with the new one using the hook's own equality, so a cell whose text did not change
 *     is not re-rendered at all — it is not even scheduled. This is the whole of the "a keystroke re-renders
 *     one cell" rule, and `tests/dom/store-render.test.ts` counts it.
 *   · **whole-snapshot reads** — `useStore(selector)` / `useStoreSelector(selector, isEqual)` for the
 *     toolbar, the status bar and the empty state. There are a handful of these, and they may re-render when
 *     anything changes.
 *
 * ## Memoisation, and what invalidates it
 *
 * The expensive derivations — the row index, the column index, where each group starts — are keyed on the
 * **snapshot object**, which the store replaces exactly when it changed and hands back unchanged otherwise.
 * A `WeakMap` therefore gives one derivation per revision and lets it die with the snapshot it describes.
 * The cheap part — window arithmetic, a slice, bounds — runs per call, because it is arithmetic.
 *
 * ## Why there is no `useGridState()`
 *
 * `docs/02` §Store: components subscribe with narrow selectors. There is deliberately no hook that hands a
 * component the whole snapshot: the first component that took it would re-render the grid on every
 * keystroke, and nothing would catch it until the grid was slow.
 */
import { useCallback, useRef, useSyncExternalStore } from 'react';

import { fieldsOf, normalize, rowsOf, sizeOf } from '../../core/selection/range';
import type { Bounds, Range, RangeOrder } from '../../core/selection/range';
import { cellAt, isPending } from './store';
import { rowWindow, windowSlice } from './window';
import type { RowWindow } from './window';
import type {
	CellSnapshot,
	GridSnapshot,
	GridState,
	GridStore,
	GroupSpan,
	StatusSummary,
} from './types';
import type { CellRef, RowId } from '../../core/ops/types';
import type { CellValue, PropertyId } from '../../core/types';
import type { ResolvedField } from '../../core/schema/propertySchema';
import type { ViewGroup } from '../../core/view/pipeline';

/* ── derivations, one per snapshot ─────────────────────────────────────────── */

type Derived = {
	/** Row id → its index in view order. The window does not need it; the range does. */
	readonly rowIndex: Map<RowId, number>;
	/** Column id → its index in render order. */
	readonly fieldIndex: Map<PropertyId, number>;
	/** Column id → the resolved column. */
	readonly fieldById: Map<PropertyId, ResolvedField>;
	/** Where each group starts in the flat row order, in group order. */
	readonly groupStarts: readonly { readonly group: ViewGroup; readonly start: number }[];
	/**
	 * The row lane's item list: group headers and rows, interleaved, in render order. See
	 * {@link selectLaneItems} for why a header is an item rather than an overlay.
	 */
	readonly laneItems: readonly LaneItem[];
};

const derivedCache = new WeakMap<GridSnapshot, Derived>();

function derive(snapshot: GridSnapshot): Derived {
	const cached = derivedCache.get(snapshot);
	if (cached !== undefined) {
		return cached;
	}
	const rowIndex = new Map<RowId, number>();
	for (const [index, filePath] of snapshot.rows.entries()) {
		rowIndex.set(filePath, index);
	}
	const fieldIndex = new Map<PropertyId, number>();
	for (const [index, fieldId] of snapshot.order.fields.entries()) {
		fieldIndex.set(fieldId, index);
	}
	const fieldById = new Map<PropertyId, ResolvedField>();
	for (const field of snapshot.fields) {
		fieldById.set(field.definition.id, field);
	}
	const groupStarts: { group: ViewGroup; start: number }[] = [];
	let at = 0;
	for (const group of snapshot.result.groups) {
		groupStarts.push({ group, start: at });
		at += group.rows.length;
	}
	const built: Derived = {
		rowIndex,
		fieldIndex,
		fieldById,
		groupStarts,
		laneItems: buildLaneItems(snapshot),
	};
	derivedCache.set(snapshot, built);
	return built;
}

/* ── pure selectors ────────────────────────────────────────────────────────── */

/** What `selectRows` answers: the window, the rows in it, and the two numbers a renderer positions with. */
export type RowSlice = {
	readonly window: RowWindow;
	readonly rows: readonly RowId[];
	readonly offsetY: number;
	readonly totalHeight: number;
};

/**
 * The windowed slice. Invalidated by: a new snapshot (the row order changed) or a new scroll position —
 * which is why the scroll position is an *argument* rather than store state. Scrolling must not bump the
 * store's revision, or every scroll frame would notify every subscriber in the grid.
 */
export function selectRows(
	snapshot: GridSnapshot,
	input: {
		readonly scrollTop: number;
		readonly viewportHeight: number;
		readonly rowHeight: number;
		readonly overscan?: number;
	},
): RowSlice {
	const window = rowWindow({ ...input, rowCount: snapshot.rows.length });
	return {
		window,
		rows: snapshot.rows.slice(window.start, window.end),
		offsetY: window.offsetY,
		totalHeight: window.totalHeight,
	};
}

/** The resolved column for an id, or `undefined` when the view does not have it. */
export function selectField(state: GridState, propertyId: PropertyId): ResolvedField | undefined {
	return state.fields.find((candidate) => candidate.definition.id === propertyId);
}

/** One cell as a cell component reads it: the value with the overlay applied, and what may be done with it. */
export function selectCell(state: GridState, ref: CellRef): CellSnapshot {
	const field = selectField(state, ref.fieldId);
	return {
		value: cellAt(state, ref.filePath, ref.fieldId),
		pending: isPending(state, ref.filePath, ref.fieldId),
		readOnly: field === undefined || field.readOnly || !field.descriptor.editable,
	};
}

/** What a cell shows: the descriptor's own `formatDisplay`, never a grid-side `String(value)`. */
export function selectCellDisplay(state: GridState, ref: CellRef): string {
	const field = selectField(state, ref.fieldId);
	if (field === undefined) {
		return '';
	}
	return field.descriptor.formatDisplay(cellAt(state, ref.filePath, ref.fieldId), field.context);
}

/** The range as positions, or `null` when nothing is selected or an endpoint has left the view. */
export function selectSelectionBounds(snapshot: GridSnapshot): Bounds | null {
	return snapshot.selection === null ? null : normalize(snapshot.selection, snapshot.order);
}

/** The rows a range covers, in order. */
export function selectSelectionRows(snapshot: GridSnapshot): readonly RowId[] {
	return snapshot.selection === null ? [] : rowsOf(snapshot.selection, snapshot.order);
}

/** The columns a range covers, in render order. */
export function selectSelectionFields(snapshot: GridSnapshot): readonly PropertyId[] {
	return snapshot.selection === null ? [] : fieldsOf(snapshot.selection, snapshot.order);
}

/** How big the selection is: rows × columns × cells. The status bar's wording comes from these. */
export function selectSelectionSize(snapshot: GridSnapshot): {
	readonly rows: number;
	readonly fields: number;
	readonly cells: number;
} {
	if (snapshot.selection === null) {
		return { rows: 0, fields: 0, cells: 0 };
	}
	const size = sizeOf(snapshot.selection, snapshot.order);
	return { rows: size.rows, fields: size.fields, cells: size.rows * size.fields };
}

/** The columns in render order: the resolved column for every id the pipeline put in the order. */
export function selectVisibleFields(snapshot: GridSnapshot): readonly ResolvedField[] {
	const { fieldById } = derive(snapshot);
	const out: ResolvedField[] = [];
	for (const fieldId of snapshot.order.fields) {
		const field = fieldById.get(fieldId);
		if (field !== undefined) {
			out.push(field);
		}
	}
	return out;
}

/** Where a cell sits in the view, or `null` when it is not in it. Built once per snapshot. */
export function positionOf(
	snapshot: GridSnapshot,
	ref: CellRef,
): { readonly row: number; readonly field: number } | null {
	const { rowIndex, fieldIndex } = derive(snapshot);
	const row = rowIndex.get(ref.filePath);
	const field = fieldIndex.get(ref.fieldId);
	return row === undefined || field === undefined ? null : { row, field };
}

/** True when the cell is inside the current range. */
export function selectIsInRange(snapshot: GridSnapshot, ref: CellRef): boolean {
	const bounds = selectSelectionBounds(snapshot);
	const position = positionOf(snapshot, ref);
	if (bounds === null || position === null) {
		return false;
	}
	return (
		position.row >= bounds.top &&
		position.row <= bounds.bottom &&
		position.field >= bounds.left &&
		position.field <= bounds.right
	);
}

/** True when the cell is the range's focus (the active cell). */
export function selectIsActive(snapshot: GridSnapshot, ref: CellRef): boolean {
	const active = snapshot.active;
	return active !== null && active.filePath === ref.filePath && active.fieldId === ref.fieldId;
}

/** True when the row is inside the range's rows. */
export function selectRowChecked(snapshot: GridSnapshot, filePath: RowId): boolean {
	return (
		snapshot.selection !== null && rowsOf(snapshot.selection, snapshot.order).includes(filePath)
	);
}

/**
 * The group headers that intersect the window, positioned by flat row index. A collapsed group has
 * `start === end`, which is what lets the renderer draw its header without reserving a row for it.
 */
export function selectGroupSpans(snapshot: GridSnapshot, window: RowWindow): readonly GroupSpan[] {
	const spans: GroupSpan[] = [];
	for (const { group, start } of derive(snapshot).groupStarts) {
		const end = start + group.rows.length;
		if (end < window.start || start > window.end) {
			continue;
		}
		spans.push({
			key: group.key,
			label: group.label,
			count: group.count,
			collapsed: group.collapsed,
			start,
			end,
		});
	}
	return spans;
}

/**
 * One thing the row lane draws. **A group header is exactly `rowHeight` tall**, so the uniform-row
 * arithmetic from step 16 windows the item list unchanged — `rowCount` becomes `items.length` and every other
 * line of the maths stays true. The prototype made the same decision, and it is the reason grouping needs no
 * second windowing path: an item is an item.
 */
export type LaneItem =
	| {
			readonly kind: 'group';
			/** Stable across revisions while the group exists: the pipeline's own `groupKey`. */
			readonly key: string;
			readonly label: string;
			readonly count: number;
			readonly collapsed: boolean;
			/** Its position in the lane, so a key can be unique without composing one from two fields. */
			readonly index: number;
	  }
	| {
			readonly kind: 'row';
			readonly filePath: RowId;
			/** Its position in the *flat row order* — what `aria-rowindex` and the range model speak. */
			readonly rowIndex: number;
			readonly index: number;
	  };

/**
 * The lane's items. Two readings were possible and the docs pick this one:
 *
 *  - a group header is a **row-height item** in the lane (what the prototype does: `.group-bar` is
 *    `var(--row-h)` tall, and its item list is `[group, ...rows]`), so the existing windowing arithmetic
 *    applies to groups and rows alike; or
 *  - a header is an overlay pinned above its group, which needs a second mapping between scroll offset and
 *    item index and therefore a second place for the arithmetic to be wrong.
 *
 * When the view does not group, `result.groups` is empty and the lane is exactly `result.rows` — the
 * no-grouping path stays the one step 16 tested.
 */
export function selectLaneItems(snapshot: GridSnapshot): readonly LaneItem[] {
	return derive(snapshot).laneItems;
}

/** The slice of the lane a window mounts. Same shape as `windowSlice`, but for items. */
export function selectLaneSlice(snapshot: GridSnapshot, window: RowWindow): readonly LaneItem[] {
	return windowSlice(selectLaneItems(snapshot), window);
}

function buildLaneItems(snapshot: GridSnapshot): readonly LaneItem[] {
	const items: LaneItem[] = [];
	const rowIndex = new Map<RowId, number>();
	for (const [index, filePath] of snapshot.rows.entries()) {
		rowIndex.set(filePath, index);
	}
	let at = 0;
	const pushRow = (filePath: RowId): void => {
		items.push({ kind: 'row', filePath, rowIndex: rowIndex.get(filePath) ?? 0, index: at });
		at += 1;
	};
	if (snapshot.result.groups.length === 0) {
		for (const filePath of snapshot.rows) {
			pushRow(filePath);
		}
		return items;
	}
	for (const group of snapshot.result.groups) {
		items.push({
			kind: 'group',
			key: group.key,
			label: group.label,
			count: group.rows.length,
			collapsed: group.collapsed,
			index: at,
		});
		at += 1;
		// A collapsed group contributes its header and nothing else, which is why the pipeline leaves its
		// rows out of `result.rows` too. The two must agree or the lane would draw rows the query hid.
		for (const row of group.rows) {
			pushRow(row.filePath);
		}
	}
	return items;
}

/** The status bar's numbers. */
export function selectStatusSummary(snapshot: GridSnapshot): StatusSummary {
	const size = selectSelectionSize(snapshot);
	return {
		totalRows: snapshot.result.totalRows,
		matchedRows: snapshot.result.matchedRows,
		visibleRows: snapshot.rows.length,
		columns: snapshot.order.fields.length,
		selectedRows: size.rows,
		selectedFields: size.fields,
		selectedCells: size.cells,
		pending: snapshot.pending,
		busy: snapshot.busy,
		canUndo: snapshot.canUndo,
		canRedo: snapshot.canRedo,
	};
}

/* ── React ─────────────────────────────────────────────────────────────────── */

/**
 * The narrow-subscription hook, by hand.
 *
 * `useSyncExternalStore` compares the value `getSnapshot` returns with `Object.is` and re-renders when it
 * differs, so a read function that built a fresh object per call would re-render forever. This wrapper keeps
 * the last value and hands the *same reference* back while `isEqual` says nothing changed. The cache lives in
 * a ref that is written while reading; that is safe because it only stores the value it just compared — no
 * render output depends on it, and a discarded render cannot leave anything stale behind.
 */
function useNarrow<T>(
	subscribe: (listener: () => void) => () => void,
	read: () => T,
	isEqual: (previous: T, next: T) => boolean,
): T {
	const last = useRef<{ value: T } | null>(null);
	const get = useCallback((): T => {
		const next = read();
		const previous = last.current;
		if (previous !== null && isEqual(previous.value, next)) {
			return previous.value;
		}
		last.current = { value: next };
		return next;
	}, [read, isEqual]);
	return useSyncExternalStore(subscribe, get, get);
}

/** A whole-snapshot read for the surfaces that are allowed one: the toolbar, the status bar, the empty state. */
export function useStoreSelector<T>(
	store: GridStore,
	selector: (snapshot: GridSnapshot) => T,
	isEqual: (previous: T, next: T) => boolean = Object.is,
): T {
	const read = useCallback(() => selector(store.getSnapshot()), [store, selector]);
	// Wrapped rather than passed as `store.subscribe`: a bare method reference is detached from the object it
	// belongs to, and nothing here should ever be at the mercy of `this`.
	const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
	return useNarrow(subscribe, read, isEqual);
}

/** The same, named for the common case. */
export function useStore<T>(store: GridStore, selector: (snapshot: GridSnapshot) => T): T {
	return useStoreSelector(store, selector);
}

/** One cell's channel, as a subscribe function with a stable identity. */
function useCellChannel(store: GridStore, ref: CellRef): (listener: () => void) => () => void {
	return useCallback(
		(listener: () => void) => store.subscribeCell(ref.filePath, ref.fieldId, listener),
		[store, ref.filePath, ref.fieldId],
	);
}

/** A cell's value. A `CellValue` is a primitive or an array the table already owns, so `Object.is` is right. */
export function useCellValue(store: GridStore, ref: CellRef): CellValue {
	const subscribe = useCellChannel(store, ref);
	const read = useCallback(
		() => cellAt(store.state(), ref.filePath, ref.fieldId),
		[store, ref.filePath, ref.fieldId],
	);
	return useNarrow(subscribe, read, Object.is);
}

/**
 * A cell's display text. The string, not an object: two equal strings are the same string to React, which is
 * exactly the "a keystroke re-renders one cell" rule — every other cell's subscription fires, finds its text
 * unchanged, and renders nothing.
 */
export function useCellDisplay(store: GridStore, ref: CellRef): string {
	const subscribe = useCellChannel(store, ref);
	const read = useCallback(
		() => selectCellDisplay(store.state(), ref),
		[store, ref.fieldId, ref.filePath],
	);
	return useNarrow(subscribe, read, Object.is);
}

/** The flags a cell draws with, compared field by field so a re-render only happens when one changed. */
export type CellFlags = {
	readonly pending: boolean;
	readonly readOnly: boolean;
	readonly inRange: boolean;
	readonly active: boolean;
	readonly number: boolean;
};

const sameCellFlags = (previous: CellFlags, next: CellFlags): boolean =>
	previous.pending === next.pending &&
	previous.readOnly === next.readOnly &&
	previous.inRange === next.inRange &&
	previous.active === next.active &&
	previous.number === next.number;

/**
 * The value channel and the selection channel, merged. A value change and a range change are different
 * events: the first touches one cell, the second genuinely touches every mounted cell, and neither should
 * make the other re-render.
 */
export function useCellFlags(store: GridStore, ref: CellRef): CellFlags {
	const subscribeValue = useCellChannel(store, ref);
	const subscribeSelection = useCallback(
		(listener: () => void) => store.subscribeSelection(listener),
		[store],
	);
	const subscribe = useCallback(
		(listener: () => void) => {
			const offValue = subscribeValue(listener);
			const offSelection = subscribeSelection(listener);
			return () => {
				offValue();
				offSelection();
			};
		},
		[subscribeValue, subscribeSelection],
	);
	const read = useCallback((): CellFlags => {
		const state = store.state();
		const snapshot = store.getSnapshot();
		const cell = selectCell(state, ref);
		const field = selectField(state, ref.fieldId);
		return {
			pending: cell.pending,
			readOnly: cell.readOnly,
			inRange: selectIsInRange(snapshot, ref),
			active: selectIsActive(snapshot, ref),
			number: field !== undefined && field.definition.id !== '' && isNumericType(field),
		};
	}, [store, ref.fieldId, ref.filePath]);
	return useNarrow(subscribe, read, sameCellFlags);
}

/** Whether a column's values are drawn as figures: a table column of numbers reads as data, not as prose. */
function isNumericType(field: ResolvedField): boolean {
	switch (field.descriptor.id) {
		case 'number':
		case 'currency':
		case 'percent':
		case 'duration':
		case 'rating':
			return true;
		default:
			return false;
	}
}

/** A row's state: writing, inside the range, and whether it holds the active cell. */
export type RowFlags = {
	readonly dirty: boolean;
	readonly checked: boolean;
	readonly active: boolean;
};

const sameRowFlags = (previous: RowFlags, next: RowFlags): boolean =>
	previous.dirty === next.dirty &&
	previous.checked === next.checked &&
	previous.active === next.active;

export function useRowFlags(store: GridStore, filePath: RowId): RowFlags {
	const subscribe = useCallback(
		(listener: () => void) => {
			const offRow = store.subscribeRow(filePath, listener);
			const offSelection = store.subscribeSelection(listener);
			return () => {
				offRow();
				offSelection();
			};
		},
		[store, filePath],
	);
	const read = useCallback((): RowFlags => {
		const state = store.state();
		const snapshot = store.getSnapshot();
		return {
			dirty: state.overlay.hasRow(filePath),
			checked: selectRowChecked(snapshot, filePath),
			active: snapshot.active !== null && snapshot.active.filePath === filePath,
		};
	}, [store, filePath]);
	return useNarrow(subscribe, read, sameRowFlags);
}

/**
 * Whether this cell is the one being edited. Subscribed to the cell's own channel — `setEditing` notifies the
 * two cells whose appearance changes and nothing else — so moving the editing cursor does not wake the grid.
 */
export function useEditing(store: GridStore, ref: CellRef): boolean {
	const subscribe = useCellChannel(store, ref);
	const read = useCallback((): boolean => {
		const editing = store.getSnapshot().editing;
		return (
			editing !== null && editing.filePath === ref.filePath && editing.fieldId === ref.fieldId
		);
	}, [store, ref.filePath, ref.fieldId]);
	return useNarrow(subscribe, read, Object.is);
}

/** The selection's version. A number, so a surface that only cares *that* the range moved re-renders once. */
export function useSelectionRevision(store: GridStore): number {
	const subscribe = useCallback(
		(listener: () => void) => store.subscribeSelection(listener),
		[store],
	);
	const read = useCallback(() => store.selectionRevision(), [store]);
	return useNarrow(subscribe, read, Object.is);
}

/** The selection's version and its bounds, for a surface that draws the active cell. */
export function useSelectionSnapshot(store: GridStore): {
	readonly revision: number;
	readonly selection: Range | null;
	readonly bounds: Bounds | null;
} {
	const revision = useSelectionRevision(store);
	const selection = useStoreSelector(store, (snapshot) => snapshot.selection);
	const order: RangeOrder = store.getSnapshot().order;
	return { revision, selection, bounds: selection === null ? null : normalize(selection, order) };
}
