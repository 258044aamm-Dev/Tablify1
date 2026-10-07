/**
 * The database-scoped operation algebra — R3 step 4.
 *
 * One document, addressed by identity, changed by plain-data operations that each name their own
 * inverse. This module is the *only* place a `DatabaseDocument` changes: the session (`R2`) applies
 * operations, the history (`R3` step 6) keeps them and their inverses, and a view never edits a
 * document object itself.
 *
 * ## The contract, in five parts
 *
 *   1. **Pure.** `applyOperation` returns a new document or a typed refusal. It never mutates its
 *      input, and untouched tables, rows, fields and views stay shared by reference, so a cell edit
 *      copies one row and nothing else.
 *   2. **Id-addressed.** Every operation names its target by stable id — `tableId`, `rowId`,
 *      `fieldId`, `viewId`. Nothing is addressed by name, index-as-identity or path, which is what
 *      makes *"never apply a write to an object with a reused name but different id"* true by
 *      construction: a stale id is a `no-such-…` refusal, never a write to whoever holds the name
 *      now. Reordering operations carry a target index because an index *is* the value they set;
 *      their inverse carries the old index, recorded from the state they actually saw.
 *   3. **Reversible.** A successful application returns the operations that undo it, in the order
 *      they must be applied: `applyOperations(document, result.inverses)` returns the document the
 *      operation started from, byte for byte, when it is applied immediately (before any other
 *      operation touches the document). Most inverses are one operation; deleting a record clears
 *      every inbound link in the same transaction (ADR-0002 §1), so its inverse first re-inserts the
 *      row at its old position and then restores each cleared cell with a normal `set-cells`.
 *   4. **Whole-value payloads.** An inverse carries the *previous value*, never a rule for
 *      recomputing it. A deleted record arrives back as the row it was; a removed column arrives
 *      back with its cells; a deleted table arrives back whole. That is ADR-0002 §2 exactly —
 *      *"records the cleared cells … it never recomputes 'what to restore' from the current
 *      document"* — and it is why undo cannot drift when the document has moved on.
 *   5. **One logical action, one transaction.** `applyOperations` applies a list as a unit: the
 *      first refusal stops the whole list and returns the refusal with the input untouched. A bulk
 *      paste, an import chunk or a delete-with-cleanup is therefore one history entry and one
 *      document write, not one per cell.
 *
 * ## What each operation declares (step 4's checklist, answered as code)
 *
 *   - **preconditions** — a name is usable, a target id resolves, an index is in range, a link field
 *     is a link field and its targets exist in the target table, a type change does not strand
 *     stored values, a table delete has no inbound links;
 *   - **affected ids** — the operation payload itself; nothing is derived from position except the
 *     reorder index;
 *   - **reversibility** — every accepted operation is reversible; a refusal changes nothing;
 *   - **inverse payload** — the previous value, as above;
 *   - **stale-revision guard** — this layer's guard is id resolution (a vanished id refuses), and the
 *     *file*-level guard is R2's: the session compares the document revision before writing and the
 *     queue never writes over a revision it did not read (ADR-0005);
 *   - **write-failure behaviour** — also R2's, by design: an operation is applied to memory first,
 *     the document is marked dirty, and a failed write stays visible and retryable. The core has no
 *     filesystem to fail on.
 *
 * ## Restore-only kinds
 *
 * `insert-record`, `insert-field`, `insert-table` and `insert-view` are operations like any other —
 * `applyOperation` accepts them — but no user action produces them: they exist so that a delete's
 * inverse can carry what it removed. They are the *only* asymmetry in the algebra, and they are the
 * reason undo restores identity, position and payload instead of a plausible reconstruction.
 *
 * ## Not here
 *
 * Relation **graph** checks beyond one operation's own targets (dangling ids across a document,
 * inbound-reference queries, atomicity of multi-table link writes) are R3 step 5; history, dispatch
 * validation and the store are step 6; row timestamp semantics are step 7.
 */
import { decodeQueryDocument } from '../query/ast';
import type { JsonValue } from './json';
import { isJsonObject } from './json';
import type { CellState, TableRow } from './rows';
import { encodeCell, isInvalidCell } from './values';
import type { DatabaseDocument, DatabaseTable } from './schema';
import type { FieldDefinition, FieldSettings, TableField } from './fields';
import type { TableView, ViewDensity, ViewSort } from './views';
import { isIdOfKind } from './ids';
import { validateLinksForTableDelete } from './links';

/** One cell to write: `null` clears the key, which is the one spelling of "no value" (ADR-0004). */
export interface CellEdit {
	readonly fieldId: string;
	readonly value: CellState;
}

/** Presentation and query keys a view update may set. Absent keys are left exactly as they were. */
export interface ViewPatch {
	/** The stored filter document. `null` clears it. */
	readonly filter?: JsonValue | null;
	readonly sorts?: readonly ViewSort[];
	readonly groupBy?: string | null;
	readonly hiddenFieldIds?: readonly string[];
	readonly columnOrder?: readonly string[];
	readonly collapsedKeys?: readonly string[];
	readonly widths?: ReadonlyMap<string, number>;
	readonly density?: ViewDensity | null;
	readonly frozenPrimary?: boolean | null;
}

/**
 * One requested change.
 *
 * The `insert-*` kinds are produced as inverses; everything else is a user-facing action. Payloads
 * are plain data — strings, numbers, booleans, arrays, `Map`s of numbers and immutable document
 * objects — so a history entry can hold one without borrowing anything from the host (ADR-0012).
 */
