import { describe, expect, it } from 'vitest';

import { createDatabaseStore } from '../../src/adapters/tablifyFile/databaseStore';
import { applyDatabaseImportPlan } from '../../src/adapters/tablifyFile/importRunner';
import { createWriteQueue } from '../../src/adapters/tablifyFile/queue';
import { openDatabase } from '../../src/adapters/tablifyFile/session';
import type { DatabaseSession } from '../../src/adapters/tablifyFile/session';
import type { DatabaseStore } from '../../src/adapters/tablifyFile/databaseStore';
import {
	buildDatabaseImportPlan,
	previewDatabaseImport,
	serializeDocument,
} from '../../src/core/database';
import type {
	DatabaseDocument,
	DatabaseImportPlan,
	DatabaseImportPlanOptions,
	DatabaseImportPreview,
} from '../../src/core/database';
import { ID_PREFIXES } from '../../src/core/database/ids';
import type { IdKind } from '../../src/core/database/ids';
import type { FieldTypeId } from '../../src/core/types';
import { createFakeClock } from '../fakes/clock';
import type { Clock } from '../fakes/clock';
import { createFakePort } from '../fakes/tablifyFile';
import type { FakeVaultPort } from '../fakes/tablifyFile';

const PATH = 'Databases/Import-runner.tablify';
const FIXED_NOW = Date.parse('2026-10-08T10:20:30.000Z');

function document(): DatabaseDocument {
	return {
		format: 'tablify',
		version: 1,
		databaseId: `db_${'z'.repeat(26)}`,
		name: 'Import runner test',
		tables: [],
		unknown: [],
	};
}

function preview(rowCount = 2, columnCount = 1): DatabaseImportPreview {
	const headers = Array.from(
		{ length: columnCount },
		(_unused, index) => `Field ${String(index + 1)}`,
	);
	const matrix = [
		headers,
		...Array.from({ length: rowCount }, (_unused, rowIndex) =>
			headers.map(
				(_header, columnIndex) =>
					`Value ${String(rowIndex + 1)}-${String(columnIndex + 1)}`,
			),
		),
	];
	const overrides = new Map<number, FieldTypeId>(
		headers.map((_header, index) => [index, 'text']),
	);
	const result = previewDatabaseImport(
		{ kind: 'matrix', name: 'contacts.tsv', matrix },
		{ hasHeader: true, overrides },
	);
	if (!result.ok) {
		throw new Error(result.reason);
	}
	return result;
}

function ids(): DatabaseImportPlanOptions['ids'] {
	const counts = new Map<IdKind, number>();
	return (kind) => {
		const next = (counts.get(kind) ?? 0) + 1;
		counts.set(kind, next);
		return `${ID_PREFIXES[kind]}_runner${String(next)}`;
	};
}

function planFor(current: DatabaseDocument, rowCount = 2, columnCount = 1): DatabaseImportPlan {
	const result = buildDatabaseImportPlan(
		current,
		preview(rowCount, columnCount),
		{ kind: 'create', tableName: 'Imported contacts' },
		{
			ids: ids(),
			context: {
				now: () => FIXED_NOW,
				timezone: 'Europe/Amsterdam',
				locale: 'en-GB',
			},
		},
	);
	if (!result.ok) {
		throw new Error(result.issues.map((issue) => issue.message).join('\n'));
	}
	return result.plan;
}

interface Rig {
	readonly port: FakeVaultPort;
	readonly session: DatabaseSession;
	readonly clock: Clock;
	readonly store: DatabaseStore;
	readonly closeQueue: (flush?: boolean) => Promise<void>;
}

async function rig(initial: DatabaseDocument = document()): Promise<Rig> {
	const port = createFakePort({ [PATH]: serializeDocument(initial) });
	const opened = await openDatabase(port, PATH);
	if (!opened.ok) {
		throw new Error('the runner fixture must open');
	}
	const clock = createFakeClock();
	const queue = createWriteQueue(opened.session, { scheduler: clock, debounceMs: 400 });
	const store = createDatabaseStore({ session: opened.session, queue });
	return {
		port,
		session: opened.session,
		clock,
		store,
		async closeQueue(flush = false): Promise<void> {
			store.dispose();
			await queue.close({ flush });
		},
	};
}

async function settleMicrotasks(): Promise<void> {
	for (let index = 0; index < 8; index += 1) {
		await Promise.resolve();
	}
}

