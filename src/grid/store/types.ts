/**
 * The store's shape: what one open view holds, and what a component is allowed to see of it.
 *
 * Two rules decide everything in this file.
 *
 *  1. **The snapshot is replaced only when something changed.** `useSyncExternalStore` compares snapshots
 *     with `Object.is` and re-renders when they differ, so a `getSnapshot()` that built a fresh object per
 *     call would re-render forever. The store keeps one snapshot per revision, and every selector reads its
 *     fields off that object.
 *  2. **A component never sees the whole state.** `GridSnapshot` carries the row order, the columns, the
 *     range and the write state; the *table* (every value in every row) stays behind `state()`, which only
 *     selectors and commands call. That is what keeps a keystroke from walking 5,000 rows.
 */
import type { Overlay } from '../../adapters/optimistic';
import type { ApplyResult, RowSource } from '../../adapters/RowSource';
import type { CellRef, Op, RowId, Skipped, TableState } from '../../core/ops/types';
import type { History } from '../../core/ops/history';
// `Range` shadows the DOM's own `Range` inside this module; the grid's range is what every name here means.
import type { Range, RangeOrder } from '../../core/selection/range';
import type { CellValue, PropertyId } from '../../core/types';
import type { ViewConfig, ViewResult } from '../../core/view/pipeline';
import type { ResolvedField } from '../../core/schema/propertySchema';

/** One user action: what it did (for the undo menu) and the ops it produced. Befores are captured inside. */
export type GridAction = {
	readonly label: string;
	readonly ops: readonly Op[];
};

/** What a component may read. Immutable, and a new object only when the store changed. */
export type GridSnapshot = {
	/** Bumped once per change; the identity of everything else in here is tied to it. */
	readonly revision: number;
	/** Row ids in view order. The window selector slices this. */
	readonly rows: readonly RowId[];
	/** The columns, resolved. Includes the descriptor a cell needs to render itself. */
	readonly fields: readonly ResolvedField[];
	/**
	 * Render width per column id, already resolved through `columnWidthOf` (stored → clamped →
	 * default). It is on the snapshot rather than read from `table.fields` per cell because a cell
	 * must not walk the column list 1,200 times per frame, and because a width is exactly as
	 * expensive to invalidate as everything else here: one revision.
	 */
	readonly widths: ReadonlyMap<PropertyId, number>;
	/** The pipeline's answer: order, groups, hidden columns, totals. */
	readonly result: ViewResult;
	/** The two axes a range is expressed against, in render order. */
	readonly order: RangeOrder;
	/** The current range, or `null` for "no selection". */
	readonly selection: Range | null;
	/** The active cell: the range's focus. `null` when nothing is selected. */
	readonly active: CellRef | null;
	/** The anchor the range started at. `null` when nothing is selected. */
	readonly anchor: CellRef | null;
	/** The cell being edited, if any. */
	readonly editing: CellRef | null;
	/** How many cells have an optimistic value that has not been confirmed on disk yet. */
	readonly pending: number;
	/** True while a batch write is in flight. */
	readonly busy: boolean;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
	/** The wording `undo` would use, for the menu item. `null` when there is nothing to undo. */
	readonly undoLabel: string | null;
	/** The last apply's report, or `null` before the first write. */
	readonly lastApply: ApplyResult | null;
	/** Why the last apply could not even be attempted. The store never throws; it records. */
	readonly lastError: string | null;
	/** Ops the last action had to leave alone (a stale surface, a missing column), with the reasons. */
	readonly skipped: readonly Skipped[];
};

/** Everything the store holds. Selectors and commands read it; components do not. */
export type GridState = {
	readonly source: RowSource;
	/** The core's own state: the columns, every row's values, and the view options. */
	readonly table: TableState;
	/** The columns, resolved: the descriptor a value has to be formatted and parsed with. */
	readonly fields: readonly ResolvedField[];
	/** The view options currently in force. */
	readonly view: ViewConfig;
	readonly result: ViewResult;
	readonly selection: Range | null;
	readonly history: History;
	readonly overlay: Overlay;
};

/** A cell, as a component reads it. Every field is a primitive or a stored reference, never a fresh object. */
export type CellSnapshot = {
	/** The canonical value with the optimistic overlay applied. */
	readonly value: CellValue;
	/** True when the value on screen is optimistic and not yet on disk. */
	readonly pending: boolean;
	/** True when the column refuses writes. */
	readonly readOnly: boolean;
};

/** What the status bar shows. Counts, never a list. */
export type StatusSummary = {
	readonly totalRows: number;
	readonly matchedRows: number;
	readonly visibleRows: number;
	readonly columns: number;
	readonly selectedRows: number;
	readonly selectedFields: number;
	readonly selectedCells: number;
	readonly pending: number;
	readonly busy: boolean;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
};

/** One group header the renderer draws, positioned by flat row index. */
export type GroupSpan = {
	readonly key: string;
	readonly label: string;
	readonly count: number;
	readonly collapsed: boolean;
	/** Index of the group's first row in the flat, visible order. */
	readonly start: number;
	/** One past its last row. Empty for a collapsed group. */
	readonly end: number;
};

/** The grid store. One per open view; `dispose()` releases everything it subscribed to. */
export type GridStore = {
	/** Stable between changes: the same object until the store actually changed. */
	getSnapshot(): GridSnapshot;
	/** For selectors and commands. Not for components: it holds every value in the view. */
	state(): GridState;

	/** The whole-state channel. Toolbars and the status bar use it through a narrow selector. */
	subscribe(listener: () => void): () => void;
	/** One cell's channel: notified when that cell's value or pending state changed. */
	subscribeCell(filePath: RowId, propertyId: PropertyId, listener: () => void): () => void;
	/** One row's channel: notified when anything in that row changed. */
	subscribeRow(filePath: RowId, listener: () => void): () => void;
	/** Selection changes have their own channel, so a box-select never re-renders a value cell twice. */
	subscribeSelection(listener: () => void): () => void;
	/** Bumped on every selection change. The snapshot a selection-hook compares. */
	selectionRevision(): number;

	/** One user action: ops applied, one undo step, one queue batch. */
	dispatch(action: GridAction): void;
	/** Undo through the same path, so an undo of a 400-cell paste is one batch too. */
	undo(): void;
	redo(): void;
	/** Re-reads the source: the external-change path. Rows, values and order are replaced wholesale. */
	refresh(): void;
	/** Applies nothing; waits for the queue and the overlay to settle. */
	flush(): Promise<void>;
	/** Sets the range, or clears it. The keyboard, the pointer and the toolbar all come through here. */
	select(range: Range | null): void;
	/** Marks the cell being edited. `null` ends the edit. */
	setEditing(ref: CellRef | null): void;
	dispose(): void;
};
