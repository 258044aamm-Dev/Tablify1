/**
 * The `.tablify` file view — R2 step 6, driven the way Obsidian drives it.
 *
 * Everything here goes through the plugin's real `onload`: the file view type and the extension are
 * registered, the create command is invoked by calling it, and the view itself is built by the
 * factory Obsidian would call, then loaded with a file. The vault is the in-memory double, so "the
 * file changed on disk" is a method call and "was anything written" is a list.
 *
 * What this proves: routing (`.tablify` → this view), create → open, the R4 database/table/view
 * shell, table-scoped pane navigation, table/view creation through the shared operation store, and
 * the R2 unreadable-file/conflict paths. It also checks that opening, restoring, renaming and
 * navigation never write. Obsidian's real-device lifecycle probes remain NOT RUN until the user runs
 * the R2 probe kit.
 */
import { describe, expect, it } from 'vitest';

import TablifyPlugin from '../../src/plugin/main';
import {
	TABLIFY_FILE_EXTENSION,
	TABLIFY_FILE_VIEW_TYPE,
	TablifyFileView,
} from '../../src/plugin/TablifyFileView';
import { parseDocument } from '../../src/core/database/index';
import { Plugin, noticeLog } from '../mocks/obsidian';
import { createFakeVaultFile } from '../fakes/vaultFile';
import { augment } from './support/dom';
import { makeTFile } from '../fakes/vaultFile';
import type { FakeVaultFile } from '../fakes/vaultFile';

const PATH = 'Databases/Studio.tablify';
const COPIED = 'Databases/Studio (copy).tablify';

function table(id: string, name: string, rows: number): Record<string, unknown> {
	const fieldId = `fld_${'c'.repeat(25)}${id.slice(-1)}`;
	return {
		id,
		name,
		fields: [{ id: fieldId, name: 'Title', type: 'text' }],
		rows: Array.from({ length: rows }, (_, index) => ({
			id: `row_${'e'.repeat(25)}${String(index % 10)}`,
			cells: { [fieldId]: `${name} ${String(index + 1)}` },
		})),
		views: [
			{
				id: `viw_${'d'.repeat(25)}${id.slice(-1)}`,
				name: 'Board',
				sorts: [{ fieldId, direction: 'asc' }],
				density: 'tall',
				frozenPrimary: true,
			},
		],
	};
}

const FIRST_TABLE = `tbl_${'a'.repeat(25)}1`;
const SECOND_TABLE = `tbl_${'a'.repeat(25)}2`;
const FIRST_VIEW = `viw_${'d'.repeat(25)}1`;

function databaseText(name = 'Studio'): string {
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: `db_${'z'.repeat(26)}`,
		name,
		tables: [
			table(`tbl_${'a'.repeat(25)}1`, 'Shoots', 2),
			table(`tbl_${'a'.repeat(25)}2`, 'Clients', 1),
		],
	});
}

interface FakeLeaf {
	readonly opened: string[];
	readonly viewStub: { readonly app: unknown };
}

interface Rig {
	readonly plugin: Plugin;
	readonly vault: FakeVaultFile;
	readonly leaf: FakeLeaf;
}

function loadPlugin(initial: Record<string, string>): Rig {
	const vault = createFakeVaultFile(initial);
	const opened: string[] = [];
	const leaf: FakeLeaf = {
		opened,
		viewStub: { app: null },
	};
	// The plugin's other features read a couple of vault members this double does not model
	// (`getMarkdownFiles` for the settings tab, `adapter` for the sync badge). Both are added here so
	// the file-view path is exercised on the real `onload` rather than on a sliced-down one; the port
	// only ever sees the members `VaultSlice` names.
	const appVault = {
		...vault,
		getMarkdownFiles: (): unknown[] => [],
		adapter: {
			list: (): Promise<{ files: string[]; folders: string[] }> =>
				Promise.resolve({ files: [], folders: [] }),
		},
	};
	const app = {
		vault: appVault,
		workspace: {
			getLeavesOfType: (): unknown[] => [],
			getMostRecentLeaf: (): null => null,
			onLayoutReady: (callback: () => unknown): void => {
				void callback();
			},
			on: (): { readonly name: string } => ({ name: 'event-ref' }),
			getLeaf: (): unknown => ({
				view: leaf.viewStub,
				openFile: (file: { path: string }): Promise<void> => {
					opened.push(file.path);
					return Promise.resolve();
				},
			}),
		},
	};
	const plugin = new Plugin();
	plugin.app = app;
	Reflect.apply(TablifyPlugin.prototype.onload, plugin, []);
	return { plugin, vault, leaf };
}

async function flush(): Promise<void> {
	await new Promise((resolve) => window.setTimeout(resolve, 0));
}

