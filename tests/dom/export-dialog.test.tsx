/**
 * The export dialog, driven: **the counts are the view's, and a cancel writes nothing.**
 *
 * What this file is for, in one sentence: the numbers on the dialog are produced by `exportTable` reading the
 * **real store** — the same function the runner serialises — so "the counts match the selection and the view" is a
 * statement about the shipped path rather than about a fixture that agrees with itself. The view's own narrowing in
 * this product is its search box and its sorts (`docs/03`: row filters live in the `.base` and reach the plugin as
 * the source's rows), so the narrowing test drives the search box's own command, not a hand-made table.
 *
 * **What is driven, and what is not.** `ExportPanel` is the dialog's whole behaviour — the state, the elements and
 * the one `run` — and it is the class the shipping `ExportDialog` puts inside Obsidian's `Modal`. The `Modal` itself
 * cannot be built in a test (`Modal(app: App)`, and an `App` double would be a fiction), so the panel is what a test
 * renders — into a **real jsdom element** with the host's DOM helpers installed (`tests/mocks/dom.ts`), which is the
 * pattern `paste-flow.test.tsx` set: a click is a real click and `querySelectorAll` reads what a person would see.
 *
 * The division of labour with the browser suite is the same as that file's:
 *
 *   · **Here** (jsdom): the flow — which options exist, which numbers appear, that the primary action refuses when
 *     the pair of answers cannot be honoured, that a cancel reaches neither the vault nor the clipboard, and that a
 *     confirm writes the text the chosen mode implies.
 *   · **There** (Playwright): the same dialog on a real page, after the human runs `bun run test:layout`. Nothing
 *     here replaces that, and the screenshots are where "it looks right" lives.
 */
import { describe, expect, it } from 'vitest';

import {
	ExportPanel,
	defaultExportState,
	exportGroups,
	exportLines,
	exportSummary,
} from '../../src/plugin/export/ExportDialog';
import type { ExportHost, ExportState } from '../../src/plugin/export/ExportDialog';
import { exportTable } from '../../src/plugin/export/runExport';
import type { ExportPorts } from '../../src/plugin/export/runExport';
import { countExport } from '../../src/core/export/serialize';
import type { ExportTable } from '../../src/core/export/serialize';
import { resolveField } from '../../src/core/schema/propertySchema';
import { createGridStore } from '../../src/grid/store/store';
import { selectCell, setViewConfig } from '../../src/grid/store/commands';
import { augment } from './support/dom';
import { createFakeRowSource } from '../fakes/rowSource';
import type { GridStore } from '../../src/grid/store/types';
import type { FieldContext } from '../../src/core/types';

const CONTEXT: FieldContext = {
	now: () => Date.UTC(2026, 9, 6),
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
	columnName: '',
};

/** Three columns: a name, a currency and a date — enough that `display` and `raw` differ visibly. */
const FIELDS = [
	resolveField({ id: 'note.Name', name: 'Name', source: 'note' }, CONTEXT),
	resolveField(
		{
			id: 'note.Cost',
			name: 'Cost',
			source: 'note',
			fieldOptions: { type: 'currency', symbol: '€' },
		},
		CONTEXT,
	),
	resolveField(
		{ id: 'note.Due', name: 'Due', source: 'note', fieldOptions: { type: 'date' } },
		CONTEXT,
	),
];

const ROWS = 4;

/** A four-row store. Row 0's cost is `€100.00` displayed and `100` raw — the mode difference, in the fixture. */
function makeStore(): GridStore {
	const rows = Array.from({ length: ROWS }, (_unused, index) => ({
		filePath: `Notes/${String(index)}.md`,
		cells: {
			'note.Name': `Row ${String(index)}`,
			'note.Cost': (index + 1) * 100,
			'note.Due': '2026-03-01',
		},
	}));
	return createGridStore({ source: createFakeRowSource({ fields: FIELDS, rows }) });
}

/** Everything a test reads back: the writes in order, the folders, the clipboard and the messages. */
type Harness = {
	readonly writes: { readonly path: string; readonly body: string }[];
	readonly folders: string[];
	readonly clipboard: string[];
	readonly messages: string[];
	readonly ports: ExportPorts;
};

