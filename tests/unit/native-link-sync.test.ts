import { describe, expect, it } from 'vitest';

import { createWriteQueue } from '../../src/adapters/tablifyFile/queue';
import { openDatabase } from '../../src/adapters/tablifyFile/session';
import { createDatabaseStore } from '../../src/adapters/tablifyFile/databaseStore';
import type { DatabaseStore } from '../../src/adapters/tablifyFile/databaseStore';
import { createNativeSyncPort } from '../../src/sync/nativePort';
import { mappingFor, runNativeSync } from '../../src/sync/nativeRun';
import { newNativeLink, nativeLinkPath, serialiseNativeLink } from '../../src/sync/nativeLink';
import type { NativeLinkDocument } from '../../src/sync/nativeLink';
import type {
	PullResult,
	PushChange,
	PushResult,
	SyncTarget,
	TargetDescription,
} from '../../src/sync/SyncTarget';
import { linkFieldsFor } from '../../src/plugin/sync/nativeHost';
import { createFakeClock } from '../fakes/clock';
import { createFakePort } from '../fakes/tablifyFile';

const PATH = 'Databases/Links.tablify';
const DB = 'db_' + 'q'.repeat(26);
const SHOOTS = 'tbl_' + 'a'.repeat(26);
const CLIENTS = 'tbl_' + 'b'.repeat(26);
const TITLE = 'fld_' + 'a'.repeat(26);
const CLIENT = 'fld_' + 'c'.repeat(26);
const NAME = 'fld_' + 'd'.repeat(26);
const SHOOT_ONE = 'row_' + '1'.repeat(26);
const SHOOT_TWO = 'row_' + '2'.repeat(26);
const ADA = 'row_' + '9'.repeat(26);
const GRACE = 'row_' + '8'.repeat(26);
const NEW_CLIENT = 'row_' + '7'.repeat(26);
const STAMP = '2026-10-08T10:00:00.000Z';

const REMOTE_SHOOTS = 'tblSHOOTS';
const REMOTE_CLIENTS = 'tblCLIENTS';

const SHOOTS_TARGET = {
	baseId: 'appBASE',
	baseName: 'Studio',
	tableId: REMOTE_SHOOTS,
	tableName: 'Shoots',
};
const CLIENTS_TARGET = {
	baseId: 'appBASE',
	baseName: 'Studio',
	tableId: REMOTE_CLIENTS,
	tableName: 'Clients',
};

const REMOTE_FIELDS: TargetDescription['fields'] = [
	{ id: 'fldTitle', name: 'Title', type: 'singleLineText' },
	{ id: 'fldClient', name: 'Client', type: 'multipleRecordLinks', linkedTableId: REMOTE_CLIENTS },
];

function documentText(): string {
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: DB,
		name: 'Studio',
		tables: [
			{
				id: SHOOTS,
				name: 'Shoots',
				fields: [
					{ id: TITLE, name: 'Title', type: 'text' },
					{
						id: CLIENT,
						name: 'Client',
						type: 'link',
						targetTableId: CLIENTS,
						allowMultiple: true,
						inverseFieldId: null,
					},
				],
				rows: [
					{
						id: SHOOT_ONE,
						createdAt: '2026-01-02T09:00:00Z',
						updatedAt: '2026-01-02T09:00:00Z',
						cells: { [TITLE]: 'Rooftop', [CLIENT]: [ADA] },
					},
					{
						id: SHOOT_TWO,
						createdAt: '2026-01-03T09:00:00Z',
						updatedAt: '2026-01-03T09:00:00Z',
						cells: { [TITLE]: 'Lobby' },
					},
				],
				views: [],
			},
			{
				id: CLIENTS,
				name: 'Clients',
				fields: [{ id: NAME, name: 'Name', type: 'text' }],
				rows: [
					{
						id: ADA,
						createdAt: '2026-01-01T09:00:00Z',
						updatedAt: '2026-01-01T09:00:00Z',
						cells: { [NAME]: 'Ada' },
					},
					{
						id: GRACE,
						createdAt: '2026-01-01T09:00:00Z',
						updatedAt: '2026-01-01T09:00:00Z',
						cells: { [NAME]: 'Grace' },
					},
					{
						id: NEW_CLIENT,
						createdAt: '2026-01-01T09:00:00Z',
						updatedAt: '2026-01-01T09:00:00Z',
						cells: { [NAME]: 'Not yet linked' },
					},
				],
				views: [],
			},
		],
	});
}

