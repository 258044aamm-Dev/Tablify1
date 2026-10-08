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
			id: `row_${'e'.repeat(24)}${index.toString(36).padStart(2, '0')}`,
			cells: { [fieldId]: `${name} ${String(index + 1)}` },
		})),
		views: [
			{
				id: `viw_${'d'.repeat(25)}${id.slice(-1)}`,
				name: 'Board',
				sorts: [{ fieldId, direction: 'desc' }],
				density: 'tall',
				frozenPrimary: true,
			},
			{
				id: `viw_${'f'.repeat(25)}${id.slice(-1)}`,
				name: 'Only second',
				filter: {
					version: 1,
					expr: { kind: 'cmp', fieldId, op: 'contains', operand: '2' },
				},
			},
		],
	};
}

const FIRST_TABLE = `tbl_${'a'.repeat(25)}1`;
const SECOND_TABLE = `tbl_${'a'.repeat(25)}2`;
const FIRST_VIEW = `viw_${'d'.repeat(25)}1`;
const FILTERED_VIEW = `viw_${'f'.repeat(25)}1`;
const FIRST_FIELD = `fld_${'c'.repeat(25)}1`;
const SECOND_FIELD = `fld_${'c'.repeat(25)}2`;
const ROW_FIRST = `row_${'e'.repeat(24)}00`;
const ROW_SECOND = `row_${'e'.repeat(24)}01`;
const OPTION_OPEN = `opt_${'o'.repeat(26)}1`;
const OPTION_CLOSED = `opt_${'o'.repeat(26)}2`;
const LINK_FIELD = `fld_${'l'.repeat(25)}1`;
const MULTI_LINK_FIELD = `fld_${'m'.repeat(25)}1`;
const INVERSE_FIELD = `fld_${'n'.repeat(25)}1`;
const TARGET_ROW_ONE = `row_${'p'.repeat(24)}01`;
const TARGET_ROW_TWO = `row_${'q'.repeat(24)}02`;
const MISSING_TARGET_ROW = `row_${'r'.repeat(24)}99`;

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

