/**
 * The operation model: every change the product can make, as plain data.
 *
 * One closed union covers the whole product — a cell edit, a 400-row paste, a column resize, collapsing a
 * group, importing a sheet. Everything downstream reads from this file: the store pushes ops, the write
 * queue turns them into frontmatter writes, undo swaps them for their inverses, the migration emits them,
 * and the sync engine diffs them. Because they are the contract, three rules hold everywhere:
 *
 * 1. **Plain data only.** No closures, no class instances, no functions, no `Date` objects. An op must
 *    survive `structuredClone` (asserted in `ops.test.ts`) so it can be queued, serialised, posted to a
 *    worker or stored in the migration report. That is also why a "row" here is a `RowState` value and not
 *    a reference to one.
 * 2. **Everything apply needs is in the op, and everything the inverse needs is in the op or in `Before`.**
 *    Nothing is derived at apply time — no timestamps, no defaults, no lookups. A row-adding op carries the
 *    row's values; a column-deleting op carries the column's values; a resize carries the width it is
 *    replacing. That is what makes an undo of a deleted column restore the *data*, not an empty column.
 * 3. **Identity is the note path.** `filePath` addresses a row (a note *is* a row), `fieldId` addresses a
 *    column. Indexes appear only where a position is the thing being changed (`at`, `from`, `to`) and are
 *    always clamped at apply time, so a stale index degrades into "moved to the end" rather than corruption.
 *
 * The one rule the *caller* owes this model: **do not push an op that changes nothing.** Apply is
 * idempotent — collapsing an already-collapsed group is a no-op — but the inverse of a complement-shaped op
 * (`setGroupCollapse`) is derived from the op and not from the state, so pushing a no-op would produce an
 * undo step that appears to do nothing. The store checks before it pushes; `ops.test.ts` asserts the
 * idempotence so the rule is visible.
 */
import type { CellValue, FieldOptions, PropertyId } from '../types';
import type { ViewConfig } from '../view/pipeline';

/** A row's identity: the vault-relative path of the note. Unique inside one view. */
export type RowId = string;

/** One cell, addressed the way the product addresses cells. */
export type CellRef = {
	readonly filePath: RowId;
	readonly fieldId: PropertyId;
};

/** One value to write. The unit `setCells` and `importBlock` are assembled from. */
export type CellWrite = {
	readonly filePath: RowId;
	readonly fieldId: PropertyId;
	readonly value: CellValue;
};

/** A row's canonical values. A missing key and an empty cell are the same thing everywhere in the core. */
export type RowState = {
	readonly filePath: RowId;
	readonly cells: Readonly<Record<PropertyId, CellValue>>;
};

/** A row and the position it belongs at, so an op can remember where a row was without a global index. */
export type PlacedRow = {
	readonly at: number;
	readonly row: RowState;
};

/** One column's own state: identity, wording, options and width. */
export type FieldState = {
	readonly id: PropertyId;
	/** The visible column name. Renaming a column writes this, never the stored property name. */
	readonly name: string;
	readonly options: FieldOptions;
	/** The width the user dragged to, in CSS pixels, or `null` for "the grid decides". */
	readonly width: number | null;
};

/**
 * A patch to the view options. A key that is present with the value `undefined` means *remove this setting*
 * — which is how a patch can restore "the vault default", and what makes `setViewConfig` exactly invertible.
 * A key that is absent means "leave it alone".
 */
export type ViewPatch = {
	readonly search?: string;
	readonly sorts?: ViewConfig['sorts'];
	readonly groupBy?: PropertyId;
	readonly collapsedKeys?: readonly string[];
	readonly hiddenFieldIds?: readonly PropertyId[];
	readonly columnOrder?: readonly PropertyId[];
};

/** The state every op acts on: the columns, the rows, and the view options. */
export type TableState = {
	readonly fields: readonly FieldState[];
	readonly rows: readonly RowState[];
	readonly view: ViewConfig;
};

/** A single cell's next value. `null` is "clear this cell", never `undefined`. */
export type SetCellOp = {
	readonly kind: 'setCell';
	readonly filePath: RowId;
	readonly fieldId: PropertyId;
	readonly value: CellValue;
};

/** A matrix write: a paste, a fill-down, a bulk column edit. One op, hundreds of cells, one undo step. */
export type SetCellsOp = {
	readonly kind: 'setCells';
	readonly writes: readonly CellWrite[];
};

/** Clearing a selection. Separate from `setCells` because the wording of its undo step differs. */
export type ClearCellsOp = {
	readonly kind: 'clearCells';
	readonly cells: readonly CellRef[];
};

/** A new row — a new note, created and then filled in. */
export type AddRowOp = {
	readonly kind: 'addRow';
	readonly at: number;
	readonly row: RowState;
};

/** Deleting rows. Carries the rows themselves (values included), which is what makes the undo restore data. */
export type DeleteRowsOp = {
	readonly kind: 'deleteRows';
	readonly rows: readonly PlacedRow[];
};

/** Dragging one row. `from`/`to` are indexes in the row order, clamped at apply time. */
export type MoveRowOp = {
	readonly kind: 'moveRow';
	readonly filePath: RowId;
	readonly from: number;
	readonly to: number;
};