export type DatabaseOperation =
	// Database metadata.
	| { readonly kind: 'set-document-name'; readonly name: string }
	// Tables.
	| { readonly kind: 'create-table'; readonly tableId: string; readonly name: string }
	| { readonly kind: 'rename-table'; readonly tableId: string; readonly name: string }
	| { readonly kind: 'move-table'; readonly tableId: string; readonly toIndex: number }
	| { readonly kind: 'delete-table'; readonly tableId: string }
	| { readonly kind: 'insert-table'; readonly index: number; readonly table: DatabaseTable }
	// Fields.
	| {
			readonly kind: 'create-field';
			readonly tableId: string;
			readonly fieldId: string;
			readonly name: string;
			readonly type: FieldDefinition['type'];
			readonly settings?: FieldSettings;
	  }
	| {
			readonly kind: 'rename-field';
			readonly tableId: string;
			readonly fieldId: string;
			readonly name: string;
	  }
	| {
			readonly kind: 'reconfigure-field';
			readonly tableId: string;
			readonly fieldId: string;
			readonly type?: FieldDefinition['type'];
			readonly settings?: FieldSettings;
	  }
	| {
			readonly kind: 'move-field';
			readonly tableId: string;
			readonly fieldId: string;
			readonly toIndex: number;
	  }
	| { readonly kind: 'delete-field'; readonly tableId: string; readonly fieldId: string }
	| {
			readonly kind: 'insert-field';
			readonly tableId: string;
			readonly index: number;
			readonly field: TableField;
			/** The cells the column held, in row order: one edit per row that had a value. */
			readonly cells: readonly { readonly rowId: string; readonly value: CellState }[];
	  }
	// Records.
	| {
			readonly kind: 'create-record';
			readonly tableId: string;
			readonly rowId: string;
			readonly cells?: readonly CellEdit[];
			/** Where the new row lands in the explicit order (ADR-0003). Absent appends. */
			readonly toIndex?: number;
	  }
	| {
			readonly kind: 'duplicate-record';
			readonly tableId: string;
			readonly rowId: string;
			readonly newRowId: string;
			readonly toIndex?: number;
	  }
	| {
			readonly kind: 'set-cells';
			readonly tableId: string;
			readonly rowId: string;
			readonly edits: readonly CellEdit[];
	  }
	| {
			readonly kind: 'move-record';
			readonly tableId: string;
			readonly rowId: string;
			readonly toIndex: number;
	  }
	| { readonly kind: 'delete-record'; readonly tableId: string; readonly rowId: string }
	| {
			readonly kind: 'insert-record';
			readonly tableId: string;
			readonly index: number;
			readonly row: TableRow;
	  }
	// Views.
	| {
			readonly kind: 'create-view';
			readonly tableId: string;
			readonly viewId: string;
			readonly name: string;
	  }
	| {
			readonly kind: 'rename-view';
			readonly tableId: string;
			readonly viewId: string;
			readonly name: string;
	  }
	| {
			readonly kind: 'duplicate-view';
			readonly tableId: string;
			readonly viewId: string;
			readonly newViewId: string;
			readonly name: string;
	  }
	| { readonly kind: 'delete-view'; readonly tableId: string; readonly viewId: string }
	| {
			readonly kind: 'update-view';
			readonly tableId: string;
			readonly viewId: string;
			readonly patch: ViewPatch;
	  }
	| {
			readonly kind: 'insert-view';
			readonly tableId: string;
			readonly index: number;
			readonly view: TableView;
	  }
	// Relations.
	| {
			readonly kind: 'set-link';
			readonly tableId: string;
			readonly rowId: string;
			readonly fieldId: string;
			/** The complete new value: the ordered ids a user chose, or `[]` to clear the cell. */
			readonly rowIds: readonly string[];
	  };

/** Why an operation was refused. A closed set, so a caller branches without reading messages. */
export type OperationRefusalCode =
	| 'invalid-name'
	| 'no-change'
	| 'no-such-table'
	| 'no-such-row'
	| 'no-such-field'
	| 'no-such-view'
	| 'duplicate-id'
	| 'duplicate-edit'
	| 'index-out-of-range'
	| 'cell-not-writable'
	| 'type-change-loses-data'
	| 'not-a-link-field'
	| 'generated-field'
	| 'link-cardinality'
	| 'unresolved-link'
	| 'referenced-table';

/** The verdict of one operation: a new document and its inverses, or the reason it was refused. */
export type OperationResult =
	| {
			readonly ok: true;
			readonly document: DatabaseDocument;
			/** Undo, in the order it must be applied. Empty is impossible for an accepted operation. */
			readonly inverses: readonly DatabaseOperation[];
	  }
	| { readonly ok: false; readonly code: OperationRefusalCode; readonly message: string };

/** The verdict of a list applied as a unit. */
export type OperationsResult =
	| {
			readonly ok: true;
			readonly document: DatabaseDocument;
			/** Undo for the whole list, in the order it must be applied (reverse chronological). */
			readonly inverses: readonly DatabaseOperation[];
	  }
	| { readonly ok: false; readonly code: OperationRefusalCode; readonly message: string };

function refuse(code: OperationRefusalCode, message: string): OperationResult {
	return { ok: false, code, message };
}

function accept(document: DatabaseDocument, ...inverses: DatabaseOperation[]): OperationResult {
	return { ok: true, document, inverses };
}

/** A name a document, table, field or view may carry: non-empty after trimming, and nothing else. */
function isUsableName(name: unknown): name is string {
	return typeof name === 'string' && name.trim() !== '';
}

/** Where a table sits, or `undefined`. One lookup, so every branch agrees on what "resolves" means. */
function tableIndexOf(document: DatabaseDocument, tableId: string): number | undefined {
	const index = document.tables.findIndex((table) => table.id === tableId);
	return index === -1 ? undefined : index;
}

function fieldIndexOf(table: DatabaseTable, fieldId: string): number | undefined {
	const index = table.fields.findIndex((field) => field.id === fieldId);
	return index === -1 ? undefined : index;
}

