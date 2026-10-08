import { describe, expect, it } from 'vitest';

import { createWriteQueue } from '../../src/adapters/tablifyFile/queue';
import { openDatabase } from '../../src/adapters/tablifyFile/session';
import { createDatabaseStore } from '../../src/adapters/tablifyFile/databaseStore';
import type { DatabaseStore } from '../../src/adapters/tablifyFile/databaseStore';
import { createNativeSyncPort } from '../../src/sync/nativePort';
import type { NativeSyncPort } from '../../src/sync/nativePort';
import { mappingFor, runNativeSync } from '../../src/sync/nativeRun';
import { newNativeLink } from '../../src/sync/nativeLink';
import type { NativeLinkDocument } from '../../src/sync/nativeLink';
import type {
	PullResult,
	PushChange,
	PushResult,
	SyncTarget,
	TargetDescription,
} from '../../src/sync/SyncTarget';
import { createFakeClock } from '../fakes/clock';
import { createFakePort } from '../fakes/tablifyFile';

const PATH = 'Databases/Run.tablify';
const DB = 'db_' + 'z'.repeat(26);
const TABLE = 'tbl_' + 'a'.repeat(26);
const OTHER = 'tbl_' + 'b'.repeat(26);
const TITLE = 'fld_' + 'a'.repeat(26);
const NOTES = 'fld_' + 'b'.repeat(26);
const CLIENT = 'fld_' + 'c'.repeat(26);
const TITLE_TWO = 'fld_' + 'e'.repeat(26);
const ROW_ONE = 'row_' + '1'.repeat(26);
const ROW_TWO = 'row_' + '2'.repeat(26);
const ROW_THREE = 'row_' + '3'.repeat(26);
const CLIENT_ROW = 'row_' + '9'.repeat(26);
const STAMP = '2026-10-08T10:00:00.000Z';

const TARGET = { baseId: 'appBASE', baseName: 'Studio', tableId: 'tblREMOTE', tableName: 'Shoots' };

function documentText(extraTitle: boolean): string {
	const fields = [
		{ id: TITLE, name: 'Title', type: 'text' },
		{ id: NOTES, name: 'Notes', type: 'longText' },
		{
			id: CLIENT,
			name: 'Client',
			type: 'link',
			targetTableId: OTHER,
			allowMultiple: false,
			inverseFieldId: null,
		},
		...(extraTitle ? [{ id: TITLE_TWO, name: 'Title', type: 'text' }] : []),
	];
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: DB,
		name: 'Studio',
		tables: [
			{
				id: TABLE,
				name: 'Shoots',
				fields,
				rows: [
					{
						id: ROW_ONE,
						createdAt: '2026-01-02T09:00:00Z',
						updatedAt: '2026-01-02T09:00:00Z',
						cells: { [TITLE]: 'Rooftop', [NOTES]: 'dawn', [CLIENT]: CLIENT_ROW },
					},
					{
						id: ROW_TWO,
						createdAt: '2026-01-03T09:00:00Z',
						updatedAt: '2026-01-03T09:00:00Z',
						cells: { [TITLE]: '' },
					},
					{
						id: ROW_THREE,
						createdAt: '2026-01-04T09:00:00Z',
						updatedAt: '2026-01-04T09:00:00Z',
						cells: { [TITLE]: 'Studio', [NOTES]: 'hall' },
					},
				],
				views: [],
			},
			{
				id: OTHER,
				name: 'Clients',
				fields: [{ id: 'fld_' + 'd'.repeat(26), name: 'Name', type: 'text' }],
				rows: [
					{
						id: CLIENT_ROW,
						createdAt: '2026-01-01T09:00:00Z',
						updatedAt: '2026-01-01T09:00:00Z',
						cells: {},
					},
				],
				views: [],
			},
		],
	});
}

