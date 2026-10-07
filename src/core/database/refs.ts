/**
 * References — how the document layer addresses the things it edits (R3 step 2).
 *
 * Every operation and every lookup in `src/core/database/**` names a table, a row, a field or a view
 * by its **stable id**, and every cell reference carries the table it belongs to. That last part is
 * not decoration: `rowId` and `fieldId` are unique per table, not per document, so a cell reference
 * without its `tableId` cannot be resolved against a document that has two tables.
 *
 * Why these tiny types exist instead of four loose `string`s threaded through forty signatures: a
 * swap of two parameters of the same type is invisible to the compiler, and this layer's whole
 * promise is that an edit reaches the object the caller named. The refs are plain data — they
 * survive `structuredClone`, which is what lets them travel inside history entries.
 *
 * There is deliberately no vault path here, and no name: a path is an address the host uses to find
 * a file (R2's port), and a name is a label a person reads. Neither is identity — which is why the
 * identity inventory (`scripts/r3-inventory.ts`) expects this file to carry no legacy marker at all.
 */

/** A table, by id. */
export interface TableRef {
	readonly tableId: string;
}

/** A row of a table, by id. */
export interface RowRef extends TableRef {
	readonly rowId: string;
}

/** A field of a table, by id. */
export interface FieldRef extends TableRef {
	readonly fieldId: string;
}

/** A saved view of a table, by id. */
export interface ViewRef extends TableRef {
	readonly viewId: string;
}

/** One cell: the three ids a value lives under. */
export interface CellRef extends RowRef, FieldRef {}

/** Build a cell reference. The parameter order mirrors the nesting: table → row → field. */
export function cellRef(tableId: string, rowId: string, fieldId: string): CellRef {
	return { tableId, rowId, fieldId };
}

/** True when two references name the same cell. */
export function sameCell(a: CellRef, b: CellRef): boolean {
	return a.tableId === b.tableId && a.rowId === b.rowId && a.fieldId === b.fieldId;
}

/**
 * A stable, readable key for one cell: `tbl_x/row_y/fld_z`. For maps, sets and test assertions —
 * never for storage, and never parsed back into its parts (`docs/03` §principles: ids are opaque and
 * nothing may read meaning out of their body).
 */
export function cellKey(a: CellRef): string {
	return `${a.tableId}/${a.rowId}/${a.fieldId}`;
}
