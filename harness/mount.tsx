/**
 * The harness page: the **real** `GridView` against a fixture `RowSource`, plus `window.__harness`.
 *
 * Four rules shape this file, and the first is the reason the harness is worth having at all:
 *
 *  1. **Nothing is reimplemented.** The grid is `src/grid/GridView`, the store is `src/grid/store/store`, the
 *     data is `tests/fakes/rowSource`, the stylesheet is the built `styles.css`. If a component needed a seam to
 *     be mountable, the seam went into `src/**` and is reported — a fixture with its own copy of a component
 *     would pass its own tests and say nothing about the plugin.
 *  2. **One host per page load, chosen by `?host=`.** All five in one document was tried first and is wrong: an
 *     inner reveal scrolls the nearest scrollable ancestor *and* every ancestor above it, so a cell revealed in a
 *     fixture sitting 1,500 px off to the right scrolls the page to reach it — which turns assertion 9 ("never
 *     scroll the page") into a test of the harness's own layout. One host per load also lets each Playwright
 *     project take exactly the fixture's viewport, so the page can never grow a scrollbar. `harness/hosts.ts`
 *     still defines all five; `readHost()` picks one.
 *  3. **Measurements are functions, never cached facts.** `setRows()`, `getScroll()`, `geometry()` and
 *     `renderCounts()` read the live DOM each time. A number captured at mount is a number about the harness.
 *  4. **`setRows(n)` rebuilds rather than filters.** The fixture is seeded, so rebuilding at 5,000 rows produces
 *     the same rows the initial build would have; 5,000 rows are mounted only where a test needs them (#3, #4,
 *     #9), and the screenshots run at 40 so a baseline stays small and diffable.
 */
import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

import { GridView } from '../src/grid/GridView';
import { createGridStore } from '../src/grid/store/store';
import {
	addRow,
	deleteRows,
	selectCell,
	setCells,
	setViewConfig,
} from '../src/grid/store/commands';
import { focusCell as focusCellElement } from '../src/grid/keyboard/focus';
import { selectField } from '../src/grid/store/selectors';
import { createDialogPort } from '../src/grid/dialogs/port';
import { createHarnessFixture } from './fixture';
import { app } from './obsidian-runtime';
import { HOSTS, HOST_ORDER, paneSizeOf } from './hosts';
import type { HostFixture, HostId } from './hosts';
import type { GridStore } from '../src/grid/store/types';
import type { ViewConfig } from '../src/core/view/pipeline';
import type { App } from 'obsidian';
import type { NewRowValues } from '../src/grid/clipboard/pastePlan';
import type { CellValue, PropertyId } from '../src/core/types';
import type { CellWrite, RowId, RowState } from '../src/core/ops/types';

/** Rows the page starts with: enough to fill every viewport and to scroll. */
const DEFAULT_ROWS = 40;

/**
 * The six columns `fillMatrix` writes: every one of them takes the value as written, so a paste budget is a
 * budget for the data path and not for a formatter.
 */
const PASTE_FIELDS = [
	'note.Owner',
	'note.Notes',
	'note.Link',
	'note.Contact',
	'note.Phone',
	'note.Weight',
] as const;

/** A rect as the DOM reports it, rounded to two decimals so a report is readable and a diff is stable. */
export type Rect = { x: number; y: number; width: number; height: number };

export type ScrollReport = {
	/** The one scroller's own offsets. */
	readonly left: number;
	readonly top: number;
	readonly maxLeft: number;
	readonly maxTop: number;
	/** The page's offsets: they must never move (`docs/07` §Tier 4, assertions 9 and 12). */
	readonly pageX: number;
	readonly pageY: number;
	/** The two sticky lanes' computed transforms, which is how "aligned" becomes a number, not an opinion. */
	readonly headerTransform: string;
	readonly frozenTransform: string;
};

export type RenderCounts = {
	/** React commits inside the grid subtree, by `Profiler`. */
	readonly commits: number;
	/** Attribute/child mutations observed inside `.tablify-rows` since the last `mark()`, by target kind. */
	readonly cells: number;
	readonly rows: number;
	readonly layers: number;
};

