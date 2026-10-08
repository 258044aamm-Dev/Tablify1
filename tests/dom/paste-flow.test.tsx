/**
 * The paste flow, end to end but without a browser: **a `paste` event arrives, three modes are offered, one lands.**
 *
 * The division of labour between this file and `tests/layout/tier4.spec.ts` is deliberate:
 *
 *   · **Here** (jsdom): the *flow*. Which plans the dialog offers, the counts it states, which of them creates
 *     notes, that a cancel writes nothing, and that the whole paste is one undo step. The event is dispatched by
 *     the test, because jsdom implements neither `ClipboardEvent` nor `DataTransfer` — the event is the browser's
 *     half, and `pasteEvent()` below hands the grid exactly what the browser would put on it (`clipboardData`
 *     with `getData`). The real event, on a real page, is assertion 11's and 15's in the Tier-4 suite.
 *   · **There** (Playwright): the same paste through a real `ClipboardEvent` on a real grid, under the budget.
 *
 * The dialog is the **real** one. The test's port is a `GridMenuPorts`-shaped object whose `pasteBlock` builds
 * `pasteBlockSpec` from the input the grid hands it — so the counts under assertion are the counts the shipped
 * dialog prints, produced by the shipped code (`plansByMode`, `choiceCounts`, `largeWarning`), not a restatement.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { GridView } from '../../src/grid/GridView';
import { createGridStore } from '../../src/grid/store/store';
import { addRow, selectCell } from '../../src/grid/store/commands';
import { pasteBlockSpec } from '../../src/grid/dialogs/PasteBlockDialog';
import { resolveField } from '../../src/core/schema/propertySchema';
import { augment } from './support/dom';
import { createFakeRowSource } from '../fakes/rowSource';
import type { DialogPort } from '../../src/grid/dialogs/port';
import type { DialogSpec } from '../../src/grid/dialogs/base';
import type { GridStore } from '../../src/grid/store/types';
import type { NewRowValues } from '../../src/grid/clipboard/pastePlan';
import type { CellValue, FieldContext } from '../../src/core/types';
import type { RowId, RowState } from '../../src/core/ops/types';

Object.assign(window, { IS_REACT_ACT_ENVIRONMENT: true });

const CONTEXT: FieldContext = {
	now: () => Date.UTC(2026, 9, 6),
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
	columnName: '',
};

/** Three columns that take any text, so a pasted cell is never "outside the table" for a parsing reason. */
const FIELDS = [
	resolveField({ id: 'note.Name', name: 'Name', source: 'note' }, CONTEXT),
	resolveField({ id: 'note.Owner', name: 'Owner', source: 'note' }, CONTEXT),
	resolveField({ id: 'note.Notes', name: 'Notes', source: 'note' }, CONTEXT),
];

const ROWS = 6;

function makeStore(): GridStore {
	const rows = Array.from({ length: ROWS }, (_unused, index) => ({
		filePath: `Notes/${String(index)}.md`,
		cells: {
			'note.Name': `Row ${String(index)}`,
			'note.Owner': 'Ada',
			'note.Notes': '',
		},
	}));
	return createGridStore({ source: createFakeRowSource({ fields: FIELDS, rows }) });
}

/** A `rows × columns` TSV block: `x{r}-{c}` in every cell. */
function block(rows: number, columns: number): string {
	const lines: string[] = [];
	for (let r = 0; r < rows; r += 1) {
		lines.push(
			Array.from({ length: columns }, (_unused, c) => `x${String(r)}-${String(c)}`).join(
				'\t',
			),
		);
	}
	return lines.join('\n');
}

/**
 * The `paste` event jsdom cannot construct: `clipboardData` is defined on a plain event, because the grid's
 * listener only ever calls `getData`. Nothing about the shape of the data differs from a browser's.
 */
function pasteEvent(payload: { readonly html?: string; readonly text: string }): Event {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	const html = payload.html ?? '';
	Object.defineProperty(event, 'clipboardData', {
		value: {
			getData: (type: string): string => {
				if (type === 'text/html') {
					return html;
				}
				return type === 'text/plain' ? payload.text : '';
			},
		},
	});
	return event;
}