function rowIndexOf(table: DatabaseTable, rowId: string): number | undefined {
	const index = table.rows.findIndex((row) => row.id === rowId);
	return index === -1 ? undefined : index;
}

function viewIndexOf(table: DatabaseTable, viewId: string): number | undefined {
	const index = table.views.findIndex((view) => view.id === viewId);
	return index === -1 ? undefined : index;
}

/** A table with one list replaced, and everything else shared. */
function withTableList(
	document: DatabaseDocument,
	index: number,
	change: Partial<DatabaseTable>,
): DatabaseDocument {
	const table = document.tables[index];
	if (table === undefined) {
		return document;
	}
	const tables = document.tables.slice();
	tables[index] = { ...table, ...change };
	return { ...document, tables };
}

/** Move one entry of a list to another index, returning the new list. */
function moved<T>(list: readonly T[], from: number, to: number): readonly T[] {
	const next = list.slice();
	const [entry] = next.splice(from, 1);
	if (entry === undefined) {
		return list;
	}
	next.splice(to, 0, entry);
	return next;
}

/** A usable index for insertion into a list of `length` entries: 0..length inclusive. */
function isInsertableIndex(index: number, length: number): boolean {
	return Number.isInteger(index) && index >= 0 && index <= length;
}

/** A usable index for an entry that must move: 0..length-1. */
function isMovableIndex(index: number, length: number): boolean {
	return Number.isInteger(index) && index >= 0 && index < length;
}

/** The definition of a resolvable field, or a refusal naming why it is not one. */
function definitionAt(
	table: DatabaseTable,
	fieldId: string,
): { readonly index: number; readonly field: FieldDefinition } | OperationResult {
	const index = fieldIndexOf(table, fieldId);
	const field = index === undefined ? undefined : table.fields[index];
	if (index === undefined || field === undefined) {
		return refuse('no-such-field', `The table "${table.name}" has no field "${fieldId}".`);
	}
	if (field.kind !== 'field') {
		return refuse(
			'cell-not-writable',
			`The field "${fieldId}" is of a type this build does not read; its values are preserved as they are.`,
		);
	}
	return { index, field };
}

/** True when a value is a refusal from {@link definitionAt}. */
function isRefusal(
	value: { readonly index: number; readonly field: FieldDefinition } | OperationResult,
): value is OperationResult {
	return 'ok' in value;
}

/** One row with a set of cells written, in one copy. Writes go through `encodeCell`, as R1 requires. */
function withCells(row: TableRow, edits: readonly CellEdit[]): TableRow {
	const cells = new Map(row.cells);
	for (const edit of edits) {
		if (edit.value === null) {
			cells.delete(edit.fieldId);
			continue;
		}
		cells.set(edit.fieldId, edit.value);
	}
	return { ...row, cells };
}

/** Every id that resolves to a row of the table with this id, or `undefined` when the table is absent. */
function rowIdsOf(document: DatabaseDocument, tableId: string): ReadonlySet<string> | undefined {
	const table = document.tables.find((candidate) => candidate.id === tableId);
	if (table === undefined) {
		return undefined;
	}
	return new Set(table.rows.map((row) => row.id));
}

/** One cell that points at a row about to be deleted: what it holds, and what removing the id leaves. */
interface InboundClear {
	readonly tableId: string;
	readonly rowId: string;
	readonly fieldId: string;
	/** The value after the deleted id is removed — `null` when nothing is left. */
	readonly cleared: CellState;
	/** The value that was there, so undo writes back what existed rather than recomputing it. */
	readonly previous: CellState;
}

/**
 * Every stored reference to `rowId` of `tableId`, with the value that clearing it leaves behind.
 *
 * ADR-0002 §1: deleting a row clears every inbound id **in the same operation**, and the clear is
 * recorded so undo restores what was there. The scan reads `cells` only — the inverse column of a
 * link is derived and never stored (ADR-0001 §3), so there is nothing else to clear — and it is
 * careful about *lists*: a multi link that named the row among others loses that one entry and keeps
 * the rest **in order** (ADR-0001 §4), instead of being replaced by the value it held before.
 */
function inboundClears(
	document: DatabaseDocument,
	targetTableId: string,
	rowId: string,
): readonly InboundClear[] {
	const found: InboundClear[] = [];
	for (const table of document.tables) {
		for (const field of table.fields) {
			if (field.kind !== 'field' || field.type !== 'link') {
				continue;
			}
			if (field.settings.targetTableId !== targetTableId) {
				continue;
			}
			for (const row of table.rows) {
				const previous = row.cells.get(field.id);
				if (previous === undefined || isInvalidCell(previous)) {
					continue;
				}
				let cleared: CellState | undefined;
				if (previous === rowId) {
					cleared = null;
				} else if (Array.isArray(previous) && previous.includes(rowId)) {
					const kept = previous.filter((id) => id !== rowId);
					cleared = kept.length === 0 ? null : kept;
				}
				if (cleared !== undefined) {
					found.push({
						tableId: table.id,
						rowId: row.id,
						fieldId: field.id,
						cleared,
						previous,
					});
				}
			}
		}
	}
	return found;
}

/** The `set-cells` operations that write a set of clears, one per affected row, on one side. */
function clearOperations(
	clears: readonly InboundClear[],
	side: 'cleared' | 'previous',
): readonly DatabaseOperation[] {
	const byRow = new Map<string, { tableId: string; rowId: string; edits: CellEdit[] }>();
	for (const clear of clears) {
		const key = `${clear.tableId}/${clear.rowId}`;
		const existing = byRow.get(key);
		const edit: CellEdit = { fieldId: clear.fieldId, value: clear[side] };
		if (existing === undefined) {
			byRow.set(key, { tableId: clear.tableId, rowId: clear.rowId, edits: [edit] });
			continue;
		}
		existing.edits.push(edit);
	}
	return [...byRow.values()].map((entry) => ({
		kind: 'set-cells',
		tableId: entry.tableId,
		rowId: entry.rowId,
		edits: entry.edits,
	}));
}

