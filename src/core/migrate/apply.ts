/**
 * The migration, as ordinary operations.
 *
 * `docs/03-data-model-and-migration.md` §Migration step 4: on confirm, create the notes and write the `.base`.
 * The design decision this file implements is that a migration is **not** a special path: it is one
 * `importBlock` per table (the same op a 400-cell paste produces), one `setFieldOptions` per column that has
 * options, and one `setViewConfig` per table's view. The store pushes them as a **single command**, so the
 * whole migration is one undo step, and the notes go out through the same write queue as an edited cell.
 *
 * Three things this file deliberately does not do:
 *
 *  - **It never touches the `.tabula` file.** The source is read-only input; the ops carry new note paths and
 *    nothing else. The test asserts the source's bytes are unchanged after a full apply and undo.
 *  - **It never names a path itself.** `target.pathFor` does, because sanitising and de-duplicating filenames
 *    belongs to `adapters/notes/createNote.ts` — one owner for one rule. `dryRun` reports the *names*.
 *  - **It never stores a read-only column.** `createdTime`/`lastModifiedTime` become `file.*` columns whose
 *    values come from the file's own metadata, and `autoNumber` has no column at all; both are reported by the
 *    dry run rather than written.
 */
import type { CellValue, FieldOptions, PropertyId } from '../types';
import type { Op } from '../ops/types';
import type { TabulaField, TabulaRow, TabulaTable } from '../../adapters/tabulaFile/model';
import { fieldOptionsFor, toFieldDescriptors } from '../../adapters/tabulaFile/model';
import type { MigrationReport, MigrationTarget, TablePlan } from './dryRun';
import type { TabulaDoc } from '../../adapters/tabulaFile/model';

/** One note the migration creates: where it goes, and the canonical values it carries. */
export type MigratedNote = {
	readonly tableId: string;
	readonly rowId: string;
	readonly path: string;
	/** Canonical values, keyed by prefixed Bases property id (`note.Status`) — the same keys a row has. */
	readonly cells: Readonly<Record<PropertyId, CellValue>>;
	/** What the note is called, before sanitising: the primary column's text, or `Row 3`. */
	readonly name: string;
};

/** The property id a stored column writes to. */
function propertyIdOf(plan: TablePlan, fieldId: string): PropertyId | null {
	const column = plan.columns.find((candidate) => candidate.fieldId === fieldId);
	if (column === undefined || column.to === null || !column.stored) {
		return null;
	}
	return `note.${column.propertyName}`;
}

/**
 * One legacy cell as a canonical value for its destination column.
 *
 * The rules are the shapes `docs/03` §field type mapping lists, applied to what the legacy file actually
 * contains: option **ids** become option **labels** (and an orphan keeps its raw value, so a value the fork
 * would have blanked survives as text); a list stays a list; a number stays a number. A value whose shape the
 * destination cannot hold is kept as it is — `dryRun` counted it in `shapeProblems`, and inventing a
 * conversion here is how a migration loses data quietly.
 */
export function canonicalCell(field: TabulaField, target: string, value: unknown): CellValue {
	switch (target) {
		case 'singleSelect': {
			if (typeof value !== 'string') {
				return null;
			}
			return labelOf(field, value);
		}
		case 'multiSelect':
		case 'attachment': {
			if (Array.isArray(value)) {
				return value.map((entry) =>
					typeof entry === 'string' ? labelOf(field, entry) : String(entry),
				);
			}
			if (typeof value === 'string') {
				return target === 'attachment' ? value : labelOf(field, value);
			}
			return null;
		}
		default: {
			if (value === undefined || value === null) {
				return null;
			}
			if (
				typeof value === 'string' ||
				typeof value === 'number' ||
				typeof value === 'boolean'
			) {
				return value;
			}
			if (Array.isArray(value)) {
				return value.map((entry) => (typeof entry === 'string' ? entry : String(entry)));
			}
			return null;
		}
	}
}

/** An option id → its label; an id with no option stays the string it is, never becoming empty. */
function labelOf(field: TabulaField, id: string): string {
	return field.options.find((option) => option.id === id)?.name ?? id;
}

