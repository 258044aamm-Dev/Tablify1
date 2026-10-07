/**
 * The database session — R2 step 2's gate, and the place ADR-0005 is executable.
 *
 * The fake port hands out external edits on demand, so each promise the ADR makes is a case here:
 * a save compares the revision it was computed from with the disk; a changed disk produces a
 * `conflict` value with both revisions named and the disk text handed back; nothing is written on
 * a conflict; the two resolutions (reload, keep as copy) are explicit and testable; our own write
 * is never mistaken for someone else's. The rest of the file holds the session to its own contract:
 * commands apply purely and invert exactly, a rename retargets without touching identity, and
 * `dispose()` leaves no listener behind.
 */
import { describe, expect, it } from 'vitest';

import { openDatabase } from '../../src/adapters/tablifyFile/session';
import type { DatabaseSession, SessionChange } from '../../src/adapters/tablifyFile/session';
import { detectRevision } from '../../src/adapters/tablifyFile/revision';
import { parseDocument, serializeDocument } from '../../src/core/database/index';
import { createFakePort } from '../fakes/tablifyFile';
import type { FakeVaultPort } from '../fakes/tablifyFile';

const PATH = 'Databases/Studio.tablify';
const DB_ID = 'db_' + 'z'.repeat(26);
const TABLE_ID = 'tbl_' + 'a'.repeat(26);
const OTHER_TABLE = 'tbl_' + 'b'.repeat(26);
const F_TITLE = 'fld_' + 'c'.repeat(26);
const F_CREATED = 'fld_' + 'd'.repeat(26);
const R_ONE = 'row_' + 'e'.repeat(26);
const R_TWO = 'row_' + 'f'.repeat(26);

function sampleText(overrides: { readonly name?: string } = {}): string {
	return JSON.stringify(
		{
			format: 'tablify',
			version: 1,
			databaseId: DB_ID,
			name: overrides.name ?? 'Studio',
			tables: [
				{
					id: TABLE_ID,
					name: 'Shoots',
					fields: [
						{ id: F_TITLE, name: 'Title', type: 'text' },
						{ id: F_CREATED, name: 'Created', type: 'createdTime' },
					],
					rows: [
						{ id: R_ONE, cells: { [F_TITLE]: 'First' } },
						{ id: R_TWO, cells: {} },
					],
					views: [],
				},
			],
		},
		null,
	);
}

async function openSession(
	text = sampleText(),
): Promise<{ readonly port: FakeVaultPort; readonly session: DatabaseSession }> {
	const port = createFakePort({ [PATH]: text });
	const opened = await openDatabase(port, PATH);
	if (!opened.ok) {
		throw new Error(`the test document must open: ${opened.failure.kind}`);
	}
	return { port, session: opened.session };
}

/** Everything a subscriber was told, so a test can assert the *absence* of a conflict too. */
function record(session: DatabaseSession): SessionChange[] {
	const seen: SessionChange[] = [];
	session.subscribe((change) => seen.push(change));
	return seen;
}

describe('opening a document', () => {
	it('loads, records a revision and starts clean', async () => {
		const { session } = await openSession();
		expect(session.getState()).toBe('clean');
		expect(session.getDocument().name).toBe('Studio');
		expect(session.getDocument().tables).toHaveLength(1);
		expect(session.getRevision()).toBe(detectRevision(sampleText()));
		expect(session.getDocument().databaseId).toBe(DB_ID);
	});

	it('refuses invalid JSON and hands the raw text back', async () => {
		const port = createFakePort({ [PATH]: '{ not json' });
		const opened = await openDatabase(port, PATH);
		expect(opened.ok).toBe(false);
		if (opened.ok) {
			return;
		}
		expect(opened.failure.kind).toBe('invalid');
		expect(opened.rawText).toBe('{ not json');
	});

	it('refuses a future version as unsupported, and keeps the text', async () => {
		const future = sampleText().replace('"version":1', '"version":2');
		const port = createFakePort({ [PATH]: future });
		const opened = await openDatabase(port, PATH);
		expect(opened.ok).toBe(false);
		if (opened.ok) {
			return;
		}
		expect(opened.failure.kind).toBe('unsupported-version');
		expect(opened.rawText).toBe(future);
	});

	it('reports a missing file instead of inventing one', async () => {
		const port = createFakePort();
		const opened = await openDatabase(port, PATH);
		expect(opened.ok).toBe(false);
		if (opened.ok) {
			return;
		}
		expect(opened.failure.kind).toBe('missing');
		expect(port.files.has(PATH)).toBe(false);
	});
});

