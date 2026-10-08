import { describe, expect, it } from 'vitest';

import { createWriteQueue } from '../../src/adapters/tablifyFile/queue';
import { openDatabase } from '../../src/adapters/tablifyFile/session';
import type { DatabaseSession } from '../../src/adapters/tablifyFile/session';
import { createDatabaseStore } from '../../src/adapters/tablifyFile/databaseStore';
import type { DatabaseStore } from '../../src/adapters/tablifyFile/databaseStore';
import { createFakeClock } from '../fakes/clock';
import type { Clock } from '../fakes/clock';
import { createFakePort } from '../fakes/tablifyFile';
import type { FakeVaultPort } from '../fakes/tablifyFile';

const PATH = 'Databases/Store.tablify';
const TABLE_ONE = 'tbl_' + 'a'.repeat(26);
const TABLE_TWO = 'tbl_' + 'b'.repeat(26);
const DB_ID = 'db_' + 'z'.repeat(26);

function documentText(): string {
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: DB_ID,
		name: 'Studio',
		tables: [
			{
				id: TABLE_ONE,
				name: 'Current',
				fields: [],
				rows: [],
				views: [],
			},
			{
				id: TABLE_TWO,
				name: 'Archive',
				fields: [],
				rows: [],
				views: [],
			},
		],
	});
}

interface Rig {
	readonly port: FakeVaultPort;
	readonly session: DatabaseSession;
	readonly clock: Clock;
	readonly queue: ReturnType<typeof createWriteQueue>;
	readonly store: DatabaseStore;
}

async function rig(initialTableId?: string): Promise<Rig> {
	const port = createFakePort({ [PATH]: documentText() });
	const opened = await openDatabase(port, PATH);
	if (!opened.ok) {
		throw new Error('the database-store fixture must open');
	}
	const clock = createFakeClock();
	const queue = createWriteQueue(opened.session, { scheduler: clock, debounceMs: 400 });
	const store = createDatabaseStore({
		session: opened.session,
		queue,
		...(initialTableId === undefined ? {} : { initialTableId }),
	});
	return { port, session: opened.session, clock, queue, store };
}

async function settleMicrotasks(): Promise<void> {
	for (let index = 0; index < 8; index += 1) {
		await Promise.resolve();
	}
}