/** The document with the named cells cleared: deleting a row removes references to it (ADR-0002 §1). */
function clearedFor(document: DatabaseDocument, clears: readonly InboundClear[]): DatabaseDocument {
	let next = document;
	for (const operation of clearOperations(clears, 'cleared')) {
		const applied = applyOperation(next, operation);
		if (applied.ok) {
			next = applied.document;
		}
	}
	return next;
}

/** True when changing `field` to `type` would strand a stored value: the data-loss precondition. */
function typeChangeProblem(
	table: DatabaseTable,
	fieldId: string,
	type: FieldDefinition['type'],
): string | undefined {
	let affected = 0;
	for (const row of table.rows) {
		const stored = row.cells.get(fieldId);
		if (stored === undefined) {
			continue;
		}
		const verdict = isInvalidCell(stored) ? 'write' : encodeCell(type, stored).kind;
		if (verdict === 'unwritable') {
			affected += 1;
		}
	}
	if (affected === 0) {
		return undefined;
	}
	return affected === 1
		? '1 stored value cannot be written as that type'
		: `${String(affected)} stored values cannot be written as that type`;
}

/** A field definition built from the create operation's payload. */
function definitionOf(
	fieldId: string,
	name: string,
	type: FieldDefinition['type'],
	settings: FieldSettings | undefined,
): FieldDefinition {
	return { kind: 'field', id: fieldId, name, type, settings: settings ?? {}, unknown: [] };
}

/** Everything the inverse of a `set-cells` needs: the values that were there, per field. */
function previousEdits(
	table: DatabaseTable,
	rowId: string,
	edits: readonly CellEdit[],
): readonly CellEdit[] {
	const row = table.rows.find((candidate) => candidate.id === rowId);
	const previous: CellEdit[] = [];
	for (const edit of edits) {
		const before = row?.cells.get(edit.fieldId);
		previous.push({ fieldId: edit.fieldId, value: before ?? null });
	}
	return previous;
}

/**
 * Apply one operation to a document.
 *
 * Returns a new document with the operations that undo it, or a typed refusal. The input document is
 * never modified — including on the refusal path, which changes nothing at all.
 */
