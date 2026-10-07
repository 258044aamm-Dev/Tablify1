/**
 * The provisional command seam — R2's minimal, id-addressed document algebra.
 *
 * R3 lands the full database-scoped operation model and its inverses (R3 guide, step 4). This file
 * exists so that until then the repository routes **every** mutation through a pure function with an
 * inverse, instead of letting the session — or worse, a view — edit a document object in place. The
 * surface is deliberately tiny: exactly what R2's acceptance needs (create → edit → close → reopen),
 * and deliberately **id-addressed**: table, row and field identity, never an index and never a path.
 *
 * Contract (the same one R3's operations will carry):
 *
 *   - `applyCommand(document, command)` returns a **new** document or a typed refusal; the input is
 *     never touched, and untouched tables/rows are shared by reference;
 *   - every accepted command returns the **inverse command** that puts the document back exactly as
 *     it was — for a cell that had no value, the inverse removes the key again;
 *   - a refusal is a value (`ok: false`), never a throw.
 */
import type { DatabaseDocument, DatabaseTable } from './schema';
import type { CellState, TableRow } from './rows';
import { encodeCell } from './values';

/** One requested change, addressed by identity. Plain data — it survives `structuredClone`. */
export type DocumentCommand =
	| { readonly kind: 'set-document-name'; readonly name: string }
	| { readonly kind: 'rename-table'; readonly tableId: string; readonly name: string }
	| {
			readonly kind: 'set-cell';
			readonly tableId: string;
			readonly rowId: string;
			readonly fieldId: string;
			/** `null` clears the cell; the key is removed, which is the one spelling of "no value". */
			readonly value: CellState;
	  };

/** Why a command was refused. A closed set, so a caller can branch without reading messages. */
export type CommandRefusalCode =
	| 'invalid-name'
	| 'no-change'
	| 'no-such-table'
	| 'no-such-row'
	| 'no-such-field'
	| 'cell-not-writable';

/** The verdict of one command: a new document with its inverse, or the reason it was refused. */
export type CommandResult =
	| {
			readonly ok: true;
			readonly document: DatabaseDocument;
			readonly inverse: DocumentCommand;
	  }
	| { readonly ok: false; readonly code: CommandRefusalCode; readonly message: string };

/** A name a document or a table may carry: non-empty after trimming, and nothing else. */
function isUsableName(name: unknown): name is string {
	return typeof name === 'string' && name.trim() !== '';
}

function refuse(code: CommandRefusalCode, message: string): CommandResult {
	return { ok: false, code, message };
}

/** A table plus its index, so a replacement can rebuild the list with one splice. */
function withTable(
	document: DatabaseDocument,
	index: number,
	table: DatabaseTable,
): DatabaseDocument {
	const tables = document.tables.slice();
	tables[index] = table;
	return { ...document, tables };
}

export function applyCommand(document: DatabaseDocument, command: DocumentCommand): CommandResult {
	switch (command.kind) {
		case 'set-document-name': {
			if (!isUsableName(command.name)) {
				return refuse('invalid-name', 'A database name cannot be empty.');
			}
			const previous = document.name;
			if (previous === command.name) {
				return refuse('no-change', 'The database already carries that name.');
			}
			return {
				ok: true,
				document: { ...document, name: command.name },
				inverse: { kind: 'set-document-name', name: previous },
			};
		}
		case 'rename-table': {
			if (!isUsableName(command.name)) {
				return refuse('invalid-name', 'A table name cannot be empty.');
			}
			const index = document.tables.findIndex((table) => table.id === command.tableId);
			const table = document.tables[index];
			if (index === -1 || table === undefined) {
				return refuse('no-such-table', `This database has no table "${command.tableId}".`);
			}
			if (table.name === command.name) {
				return refuse('no-change', `The table already carries the name "${command.name}".`);
			}
			const previous = table.name;
			return {
				ok: true,
				document: withTable(document, index, { ...table, name: command.name }),
				inverse: { kind: 'rename-table', tableId: command.tableId, name: previous },
			};
		}
		case 'set-cell': {
			const tableIndex = document.tables.findIndex((table) => table.id === command.tableId);
			const table = document.tables[tableIndex];
			if (tableIndex === -1 || table === undefined) {
				return refuse('no-such-table', `This database has no table "${command.tableId}".`);
			}
			const field = table.fields.find((candidate) => candidate.id === command.fieldId);
			if (field === undefined) {
				return refuse(
					'no-such-field',
					`The table "${table.name}" has no field "${command.fieldId}".`,
				);
			}
			if (field.kind !== 'field') {
				return refuse(
					'cell-not-writable',
					`The field "${command.fieldId}" is of a type this build does not read; its values are preserved as they are.`,
				);
			}
			const rowIndex = table.rows.findIndex((row) => row.id === command.rowId);
			const row = table.rows[rowIndex];
			if (rowIndex === -1 || row === undefined) {
				return refuse(
					'no-such-row',
					`The table "${table.name}" has no row "${command.rowId}".`,
				);
			}
			const writable = encodeCell(field.type, command.value);
			if (writable.kind === 'unwritable') {
				return refuse(
					'cell-not-writable',
					`The value cannot live in "${field.name}": ${writable.reason}.`,
				);
			}
			const previous = row.cells.get(command.fieldId);
			const cells = new Map(row.cells);
			if (writable.kind === 'omit') {
				cells.delete(command.fieldId);
			} else {
				cells.set(command.fieldId, command.value);
			}
			const nextRow: TableRow = { ...row, cells };
			const rows = table.rows.slice();
			rows[rowIndex] = nextRow;
			return {
				ok: true,
				document: withTable(document, tableIndex, { ...table, rows }),
				inverse: {
					kind: 'set-cell',
					tableId: command.tableId,
					rowId: command.rowId,
					fieldId: command.fieldId,
					value: previous ?? null,
				},
			};
		}
	}
}
