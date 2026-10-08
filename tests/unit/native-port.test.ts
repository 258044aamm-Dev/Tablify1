import { describe, expect, it } from 'vitest';

import { createWriteQueue } from '../../src/adapters/tablifyFile/queue';
import { openDatabase } from '../../src/adapters/tablifyFile/session';
import { createDatabaseStore } from '../../src/adapters/tablifyFile/databaseStore';
import type { DatabaseStore } from '../../src/adapters/tablifyFile/databaseStore';
import { createNativeSyncPort } from '../../src/sync/nativePort';
import type { NativeSyncPort } from '../../src/sync/nativePort';
import { createFakeClock } from '../fakes/clock';
import { createFakePort } from '../fakes/tablifyFile';

const PATH = 'Databases/Sync.tablify';
const DB = 'db_' + 'z'.repeat(26);
const TABLE = 'tbl_' + 'a'.repeat(26);
const OTHER = 'tbl_' + 'b'.repeat(26);
const TITLE = 'fld_' + 'a'.repeat(26);
const NOTES = 'fld_' + 'b'.repeat(26);
const CLIENT = 'fld_' + 'c'.repeat(26);
const ROW_ONE = 'row_' + '1'.repeat(26);
const ROW_TWO = 'row_' + '2'.repeat(26);
const ROW_THREE = 'row_' + '3'.repeat(26);
const CLIENT_ROW = 'row_' + '9'.repeat(26);

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
				fields: [
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
				],
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

async function rig(): Promise<{ store: DatabaseStore; port: NativeSyncPort }> {
	const fake = createFakePort({ [PATH]: documentText() });
	const opened = await openDatabase(fake, PATH);
	if (!opened.ok) {
		throw new Error('the native-port fixture must open');
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

describe('native sync port: reads', () => {
	it('lists rows in manual order, labelled by the first text value', async () => {
		const { port } = await rig();
		const rows = await port.rows();
		expect(rows.map((row) => row.path)).toEqual([ROW_ONE, ROW_TWO, ROW_THREE]);
		expect(rows[0]?.label).toBe('Rooftop');
		expect(rows[1]?.label).toBe(ROW_TWO);
	});

	it('answers values keyed by field ID, and leaves out link cells', async () => {
		const { port } = await rig();
		const values = await port.values(ROW_ONE);
		expect(values).toEqual({ [TITLE]: 'Rooftop', [NOTES]: 'dawn' });
		expect(values).not.toHaveProperty(CLIENT);
	});

	it('reports a deleted row as absent, not as an error', async () => {
		const { port } = await rig();
		expect(await port.has(ROW_ONE)).toBe(true);
		expect(await port.has('row_' + 'x'.repeat(26))).toBe(false);
		expect(await port.values('row_' + 'x'.repeat(26))).toEqual({});
	});

	it('uses the property name as identity, so the engine keys by field ID', async () => {
		const { port } = await rig();
		expect(port.propertyIdOf(TITLE)).toBe(TITLE);
	});
});

describe('native sync port: which fields sync', () => {
	it('offers the writable fields by ID, and names the excluded link with a reason', async () => {
		const { port } = await rig();
		expect(port.syncFields().map((field) => field.definition.name)).toEqual([TITLE, NOTES]);
		const excluded = port.excludedFields();
		expect(excluded).toEqual([
			{
				fieldId: CLIENT,
				name: 'Client',
				reason: 'Linked records are not synced yet. The link is left as it is.',
			},
		]);
	});

	it('keeps the field ID stable when the field is renamed, so the mapping does not move', async () => {
		const { port, store } = await rig();
		const renamed = store.dispatch(
			{ kind: 'rename-field', tableId: TABLE, fieldId: TITLE, name: 'Heading' },
			'rename',
		);
		expect(renamed.ok).toBe(true);
		expect(port.syncFields().map((field) => field.definition.name)).toContain(TITLE);
		expect(port.columnNameOf(TITLE)).toBe('Heading');
		expect((await port.values(ROW_ONE))[TITLE]).toBe('Rooftop');
	});
});

describe('native sync port: apply', () => {
	it('writes several rows as one batch and one undo step', async () => {
		const { port, store } = await rig();
		const result = await port.apply({
			label: 'Pull from remote',
			ops: [
				{
					kind: 'setCells',
					writes: [
						{ filePath: ROW_ONE, fieldId: TITLE, value: 'Rooftop, dawn' },
						{ filePath: ROW_THREE, fieldId: NOTES, value: 'hall, lit' },
					],
				},
			],
		});
		expect(result.ok).toBe(true);
		expect(result.written).toBe(2);
		expect(result.files).toEqual([ROW_ONE, ROW_THREE]);
		expect((await port.values(ROW_ONE))[TITLE]).toBe('Rooftop, dawn');
		expect((await port.values(ROW_THREE))[NOTES]).toBe('hall, lit');

		const undone = store.undo();
		expect(undone.ok).toBe(true);
		expect((await port.values(ROW_ONE))[TITLE]).toBe('Rooftop');
		expect((await port.values(ROW_THREE))[NOTES]).toBe('hall');
	});

	it('refuses a write to a link field and writes nothing, so a batch never lands half-applied', async () => {
		const { port } = await rig();
		const result = await port.apply({
			label: 'Pull from remote',
			ops: [
				{
					kind: 'setCells',
					writes: [
						{ filePath: ROW_ONE, fieldId: TITLE, value: 'Changed' },
						{ filePath: ROW_ONE, fieldId: CLIENT, value: 'not a record id' },
					],
				},
			],
		});
		expect(result.ok).toBe(false);
		expect(result.written).toBe(0);
		expect(result.refused).toEqual([
			{
				filePath: ROW_ONE,
				propertyId: CLIENT,
				reason: 'readonly-column',
				message: 'This field cannot be written from a sync.',
			},
		]);
		expect((await port.values(ROW_ONE))[TITLE]).toBe('Rooftop');
	});

	it('refuses an operation the native table does not support, rather than guessing at it', async () => {
		const { port } = await rig();
		const result = await port.apply({
			label: 'Pull from remote',
			ops: [{ kind: 'clearCells', cells: [] }],
		});
		expect(result.ok).toBe(false);
		expect(result.errors[0]?.message).toContain('is not supported for a native table');
		expect(await port.has(ROW_ONE)).toBe(true);
	});

	it('reports an apply against a deleted table as an error rather than throwing', async () => {
		const { port, store } = await rig();
		store.dispatch({ kind: 'delete-table', tableId: TABLE }, 'delete');
		expect(await port.rows()).toEqual([]);
		const result = await port.apply({ label: 'Pull', ops: [{ kind: 'setCells', writes: [] }] });
		expect(result.ok).toBe(false);
		expect(result.errors[0]?.message).toContain('no longer in this database');
	});
});