describe('commands apply through the pure algebra', () => {
	it('sets a cell, notifies once, and the inverse restores the document exactly', async () => {
		const { session } = await openSession();
		const seen = record(session);
		const before = session.getDocument();

		const applied = session.dispatch({
			kind: 'set-cell',
			tableId: TABLE_ID,
			rowId: R_TWO,
			fieldId: F_TITLE,
			value: 'Added later',
		});
		expect(applied.ok).toBe(true);
		if (!applied.ok) {
			return;
		}
		expect(session.getState()).toBe('dirty');
		expect(session.getDocument().tables[0]?.rows[1]?.cells.get(F_TITLE)).toBe('Added later');
		expect(seen.map((change) => change.kind)).toEqual(['document']);

		const undone = session.dispatch(applied.inverse);
		expect(undone.ok).toBe(true);
		expect(serializeDocument(session.getDocument())).toBe(serializeDocument(before));
	});

	it('clears a cell with null and restores it from the inverse', async () => {
		const { session } = await openSession();
		const applied = session.dispatch({
			kind: 'set-cell',
			tableId: TABLE_ID,
			rowId: R_ONE,
			fieldId: F_TITLE,
			value: null,
		});
		expect(applied.ok).toBe(true);
		if (!applied.ok) {
			return;
		}
		expect(session.getDocument().tables[0]?.rows[0]?.cells.has(F_TITLE)).toBe(false);
		expect(applied.inverse).toEqual({
			kind: 'set-cell',
			tableId: TABLE_ID,
			rowId: R_ONE,
			fieldId: F_TITLE,
			value: 'First',
		});
		session.dispatch(applied.inverse);
		expect(session.getDocument().tables[0]?.rows[0]?.cells.get(F_TITLE)).toBe('First');
	});

	it('refuses unknown identities, empty names, no-ops and read-only columns, with codes', async () => {
		const { session } = await openSession();
		const untouched = serializeDocument(session.getDocument());
		const cases = [
			{
				command: { kind: 'rename-table', tableId: OTHER_TABLE, name: 'Nope' },
				code: 'no-such-table',
			},
			{
				command: {
					kind: 'set-cell',
					tableId: TABLE_ID,
					rowId: 'row_' + '9'.repeat(26),
					fieldId: F_TITLE,
					value: 'x',
				},
				code: 'no-such-row',
			},
			{
				command: {
					kind: 'set-cell',
					tableId: TABLE_ID,
					rowId: R_ONE,
					fieldId: 'fld_' + '9'.repeat(26),
					value: 'x',
				},
				code: 'no-such-field',
			},
			{ command: { kind: 'set-document-name', name: '   ' }, code: 'invalid-name' },
			{
				command: { kind: 'rename-table', tableId: TABLE_ID, name: 'Shoots' },
				code: 'no-change',
			},
			{
				command: {
					kind: 'set-cell',
					tableId: TABLE_ID,
					rowId: R_ONE,
					fieldId: F_CREATED,
					value: '2026-01-01T00:00:00Z',
				},
				code: 'cell-not-writable',
			},
		] as const;
		for (const { command, code } of cases) {
			const result = session.dispatch(command);
			expect(result.ok, JSON.stringify(command)).toBe(false);
			if (!result.ok) {
				expect(result.code, JSON.stringify(command)).toBe(code);
			}
		}
		// None of the refusals dirtied the session or touched the document.
		expect(session.getState()).toBe('clean');
		expect(serializeDocument(session.getDocument())).toBe(untouched);
	});
});