export type HarnessApi = {
	readonly host: HostId;
	readonly hostWidth: number;
	readonly hostHeight: number;
	readonly paneWidth: number;
	readonly paneHeight: number;
	readonly hostPad: number;
	readonly theme: HostFixture['theme'];
	/** True when `@media (pointer: coarse)` matches — i.e. when the fixture is a touch device. */
	readonly touch: boolean;
	/** Resolves when the first grid frame has committed and the observer is watching. */
	readonly ready: Promise<true>;
	/** Rebuilds the fixture with `n` rows and returns the row count now mounted. */
	setRows(n: number): number;
	/** Applies a patch to the view options through the real command. */
	setView(patch: Partial<ViewConfig>): void;
	scrollTo(left: number, top: number): Promise<void>;
	getScroll(): ScrollReport;
	/** Selects a cell by index and moves focus to it. Resolves `false` when the index does not exist. */
	focusCell(row: number, column: number): Promise<boolean>;
	renderCounts(): RenderCounts;
	/** Resets the counts: anything seen next was caused by what happens after this call. */
	mark(): void;
	/**
	 * The rows the **store** holds right now — not the number `setRows` last built. A paste that creates rows
	 * changes this without touching the fixture, and "the correct note count in the fake source" is a claim about
	 * exactly that difference (assertions 11 and 16).
	 */
	rows(): number;
	/**
	 * One cell's value as plain text, read through the column's own `formatPlain` — i.e. *exactly* what a copy of
	 * that cell would put on the clipboard, and exactly what a paste of that text back must produce.
	 */
	cellPlain(row: number, column: number): string | null;
	/** The first row's id in view order, so a spec can name a row without reading the fixture. */
	firstRow(): string;
	/**
	 * Writes a `rows × columns` block of values through **one** `setCells` op — the write path a paste of the same
	 * size takes (`docs/07` §Tier 4, assertion 11's budget). Returns the number of cells written.
	 *
	 * The columns are the fixture's text-shaped ones, so the value that lands is the value that was written:
	 * `note.Owner`, `note.Notes`, `note.Link`, `note.Contact`, `note.Phone` and `note.Weight`. The clipboard
	 * event itself arrives in step 22, which extends this assertion to the event; what is measured here is the
	 * half that can be slow — 2,400 values, one command, one undo step, one queue batch.
	 */
	fillMatrix(rows: number, columns: number): number;
	/**
	 * The same `rows × columns` block as **TSV**, with `fillMatrix`'s value convention: `v{r}-{c}` for the
	 * fixture's text-shaped columns — which is what makes it parseable by the six columns starting at
	 * `PASTE_ANCHOR_COLUMN` (see the constant). Built here rather than in the spec so a spec never has to know
	 * how a cell is spelled.
	 */
	matrixTsv(rows: number, columns: number): string;
	/**
	 * Dispatches a real `paste` event carrying both flavours, as a spreadsheet's own copy does. Returns whether
	 * the grid consumed it (i.e. `preventDefault` was called) — a paste it refused is a paste that would have
	 * gone to the browser.
	 */
	pastePayload(payload: { readonly html: string; readonly text: string }): boolean;
	/**
	 * Dispatches a real `copy` event and reads back both flavours the grid put on it. The grid's `copy` listener
	 * is what a browser fires for `Ctrl/Cmd+C` in the grid, so this is the same code path a person uses.
	 */
	copyRange(): { readonly prevented: boolean; readonly text: string; readonly html: string };
	/** The polite live region's sentence, right now. */
	announcement(): string;
	/** The open dialog's text (title, choices and counts), or `''` when no dialog is open. */
	dialogText(): string;
	/** Clicks the choice named `name` (its own label), then the primary action. False when either is missing. */
	dialogChoose(name: string): boolean;
	/** Clicks the open dialog's primary action. False when no dialog is open. */
	dialogConfirm(): boolean;
	/** Notes the paste path asked the "view" to create. Assertion 16 compares it with the live region. */
	createdNotes(): number;
	/**
	 * Where a pasted block starts, and the six columns it lands in — so a spec names the anchor without a magic
	 * index. The column ids are the fixture's own, and the reason they are these six is written on
	 * {@link PASTE_ANCHOR_COLUMN}.
	 */
	pasteAnchor(): {
		readonly row: number;
		readonly column: number;
		readonly columns: readonly string[];
	};
	/**
	 * Inserts a synthetic row at an index, through the store's own `addRow` command. The *view* is what creates
	 * a note in the product (`createFileForView`); the harness has no vault, and assertion 12 is about the
	 * layout not jumping when the row set changes — which is the command's effect, not the file's.
	 */
	insertRow(at: number): boolean;
	/** Removes a row by index, through `deleteRows`. `false` when there is no such row. */
	removeRow(at: number): boolean;
	/** The three boxes assertion 1 compares, plus the pane's padding, measured right now. */
	geometry(): {
		readonly host: Rect;
		readonly paddingBox: Rect;
		readonly contentBox: Rect;
		readonly root: Rect;
		readonly pad: number;
		readonly border: number;
	};
};

