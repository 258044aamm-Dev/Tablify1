/**
 * A `RowSource` that behaves like a real one and nothing more.
 *
 * It is a **fake**, not a mock: `apply` really does move the values it was handed into its own table, so a
 * test that reads a cell back after a write is reading the result of the write rather than an assertion about
 * a call count. What it deliberately does *not* do is notify on its own: a real adapter notifies because the
 * vault changed, and a test that wants the external-change path must ask for it (`notify()`), which is what
 * makes "an external change wins over a stale local snapshot" a test of the store rather than of the fake.
 *
 * Lives in `tests/fakes/` rather than `tests/dom/` because it imports `src/adapters` and `src/core` only —
 * the architecture rule forbids the files under `tests/` (other than `tests/dom/`) from reaching into
 * `src/grid`, so a fake that the grid's tests use must not know the grid exists. It does not: the port is
 * `RowSource`, which is the whole point of having one.
 */
import type { RowSource, ApplyResult, PropertySchema } from '../../src/adapters/RowSource';
import type { Op, RowId } from '../../src/core/ops/types';
import type { CellValue, PropertyId } from '../../src/core/types';
import type { ResolvedField } from '../../src/core/schema/propertySchema';

export type FakeRowSource = RowSource & {
	/** Rows in view order, as they are now. */
	readonly rows: () => readonly RowId[];
	/** The value the fake holds. Writes land here. */
	readonly value: (filePath: RowId, propertyId: PropertyId) => CellValue;
	/** How many `apply` calls there have been: one per queued batch. */
	readonly batches: () => readonly (readonly Op[])[];
	/** How many cells were written across every apply. */
	readonly written: () => number;
	/** The distinct files any apply touched, in first-touch order. */
	readonly filesTouched: () => readonly RowId[];
	/** Pretends the vault changed: what a real adapter does when a file is edited elsewhere. */
	readonly notify: () => void;
	/** Edits the fake's own table without telling anyone, then `notify()` reveals it. */
	readonly setQuietly: (filePath: RowId, propertyId: PropertyId, value: CellValue) => void;
	readonly addQuietly: (filePath: RowId, cells?: Record<PropertyId, CellValue>) => void;
	readonly removeQuietly: (filePath: RowId) => void;
	/** Makes the next apply refuse this row (a read-only column) — the `refused` half of `ApplyResult`. */
	readonly refuse: (filePath: RowId, propertyId: PropertyId, message: string) => void;
	/** Makes the next apply fail on this row — the `errors` half. */
	readonly failNext: (filePath: RowId, message: string) => void;
	readonly disposed: () => boolean;
};

export type FakeRowSourceOptions = {
	readonly fields: readonly ResolvedField[];
	readonly rows: readonly {
		readonly filePath: RowId;
		readonly cells: Record<PropertyId, CellValue>;
	}[];
	readonly writable?: boolean;
	readonly canCreateRows?: boolean;
	readonly canDeleteRows?: boolean;
};

/** One op's writes, in the shape `apply` needs to move them (the same mapping the store's overlay uses). */
function writesOf(ops: readonly Op[]): readonly {
	readonly filePath: RowId;
	readonly propertyId: PropertyId;
	readonly value: CellValue;
}[] {
	const out: { filePath: RowId; propertyId: PropertyId; value: CellValue }[] = [];
	for (const op of ops) {
		switch (op.kind) {
			case 'setCell':
				out.push({ filePath: op.filePath, propertyId: op.fieldId, value: op.value });
				break;
			case 'setCells':
				for (const write of op.writes) {
					out.push({
						filePath: write.filePath,
						propertyId: write.fieldId,
						value: write.value,
					});
				}
				break;
			case 'clearCells':
				for (const cell of op.cells) {
					out.push({ filePath: cell.filePath, propertyId: cell.fieldId, value: null });
				}
				break;
			case 'addRow':
				for (const [propertyId, value] of Object.entries(op.row.cells)) {
					out.push({ filePath: op.row.filePath, propertyId, value });
				}
				break;
			case 'importBlock':
				for (const placed of op.rows) {
					for (const [propertyId, value] of Object.entries(placed.row.cells)) {
						out.push({ filePath: placed.row.filePath, propertyId, value });
					}
				}
				break;
			default:
				break;
		}
	}
	return out;
}

