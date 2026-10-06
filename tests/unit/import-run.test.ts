/**
 * The runner: **412 notes, 150 on a cancel, one bad row, and one undo step.**
 *
 * The four claims the step asks to be proven, in order: a 412-row import creates exactly 412 notes with the
 * frontmatter the plan computed; cancelling after 150 reports 150 and leaves nothing unreported; a failing create
 * on row 200 is reported per file and the rest still land; the whole run is one undo step and undoing it removes
 * exactly those files.
 *
 * The vault is the repo's fake (`tests/fakes/vault.ts`), wrapped in the two narrow ports the runner needs. The
 * chunk boundary is driven by an injected `yieldTo` so the 412-row run is fast and deterministic — the shipped
 * default is a real macrotask, and `tests/unit/import-run.test.ts` asserts the *shape* of the yield (once per
 * chunk) rather than its timing.
 */
import { describe, expect, it } from 'vitest';
import { buildPlan, noteIdFor } from '../../src/core/import/plan';
import type {
	ImportOptions,
	ImportPlan,
	PlannedColumn,
	PlanEnvironment,
} from '../../src/core/import/plan';
import { inferColumns } from '../../src/core/import/preview';
import { frontmatterBody } from '../../src/adapters/notes/createNote';
import {
	CHUNK,
	createImportHistory,
	progressText,
	runImport,
	undoImport,
	undoMessage,
} from '../../src/plugin/import/runImport';
import type { TrashVault } from '../../src/plugin/import/runImport';
import { resolveField } from '../../src/core/schema/propertySchema';
import type { Matrix } from '../../src/core/selection/clipboard';
import type { FieldTypeId } from '../../src/core/types';
import { createFakeClock } from '../fakes/clock';
import { createFakeVault } from '../fakes/vault';
import type { FakeVault, FakeVaultApi } from '../fakes/vault';

const CONTEXT = {
	path: '',
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
};

/** A matrix of `rows` rows and six columns, shaped like a real sheet: a name, a status, numbers and a date. */
function sheet(rows: number): Matrix {
	const header = ['Name', 'Status', 'Budget', 'Due', 'Notes', 'Owner'];
	const statuses = ['Todo', 'Doing', 'Done'];
	const body = Array.from({ length: rows }, (_unused, index) => [
		`Row ${String(index + 1)}`,
		statuses[index % statuses.length] ?? 'Todo',
		String((index + 1) * 10),
		`2026-03-${String((index % 28) + 1).padStart(2, '0')}`,
		`note number ${String(index + 1)}`,
		`person-${String(index % 5)}`,
	]);
	return [header, ...body];
}

/** The fields for a six-column sheet, by index — the same ids `plan.ts` writes to. */
function fieldsFor(types: readonly FieldTypeId[], names: readonly string[]) {
	return types.map((type, index) =>
		resolveField(
			// `fieldOptions.type` is where a type is read from; see `src/plugin/import/host.ts`.
			{
				id: noteIdFor(index),
				name: names[index] ?? `Column ${String(index + 1)}`,
				source: 'note',
				fieldOptions: { type },
			},
			{ ...CONTEXT, columnName: names[index] ?? '' },
		),
	);
}

type Harness = {
	readonly vault: FakeVault;
	readonly api: FakeVaultApi;
	readonly plan: ImportPlan;
	readonly trashLog: string[];
	readonly trashPort: TrashVault;
};

/** One plan over `rows` rows of the sheet, plus the vault it will write into. */
function harness(rows: number, options?: { readonly existing?: readonly string[] }): Harness {
	const vault = createFakeVault({ clock: createFakeClock() });
	const api = vault.app.vault;
	const matrix = sheet(rows);
	const names = ['Name', 'Status', 'Budget', 'Due', 'Notes', 'Owner'];
	const types: readonly FieldTypeId[] = [
		'text',
		'singleSelect',
		'number',
		'date',
		'text',
		'text',
	];
	const inferred = inferColumns(matrix, true);
	const columns: PlannedColumn[] = inferred.columns.map((column) => ({
		index: column.index,
		name: names[column.index] ?? column.name,
		type: types[column.index] ?? 'text',
		inference: column,
		included: true,
	}));
	const environment: PlanEnvironment = {
		has: (path) => api.getFileByPath(path) !== null,
		hasFolder: () => true,
		fields: fieldsFor(types, names),
	};
	for (const path of options?.existing ?? []) {
		vault.seedNote(path, {}, '');
	}
	const planOptions: ImportOptions = {
		columns,
		hasHeader: true,
		folder: 'Rows',
		template: '{{Name}}',
	};
	const trashLog: string[] = [];
	const trashPort: TrashVault = {
		has: (path) => api.getFileByPath(path) !== null,
		trash: async (path) => {
			const file = api.getFileByPath(path);
			if (file !== null) {
				await api.delete(file);
				trashLog.push(path);
			}
		},
	};
	return { vault, api, plan: buildPlan(matrix, planOptions, environment), trashLog, trashPort };
}

