/**
 * The write queue — R2 step 4's gate.
 *
 * The fake clock and the gated fake port make every decision in the queue's header executable: a
 * burst of edits is one write; a command that lands while a write is in flight gets its own pass
 * and its own outcome; a failed write leaves the work pending for a retry; a conflict stops the
 * queue without a byte being written; and `close()` either waits for the write or declines it,
 * saying which.
 */
import { describe, expect, it } from 'vitest';

import { createWriteQueue } from '../../src/adapters/tablifyFile/queue';
import { openDatabase } from '../../src/adapters/tablifyFile/session';
import type { DatabaseSession, FlushResult } from '../../src/adapters/tablifyFile/session';
import { createFakeClock } from '../fakes/clock';
import type { Clock } from '../fakes/clock';
import { createFakePort } from '../fakes/tablifyFile';
import type { FakeVaultPort } from '../fakes/tablifyFile';

const PATH = 'Databases/Studio.tablify';
const TABLE_ID = 'tbl_' + 'a'.repeat(26);
const F_TITLE = 'fld_' + 'c'.repeat(26);
const R_ONE = 'row_' + 'e'.repeat(26);
const R_TWO = 'row_' + 'f'.repeat(26);

function documentText(): string {
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: 'db_' + 'z'.repeat(26),
		name: 'Studio',
		tables: [
			{
				id: TABLE_ID,
				name: 'Shoots',
				fields: [{ id: F_TITLE, name: 'Title', type: 'text' }],
				rows: [
					{ id: R_ONE, cells: { [F_TITLE]: 'First' } },
					{ id: R_TWO, cells: {} },
				],
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
}

async function rig(debounceMs = 400): Promise<Rig> {
	const port = createFakePort({ [PATH]: documentText() });
	const opened = await openDatabase(port, PATH);
	if (!opened.ok) {
		throw new Error('the rig document must open');
	}
	const clock = createFakeClock(1000);
	const queue = createWriteQueue(opened.session, { debounceMs, scheduler: clock });
	return { port, session: opened.session, clock, queue };
}

function setCell(session: DatabaseSession, rowId: string, value: string): void {
	const applied = session.dispatch({
		kind: 'set-cells',
		tableId: TABLE_ID,
		rowId,
		edits: [{ fieldId: F_TITLE, value }],
	});
	expect(applied.ok).toBe(true);
}

function wroteRevision(result: FlushResult): string {
	expect(result.ok).toBe(true);
	if (!result.ok) {
		throw new Error('the flush was expected to succeed');
	}
	expect(result.wrote).toBe(true);
	return result.revision;
}

/** Let the async chain reach the gated write without touching the clock. */
async function settleMicrotasks(): Promise<void> {
	for (let index = 0; index < 8; index += 1) {
		await Promise.resolve();
	}
}

describe('a burst of edits is one write', () => {
	it('writes once when the window closes, and not before', async () => {
		const { port, session, clock, queue } = await rig();
		setCell(session, R_ONE, 'A');
		const first = queue.request();
		setCell(session, R_TWO, 'B');
		const second = queue.request();
		setCell(session, R_ONE, 'C');
		const third = queue.request();

		expect(queue.pending()).toBe(true);
		expect(clock.pending()).toBe(1);
		expect(port.writes).toEqual([]);

		clock.advance(400);
		const results = await Promise.all([first, second, third]);
		expect(results).toEqual([
			{ ok: true, wrote: true, revision: session.getRevision() },
			{ ok: true, wrote: true, revision: session.getRevision() },
			{ ok: true, wrote: true, revision: session.getRevision() },
		]);
		expect(port.writes).toEqual([PATH]);
		expect(queue.pending()).toBe(false);
		const onDisk = port.files.get(PATH) ?? '';
		expect(onDisk.includes('"C"')).toBe(true);
		expect(onDisk.includes('"B"')).toBe(true);
	});

	it('automatically schedules one write for a multi-operation user action', async () => {
		const { port, session, clock, queue } = await rig();
		const applied = session.dispatch(
			[
				{
					kind: 'set-cells',
					tableId: TABLE_ID,
					rowId: R_ONE,
					edits: [{ fieldId: F_TITLE, value: 'First paste cell' }],
				},
				{
					kind: 'set-cells',
					tableId: TABLE_ID,
					rowId: R_TWO,
					edits: [{ fieldId: F_TITLE, value: 'Second paste cell' }],
				},
			],
			'Paste two cells',
		);
		expect(applied.ok).toBe(true);
		expect(session.getHistorySummary()).toMatchObject({
			depth: 1,
			undoLabel: 'Paste two cells',
		});
		expect(queue.pending()).toBe(true);
		expect(clock.pending()).toBe(1);
		expect(port.writes).toEqual([]);

		clock.advance(400);
		await settleMicrotasks();
		expect(port.writes).toEqual([PATH]);
		expect(queue.pending()).toBe(false);
		expect(port.files.get(PATH)).toContain('First paste cell');
		expect(port.files.get(PATH)).toContain('Second paste cell');
	});

	it('automatically queues undo and redo through the same document writer', async () => {
		const { port, session, clock, queue } = await rig();
		setCell(session, R_ONE, 'Changed');
		expect(session.undo().ok).toBe(true);
		expect(queue.pending()).toBe(true);
		clock.advance(400);
		await settleMicrotasks();
		expect(port.writes).toEqual([PATH]);
		expect(port.files.get(PATH)).not.toContain('Changed');

		expect(session.redo().ok).toBe(true);
		expect(queue.pending()).toBe(true);
		clock.advance(400);
		await settleMicrotasks();
		expect(port.writes).toEqual([PATH, PATH]);
		expect(port.files.get(PATH)).toContain('Changed');
	});

	it('flushNow writes without waiting for the window', async () => {
		const { port, session, clock, queue } = await rig();
		setCell(session, R_ONE, 'Now');
		const result = await queue.flushNow();
		expect(result.ok).toBe(true);
		expect(port.writes).toEqual([PATH]);
		expect(clock.pending()).toBe(0);
	});
});

describe('nothing in flight is lost', () => {
	it('runs one more pass for a command that lands during a write', async () => {
		const { port, session, clock, queue } = await rig();
		const release = port.deferNextWrite();
		setCell(session, R_ONE, 'Before');
		const first = queue.request();
		clock.advance(400);
		await settleMicrotasks();
		expect(port.writesStarted).toBe(1);

		setCell(session, R_TWO, 'During');
		const second = queue.request();
		release();
		const firstResult = await first;
		const secondResult = await second;

		const firstRevision = wroteRevision(firstResult);
		const secondRevision = wroteRevision(secondResult);
		expect(secondRevision).toBe(session.getRevision());
		expect(secondRevision).not.toBe(firstRevision);
		expect(port.writes).toEqual([PATH, PATH]);
		const onDisk = port.files.get(PATH) ?? '';
		expect(onDisk.includes('"Before"')).toBe(true);
		expect(onDisk.includes('"During"')).toBe(true);
		expect(session.getState()).toBe('clean');
	});

	it('settles clean when the mid-write edits serialize to what was written', async () => {
		const { port, session, clock, queue } = await rig();
		const release = port.deferNextWrite();
		setCell(session, R_ONE, 'Changed');
		const first = queue.request();
		clock.advance(400);
		await settleMicrotasks();
		expect(port.writesStarted).toBe(1);

		setCell(session, R_ONE, 'Edited');
		setCell(session, R_ONE, 'Changed');
		const second = queue.request();
		release();
		const [firstResult, secondResult] = await Promise.all([first, second]);

		expect(firstResult.ok && secondResult.ok).toBe(true);
		if (firstResult.ok && secondResult.ok) {
			// The pass found the document already on disk: same revision, nothing left to write.
			expect(firstResult.wrote).toBe(true);
			expect(secondResult.wrote).toBe(false);
			expect(secondResult.revision).toBe(firstResult.revision);
		}
		expect(session.getState()).toBe('clean');
		expect(port.writes).toEqual([PATH]);
	});

	it('a failed write keeps the work pending for a retry', async () => {
		const { port, session, clock, queue } = await rig();
		port.failNextWrite = true;
		setCell(session, R_ONE, 'Retry me');
		const failed = queue.request();
		clock.advance(400);
		const failedResult = await failed;
		expect(failedResult.ok).toBe(false);
		if (!failedResult.ok) {
			expect(failedResult.kind).toBe('write-failed');
		}
		expect(session.getState()).toBe('dirty');
		expect(port.writes).toEqual([]);

		const retried = queue.request();
		clock.advance(400);
		const retriedResult = await retried;
		expect(retriedResult.ok).toBe(true);
		expect(port.writes).toEqual([PATH]);
		expect((port.files.get(PATH) ?? '').includes('"Retry me"')).toBe(true);
	});

	it('a conflict stops the queue and is surfaced to every waiter', async () => {
		const { port, session, clock, queue } = await rig();
		port.simulateExternalChange(PATH, documentText().replace('Studio', 'Theirs'));
		setCell(session, R_ONE, 'Mine');
		const first = queue.request();
		const second = queue.request();
		clock.advance(400);
		const [firstResult, secondResult] = await Promise.all([first, second]);
		expect(firstResult.ok).toBe(false);
		expect(secondResult.ok).toBe(false);
		if (!firstResult.ok) {
			expect(firstResult.kind).toBe('conflict');
		}
		expect(port.writes).toEqual([]);
		expect(session.getState()).toBe('conflicted');
		expect(queue.pending()).toBe(false);
	});
});

describe('close', () => {
	it('waits for the pending write, then disposes', async () => {
		const { port, session, queue } = await rig();
		setCell(session, R_ONE, 'Final');
		const result = await queue.close();
		expect(result).toEqual({ ok: true, wrote: true });
		expect(port.writes).toEqual([PATH]);
		expect(session.getState()).toBe('disposed');
		expect(port.listenerCount()).toBe(0);
		expect(await queue.request()).toEqual({ ok: false, kind: 'disposed' });
	});

	it('does not start a second pass for edits arriving during an explicitly declined close', async () => {
		const { port, session, clock, queue } = await rig();
		const release = port.deferNextWrite();
		setCell(session, R_ONE, 'Written before close');
		const first = queue.request();
		clock.advance(400);
		await settleMicrotasks();
		expect(port.writesStarted).toBe(1);

		const closing = queue.close({ flush: false });
		setCell(session, R_TWO, 'Declined during close');
		release();
		expect(await first).toMatchObject({ ok: true, wrote: true });
		expect(await closing).toEqual({ ok: true, wrote: true });
		expect(port.writes).toEqual([PATH]);
		expect(port.files.get(PATH)).toContain('Written before close');
		expect(port.files.get(PATH)).not.toContain('Declined during close');
		expect(session.getState()).toBe('disposed');
	});

	it('can decline the write, and says so to whoever was waiting', async () => {
		const { port, session, clock, queue } = await rig();
		setCell(session, R_ONE, 'Unsaved');
		const pendingWrite = queue.request();
		const result = await queue.close({ flush: false });
		expect(result).toEqual({ ok: true, wrote: false });
		expect(port.writes).toEqual([]);
		expect(session.getState()).toBe('disposed');
		clock.advance(400);
		expect(await pendingWrite).toEqual({ ok: false, kind: 'disposed' });
	});

	it('closing a conflicted queue reports the conflict instead of hiding it', async () => {
		const { port, session, queue } = await rig();
		port.simulateExternalChange(PATH, documentText().replace('Studio', 'Theirs'));
		setCell(session, R_ONE, 'Mine');
		const result = await queue.close();
		expect(result).toEqual({ ok: false, kind: 'conflict' });
		expect(port.writes).toEqual([]);
	});
});
