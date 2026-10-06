/**
 * The store: the only place in the grid that mutates state.
 *
 * One instance per open view. It is framework-free — no React import, no DOM, no `obsidian` — so the whole
 * of the grid's behaviour can be driven from a test that supplies a `RowSource`. The hooks in
 * `selectors.ts` are the only React-aware code on this side of the grid.
 *
 * ## What one user action does
 *
 * `dispatch({ label, ops })` is the single entry point, and it always does the same things in the same order:
 *
 *   1. **captures the before-image** of every op against the current table (`core/ops/apply`),
 *   2. **applies the ops** through the real reducer, and records them as *one* history step — so a 400-cell
 *      paste is one undo, and an undo is one step back, not 400,
 *   3. **recomputes the pipeline view** if the op could have changed the row set, the columns or the view
 *      options; a cell edit does not, which is what keeps a keystroke out of the O(rows × columns) path,
 *   4. **puts the new values in the optimistic overlay**, so a cell shows the typed value before the file has
 *      been written, and
 *   5. **calls `source.apply(ops)` in the same tick's microtask** — one action, one queue batch.
 *
 * ## The four change channels
 *
 * A keystroke must re-render one cell, not the grid (`docs/02` §Store: "a keystroke may re-render the edited
 * cell and, at most, the row. Never the grid"). The store therefore keeps four listener sets and notifies
 * exactly the ones an action touched:
 *
 *   · `cellListeners`      keyed by `row\u0000column`: the edited cell, and only it
 *   · `rowListeners`       keyed by row: a row that is showing "writing" state
 *   · `selectionListeners` a box-select genuinely changes every mounted cell; nothing else does
 *   · `globalListeners`    the toolbar, the status bar, the empty state
 *
 * ## `getSnapshot` identity
 *
 * The snapshot object is built once per change and handed out unchanged until the next one. This is not an
 * optimisation: `useSyncExternalStore` calls `getSnapshot` on every notification and re-renders when the
 * result is not `Object.is`-equal to the previous one, so a store that built an object per call would
 * re-render forever. The snapshot's `revision` is the identity of the state it describes.
 */
import { applyOps, captureBefore, cellOf } from '../../core/ops/apply';
import { createHistory } from '../../core/ops/history';
import { buildView } from '../../core/view/pipeline';
import type { ViewConfig, ViewResult } from '../../core/view/pipeline';
import { clampTo } from '../../core/selection/range';
import type { Range, RangeOrder } from '../../core/selection/range';
import { columnWidthOf, DEFAULT_COLUMN_WIDTH } from '../layout';
import type {
	CellRef,
	FieldState,
	Op,
	RowId,
	RowState,
	Skipped,
	TableState,
} from '../../core/ops/types';
import type { CellValue, PropertyId } from '../../core/types';
import type { ResolvedField } from '../../core/schema/propertySchema';
import type { Expr } from '../../core/query/ast';
import { createOverlay } from '../../adapters/optimistic';
import type { Overlay } from '../../adapters/optimistic';
import type { ApplyResult, RowSource } from '../../adapters/RowSource';
import type { QueueWrite } from '../../adapters/writeQueue';
import type { GridAction, GridSnapshot, GridState, GridStore } from './types';

/** The pipeline's answer for a view that has not been built yet. Shared: it is never mutated. */
const EMPTY_VIEW: ViewResult = {
	rows: [],
	groups: [],
	hiddenFieldIds: [],
	columnOrder: [],
	totalRows: 0,
	matchedRows: 0,
};

export type GridStoreOptions = {
	readonly source: RowSource;
	/** The initial view options. Defaults to "no search, no sort, no grouping, every column visible". */
	readonly view?: ViewConfig;
	/** The parsed query. `null` means "no filter". */
	readonly queryAst?: Expr | null;
	/** Injecting the overlay makes the store testable without a real vault. */
	readonly overlay?: Overlay;
	/** How many undo steps to keep. `docs/01` names 60; `createHistory`'s default is the same number. */
	readonly historyDepth?: number;
};