/** One value per element carrying `cls`, in document order — the reading a person's eye would take. */
function textsOf(body: HTMLElement, cls: string): string[] {
	return Array.from(body.querySelectorAll(`.${cls}`)).map((node) => node.textContent ?? '');
}

/** What one opened dialog leaves behind for the assertions. */
type Opened = {
	readonly spec: DialogSpec;
	/** The rendered body, so the dialog's own DOM can be read. */
	readonly body: HTMLElement;
	/** Confirms the mode named `name`, as a person clicking the choice and then Paste would. */
	choose(name: string): void;
	/** Confirms whatever is already chosen — the dialog's own default. */
	confirm(): void;
};

/** The port the grid is mounted with: the paste dialog is real, the rest are not this file's business. */
function makePort(opened: Opened[]): { readonly port: DialogPort; readonly chosen: string[] } {
	const chosen: string[] = [];
	const noop = (): void => undefined;
	return {
		chosen,
		port: {
			viewOptions: noop,
			fieldConfig: noop,
			optionManager: noop,
			rowDetails: noop,
			bulkEdit: noop,
			pasteBlock: (input) => {
				const spec = pasteBlockSpec({
					app: null,
					base: input.base,
					setting: input.setting,
					warnOnLargeImport: input.warnOnLargeImport,
					largeImportThreshold: input.largeImportThreshold,
					onChoose: input.onChoose,
				});
				const contentEl = augment(document.createElement('div'));
				spec.body({ contentEl, close: noop });
				opened.push({
					spec,
					body: contentEl,
					choose: (name) => {
						chosen.push(name);
						input.onChoose(modeIdOf(name));
					},
					confirm: () => {
						chosen.push('default');
						spec.primary.run();
					},
				});
			},
		},
	};
}

/** The dialog's choice labels, mapped back to the mode ids the plan uses. */
function modeIdOf(name: string): 'cells' | 'append' | 'create' {
	if (name.startsWith('Append')) {
		return 'append';
	}
	return name.startsWith('Create') ? 'create' : 'cells';
}

type Mounted = {
	readonly store: GridStore;
	readonly root: HTMLElement;
	readonly opened: Opened[];
	/** Rows the "view" was asked to create, in order — the note count the plan promised. */
	readonly created: readonly RowId[][];
	/** Dispatches the paste and lets the async apply settle. */
	paste(text: string, html?: string): Promise<void>;
	/** The polite live region's sentence. */
	announcement(): string;
	unmount(): void;
};

let mounted: Mounted[] = [];

async function mountPaste(options: {
	readonly mode?: 'expand' | 'fill' | 'ask';
	readonly largeImportThreshold?: number;
}): Promise<Mounted> {
	const store = makeStore();
	const opened: Opened[] = [];
	const created: RowId[][] = [];
	const { port } = makePort(opened);
	const root = createRoot(document.body);
	const host = document.createElement('div');
	document.body.append(host);

	/** The view's half: one row per `NewRowValues`, appended, counted. */
	async function createRows(values: readonly NewRowValues[]): Promise<readonly RowId[]> {
		const paths: RowId[] = [];
		for (const valuesOfRow of values) {
			const cells: Record<string, CellValue> = {};
			for (const [fieldId, value] of valuesOfRow) {
				cells[fieldId] = value;
			}
			const at = store.getSnapshot().rows.length;
			const path = `Notes/Pasted ${String(paths.length + created.length * 100)}.md`;
			const row: RowState = { filePath: path, cells };
			if (addRow(store, { at, row }, 'Paste row').ok) {
				paths.push(path);
			}
		}
		created.push(paths);
		return paths;
	}

	act(() => {
		root.render(
			createElement(GridView, {
				store,
				presentation: { density: 'medium' },
				initialPaneWidth: 900,
				dialogs: port,
				paste: {
					mode: options.mode ?? 'expand',
					warnOnLargeImport: true,
					largeImportThreshold: options.largeImportThreshold ?? 60,
					createRows,
				},
			}),
		);
	});

	// The anchor. A paste lands at the active cell, and the grid always has one when a paste can reach it — a
	// `null` anchor makes every block "bigger than the table" and would put a dialog in front of every test.
	selectCell(store, { filePath: 'Notes/0.md', fieldId: 'note.Name' });

	const record: Mounted = {
		store,
		root: host,
		opened,
		created,
		async paste(text, html) {
			await act(async () => {
				document
					.querySelector('.tablify-root')
					?.dispatchEvent(pasteEvent(html === undefined ? { text } : { text, html }));
				// One microtask turn per awaited step in `applyPlan`: the plan, the row creation, the writes.
				await Promise.resolve();
				await Promise.resolve();
			});
		},
		announcement() {
			return document.querySelector('.tablify-live')?.textContent ?? '';
		},
		unmount() {
			act(() => {
				root.unmount();
			});
		},
	};
	mounted.push(record);
	return record;
}