/** The note one row becomes. `ordinal` is 1-based and used only for the `Row <n>` fallback name. */
function noteFor(
	table: TabulaTable,
	plan: TablePlan,
	row: TabulaRow,
	index: number,
	tableIndex: number,
	target: MigrationTarget,
): MigratedNote {
	const cells: Record<PropertyId, CellValue> = {};
	for (const mapping of toFieldDescriptors(table)) {
		if (mapping.target === null || !mapping.stored) {
			continue;
		}
		const propertyId = propertyIdOf(plan, mapping.field.id);
		if (propertyId === null) {
			continue;
		}
		const value = canonicalCell(mapping.field, mapping.target, row.cells[mapping.field.id]);
		if (value !== null) {
			cells[propertyId] = value;
		}
	}
	const primary =
		plan.primaryFieldId === null
			? undefined
			: table.fields.find((field) => field.id === plan.primaryFieldId);
	const primaryValue =
		primary === undefined
			? ''
			: String(canonicalCell(primary, 'text', row.cells[primary.id]) ?? '').trim();
	const ordinal = index + 1;
	const name = primaryValue === '' ? `Row ${String(ordinal)}` : primaryValue;
	return {
		tableId: table.id,
		rowId: row.id,
		path: target.pathFor({ table, tableIndex, rowId: row.id, ordinal, primaryValue }),
		cells,
		name,
	};
}

/**
 * Every note a migration creates, in table order then row order. Exported because the two questions a caller
 * asks before writing are "how many notes" (the report) and "which paths" (this), and a test can then assert
 * that the ops carry exactly these paths.
 */
export function migrationNotes(
	doc: TabulaDoc,
	report: MigrationReport,
	target: MigrationTarget,
): readonly MigratedNote[] {
	const notes: MigratedNote[] = [];
	doc.tables.forEach((table, tableIndex) => {
		const plan = report.tables[tableIndex];
		if (plan === undefined) {
			return;
		}
		table.rows.forEach((row, index) => {
			notes.push(noteFor(table, plan, row, index, tableIndex, target));
		});
	});
	return notes;
}

/** The `fieldOptions` payload for every column of a table that needs one, keyed by property id. */
function fieldOptionsByProperty(
	table: TabulaTable,
	plan: TablePlan,
): ReadonlyMap<PropertyId, FieldOptions> {
	const result = new Map<PropertyId, FieldOptions>();
	for (const mapping of toFieldDescriptors(table)) {
		const propertyId = propertyIdOf(plan, mapping.field.id);
		if (propertyId === null) {
			continue;
		}
		const options = fieldOptionsFor(mapping);
		if (options !== null) {
			result.set(propertyId, options);
		}
	}
	return result;
}

/**
 * The migration. One `importBlock` per table, one `setFieldOptions` per column with options, one
 * `setViewConfig` per table's view — in that order, so a store that applies ops in sequence ends with the
 * view config last and cannot read a column it has not created yet.
 *
 * `previous` values are empty because a migration writes into a **fresh** base view: there is no earlier
 * setting to restore, and a non-empty `previous` would make undo restore a config the user never had.
 */
export function migrateMutation(
	doc: TabulaDoc,
	report: MigrationReport,
	target: MigrationTarget,
): readonly Op[] {
	const ops: Op[] = [];
	doc.tables.forEach((table, tableIndex) => {
		const plan = report.tables[tableIndex];
		if (plan === undefined) {
			return;
		}
		const notes = migrationNotes(doc, report, target).filter(
			(note) => note.tableId === table.id,
		);
		if (notes.length > 0) {
			ops.push({
				kind: 'importBlock',
				rows: notes.map((note, index) => ({
					at: index,
					row: { filePath: note.path, cells: note.cells },
				})),
			});
		}
		for (const [propertyId, options] of fieldOptionsByProperty(table, plan)) {
			ops.push({ kind: 'setFieldOptions', fieldId: propertyId, from: {}, to: options });
		}
		const changes = plan.view.applied;
		if (Object.keys(changes).length > 0) {
			ops.push({ kind: 'setViewConfig', changes, previous: {} });
		}
	});
	return ops;
}

/** The command label the undo menu shows. One label for the whole migration, because it is one step. */
export function migrationLabel(report: MigrationReport): string {
	const notes = report.totals.notesToCreate;
	const tables = report.totals.tables;
	return `Migrate ${String(notes)} note${notes === 1 ? '' : 's'} from ${String(tables)} table${
		tables === 1 ? '' : 's'
	}`;
}
