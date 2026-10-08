import { describe, expect, it } from 'vitest';

import { createSessionRegistry } from '../../src/adapters/tablifyFile/registry';
import { openDatabase } from '../../src/adapters/tablifyFile/session';
import type { DatabaseSession } from '../../src/adapters/tablifyFile/session';
import type { DatabaseOperation } from '../../src/core/database/operations';
import { serializeDocument } from '../../src/core/database/envelope';
import { createFakeClock } from '../fakes/clock';
import { createFakePort } from '../fakes/tablifyFile';
import type { FakeVaultPort } from '../fakes/tablifyFile';

const PATH = 'Databases/History.tablify';
const TABLE_ONE = 'tbl_' + 'a'.repeat(26);
const TABLE_TWO = 'tbl_' + 'b'.repeat(26);
const DB_ID = 'db_' + 'z'.repeat(26);

function documentText(name = 'Studio'): string {
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: DB_ID,
		name,
		tables: [
			{
				id: TABLE_ONE,
				name: 'Jobs',
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

async function openSession(
	text = documentText(),
): Promise<{ readonly port: FakeVaultPort; readonly session: DatabaseSession }> {
	const port = createFakePort({ [PATH]: text });
	const opened = await openDatabase(port, PATH);
	if (!opened.ok) {
		throw new Error(`the history fixture must open: ${opened.failure.kind}`);
	}
	return { port, session: opened.session };
}

describe('the shared database history', () => {
	it('records a multi-table batch as one step and replays exact undo/redo through operations', async () => {
		const { session } = await openSession();
		const before = serializeDocument(session.getDocument());
		const operations: readonly DatabaseOperation[] = [
			{ kind: 'set-document-name', name: 'Production' },
			{ kind: 'rename-table', tableId: TABLE_ONE, name: 'Current jobs' },
			{ kind: 'rename-table', tableId: TABLE_TWO, name: 'Completed jobs' },
		];

		const applied = session.dispatch(operations, 'Rename database tables');
		expect(applied.ok).toBe(true);
		expect(session.getHistorySummary()).toMatchObject({
			canUndo: true,
			canRedo: false,
			undoLabel: 'Rename database tables',
			depth: 1,
			redoDepth: 0,
		});
		expect(session.getState()).toBe('dirty');

		const undone = session.undo();
		expect(undone).toMatchObject({ ok: true, label: 'Rename database tables' });
		expect(serializeDocument(session.getDocument())).toBe(before);
		expect(session.getHistorySummary()).toMatchObject({
			canUndo: false,
			canRedo: true,
			undoLabel: null,
			redoLabel: 'Rename database tables',
			depth: 0,
			redoDepth: 1,
		});

		const redone = session.redo();
		expect(redone).toMatchObject({ ok: true, label: 'Rename database tables' });
		expect(session.getDocument().name).toBe('Production');
		expect(session.getDocument().tables.map((table) => table.name)).toEqual([
			'Current jobs',
			'Completed jobs',
		]);
		expect(session.getHistorySummary()).toMatchObject({
			canUndo: true,
			canRedo: false,
			depth: 1,
		});
	});

	it('keeps history in stable id space when edits span different tables', async () => {
		const { session } = await openSession();
		const before = serializeDocument(session.getDocument());
		session.dispatch(
			[
				{ kind: 'rename-table', tableId: TABLE_ONE, name: 'One renamed' },
				{ kind: 'rename-table', tableId: TABLE_TWO, name: 'Two renamed' },
			],
			'Rename both tables',
		);
		expect(session.getHistorySummary().depth).toBe(1);
		expect(session.undo().ok).toBe(true);
		expect(serializeDocument(session.getDocument())).toBe(before);
	});

	it('does not dirty or record empty batches, refusals, or non-serializable actions', async () => {
		const { session } = await openSession();
		const before = serializeDocument(session.getDocument());
		expect(session.dispatch([], 'Empty paste')).toMatchObject({ ok: true, inverse: [] });
		expect(session.getState()).toBe('clean');
		expect(session.getHistorySummary().depth).toBe(0);

		const missing = session.dispatch({
			kind: 'rename-table',
			tableId: 'tbl_' + '9'.repeat(26),
			name: 'Not here',
		});
		expect(missing).toMatchObject({ ok: false, code: 'no-such-table' });
		expect(session.getState()).toBe('clean');
		expect(session.getHistorySummary().depth).toBe(0);

		const withCallback: DatabaseOperation = {
			kind: 'set-document-name',
			name: 'Must not commit',
		};
		Reflect.set(withCallback, 'callback', () => undefined);
		expect(session.dispatch(withCallback)).toMatchObject({
			ok: false,
			code: 'non-serializable-operation',
		});
		expect(session.getState()).toBe('clean');
		expect(session.getHistorySummary().depth).toBe(0);
		expect(serializeDocument(session.getDocument())).toBe(before);
	});

	it('copies caller operations before they become redo data', async () => {
		const { session } = await openSession();
		const operation: DatabaseOperation = {
			kind: 'rename-table',
			tableId: TABLE_ONE,
			name: 'Chosen name',
		};
		expect(session.dispatch(operation).ok).toBe(true);
		Reflect.set(operation, 'name', 'Mutated after dispatch');

		expect(session.undo().ok).toBe(true);
		expect(session.redo().ok).toBe(true);
		expect(session.getDocument().tables[0]?.name).toBe('Chosen name');
	});

	it('refuses history when there is no step and clears it on explicit reload', async () => {
		const { port, session } = await openSession();
		expect(session.undo()).toMatchObject({ ok: false, code: 'nothing-to-undo' });
		expect(session.redo()).toMatchObject({ ok: false, code: 'nothing-to-redo' });

		session.dispatch({ kind: 'set-document-name', name: 'Mine' }, 'Rename database');
		expect(session.getHistorySummary().depth).toBe(1);
		port.simulateExternalChange(PATH, documentText('Theirs'));
		const reloaded = await session.reload();
		expect(reloaded.ok).toBe(true);
		expect(session.getDocument().name).toBe('Theirs');
		expect(session.getState()).toBe('clean');
		expect(session.getHistorySummary()).toMatchObject({
			canUndo: false,
			canRedo: false,
			depth: 0,
			redoDepth: 0,
		});
	});

	it('does not consume history when a conflict blocks undo, and dispose clears it', async () => {
		const { port, session } = await openSession();
		session.dispatch({ kind: 'set-document-name', name: 'Mine' });
		port.simulateExternalChange(PATH, documentText('Theirs'));
		const flushed = await session.flush();
		expect(flushed).toMatchObject({ ok: false, kind: 'conflict' });
		expect(session.undo()).toMatchObject({ ok: false, code: 'conflicted' });
		expect(session.getHistorySummary().depth).toBe(1);

		session.dispose();
		expect(session.getHistorySummary().depth).toBe(0);
		expect(session.undo()).toMatchObject({ ok: false, code: 'disposed' });
	});

	it('shares one history across panes because the registry shares one session', async () => {
		const port = createFakePort({ [PATH]: documentText() });
		const clock = createFakeClock();
		const registry = createSessionRegistry(port, { scheduler: clock });
		const first = await registry.open(PATH);
		const second = await registry.open(PATH);
		if (!first.ok || !second.ok) {
			throw new Error('both panes should share an open database');
		}
		expect(first.handle.session).toBe(second.handle.session);

		first.handle.session.dispatch(
			{ kind: 'set-document-name', name: 'Shared change' },
			'Shared action',
		);
		expect(second.handle.session.getHistorySummary().undoLabel).toBe('Shared action');
		expect(second.handle.session.undo().ok).toBe(true);
		expect(first.handle.session.getDocument().name).toBe('Studio');
		expect(first.handle.session.getHistorySummary().canRedo).toBe(true);

		await first.handle.release();
		await second.handle.release();
		expect(port.writes).toEqual([PATH]);
		expect(registry.openCount()).toBe(0);
	});
});