describe('native database import runner', () => {
	it('dispatches the exact plan as one undo step and persists it with one file write', async () => {
		const original = document();
		const plan = planFor(original);
		const { port, session, store, closeQueue } = await rig(original);
		const progress: string[] = [];

		const result = await applyDatabaseImportPlan(store, plan, {
			yieldTo: async () => undefined,
			onProgress: (event) => progress.push(event.phase),
		});

		expect(result).toMatchObject({
			kind: 'saved',
			appliedRecords: 2,
			committedRecords: 2,
			operationCount: plan.operations.length,
			wrote: true,
		});
		expect(progress).toEqual(['checking', 'ready-to-apply', 'saving', 'saved']);
		expect(session.getDocument().tables[0]?.rows).toHaveLength(2);
		expect(store.getSnapshot().history).toMatchObject({
			depth: 1,
			undoLabel: 'Import contacts.tsv',
		});
		expect(port.writes).toEqual([PATH]);

		const undo = store.undo();
		expect(undo).toMatchObject({ ok: true, label: 'Import contacts.tsv' });
		expect(serializeDocument(session.getDocument())).toBe(serializeDocument(original));
		expect((await store.flush()).ok).toBe(true);
		expect(port.writes).toEqual([PATH, PATH]);
		await closeQueue();
	});

	it('commits a 400 by 6 import as one undoable database transaction without chunking', async () => {
		const original = document();
		const plan = planFor(original, 400, 6);
		const { port, session, store, closeQueue } = await rig(original);

		const result = await applyDatabaseImportPlan(store, plan, {
			yieldTo: async () => undefined,
		});

		expect(result).toMatchObject({
			kind: 'saved',
			appliedRecords: 400,
			committedRecords: 400,
			operationCount: 407,
			wrote: true,
		});
		expect(plan.metrics.sourceCellsExamined).toBe(2400);
		expect(session.getDocument().tables[0]?.rows).toHaveLength(400);
		expect(store.getSnapshot().history.depth).toBe(1);
		expect(port.writes).toEqual([PATH]);
		await closeQueue();
	});

	it('refuses a stale plan without dispatching or writing over an intervening local edit', async () => {
		const original = document();
		const plan = planFor(original);
		const { port, session, store, closeQueue } = await rig(original);
		const intervening = store.dispatch(
			{ kind: 'set-document-name', name: 'Edited elsewhere in this session' },
			'Rename database',
		);
		expect(intervening.ok).toBe(true);

		const result = await applyDatabaseImportPlan(store, plan, {
			yieldTo: async () => undefined,
		});
		expect(result).toMatchObject({ kind: 'stale-plan', committedRecords: 0 });
		expect(session.getDocument().name).toBe('Edited elsewhere in this session');
		expect(session.getDocument().tables).toHaveLength(0);
		expect(store.getSnapshot().history).toMatchObject({
			depth: 1,
			undoLabel: 'Rename database',
		});
		expect(port.writes).toEqual([]);
		await closeQueue();
	});

	it('refuses plans after an external file change instead of writing from a stale session', async () => {
		const original = document();
		const plan = planFor(original);
		const { port, session, store, closeQueue } = await rig(original);
		port.simulateExternalChange(
			PATH,
			serializeDocument({ ...original, name: 'Changed on disk' }),
		);
		await settleMicrotasks();
		expect(session.getState()).toBe('external');

		const result = await applyDatabaseImportPlan(store, plan, {
			yieldTo: async () => undefined,
		});
		expect(result).toMatchObject({ kind: 'stale-plan', committedRecords: 0 });
		expect(session.getDocument().name).toBe(original.name);
		expect(session.getDocument().tables).toHaveLength(0);
		expect(port.writes).toEqual([]);
		await closeQueue();
	});

	it('cancels before its commit point with exactly zero committed work', async () => {
		const original = document();
		const plan = planFor(original);
		const { port, session, store, closeQueue } = await rig(original);
		const controller = new AbortController();

		const result = await applyDatabaseImportPlan(store, plan, {
			signal: controller.signal,
			yieldTo: async () => {
				controller.abort();
			},
		});

		expect(result).toMatchObject({ kind: 'cancelled', committedRecords: 0 });
		expect(session.getDocument().tables).toHaveLength(0);
		expect(store.getSnapshot().history.depth).toBe(0);
		expect(port.writes).toEqual([]);
		await closeQueue();
	});

	it('reports a failed file write separately from the already-applied undoable transaction', async () => {
		const original = document();
		const plan = planFor(original);
		const { port, session, store, closeQueue } = await rig(original);
		port.failNextWrite = true;

		const result = await applyDatabaseImportPlan(store, plan, {
			yieldTo: async () => undefined,
		});
		expect(result).toMatchObject({
			kind: 'applied-unsaved',
			appliedRecords: 2,
			committedRecords: 0,
			failure: { kind: 'write-failed', message: 'The disk said no.' },
		});
		expect(session.getDocument().tables[0]?.rows).toHaveLength(2);
		expect(session.getState()).toBe('dirty');
		expect(store.getSnapshot().history).toMatchObject({ depth: 1, canUndo: true });
		expect(port.writes).toEqual([]);

		expect((await store.flush()).ok).toBe(true);
		expect(session.getState()).toBe('clean');
		expect(port.writes).toEqual([PATH]);
		await closeQueue();
	});

	it('treats observer failures as non-fatal so they cannot interrupt an import transaction', async () => {
		const original = document();
		const plan = planFor(original);
		const { port, session, store, closeQueue } = await rig(original);

		const result = await applyDatabaseImportPlan(store, plan, {
			yieldTo: async () => undefined,
			onProgress: () => {
				throw new Error('the progress surface failed');
			},
		});

		expect(result.kind).toBe('saved');
		expect(session.getDocument().tables[0]?.rows).toHaveLength(2);
		expect(port.writes).toEqual([PATH]);
		await closeQueue();
	});
});