/** Ports that record every write, so "cancelling writes nothing" is an assertion about empty arrays. */
function makePorts(): Harness {
	const writes: { readonly path: string; readonly body: string }[] = [];
	const folders: string[] = [];
	const clipboard: string[] = [];
	const messages: string[] = [];
	const files = new Set<string>();
	return {
		writes,
		folders,
		clipboard,
		messages,
		ports: {
			clipboard: {
				write: async (payload) => {
					clipboard.push(payload.tsv);
					return 'clipboard-api';
				},
			},
			vault: {
				exists: (path) => files.has(path),
				createFolder: async (path) => {
					folders.push(path);
				},
				create: async (path, file) => {
					files.add(path);
					writes.push({ path, body: typeof file === 'string' ? file : '<binary>' });
				},
			},
			now: () => new Date(2026, 9, 6, 14, 32),
			announce: (message) => {
				messages.push(message);
			},
		},
	};
}

/** Both tables, from the store, exactly as the view would build them. */
function tablesOf(store: GridStore): {
	readonly selection: ExportTable;
	readonly view: ExportTable;
} {
	return { selection: exportTable(store, 'selection'), view: exportTable(store, 'view') };
}

/** One opened dialog: the real panel, in a real element, plus the click helpers a person's hand would be. */
type Opened = {
	readonly content: HTMLElement;
	readonly closed: () => number;
	/** Confirms the export, and waits for the runner. */
	confirm(): Promise<void>;
	/** Clicks the choice whose button carries `label`. */
	choose(label: string): void;
	/** Clicks Cancel. */
	cancel(): void;
	/** The buttons the footer holds, in order. */
	buttons(): HTMLButtonElement[];
	/** The primary button. */
	primary(): HTMLButtonElement;
	/** Everything the dialog currently says, as one string. */
	text(): string;
};

/** Opens the real panel over a real element. */
function open(store: GridStore, harness: Harness): Opened {
	const host: ExportHost = { tables: tablesOf(store), ports: harness.ports };
	const content = augment(document.createElement('div'));
	let closes = 0;
	// The panel is the shipped surface's own class; the element is a real one, with the host's helpers installed.
	new ExportPanel(host, {
		contentEl: content,
		close: () => {
			closes += 1;
		},
	});
	const choice = (label: string): HTMLButtonElement | null =>
		Array.from(content.querySelectorAll<HTMLButtonElement>('.tablify-dlg-choice')).find(
			(button) => (button.textContent ?? '').includes(label),
		) ?? null;
	return {
		content,
		closed: () => closes,
		async confirm() {
			content.querySelector<HTMLButtonElement>('.tablify-dlg-btn.is-primary')?.click();
			await Promise.resolve();
			await Promise.resolve();
		},
		choose(label) {
			choice(label)?.click();
		},
		cancel() {
			Array.from(content.querySelectorAll<HTMLButtonElement>('.tablify-dlg-btn'))
				.find((button) => button.textContent === 'Cancel')
				?.click();
		},
		buttons() {
			return Array.from(content.querySelectorAll<HTMLButtonElement>('.tablify-dlg-btn'));
		},
		primary() {
			const button = content.querySelector<HTMLButtonElement>('.tablify-dlg-btn.is-primary');
			if (button === null) {
				throw new Error(
					'the footer has no primary action — the anatomy every dialog shares',
				);
			}
			return button;
		},
		text() {
			return content.textContent ?? '';
		},
	};
}

