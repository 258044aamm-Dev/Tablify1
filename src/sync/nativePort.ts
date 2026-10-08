/**
 * The sync port for a **native table** (R5 Part C, Step 4).
 *
 * The engine (`pullPush.ts`) speaks `SyncLocalPort`, whose two identifiers are the note path and the property name.
 * This adapter keeps that contract exactly and changes only what the identifiers *mean*: the **path is the local row
 * ID**, and the **property is the local field ID**. Field identity therefore survives a rename, and a row survives
 * a reorder. The engine, the legacy Bases port and the conflict UI are not touched.
 *
 * ## Rules this port enforces
 *
 * - **Link fields are not synced in this version (Step 5, first slice).** A link cell holds record IDs, and the
 *   planner's shape-based conversion would write them as text. So link fields are left out of {@link NativeSyncPort.syncFields}
 *   and named in {@link NativeSyncPort.excludedFields}, so the UI can say so. A write aimed at one is refused.
 * - **Read-only fields are not written.** A computed or system column is pulled as nothing and refused on write.
 * - **All or nothing per apply.** Every write is validated before the first is dispatched. If any is refused, nothing
 *   is dispatched, so the store never holds half a pull. Once validated, the whole batch is one dispatch and so one
 *   undo step.
 * - **Invalid cells are absent.** A cell the file could not read is not offered to the engine as a value.
 *
 * No provider names appear here. The remote mapping lives in the link file, not in this port.
 */
import { resolveField } from '../core/schema/propertySchema';
import type { PropertyDefinition, ResolvedField } from '../core/schema/propertySchema';
import type { DatabaseOperation } from '../core/database/operations';
import type { NativeExportEnvironment } from '../core/database/export/nativeMatrix';
import { optionsOf } from '../core/database/export/nativeMatrix';
import type { ActiveTableSnapshot } from '../core/database/projection';
import { projectTable, viewCellOf } from '../core/database/projection';
import { isInvalidCell } from '../core/database/values';
import type { FieldContext, FieldTypeId } from '../core/types';
import { isFieldTypeId } from '../core/types';
import type { DatabaseStore } from '../adapters/tablifyFile/databaseStore';
import type { ApplyError, Refusal } from '../adapters/RowSource';
import type { CellWrite, Op } from '../core/ops/types';
import type { CellValue } from '../core/types';
import type { SyncLocalPort } from './pullPush';

/** A field this port will not sync, and why. The reason is one sentence the UI can show. */
export type ExcludedField = {
	readonly fieldId: string;
	readonly name: string;
	readonly reason: string;
};

export type NativeSyncPort = SyncLocalPort & {
	/** The writable, supported fields, each named by its field ID. Pass these to `planSync` as `fields`. */
	syncFields(): readonly ResolvedField[];
	/** The fields left out, with the reason. Shown to the user, never silently dropped. */
	excludedFields(): readonly ExcludedField[];
	/** The visible column name for a field ID, for messages. Never used as a key. */
	columnNameOf(fieldId: string): string | null;
};

export type NativePortOptions = {
	readonly store: DatabaseStore;
	readonly tableId: string;
	readonly environment: NativeExportEnvironment;
};

function isSetCellsOp(op: Op): op is Extract<Op, { kind: 'setCells' }> {
	return op.kind === 'setCells';
}

function isWritableType(type: string): type is FieldTypeId {
	return isFieldTypeId(type);
}

/** The table at this moment, or `null` when the table has gone. Read each time: the store is live. */
function currentTable(store: DatabaseStore, tableId: string): ActiveTableSnapshot | null {
	return projectTable(store.getSnapshot().document, tableId);
}

/** The fields the engine may sync, and the ones it may not, computed from one snapshot. */
function classify(
	snapshot: ActiveTableSnapshot,
	environment: NativeExportEnvironment,
): { readonly fields: readonly ResolvedField[]; readonly excluded: readonly ExcludedField[] } {
	const fields: ResolvedField[] = [];
	const excluded: ExcludedField[] = [];
	for (const stored of snapshot.fields) {
		if (stored.kind !== 'field' || stored.id === null || stored.name === null) {
			excluded.push({
				fieldId: stored.id ?? '',
				name: stored.name ?? '',
				reason: 'This field type is not supported yet.',
			});
			continue;
		}
		if (stored.type === 'link') {
			excluded.push({
				fieldId: stored.id,
				name: stored.name,
				reason: 'Linked records are not synced yet. The link is left as it is.',
			});
			continue;
		}
		if (!isWritableType(stored.type)) {
			excluded.push({
				fieldId: stored.id,
				name: stored.name,
				reason: 'This field type is not supported yet.',
			});
			continue;
		}
		const fieldOptions = optionsOf(stored);
		const definition: PropertyDefinition = {
			id: stored.id,
			// The engine keys by this name, so it is the stable field ID, never the display name.
			name: stored.id,
			source: 'database',
			fieldOptions,
		};
		const context: FieldContext = {
			now: environment.now,
			timezone: environment.timezone,
			locale: environment.locale,
			fieldOptions,
			columnName: stored.name,
		};
		const resolved = resolveField(definition, context);
		if (resolved.readOnly) {
			excluded.push({
				fieldId: stored.id,
				name: stored.name,
				reason: 'This field is read-only, so it is not written.',
			});
			continue;
		}
		fields.push(resolved);
	}
	return { fields, excluded };
}