/** The two link files: Shoots → remote Shoots, and Clients → remote Clients. Clients keeps Ada and Grace, not the new one. */
function shootsDocument(): NativeLinkDocument {
	return {
		...newNativeLink({ databaseId: DB, tableId: SHOOTS, target: SHOOTS_TARGET }),
		rowMap: { [SHOOT_ONE]: 'recShoot1', [SHOOT_TWO]: 'recShoot2' },
		fieldMap: { [TITLE]: 'fldTitle', [CLIENT]: 'fldClient' },
	};
}

function linkFiles(): Map<string, string> {
	const shoots = shootsDocument();
	const clients: NativeLinkDocument = {
		...newNativeLink({ databaseId: DB, tableId: CLIENTS, target: CLIENTS_TARGET }),
		rowMap: { [ADA]: 'recAda', [GRACE]: 'recGrace' },
		fieldMap: { [NAME]: 'fldName' },
	};
	return new Map([
		[nativeLinkPath(DB, SHOOTS), serialiseNativeLink(shoots)],
		[nativeLinkPath(DB, CLIENTS), serialiseNativeLink(clients)],
	]);
}

async function rig(): Promise<{
	store: DatabaseStore;
	read: (path: string) => Promise<string | null>;
}> {
	const fake = createFakePort({ [PATH]: documentText() });
	const opened = await openDatabase(fake, PATH);
	if (!opened.ok) {
		throw new Error('the link-sync fixture must open');
	}
	const clock = createFakeClock();
	const queue = createWriteQueue(opened.session, { scheduler: clock, debounceMs: 400 });
	const store = createDatabaseStore({ session: opened.session, queue, initialTableId: SHOOTS });
	const files = linkFiles();
	return { store, read: async (path) => files.get(path) ?? null };
}

function fakeTarget(
	records: readonly { id: string; fields: Record<string, unknown> }[],
	fields = REMOTE_FIELDS,
) {
	const pushes: PushChange[] = [];
	const target: SyncTarget = {
		async describe() {
			return { ...SHOOTS_TARGET, fields };
		},
		async pull(): Promise<PullResult> {
			return { records, pulledAt: STAMP, truncated: false };
		},
		async push(changes): Promise<PushResult> {
			pushes.push(...changes);
			return {
				pushed: changes.map((change) => ({ ok: true as const, recordId: change.recordId })),
				pushedAt: STAMP,
				accepted: changes.length,
			};
		},
		capabilities() {
			return { incrementalPull: true, maxRecordsPerWrite: 10, lastModified: false };
		},
	};
	return { target, pushes };
}

const BASELINE = [
	{ id: 'recShoot1', fields: { fldTitle: 'Rooftop', fldClient: ['recAda'] } },
	{ id: 'recShoot2', fields: { fldTitle: 'Lobby' } },
];

async function linkedPort(store: DatabaseStore, read: (path: string) => Promise<string | null>) {
	const linkFields = await linkFieldsFor(read, store, DB, SHOOTS);
	const environment = { now: () => Date.parse(STAMP), timezone: 'UTC', locale: 'en-GB' };
	return createNativeSyncPort({ store, tableId: SHOOTS, environment, linkFields });
}

async function documentOf(): Promise<NativeLinkDocument> {
	return shootsDocument();
}

describe('linked records: the boundary the host builds', () => {
	it('builds a boundary for a link field whose target table is linked, and names the remote table', async () => {
		const { store, read } = await rig();
		const linkFields = await linkFieldsFor(read, store, DB, SHOOTS);
		expect(linkFields.get(CLIENT)).toEqual({
			remoteTableId: REMOTE_CLIENTS,
			rowToRecord: { [ADA]: 'recAda', [GRACE]: 'recGrace' },
			recordToRow: new Map([
				['recAda', ADA],
				['recGrace', GRACE],
			]),
		});
	});

	it('builds no boundary when the target table has no link file, so the field stays excluded', async () => {
		const { store } = await rig();
		const linkFields = await linkFieldsFor(async () => null, store, DB, SHOOTS);
		expect(linkFields.has(CLIENT)).toBe(false);
	});

	it('keeps the link field excluded when the port is built without boundaries (the default)', async () => {
		const { store } = await rig();
		const port = createNativeSyncPort({
			store,
			tableId: SHOOTS,
			environment: { now: () => 0, timezone: 'UTC', locale: 'en-GB' },
		});
		expect(port.syncFields().map((field) => field.definition.name)).toEqual([TITLE]);
		expect(port.excludedFields().map((field) => field.fieldId)).toContain(CLIENT);
		expect(port.linkedRemoteTableOf(CLIENT)).toBeNull();
	});
});