describe('the counts the dialog states', () => {
	it('are the view’s own rows and columns, read from the store', () => {
		const store = makeStore();
		const harness = makePorts();
		const dialog = open(store, harness);
		expect(countExport(tablesOf(store).view)).toEqual({
			rows: ROWS,
			columns: 3,
			cells: ROWS * 3,
		});
		expect(dialog.text()).toContain('The whole view · 4 row(s) × 3 column(s) · 12 cell(s)');
		// Opening a dialog is not exporting: nothing has been written anywhere.
		expect(harness.writes).toEqual([]);
		expect(harness.clipboard).toEqual([]);
		expect(harness.messages).toEqual([]);
	});

	it('follow the view’s search box — the narrowed set, not the source’s', () => {
		const store = makeStore();
		setViewConfig(store, { search: 'Row 2' });
		const dialog = open(store, makePorts());
		expect(countExport(tablesOf(store).view)).toEqual({ rows: 1, columns: 3, cells: 3 });
		expect(dialog.text()).toContain('The whole view · 1 row(s) × 3 column(s) · 3 cell(s)');
	});

	it('are the selection’s when the scope is switched to it', () => {
		const store = makeStore();
		selectCell(store, { filePath: 'Notes/0.md', fieldId: 'note.Name' });
		const dialog = open(store, makePorts());
		expect(dialog.text()).toContain('The whole view · 4 row(s) × 3 column(s) · 12 cell(s)');
		dialog.choose('The selection');
		expect(dialog.text()).toContain('The selection · 1 row(s) × 1 column(s) · 1 cell(s)');
		expect(dialog.primary().disabled).toBe(false);
	});

	it('are a range’s when several cells are selected', () => {
		const store = makeStore();
		store.select({
			anchor: { filePath: 'Notes/0.md', fieldId: 'note.Name' },
			focus: { filePath: 'Notes/1.md', fieldId: 'note.Cost' },
		});
		const dialog = open(store, makePorts());
		dialog.choose('The selection');
		expect(dialog.text()).toContain('The selection · 2 row(s) × 2 column(s) · 4 cell(s)');
	});

	it('re-render the body rather than adding to it: one count line, always', () => {
		const store = makeStore();
		const dialog = open(store, makePorts());
		dialog.choose('The selection');
		dialog.choose('The whole view');
		dialog.choose('Raw values');
		expect(dialog.content.querySelectorAll('.tablify-dlg-count')).toHaveLength(1);
		expect(dialog.content.querySelectorAll('.tablify-dlg-group')).toHaveLength(4);
		expect(dialog.content.querySelectorAll('.tablify-dlg-btn')).toHaveLength(2);
	});
});

describe('the primary action', () => {
	it('is disabled with no rows, and the footer says why', () => {
		const store = makeStore();
		const dialog = open(store, makePorts());
		dialog.choose('The selection');
		expect(dialog.primary().disabled).toBe(true);
		expect(dialog.primary().getAttribute('title')).toBe(
			'Nothing is selected — drag over some cells, or export the whole view.',
		);
		expect(dialog.content.querySelector('.tablify-live')?.textContent).toBe(
			'Nothing is selected — drag over some cells, or export the whole view.',
		);
	});

	it('is disabled for XLSX to the clipboard, and usable again when the format goes back to TSV', () => {
		const store = makeStore();
		const dialog = open(store, makePorts());
		dialog.choose('XLSX');
		dialog.choose('The clipboard');
		expect(dialog.primary().disabled).toBe(true);
		expect(dialog.text()).toContain(
			'An .xlsx is a file: the clipboard carries text. Choose the file destination, or TSV.',
		);
		dialog.choose('TSV');
		expect(dialog.primary().disabled).toBe(false);
	});
});

describe('cancelling', () => {
	it('writes nothing at all — no file, no clipboard, no message — and closes', () => {
		const store = makeStore();
		const harness = makePorts();
		const dialog = open(store, harness);
		dialog.cancel();
		expect(harness.writes).toEqual([]);
		expect(harness.clipboard).toEqual([]);
		expect(harness.folders).toEqual([]);
		expect(harness.messages).toEqual([]);
		expect(dialog.closed()).toBe(1);
	});
});