afterEach(() => {
	for (const record of mounted) {
		record.unmount();
	}
	mounted = [];
	document.body.replaceChildren();
});

describe('a paste that fits', () => {
	it('writes straight through, with no dialog, and says what it did', async () => {
		const ui = await mountPaste({});
		await ui.paste(block(2, 2));
		expect(ui.opened).toHaveLength(0);
		expect(ui.store.state().table.rows[0]?.cells['note.Name']).toBe('x0-0');
		expect(ui.store.state().table.rows[1]?.cells['note.Owner']).toBe('x1-1');
		expect(ui.announcement()).toBe('4 cell(s) pasted');
	});

	it('is one undo step, so the whole block goes back at once', async () => {
		const ui = await mountPaste({});
		await ui.paste(block(2, 2));
		expect(ui.store.getSnapshot().canUndo).toBe(true);
		expect(ui.store.getSnapshot().undoLabel).toBe('Paste 4 cells');
		await act(async () => {
			ui.store.undo();
		});
		expect(ui.store.state().table.rows[0]?.cells['note.Name']).toBe('Row 0');
		expect(ui.store.state().table.rows[1]?.cells['note.Owner']).toBe('Ada');
	});
});

describe('a paste that does not fit', () => {
	it('opens the dialog, and the dialog states each mode’s own counts', async () => {
		const ui = await mountPaste({});
		await ui.paste(block(12, 3));
		expect(ui.opened).toHaveLength(1);
		const dialog = ui.opened[0];
		expect(dialog?.spec.title).toBe('Paste 12 × 3 block');
		const counts =
			dialog === undefined ? [] : textsOf(dialog.body, 'tablify-dlg-choice-counts');
		/*
		 * One line per mode, in `PASTE_MODES` order: fill cells, append as rows, create from the block.
		 *
		 * The third line is the same as the first, and that is the *documented* fallback rather than a bug: a
		 * block with no header line cannot be matched to columns by name, so `create` behaves as `cells` — which
		 * is the only reading under which the mode is never a no-op (`pastePlan` §`createByHeader`).
		 */
		expect(counts).toEqual([
			'18 cell(s) updated · 6 note(s) created',
			'12 note(s) created',
			'18 cell(s) updated · 6 note(s) created',
		]);
		// And nothing has been written while the dialog is open: a plan is not an op.
		expect(ui.store.getSnapshot().canUndo).toBe(false);
		expect(ui.store.getSnapshot().rows).toHaveLength(ROWS);
	});

	it('cells: fills the rows that exist and creates the rest', async () => {
		const ui = await mountPaste({});
		await ui.paste(block(12, 3));
		await act(async () => {
			ui.opened[0]?.confirm();
			await Promise.resolve();
		});
		expect(ui.created.map((paths) => paths.length)).toEqual([6]);
		expect(ui.store.getSnapshot().rows).toHaveLength(ROWS + 6);
		expect(ui.store.state().table.rows[0]?.cells['note.Name']).toBe('x0-0');
		expect(ui.store.state().table.rows[5]?.cells['note.Notes']).toBe('x5-2');
		expect(ui.announcement()).toBe('18 cell(s) pasted · 6 note(s) created');
	});

	it('append: creates one row per block row, and writes nothing into the table', async () => {
		const ui = await mountPaste({});
		await ui.paste(block(12, 3));
		await act(async () => {
			ui.opened[0]?.choose('Append as new rows');
			await Promise.resolve();
		});
		expect(ui.created.map((paths) => paths.length)).toEqual([12]);
		expect(ui.store.getSnapshot().rows).toHaveLength(ROWS + 12);
		// The existing rows are untouched: append is for data that is not in the table yet.
		expect(ui.store.state().table.rows[0]?.cells['note.Name']).toBe('Row 0');
		expect(ui.announcement()).toBe('12 note(s) created');
	});

	it('create: matches the header line to columns by name, then fills and grows', async () => {
		const ui = await mountPaste({});
		const withHeader = ['Name\tOwner\tNotes', ...block(11, 3).split('\n')].join('\n');
		await ui.paste(withHeader);
		const dialog = ui.opened[0];
		expect(dialog?.spec.title).toBe('Paste 12 × 3 block');
		// Eleven body rows: six land in the rows that exist, five become notes. The header itself became identity.
		expect(
			textsOf(dialog?.body ?? document.createElement('div'), 'tablify-dlg-choice-counts')[2],
		).toBe('18 cell(s) updated · 5 note(s) created · matched by header name');
		await act(async () => {
			dialog?.choose('Create rows from the block');
			await Promise.resolve();
		});
		expect(ui.created.map((paths) => paths.length)).toEqual([5]);
		expect(ui.store.getSnapshot().rows).toHaveLength(ROWS + 5);
		// And the values landed *by name*: the block's first column is `Name`, whatever position it holds.
		expect(ui.store.state().table.rows[0]?.cells['note.Name']).toBe('x0-0');
		expect(ui.store.state().table.rows[1]?.cells['note.Notes']).toBe('x1-2');
	});
});