function viewFactory(plugin: Plugin): (leaf: unknown) => unknown {
	const registered = plugin.registeredFileViewTypes.find(
		(entry) => entry.type === TABLIFY_FILE_VIEW_TYPE,
	);
	if (registered === undefined) {
		throw new Error('the plugin must register the file view type');
	}
	return registered.factory;
}

/** Build the view Obsidian would build and hand it a file, with a real element to render into. */
async function openPane(rig: Rig, path: string): Promise<TablifyFileView> {
	const view = viewFactory(rig.plugin)({ view: rig.leaf.viewStub });
	if (!(view instanceof TablifyFileView)) {
		throw new Error('the factory must build the file view');
	}
	view.containerEl = augment(document.createElement('div'));
	// Obsidian calls `onLoadFile` when a file is assigned to a file view; the probe kit measures the
	// real sequencing, this test drives the hook the documentation names.
	await view.onLoadFile(makeTFile(path));
	return view;
}

function text(view: TablifyFileView): string {
	return view.containerEl.textContent ?? '';
}

function button(view: TablifyFileView, label: string): HTMLButtonElement {
	const found = Array.from(view.containerEl.querySelectorAll('button')).find(
		(candidate) => candidate.textContent === label,
	);
	if (found === undefined) {
		throw new Error(`no button labelled "${label}"`);
	}
	return found;
}

function selector(view: TablifyFileView, label: string): HTMLSelectElement {
	const found = Array.from(view.containerEl.querySelectorAll('select')).find(
		(candidate) => candidate.getAttribute('aria-label') === label,
	);
	if (found === undefined) {
		throw new Error(`no select labelled "${label}"`);
	}
	return found;
}

function submitName(view: TablifyFileView, name: string): void {
	const input = view.containerEl.querySelector<HTMLInputElement>('.tablify-native-name-input');
	if (input === null) {
		throw new Error('the name form must contain an input');
	}
	input.value = name;
	const form = input.closest('form');
	if (form === null) {
		throw new Error('the name input must belong to a form');
	}
	form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('registration and routing', () => {
	it('registers the file view type and claims the .tablify extension for it', () => {
		const { plugin } = loadPlugin({});
		expect(plugin.registeredFileViewTypes.map((entry) => entry.type)).toEqual([
			TABLIFY_FILE_VIEW_TYPE,
		]);
		expect(plugin.registeredExtensions).toEqual([
			{ extensions: [TABLIFY_FILE_EXTENSION], viewType: TABLIFY_FILE_VIEW_TYPE },
		]);
	});

	it('routes a .tablify file to the view and nothing else to it', async () => {
		const rig = loadPlugin({ [PATH]: databaseText() });
		const view = await openPane(rig, PATH);
		expect(view.canAcceptExtension('tablify')).toBe(true);
		expect(view.canAcceptExtension('md')).toBe(false);
		expect(view.canAcceptExtension('base')).toBe(false);
	});
});

describe('the create command', () => {
	it('writes a valid database and opens it in a leaf', async () => {
		const rig = loadPlugin({});
		const command = rig.plugin.commands.find((entry) => entry.id === 'create-database');
		expect(command).toBeDefined();
		command?.callback();
		await flush();

		const text = rig.vault.files.get('Untitled.tablify');
		expect(text).toBeDefined();
		const parsed = parseDocument(text ?? '');
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.warnings).toEqual([]);
			expect(parsed.document.name).toBe('Untitled');
		}
		expect(rig.leaf.opened).toEqual(['Untitled.tablify']);
	});

	it('never overwrites: a second database is Untitled 2', async () => {
		const rig = loadPlugin({ 'Untitled.tablify': databaseText('First') });
		rig.plugin.commands.find((entry) => entry.id === 'create-database')?.callback();
		await flush();
		expect(rig.vault.files.has('Untitled 2.tablify')).toBe(true);
		expect(rig.vault.files.get('Untitled.tablify')).toBe(databaseText('First'));
	});
});

