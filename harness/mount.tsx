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
import { createHarnessFixture } from './fixture';
import { HOSTS, HOST_ORDER, paneSizeOf } from './hosts';
import type { HostFixture, HostId } from './hosts';
import type { GridStore } from '../src/grid/store/types';
import type { ViewConfig } from '../src/core/view/pipeline';
import type { CellWrite, RowState } from '../src/core/ops/types';

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
	rows(): number;
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
	let rowCount = DEFAULT_ROWS;
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
				/>
			</Profiler>,
		);
		return created;
	}

	const scroller = (): HTMLElement | null => document.querySelector('.tablify-scroller');

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
			rowCount = n;
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
			return rowCount;
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