export function applyOperation(
	document: DatabaseDocument,
	operation: DatabaseOperation,
): OperationResult {
	switch (operation.kind) {
		case 'set-document-name': {
			if (!isUsableName(operation.name)) {
				return refuse('invalid-name', 'A database name cannot be empty.');
			}
			if (document.name === operation.name) {
				return refuse('no-change', 'The database already carries that name.');
			}
			const previous = document.name;
			return accept(
				{ ...document, name: operation.name },
				{
					kind: 'set-document-name',
					name: previous,
				},
			);
		}

		case 'create-table': {
			if (!isUsableName(operation.name)) {
				return refuse('invalid-name', 'A table name cannot be empty.');
			}
			if (!isIdOfKind('table', operation.tableId)) {
				return refuse('invalid-name', `"${operation.tableId}" is not a table id.`);
			}
			if (tableIndexOf(document, operation.tableId) !== undefined) {
				return refuse(
					'duplicate-id',
					`This database already has a table "${operation.tableId}".`,
				);
			}
			const table: DatabaseTable = {
				id: operation.tableId,
				name: operation.name,
				fields: [],
				rows: [],
				views: [],
				unknown: [],
			};
			return accept(
				{ ...document, tables: [...document.tables, table] },
				{
					kind: 'delete-table',
					tableId: operation.tableId,
				},
			);
		}

		case 'rename-table': {
			if (!isUsableName(operation.name)) {
				return refuse('invalid-name', 'A table name cannot be empty.');
			}
			const index = tableIndexOf(document, operation.tableId);
			const table = index === undefined ? undefined : document.tables[index];
			if (index === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			if (table.name === operation.name) {
				return refuse(
					'no-change',
					`The table already carries the name "${operation.name}".`,
				);
			}
			const previous = table.name;
			return accept(withTableList(document, index, { name: operation.name }), {
				kind: 'rename-table',
				tableId: operation.tableId,
				name: previous,
			});
		}

		case 'move-table': {
			const index = tableIndexOf(document, operation.tableId);
			if (index === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			if (!isMovableIndex(operation.toIndex, document.tables.length)) {
				return refuse(
					'index-out-of-range',
					`A table cannot move to index ${String(operation.toIndex)}; this database has ${String(document.tables.length)}.`,
				);
			}
			if (index === operation.toIndex) {
				return refuse('no-change', 'The table is already at that position.');
			}
			return accept(
				{ ...document, tables: moved(document.tables, index, operation.toIndex) },
				{
					kind: 'move-table',
					tableId: operation.tableId,
					toIndex: index,
				},
			);
		}

		case 'delete-table': {
			const index = tableIndexOf(document, operation.tableId);
			const table = index === undefined ? undefined : document.tables[index];
			if (index === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			// ADR-0002 §3: refused while referenced — by a link field that names this table as its
			// target, whether or not any cell currently resolves. No cascade delete, ever.
			const referring = validateLinksForTableDelete(document, operation.tableId);
			if (referring.length > 0) {
				const named = referring
					.map((entry) => `"${entry.tableName}" (${entry.fieldName})`)
					.join(', ');
				return refuse(
					'referenced-table',
					`"${table.name}" is referenced by ${named}. Remove or retarget those link fields first.`,
				);
			}
			const tables = document.tables.slice();
			tables.splice(index, 1);
			return accept({ ...document, tables }, { kind: 'insert-table', index, table });
		}

		case 'insert-table': {
			if (!isInsertableIndex(operation.index, document.tables.length)) {
				return refuse(
					'index-out-of-range',
					`Cannot insert a table at index ${String(operation.index)}.`,
				);
			}
			if (tableIndexOf(document, operation.table.id) !== undefined) {
				return refuse(
					'duplicate-id',
					`This database already has a table "${operation.table.id}".`,
				);
			}
			const tables = document.tables.slice();
			tables.splice(operation.index, 0, operation.table);
			return accept(
				{ ...document, tables },
				{
					kind: 'delete-table',
					tableId: operation.table.id,
				},
			);
		}

		case 'create-field': {
			if (!isUsableName(operation.name)) {
				return refuse('invalid-name', 'A field name cannot be empty.');
			}
			if (!isIdOfKind('field', operation.fieldId)) {
				return refuse('invalid-name', `"${operation.fieldId}" is not a field id.`);
			}
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			if (fieldIndexOf(table, operation.fieldId) !== undefined) {
				return refuse(
					'duplicate-id',
					`The table "${table.name}" already has a field "${operation.fieldId}".`,
				);
			}
			const field = definitionOf(
				operation.fieldId,
				operation.name,
				operation.type,
				operation.settings,
			);
			return accept(
				withTableList(document, tableIndex, { fields: [...table.fields, field] }),
				{
					kind: 'delete-field',
					tableId: operation.tableId,
					fieldId: operation.fieldId,
				},
			);
		}

		case 'rename-field': {
			if (!isUsableName(operation.name)) {
				return refuse('invalid-name', 'A field name cannot be empty.');
			}
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			const found = definitionAt(table, operation.fieldId);
			if (isRefusal(found)) {
				return found;
			}
			if (found.field.name === operation.name) {
				return refuse(
					'no-change',
					`The column already carries the name "${operation.name}".`,
				);
			}
			const previous = found.field.name;
			const fields = table.fields.slice();
			fields[found.index] = { ...found.field, name: operation.name };
			return accept(withTableList(document, tableIndex, { fields }), {
				kind: 'rename-field',
				tableId: operation.tableId,
				fieldId: operation.fieldId,
				name: previous,
			});
		}

		case 'reconfigure-field': {
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			const found = definitionAt(table, operation.fieldId);
			if (isRefusal(found)) {
				return found;
			}
			const type = operation.type ?? found.field.type;
			const settings = operation.settings ?? found.field.settings;
			if (type !== found.field.type) {
				const problem = typeChangeProblem(table, operation.fieldId, type);
				if (problem !== undefined) {
					return refuse(
						'type-change-loses-data',
						`"${found.field.name}" cannot become a "${type}" column: ${problem}.`,
					);
				}
			}
			const unchanged =
				type === found.field.type &&
				JSON.stringify(settings) === JSON.stringify(found.field.settings);
			if (unchanged) {
				return refuse('no-change', 'The column already has that type and those settings.');
			}
			const fields = table.fields.slice();
			fields[found.index] = { ...found.field, type, settings };
			return accept(withTableList(document, tableIndex, { fields }), {
				kind: 'reconfigure-field',
				tableId: operation.tableId,
				fieldId: operation.fieldId,
				type: found.field.type,
				settings: found.field.settings,
			});
		}

		case 'move-field': {
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			const index = fieldIndexOf(table, operation.fieldId);
			if (index === undefined) {
				return refuse(
					'no-such-field',
					`The table "${table.name}" has no field "${operation.fieldId}".`,
				);
			}
			if (!isMovableIndex(operation.toIndex, table.fields.length)) {
				return refuse(
					'index-out-of-range',
					`A column cannot move to index ${String(operation.toIndex)}.`,
				);
			}
			if (index === operation.toIndex) {
				return refuse('no-change', 'The column is already at that position.');
			}
			return accept(
				withTableList(document, tableIndex, {
					fields: moved(table.fields, index, operation.toIndex),
				}),
				{
					kind: 'move-field',
					tableId: operation.tableId,
					fieldId: operation.fieldId,
					toIndex: index,
				},
			);
		}

		case 'delete-field': {
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			const index = fieldIndexOf(table, operation.fieldId);
			const field = index === undefined ? undefined : table.fields[index];
			if (index === undefined || field === undefined) {
				return refuse(
					'no-such-field',
					`The table "${table.name}" has no field "${operation.fieldId}".`,
				);
			}
			// The whole column travels in the inverse: the field object, its position, and every cell
			// that held a value. Nothing is recomputed on undo (ADR-0002 §2).
			const cells: { rowId: string; value: CellState }[] = [];
			for (const row of table.rows) {
				const stored = row.cells.get(operation.fieldId);
				if (stored !== undefined) {
					cells.push({ rowId: row.id, value: stored });
				}
			}
			const fields = table.fields.slice();
			fields.splice(index, 1);
			return accept(withTableList(document, tableIndex, { fields }), {
				kind: 'insert-field',
				tableId: operation.tableId,
				index,
				field,
				cells,
			});
		}

		case 'insert-field': {
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			if (!isInsertableIndex(operation.index, table.fields.length)) {
				return refuse(
					'index-out-of-range',
					`Cannot insert a column at index ${String(operation.index)}.`,
				);
			}
			const fieldId = operation.field.id;
			if (fieldId === null) {
				// A column of a type this build does not read, in a file that gave it no id, is preserved
				// exactly as written and is unreachable by id: it can be neither removed nor re-inserted
				// through this algebra, and saying so beats inventing an address for it.
				return refuse(
					'no-such-field',
					'A column with no id cannot be re-inserted by id; it is preserved as the file wrote it.',
				);
			}
			if (fieldIndexOf(table, fieldId) !== undefined) {
				return refuse(
					'duplicate-id',
					`The table "${table.name}" already has a field "${fieldId}".`,
				);
			}
			const fields = table.fields.slice();
			fields.splice(operation.index, 0, operation.field);
			let rows = table.rows;
			if (operation.cells.length > 0) {
				rows = rows.map((row) => {
					const cell = operation.cells.find((entry) => entry.rowId === row.id);
					return cell === undefined
						? row
						: withCells(row, [{ fieldId, value: cell.value }]);
				});
			}
			return accept(withTableList(document, tableIndex, { fields, rows }), {
				kind: 'delete-field',
				tableId: operation.tableId,
				fieldId,
			});
		}

		case 'create-record': {
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			if (!isIdOfKind('row', operation.rowId)) {
				return refuse('invalid-name', `"${operation.rowId}" is not a row id.`);
			}
			if (rowIndexOf(table, operation.rowId) !== undefined) {
				return refuse(
					'duplicate-id',
					`The table "${table.name}" already has a row "${operation.rowId}".`,
				);
			}
			const at = operation.toIndex ?? table.rows.length;
			if (!isInsertableIndex(at, table.rows.length)) {
				return refuse(
					'index-out-of-range',
					`A record cannot be created at index ${String(at)}.`,
				);
			}
			for (const edit of operation.cells ?? []) {
				const found = definitionAt(table, edit.fieldId);
				if (isRefusal(found)) {
					return found;
				}
				const writable = encodeCell(found.field.type, edit.value);
				if (writable.kind === 'unwritable') {
					return refuse(
						'cell-not-writable',
						`The value cannot live in "${found.field.name}": ${writable.reason}.`,
					);
				}
			}
			const row: TableRow = {
				id: operation.rowId,
				cells: new Map(
					(operation.cells ?? [])
						.filter((edit) => edit.value !== null)
						.map((edit) => [edit.fieldId, edit.value]),
				),
				createdAt: null,
				updatedAt: null,
				unknown: [],
			};
			const rows = table.rows.slice();
			rows.splice(at, 0, row);
			return accept(withTableList(document, tableIndex, { rows }), {
				kind: 'delete-record',
				tableId: operation.tableId,
				rowId: operation.rowId,
			});
		}

		case 'duplicate-record': {
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			const index = rowIndexOf(table, operation.rowId);
			const source = index === undefined ? undefined : table.rows[index];
			if (index === undefined || source === undefined) {
				return refuse(
					'no-such-row',
					`The table "${table.name}" has no row "${operation.rowId}".`,
				);
			}
			if (!isIdOfKind('row', operation.newRowId)) {
				return refuse('invalid-name', `"${operation.newRowId}" is not a row id.`);
			}
			if (rowIndexOf(table, operation.newRowId) !== undefined) {
				return refuse(
					'duplicate-id',
					`The table "${table.name}" already has a row "${operation.newRowId}".`,
				);
			}
			const at = operation.toIndex ?? index + 1;
			if (!isInsertableIndex(at, table.rows.length)) {
				return refuse(
					'index-out-of-range',
					`A copy cannot be inserted at index ${String(at)}.`,
				);
			}
			// The copy carries the source row's **cells** and nothing else: timestamps and any unknown
			// keys belong to the original record, and minting new times is step 7's decision.
			const copy: TableRow = {
				id: operation.newRowId,
				cells: new Map(source.cells),
				createdAt: null,
				updatedAt: null,
				unknown: [],
			};
			const rows = table.rows.slice();
			rows.splice(at, 0, copy);
			return accept(withTableList(document, tableIndex, { rows }), {
				kind: 'delete-record',
				tableId: operation.tableId,
				rowId: operation.newRowId,
			});
		}

		case 'set-cells': {
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			const rowIndex = rowIndexOf(table, operation.rowId);
			const row = rowIndex === undefined ? undefined : table.rows[rowIndex];
			if (rowIndex === undefined || row === undefined) {
				return refuse(
					'no-such-row',
					`The table "${table.name}" has no row "${operation.rowId}".`,
				);
			}
			if (operation.edits.length === 0) {
				return refuse('no-change', 'A cell write names at least one field.');
			}
			const seen = new Set<string>();
			for (const edit of operation.edits) {
				if (seen.has(edit.fieldId)) {
					return refuse('duplicate-edit', `The write names "${edit.fieldId}" twice.`);
				}
				seen.add(edit.fieldId);
				const found = definitionAt(table, edit.fieldId);
				if (isRefusal(found)) {
					return found;
				}
				const writable = encodeCell(found.field.type, edit.value);
				if (writable.kind === 'unwritable') {
					return refuse(
						'cell-not-writable',
						`The value cannot live in "${found.field.name}": ${writable.reason}.`,
					);
				}
			}
			const previous = previousEdits(table, operation.rowId, operation.edits);
			const rows = table.rows.slice();
			rows[rowIndex] = withCells(row, operation.edits);
			return accept(withTableList(document, tableIndex, { rows }), {
				kind: 'set-cells',
				tableId: operation.tableId,
				rowId: operation.rowId,
				edits: previous,
			});
		}

		case 'move-record': {
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			const index = rowIndexOf(table, operation.rowId);
			if (index === undefined) {
				return refuse(
					'no-such-row',
					`The table "${table.name}" has no row "${operation.rowId}".`,
				);
			}
			if (!isMovableIndex(operation.toIndex, table.rows.length)) {
				return refuse(
					'index-out-of-range',
					`A record cannot move to index ${String(operation.toIndex)}.`,
				);
			}
			if (index === operation.toIndex) {
				return refuse('no-change', 'The record is already at that position.');
			}
			return accept(
				withTableList(document, tableIndex, {
					rows: moved(table.rows, index, operation.toIndex),
				}),
				{
					kind: 'move-record',
					tableId: operation.tableId,
					rowId: operation.rowId,
					toIndex: index,
				},
			);
		}

		case 'delete-record': {
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			const index = rowIndexOf(table, operation.rowId);
			const row = index === undefined ? undefined : table.rows[index];
			if (index === undefined || row === undefined) {
				return refuse(
					'no-such-row',
					`The table "${table.name}" has no row "${operation.rowId}".`,
				);
			}
			const clears = inboundClears(document, operation.tableId, operation.rowId);
			const rows = table.rows.slice();
			rows.splice(index, 1);
			const removed = withTableList(document, tableIndex, { rows });
			const cleared = clearedFor(removed, clears);
			// Undo order: put the row back first (so link targets resolve again), then restore the
			// cleared cells, each as the value it held before.
			return accept(
				cleared,
				{ kind: 'insert-record', tableId: operation.tableId, index, row },
				...clearOperations(clears, 'previous'),
			);
		}

		case 'insert-record': {
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			if (!isInsertableIndex(operation.index, table.rows.length)) {
				return refuse(
					'index-out-of-range',
					`Cannot insert a record at index ${String(operation.index)}.`,
				);
			}
			if (rowIndexOf(table, operation.row.id) !== undefined) {
				return refuse(
					'duplicate-id',
					`The table "${table.name}" already has a row "${operation.row.id}".`,
				);
			}
			const rows = table.rows.slice();
			rows.splice(operation.index, 0, operation.row);
			return accept(withTableList(document, tableIndex, { rows }), {
				kind: 'delete-record',
				tableId: operation.tableId,
				rowId: operation.row.id,
			});
		}

		case 'create-view': {
			if (!isUsableName(operation.name)) {
				return refuse('invalid-name', 'A view name cannot be empty.');
			}
			if (!isIdOfKind('view', operation.viewId)) {
				return refuse('invalid-name', `"${operation.viewId}" is not a view id.`);
			}
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			if (viewIndexOf(table, operation.viewId) !== undefined) {
				return refuse(
					'duplicate-id',
					`The table "${table.name}" already has a view "${operation.viewId}".`,
				);
			}
			const view: TableView = {
				id: operation.viewId,
				name: operation.name,
				filter: null,
				filterExpr: null,
				filterProblems: [],
				sorts: [],
				groupBy: null,
				hiddenFieldIds: [],
				columnOrder: [],
				collapsedKeys: [],
				widths: new Map(),
				density: null,
				frozenPrimary: null,
				unknown: [],
			};
			return accept(withTableList(document, tableIndex, { views: [...table.views, view] }), {
				kind: 'delete-view',
				tableId: operation.tableId,
				viewId: operation.viewId,
			});
		}

		case 'rename-view': {
			if (!isUsableName(operation.name)) {
				return refuse('invalid-name', 'A view name cannot be empty.');
			}
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			const index = viewIndexOf(table, operation.viewId);
			const view = index === undefined ? undefined : table.views[index];
			if (index === undefined || view === undefined) {
				return refuse(
					'no-such-view',
					`The table "${table.name}" has no view "${operation.viewId}".`,
				);
			}
			if (view.name === operation.name) {
				return refuse(
					'no-change',
					`The view already carries the name "${operation.name}".`,
				);
			}
			const previous = view.name;
			const views = table.views.slice();
			views[index] = { ...view, name: operation.name };
			return accept(withTableList(document, tableIndex, { views }), {
				kind: 'rename-view',
				tableId: operation.tableId,
				viewId: operation.viewId,
				name: previous,
			});
		}

		case 'duplicate-view': {
			if (!isUsableName(operation.name)) {
				return refuse('invalid-name', 'A view name cannot be empty.');
			}
			if (!isIdOfKind('view', operation.newViewId)) {
				return refuse('invalid-name', `"${operation.newViewId}" is not a view id.`);
			}
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			const index = viewIndexOf(table, operation.viewId);
			const source = index === undefined ? undefined : table.views[index];
			if (index === undefined || source === undefined) {
				return refuse(
					'no-such-view',
					`The table "${table.name}" has no view "${operation.viewId}".`,
				);
			}
			if (viewIndexOf(table, operation.newViewId) !== undefined) {
				return refuse(
					'duplicate-id',
					`The table "${table.name}" already has a view "${operation.newViewId}".`,
				);
			}
			const copy: TableView = {
				...source,
				id: operation.newViewId,
				name: operation.name,
				widths: new Map(source.widths),
			};
			const views = table.views.slice();
			views.splice(index + 1, 0, copy);
			return accept(withTableList(document, tableIndex, { views }), {
				kind: 'delete-view',
				tableId: operation.tableId,
				viewId: operation.newViewId,
			});
		}

		case 'delete-view': {
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			const index = viewIndexOf(table, operation.viewId);
			const view = index === undefined ? undefined : table.views[index];
			if (index === undefined || view === undefined) {
				return refuse(
					'no-such-view',
					`The table "${table.name}" has no view "${operation.viewId}".`,
				);
			}
			const views = table.views.slice();
			views.splice(index, 1);
			return accept(withTableList(document, tableIndex, { views }), {
				kind: 'insert-view',
				tableId: operation.tableId,
				index,
				view,
			});
		}

		case 'update-view': {
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			const index = viewIndexOf(table, operation.viewId);
			const view = index === undefined ? undefined : table.views[index];
			if (index === undefined || view === undefined) {
				return refuse(
					'no-such-view',
					`The table "${table.name}" has no view "${operation.viewId}".`,
				);
			}
			const patch = operation.patch;
			const filter = 'filter' in patch ? (patch.filter ?? null) : view.filter;
			if ('filter' in patch && filter !== null && !isJsonObject(filter)) {
				return refuse(
					'cell-not-writable',
					'A view filter must be a stored query object or null.',
				);
			}
			const decoded = 'filter' in patch ? decodeQueryDocument(filter) : undefined;
			const next: TableView = {
				...view,
				filter,
				filterExpr: decoded === undefined ? view.filterExpr : decoded.expr,
				filterProblems: decoded === undefined ? view.filterProblems : decoded.problems,
				sorts: patch.sorts ?? view.sorts,
				groupBy: 'groupBy' in patch ? (patch.groupBy ?? null) : view.groupBy,
				hiddenFieldIds: patch.hiddenFieldIds ?? view.hiddenFieldIds,
				columnOrder: patch.columnOrder ?? view.columnOrder,
				collapsedKeys: patch.collapsedKeys ?? view.collapsedKeys,
				widths: patch.widths ?? view.widths,
				density: 'density' in patch ? (patch.density ?? null) : view.density,
				frozenPrimary:
					'frozenPrimary' in patch ? (patch.frozenPrimary ?? null) : view.frozenPrimary,
			};
			const inverseKeys: ViewPatch = {
				...('filter' in patch ? { filter: view.filter } : {}),
				...(patch.sorts !== undefined ? { sorts: view.sorts } : {}),
				...('groupBy' in patch ? { groupBy: view.groupBy } : {}),
				...(patch.hiddenFieldIds !== undefined
					? { hiddenFieldIds: view.hiddenFieldIds }
					: {}),
				...(patch.columnOrder !== undefined ? { columnOrder: view.columnOrder } : {}),
				...(patch.collapsedKeys !== undefined ? { collapsedKeys: view.collapsedKeys } : {}),
				...(patch.widths !== undefined ? { widths: view.widths } : {}),
				...('density' in patch ? { density: view.density } : {}),
				...('frozenPrimary' in patch ? { frozenPrimary: view.frozenPrimary } : {}),
			};
			const views = table.views.slice();
			views[index] = next;
			return accept(withTableList(document, tableIndex, { views }), {
				kind: 'update-view',
				tableId: operation.tableId,
				viewId: operation.viewId,
				patch: inverseKeys,
			});
		}

		case 'insert-view': {
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			if (!isInsertableIndex(operation.index, table.views.length)) {
				return refuse(
					'index-out-of-range',
					`Cannot insert a view at index ${String(operation.index)}.`,
				);
			}
			if (viewIndexOf(table, operation.view.id) !== undefined) {
				return refuse(
					'duplicate-id',
					`The table "${table.name}" already has a view "${operation.view.id}".`,
				);
			}
			const views = table.views.slice();
			views.splice(operation.index, 0, operation.view);
			return accept(withTableList(document, tableIndex, { views }), {
				kind: 'delete-view',
				tableId: operation.tableId,
				viewId: operation.view.id,
			});
		}

		case 'set-link': {
			const tableIndex = tableIndexOf(document, operation.tableId);
			const table = tableIndex === undefined ? undefined : document.tables[tableIndex];
			if (tableIndex === undefined || table === undefined) {
				return refuse(
					'no-such-table',
					`This database has no table "${operation.tableId}".`,
				);
			}
			const found = definitionAt(table, operation.fieldId);
			if (isRefusal(found)) {
				return found;
			}
			if (found.field.type !== 'link') {
				return refuse('not-a-link-field', `"${found.field.name}" is not a link column.`);
			}
			if (found.field.settings.generated === true) {
				// ADR-0001 §3: the inverse side is derived and never written.
				return refuse(
					'generated-field',
					`"${found.field.name}" is a generated inverse column; it is computed from the other side and never written.`,
				);
			}
			const targetTableId = found.field.settings.targetTableId;
			if (targetTableId === undefined) {
				return refuse('not-a-link-field', `"${found.field.name}" names no target table.`);
			}
			const target = rowIdsOf(document, targetTableId);
			if (target === undefined) {
				return refuse('unresolved-link', `This database has no table "${targetTableId}".`);
			}
			const unique = [...new Set(operation.rowIds)];
			if (unique.length !== operation.rowIds.length) {
				return refuse('unresolved-link', 'That list names the same record twice.');
			}
			if (unique.length > 1 && found.field.settings.allowMultiple !== true) {
				return refuse(
					'link-cardinality',
					`"${found.field.name}" holds one record, so the list must name one id or none.`,
				);
			}
			for (const rowId of unique) {
				if (!target.has(rowId)) {
					return refuse('unresolved-link', `"${targetTableId}" has no row "${rowId}".`);
				}
			}
			// The owning side is the only side that stores (ADR-0001 §2/§3); a single link is a bare
			// id, a multi link an ordered list, and `[]` clears the cell.
			const value: CellState =
				unique.length === 0
					? null
					: found.field.settings.allowMultiple === true
						? unique
						: (unique[0] ?? null);
			return applyOperation(document, {
				kind: 'set-cells',
				tableId: operation.tableId,
				rowId: operation.rowId,
				edits: [{ fieldId: operation.fieldId, value }],
			});
		}
	}
}

/**
 * Apply a list of operations as one unit.
 *
 * The list is applied in order; the first refusal stops everything and the original document is
 * returned untouched inside the refusal. The inverses come back in **undo order** — the reverse of
 * application order — so `applyOperations(document, result.inverses)` is the whole undo of one
 * logical action (a paste, an import, a delete-with-cleanup) in one call.
 */
export function applyOperations(
	document: DatabaseDocument,
	operations: readonly DatabaseOperation[],
): OperationsResult {
	let current = document;
	const collected: DatabaseOperation[] = [];
	for (const operation of operations) {
		const result = applyOperation(current, operation);
		if (!result.ok) {
			return result;
		}
		current = result.document;
		collected.push(...result.inverses);
	}
	return { ok: true, document: current, inverses: collected.slice().reverse() };
}
