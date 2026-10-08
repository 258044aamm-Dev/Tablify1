import { describe, expect, it } from 'vitest';

import { createWriteQueue } from '../../src/adapters/tablifyFile/queue';
import { openDatabase } from '../../src/adapters/tablifyFile/session';
import { createDatabaseStore } from '../../src/adapters/tablifyFile/databaseStore';
import { createNativeSyncPort } from '../../src/sync/nativePort';
import type { NativeSyncPort } from '../../src/sync/nativePort';
import { nativeLinkPath, newNativeLink, serialiseNativeLink } from '../../src/sync/nativeLink';
import type { NativeLinkDocument } from '../../src/sync/nativeLink';
import type { PullResult, SyncTarget, TargetDescription } from '../../src/sync/SyncTarget';
import { syncActiveStore, syncNativeTable } from '../../src/plugin/sync/nativeHost';
import type { NativeFilePort } from '../../src/plugin/sync/nativeHost';
import { createFakeClock } from '../fakes/clock';
import { createFakePort } from '../fakes/tablifyFile';

const PATH = 'Databases/Host.tablify';
const DB = 'db_' + 'z'.repeat(26);
const TABLE = 'tbl_' + 'a'.repeat(26);
const TITLE = 'fld_' + 'a'.repeat(26);
const ROW = 'row_' + '1'.repeat(26);
const TOKEN = 'pat_SECRET_TOKEN_VALUE_123';
const STAMP = '2026-10-08T10:00:00.000Z';
const TARGET = { baseId: 'appBASE', baseName: 'Studio', tableId: 'tblREMOTE', tableName: 'Shoots' };

function documentText(): string {
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: DB,
		name: 'Studio',
		tables: [
			{
				id: TABLE,
				name: 'Shoots',
				fields: [{ id: TITLE, name: 'Title', type: 'text' }],
				rows: [
					{
						id: ROW,
						createdAt: '2026-01-02T09:00:00Z',
						updatedAt: '2026-01-02T09:00:00Z',
						cells: { [TITLE]: 'Rooftop' },
					},
				],
				views: [],
			},
		],
	});
}

async function storeOf() {
	const fake = createFakePort({ [PATH]: documentText() });
	const opened = await openDatabase(fake, PATH);
	if (!opened.ok) {
		throw new Error('the host fixture must open');
	}
	const queue = createWriteQueue(opened.session, {
		scheduler: createFakeClock(),
		debounceMs: 400,
	});
	return createDatabaseStore({ session: opened.session, queue, initialTableId: TABLE });
}

async function port(): Promise<NativeSyncPort> {
	return createNativeSyncPort({
		store: await storeOf(),
		tableId: TABLE,
		environment: { now: () => 0, timezone: 'UTC', locale: 'en' },
	});
}

/** An in-memory vault for the link file. */
function vault(
	initial: Record<string, string> = {},
): NativeFilePort & { readonly files: Map<string, string>; writes: number } {
	const files = new Map(Object.entries(initial));
	const state = {
		files,
		writes: 0,
		async read(path: string) {
			return files.get(path) ?? null;
		},
		async write(path: string, text: string) {
			state.writes += 1;
			files.set(path, text);
		},
	};
	return state;
}

function linkedDocument(overrides: Partial<NativeLinkDocument> = {}): NativeLinkDocument {
	return {
		...newNativeLink({ databaseId: DB, tableId: TABLE, target: TARGET }),
		rowMap: { [ROW]: 'recA' },
		fieldMap: { [TITLE]: 'fldTitle' },
		// The baseline agrees with the table, so the first pull is not a conflict.
		snapshot: {},
		...overrides,
	};
}

/** A remote that serves one record and counts how often it was asked. */
function remote(options: { readonly pull?: () => Promise<PullResult> } = {}) {
	const counts = { describe: 0, pull: 0 };
	const description: TargetDescription = {
		...TARGET,
		fields: [{ id: 'fldTitle', name: 'Title', type: 'singleLineText' }],
	};
	const target: SyncTarget = {
		async describe() {
			counts.describe += 1;
			return description;
		},
		async pull(since) {
			counts.pull += 1;
			if (options.pull !== undefined) {
				return options.pull();
			}
			return {
				records: [{ id: 'recA', fields: { fldTitle: 'Rooftop' } }],
				pulledAt: STAMP,
				truncated: false,
			};
		},
		async push() {
			return { pushed: [], pushedAt: STAMP, accepted: 0 };
		},
		capabilities() {
			return { incrementalPull: true, maxRecordsPerWrite: 10, lastModified: false };
		},
	};
	return { target, counts };
}

function options(files: NativeFilePort, target: SyncTarget, token: string | null = TOKEN) {
	return {
		environment: { now: () => 0, timezone: 'UTC', locale: 'en' },
		files,
		token: () => token,
		targetFor: () => target,
		now: () => STAMP,
	};
}

