/**
 * What a menu needs to know, gathered once, from the store and from the view that owns the grid.
 *
 * The menus are **pure functions over this context** — no store reads inside `headerMenuItems`, no ports looked up
 * per item — for one reason above all: a menu is a picture of a moment. If the selection changes between the
 * right-click and the click on "Delete 3 rows", the item must still mean the three rows the person pointed at, and
 * the only way to guarantee that is to freeze the facts here, once, at open time.
 *
 * The `ports` are the actions the **view** owns rather than the grid, because in this product they are file
 * operations: a new row is a new note, a deleted row is a deleted note, a restored row is a restored value. The
 * grid cannot do any of them (`src/grid/**` may not import `obsidian`), and none of them is a store command. A
 * `null` port means the view cannot do it, and the menu says so by disabling the item with a reason instead of
 * offering a dead click.
 */
import { normalize } from '../../core/selection/range';
import { selectCellDisplay } from '../store/selectors';
import type { Range, RangeOrder } from '../../core/selection/range';
import type { CellRef, RowId } from '../../core/ops/types';
import type { ResolvedField } from '../../core/schema/propertySchema';
import type { GridStore } from '../store/types';
import type { PropertyId } from '../../core/types';

/**
 * The row actions the *view* owns, as a bundle — the subset of {@link GridMenuPorts} that file operations make up,
 * so `GridView` can take them as one prop and the menus can take them as one field.
 */
export type GridRowPorts = {
	readonly onInsertRow: ((at: number) => void) | null;
	readonly onDuplicateRows: ((paths: readonly RowId[]) => void) | null;
	readonly onDeleteRows: ((paths: readonly RowId[]) => void) | null;
};

/** The actions a menu item can ask of the view. Every one of them is a file operation or a dialog. */
export type GridMenuPorts = {
	/** Show a row's note-shaped details (the dialog in `src/grid/dialogs/RowDetailsDialog.ts`). */
	readonly onRowDetails: (filePath: RowId) => void;
	/** Open the bulk-edit prompt for the current range (`Cmd/Ctrl+Enter`'s dialog half). */
	readonly onBulkEdit: () => void;
	/** Create a note and insert it at this index in the view. `null` ⇒ this view cannot create notes. */
	readonly onInsertRow: ((at: number) => void) | null;
	/** Create one note per given row, copying its values. `null` ⇒ this view cannot create notes. */
	readonly onDuplicateRows: ((paths: readonly RowId[]) => void) | null;
	/** Delete the notes behind these rows, after the view's own confirmation. `null` ⇒ not supported. */
	readonly onDeleteRows: ((paths: readonly RowId[]) => void) | null;
	/** Open one of the grid's own dialogs, by id. The grid owns the dialog instances. */
	readonly onDialog: (id: GridDialogId, argument?: string) => void;
	/** Select these rows, as the gutter menu's first item does. */
	readonly onSelectRows: (paths: readonly RowId[]) => void;
};

/** The dialogs the grid owns, by id — one list, so a menu cannot ask for a dialog that does not exist. */
export type GridDialogId = 'view-options' | 'field-config' | 'option-manager';

/** The view's own extent of the current selection, in indices, with the row paths the commands take. */
export type MenuBounds = {
	readonly top: number;
	readonly bottom: number;
	readonly left: number;
	readonly right: number;
	readonly rows: number;
	readonly fields: number;
	readonly rowPaths: readonly RowId[];
};

export type CellMenuContext = {
	readonly store: GridStore;
	/** The cell that was pointed at (or the active cell, for the keyboard). */
	readonly filePath: RowId;
	/** The column that was pointed at, resolved — `null` when the pointer was on a cell with no field. */
	readonly field: ResolvedField | null;
	readonly bounds: MenuBounds;
	readonly ports: GridMenuPorts;
};

export type HeaderMenuContext = {
	readonly store: GridStore;
	readonly field: ResolvedField;
	/** This column's index in the render order, so "Move left/right" and reorder are one arithmetic. */
	readonly columnIndex: number;
	readonly order: RangeOrder;
	readonly bounds: MenuBounds;
	readonly ports: GridMenuPorts;
};

export type GutterMenuContext = {
	readonly store: GridStore;
	readonly filePath: RowId;
	/** Every row the menu acts on: the selection's rows when there is a range, otherwise the pointed-at row. */
	readonly paths: readonly RowId[];
	readonly bounds: MenuBounds;
	readonly ports: GridMenuPorts;
};

/** The selection's extent for a menu, defaulting to the pointed-at cell when there is no range. */
export function menuBounds(
	order: RangeOrder,
	selection: Range | null,
	fallback: CellRef | null,
): MenuBounds {
	const range = selection ?? (fallback === null ? null : { anchor: fallback, focus: fallback });
	const bounds = range === null ? null : normalize(range, order);
	if (bounds === null) {
		return { top: 0, bottom: 0, left: 0, right: 0, rows: 0, fields: 0, rowPaths: [] };
	}
	return {
		top: bounds.top,
		bottom: bounds.bottom,
		left: bounds.left,
		right: bounds.right,
		rows: bounds.bottom - bounds.top + 1,
		fields: bounds.right - bounds.left + 1,
		rowPaths: order.rows.slice(bounds.top, bounds.bottom + 1),
	};
}

/** Resolves a column id against the store's own field list. */
export function fieldOf(store: GridStore, fieldId: PropertyId): ResolvedField | null {
	return (
		store.getSnapshot().fields.find((candidate) => candidate.definition.id === fieldId) ?? null
	);
}

/**
 * The primary column: the one that names each row's note. It is the source's own `file.name` property for a Bases
 * view, and the field list's first entry otherwise — the same rule `BasesSource` uses to pick it, restated here
 * because the menus need it and nothing else exports it.
 */
export function isPrimary(field: ResolvedField): boolean {
	return field.definition.source === 'file' && field.definition.id === 'file.name';
}

/** Whether a column carries options a person can manage (a single/multi select). */
export function hasFieldOptions(field: ResolvedField): boolean {
	const options: unknown = field.definition.fieldOptions;
	// `fieldOptions` is untrusted YAML (`PropertyDefinition.fieldOptions` is `unknown`), so the `in` narrowing is the
	// whole test: no assertion, no re-validation — `resolveField` has already validated it, and this only needs to
	// know whether a list of options exists.
	if (typeof options !== 'object' || options === null || !('type' in options)) {
		return false;
	}
	const type = options.type;
	return type === 'singleSelect' || type === 'multiSelect';
}

/** One column's visible values, as text — what "Resize to fit contents" measures. */
export function columnTexts(store: GridStore, fieldId: PropertyId): readonly string[] {
	const state = store.state();
	const order = store.getSnapshot().order;
	return order.rows.map((filePath) => selectCellDisplay(state, { filePath, fieldId }));
}
