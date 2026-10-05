/**
 * A stand-in for the store that does not exist yet.
 *
 * Step 16 wires the real `GridStore`; step 13's job is the migration *and its ops*. Those two things need a
 * place to be executed, and the honest one is a fake that does exactly what the future store will do for the
 * row-creating ops:
 *
 *  - `importBlock` creates the note at the op's own path, with frontmatter written by the **shipping** note
 *    writer (`adapters/notes/createNote.ts`), so a migrated note and a pasted row cannot drift apart;
 *  - `deleteRows` deletes those notes again — which is what makes the migration's inverse (`deleteRows`, per
 *    the op inventory) mean "the notes are gone";
 *  - every op also goes through the real reducer, so the state this fake reports is the core's own.
 *
 * This is a fake, not a mock: it uses the same functions the product uses, and it is imported by tests only.
 */
import { applyOp } from '../../src/core/ops/apply';
import type { Op, TableState } from '../../src/core/ops/types';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import { frontmatterBody, frontmatterFor } from '../../src/adapters/notes/createNote';
import type { CellValue } from '../../src/core/types';
import type { NoteVault } from '../../src/adapters/notes/createNote';
import type { FakeVault } from './vault';

export type NoteStore = {
	/** The core's state after every applied op. */
	readonly state: () => TableState;
	/** Notes this store created, in order. */
	readonly created: () => readonly string[];
	/** Notes this store deleted, in order. */
	readonly removed: () => readonly string[];
	readonly apply: (ops: readonly Op[]) => void;
};

/** The vault port `frontmatterFor` asks for and never uses: it reads values, and writes nothing itself. */
const UNUSED_VAULT: NoteVault = {
	has: () => false,
	hasFolder: () => true,
	create: () => Promise.resolve(),
};

export function createNoteStore(options: {
	readonly vault: FakeVault;
	readonly fields: readonly ResolvedField[];
}): NoteStore {
	let state: TableState = { fields: [], rows: [], view: {} };
	const created: string[] = [];
	const removed: string[] = [];

	const createNoteAt = (path: string, cells: Readonly<Record<string, CellValue>>): void => {
		if (options.vault.app.vault.getFileByPath(path) !== null) {
			return;
		}
		// The same two calls a created row uses: canonical values in, YAML out.
		const frontmatter = frontmatterFor({
			vault: UNUSED_VAULT,
			folder: '',
			template: '',
			values: cells,
			fields: options.fields,
		});
		options.vault.createNote(path, frontmatterBody(frontmatter));
		created.push(path);
	};

	return {
		state: () => state,
		created: () => [...created],
		removed: () => [...removed],

		apply(ops: readonly Op[]): void {
			for (const op of ops) {
				if (op.kind === 'importBlock') {
					for (const placed of op.rows) {
						createNoteAt(placed.row.filePath, placed.row.cells);
					}
				}
				if (op.kind === 'deleteRows') {
					for (const placed of op.rows) {
						const file = options.vault.app.vault.getFileByPath(placed.row.filePath);
						if (file !== null) {
							void options.vault.app.vault.delete(file);
							removed.push(placed.row.filePath);
						}
					}
				}
				state = applyOp(state, op).state;
			}
		},
	};
}