/** A yield that counts its calls, so the chunk boundary is asserted rather than timed. */
function countingYield(): { readonly yieldTo: () => Promise<void>; readonly calls: number[] } {
	const calls: number[] = [];
	return {
		yieldTo: async () => {
			calls.push(calls.length + 1);
		},
		calls,
	};
}

describe('runImport', () => {
	it('creates exactly one note per planned row, with the plan’s frontmatter and no path of its own', async () => {
		const { plan, api, vault } = harness(412);
		const summary = await runImport({
			plan,
			vault: {
				has: (path) => api.getFileByPath(path) !== null,
				hasFolder: () => true,
				create: async (path, content) => {
					await api.create(path, content);
				},
			},
			yieldTo: async () => undefined,
		});

		expect(summary.created).toHaveLength(412);
		expect(summary.failures).toEqual([]);
		expect(summary.cancelled).toBe(false);
		expect(summary.ok).toBe(true);
		expect(summary.progress).toBe('created 412 of 412');
		// Creation order is the plan's order, top to bottom — the order undo reverses.
		expect(summary.created).toEqual(plan.notes.map((note) => note.path));
		expect(summary.created[0]).toBe('Rows/Row 1.md');
		expect(summary.created[411]).toBe('Rows/Row 412.md');

		// The frontmatter is the plan's, written through `createNote`'s own serialiser.
		expect(api.getFileByPath('Rows/Row 1.md')?.path).toBe('Rows/Row 1.md');
		expect(vault.frontmatterOf('Rows/Row 1.md')).toEqual({
			Name: 'Row 1',
			Status: 'Todo',
			Budget: 10,
			Due: '2026-03-01',
			Notes: 'note number 1',
			Owner: 'person-0',
		});
		// The bytes the note was created with are `frontmatterBody`'s, in the plan's column order. (The fake vault
		// re-serialises with JSON when it is read back, so this is asserted on the serialiser, not on `read`.)
		expect(frontmatterBody(plan.notes[0]?.frontmatter ?? {})).toBe(
			'---\nName: Row 1\nStatus: Todo\nBudget: 10\nDue: 2026-03-01\nNotes: note number 1\nOwner: person-0\n---\n',
		);
		// …and the 412th note exists too: nothing stopped early.
		expect(api.getFileByPath('Rows/Row 412.md')).not.toBeNull();
	});

	it('yields once per chunk and never inside one, so a chunk is the unit of work', async () => {
		const { plan, api } = harness(60);
		const { yieldTo, calls } = countingYield();
		await runImport({
			plan,
			vault: {
				has: (path) => api.getFileByPath(path) !== null,
				hasFolder: () => true,
				create: async (path, content) => {
					await api.create(path, content);
				},
			},
			yieldTo,
		});
		// 60 notes, 25 per chunk: two boundaries (before #26 and before #51), never before #1.
		expect(calls).toHaveLength(Math.floor((60 - 1) / CHUNK));
		expect(CHUNK).toBe(25);
	});

	it('reports progress as it goes, ending on the total', async () => {
		const { plan, api } = harness(60);
		const seen: string[] = [];
		await runImport({
			plan,
			vault: {
				has: (path) => api.getFileByPath(path) !== null,
				hasFolder: () => true,
				create: async (path, content) => {
					await api.create(path, content);
				},
			},
			yieldTo: async () => undefined,
			onProgress: (created, total) => {
				seen.push(progressText(created, total));
			},
		});
		expect(seen[0]).toBe('created 0 of 60');
		expect(seen).toContain('created 25 of 60');
		expect(seen).toContain('created 50 of 60');
		expect(seen[seen.length - 1]).toBe('created 60 of 60');
	});

	it('stops at a chunk boundary on cancel, and reports exactly what was created', async () => {
		const { plan, api, vault } = harness(412);
		let created = 0;
		const summary = await runImport({
			plan,
			vault: {
				has: (path) => api.getFileByPath(path) !== null,
				hasFolder: () => true,
				create: async (path, content) => {
					await api.create(path, content);
					created += 1;
				},
			},
			yieldTo: async () => undefined,
			// Cancel arrives while row 150 is being written: the run stops at the next boundary, i.e. after 150.
			shouldStop: () => created >= 150,
		});
		expect(summary.cancelled).toBe(true);
		expect(summary.created).toHaveLength(150);
		expect(summary.progress).toBe('created 150 of 412');
		expect(summary.ok).toBe(false);
		// Nothing unreported: the summary's list *is* the vault's new notes, no more and no fewer.
		expect(vault.paths().filter((path) => path.startsWith('Rows/'))).toEqual(summary.created);
		expect(summary.created[149]).toBe('Rows/Row 150.md');
		expect(api.getFileByPath('Rows/Row 151.md')).toBeNull();
		// The undo step holds the same 150: what exists is what an undo would remove.
		expect(summary.undo.paths).toEqual(summary.created);
		expect(summary.undo.label).toBe('Import 150 notes');
	});

	it('reports a failing create per file and lands the rest', async () => {
		const { plan, api, vault } = harness(412);
		// One path the vault refuses: a note that appeared between the preview and the run.
		vault.seedNote('Rows/Row 200.md', { Name: 'Came from somewhere else' }, '');
		const summary = await runImport({
			plan,
			vault: {
				has: (path) => api.getFileByPath(path) !== null,
				hasFolder: () => true,
				create: async (path, content) => {
					await api.create(path, content);
				},
			},
			yieldTo: async () => undefined,
		});
		expect(summary.created).toHaveLength(411);
		// The row number is the **matrix** row, so the note named `Row 200` is row 200 (the header is row 0).
		expect(summary.failures).toEqual([
			{
				row: 200,
				path: 'Rows/Row 200.md',
				reason: '“Rows/Row 200.md” appeared while the import was running',
			},
		]);
		expect(summary.ok).toBe(false);
		// The 211 rows after it still landed: one bad path does not abandon the other 411.
		expect(summary.created).toContain('Rows/Row 201.md');
		expect(summary.created).toContain('Rows/Row 412.md');
		// …and the note that was already there is untouched.
		expect(vault.frontmatterOf('Rows/Row 200.md')).toEqual({
			Name: 'Came from somewhere else',
		});
	});

	it('refuses every row with the same sentence when the folder is gone, and writes nothing', async () => {
		const { plan, api } = harness(3);
		const summary = await runImport({
			plan,
			vault: {
				has: (path) => api.getFileByPath(path) !== null,
				hasFolder: () => false,
				create: async (path, content) => {
					await api.create(path, content);
				},
			},
			yieldTo: async () => undefined,
		});
		expect(summary.created).toEqual([]);
		expect(summary.failures).toHaveLength(3);
		expect(summary.failures[0]?.reason).toContain('does not exist');
	});
});