/** Two decimals: enough to see a sub-pixel gap, few enough to read in a failure message. */
function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function rectOf(element: Element | null): Rect {
	if (element === null) {
		return { x: 0, y: 0, width: 0, height: 0 };
	}
	const rect = element.getBoundingClientRect();
	return {
		x: round2(rect.x),
		y: round2(rect.y),
		width: round2(rect.width),
		height: round2(rect.height),
	};
}

/** Two animation frames: one for React's commit, one for the layout it causes. */
function twoFrames(): Promise<void> {
	return new Promise((resolve) => {
		window.requestAnimationFrame(() => {
			window.requestAnimationFrame(() => {
				resolve();
			});
		});
	});
}

/**
 * The columns a pasted block lands in: `note.Tags` (multiSelect), `note.Notes` (longText), `note.Link`,
 * `note.Contact`, `note.Phone` and `note.File` — the six the fixture has that accept arbitrary text
 * (`parsePlain` measured over all twenty; `note.Due` would refuse `v0-0` and a paste into it would be counted as
 * skipped rather than written). The anchor cell is the first of them.
 */
const PASTE_ANCHOR_COLUMN = 10;

/** The six text-shaped columns, in order, so a spec can name a target without arithmetic. */
const PASTE_COLUMN_IDS = [
	'note.Tags',
	'note.Notes',
	'note.Link',
	'note.Contact',
	'note.Phone',
	'note.File',
] as const;

/** `fillMatrix`'s value for one cell, as text. */
function cellText(row: number, column: number): string {
	return `v${String(row)}-${String(column)}`;
}

/** The `rows × columns` block as TSV: the same values `fillMatrix` writes, through the clipboard. */
function tsvMatrix(rows: number, columns: number): string {
	const lines: string[] = [];
	for (let r = 0; r < rows; r += 1) {
		const cells: string[] = [];
		for (let c = 0; c < columns; c += 1) {
			cells.push(cellText(r, c));
		}
		lines.push(cells.join('\t'));
	}
	return lines.join('\n');
}

/**
 * A `ClipboardEvent` carrying `data`. The init dictionary is the documented way to hand an event its clipboard
 * (Chromium supports it); the `defineProperty` below is only for an engine that ignores it, and it is written as
 * a fallback rather than as the path because it bypasses the constructor.
 */
function clipboardEvent(kind: 'copy' | 'paste', data: DataTransfer): ClipboardEvent {
	const event = new ClipboardEvent(kind, {
		clipboardData: data,
		bubbles: true,
		cancelable: true,
	});
	if (event.clipboardData === null) {
		Object.defineProperty(event, 'clipboardData', { value: data });
	}
	return event;
}

/** One clipboard event at the grid's root, whichever flavour is non-empty. */
function dispatchClipboard(
	kind: 'paste',
	payload: { readonly html: string; readonly text: string },
): boolean {
	const data = new DataTransfer();
	if (payload.html !== '') {
		data.setData('text/html', payload.html);
	}
	if (payload.text !== '') {
		data.setData('text/plain', payload.text);
	}
	const event = clipboardEvent(kind, data);
	const root = document.querySelector('.tablify-root');
	if (root === null) {
		return false;
	}
	root.dispatchEvent(event);
	return event.defaultPrevented;
}