describe('native sync host: refusals stop before anything is fetched or written', () => {
	it('refuses a table with no link file, and touches nothing', async () => {
		const files = vault();
		const { target, counts } = remote();
		const outcome = await syncNativeTable(options(files, target), {
			databaseId: DB,
			tableId: TABLE,
			port: await port(),
			direction: 'pull',
		});
		expect(outcome).toEqual({
			kind: 'refused',
			message: 'This table is not linked to a remote table yet.',
		});
		expect(counts.pull).toBe(0);
		expect(files.writes).toBe(0);
	});

	it('refuses a link file it cannot read, and leaves it exactly as it was', async () => {
		const path = nativeLinkPath(DB, TABLE);
		const damaged = '{"version": 1, "databaseId": ';
		const files = vault({ [path]: damaged });
		const { target, counts } = remote();
		const outcome = await syncNativeTable(options(files, target), {
			databaseId: DB,
			tableId: TABLE,
			port: await port(),
			direction: 'pull',
		});
		expect(outcome.kind).toBe('refused');
		expect(counts.pull).toBe(0);
		expect(files.files.get(path)).toBe(damaged);
	});

	it('refuses a missing token before any network call, and says where to add one', async () => {
		const path = nativeLinkPath(DB, TABLE);
		const files = vault({ [path]: serialiseNativeLink(linkedDocument()) });
		const { target, counts } = remote();
		const outcome = await syncNativeTable(options(files, target, null), {
			databaseId: DB,
			tableId: TABLE,
			port: await port(),
			direction: 'pull',
		});
		expect(outcome.kind).toBe('refused');
		expect(outcome.kind === 'refused' && outcome.message).toContain(
			'token in Settings › Tablify › Sync',
		);
		expect(counts.pull).toBe(0);
		expect(files.writes).toBe(0);
	});
});

describe('native sync host: a run', () => {
	it('saves the link once, after a successful run, and the saved text never holds the token', async () => {
		const path = nativeLinkPath(DB, TABLE);
		const files = vault({ [path]: serialiseNativeLink(linkedDocument()) });
		const { target } = remote();
		const outcome = await syncNativeTable(options(files, target), {
			databaseId: DB,
			tableId: TABLE,
			port: await port(),
			direction: 'pull',
		});
		expect(outcome.kind).toBe('ran');
		expect(files.writes).toBe(1);
		const saved = files.files.get(path) ?? '';
		expect(saved).toContain('"lastPulledAt": "2026-10-08T10:00:00.000Z"');
		expect(saved).not.toContain(TOKEN);
		if (outcome.kind === 'ran') {
			expect(JSON.stringify(outcome)).not.toContain(TOKEN);
		}
	});

	it('leaves the saved link untouched when the remote read fails', async () => {
		const path = nativeLinkPath(DB, TABLE);
		const original = serialiseNativeLink(linkedDocument());
		const files = vault({ [path]: original });
		const { target } = remote({
			pull: async () => {
				throw new Error('network is down');
			},
		});
		const outcome = await syncNativeTable(options(files, target), {
			databaseId: DB,
			tableId: TABLE,
			port: await port(),
			direction: 'pull',
		});
		expect(outcome.kind).toBe('refused');
		expect(files.writes).toBe(0);
		expect(files.files.get(path)).toBe(original);
	});

	it('refuses a link that belongs to another table, and does not run it', async () => {
		const path = nativeLinkPath(DB, TABLE);
		const other = linkedDocument({ tableId: 'tbl_' + 'b'.repeat(26) });
		const files = vault({ [path]: serialiseNativeLink(other) });
		const { target, counts } = remote();
		const outcome = await syncNativeTable(options(files, target), {
			databaseId: DB,
			tableId: TABLE,
			port: await port(),
			direction: 'pull',
		});
		expect(outcome.kind).toBe('refused');
		expect(counts.pull).toBe(0);
	});
});

describe('native sync host: the store the view shows', () => {
	it('syncs the active table of the store, and saves its link', async () => {
		const path = nativeLinkPath(DB, TABLE);
		const files = vault({ [path]: serialiseNativeLink(linkedDocument()) });
		const { target } = remote();
		const outcome = await syncActiveStore(options(files, target), {
			store: await storeOf(),
			direction: 'pull',
		});
		expect(outcome.kind).toBe('ran');
		expect(files.writes).toBe(1);
	});

	it('refuses when no table is selected, and touches nothing', async () => {
		const files = vault();
		const { target, counts } = remote();
		const fake = createFakePort({ [PATH]: documentText() });
		const opened = await openDatabase(fake, PATH);
		if (!opened.ok) {
			throw new Error('the host fixture must open');
		}
		const queue = createWriteQueue(opened.session, {
			scheduler: createFakeClock(),
			debounceMs: 400,
		});
		const store = createDatabaseStore({ session: opened.session, queue });
		const outcome = await syncActiveStore(options(files, target), { store, direction: 'pull' });
		expect(outcome.kind).toBe('refused');
		expect(counts.pull).toBe(0);
		expect(files.writes).toBe(0);
	});
});
