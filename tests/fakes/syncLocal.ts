/**
 * The local half of a sync, faked: **a map of notes, and a record of every apply.**
 *
 * `SyncLocalPort` is what the engine knows about the vault, the grid and Obsidian — five methods and no more — so
 * this double is small on purpose. It does four things the tests depend on:
 *
 *   · it applies `setCells` ops for real, so a pull's effect can be read back rather than asserted from the ops;
 *   · it counts applies, which is how *"one undo step"* becomes a number in a test (`applications.length === 1`);
 *   · it lets a test move a value **between** the plan and the apply, which is the only way to exercise the stale
 *     check honestly;
 *   · it reports `has()` truthfully after a note is removed, so a locally-deleted row reaches the diff as such.
 *
 * It also keeps the one detail the real ports differ on: property ids. A Bases view's ids are prefixed
 * (`note.Status`) while a bare vault read is not — the double takes the prefix as a parameter, so a test can pin
 * whichever the port under test would really use.
 */
import type { ApplyResult } from '../../src/adapters/RowSource';
import type { CellValue, PropertyId } from '../../src/core/types';
import type { Op } from '../../src/core/ops/types';
import type { SyncLocalPort, SyncLocalRow } from '../../src/sync/pullPush';

export type SyncLocalFake = SyncLocalPort & {
	/** The notes as they stand, values by local property name. Read it; use the methods below to change it. */
	readonly notes: Readonly<Record<string, Readonly<Record<string, CellValue>>>>;
	/** Every `apply` call, in order: the label of the undo step and the ops it carried. */
	readonly applications: readonly { readonly label: string; readonly ops: readonly Op[] }[];
	/** Every `rows()` call, which is how a test asserts the engine read the local side once. */
	readonly rowReads: number;
	/** Changes one cell as if a person typed it — the external change between a plan and an apply. */
	setValue(path: string, property: string, value: CellValue): void;
	/** Deletes a note, so `has()` answers `false` and the diff reports a local deletion. */
	remove(path: string): void;
	/** Adds a note that no record maps to — the "new local row" case. */
	addNote(path: string, label: string, values: Readonly<Record<string, CellValue>>): void;
};

export type SyncLocalFakeOptions = {
	/** Initial notes: path → property → canonical value. */
	readonly notes?: Readonly<Record<string, Readonly<Record<string, CellValue>>>>;
	/** Row labels; defaults to the file name without its extension. */
	readonly labels?: Readonly<Record<string, string>>;
	/** The id prefix an op must carry. `''` for a bare vault read; `note.` for a Bases view. */
	readonly prefix?: string;
	/** Rows `rows()` should not return, so a note can exist without being in the view. */
	readonly hidden?: readonly string[];
};

export function createSyncLocal(options: SyncLocalFakeOptions = {}): SyncLocalFake {
	const notes = new Map<string, Record<string, CellValue>>();
	for (const [path, values] of Object.entries(options.notes ?? {})) {
		notes.set(path, { ...values });
	}
	const labels = new Map(Object.entries(options.labels ?? {}));
	const prefix = options.prefix ?? 'note.';
	const hidden = new Set(options.hidden ?? []);
	const applications: { label: string; ops: readonly Op[] }[] = [];
	let rowReads = 0;

	const api: SyncLocalFake = {
		get notes() {
			return Object.fromEntries(
				[...notes.entries()].map(([path, values]) => [path, { ...values }]),
			);
		},
		get applications() {
			return applications;
		},
		get rowReads() {
			return rowReads;
		},
		rows(): Promise<readonly SyncLocalRow[]> {
			rowReads += 1;
			return Promise.resolve(
				[...notes.keys()]
					.filter((path) => !hidden.has(path))
					.map((path) => ({
						path,
						label:
							labels.get(path) ??
							(path.split('/').pop() ?? path).replace(/\.md$/, ''),
					})),
			);
		},
		has(path: string): Promise<boolean> {
			return Promise.resolve(notes.has(path));
		},
		values(path: string): Promise<Readonly<Record<string, CellValue>>> {
			return Promise.resolve({ ...(notes.get(path) ?? {}) });
		},
		propertyIdOf(property: string): PropertyId {
			return `${prefix}${property}`;
		},
		apply(action): Promise<ApplyResult> {
			applications.push({ label: action.label, ops: action.ops });
			let written = 0;
			const files: string[] = [];
			for (const op of action.ops) {
				if (op.kind !== 'setCells') {
					continue;
				}
				for (const write of op.writes) {
					// The op's field id comes back through the port's own prefix rule, exactly as the real ports
					// would have to undo it; a stray id is reported rather than written under a wrong name.
					const property = write.fieldId.startsWith(prefix)
						? write.fieldId.slice(prefix.length)
						: write.fieldId;
					const row = notes.get(write.filePath);
					if (row === undefined) {
						continue;
					}
					row[property] = write.value;
					written += 1;
					if (!files.includes(write.filePath)) {
						files.push(write.filePath);
					}
				}
			}
			return Promise.resolve({ ok: true, written, files, refused: [], errors: [] });
		},
		setValue(path, property, value) {
			const row = notes.get(path);
			if (row === undefined) {
				throw new Error(`the fake local has no note at "${path}"`);
			}
			row[property] = value;
		},
		remove(path) {
			notes.delete(path);
		},
		addNote(path, label, values) {
			notes.set(path, { ...values });
			labels.set(path, label);
		},
	};
	return api;
}