/** The simulated chrome and the mount point, built once per page load. */
function buildHost(host: HostFixture): { readonly frame: HTMLElement; readonly pane: HTMLElement } {
	const frame = document.createElement('div');
	frame.className = 'harness-frame';
	frame.dataset.host = host.id;
	frame.style.width = `${String(host.width)}px`;
	frame.style.height = `${String(host.height)}px`;

	const bar = (spec: HostFixture['bars'][number]): HTMLElement => {
		const created = document.createElement('div');
		created.className = `harness-bar harness-bar-${spec.kind}`;
		created.style.height = `${String(spec.h)}px`;
		created.textContent = spec.text;
		return created;
	};

	for (const spec of host.bars) {
		if (spec.overlay !== true) {
			frame.append(bar(spec));
		}
	}

	const pane = document.createElement('div');
	pane.className = 'harness-pane';
	pane.dataset.pane = host.id;
	pane.style.padding = `${String(host.pad)}px`;
	frame.append(pane);

	// The overlay bars last, so the keyboard really sits on top of the pane rather than shrinking it.
	for (const spec of host.bars) {
		if (spec.overlay === true) {
			frame.append(bar(spec));
		}
	}

	return { frame, pane };
}

/** Which host this load is for: `?host=phone-keyboard`, defaulting to the first of the doc's list. */
function readHost(): HostFixture {
	const wanted = new URLSearchParams(window.location.search).get('host');
	const found = HOST_ORDER.find((id) => id === wanted);
	return HOSTS[found ?? 'desktop'];
}

/**
 * Everything the page does: build the host, mount the grid, publish `window.__harness`. Called once, by the
 * bundle's own last line — the module has no side effects when it is merely imported (a test may import the
 * *types*).
 */