describe('flushing: the whole document, revision-checked (ADR-0005)', () => {
	it('writes once for a batch of commands and reports the revision it wrote', async () => {
		const { port, session } = await openSession();
		const seen = record(session);
		session.dispatch({
			kind: 'set-cell',
			tableId: TABLE_ID,
			rowId: R_ONE,
			fieldId: F_TITLE,
			value: 'One',
		});
		session.dispatch({
			kind: 'set-cell',
			tableId: TABLE_ID,
			rowId: R_TWO,
			fieldId: F_TITLE,
			value: 'Two',
		});
		const result = await session.flush();
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.wrote).toBe(true);
		expect(port.writes).toEqual([PATH]);
		expect(session.getState()).toBe('clean');
		expect(session.getRevision()).toBe(result.revision);
		const onDisk = port.files.get(PATH) ?? '';
		expect(detectRevision(onDisk)).toBe(result.revision);
		const reparsed = parseDocument(onDisk);
		expect(reparsed.ok).toBe(true);
		if (reparsed.ok) {
			expect(reparsed.document).toEqual(session.getDocument());
			expect(reparsed.document.tables[0]?.rows[0]?.cells.get(F_TITLE)).toBe('One');
		}
		expect(seen.map((change) => change.kind)).toEqual(['document', 'document', 'saved']);
	});

	it('does not write when there is nothing to write', async () => {
		const { port, session } = await openSession();
		const result = await session.flush();
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.wrote).toBe(false);
		expect(port.writes).toEqual([]);
	});

	it('coalesces concurrent flushes into one write', async () => {
		const { port, session } = await openSession();
		session.dispatch({ kind: 'rename-table', tableId: TABLE_ID, name: 'Renamed' });
		const [first, second] = await Promise.all([session.flush(), session.flush()]);
		expect(first).toEqual(second);
		expect(port.writes).toEqual([PATH]);
	});

	it('survives a failing write without pretending it succeeded', async () => {
		const { session, port } = await openSession();
		port.failNextWrite = true;
		session.dispatch({ kind: 'rename-table', tableId: TABLE_ID, name: 'Renamed' });
		const result = await session.flush();
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.kind).toBe('write-failed');
		expect(session.getState()).toBe('dirty');
	});
});