describe('the one undo step', () => {
	it('removes exactly the 412 files the run created, and nothing else', async () => {
		const { plan, api, vault, trashPort, trashLog } = harness(412, {
			existing: ['Rows/Not mine.md'],
		});
		const summary = await runImport({
			plan,
			vault: {
				has: (path) => api.getFileByPath(path) !== null,
				hasFolder: () => true,
				create: async (path, content) => {
					await api.create(path, content);
				},
			},
			yieldTo: async () => undefined,
		});
		expect(summary.created).toHaveLength(412);

		const report = await undoImport(summary.undo, trashPort);
		expect(report.removed).toHaveLength(412);
		expect(report.missing).toEqual([]);
		expect(report.failed).toEqual([]);
		expect(report.message).toBe('Removed 412 notes');
		// The vault is back to its previous state: the one note that was already there, and nothing else.
		expect(vault.paths()).toEqual(['Rows/Not mine.md']);
		// Trashed, never deleted: every removal went through the port's `trash`, in reverse creation order.
		expect(trashLog[0]).toBe('Rows/Row 412.md');
		expect(trashLog[411]).toBe('Rows/Row 1.md');
	});

	it('is one history entry per run: a second undo has nothing to do', async () => {
		const first = harness(3);
		const history = createImportHistory(first.trashPort, { depth: 5 });
		const summary = await runImport({
			plan: first.plan,
			vault: {
				has: (path) => first.api.getFileByPath(path) !== null,
				hasFolder: () => true,
				create: async (path, content) => {
					await first.api.create(path, content);
				},
			},
			yieldTo: async () => undefined,
		});
		history.record(summary.undo);
		expect(history.size).toBe(1);
		expect(history.peek()).toEqual(summary.undo);
		const report = await history.undo();
		expect(report?.removed).toHaveLength(3);
		expect(history.size).toBe(0);
		expect(await history.undo()).toBeNull();
	});

	it('records nothing when a run created nothing, and reports a file that was already gone', async () => {
		const { plan, api, trashPort } = harness(2);
		const empty = await runImport({
			plan: { ...plan, notes: [] },
			vault: {
				has: () => false,
				hasFolder: () => true,
				create: async (path, content) => {
					await api.create(path, content);
				},
			},
			yieldTo: async () => undefined,
		});
		const history = createImportHistory(trashPort);
		history.record(empty.undo);
		expect(empty.progress).toBe('created 0 of 0');
		expect(history.size).toBe(0);
		// A file someone deleted by hand between the import and the undo is reported, not counted.
		const report = await undoImport(
			{ label: 'Import 2 notes', paths: ['Rows/Gone.md'] },
			trashPort,
		);
		expect(report.removed).toEqual([]);
		expect(report.missing).toEqual(['Rows/Gone.md']);
		expect(report.message).toBe('1 note already gone');
	});

	it('phrases the counts of a partial undo', () => {
		expect(undoMessage(410, 2, 0)).toBe('Removed 410 notes · 2 notes already gone');
		expect(undoMessage(1, 0, 1)).toBe('Removed 1 note · 1 note could not be removed');
		expect(undoMessage(0, 0, 0)).toBe('Nothing to remove');
	});
});