export function createFakeRowSource(options: FakeRowSourceOptions): FakeRowSource {
	const writable = options.writable ?? true;
	const rows: RowId[] = options.rows.map((row) => row.filePath);
	const cells = new Map<RowId, Map<PropertyId, CellValue>>();
	for (const row of options.rows) {
		cells.set(row.filePath, new Map(Object.entries(row.cells)));
	}
	const schema: PropertySchema = { fields: options.fields };

	const listeners = new Set<() => void>();
	const batches: (readonly Op[])[] = [];
	const touched: RowId[] = [];
	let written = 0;
	let isDisposed = false;
	const refusals = new Map<RowId, { propertyId: PropertyId; message: string }>();
	const failures = new Map<RowId, string>();

	return {
		kind: 'tabula-file',
		writable,
		readonly: !writable,
		canCreateRows: options.canCreateRows ?? true,
		canDeleteRows: options.canDeleteRows ?? true,

		getSchema: (): PropertySchema => schema,

		getRows: (): readonly RowId[] => [...rows],

		getValue: (filePath: RowId, propertyId: PropertyId): CellValue =>
			cells.get(filePath)?.get(propertyId) ?? null,

		getRowLabel: (filePath: RowId): string => filePath,

		async apply(ops: readonly Op[]): Promise<ApplyResult> {
			batches.push(ops);
			const refused: {
				filePath: RowId;
				propertyId: PropertyId;
				reason: 'readonly-column' | 'not-writable';
				message: string;
			}[] = [];
			const errors: { path: RowId; propertyId?: PropertyId; message: string }[] = [];
			let landed = 0;
			for (const write of writesOf(ops)) {
				const refusal = refusals.get(write.filePath);
				if (refusal !== undefined) {
					refused.push({
						filePath: write.filePath,
						propertyId: refusal.propertyId,
						reason: 'readonly-column',
						message: refusal.message,
					});
					continue;
				}
				if (!writable) {
					refused.push({
						filePath: write.filePath,
						propertyId: write.propertyId,
						reason: 'not-writable',
						message: 'this source is read-only',
					});
					continue;
				}
				const failure = failures.get(write.filePath);
				if (failure !== undefined) {
					errors.push({
						path: write.filePath,
						propertyId: write.propertyId,
						message: failure,
					});
					continue;
				}
				const row = cells.get(write.filePath) ?? new Map<PropertyId, CellValue>();
				cells.set(write.filePath, row);
				if (!rows.includes(write.filePath)) {
					rows.push(write.filePath);
				}
				row.set(write.propertyId, write.value);
				landed += 1;
				if (!touched.includes(write.filePath)) {
					touched.push(write.filePath);
				}
			}
			// Refusals clear after one use: they model "this column is read-only", which a real source decides
			// per write, but a test wants to set one up without also setting up its removal.
			if (refused.length > 0) {
				refusals.clear();
			}
			if (errors.length > 0) {
				failures.clear();
			}
			written += landed;
			return {
				ok: errors.length === 0 && refused.length === 0,
				written: landed,
				files: [...new Set(writesOf(ops).map((write) => write.filePath))],
				refused,
				errors,
			};
		},

		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},

		async flush(): Promise<void> {
			/* Every apply lands synchronously: there is no queue behind this fake. */
		},

		dispose(): void {
			isDisposed = true;
			listeners.clear();
		},

		rows: () => [...rows],
		value: (filePath: RowId, propertyId: PropertyId): CellValue =>
			cells.get(filePath)?.get(propertyId) ?? null,
		batches: () => batches,
		written: () => written,
		filesTouched: () => [...touched],

		notify(): void {
			for (const listener of [...listeners]) {
				listener();
			}
		},

		setQuietly(filePath: RowId, propertyId: PropertyId, value: CellValue): void {
			const row = cells.get(filePath) ?? new Map<PropertyId, CellValue>();
			cells.set(filePath, row);
			row.set(propertyId, value);
		},

		addQuietly(filePath: RowId, rowCells?: Record<PropertyId, CellValue>): void {
			if (!rows.includes(filePath)) {
				rows.push(filePath);
			}
			cells.set(filePath, new Map(Object.entries(rowCells ?? {})));
		},

		removeQuietly(filePath: RowId): void {
			const index = rows.indexOf(filePath);
			if (index !== -1) {
				rows.splice(index, 1);
			}
			cells.delete(filePath);
		},

		refuse(filePath: RowId, propertyId: PropertyId, message: string): void {
			refusals.set(filePath, { propertyId, message });
		},

		failNext(filePath: RowId, message: string): void {
			failures.set(filePath, message);
		},

		disposed: () => isDisposed,
	};
}