describe('confirming', () => {
	it('writes a displayed TSV file, announces the runner’s sentence, and closes', async () => {
		const store = makeStore();
		const harness = makePorts();
		const dialog = open(store, harness);
		await dialog.confirm();
		expect(harness.folders).toEqual(['Tablify exports']);
		expect(harness.writes).toEqual([
			{
				path: 'Tablify exports/Tablify export 2026-10-06 1432.tsv',
				body: [
					'Name\tCost\tDue',
					'Row 0\t€100.00\t1 Mar 2026',
					'Row 1\t€200.00\t1 Mar 2026',
					'Row 2\t€300.00\t1 Mar 2026',
					'Row 3\t€400.00\t1 Mar 2026',
				].join('\n'),
			},
		]);
		expect(harness.messages).toEqual([
			'Exported 4 × 3 to “Tablify exports/Tablify export 2026-10-06 1432.tsv”.',
		]);
		expect(dialog.closed()).toBe(1);
	});

	it('writes raw values when the second mode is chosen', async () => {
		const store = makeStore();
		const harness = makePorts();
		const dialog = open(store, harness);
		dialog.choose('Raw values');
		await dialog.confirm();
		const body = harness.writes[0]?.body ?? '';
		expect(body).toContain('Row 0\t100\t2026-03-01');
		expect(body).not.toContain('€100.00');
	});

	it('exports the selection, not the view, when the selection scope is chosen', async () => {
		const store = makeStore();
		selectCell(store, { filePath: 'Notes/1.md', fieldId: 'note.Name' });
		const harness = makePorts();
		const dialog = open(store, harness);
		dialog.choose('The selection');
		await dialog.confirm();
		expect(harness.writes[0]?.body).toBe('Name\nRow 1');
		expect(harness.messages).toEqual([
			'Exported 1 × 1 to “Tablify exports/Tablify export 2026-10-06 1432.tsv”.',
		]);
	});

	it('puts both flavours on the clipboard for a clipboard export', async () => {
		const store = makeStore();
		const harness = makePorts();
		const dialog = open(store, harness);
		dialog.choose('The clipboard');
		await dialog.confirm();
		expect(harness.clipboard).toHaveLength(1);
		expect(harness.clipboard[0]?.startsWith('Name\tCost\tDue')).toBe(true);
		expect(harness.writes).toEqual([]);
		expect(harness.messages).toEqual(['Exported 4 × 3 to the clipboard.']);
	});

	it('offers exactly two footer buttons, and the primary is the last one read', () => {
		const store = makeStore();
		const dialog = open(store, makePorts());
		expect(dialog.buttons().map((button) => button.textContent)).toEqual(['Export', 'Cancel']);
		expect(dialog.primary().classList.contains('is-primary')).toBe(true);
	});
});

describe('the pure state behind the dialog', () => {
	const sketch: ExportState = defaultExportState({
		selection: { rows: 0, columns: 0, cells: 0 },
		view: { rows: 412, columns: 6, cells: 2472 },
	});

	it('starts on the whole view, displayed, as a TSV file', () => {
		expect(sketch.scope).toBe('view');
		expect(sketch.format).toBe('tsv');
		expect(sketch.destination).toBe('file');
		expect(sketch.mode).toBe('display');
		expect(exportGroups(sketch).map((group) => group.id)).toEqual([
			'scope',
			'format',
			'destination',
			'mode',
		]);
		expect(
			exportGroups(sketch)
				.flatMap((group) => group.options)
				.filter((option) => option.picked)
				.map((option) => option.id),
		).toEqual(['view', 'tsv', 'file', 'display']);
	});

	it('prints the sketch’s own numbers in one sentence', () => {
		expect(exportSummary(sketch)).toBe(
			'The whole view · 412 row(s) × 6 column(s) · 2,472 cell(s)',
		);
	});

	it('names what each mode produces, so the choice is a reading rather than a guess', () => {
		expect(exportLines(sketch).map((line) => line.kind)).toEqual(['count', 'hint', 'fact']);
		expect(exportLines(sketch).map((line) => line.text)).toContain(
			'Displayed values carry the formatting you see — €1,200.00, 24 Sep 2025, 25 %.',
		);
		expect(exportLines({ ...sketch, mode: 'raw' }).map((line) => line.text)).toContain(
			'Raw values carry what the notes hold — 1200, 2025-09-24, 25.',
		);
	});
});