describe('the native database store', () => {
	it('derives an active-table projection and keeps navigation out of document writes', async () => {
		const { port, session, store, queue } = await rig(TABLE_TWO);
		const before = store.getSnapshot();
		expect(before.document).toBe(session.getDocument());
		expect(before.activeTableId).toBe(TABLE_TWO);
		expect(before.activeTable?.table.name).toBe('Archive');

		let notifications = 0;
		store.subscribe(() => {
			notifications += 1;
		});
		expect(store.selectTable(TABLE_ONE)).toEqual({ ok: true, changed: true });
		const selected = store.getSnapshot();
		expect(selected).not.toBe(before);
		expect(selected.revision).toBe(before.revision + 1);
		expect(selected.activeTableId).toBe(TABLE_ONE);
		expect(selected.activeTable?.table.name).toBe('Current');
		expect(store.selectTable(TABLE_ONE)).toEqual({ ok: true, changed: false });
		expect(store.selectTable('tbl_' + '9'.repeat(26))).toMatchObject({
			ok: false,
			code: 'no-such-table',
		});
		expect(notifications).toBe(1);
		expect(session.getState()).toBe('clean');
		expect(session.getHistorySummary().depth).toBe(0);
		expect(queue.pending()).toBe(false);
		expect(port.writes).toEqual([]);

		store.dispose();
		await queue.close({ flush: false });
	});

	it('publishes one immediate canonical snapshot for one multi-operation action', async () => {
		const { port, session, store, queue, clock } = await rig(TABLE_ONE);
		let notifications = 0;
		store.subscribe(() => {
			notifications += 1;
		});
		const initial = store.getSnapshot();
		const result = store.dispatch(
			[
				{ kind: 'set-document-name', name: 'Production' },
				{ kind: 'rename-table', tableId: TABLE_TWO, name: 'Completed' },
			],
			'Update database and table',
		);
		expect(result.ok).toBe(true);
		expect(notifications).toBe(1);
		expect(store.getSnapshot().revision).toBe(initial.revision + 1);
		expect(store.getSnapshot().document).toBe(session.getDocument());
		expect(store.getSnapshot().document.name).toBe('Production');
		expect(store.getSnapshot().document.tables[1]?.name).toBe('Completed');
		expect(store.getSnapshot().activeTableId).toBe(TABLE_ONE);
		expect(store.getSnapshot().history).toMatchObject({
			depth: 1,
			undoLabel: 'Update database and table',
		});
		expect(queue.pending()).toBe(true);
		expect(clock.pending()).toBe(1);
		expect(port.writes).toEqual([]);

		store.dispose();
		await queue.close();
		expect(port.writes).toEqual([PATH]);
	});

	it('keeps one database history across table switching and undoes by stable ids', async () => {
		const { store, session, queue } = await rig(TABLE_ONE);
		store.dispatch(
			{ kind: 'rename-table', tableId: TABLE_TWO, name: 'Finished work' },
			'Rename archive',
		);
		expect(store.selectTable(TABLE_TWO)).toEqual({ ok: true, changed: true });
		expect(store.getSnapshot().history.depth).toBe(1);
		expect(store.undo()).toMatchObject({ ok: true, label: 'Rename archive' });
		expect(store.getSnapshot().activeTableId).toBe(TABLE_TWO);
		expect(store.getSnapshot().activeTable?.table.name).toBe('Archive');
		expect(session.getDocument().tables[1]?.name).toBe('Archive');
		expect(store.getSnapshot().history.canRedo).toBe(true);

		store.dispose();
		await queue.close();
	});

	it('keeps an optimistic document and reports a failed whole-document save', async () => {
		const { port, session, store, queue, clock } = await rig();
		port.failNextWrite = true;
		store.dispatch(
			{ kind: 'set-document-name', name: 'Unsaved but visible' },
			'Rename database',
		);
		const optimistic = store.getSnapshot();
		expect(optimistic.document.name).toBe('Unsaved but visible');
		expect(optimistic.sessionState).toBe('dirty');
		expect(optimistic.writeError).toBeNull();

		clock.advance(400);
		await settleMicrotasks();
		const failed = store.getSnapshot();
		expect(port.writes).toEqual([]);
		expect(failed.document).toBe(session.getDocument());
		expect(failed.document.name).toBe('Unsaved but visible');
		expect(failed.sessionState).toBe('dirty');
		expect(failed.writeError).toBe('The disk said no.');
		expect(failed.history).toMatchObject({ canUndo: true, undoLabel: 'Rename database' });

		const retry = await store.flush();
		expect(retry.ok).toBe(true);
		expect(port.writes).toEqual([PATH]);
		expect(store.getSnapshot().sessionState).toBe('clean');
		expect(store.getSnapshot().writeError).toBeNull();

		store.dispose();
		await queue.close();
	});

	it('gives each pane its own projection while sharing the canonical document and history', async () => {
		const { session, store: first, queue } = await rig(TABLE_ONE);
		const second = createDatabaseStore({ session, queue, initialTableId: TABLE_TWO });
		expect(first.getSnapshot().activeTableId).toBe(TABLE_ONE);
		expect(second.getSnapshot().activeTableId).toBe(TABLE_TWO);
		expect(first.getSnapshot().document).toBe(second.getSnapshot().document);

		first.dispatch({ kind: 'set-document-name', name: 'Shared database' }, 'Rename database');
		expect(first.getSnapshot().history.undoLabel).toBe('Rename database');
		expect(second.getSnapshot().history.undoLabel).toBe('Rename database');
		expect(first.getSnapshot().document).toBe(second.getSnapshot().document);
		expect(second.getSnapshot().document.name).toBe('Shared database');
		expect(first.getSnapshot().activeTableId).toBe(TABLE_ONE);
		expect(second.getSnapshot().activeTableId).toBe(TABLE_TWO);

		first.dispose();
		second.dispatch({ kind: 'rename-table', tableId: TABLE_TWO, name: 'Archived' });
		expect(second.getSnapshot().document.tables[1]?.name).toBe('Archived');
		expect(first.getSnapshot().document.tables[1]?.name).toBe('Archive');

		second.dispose();
		await queue.close();
	});

	it('reconciles a deleted active table without storing a second table copy', async () => {
		const { store, queue } = await rig(TABLE_TWO);
		const removed = store.dispatch(
			{ kind: 'delete-table', tableId: TABLE_TWO },
			'Delete archive',
		);
		expect(removed.ok).toBe(true);
		expect(store.getSnapshot().activeTableId).toBe(TABLE_ONE);
		expect(store.getSnapshot().activeTable?.table.id).toBe(TABLE_ONE);
		expect(store.undo().ok).toBe(true);
		// Selection is per-pane navigation; undo restores the table without forking the old selection.
		expect(store.getSnapshot().activeTableId).toBe(TABLE_ONE);
		expect(store.getSnapshot().document.tables.map((table) => table.id)).toEqual([
			TABLE_ONE,
			TABLE_TWO,
		]);

		store.dispose();
		await queue.close();
	});
});