describe('linked records: a sync run', () => {
	it('pulls a remote link list as local row IDs, after an agreed baseline', async () => {
		const { store, read } = await rig();
		const port = await linkedPort(store, read);
		const first = fakeTarget(BASELINE);
		const baseline = await runNativeSync({
			target: first.target,
			port,
			document: await documentOf(),
			direction: 'pull',
			now: () => STAMP,
		});
		expect(baseline.report.plan.conflicts).toHaveLength(0);

		const changed = fakeTarget([
			{ id: 'recShoot1', fields: { fldTitle: 'Rooftop', fldClient: ['recAda', 'recGrace'] } },
			{ id: 'recShoot2', fields: { fldTitle: 'Lobby' } },
		]);
		await runNativeSync({
			target: changed.target,
			port,
			document: baseline.document,
			direction: 'pull',
			now: () => STAMP,
		});
		const rows = await port.values(SHOOT_ONE);
		expect(rows[CLIENT]).toEqual([ADA, GRACE]);
	});

	it('pushes a local link list as remote record IDs, after an agreed baseline', async () => {
		const { store, read } = await rig();
		const port = await linkedPort(store, read);
		const first = fakeTarget(BASELINE);
		const baseline = await runNativeSync({
			target: first.target,
			port,
			document: await documentOf(),
			direction: 'pull',
			now: () => STAMP,
		});
		store.dispatch(
			[
				{
					kind: 'set-cells',
					tableId: SHOOTS,
					rowId: SHOOT_ONE,
					edits: [{ fieldId: CLIENT, value: [ADA, GRACE] }],
				},
			],
			'link edit',
		);
		const pushed = fakeTarget(BASELINE);
		await runNativeSync({
			target: pushed.target,
			port,
			document: baseline.document,
			direction: 'push',
			now: () => STAMP,
		});
		const change = pushed.pushes.find((item) => item.recordId === 'recShoot1');
		expect(change?.fields).toEqual({ fldClient: ['recAda', 'recGrace'] });
	});

	it('refuses the whole push when a link points at a row that has no record, and writes nothing', async () => {
		const { store, read } = await rig();
		const port = await linkedPort(store, read);
		const first = fakeTarget(BASELINE);
		const baseline = await runNativeSync({
			target: first.target,
			port,
			document: await documentOf(),
			direction: 'pull',
			now: () => STAMP,
		});
		store.dispatch(
			[
				{
					kind: 'set-cells',
					tableId: SHOOTS,
					rowId: SHOOT_ONE,
					edits: [{ fieldId: CLIENT, value: [ADA, NEW_CLIENT] }],
				},
			],
			'link to an unlinked row',
		);
		const pushed = fakeTarget(BASELINE);
		await expect(
			runNativeSync({
				target: pushed.target,
				port,
				document: baseline.document,
				direction: 'push',
				now: () => STAMP,
			}),
		).rejects.toThrow(
			/Link field “Client” has 1 row\(s\) that do not link to a current record, so nothing is written/,
		);
		expect(pushed.pushes).toHaveLength(0);
	});

	it('does not map a link to a remote field that points at a different table', async () => {
		const { store, read } = await rig();
		const port = await linkedPort(store, read);
		const other = fakeTarget(BASELINE, [
			{ id: 'fldTitle', name: 'Title', type: 'singleLineText' },
			{
				id: 'fldClient',
				name: 'Client',
				type: 'multipleRecordLinks',
				linkedTableId: 'tblSOMEWHEREELSE',
			},
		]);
		const mapping = await mappingFor(other.target, port, await documentOf());
		expect(Object.keys(mapping.fieldMap)).not.toContain(CLIENT);
		expect(mapping.unmapped).toContainEqual({ side: 'local', name: 'Client' });
	});

	it('leaves a local link alone when the remote link holds a record with no local row', async () => {
		const { store, read } = await rig();
		const port = await linkedPort(store, read);
		const first = fakeTarget(BASELINE);
		const baseline = await runNativeSync({
			target: first.target,
			port,
			document: await documentOf(),
			direction: 'pull',
			now: () => STAMP,
		});
		const unknown = fakeTarget([
			{ id: 'recShoot1', fields: { fldTitle: 'Rooftop', fldClient: ['recNOBODY'] } },
			{ id: 'recShoot2', fields: { fldTitle: 'Lobby' } },
		]);
		await runNativeSync({
			target: unknown.target,
			port,
			document: baseline.document,
			direction: 'pull',
			now: () => STAMP,
		});
		const rows = await port.values(SHOOT_ONE);
		expect(rows[CLIENT]).toEqual([ADA]);
	});
});