describe('cancel', () => {
	it('writes nothing and creates no notes', async () => {
		const ui = await mountPaste({});
		await ui.paste(block(12, 3));
		expect(ui.opened).toHaveLength(1);
		// Cancelling is the *other* button: the primary was never run, so no plan was applied.
		const cancel = ui.opened[0]?.spec.secondary;
		expect(cancel?.label).toBe('Cancel');
		await act(async () => {
			cancel?.run();
			await Promise.resolve();
		});
		expect(ui.created).toHaveLength(0);
		expect(ui.store.getSnapshot().rows).toHaveLength(ROWS);
		expect(ui.store.getSnapshot().canUndo).toBe(false);
		expect(ui.store.state().table.rows[0]?.cells['note.Name']).toBe('Row 0');
	});
});

describe('the large-import warning', () => {
	it('states the count above the threshold, and no legacy-file alternative', async () => {
		const ui = await mountPaste({ largeImportThreshold: 10 });
		await ui.paste(block(12, 3));
		const warning = textsOf(
			ui.opened[0]?.body ?? document.createElement('div'),
			'tablify-dlg-warning-text',
		)[0];
		expect(warning).toContain('12 rows is above the large-import threshold (10)');
		expect(warning).not.toContain('.tabula');
		expect(warning).toContain('12 notes');
	});

	it('is absent below it, even though the dialog still asks', async () => {
		const ui = await mountPaste({ largeImportThreshold: 60 });
		await ui.paste(block(12, 3));
		// The dialog is there — the block creates notes, which is the clause that always asks — but the warning
		// is not, because 12 rows is not a large import at this threshold.
		expect(ui.opened).toHaveLength(1);
		expect(
			textsOf(
				ui.opened[0]?.body ?? document.createElement('div'),
				'tablify-dlg-warning-text',
			),
		).toEqual([]);
	});
});

describe('ask mode', () => {
	it('asks even when the block fits, and filling is still one op', async () => {
		const ui = await mountPaste({ mode: 'ask' });
		await ui.paste(block(2, 2));
		expect(ui.opened).toHaveLength(1);
		await act(async () => {
			ui.opened[0]?.confirm();
			await Promise.resolve();
		});
		expect(ui.store.state().table.rows[0]?.cells['note.Name']).toBe('x0-0');
		expect(ui.announcement()).toBe('4 cell(s) pasted');
	});
});