/** Dragging a block of rows. The block keeps its internal order, wherever it lands. */
export type MoveRowsOp = {
	readonly kind: 'moveRows';
	readonly filePaths: readonly RowId[];
	readonly from: number;
	readonly to: number;
};

/** Changing a column's options: the option list, its precision, its symbol, its unit. Both sides travel. */
export type SetFieldOptionsOp = {
	readonly kind: 'setFieldOptions';
	readonly fieldId: PropertyId;
	readonly from: FieldOptions;
	readonly to: FieldOptions;
};

/** A new column, plus the values it starts with (usually none, sometimes a paste's headers). */
export type AddFieldOp = {
	readonly kind: 'addField';
	readonly at: number;
	readonly field: FieldState;
	readonly values: readonly CellWrite[];
};

/** Deleting a column, carrying every value it held so the undo is a real restore. */
export type DeleteFieldOp = {
	readonly kind: 'deleteField';
	readonly at: number;
	readonly field: FieldState;
	readonly values: readonly CellWrite[];
};

/** Renaming a column. The data does not move; only the wording does. */
export type RenameFieldOp = {
	readonly kind: 'renameField';
	readonly fieldId: PropertyId;
	readonly from: string;
	readonly to: string;
};

/** Dragging a column edge. `null` means the grid's own width. */
export type ResizeColumnOp = {
	readonly kind: 'resizeColumn';
	readonly fieldId: PropertyId;
	readonly from: number | null;
	readonly to: number | null;
};

/** Dragging a column to another position. */
export type ReorderColumnOp = {
	readonly kind: 'reorderColumn';
	readonly fieldId: PropertyId;
	readonly from: number;
	readonly to: number;
};

/** Collapsing or expanding one group in a grouped view. */
export type SetGroupCollapseOp = {
	readonly kind: 'setGroupCollapse';
	readonly key: string;
	readonly collapsed: boolean;
};

/** A partial patch of the view options, carrying the values it overwrote. */
export type SetViewConfigOp = {
	readonly kind: 'setViewConfig';
	readonly changes: ViewPatch;
	readonly previous: ViewPatch;
};

/** A sheet pasted or imported: many rows at once, as one undo step. */
export type ImportBlockOp = {
	readonly kind: 'importBlock';
	readonly rows: readonly PlacedRow[];
};

/** Every mutation the product performs. Closed on purpose: `Record<Op['kind'], …>` is how the test suite
 * proves that each one has an inverse, and adding a kind without an inverse will not compile. */
export type Op =
	| SetCellOp
	| SetCellsOp
	| ClearCellsOp
	| AddRowOp
	| DeleteRowsOp
	| MoveRowOp
	| MoveRowsOp
	| SetFieldOptionsOp
	| AddFieldOp
	| DeleteFieldOp
	| RenameFieldOp
	| ResizeColumnOp
	| ReorderColumnOp
	| SetGroupCollapseOp
	| SetViewConfigOp
	| ImportBlockOp;

/** The kind of any op. */
export type OpKind = Op['kind'];

/**
 * The minimal prior state an inverse needs — captured *beside* the op, exactly as `docs/02` §Store describes
 * a command ("the ops it produced **and the previous values it overwrote**").
 *
 * Only three op kinds need one: the three that overwrite values without carrying what they replaced. Every
 * other kind is self-inverting (its own payload holds `from`/`to`, or the deleted thing itself), which is
 * why `{ kind: 'none' }` exists rather than an optional field: an op that ignores its before-image says so.
 *
 * `cells` holds **row-level before-images**: one entry per cell the op writes, in row order, ready to be
 * handed to the write queue a file at a time. It is never a copy of a whole row (a row's untouched cells are
 * not the caller's business) and never a copy of the table.
 */
export type Before =
	| { readonly kind: 'none' }
	| { readonly kind: 'value'; readonly value: CellValue }
	| { readonly kind: 'cells'; readonly writes: readonly CellWrite[] };

/** The result of inverting an op: the inverse, or the reason there isn't one. Never a throw. */
export type Inverse =
	{ readonly ok: true; readonly op: Op } | { readonly ok: false; readonly reason: string };

/** Why an op could not do what it asked. Reported, never thrown: a stale surface must not crash a grid. */
export type Skipped = {
	readonly op: Op;
	readonly reason: string;
	/** How many things the op asked for and did not get. A paste over 400 deleted rows reports `400`. */
	readonly count: number;
};

/** What applying an op produced: the next state, and whatever it had to leave alone. */
export type Applied = {
	readonly state: TableState;
	readonly skipped: readonly Skipped[];
};

/** A hook the store uses to merge rapid typing in one cell into one undo step. See `history.ts`. */
export type CoalesceRule = (previous: readonly Op[], next: readonly Op[]) => boolean;

/**
 * Every op kind, in the order this file declares them. Typed as `OpKind[]` so a typo here is a compile
 * error, and paired with a `Record<OpKind, …>` in the tests so a *missing* kind is one too.
 */
export const OP_KINDS: readonly OpKind[] = [
	'setCell',
	'setCells',
	'clearCells',
	'addRow',
	'deleteRows',
	'moveRow',
	'moveRows',
	'setFieldOptions',
	'addField',
	'deleteField',
	'renameField',
	'resizeColumn',
	'reorderColumn',
	'setGroupCollapse',
	'setViewConfig',
	'importBlock',
];
