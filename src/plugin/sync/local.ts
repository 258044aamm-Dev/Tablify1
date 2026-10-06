/**
 * The local half of a sync, for real: **a Bases view when there is one, the vault when there is not.**
 *
 * `SyncLocalPort` is five methods wide, and this file is the two ways they get answered. The distinction is not
 * cosmetic — it decides what *"one undo step"* can mean:
 *
 * | Situation | What the port is | The undo step |
 * |---|---|---|
 * | The linked view is open | the **grid store** (step 16) | `dispatch({label, ops})` — one history entry, one write-queue batch, and `Cmd+Z` reverses it |
 * | No view open, or a view from another pane | the **vault**, through `BasesSource` | `source.apply(ops)` — one queue batch; the panel offers *"Undo pull"* with the inverse ops, because there is no history stack to push onto |
 *
 * The second row is the honest limitation: undoing a pull with no view open is an **explicit action** rather than
 * `Cmd+Z`, because the history lives in the store and the store lives in the view. Saying that in a table is better
 * than pretending the two cases are the same.
 *
 * Values are read **from the source**, not re-parsed from frontmatter here: `BasesSource.getValue` is already the
 * canonical value, and a second reader would be a second interpretation of the same YAML.
 */
import type { BasesSource } from '../../adapters/bases/BasesSource';
import type { GridStore } from '../../grid/store/types';
import type { CellValue, PropertyId } from '../../core/types';
import type { ApplyResult, RowSource } from '../../adapters/RowSource';
import type { Op } from '../../core/ops/types';
import type { SyncLocalPort, SyncLocalRow } from '../../sync/pullPush';

/** What a pull wants back: the port, and the count of how it applied. */
export type LocalSurface = {
	readonly port: SyncLocalPort;
	/** `'grid'` when the view is open and the undo step is real; `'vault'` when it is only a queue batch. */
	readonly kind: 'grid' | 'vault';
};

/**
 * The port over a **grid store**: the open-view case, where "one undo step" is a history entry.
 *
 * `propertyIdOf` is the one thing the store cannot answer — the table holds ids, not names — so it is injected. The
 * caller passes the mapping it already has from the same schema the grid is rendering, and a property id this map
 * does not know is a **prefixed id equal to the name**, which is what a bare note property is anyway.
 */
export function gridLocalPort(input: {
	readonly store: GridStore;
	readonly source: RowSource;
	readonly propertyIds?: Readonly<Record<string, PropertyId>> | undefined;
}): SyncLocalPort {
	return {
		rows(): Promise<readonly SyncLocalRow[]> {
			const { rows, fields } = input.store.getSnapshot();
			const labelField = fields.find(
				(field) => field.definition.name === 'title' || field.definition.name === 'Title',
			);
			return Promise.resolve(
				rows.map((path) => ({
					path,
					label:
						labelField === undefined
							? (path.split('/').pop() ?? path).replace(/\.md$/, '')
							: String(input.source.getValue(path, labelField.definition.id) ?? path),
				})),
			);
		},
		has(path) {
			return Promise.resolve(input.source.getRows().includes(path));
		},
		values(path): Promise<Readonly<Record<string, CellValue>>> {
			const { fields } = input.store.getSnapshot();
			const values: Record<string, CellValue> = {};
			for (const field of fields) {
				values[field.definition.name] = input.source.getValue(path, field.definition.id);
			}
			return Promise.resolve(values);
		},
		propertyIdOf(property) {
			return input.propertyIds?.[property] ?? property;
		},
		async apply(action): Promise<ApplyResult> {
			// One `dispatch`: the store applies the ops, records one history entry, and hands the queue one batch.
			input.store.dispatch({ label: action.label, ops: action.ops });
			await input.store.flush();
			const snapshot = input.store.getSnapshot();
			const last = snapshot.lastApply;
			return (
				last ?? {
					ok: true,
					written: 0,
					files: [],
					refused: [],
					errors:
						snapshot.lastError === null
							? []
							: [{ path: '', message: snapshot.lastError }],
				}
			);
		},
	};
}

/**
 * The port over a **bare source**: no view, so no history — one queue batch, and an undo the caller keeps the ops
 * for. That is what `plugin/sync/host.ts` does when it offers *"Undo pull"*.
 */
export function sourceLocalPort(input: {
	readonly source: BasesSource;
	readonly propertyIds?: Readonly<Record<string, PropertyId>> | undefined;
}): SyncLocalPort {
	const schema = input.source.getSchema().fields;
	const byName = new Map(schema.map((field) => [field.definition.name, field.definition.id]));
	return {
		rows(): Promise<readonly SyncLocalRow[]> {
			return Promise.resolve(
				input.source
					.getRows()
					.map((path) => ({ path, label: input.source.getRowLabel(path) })),
			);
		},
		has(path): Promise<boolean> {
			return Promise.resolve(input.source.getRows().includes(path));
		},
		values(path): Promise<Readonly<Record<string, CellValue>>> {
			const values: Record<string, CellValue> = {};
			for (const field of schema) {
				values[field.definition.name] = input.source.getValue(path, field.definition.id);
			}
			return Promise.resolve(values);
		},
		propertyIdOf(property) {
			return input.propertyIds?.[property] ?? byName.get(property) ?? property;
		},
		apply(action): Promise<ApplyResult> {
			return input.source.apply(action.ops);
		},
	};
}

/** One `setCells` op per distinct cell, so a caller that has loose writes can build an op list without duplicates. */
export function setCellsOp(
	writes: readonly {
		readonly filePath: string;
		readonly fieldId: PropertyId;
		readonly value: CellValue;
	}[],
): Op[] {
	if (writes.length === 0) {
		return [];
	}
	return [{ kind: 'setCells', writes: [...writes] }];
}