export function createGridStore(options: GridStoreOptions): GridStore {
	const source = options.source;
	const overlay = options.overlay ?? createOverlay();
	const history = createHistory({ depth: options.historyDepth });
	const queryAst = options.queryAst ?? null;

	let view: ViewConfig = options.view ?? {};
	let fields: readonly ResolvedField[] = [];
	let table: TableState = { fields: [], rows: [], view };
	let result: ViewResult = EMPTY_VIEW;
	let selection: Range | null = null;
	let editing: CellRef | null = null;
	let busy = false;
	let revision = 0;
	let selectionVersion = 0;
	let lastApply: ApplyResult | null = null;
	let lastError: string | null = null;
	let skipped: readonly Skipped[] = [];
	let disposed = false;

	const cellListeners = new Map<string, Set<() => void>>();
	const rowListeners = new Map<RowId, Set<() => void>>();
	const selectionListeners = new Set<() => void>();
	const globalListeners = new Set<() => void>();
	let sourceSubscription: (() => void) | null = null;
	/**
	 * The bulk window: how deep the nesting is, and whether anything asked to be announced while it was open.
	 * `src/grid/store/types.ts` (on `beginBulk`) carries the reasoning and the measurements for why this exists.
	 */
	let bulkDepth = 0;
	let bulkSuspended = false;

	let snapshot: GridSnapshot = {
		revision,
		rows: [],
		fields,
		widths: widthsOf(table.fields),
		result,
		order: { rows: [], fields: [] },
		selection,
		active: null,
		anchor: null,
		editing,
		pending: overlay.size(),
		busy,
		canUndo: false,
		canRedo: false,
		undoLabel: null,
		lastApply,
		lastError,
		skipped,
	};

	/* ── notifications ─────────────────────────────────────────────────────── */

	/**
	 * Every notification in this store funnels through here — `bump()`, a cell's channel, a row's channel, a
	 * selection change and the whole-table sweep all end up in this one loop. That is what makes the bulk window
	 * (`beginBulk`/`endBulk`) a single check rather than six: while one is open, notifications are **dropped and
	 * remembered**, and `endBulk` performs one `refresh()` for all of them.
	 */
	function notify(listeners: Iterable<() => void>): void {
		if (bulkDepth > 0) {
			bulkSuspended = true;
			return;
		}
		// Copy first: a listener that subscribes or unsubscribes while being notified must not corrupt the walk.
		for (const listener of [...listeners]) {
			listener();
		}
	}

	const cellKey = (filePath: RowId, propertyId: PropertyId): string =>
		`${filePath}\u0000${propertyId}`;

	function notifyCell(filePath: RowId, propertyId: PropertyId): void {
		const listeners = cellListeners.get(cellKey(filePath, propertyId));
		if (listeners !== undefined) {
			notify(listeners);
		}
	}

	function notifyRow(filePath: RowId): void {
		const listeners = rowListeners.get(filePath);
		if (listeners !== undefined) {
			notify(listeners);
		}
	}

	/**
	 * Wakes every narrow listener at once. Used only where the change is genuinely unbounded: a structural op
	 * re-queries the view, and an external change (another pane, another plugin, a sync client) can rewrite any
	 * value in the table. Diffing the whole table to find out which cells really moved costs more than waking the
	 * components that are mounted — and only those are subscribed, so the cost is bounded by the window, not the
	 * table. Their equality checks decide who re-renders, so this is a wake-up, not a redraw.
	 *
	 * A keystroke never comes through here: that is what makes `docs/07` §Tier 3 rule 1 true.
	 */
	function notifyEveryNarrowChannel(): void {
		for (const listeners of cellListeners.values()) {
			notify(listeners);
		}
		for (const listeners of rowListeners.values()) {
			notify(listeners);
		}
		notify(selectionListeners);
	}

	/* ── state ─────────────────────────────────────────────────────────────── */

	function orderOf(): RangeOrder {
		return { rows: result.rows.map((row) => row.filePath), fields: result.columnOrder };
	}

	function buildSnapshot(): GridSnapshot {
		const rows = result.rows.map((row) => row.filePath);
		return {
			revision,
			rows,
			fields,
			widths: widthsOf(table.fields),
			result,
			order: { rows, fields: result.columnOrder },
			selection,
			active: selection === null ? null : selection.focus,
			anchor: selection === null ? null : selection.anchor,
			editing,
			pending: overlay.size(),
			busy,
			canUndo: history.canUndo(),
			canRedo: history.canRedo(),
			undoLabel: history.undoLabel(),
			lastApply,
			lastError,
			skipped,
		};
	}

	/**
	 * One change: a new revision, a new snapshot object, and the toolbar told about it.
	 *
	 * **Ordering contract.** Every notification happens *after* the state it describes is in place — the new
	 * table, the rebuilt snapshot, the overlay entry. A listener is allowed to read the store synchronously
	 * (React does exactly that: the store's change handler asks for the new value before deciding whether to
	 * re-render), so notifying first hands it the old world and the change is lost. A step's tests caught this;
	 * the rule is that `bump()` comes before `notifyTouched`.
	 */
	function bump(): void {
		revision += 1;
		snapshot = buildSnapshot();
		notify(globalListeners);
	}

	/**
	 * Column id → render width. `FieldState.width` is `null` until the user drags a column edge, so the
	 * fallback is the grid's own default and the clamp is `columnWidthOf`'s (min 64, max 900): a stored
	 * width that a `.base` sidecar carried from another plugin must not be able to make a column
	 * unusably narrow or 4,000 px wide.
	 */
	function widthsOf(states: readonly FieldState[]): ReadonlyMap<PropertyId, number> {
		const widths = new Map<PropertyId, number>();
		for (const state of states) {
			widths.set(state.id, columnWidthOf(state.width, DEFAULT_COLUMN_WIDTH));
		}
		return widths;
	}

	/** Values as the source has them right now. */
	function readRows(resolved: readonly ResolvedField[]): readonly RowState[] {
		const rows: RowState[] = [];
		for (const filePath of source.getRows()) {
			const cells: Record<PropertyId, CellValue> = {};
			for (const field of resolved) {
				cells[field.definition.id] = source.getValue(filePath, field.definition.id);
			}
			rows.push({ filePath, cells });
		}
		return rows;
	}

	/**
	 * Column state from the source's schema, carrying widths across. A re-query must not undo a resize: the
	 * width lives in the view's own state (`ResizeColumnOp`), and a column that snapped back the first time a
	 * file changed would be the kind of bug that gets blamed on the editor.
	 */
	function fieldStates(
		resolved: readonly ResolvedField[],
		previous: readonly FieldState[],
	): readonly FieldState[] {
		const widths = new Map<PropertyId, number | null>();
		for (const field of previous) {
			widths.set(field.id, field.width);
		}
		return resolved.map((field) => ({
			id: field.definition.id,
			name: field.definition.name,
			options: field.options,
			width: widths.get(field.definition.id) ?? null,
		}));
	}

	/**
	 * The view options live in **two places that must not drift**: the module's `view` binding, which the
	 * initial `options.view` seeds, and `TableState.view`, which `applyOps` owns because `setViewConfig` is an
	 * op like any other. Reading the binding here without re-adopting the table's copy meant a search typed in
	 * the toolbar updated the table and left the *result* untouched — the filter was stored and never applied.
	 * So the table's copy is authoritative, and it is adopted on every rebuild.
	 */
	function rebuildView(): void {
		view = table.view;
		result = buildView({ fields, rows: table.rows, view, queryAst });
	}

	function rowAt(filePath: RowId): RowState | undefined {
		return table.rows.find((row) => row.filePath === filePath);
	}

	/* ── optimistic overlay ────────────────────────────────────────────────── */

	/** The writes an op list implies. Ops that change no value produce none. */
	function writesFor(ops: readonly Op[]): readonly QueueWrite[] {
		const writes: QueueWrite[] = [];
		for (const op of ops) {
			switch (op.kind) {
				case 'setCell':
					writes.push({ filePath: op.filePath, propertyId: op.fieldId, value: op.value });
					break;
				case 'setCells':
					for (const write of op.writes) {
						writes.push({
							filePath: write.filePath,
							propertyId: write.fieldId,
							value: write.value,
						});
					}
					break;
				case 'clearCells':
					for (const cell of op.cells) {
						writes.push({
							filePath: cell.filePath,
							propertyId: cell.fieldId,
							value: null,
						});
					}
					break;
				case 'addRow':
					for (const [propertyId, value] of Object.entries(op.row.cells)) {
						writes.push({ filePath: op.row.filePath, propertyId, value });
					}
					break;
				case 'importBlock':
					for (const placed of op.rows) {
						for (const [propertyId, value] of Object.entries(placed.row.cells)) {
							writes.push({ filePath: placed.row.filePath, propertyId, value });
						}
					}
					break;
				default:
					break;
			}
		}
		return writes;
	}

	/**
	 * The cells and rows an op list touched, for the narrow channels.
	 *
	 * A value write names its row as well as its cell: the row's own flags include whether it is waiting on a
	 * write (`useRowFlags().dirty`), which a keystroke changes. The row channel is a hint, not a redraw — the
	 * row's hook compares its three flags and re-renders only when one of them moved.
	 */
	function touchedBy(ops: readonly Op[]): {
		readonly cells: readonly { readonly filePath: RowId; readonly fieldId: PropertyId }[];
		readonly rows: readonly RowId[];
	} {
		const cells: { filePath: RowId; fieldId: PropertyId }[] = [];
		const rows: RowId[] = [];
		for (const op of ops) {
			switch (op.kind) {
				case 'setCell':
					cells.push({ filePath: op.filePath, fieldId: op.fieldId });
					rows.push(op.filePath);
					break;
				case 'setCells':
					for (const write of op.writes) {
						cells.push({ filePath: write.filePath, fieldId: write.fieldId });
						rows.push(write.filePath);
					}
					break;
				case 'clearCells':
					for (const cell of op.cells) {
						cells.push({ filePath: cell.filePath, fieldId: cell.fieldId });
						rows.push(cell.filePath);
					}
					break;
				case 'addRow':
					rows.push(op.row.filePath);
					break;
				case 'deleteRows':
					for (const placed of op.rows) {
						rows.push(placed.row.filePath);
					}
					break;
				case 'moveRow':
					rows.push(op.filePath);
					break;
				case 'moveRows':
					rows.push(...op.filePaths);
					break;
				case 'importBlock':
					for (const placed of op.rows) {
						rows.push(placed.row.filePath);
					}
					break;
				default:
					break;
			}
		}
		return { cells, rows };
	}

	function notifyTouched(ops: readonly Op[]): void {
		const touched = touchedBy(ops);
		for (const cell of touched.cells) {
			notifyCell(cell.filePath, cell.fieldId);
		}
		// Once per row, however many of its cells moved: a paste crosses one row many times, and the row's own
		// hook has exactly one value to compare.
		for (const filePath of new Set(touched.rows)) {
			notifyRow(filePath);
		}
	}

	/** Drops pending values for rows that no longer exist, so a deleted row cannot leave a phantom behind. */
	function dropPendingFor(gone: readonly RowId[]): void {
		if (gone.length === 0) {
			return;
		}
		const wanted = new Set(gone);
		const writes: QueueWrite[] = [];
		for (const entry of overlay.entries()) {
			if (wanted.has(entry.filePath)) {
				writes.push({
					filePath: entry.filePath,
					propertyId: entry.propertyId,
					value: entry.value,
				});
			}
		}
		if (writes.length > 0) {
			overlay.drop(writes);
		}
	}

	/**
	 * A write is not always confirmed by the queue's callback: Bases re-reads the file as soon as it changes,
	 * which can reach us *before* `apply` resolves. When the file already holds the pending value the overlay
	 * has nothing left to cover, so it is settled here — otherwise a cell would keep its "not yet written" dot
	 * until the next unrelated edit.
	 */
	function settleConfirmed(): void {
		const confirmed: QueueWrite[] = [];
		for (const entry of overlay.entries()) {
			const row = rowAt(entry.filePath);
			if (row !== undefined && cellOf(row, entry.propertyId) === entry.value) {
				confirmed.push({
					filePath: entry.filePath,
					propertyId: entry.propertyId,
					value: entry.value,
				});
			}
		}
		if (confirmed.length > 0) {
			overlay.settle(confirmed);
		}
	}

	/* ── the write path ────────────────────────────────────────────────────── */

	async function applyNow(ops: readonly Op[]): Promise<void> {
		const writes = writesFor(ops);
		busy = true;
		bump();
		try {
			const report = await source.apply(ops);
			lastApply = report;
			lastError = null;
			// Per file: what landed is settled, what was refused or failed is dropped, so the grid shows the
			// file's real content again instead of a value that never existed.
			const failed = new Set<RowId>();
			for (const error of report.errors) {
				failed.add(error.path);
			}
			for (const refusal of report.refused) {
				failed.add(refusal.filePath);
			}
			const settled: QueueWrite[] = [];
			const dropped: QueueWrite[] = [];
			for (const write of writes) {
				(failed.has(write.filePath) ? dropped : settled).push(write);
			}
			if (settled.length > 0) {
				overlay.settle(settled);
			}
			if (dropped.length > 0) {
				overlay.drop(dropped);
			}
		} catch (error) {
			// A source that throws is a bug in the source, and the grid must survive it: the optimistic values
			// go away and the reason is recorded (docs/02 §Error handling: never a silent catch).
			if (writes.length > 0) {
				overlay.drop(writes);
			}
			lastError = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
			// The write is settled: the row's pending dot goes out and the cell shows the source's own value.
			bump();
			notifyTouched(ops);
		}
	}

	/** True when an op can change which rows are in the view, their order, or the columns themselves. */
	function requeries(op: Op): boolean {
		switch (op.kind) {
			case 'setCell':
			case 'setCells':
			case 'clearCells':
			case 'resizeColumn':
			case 'setFieldOptions':
				return false;
			default:
				return true;
		}
	}

	/**
	 * A row-level action takes the selection with it: deleting the selected rows must leave the range on the
	 * nearest *surviving* row, not pointing at a row that is gone (`docs/07` §Tier 3).
	 */
	function selectionAfter(before: TableState, ops: readonly Op[]): Range | null {
		if (selection === null || !ops.some(requeries)) {
			return selection;
		}
		const previousOrder: RangeOrder = {
			rows: before.rows.map((row) => row.filePath),
			fields: before.fields.map((field) => field.id),
		};
		const nextOrder: RangeOrder = {
			rows: table.rows.map((row) => row.filePath),
			fields: table.fields.map((field) => field.id),
		};
		return clampTo(selection, previousOrder, nextOrder);
	}

	/**
	 * The body of one action, shared by `dispatch` and by `undo`/`redo`. `record` tells them apart: an undo
	 * hands the history its own step back, so it must not push a new one.
	 */
	function run(action: GridAction, record: boolean): void {
		if (action.ops.length === 0) {
			return;
		}
		const before = table;
		if (record) {
			const befores = action.ops.map((op) => captureBefore(op, before));
			history.push({ label: action.label, ops: action.ops, befores });
		}

		const applied = applyOps(before, action.ops);
		table = applied.state;
		skipped = applied.skipped;

		// An op that could not run must not be queued: a stale surface would otherwise write a value it failed
		// to apply. `applied.skipped` names the ops by reference, so filtering on that is exact.
		const ran = action.ops.filter((op) => !applied.skipped.some((entry) => entry.op === op));

		if (ran.some(requeries)) {
			rebuildView();
		}
		for (const op of ran) {
			if (op.kind === 'deleteRows') {
				dropPendingFor(op.rows.map((placed) => placed.row.filePath));
			}
		}

		const writes = writesFor(ran);
		if (writes.length > 0) {
			overlay.set(writes);
		}
		selection = selectionAfter(before, ran);
		bump();
		notifyTouched(ran);
		if (writes.length > 0) {
			queueMicrotask(() => {
				void applyNow(ran);
			});
		}
	}

	/* ── the external-change path ──────────────────────────────────────────── */

	function refresh(): void {
		const previousOrder = orderOf();
		const schema = source.getSchema();
		fields = schema.fields;
		table = {
			fields: fieldStates(fields, table.fields),
			rows: readRows(fields),
			view: table.view,
		};
		rebuildView();
		settleConfirmed();
		const alive = new Set(table.rows.map((row) => row.filePath));
		const gone: RowId[] = [];
		for (const entry of overlay.entries()) {
			if (!alive.has(entry.filePath)) {
				gone.push(entry.filePath);
			}
		}
		dropPendingFor(gone);
		const nextOrder = orderOf();
		if (selection !== null) {
			selection = clampTo(selection, previousOrder, nextOrder);
		}
		if (editing !== null && !nextOrder.rows.includes(editing.filePath)) {
			editing = null;
		}
		bump();
		notifyEveryNarrowChannel();
	}

	/* ── the surface ───────────────────────────────────────────────────────── */

	refresh();
	sourceSubscription = source.subscribe(() => {
		if (!disposed) {
			refresh();
		}
	});

	return {
		getSnapshot(): GridSnapshot {
			return snapshot;
		},

		state(): GridState {
			return { source, table, fields, result, selection, history, overlay, view };
		},

		beginBulk(): void {
			bulkDepth += 1;
		},

		endBulk(): void {
			if (bulkDepth === 0) {
				// No window is open: nothing was deferred, so there is nothing to announce. Not an error — a
				// caller that ends a window it never began is a bug in that caller, and a throw here would turn
				// it into a crash during an import, which is the worst place to find out.
				return;
			}
			bulkDepth -= 1;
			if (bulkDepth > 0 || !bulkSuspended) {
				return;
			}
			bulkSuspended = false;
			if (disposed) {
				return;
			}
			// One re-read, one `bump()`, one sweep of every narrow channel — and therefore one React commit for
			// however many rows arrived while the window was open.
			refresh();
		},

		subscribe(listener: () => void): () => void {
			globalListeners.add(listener);
			return () => {
				globalListeners.delete(listener);
			};
		},

		subscribeCell(filePath: RowId, propertyId: PropertyId, listener: () => void): () => void {
			const key = cellKey(filePath, propertyId);
			const listeners = cellListeners.get(key) ?? new Set<() => void>();
			listeners.add(listener);
			cellListeners.set(key, listeners);
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) {
					cellListeners.delete(key);
				}
			};
		},

		subscribeRow(filePath: RowId, listener: () => void): () => void {
			const listeners = rowListeners.get(filePath) ?? new Set<() => void>();
			listeners.add(listener);
			rowListeners.set(filePath, listeners);
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) {
					rowListeners.delete(filePath);
				}
			};
		},

		subscribeSelection(listener: () => void): () => void {
			selectionListeners.add(listener);
			return () => {
				selectionListeners.delete(listener);
			};
		},

		selectionRevision(): number {
			return selectionVersion;
		},

		dispatch(action: GridAction): void {
			run(action, true);
		},

		undo(): void {
			const step = history.undo();
			if (!step.ok) {
				lastError = step.reason;
				bump();
				return;
			}
			run({ label: step.label, ops: step.ops }, false);
		},

		redo(): void {
			const step = history.redo();
			if (!step.ok) {
				lastError = step.reason;
				bump();
				return;
			}
			run({ label: step.label, ops: step.ops }, false);
		},

		refresh,

		async flush(): Promise<void> {
			await source.flush();
			bump();
		},

		select(next: Range | null): void {
			const same =
				selection === next ||
				(selection !== null &&
					next !== null &&
					selection.anchor.filePath === next.anchor.filePath &&
					selection.anchor.fieldId === next.anchor.fieldId &&
					selection.focus.filePath === next.focus.filePath &&
					selection.focus.fieldId === next.focus.fieldId);
			if (same) {
				return;
			}
			selection = next;
			selectionVersion += 1;
			bump();
			notify(selectionListeners);
		},

		setEditing(ref: CellRef | null): void {
			const same =
				editing === ref ||
				(editing !== null &&
					ref !== null &&
					editing.filePath === ref.filePath &&
					editing.fieldId === ref.fieldId);
			if (same) {
				return;
			}
			const previous = editing;
			editing = ref;
			bump();
			// Two cells change appearance when the editing cursor moves: the one that had it and the one that
			// took it. The editor is mounted by a cell, so this is the narrowest honest channel.
			if (previous !== null) {
				notifyCell(previous.filePath, previous.fieldId);
			}
			if (ref !== null) {
				notifyCell(ref.filePath, ref.fieldId);
			}
		},

		dispose(): void {
			disposed = true;
			sourceSubscription?.();
			sourceSubscription = null;
			cellListeners.clear();
			rowListeners.clear();
			selectionListeners.clear();
			globalListeners.clear();
		},
	};
}

/**
 * Reads one cell: the optimistic value if there is one, otherwise the table's. The overlay comes first
 * because a value the user just typed is the value they expect to see, whatever the file currently says.
 */
export function cellAt(state: GridState, filePath: RowId, propertyId: PropertyId): CellValue {
	const pending = state.overlay.get(filePath, propertyId);
	if (pending !== undefined) {
		return pending;
	}
	for (const row of state.table.rows) {
		if (row.filePath === filePath) {
			return cellOf(row, propertyId);
		}
	}
	return null;
}

/** True when the cell's value on screen is optimistic. */
export function isPending(state: GridState, filePath: RowId, propertyId: PropertyId): boolean {
	return state.overlay.get(filePath, propertyId) !== undefined;
}