async function rig(extraTitle = false): Promise<{ store: DatabaseStore; port: NativeSyncPort }> {
	const fake = createFakePort({ [PATH]: documentText(extraTitle) });
	const opened = await openDatabase(fake, PATH);
	if (!opened.ok) {
		throw new Error('the native-run fixture must open');
	}
	const clock = createFakeClock();
	const queue = createWriteQueue(opened.session, { scheduler: clock, debounceMs: 400 });
	const store = createDatabaseStore({ session: opened.session, queue, initialTableId: TABLE });
	const environment = {
		now: () => Date.parse('2026-10-08T10:00:00Z'),
		timezone: 'Asia/Dhaka',
		locale: 'en-GB',
	};
	return { store, port: createNativeSyncPort({ store, tableId: TABLE, environment }) };
}

/** A remote table with a fixed description and records, recording every read and write it receives. */
function fakeTarget(options: {
	readonly fields: readonly { id: string; name: string; type: string }[];
	readonly records: readonly { id: string; fields: Record<string, unknown> }[];
	readonly truncated?: boolean;
}) {
	const pulls: (string | null)[] = [];
	const pushes: PushChange[] = [];
	const description: TargetDescription = { ...TARGET, fields: options.fields };
	const target: SyncTarget = {
		async describe() {
			return description;
		},
		async pull(since): Promise<PullResult> {
			pulls.push(since);
			return {
				records: options.records,
				pulledAt: STAMP,
				truncated: options.truncated ?? false,
			};
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
	return { target, pulls, pushes };
}

const REMOTE_FIELDS = [
	{ id: 'fldTitle', name: 'Title', type: 'singleLineText' },
	{ id: 'fldNotes', name: 'Notes', type: 'multilineText' },
	{ id: 'fldClient', name: 'Client', type: 'multipleRecordLinks' },
];

const REMOTE_RECORDS = [
	{ id: 'recA', fields: { fldTitle: 'Rooftop, remote', fldNotes: 'dawn', fldClient: ['recX'] } },
	{ id: 'recB', fields: { fldTitle: '' } },
	{ id: 'recC', fields: { fldTitle: 'Studio', fldNotes: 'hall' } },
];

// The first run has no agreed snapshot, so the engine must treat a differing value as a conflict and write nothing.
// A baseline run therefore uses records that already match the table; the change under test comes after it.
const BASELINE_RECORDS = [
	{ id: 'recA', fields: { fldTitle: 'Rooftop', fldNotes: 'dawn', fldClient: ['recX'] } },
	{ id: 'recB', fields: { fldTitle: '' } },
	{ id: 'recC', fields: { fldTitle: 'Studio', fldNotes: 'hall' } },
];

function linkedDocument(): NativeLinkDocument {
	return {
		...newNativeLink({ databaseId: DB, tableId: TABLE, target: TARGET }),
		rowMap: { [ROW_ONE]: 'recA', [ROW_TWO]: 'recB', [ROW_THREE]: 'recC' },
	};
}

describe('native sync run: mapping (R5 Part C, Step 4)', () => {
	it('matches by display name, keys the result by field ID, and reports what did not match', async () => {
		const { port } = await rig();
		const { target } = fakeTarget({
			fields: [
				...REMOTE_FIELDS.slice(0, 1),
				{ id: 'fldExtra', name: 'Extra', type: 'number' },
			],
			records: [],
		});
		const mapping = await mappingFor(target, port, linkedDocument());
		expect(mapping.fieldMap).toEqual({ [TITLE]: 'fldTitle' });
		expect(mapping.unmapped).toEqual(
			expect.arrayContaining([
				{ side: 'local', name: 'Notes' },
				{ side: 'remote', name: 'Extra' },
			]),
		);
	});

	it('keeps a stored mapping through a local rename, because it is keyed by field ID', async () => {
		const { port, store } = await rig();
		store.dispatch(
			{ kind: 'rename-field', tableId: TABLE, fieldId: TITLE, name: 'Heading' },
			'rename',
		);
		const { target } = fakeTarget({
			fields: [{ id: 'fldTitle', name: 'Caption', type: 'singleLineText' }],
			records: [],
		});
		const mapping = await mappingFor(target, port, {
			...linkedDocument(),
			fieldMap: { [TITLE]: 'fldTitle' },
		});
		expect(mapping.fieldMap).toEqual({ [TITLE]: 'fldTitle' });
	});

	it('refuses to guess when two synced fields share a display name', async () => {
		const { port } = await rig(true);
		const { target } = fakeTarget({ fields: REMOTE_FIELDS, records: [] });
		const mapping = await mappingFor(target, port, linkedDocument());
		expect(mapping.fieldMap).not.toHaveProperty(TITLE);
		expect(mapping.fieldMap).not.toHaveProperty(TITLE_TWO);
		expect(mapping.unmapped).toContainEqual({ side: 'local', name: 'Title' });
	});
});

describe('native sync run: pull and push', () => {
	it('pulls a remote change into the table and saves the agreed snapshot under remote IDs', async () => {
		const { port } = await rig();
		const baseline = fakeTarget({ fields: REMOTE_FIELDS, records: BASELINE_RECORDS });
		const agreed = await runNativeSync({
			target: baseline.target,
			port,
			document: linkedDocument(),
			direction: 'pull',
			now: () => STAMP,
		});
		expect(agreed.report.plan.conflicts).toEqual([]);

		const { target, pulls } = fakeTarget({ fields: REMOTE_FIELDS, records: REMOTE_RECORDS });
		const result = await runNativeSync({
			target,
			port,
			document: agreed.document,
			direction: 'pull',
			now: () => '2026-10-08T11:00:00.000Z',
		});
		expect(pulls).toEqual([STAMP]);
		expect((await port.values(ROW_ONE))[TITLE]).toBe('Rooftop, remote');
		expect(result.document.fieldMap).toEqual({ [TITLE]: 'fldTitle', [NOTES]: 'fldNotes' });
		expect(result.document.lastPulledAt).toBe('2026-10-08T11:00:00.000Z');
		expect(Object.keys(result.document.snapshot.recA ?? {}).sort()).toEqual([
			'fldNotes',
			'fldTitle',
		]);
		expect(result.excluded.map((field) => field.fieldId)).toEqual([CLIENT]);
	});

	it('pushes only the local edit, keyed by remote field ID, after an agreed pull', async () => {
		const { port, store } = await rig();
		const first = fakeTarget({ fields: REMOTE_FIELDS, records: BASELINE_RECORDS });
		const pulled = await runNativeSync({
			target: first.target,
			port,
			document: linkedDocument(),
			direction: 'pull',
			now: () => STAMP,
		});

		store.dispatch(
			{
				kind: 'set-cells',
				tableId: TABLE,
				rowId: ROW_ONE,
				edits: [{ fieldId: TITLE, value: 'Rooftop, edited' }],
			},
			'edit',
		);
		const second = fakeTarget({ fields: REMOTE_FIELDS, records: REMOTE_RECORDS });
		const pushed = await runNativeSync({
			target: second.target,
			port,
			document: pulled.document,
			direction: 'push',
			now: () => STAMP,
		});

		expect(second.pulls).toEqual([]);
		expect(second.pushes).toEqual([
			{ recordId: 'recA', fields: { fldTitle: 'Rooftop, edited' } },
		]);
		expect(pushed.document.lastPushedAt).toBe(STAMP);
		expect(pushed.document.lastPulledAt).toBe(pulled.document.lastPulledAt);
	});

	it('writes nothing locally when the remote read is truncated, and does not push', async () => {
		const { port } = await rig();
		const { target, pushes } = fakeTarget({
			fields: REMOTE_FIELDS,
			records: REMOTE_RECORDS,
			truncated: true,
		});
		const before = (await port.values(ROW_ONE))[TITLE];
		const result = await runNativeSync({
			target,
			port,
			document: linkedDocument(),
			direction: 'both',
			now: () => STAMP,
		});
		expect((await port.values(ROW_ONE))[TITLE]).toBe(before);
		expect(result.report.pull).toBeNull();
		expect(result.report.push).toBeNull();
		expect(pushes).toEqual([]);
	});
});
