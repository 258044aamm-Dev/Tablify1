/**
 * The native CSV export panel, driven in a real jsdom element through its own controls.
 *
 * What is proved: the scope and omissions the panel states are the ones the core matrix computes from the **real
 * store** (the same document path the grid's store uses), the file name and folder follow the existing export
 * convention, the line-ending choice reaches the bytes written, a failed write is reported and leaves nothing
 * behind, and a name collision takes a suffix. The vault is a recording double; the Obsidian `Vault` itself is
 * not exercised here (NOT RUN in a real host).
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabaseStore } from '../../src/adapters/tablifyFile/databaseStore';
import { createWriteQueue } from '../../src/adapters/tablifyFile/queue';
import { openDatabase } from '../../src/adapters/tablifyFile/session';
import type { DatabaseStore } from '../../src/adapters/tablifyFile/databaseStore';
import { toCsv } from '../../src/core/export/csv';
import { toXlsxData } from '../../src/core/export/serialize';
import type { XlsxRow } from '../../src/core/export/serialize';
import type { XlsxResult } from '../../src/plugin/export/xlsx';
import { fromTsv } from '../../src/core/selection/clipboard';
import { serializeDocument } from '../../src/core/database';
import type { DatabaseDocument, DatabaseTable } from '../../src/core/database';
import type { TableField } from '../../src/core/database/fields';
import type { CellState, TableRow } from '../../src/core/database/rows';
import { NativeExportPanel } from '../../src/plugin/nativeExport/NativeExportPanel';
import type { NativeExportVault } from '../../src/plugin/nativeExport/NativeExportPanel';
import { createFakeClock } from '../fakes/clock';
import { createFakePort } from '../fakes/tablifyFile';
import { augment } from './support/dom';

const PATH = 'Databases/Native-export-panel.tablify';

const FIELDS: readonly TableField[] = [
	{ kind: 'field', id: 'fld_name', name: 'Name', type: 'text', settings: {}, unknown: [] },
	{ kind: 'field', id: 'fld_done', name: 'Done', type: 'checkbox', settings: {}, unknown: [] },
	{
		kind: 'field',
		id: 'fld_link',
		name: 'Refers',
		type: 'link',
		settings: { targetTableId: 'tbl_main' },
		unknown: [],
	},
];

function row(id: string, cells: ReadonlyMap<string, CellState>): TableRow {
	return { id, cells, createdAt: null, updatedAt: null, unknown: [] };
}

function documentWithRows(): DatabaseDocument {
	const table: DatabaseTable = {
		id: 'tbl_main',
		name: 'Main',
		fields: FIELDS,
		rows: [
			row(
				'row_one',
				new Map<string, CellState>([
					['fld_name', 'Ada, Countess'],
					['fld_done', true],
				]),
			),
			row(
				'row_two',
				new Map<string, CellState>([
					['fld_name', '=SUM(A1:A9)'],
					['fld_done', false],
				]),
			),
		],
		views: [],
		unknown: [],
	};
	return {
		format: 'tablify',
		version: 1,
		databaseId: `db_${'x'.repeat(26)}`,
		name: 'Export panel',
		tables: [table],
		unknown: [],
	};
}

interface Rig {
	readonly store: DatabaseStore;
	close(): Promise<void>;
}

async function rig(): Promise<Rig> {
	const port = createFakePort({ [PATH]: serializeDocument(documentWithRows()) });
	const opened = await openDatabase(port, PATH);
	if (!opened.ok) {
		throw new Error('the export fixture must open');
	}
	const queue = createWriteQueue(opened.session, {
		scheduler: createFakeClock(),
		debounceMs: 400,
	});
	const store = createDatabaseStore({ session: opened.session, queue });
	return {
		store,
		async close(): Promise<void> {
			store.dispose();
			await queue.close({ flush: false });
		},
	};
}

interface RecordingVault extends NativeExportVault {
	readonly writes: { readonly path: string; readonly text: string | ArrayBuffer }[];
	readonly folders: string[];
}

function vault(
	options: { readonly existing?: readonly string[]; readonly failCreate?: boolean } = {},
): RecordingVault {
	const existing = new Set(options.existing ?? []);
	const writes: { path: string; text: string | ArrayBuffer }[] = [];
	const folders: string[] = [];
	return {
		writes,
		folders,
		exists: (path) => existing.has(path),
		createFolder: async (path) => {
			folders.push(path);
		},
		create: async (path, text) => {
			if (options.failCreate === true) {
				throw new Error('disk is read-only');
			}
			existing.add(path);
			writes.push({ path, text });
		},
	};
}

const mounted: HTMLElement[] = [];
const NOW = new Date(2026, 9, 8, 12, 30);

function mount(
	store: DatabaseStore,
	recorder: RecordingVault,
	writeXlsx?: (rows: readonly XlsxRow[], name: string) => Promise<XlsxResult>,
) {
	const root = augment(document.createElement('div'));
	document.body.append(root);
	mounted.push(root);
	const announced: string[] = [];
	const panel = new NativeExportPanel(root, {
		store,
		environment: { now: () => NOW.getTime(), timezone: 'UTC', locale: 'en-GB' },
		vault: recorder,
		now: () => NOW,
		writeXlsx,
		close: () => undefined,
		announce: (message) => {
			announced.push(message);
		},
	});
	return { root, panel, announced };
}

afterEach(() => {
	for (const root of mounted.splice(0)) {
		root.remove();
	}
});

describe('native CSV export panel', () => {
	it('states the exact scope and every omission before anything is written', async () => {
		const fixture = await rig();
		const { panel } = mount(fixture.store, vault());

		const lines = panel.scopeLines();
		expect(lines[0]).toBe('Whole table “Main”, in manual order: 2 row(s), 2 field(s).');
		expect(lines).toContain(
			'1 link field(s) are left out: linked records are not exported as IDs yet.',
		);
		expect(lines).toContain(
			'Saved view filters and sorts are not applied: the whole table is exported.',
		);
		expect(panel.lastOutcome()).toBeNull();
		await fixture.close();
	});

	it('writes one CSV into the export folder, named by the existing convention, and reports where', async () => {
		const fixture = await rig();
		const recorder = vault();
		const { panel, announced } = mount(fixture.store, recorder);

		await panel.exportNow();

		expect(recorder.folders).toEqual(['Tablify exports']);
		expect(recorder.writes).toHaveLength(1);
		expect(recorder.writes[0]?.path).toBe(
			'Tablify exports/Tablify export Main 2026-10-08 1230.csv',
		);
		expect(recorder.writes[0]?.text).toBe(
			toCsv([
				['Name', 'Done'],
				['Ada, Countess', 'Yes'],
				['=SUM(A1:A9)', 'No'],
			]),
		);
		expect(panel.lastOutcome()).toMatchObject({ kind: 'written', rows: 2 });
		expect(announced).toEqual([
			'Exported 2 row(s) to Tablify exports/Tablify export Main 2026-10-08 1230.csv.',
		]);
		await fixture.close();
	});

	it('uses LF when the person chooses it, and the bytes written carry no carriage returns', async () => {
		const fixture = await rig();
		const recorder = vault();
		const { root, panel } = mount(fixture.store, recorder);

		const select = root.querySelector<HTMLSelectElement>('select[aria-label="Line endings"]');
		if (select === null) {
			throw new Error('the line-ending choice must be on the panel');
		}
		select.value = 'lf';
		select.dispatchEvent(new Event('change'));
		await panel.exportNow();

		expect(recorder.writes[0]?.text).not.toContain('\r');
		const written = recorder.writes[0]?.text;
		expect(typeof written === 'string' && written.endsWith('\n')).toBe(true);
		await fixture.close();
	});

	it('reports a failed write visibly and creates no file', async () => {
		const fixture = await rig();
		const recorder = vault({ failCreate: true });
		const { root, panel, announced } = mount(fixture.store, recorder);

		await panel.exportNow();

		expect(recorder.writes).toHaveLength(0);
		expect(panel.lastOutcome()).toEqual({ kind: 'failed', message: 'disk is read-only' });
		expect(announced).toEqual(['Export failed: disk is read-only']);
		expect(root.textContent).toContain('Export failed: disk is read-only');
		await fixture.close();
	});

	it('writes a TSV file with the clipboard writer, and hides the CSV-only line endings', async () => {
		const fixture = await rig();
		const recorder = vault();
		const { root, panel } = mount(fixture.store, recorder);

		const tsv = root.querySelector<HTMLInputElement>(
			'input[name="tablify-export-format"][value="tsv"]',
		);
		if (tsv === null) {
			throw new Error('the TSV format must be offered');
		}
		tsv.checked = true;
		tsv.dispatchEvent(new Event('change'));

		expect(root.querySelector('select[aria-label="Line endings"]')).toBeNull();
		await panel.exportNow();

		expect(recorder.writes[0]?.path).toBe(
			'Tablify exports/Tablify export Main 2026-10-08 1230.tsv',
		);
		expect(recorder.writes[0]?.text).toBe('Name\tDone\nAda, Countess\tYes\n"=SUM(A1:A9)"\tNo');
		const written = recorder.writes[0]?.text;
		if (typeof written !== 'string') {
			throw new Error('a TSV export writes text');
		}
		expect(fromTsv(written)).toEqual([
			['Name', 'Done'],
			['Ada, Countess', 'Yes'],
			['=SUM(A1:A9)', 'No'],
		]);
		await fixture.close();
	});

	it('writes an XLSX workbook through the existing typed-cell writer, as bytes, to a .xlsx path', async () => {
		const fixture = await rig();
		const recorder = vault();
		const received: { rows: readonly XlsxRow[]; name: string }[] = [];
		const bytes = new ArrayBuffer(8);
		const fakeWriter = async (rows: readonly XlsxRow[], name: string): Promise<XlsxResult> => {
			received.push({ rows, name });
			return { bytes, name, writer: 'fake' };
		};
		const { root, panel, announced } = mount(fixture.store, recorder, fakeWriter);

		const xlsx = root.querySelector<HTMLInputElement>(
			'input[name="tablify-export-format"][value="xlsx"]',
		);
		if (xlsx === null) {
			throw new Error('the XLSX format must be offered');
		}
		xlsx.checked = true;
		xlsx.dispatchEvent(new Event('change'));
		expect(root.querySelector('select[aria-label="Line endings"]')).toBeNull();

		await panel.exportNow();

		expect(received).toHaveLength(1);
		expect(received[0]?.name).toBe('Tablify export Main 2026-10-08 1230.xlsx');
		expect(received[0]?.rows).toEqual(
			toXlsxData(
				[
					['Name', 'Done'],
					['Ada, Countess', 'Yes'],
					['=SUM(A1:A9)', 'No'],
				],
				[
					{ name: 'Name', type: 'text' },
					{ name: 'Done', type: 'checkbox' },
				],
			),
		);
		expect(recorder.writes).toEqual([
			{ path: 'Tablify exports/Tablify export Main 2026-10-08 1230.xlsx', text: bytes },
		]);
		expect(announced).toEqual([
			'Exported 2 row(s) to Tablify exports/Tablify export Main 2026-10-08 1230.xlsx.',
		]);
		await fixture.close();
	});

	it('takes a numbered name rather than overwriting an existing export', async () => {
		const fixture = await rig();
		const taken = 'Tablify exports/Tablify export Main 2026-10-08 1230.csv';
		const recorder = vault({ existing: [taken] });
		const { panel } = mount(fixture.store, recorder);

		await panel.exportNow();

		expect(recorder.writes[0]?.path).toBe(
			'Tablify exports/Tablify export Main 2026-10-08 1230 2.csv',
		);
		await fixture.close();
	});
});