describe('a readable document', () => {
	it('renders the database/table/view shell, and opening it writes nothing', async () => {
		const rig = loadPlugin({ [PATH]: databaseText() });
		const view = await openPane(rig, PATH);
		const shown = text(view);
		expect(shown).toContain('Studio');
		expect(shown).toContain('2 tables · 3 rows');
		expect(shown).toContain('Shoots');
		expect(shown).toContain('Clients');
		expect(shown).toContain('Default view');
		expect(shown).toContain('Saved');
		expect(
			view.containerEl.querySelector('[role="group"][aria-label="Database actions"]'),
		).not.toBeNull();
		expect(
			view.containerEl.querySelector('[role="region"][aria-label="Grid for Shoots"]'),
		).not.toBeNull();
		expect(rig.vault.writes).toEqual([]);
	});

	it('restores a table and only restores a view scoped to that table', async () => {
		const rig = loadPlugin({ [PATH]: databaseText() });
		const view = await openPane(rig, PATH);
		await view.setState({ tableId: FIRST_TABLE, viewId: FIRST_VIEW }, { history: false });
		expect(selector(view, 'Table').value).toBe(FIRST_TABLE);
		expect(selector(view, 'Saved view').value).toBe(FIRST_VIEW);
		expect(view.getState()).toEqual({ tableId: FIRST_TABLE, viewId: FIRST_VIEW });

		await view.setState({ tableId: SECOND_TABLE, viewId: FIRST_VIEW }, { history: false });
		expect(selector(view, 'Table').value).toBe(SECOND_TABLE);
		expect(selector(view, 'Saved view').value).toBe('');
		expect(view.getState()).toEqual({ tableId: SECOND_TABLE, viewId: null });
		expect(rig.vault.writes).toEqual([]);
	});

	it('switches tables as pane navigation and writes nothing', async () => {
		const rig = loadPlugin({ [PATH]: databaseText() });
		const view = await openPane(rig, PATH);
		const tables = selector(view, 'Table');
		expect(tables.value).toBe(FIRST_TABLE);
		tables.value = SECOND_TABLE;
		tables.dispatchEvent(new Event('change'));
		expect(selector(view, 'Table').value).toBe(SECOND_TABLE);
		expect(view.getState()).toEqual({ tableId: SECOND_TABLE, viewId: null });
		expect(rig.vault.writes).toEqual([]);
	});

	it('switches saved views as pane navigation and writes nothing', async () => {
		const rig = loadPlugin({ [PATH]: databaseText() });
		const view = await openPane(rig, PATH);
		const views = selector(view, 'Saved view');
		expect(views.value).toBe('');
		views.value = FIRST_VIEW;
		views.dispatchEvent(new Event('change'));
		expect(selector(view, 'Saved view').value).toBe(FIRST_VIEW);
		expect(view.getState()).toEqual({ tableId: FIRST_TABLE, viewId: FIRST_VIEW });
		// A saved view is scoped to one table; merely showing it is workspace state.
		expect(rig.vault.writes).toEqual([]);
	});

	it('keeps table and view selections pane-local while sharing one database session', async () => {
		const rig = loadPlugin({ [PATH]: databaseText() });
		const first = await openPane(rig, PATH);
		const second = await openPane(rig, PATH);
		const firstView = selector(first, 'Saved view');
		firstView.value = FIRST_VIEW;
		firstView.dispatchEvent(new Event('change'));
		const secondTable = selector(second, 'Table');
		secondTable.value = SECOND_TABLE;
		secondTable.dispatchEvent(new Event('change'));

		expect(first.handle()?.session).toBe(second.handle()?.session);
		expect(first.getState()).toEqual({ tableId: FIRST_TABLE, viewId: FIRST_VIEW });
		expect(second.getState()).toEqual({ tableId: SECOND_TABLE, viewId: null });
		expect(rig.vault.writes).toEqual([]);
		await first.onClose();
		await second.onClose();
	});

	it('creates a table through one database operation and saves through the shared queue', async () => {
		const rig = loadPlugin({ [PATH]: databaseText() });
		const view = await openPane(rig, PATH);
		button(view, 'Create table').click();
		submitName(view, 'Prospects');
		const handle = view.handle();
		if (handle === null) {
			throw new Error('the pane must hold a handle');
		}
		const created = handle.session.getDocument().tables.at(-1);
		expect(created?.name).toBe('Prospects');
		expect(view.getState()).toEqual({ tableId: created?.id ?? null, viewId: null });
		expect(handle.session.getHistorySummary().depth).toBe(1);
		expect(rig.vault.writes).toEqual([]);

		const saved = await handle.session.flush();
		expect(saved.ok).toBe(true);
		await flush();
		expect(rig.vault.writes).toEqual([PATH]);
		await view.onClose();
	});

	it('creates a table-scoped saved view and restores its selection without navigation writes', async () => {
		const rig = loadPlugin({ [PATH]: databaseText() });
		const view = await openPane(rig, PATH);
		button(view, 'Create view').click();
		submitName(view, 'Prospects board');
		const handle = view.handle();
		if (handle === null) {
			throw new Error('the pane must hold a handle');
		}
		const selectedTable = handle.session
			.getDocument()
			.tables.find((table) => table.id === FIRST_TABLE);
		const created = selectedTable?.views.at(-1);
		expect(created?.name).toBe('Prospects board');
		expect(view.getState()).toEqual({ tableId: FIRST_TABLE, viewId: created?.id ?? null });
		expect(rig.vault.writes).toEqual([]);

		const saved = await handle.session.flush();
		expect(saved.ok).toBe(true);
		await flush();
		expect(rig.vault.writes).toEqual([PATH]);
		await view.onClose();
	});

	it('says the file changed on disk without writing anything', async () => {
		const rig = loadPlugin({ [PATH]: databaseText() });
		const view = await openPane(rig, PATH);
		rig.vault.simulateExternalModify(PATH, databaseText('Renamed elsewhere'));
		await flush();
		expect(text(view)).toContain('The file changed on disk');
		expect(rig.vault.writes).toEqual([]);
	});

	it('survives a rename, and closing the pane releases everything', async () => {
		const rig = loadPlugin({ [PATH]: databaseText() });
		const view = await openPane(rig, PATH);
		rig.vault.simulateRename(PATH, 'Databases/Moved.tablify');
		await view.onRename(makeTFile('Databases/Moved.tablify'));
		expect(rig.vault.writes).toEqual([]);
		expect(view.handle()?.session.path).toBe('Databases/Moved.tablify');

		await view.onUnloadFile(makeTFile('Databases/Moved.tablify'));
		expect(view.handle()).toBeNull();
		expect(rig.vault.writes).toEqual([]);
	});

	it('releases the registry when the plugin unloads', async () => {
		const rig = loadPlugin({ [PATH]: databaseText() });
		const view = await openPane(rig, PATH);
		expect(rig.vault.listenerCount()).toBeGreaterThan(0);
		rig.plugin.onunload();
		await flush();
		expect(rig.vault.listenerCount()).toBe(0);
		await view.onUnloadFile(makeTFile(PATH));
	});
});