describe('an external edit never gets silently overwritten', () => {
	it('refuses the save, names both revisions, and writes nothing', async () => {
		const { port, session } = await openSession();
		const before = port.files.get(PATH) ?? '';
		const theirs = sampleText({ name: 'Edited elsewhere' });
		port.simulateExternalChange(PATH, theirs);
		session.dispatch({ kind: 'set-document-name', name: 'My name' });

		const result = await session.flush();
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.kind).toBe('conflict');
		if (result.kind !== 'conflict') {
			return;
		}
		expect(result.expected).toBe(detectRevision(before));
		expect(result.found).toBe(detectRevision(theirs));
		expect(result.diskText).toBe(theirs);
		expect(port.files.get(PATH)).toBe(theirs);
		expect(port.writes).toEqual([]);
		expect(session.getState()).toBe('conflicted');
	});

	it('keeps refusing while conflicted, and the explicit reload adopts the disk', async () => {
		const { port, session } = await openSession();
		const theirs = sampleText({ name: 'Edited elsewhere' });
		port.simulateExternalChange(PATH, theirs);
		session.dispatch({ kind: 'set-document-name', name: 'My name' });
		await session.flush();

		expect(session.dispatch({ kind: 'set-document-name', name: 'Again' })).toMatchObject({
			ok: false,
			code: 'conflicted',
		});
		const second = await session.flush();
		expect(second.ok).toBe(false);

		const reloaded = await session.reload();
		expect(reloaded.ok).toBe(true);
		expect(session.getState()).toBe('clean');
		expect(session.getDocument().name).toBe('Edited elsewhere');
		expect(session.getRevision()).toBe(detectRevision(theirs));
	});

	it('"keep as copy" detaches: it stops writing and hands back the text and a copy path', async () => {
		const { port, session } = await openSession();
		port.simulateExternalChange(PATH, sampleText({ name: 'Edited elsewhere' }));
		session.dispatch({ kind: 'set-document-name', name: 'My name' });
		await session.flush();
		const copy = session.keepAsCopy();
		expect(session.getState()).toBe('detached');
		expect(copy.suggestedPath).toBe('Databases/Studio (copy).tablify');
		const reparsed = parseDocument(copy.text);
		expect(reparsed.ok).toBe(true);
		if (reparsed.ok) {
			expect(reparsed.document.name).toBe('My name');
		}
		const after = await session.flush();
		expect(after).toEqual({ ok: false, kind: 'detached' });
		expect(session.dispatch({ kind: 'set-document-name', name: 'Nope' })).toMatchObject({
			ok: false,
			code: 'detached',
		});
		expect(port.writes).toEqual([]);
	});

	it('notices a quiet external change while clean without adopting it silently', async () => {
		const { port, session } = await openSession();
		const seen = record(session);
		port.simulateExternalChange(PATH, sampleText({ name: 'Edited elsewhere' }));
		await Promise.resolve();
		expect(session.getState()).toBe('external');
		expect(session.getDocument().name).toBe('Studio');
		expect(seen.map((change) => change.kind)).toEqual(['external-change']);
	});

	it('never mistakes its own write for an external change', async () => {
		const { port, session } = await openSession();
		const seen = record(session);
		session.dispatch({ kind: 'rename-table', tableId: TABLE_ID, name: 'Renamed' });
		const result = await session.flush();
		expect(result.ok).toBe(true);
		await Promise.resolve();
		await Promise.resolve();
		expect(session.getState()).toBe('clean');
		expect(seen.filter((change) => change.kind === 'conflict')).toEqual([]);
		expect(port.writes).toEqual([PATH]);
	});
});

describe('lifecycle: rename, delete, dispose', () => {
	it('follows a rename without touching identity', async () => {
		const { port, session } = await openSession();
		const identity = session.getDocument().databaseId;
		port.simulateRename(PATH, 'Databases/Renamed.tablify');
		expect(session.path).toBe('Databases/Renamed.tablify');
		expect(session.getDocument().databaseId).toBe(identity);
		session.dispatch({ kind: 'rename-table', tableId: TABLE_ID, name: 'Renamed' });
		const result = await session.flush();
		expect(result.ok).toBe(true);
		expect(port.writes).toEqual(['Databases/Renamed.tablify']);
	});

	it('reports a delete and then refuses to write into the void', async () => {
		const { port, session } = await openSession();
		const seen = record(session);
		port.simulateDelete(PATH);
		expect(seen.map((change) => change.kind)).toEqual(['deleted']);
		session.dispatch({ kind: 'rename-table', tableId: TABLE_ID, name: 'Renamed' });
		const result = await session.flush();
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.kind).toBe('write-failed');
	});

	it('dispose() releases the port subscription and stops every further path', async () => {
		const { port, session } = await openSession();
		const seen = record(session);
		expect(port.listenerCount()).toBe(1);
		session.dispose();
		expect(port.listenerCount()).toBe(0);
		expect(seen.map((change) => change.kind)).toEqual(['disposed']);
		expect(session.getState()).toBe('disposed');
		expect(session.dispatch({ kind: 'set-document-name', name: 'After' })).toMatchObject({
			ok: false,
			code: 'disposed',
		});
		expect(await session.flush()).toEqual({ ok: false, kind: 'disposed' });
		port.simulateExternalChange('Databases/Other.tablify', '{}');
		port.simulateExternalChange(PATH, '{}');
		expect(seen.map((change) => change.kind)).toEqual(['disposed']);
	});
});