function linkedDatabaseText(): string {
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: `db_${'y'.repeat(26)}`,
		name: 'Linked records',
		tables: [
			{
				id: FIRST_TABLE,
				name: 'Shoots',
				fields: [
					{ id: FIRST_FIELD, name: 'Title', type: 'text' },
					{
						id: LINK_FIELD,
						name: 'Client',
						type: 'link',
						targetTableId: SECOND_TABLE,
						allowMultiple: false,
						inverseFieldId: INVERSE_FIELD,
					},
					{
						id: MULTI_LINK_FIELD,
						name: 'Contacts',
						type: 'link',
						targetTableId: SECOND_TABLE,
						allowMultiple: true,
					},
				],
				rows: [
					{
						id: ROW_FIRST,
						cells: {
							[FIRST_FIELD]: 'Shoot A',
							[LINK_FIELD]: TARGET_ROW_ONE,
							[MULTI_LINK_FIELD]: [TARGET_ROW_ONE, TARGET_ROW_TWO],
						},
					},
					{
						id: ROW_SECOND,
						cells: {
							[FIRST_FIELD]: 'Shoot B',
							[LINK_FIELD]: MISSING_TARGET_ROW,
						},
					},
				],
				views: [
					{
						id: FILTERED_VIEW,
						name: 'Only B',
						filter: {
							version: 1,
							expr: {
								kind: 'cmp',
								fieldId: FIRST_FIELD,
								op: 'contains',
								operand: 'Shoot B',
							},
						},
					},
				],
			},
			{
				id: SECOND_TABLE,
				name: 'Clients',
				fields: [
					{ id: SECOND_FIELD, name: 'Name', type: 'text' },
					{
						id: INVERSE_FIELD,
						name: 'Shoots',
						type: 'link',
						targetTableId: FIRST_TABLE,
						allowMultiple: true,
						generated: true,
					},
				],
				rows: [
					{
						id: TARGET_ROW_ONE,
						cells: { [SECOND_FIELD]: 'Ada', [INVERSE_FIELD]: [ROW_SECOND] },
					},
					{ id: TARGET_ROW_TWO, cells: { [SECOND_FIELD]: 'Grace' } },
				],
				views: [],
			},
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

	it('projects active table IDs and saved view query/order into the native DOM grid', async () => {
		const rig = loadPlugin({ [PATH]: databaseText() });
		const view = await openPane(rig, PATH);
		const gridOf = (): HTMLTableElement => {
			const grid = view.containerEl.querySelector<HTMLTableElement>('[role="grid"]');
			if (grid === null) {
				throw new Error('the native table grid must be rendered');
			}
			return grid;
		};
		const rowIds = (grid: HTMLTableElement): string[] =>
			Array.from(grid.querySelectorAll<HTMLTableRowElement>('tbody tr[data-row-id]')).map(
				(row) => row.getAttribute('data-row-id') ?? '',
			);

		let grid = gridOf();
		expect(grid.getAttribute('data-table-id')).toBe(FIRST_TABLE);
		expect(grid.getAttribute('data-view-id')).toBe('');
		expect(grid.getAttribute('aria-label')).toBe('Grid for Shoots');
		expect(rowIds(grid)).toEqual([ROW_FIRST, ROW_SECOND]);
		const defaultCell = grid.querySelector<HTMLElement>(
			`[data-row-id="${ROW_FIRST}"][data-field-id="${FIRST_FIELD}"]`,
		);
		expect(defaultCell).not.toBeNull();

		const views = selector(view, 'Saved view');
		views.value = FIRST_VIEW;
		views.dispatchEvent(new Event('change'));
		grid = gridOf();
		expect(grid.getAttribute('aria-label')).toBe('Grid for Shoots — Board');
		expect(rowIds(grid)).toEqual([ROW_SECOND, ROW_FIRST]);
		expect(
			view.containerEl
				.querySelector<HTMLElement>('[role="region"]')
				?.style.getPropertyValue('--tablify-row-h'),
		).toBe('64px');

		views.value = FILTERED_VIEW;
		views.dispatchEvent(new Event('change'));
		grid = gridOf();
		expect(grid.getAttribute('data-view-id')).toBe(FILTERED_VIEW);
		expect(grid.getAttribute('aria-label')).toBe('Grid for Shoots — Only second');
		expect(rowIds(grid)).toEqual([ROW_SECOND]);
		const selected = grid.querySelector<HTMLElement>(
			`[data-row-id="${ROW_SECOND}"][data-field-id="${FIRST_FIELD}"]`,
		);
		selected?.click();
		expect(grid.getAttribute('aria-activedescendant')).toBe(selected?.id);
		expect(
			grid
				.querySelector(`[data-row-id="${ROW_SECOND}"][data-field-id="${FIRST_FIELD}"]`)
				?.getAttribute('aria-selected'),
		).toBe('true');

		const tables = selector(view, 'Table');
		tables.value = SECOND_TABLE;
		tables.dispatchEvent(new Event('change'));
		grid = gridOf();
		expect(grid.getAttribute('data-table-id')).toBe(SECOND_TABLE);
		expect(grid.getAttribute('aria-label')).toBe('Grid for Clients');
		expect(rowIds(grid)).toEqual([ROW_FIRST]);
		expect(
			grid.querySelector(`[data-row-id="${ROW_FIRST}"][data-field-id="${SECOND_FIELD}"]`),
		).not.toBeNull();
		expect(selector(view, 'Saved view').value).toBe('');

		const tablesBack = selector(view, 'Table');
		tablesBack.value = FIRST_TABLE;
		tablesBack.dispatchEvent(new Event('change'));
		expect(selector(view, 'Saved view').value).toBe(FILTERED_VIEW);
		grid = gridOf();
		expect(rowIds(grid)).toEqual([ROW_SECOND]);
		expect(rig.vault.writes).toEqual([]);
	});

	it('resolves link labels, surfaces broken IDs, derives read-only inverses, and navigates without losing saved views', async () => {
		const rig = loadPlugin({ [PATH]: linkedDatabaseText() });
		const view = await openPane(rig, PATH);
		const gridOf = (): HTMLTableElement => {
			const grid = view.containerEl.querySelector<HTMLTableElement>('[role="grid"]');
			if (grid === null) {
				throw new Error('the native link grid must be rendered');
			}
			return grid;
		};
		const linkedCell = view.containerEl.querySelector<HTMLElement>(
			`[data-row-id="${ROW_FIRST}"][data-field-id="${LINK_FIELD}"]`,
		);
		const multiCell = view.containerEl.querySelector<HTMLElement>(
			`[data-row-id="${ROW_FIRST}"][data-field-id="${MULTI_LINK_FIELD}"]`,
		);
		const brokenCell = view.containerEl.querySelector<HTMLElement>(
			`[data-row-id="${ROW_SECOND}"][data-field-id="${LINK_FIELD}"]`,
		);
		if (linkedCell === null || multiCell === null || brokenCell === null) {
			throw new Error('owning, multi-link and broken cells must all be rendered');
		}
		expect(linkedCell.textContent).toContain('Ada');
		expect(linkedCell.querySelector('[data-link-navigation]')?.getAttribute('aria-label')).toBe(
			'Open Ada in Clients',
		);
		expect(multiCell.textContent).toContain('Ada');
		expect(multiCell.textContent).toContain('Grace');
		expect(brokenCell.getAttribute('data-link-state')).toBe('broken');
		expect(brokenCell.textContent).toContain('Missing row');
		expect(brokenCell.getAttribute('aria-readonly')).toBe('false');
		expect(text(view)).toContain('display convention only, not a primary-field setting');

		const openTarget = linkedCell.querySelector<HTMLButtonElement>('[data-link-navigation]');
		if (openTarget === null) {
			throw new Error('an owning link must provide target-row navigation');
		}
		openTarget.click();
		let grid = gridOf();
		expect(grid.getAttribute('data-table-id')).toBe(SECOND_TABLE);
		expect(
			grid
				.querySelector(`[data-row-id="${TARGET_ROW_ONE}"][data-field-id="${SECOND_FIELD}"]`)
				?.getAttribute('aria-selected'),
		).toBe('true');
		let tables = selector(view, 'Table');
		tables.value = FIRST_TABLE;
		tables.dispatchEvent(new Event('change'));

		const views = selector(view, 'Saved view');
		views.value = FILTERED_VIEW;
		views.dispatchEvent(new Event('change'));
		expect(gridOf().querySelectorAll('tbody tr[data-row-id]')).toHaveLength(1);
		expect(gridOf().querySelector('tbody tr[data-row-id]')?.getAttribute('data-row-id')).toBe(
			ROW_SECOND,
		);

		tables = selector(view, 'Table');
		tables.value = SECOND_TABLE;
		tables.dispatchEvent(new Event('change'));
		let inverseCell = view.containerEl.querySelector<HTMLElement>(
			`[data-row-id="${TARGET_ROW_ONE}"][data-field-id="${INVERSE_FIELD}"]`,
		);
		if (inverseCell === null) {
			throw new Error('the generated inverse cell must be rendered in the target table');
		}
		expect(inverseCell.textContent).toContain('Shoots: Shoot A');
		expect(inverseCell.textContent).not.toContain('Shoot B');
		expect(inverseCell.textContent).toContain('Stored inverse data ignored');
		expect(inverseCell.getAttribute('aria-readonly')).toBe('true');
		inverseCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		expect(view.containerEl.querySelector('.tablify-native-link-editor')).toBeNull();

		const openSource = inverseCell.querySelector<HTMLButtonElement>('[data-link-navigation]');
		if (openSource === null) {
			throw new Error('a derived inverse must provide an accessible navigation button');
		}
		openSource.click();
		grid = gridOf();
		expect(grid.getAttribute('data-table-id')).toBe(FIRST_TABLE);
		expect(grid.getAttribute('data-view-id')).toBe('');
		expect(
			Array.from(grid.querySelectorAll('tbody tr[data-row-id]')).map((row) =>
				row.getAttribute('data-row-id'),
			),
		).toEqual([ROW_FIRST, ROW_SECOND]);
		expect(
			grid
				.querySelector(`[data-row-id="${ROW_FIRST}"][data-field-id="${FIRST_FIELD}"]`)
				?.getAttribute('aria-selected'),
		).toBe('true');

		// The linked-row jump uses Default view but must not overwrite the table's remembered filter.
		tables = selector(view, 'Table');
		tables.value = SECOND_TABLE;
		tables.dispatchEvent(new Event('change'));
		tables = selector(view, 'Table');
		tables.value = FIRST_TABLE;
		tables.dispatchEvent(new Event('change'));
		expect(selector(view, 'Saved view').value).toBe(FILTERED_VIEW);
		grid = gridOf();
		expect(
			Array.from(grid.querySelectorAll('tbody tr[data-row-id]')).map((row) =>
				row.getAttribute('data-row-id'),
			),
		).toEqual([ROW_SECOND]);
		expect(rig.vault.writes).toEqual([]);
		await view.onClose();
	});

	it('edits link selections through set-link, timestamps only changed rows, and keeps multi-link order', async () => {
		const rig = loadPlugin({ [PATH]: linkedDatabaseText() });
		const view = await openPane(rig, PATH);
		const handle = view.handle();
		if (handle === null) {
			throw new Error('the pane must hold a database handle');
		}
		const linkCell = view.containerEl.querySelector<HTMLElement>(
			`[data-row-id="${ROW_FIRST}"][data-field-id="${LINK_FIELD}"]`,
		);
		if (linkCell === null) {
			throw new Error('the single-link cell must be rendered');
		}
		linkCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		const firstSearch = view.containerEl.querySelector<HTMLInputElement>(
			'input[type="search"][data-native-editor]',
		);
		if (firstSearch === null) {
			throw new Error('the link editor must provide a search control');
		}
		expect(firstSearch.getAttribute('aria-label')).toBe('Search Clients records');
		firstSearch.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
		);
		expect(
			view.containerEl.querySelector('input[type="search"][data-native-editor]'),
		).toBeNull();
		expect(rig.vault.writes).toEqual([]);

		const cellAfterTab = view.containerEl.querySelector<HTMLElement>(
			`[data-row-id="${ROW_FIRST}"][data-field-id="${LINK_FIELD}"]`,
		);
		cellAfterTab?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		const search = view.containerEl.querySelector<HTMLInputElement>(
			'input[type="search"][data-native-editor]',
		);
		const replacement = view.containerEl.querySelector<HTMLInputElement>(
			`input[type="radio"][value="${TARGET_ROW_TWO}"][data-native-editor]`,
		);
		if (search === null || replacement === null) {
			throw new Error('the link editor must provide search and radio choices');
		}
		const adaChoice = view.containerEl.querySelector<HTMLInputElement>(
			`input[type="radio"][value="${TARGET_ROW_ONE}"][data-native-editor]`,
		);
		const noResults = view.containerEl.querySelector<HTMLElement>(
			'.tablify-native-link-no-results',
		);
		if (adaChoice === null || noResults === null) {
			throw new Error('the searchable choices and no-results status must be rendered');
		}
		search.value = 'Grace';
		search.dispatchEvent(new Event('input', { bubbles: true }));
		expect(adaChoice.parentElement?.hidden).toBe(true);
		expect(replacement.parentElement?.hidden).toBe(false);
		expect(noResults.hidden).toBe(true);
		search.value = 'No matching client';
		search.dispatchEvent(new Event('input', { bubbles: true }));
		expect(noResults.hidden).toBe(false);
		search.value = '';
		search.dispatchEvent(new Event('input', { bubbles: true }));
		expect(adaChoice.parentElement?.hidden).toBe(false);
		expect(noResults.hidden).toBe(true);
		replacement.checked = true;
		replacement.dispatchEvent(new Event('change', { bubbles: true }));
		replacement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(handle.session.getDocument().tables[0]?.rows[0]?.cells.get(LINK_FIELD)).toBe(
			TARGET_ROW_TWO,
		);
		expect(handle.session.getDocument().tables[0]?.rows[0]?.updatedAt).toMatch(/^\d{4}-/);
		expect(handle.session.getHistorySummary().depth).toBe(1);

		handle.session.undo();
		expect(handle.session.getDocument().tables[0]?.rows[0]?.cells.get(LINK_FIELD)).toBe(
			TARGET_ROW_ONE,
		);
		expect(handle.session.getDocument().tables[0]?.rows[0]?.updatedAt).toBeNull();

		const multiCell = view.containerEl.querySelector<HTMLElement>(
			`[data-row-id="${ROW_FIRST}"][data-field-id="${MULTI_LINK_FIELD}"]`,
		);
		if (multiCell === null) {
			throw new Error('the multi-link cell must be rendered');
		}
		multiCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		const removeGrace = view.containerEl.querySelector<HTMLInputElement>(
			`input[type="checkbox"][value="${TARGET_ROW_TWO}"][data-native-editor]`,
		);
		if (removeGrace === null) {
			throw new Error('the multi-link editor must use checkboxes');
		}
		expect(removeGrace.checked).toBe(true);
		removeGrace.checked = false;
		removeGrace.dispatchEvent(new Event('change', { bubbles: true }));
		const multiSearch = view.containerEl.querySelector<HTMLInputElement>(
			'input[type="search"][data-native-editor]',
		);
		multiSearch?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(
			handle.session.getDocument().tables[0]?.rows[0]?.cells.get(MULTI_LINK_FIELD),
		).toEqual([TARGET_ROW_ONE]);
		expect(handle.session.getHistorySummary().depth).toBe(1);

		const brokenCell = view.containerEl.querySelector<HTMLElement>(
			`[data-row-id="${ROW_SECOND}"][data-field-id="${LINK_FIELD}"]`,
		);
		if (brokenCell === null) {
			throw new Error('the broken link cell must remain addressable for repair');
		}
		brokenCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		let brokenChoice = view.containerEl.querySelector<HTMLInputElement>(
			`input[type="radio"][value="${MISSING_TARGET_ROW}"][data-native-editor]`,
		);
		let brokenSearch = view.containerEl.querySelector<HTMLInputElement>(
			'input[type="search"][data-native-editor]',
		);
		if (brokenChoice === null || brokenSearch === null) {
			throw new Error('the editor must retain a broken ID as an explicit repair choice');
		}
		expect(brokenChoice.checked).toBe(true);
		brokenSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(handle.session.getDocument().tables[0]?.rows[1]?.cells.get(LINK_FIELD)).toBe(
			MISSING_TARGET_ROW,
		);
		expect(handle.session.getDocument().tables[0]?.rows[1]?.updatedAt).toBeNull();
		expect(handle.session.getHistorySummary().depth).toBe(1);

		const brokenCellAfterNoop = view.containerEl.querySelector<HTMLElement>(
			`[data-row-id="${ROW_SECOND}"][data-field-id="${LINK_FIELD}"]`,
		);
		brokenCellAfterNoop?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		const repairedChoice = view.containerEl.querySelector<HTMLInputElement>(
			`input[type="radio"][value="${TARGET_ROW_ONE}"][data-native-editor]`,
		);
		brokenSearch = view.containerEl.querySelector<HTMLInputElement>(
			'input[type="search"][data-native-editor]',
		);
		if (repairedChoice === null || brokenSearch === null) {
			throw new Error('the broken reference must be repairable with an existing target row');
		}
		repairedChoice.checked = true;
		repairedChoice.dispatchEvent(new Event('change', { bubbles: true }));
		brokenSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(handle.session.getDocument().tables[0]?.rows[1]?.cells.get(LINK_FIELD)).toBe(
			TARGET_ROW_ONE,
		);
		expect(handle.session.getDocument().tables[0]?.rows[1]?.updatedAt).toMatch(/^\d{4}-/);
		expect(rig.vault.writes).toEqual([]);
		await view.onClose();
	});

	it('edits a cell through its descriptor and shared history only when the edit is committed', async () => {
		const rig = loadPlugin({ [PATH]: databaseText() });
		const view = await openPane(rig, PATH);
		const cell = view.containerEl.querySelector<HTMLElement>(
			`[data-row-id="${ROW_SECOND}"][data-field-id="${FIRST_FIELD}"]`,
		);
		if (cell === null) {
			throw new Error('the native text cell must be rendered');
		}
		cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		let editor = view.containerEl.querySelector<HTMLInputElement>('input[data-native-editor]');
		if (editor === null) {
			throw new Error('double-click must open the native text editor');
		}
		editor.value = 'Renamed 2';
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		expect(
			view.handle()?.session.getDocument().tables[0]?.rows[1]?.cells.get(FIRST_FIELD),
		).toBe('Shoots 2');
		expect(rig.vault.writes).toEqual([]);

		editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(
			view.containerEl.querySelector(
				`[data-row-id="${ROW_SECOND}"][data-field-id="${FIRST_FIELD}"]`,
			)?.textContent,
		).toBe('Renamed 2');
		const handle = view.handle();
		if (handle === null) {
			throw new Error('the pane must hold a database handle');
		}
		expect(handle.session.getDocument().tables[0]?.rows[1]?.cells.get(FIRST_FIELD)).toBe(
			'Renamed 2',
		);
		expect(handle.session.getHistorySummary().depth).toBe(1);
		const saved = await handle.session.flush();
		expect(saved.ok).toBe(true);
		const persisted = parseDocument(rig.vault.files.get(PATH) ?? '');
		expect(persisted.ok).toBe(true);
		if (persisted.ok) {
			expect(persisted.document.tables[0]?.rows[1]?.cells.get(FIRST_FIELD)).toBe('Renamed 2');
		}
		expect(rig.vault.writes).toEqual([PATH]);

		handle.session.undo();
		expect(handle.session.getDocument().tables[0]?.rows[1]?.cells.get(FIRST_FIELD)).toBe(
			'Shoots 2',
		);
		await handle.session.flush();
		expect(rig.vault.writes).toEqual([PATH, PATH]);
		await view.onClose();
	});

	it('navigates by stable row ID, opens with Enter, and cancels with Escape without writing', async () => {
		const rig = loadPlugin({ [PATH]: databaseText() });
		const view = await openPane(rig, PATH);
		const grid = view.containerEl.querySelector<HTMLTableElement>('[role="grid"]');
		const firstCell = view.containerEl.querySelector<HTMLElement>(
			`[data-row-id="${ROW_FIRST}"][data-field-id="${FIRST_FIELD}"]`,
		);
		if (grid === null || firstCell === null) {
			throw new Error('the native grid and its first cell must be rendered');
		}
		grid.focus();
		grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		expect(
			grid
				.querySelector(`[data-row-id="${ROW_FIRST}"][data-field-id="${FIRST_FIELD}"]`)
				?.getAttribute('aria-selected'),
		).toBe('true');
		grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		expect(
			grid
				.querySelector(`[data-row-id="${ROW_SECOND}"][data-field-id="${FIRST_FIELD}"]`)
				?.getAttribute('aria-selected'),
		).toBe('true');
		grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		const editor = view.containerEl.querySelector<HTMLInputElement>(
			'input[data-native-editor]',
		);
		if (editor === null) {
			throw new Error('Enter must open the selected cell editor');
		}
		editor.value = 'discard this draft';
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(
			view.containerEl.querySelector(
				`[data-row-id="${ROW_SECOND}"][data-field-id="${FIRST_FIELD}"]`,
			)?.textContent,
		).toBe('Shoots 2');
		expect(
			view.handle()?.session.getDocument().tables[0]?.rows[1]?.cells.get(FIRST_FIELD),
		).toBe('Shoots 2');
		expect(rig.vault.writes).toEqual([]);
		await view.onClose();
	});

	it('keeps a rejected typed value in the editor without writing or changing the cell', async () => {
		const numericDatabase = JSON.stringify({
			format: 'tablify',
			version: 1,
			databaseId: `db_${'x'.repeat(26)}`,
			name: 'Numbers',
			tables: [
				{
					id: FIRST_TABLE,
					name: 'Counts',
					fields: [{ id: FIRST_FIELD, name: 'Count', type: 'number' }],
					rows: [{ id: ROW_FIRST, cells: { [FIRST_FIELD]: 1 } }],
					views: [],
				},
			],
		});
		const rig = loadPlugin({ [PATH]: numericDatabase });
		const view = await openPane(rig, PATH);
		const cell = view.containerEl.querySelector<HTMLElement>(
			`[data-row-id="${ROW_FIRST}"][data-field-id="${FIRST_FIELD}"]`,
		);
		if (cell === null) {
			throw new Error('the native numeric cell must be rendered');
		}
		cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		let editor = view.containerEl.querySelector<HTMLInputElement>('input[data-native-editor]');
		if (editor === null) {
			throw new Error('double-click must open the native number editor');
		}
		editor.value = 'not a number';
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(view.containerEl.querySelector('[role="alert"]')?.textContent).toContain('number');
		expect(
			view.handle()?.session.getDocument().tables[0]?.rows[0]?.cells.get(FIRST_FIELD),
		).toBe(1);
		expect(rig.vault.writes).toEqual([]);
		editor = view.containerEl.querySelector<HTMLInputElement>('input[data-native-editor]');
		expect(editor?.value).toBe('not a number');
		await view.onClose();
	});

	it('shows select labels, filters by label, and writes the selected stable option ID', async () => {
		const optionDatabase = JSON.stringify({
			format: 'tablify',
			version: 1,
			databaseId: `db_${'w'.repeat(26)}`,
			name: 'Options',
			tables: [
				{
					id: FIRST_TABLE,
					name: 'Tasks',
					fields: [
						{
							id: FIRST_FIELD,
							name: 'Status',
							type: 'singleSelect',
							options: [
								{ id: OPTION_OPEN, name: 'Open' },
								{ id: OPTION_CLOSED, name: 'Closed' },
							],
						},
					],
					rows: [{ id: ROW_FIRST, cells: { [FIRST_FIELD]: OPTION_OPEN } }],
					views: [
						{
							id: FIRST_VIEW,
							name: 'Open only',
							sorts: [],
							filter: {
								version: 1,
								expr: {
									kind: 'cmp',
									fieldId: FIRST_FIELD,
									op: 'is',
									operand: 'Open',
								},
							},
						},
					],
				},
			],
		});
		const rig = loadPlugin({ [PATH]: optionDatabase });
		const view = await openPane(rig, PATH);
		const gridOf = (): HTMLTableElement => {
			const grid = view.containerEl.querySelector<HTMLTableElement>('[role="grid"]');
			if (grid === null) {
				throw new Error('the native table grid must be rendered');
			}
			return grid;
		};
		expect(
			gridOf().querySelector(`[data-row-id="${ROW_FIRST}"][data-field-id="${FIRST_FIELD}"]`)
				?.textContent,
		).toBe('Open');
		let views = selector(view, 'Saved view');
		views.value = FIRST_VIEW;
		views.dispatchEvent(new Event('change'));
		expect(gridOf().querySelectorAll('tbody tr[data-row-id]').length).toBe(1);
		views = selector(view, 'Saved view');
		views.value = '';
		views.dispatchEvent(new Event('change'));

		const cell = view.containerEl.querySelector<HTMLElement>(
			`[data-row-id="${ROW_FIRST}"][data-field-id="${FIRST_FIELD}"]`,
		);
		if (cell === null) {
			throw new Error('the native single-select cell must be rendered');
		}
		cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		const editor = view.containerEl.querySelector<HTMLSelectElement>(
			'select[data-native-editor]',
		);
		if (editor === null) {
			throw new Error('double-click must open the native select editor');
		}
		editor.value = OPTION_CLOSED;
		editor.dispatchEvent(new Event('change', { bubbles: true }));
		editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(
			view.containerEl.querySelector(
				`[data-row-id="${ROW_FIRST}"][data-field-id="${FIRST_FIELD}"]`,
			)?.textContent,
		).toBe('Closed');
		expect(
			view.handle()?.session.getDocument().tables[0]?.rows[0]?.cells.get(FIRST_FIELD),
		).toBe(OPTION_CLOSED);
		views = selector(view, 'Saved view');
		views.value = FIRST_VIEW;
		views.dispatchEvent(new Event('change'));
		expect(gridOf().querySelectorAll('tbody tr[data-row-id]').length).toBe(0);
		expect(rig.vault.writes).toEqual([]);
		await view.onClose();
	});

	it('windows a large table by stable row IDs instead of mounting every record', async () => {
		const largeDatabase = JSON.stringify({
			format: 'tablify',
			version: 1,
			databaseId: `db_${'y'.repeat(26)}`,
			name: 'Large',
			tables: [table(FIRST_TABLE, 'Records', 500)],
		});
		const rig = loadPlugin({ [PATH]: largeDatabase });
		const view = await openPane(rig, PATH);
		const grid = view.containerEl.querySelector<HTMLTableElement>('[role="grid"]');
		if (grid === null) {
			throw new Error('the native table grid must be rendered');
		}
		const mountedRows = grid.querySelectorAll('tbody tr[data-row-id]');
		expect(grid.getAttribute('aria-rowcount')).toBe('501');
		expect(mountedRows.length).toBeGreaterThan(0);
		expect(mountedRows.length).toBeLessThan(500);
		expect(mountedRows[0]?.getAttribute('data-row-id')).toBe(ROW_FIRST);
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
			rowId: ROW_FIRST,
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