/**
 * An empty string or an empty list is **no value** at the sync boundary. The core keeps `""` as a real value
 * (ADR-0004), but a provider cannot hold an empty text: a cleared field is simply absent there. Treating both the
 * same way keeps a cleared cell from showing up as a difference on every sync. The stored cell is not changed.
 */
function isSyncEmpty(cell: CellValue): boolean {
	return cell === '' || (Array.isArray(cell) && cell.length === 0);
}

/** The label a row carries in the engine's messages: the first text value, or the row ID when there is none. */
function labelOf(snapshot: ActiveTableSnapshot, rowId: string): string {
	for (const field of snapshot.fields) {
		if (field.kind !== 'field' || field.id === null || field.type !== 'text') {
			continue;
		}
		const cell = viewCellOf(snapshot, rowId, field.id);
		if (
			cell !== undefined &&
			!isInvalidCell(cell) &&
			typeof cell === 'string' &&
			cell.trim() !== ''
		) {
			return cell;
		}
	}
	return rowId;
}

/**
 * Builds the port. The table is read on every call, so an edit made elsewhere is seen at once and a deleted table
 * reads as empty rather than throwing.
 */
export function createNativeSyncPort(options: NativePortOptions): NativeSyncPort {
	const { store, tableId, environment } = options;

	const port: NativeSyncPort = {
		async rows() {
			const snapshot = currentTable(store, tableId);
			if (snapshot === null) {
				return [];
			}
			return snapshot.rows.map((row) => ({ path: row.id, label: labelOf(snapshot, row.id) }));
		},

		async has(path: string) {
			const snapshot = currentTable(store, tableId);
			return snapshot !== null && snapshot.rowById.has(path);
		},

		async values(path: string) {
			const snapshot = currentTable(store, tableId);
			const out: Record<string, CellValue> = {};
			if (snapshot === null) {
				return out;
			}
			const { fields } = classify(snapshot, environment);
			for (const field of fields) {
				const cell = viewCellOf(snapshot, path, field.definition.name);
				if (cell !== undefined && !isInvalidCell(cell) && !isSyncEmpty(cell)) {
					out[field.definition.name] = cell;
				}
			}
			return out;
		},

		propertyIdOf(property: string) {
			return property;
		},

		async apply(action) {
			const snapshot = currentTable(store, tableId);
			const refused: Refusal[] = [];
			const errors: ApplyError[] = [];
			if (snapshot === null) {
				errors.push({ path: tableId, message: 'The table is no longer in this database.' });
				return { ok: false, written: 0, files: [], refused, errors };
			}
			const { fields } = classify(snapshot, environment);
			const writable = new Set(fields.map((field) => field.definition.name));

			const writes: CellWrite[] = [];
			for (const op of action.ops) {
				if (!isSetCellsOp(op)) {
					errors.push({
						path: tableId,
						message: `The operation “${op.kind}” is not supported for a native table.`,
					});
					continue;
				}
				for (const write of op.writes) {
					if (!writable.has(write.fieldId)) {
						refused.push({
							filePath: write.filePath,
							propertyId: write.fieldId,
							reason: 'readonly-column',
							message: 'This field cannot be written from a sync.',
						});
						continue;
					}
					writes.push(write);
				}
			}
			if (refused.length > 0 || errors.length > 0) {
				// All or nothing: a refused or unsupported write stops the batch before anything is dispatched.
				return { ok: false, written: 0, files: [], refused, errors };
			}

			const byRow = new Map<string, { fieldId: string; value: CellValue }[]>();
			for (const write of writes) {
				const edits = byRow.get(write.filePath) ?? [];
				edits.push({ fieldId: write.fieldId, value: write.value });
				byRow.set(write.filePath, edits);
			}
			const batch: DatabaseOperation[] = [];
			for (const [rowId, edits] of byRow) {
				batch.push({
					kind: 'set-cells',
					tableId,
					rowId,
					edits: edits.map((edit) => ({ fieldId: edit.fieldId, value: edit.value })),
				});
			}
			if (batch.length === 0) {
				return { ok: true, written: 0, files: [], refused, errors };
			}
			const result = store.dispatch(batch, action.label);
			if (!result.ok) {
				errors.push({ path: tableId, message: result.message });
				return { ok: false, written: 0, files: [], refused, errors };
			}
			return {
				ok: true,
				written: writes.length,
				files: [...byRow.keys()],
				refused,
				errors,
			};
		},

		syncFields() {
			const snapshot = currentTable(store, tableId);
			return snapshot === null ? [] : classify(snapshot, environment).fields;
		},

		excludedFields() {
			const snapshot = currentTable(store, tableId);
			return snapshot === null ? [] : classify(snapshot, environment).excluded;
		},

		columnNameOf(fieldId: string) {
			const snapshot = currentTable(store, tableId);
			return snapshot?.fieldById.get(fieldId)?.name ?? null;
		},
	};
	return port;
}