describe('a document that cannot be read', () => {
	it('shows why, read-only, and writes nothing', async () => {
		const rig = loadPlugin({ [PATH]: '{"format":"tablify","version":1,' });
		const view = await openPane(rig, PATH);
		expect(text(view)).toContain('not readable as a Tablify database');
		expect(text(view)).toContain('Nothing was written');
		expect(text(view)).toContain('invalid-json');
		expect(rig.vault.writes).toEqual([]);
		expect(view.handle()).toBeNull();
	});

	it('says a newer version wrote the file rather than guessing at it', async () => {
		const rig = loadPlugin({ [PATH]: databaseText().replace('"version":1', '"version":9') });
		const view = await openPane(rig, PATH);
		expect(text(view)).toContain('newer version of the plugin');
		expect(rig.vault.writes).toEqual([]);
	});

	it('says the file is gone when it has been deleted underneath the pane', async () => {
		const rig = loadPlugin({});
		const view = await openPane(rig, PATH);
		expect(text(view)).toContain('There is no file at this path');
		expect(view.handle()).toBeNull();
	});
});

describe('a conflict is a choice, never a silent write', () => {
	async function conflicted(): Promise<{ rig: Rig; view: TablifyFileView }> {
		const rig = loadPlugin({ [PATH]: databaseText() });
		const view = await openPane(rig, PATH);
		const handle = view.handle();
		if (handle === null) {
			throw new Error('the pane must hold a handle');
		}
		const fieldId = `fld_${'c'.repeat(25)}1`;
		const applied = handle.session.dispatch({
			kind: 'set-cells',
			tableId: `tbl_${'a'.repeat(25)}1`,
			rowId: `row_${'e'.repeat(25)}0`,
			edits: [{ fieldId, value: 'Edited in the pane' }],
		});
		expect(applied.ok).toBe(true);
		rig.vault.simulateExternalModify(PATH, databaseText('Edited elsewhere'));
		await flush();
		return { rig, view };
	}

	it('offers both ways out', async () => {
		const { view } = await conflicted();
		expect(text(view)).toContain('Conflict');
		expect(button(view, 'Reload from disk')).toBeDefined();
		expect(button(view, 'Keep a copy')).toBeDefined();
	});

	it('reload adopts the disk text and writes nothing', async () => {
		const { rig, view } = await conflicted();
		button(view, 'Reload from disk').click();
		await flush();
		const shown = text(view);
		expect(shown).toContain('Edited elsewhere');
		expect(shown).toContain('Saved');
		expect(rig.vault.writes).toEqual([]);
	});

	it('keep a copy writes the in-memory text to a new path', async () => {
		const { rig, view } = await conflicted();
		button(view, 'Keep a copy').click();
		await flush();
		expect(rig.vault.files.has(COPIED)).toBe(true);
		expect(rig.vault.files.get(COPIED) ?? '').toContain('Edited in the pane');
		expect(rig.vault.writes).toEqual([]);
		expect(noticeLog.some((message) => message.includes(COPIED))).toBe(true);
		expect(view.handle()?.session.getState()).toBe('detached');
	});
});