export function boot(): HarnessApi {
	const host = readHost();
	document.title = `Tablify harness — ${host.label}`;
	document.body.classList.add(host.theme);
	document.body.classList.toggle('theme-light', host.theme === 'theme-light');
	if (host.inset > 0) {
		// What `TablifyView` writes from `visualViewport` when the keyboard opens (`docs/04` §Keyboard and
		// viewport). It goes on **`body`**, which is where `tokens.css` declares the token — an inline value on
		// `documentElement` would be shadowed by that declaration, and the grid would not move at all. The
		// writer itself is a view concern and is not in `src/**` yet; this line is that writer, simulated.
		document.body.style.setProperty('--tablify-keyboard-inset', `${String(host.inset)}px`);
	}

	const { frame, pane } = buildHost(host);
	document.body.append(frame);

	const sizes = paneSizeOf(host);
	const counters = { commits: 0, cells: 0, rows: 0, layers: 0 };
	let firstName = '';
	let reactRoot: Root | null = null;
	let store: GridStore = mount(DEFAULT_ROWS);
	let settle: (value: true) => void = () => undefined;
	const ready = new Promise<true>((resolve) => {
		settle = resolve;
	});

	/**
	 * One observer for the whole run. A React commit count cannot tell one row from five thousand, and "typing
	 * must not re-render the grid" is exactly a claim about which *nodes* changed — so the mutations are counted
	 * by the kind of element they landed on.
	 */
	const observer = new MutationObserver((records) => {
		for (const record of records) {
			// `instanceOf` is Obsidian's cross-window-safe check, and the harness simulates exactly that
			// situation: the page, the frame's document and Obsidian's pop-out windows are different windows.
			const target = record.target.instanceOf(Element) ? record.target : null;
			if (target === null) {
				continue;
			}
			if (target.closest('.cell') !== null) {
				counters.cells += 1;
			} else if (target.closest('.grid-row') !== null) {
				counters.rows += 1;
			} else {
				counters.layers += 1;
			}
		}
	});

	/**
	 * Notes the harness's fake source created for a paste. The real view creates a *note* per row; with no vault
	 * this is the same act with the same count, and the count is the datum assertion 16 asserts.
	 */
	let createdNotes = 0;

	/**
	 * The view's half of a paste, as the harness can perform it: one row per `NewRowValues`, appended, through
	 * the store's own `addRow` — the frontmatter the real view would write becomes the row's cells here.
	 *
	 * `applyPlan` calls this **once for the whole list** before it writes anything, so a cancel means this is
	 * never called and a failure is reported rather than half-applied.
	 */
	async function createRows(values: readonly NewRowValues[]): Promise<readonly RowId[]> {
		const created: RowId[] = [];
		for (const cells of values) {
			const record: Record<PropertyId, CellValue> = {};
			for (const [fieldId, value] of cells) {
				record[fieldId] = value;
			}
			const at = store.getSnapshot().rows.length;
			let path = `Tasks/Pasted ${String(createdNotes)}.md`;
			let attempt = 0;
			while (store.getSnapshot().rows.includes(path)) {
				attempt += 1;
				path = `Tasks/Pasted ${String(createdNotes)} (${String(attempt)}).md`;
			}
			const row: RowState = { filePath: path, cells: record };
			if (addRow(store, { at, row }, 'Paste row').ok) {
				createdNotes += 1;
				created.push(path);
			}
		}
		await twoFrames();
		return created;
	}

	/**
	 * Inserts a synthetic row at an index, through the store's own `addRow` command. Two callers: the API
	 * (assertion 12) and the toolbar's **New row** button, which the product's toolbar only renders when the
	 * view hands it a way to create a note — a fixture that left the button out would be measuring a toolbar
	 * the product does not ship. The path is made unique so pressing it twice is two rows, not a refusal.
	 */
	function insertAt(at: number): boolean {
		const cells: Record<string, string> = {};
		for (const field of PASTE_FIELDS) {
			cells[field] = `inserted-${String(at)}`;
		}
		let path = `Tasks/Inserted ${String(at)}.md`;
		let attempt = 0;
		while (store.getSnapshot().rows.includes(path)) {
			attempt += 1;
			path = `Tasks/Inserted ${String(at)} (${String(attempt)}).md`;
		}
		const row: RowState = { filePath: path, cells };
		return addRow(store, { at, row }, 'Insert row').ok;
	}

	/**
	 * One port for the page: it closes over the app, exactly as `TablifyView`'s does.
	 *
	 * The cast is the harness's only one, and it exists because `harness/obsidian-runtime.ts` is a *stand-in* for
	 * the host module: its `app` is the three fields the dialogs touch (they are built with `document` and hand the
	 * app to `Modal`'s constructor, which the shim implements). Writing out the other eight `App` members as
	 * no-ops would be a longer, more convincing lie than one assertion with this comment.
	 */
	const dialogs = createDialogPort(app as App);

	/** The store, the React root, and the first frame. Returns the store so `setRows` can replace it. */
	function mount(rows: number): GridStore {
		reactRoot?.unmount();
		const fixture = createHarnessFixture(rows);
		const created = createGridStore({ source: fixture.source });
		reactRoot = createRoot(pane);
		reactRoot.render(
			<Profiler
				id="tablify-grid"
				onRender={() => {
					counters.commits += 1;
				}}
			>
				<GridView
					store={created}
					initialPaneWidth={sizes.width}
					/*
					 * The view's own job is to create the note; the harness has no vault, so a row is what it can
					 * do. What matters to the layout assertions is that the toolbar's **primary action** exists as
					 * a button (`Toolbar` renders it only when the view hands one in, so a fixture without it would
					 * be measuring a toolbar the product never ships) and that the row count follows it.
					 */
					onNewRow={() => {
						insertAt(0);
					}}
					/*
					 * The dialogs, through the same port `TablifyView` builds (the harness `obsidian` module has a
					 * real `Modal`, so the paste dialog is a real modal in the page — assertion 16 clicks it).
					 */
					dialogs={dialogs}
					/*
					 * The paste settings the shipped view passes: the defaults, plus the one capability only a view
					 * has. Without `createRows` a paste that wanted rows would say it could not create them, and
					 * assertion 16 would be measuring a refusal.
					 */
					paste={{
						mode: 'expand',
						warnOnLargeImport: true,
						largeImportThreshold: 250,
						createRows,
					}}
				/>
			</Profiler>,
		);
		return created;
	}

	const scroller = (): HTMLElement | null => document.querySelector('.tablify-scroller');

	/** The row the store holds for a path, as the state does — one lookup, in one place. */
	const stateRow = (filePath: RowId): RowState | undefined =>
		store.state().table.rows.find((row) => row.filePath === filePath);

	void twoFrames().then(() => {
		const layer = document.querySelector('.tablify-rows');
		if (layer !== null) {
			observer.observe(layer, {
				attributes: true,
				childList: true,
				subtree: true,
				characterData: true,
			});
		}
		firstName = store.getSnapshot().order.rows[0] ?? '';
		settle(true);
	});

	const api: HarnessApi = {
		host: host.id,
		hostWidth: host.width,
		hostHeight: host.height,
		paneWidth: sizes.width,
		paneHeight: sizes.height,
		hostPad: host.pad,
		theme: host.theme,
		touch: window.matchMedia('(pointer: coarse)').matches,
		ready,
		setRows(n: number): number {
			firstName = '';
			store.dispose();
			store = mount(n);
			observer.disconnect();
			void twoFrames().then(() => {
				const layer = document.querySelector('.tablify-rows');
				if (layer !== null) {
					observer.observe(layer, { attributes: true, childList: true, subtree: true });
				}
				firstName = store.getSnapshot().order.rows[0] ?? '';
			});
			return n;
		},
		setView(patch: Partial<ViewConfig>): void {
			setViewConfig(store, patch);
		},
		async scrollTo(left: number, top: number): Promise<void> {
			const element = scroller();
			if (element === null) {
				return;
			}
			element.scrollLeft = left;
			element.scrollTop = top;
			await twoFrames();
		},
		getScroll(): ScrollReport {
			const element = scroller();
			const header = document.querySelector('.tablify-header');
			const frozen = document.querySelector('.tablify-frozen-col');
			const view = document.defaultView;
			return {
				left: element?.scrollLeft ?? 0,
				top: element?.scrollTop ?? 0,
				maxLeft: element === null ? 0 : element.scrollWidth - element.clientWidth,
				maxTop: element === null ? 0 : element.scrollHeight - element.clientHeight,
				pageX: view?.scrollX ?? 0,
				pageY: view?.scrollY ?? 0,
				headerTransform: header === null ? '' : getComputedStyle(header).transform,
				frozenTransform: frozen === null ? '' : getComputedStyle(frozen).transform,
			};
		},
		async focusCell(row: number, column: number): Promise<boolean> {
			const snapshot = store.getSnapshot();
			const filePath = snapshot.order.rows[row];
			const fieldId = snapshot.order.fields[column];
			if (filePath === undefined || fieldId === undefined) {
				return false;
			}
			selectCell(store, { filePath, fieldId });
			await twoFrames();
			const landed = focusCellElement(document.querySelector('.tablify-root'), {
				filePath,
				fieldId,
			});
			return landed === 'cell';
		},
		renderCounts(): RenderCounts {
			return { ...counters };
		},
		mark(): void {
			counters.commits = 0;
			counters.cells = 0;
			counters.rows = 0;
			counters.layers = 0;
		},
		rows(): number {
			return store.getSnapshot().rows.length;
		},
		cellPlain(row: number, column: number): string | null {
			const snapshot = store.getSnapshot();
			const filePath = snapshot.order.rows[row];
			const fieldId = snapshot.order.fields[column];
			if (filePath === undefined || fieldId === undefined) {
				return null;
			}
			const value = stateRow(filePath)?.cells[fieldId] ?? null;
			const field = selectField(store.state(), fieldId);
			if (field === undefined) {
				return null;
			}
			return field.descriptor.formatPlain(value, field.context);
		},
		insertRow(at: number): boolean {
			return insertAt(at);
		},
		removeRow(at: number): boolean {
			const filePath = store.getSnapshot().order.rows[at];
			if (filePath === undefined) {
				return false;
			}
			return deleteRows(store, [filePath]).ok;
		},
		fillMatrix(rows: number, columns: number): number {
			const snapshot = store.getSnapshot();
			const order = snapshot.order;
			const fields = PASTE_FIELDS.slice(0, columns);
			const writes: CellWrite[] = [];
			for (let r = 0; r < rows; r += 1) {
				const filePath = order.rows[r];
				if (filePath === undefined) {
					break;
				}
				for (const [c, fieldId] of fields.entries()) {
					const numeric = fieldId === 'note.Weight';
					writes.push({
						filePath,
						fieldId,
						value: numeric ? r * 10 + c / 10 : `v${String(r)}-${String(c)}`,
					});
				}
			}
			setCells(store, writes, `Fill ${String(rows)} × ${String(columns)}`);
			return writes.length;
		},
		firstRow(): string {
			return firstName;
		},
		matrixTsv(rows: number, columns: number): string {
			return tsvMatrix(rows, columns);
		},
		pastePayload(payload: { readonly html: string; readonly text: string }): boolean {
			return dispatchClipboard('paste', payload);
		},
		copyRange(): { readonly prevented: boolean; readonly text: string; readonly html: string } {
			const data = new DataTransfer();
			const event = clipboardEvent('copy', data);
			const root = document.querySelector('.tablify-root');
			root?.dispatchEvent(event);
			return {
				prevented: event.defaultPrevented,
				text: data.getData('text/plain'),
				html: data.getData('text/html'),
			};
		},
		announcement(): string {
			return document.querySelector('.tablify-live')?.textContent ?? '';
		},
		dialogText(): string {
			return document.querySelector('.modal-container .modal-content')?.textContent ?? '';
		},
		dialogChoose(name: string): boolean {
			const choices = Array.from(document.querySelectorAll('.tablify-dlg-choice'));
			let found: HTMLButtonElement | null = null;
			for (const choice of choices) {
				const label = choice.querySelector('.tablify-dlg-choice-name')?.textContent ?? '';
				if (choice.instanceOf(HTMLButtonElement) && label === name) {
					found = choice;
				}
			}
			if (found === null) {
				return false;
			}
			found.click();
			return this.dialogConfirm();
		},
		dialogConfirm(): boolean {
			const primary = document.querySelector<HTMLButtonElement>(
				'.tablify-dlg-btn.is-primary',
			);
			if (primary === null) {
				return false;
			}
			primary.click();
			return true;
		},
		createdNotes(): number {
			return createdNotes;
		},
		pasteAnchor(): {
			readonly row: number;
			readonly column: number;
			readonly columns: readonly string[];
		} {
			return { row: 0, column: PASTE_ANCHOR_COLUMN, columns: [...PASTE_COLUMN_IDS] };
		},
		geometry(): {
			readonly host: Rect;
			readonly paddingBox: Rect;
			readonly contentBox: Rect;
			readonly root: Rect;
			readonly pad: number;
			readonly border: number;
		} {
			// The mount point's own boxes, derived from its rect and its computed border/padding rather than
			// from `offsetWidth` — an integer rounding would hide a sub-pixel disagreement, and the assertion
			// is a zero-difference one.
			const style = getComputedStyle(pane);
			const px = (value: string): number => Number.parseFloat(value) || 0;
			const left = px(style.borderLeftWidth);
			const top = px(style.borderTopWidth);
			const right = px(style.borderRightWidth);
			const bottom = px(style.borderBottomWidth);
			const padX = px(style.paddingLeft);
			const padY = px(style.paddingTop);
			const box = rectOf(pane);
			const paddingBox: Rect = {
				x: round2(box.x + left),
				y: round2(box.y + top),
				width: round2(box.width - left - right),
				height: round2(box.height - top - bottom),
			};
			return {
				host: rectOf(frame),
				paddingBox,
				contentBox: {
					x: round2(paddingBox.x + padX),
					y: round2(paddingBox.y + padY),
					width: round2(paddingBox.width - padX - px(style.paddingRight)),
					height: round2(paddingBox.height - padY - px(style.paddingBottom)),
				},
				root: rectOf(document.querySelector('.tablify-root')),
				pad: padX,
				border: left,
			};
		},
	};

	return api;
}

/*
 * The bundle's entry point. `Object.assign` rather than a global `declare`: the page is the only consumer of
 * `window.__harness`, and a program-wide augmentation from a harness file would type-check a member that a spec
 * could never reach. `tests/layout/harness-api.d.ts` declares the shape for the specs instead, from the same
 * `HarnessApi` type this function returns — one definition, two readers.
 */
Object.assign(window, { __harness: boot() });
