/**
 * The grid, mounted: what step 17 promises, asserted on real React and real DOM.
 *
 * The five promises, and the assertion that keeps each one honest:
 *
 *  1. **The window is a window.** Thirty rows are configured, nine-ish are in the DOM. That is the whole point
 *     of the step: 5,000 rows must cost nine cells, not 5,000.
 *  2. **Pinning is the pane's answer, not the device's.** A 389 px pane draws no frozen lane and puts the
 *     gutter in the scrolling lane; a 900 px pane draws the frozen lane, puts the gutter in it, and does not
 *     repeat the primary column in the scrolling lane. `docs/08` §P21 in two assertions.
 *  3. **The lanes are wired to the same scroll.** One scroll position, one transform writer: the header moves
 *     on X, the frozen lane on Y, and the row lane moves because it is *content* (its `translateY` comes from
 *     the window, not from the scroll).
 *  4. **The empty state tells the truth.** Nothing in the vault ("This table is empty" + the count) and
 *     nothing *matching* ("No rows match this view" + the way out) are different sentences, because they are
 *     different problems.
 *  5. **The status bar counts what the store counts.** The line is `selectStatusSummary`'s numbers, formatted
 *     once — the test reads the same selector, so the bar cannot drift from the model.
 *
 * jsdom has no layout, so every measurement is 0 and the window settles at `0 … 9`. That is not a limitation
 * here: it makes the *window* deterministic, and the exact window arithmetic is already covered by
 * `tests/dom/window-math.test.ts` against 800 px viewports. The measurements that only a browser can take are
 * step 21's harness, on purpose.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { FALLBACK_HEADER_HEIGHT } from '../../src/grid/layout';
import { GridView } from '../../src/grid/GridView';
import { createGridStore } from '../../src/grid/store/store';
import { selectStatusSummary } from '../../src/grid/store/selectors';
import { statusLine } from '../../src/grid/StatusBar';
import { setCell, setViewConfig } from '../../src/grid/store/commands';
import { resolveField } from '../../src/core/schema/propertySchema';
import { createFakeRowSource } from '../fakes/rowSource';
import type { FieldContext } from '../../src/core/types';
import type { GridStore } from '../../src/grid/store/types';

Object.assign(window, { IS_REACT_ACT_ENVIRONMENT: true });

const CONTEXT: FieldContext = {
	path: '',
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
	columnName: '',
};

const FIELDS = [
	resolveField({ id: 'note.Name', name: 'Name', source: 'note' }, CONTEXT),
	resolveField({ id: 'note.Status', name: 'Status', source: 'note' }, CONTEXT),
	resolveField({ id: 'note.Owner', name: 'Owner', source: 'note' }, CONTEXT),
];

const ROWS = 30;

function makeStore(): GridStore {
	const rows = Array.from({ length: ROWS }, (_unused, index) => ({
		filePath: `Notes/${String(index).padStart(3, '0')}.md`,
		cells: {
			'note.Name': `Row ${String(index)}`,
			'note.Status': index % 2 === 0 ? 'Todo' : 'Done',
			'note.Owner': index % 3 === 0 ? 'Ada' : 'Sam',
		},
	}));
	return createGridStore({ source: createFakeRowSource({ fields: FIELDS, rows }) });
}

let roots: { unmount: () => void }[] = [];

/** Mounts into `document.body`; `initialPaneWidth` is handed in, exactly as `TablifyView` measures it. */
function mount(store: GridStore, initialPaneWidth: number): HTMLElement {
	const root = createRoot(document.body);
	roots.push(root);
	act(() => {
		root.render(
			createElement(GridView, {
				store,
				presentation: { density: 'medium' },
				initialPaneWidth,
				onNewRow: () => undefined,
			}),
		);
	});
	return document.body;
}

const query = <T extends Element>(selector: string): T[] =>
	Array.from(document.body.querySelectorAll<T>(selector));

afterEach(() => {
	act(() => {
		for (const root of roots) {
			root.unmount();
		}
	});
	roots = [];
	document.body.replaceChildren();
});

describe('GridView', () => {
	it('renders a window of the lane, not the lane', () => {
		const store = makeStore();
		const body = mount(store, 900);

		const rendered = body.querySelectorAll('.grid-row');
		expect(rendered.length).toBeGreaterThan(0);
		expect(rendered.length).toBeLessThan(ROWS);

		// The rows that *are* mounted are the first ones, and they are the rows the store put there. (At 900 px
		// the primary column is pinned, so its value is in the frozen lane and this lane carries the rest.)
		expect(rendered[0]?.getAttribute('data-row')).toBe('Notes/000.md');
		expect(body.querySelector('.tablify-frozen-col .grid-row')?.textContent).toContain('Row 0');
		expect(rendered[0]?.textContent).toContain('Todo');

		// The canvas is as tall as the whole lane — that is what the scrollbar is scrolling: 30 rows × 40 px
		// (the `medium` density) plus the header band the rows slide under.
		const canvas = body.querySelector<HTMLElement>('.tablify-canvas');
		expect(canvas?.style.height).toBe(`${String(ROWS * 40 + FALLBACK_HEADER_HEIGHT)}px`);
	});

	it('moves the row lane by the window, and the header by the scroll', () => {
		const store = makeStore();
		const body = mount(store, 900);

		// The rows sit under the header band and are translated to the window's first item. In jsdom the window
		// starts at 0, so the translation is 0 — what matters is that the two facts are separate properties.
		const lane = body.querySelector<HTMLElement>('.tablify-rows');
		expect(lane?.style.top).toBe('40px');
		expect(lane?.style.transform).toBe('translateY(0px)');

		const header = body.querySelector<HTMLElement>('.tablify-header');
		expect(header?.style.transform).toBe('translateX(0px)');
	});

	it('draws one header cell per visible column, in the order the store resolved', () => {
		const store = makeStore();
		const body = mount(store, 900);

		// Pinned at 900 px: the corner owns the gutter head and the primary column; the scrolling lane starts
		// at the second column, in the store's order.
		const names = Array.from(
			body.querySelectorAll<HTMLElement>('.tablify-header .hcell-name'),
		).map((cell) => cell.textContent);
		expect(names).toEqual(['Status', 'Owner']);
		expect(
			Array.from(body.querySelectorAll<HTMLElement>('.tablify-corner .hcell-name')).map(
				(cell) => cell.textContent,
			),
		).toEqual(['#', 'Name']);
	});

	it('pins the primary column in a wide pane — and does not repeat it in the scrolling lane', () => {
		const store = makeStore();
		const body = mount(store, 900);

		expect(body.querySelector('.tablify-frozen-col')).not.toBeNull();
		expect(body.querySelector('.tablify-corner')).not.toBeNull();

		// The scrolling lane's header starts at Status — the primary column is drawn exactly once, on the left,
		// and the corner owns both the gutter head and that column's header.
		const names = query<HTMLElement>('.tablify-header .hcell-name').map(
			(cell) => cell.textContent,
		);
		expect(names).toEqual(['Status', 'Owner']);
		expect(
			query<HTMLElement>('.tablify-corner .hcell-name').map((cell) => cell.textContent),
		).toEqual(['#', 'Name']);

		// The gutter belongs to the frozen lane, so the scrolling lane has no gutter cell.
		expect(body.querySelectorAll('.tablify-header .gutter-head')).toHaveLength(0);
		expect(body.querySelectorAll('.tablify-frozen-col .gutter')).not.toHaveLength(0);
	});

	it('pins nothing in a narrow pane, and keeps the gutter scrollable instead', () => {
		const store = makeStore();
		const body = mount(store, 389);

		expect(body.querySelector('.tablify-frozen-col')).toBeNull();
		expect(body.querySelector('.tablify-corner')).toBeNull();

		// Nothing is hidden to pay for the narrow pane: every column is in the scrolling lane, with the gutter.
		// Nothing is hidden to pay for the narrow pane: every column is in the scrolling lane, with the gutter.
		const names = query<HTMLElement>('.tablify-header .hcell-name').map(
			(cell) => cell.textContent,
		);
		expect(names).toEqual(['#', 'Name', 'Status', 'Owner']);
		expect(body.querySelectorAll('.grid-row .gutter')).not.toHaveLength(0);
	});

	it('flips pinning on the pane width alone, and crosses back', () => {
		const store = makeStore();
		// 599 → pinned is off; 600 → on. The threshold is the pane's, never the device's (`docs/08` §P21), so
		// the same store renders both ways with nothing else changed.
		expect(mount(store, 599).querySelector('.tablify-frozen-col')).toBeNull();
		act(() => {
			for (const root of roots) {
				root.unmount();
			}
		});
		roots = [];
		document.body.replaceChildren();
		expect(mount(store, 600).querySelector('.tablify-frozen-col')).not.toBeNull();
	});

	it('says "this table is empty" only when the vault is empty', () => {
		const store = createGridStore({
			source: createFakeRowSource({ fields: FIELDS, rows: [] }),
		});
		const body = mount(store, 900);

		expect(body.querySelector('.tablify-empty-title')?.textContent).toBe('This table is empty');
		expect(body.querySelector('.tablify-empty-body')?.textContent).toContain('0 rows');
		expect(body.querySelectorAll('.grid-row')).toHaveLength(0);
	});

	it('says "no rows match" when rows exist but the view hides them', () => {
		const store = makeStore();
		setViewConfig(store, { search: 'nothing matches this' }, 'Search');
		const body = mount(store, 900);

		expect(body.querySelector('.tablify-empty-title')?.textContent).toBe(
			'No rows match this view',
		);
		expect(body.querySelector('.tablify-empty-body')?.textContent).toContain('30 rows');
		expect(body.querySelectorAll('.grid-row')).toHaveLength(0);
	});

	it('renders a group header as a lane item, one row tall', () => {
		const store = makeStore();
		setViewConfig(store, { groupBy: 'note.Status' }, 'Group');
		const body = mount(store, 900);

		const headers = query<HTMLElement>('.grid-group');
		expect(headers.length).toBeGreaterThan(0);
		// Grouped: the first lane item is the group, not a row.
		const lane = body.querySelector('.tablify-rows');
		expect(lane?.firstElementChild?.className).toContain('grid-group');
		expect(headers[0]?.querySelector('.grid-group-label')?.textContent).toBeTruthy();
	});

	it('formats the status bar from the store’s own summary', () => {
		const store = makeStore();
		const body = mount(store, 900);

		const summary = selectStatusSummary(store.getSnapshot());
		const line = body.querySelector('.tablify-statusbar')?.textContent ?? '';
		expect(line).toBe(statusLine(summary));
		expect(line).toContain('30');
	});
});

describe('GridView — what the window costs', () => {
	/**
	 * **A keystroke repaints one cell.** Step 16 measured the mechanism with probes (181 mounted components, 3
	 * renders); this measures the *product*: the DOM is watched while one value changes, and exactly one cell's
	 * text moves. React's own render counts are not observable from here, so the assertion is on what the user
	 * can see — which is the thing the rule exists to protect, and the thing a probe can only model.
	 */
	it('changes one cell’s text for one edit', async () => {
		const store = makeStore();
		const body = mount(store, 900);
		const target = 'Notes/003.md::note.Status';

		/** Every cell on screen, by its own id: the before/after picture the assertion compares. */
		const texts = (): Map<string, string | null> => {
			const seen = new Map<string, string | null>();
			for (const cell of Array.from(body.querySelectorAll('.cell'))) {
				seen.set(cell.getAttribute('data-cell') ?? '?', cell.textContent);
			}
			return seen;
		};

		const before = texts();
		await act(async () => {
			setCell(store, { filePath: 'Notes/003.md', fieldId: 'note.Status' }, 'In progress');
			// The store applies through a microtask (the write queue's own flush path); letting it run inside
			// `act` keeps React's updates inside the boundary the test owns.
			await Promise.resolve();
		});
		const after = texts();

		// One cell's text differs. Not one cell re-rendered — React's render count is not observable from here —
		// but one cell's text moved, which is the promise the user can check.
		const changed = [...after]
			.filter(([id, text]) => before.get(id) !== text)
			.map(([id]) => id);
		expect(changed).toEqual([target]);
		expect(after.get(target)).toBe('In progress');
	});

	/**
	 * **5,000 rows × 20 columns still mounts a window.** This is jsdom, so it measures the *data path and the
	 * mount*, not a browser paint: the honest claim is "the store can hold 5,000 × 20 and the first frame
	 * mounts the window" — the paint budget belongs to step 21's harness, where a real compositor is watching.
	 * The bound is generous on purpose (a shared CI container is not a benchmark); the number that matters is
	 * in the assertion below it, and it is exact.
	 */
	it('mounts a window — not a table — for 5,000 rows × 20 columns', () => {
		const wideFields = Array.from({ length: 20 }, (_unused, index) =>
			resolveField(
				{ id: `note.F${String(index)}`, name: `F${String(index)}`, source: 'note' },
				CONTEXT,
			),
		);
		const rows = Array.from({ length: 5_000 }, (_unused, index) => {
			const cells: Record<string, string> = {};
			for (const field of wideFields) {
				cells[field.definition.id] = `${field.definition.name}-${String(index)}`;
			}
			return { filePath: `Big/${String(index).padStart(5, '0')}.md`, cells };
		});

		const started = performance.now();
		const store = createGridStore({
			source: createFakeRowSource({ fields: wideFields, rows }),
		});
		const body = mount(store, 900);
		const elapsed = performance.now() - started;

		expect(store.getSnapshot().rows).toHaveLength(5_000);
		expect(elapsed).toBeLessThan(5_000);

		// The window: a handful of rows, each with all twenty columns — and nowhere near 100,000 cells. The two
		// lanes hold the same window (that is what keeps them in step), so the window height is counted once.
		const windowRows = body.querySelectorAll('.tablify-rows .grid-row').length;
		const frozenRows = body.querySelectorAll('.tablify-frozen-col .grid-row').length;
		const mountedCells = body.querySelectorAll('.cell').length;
		expect(windowRows).toBeLessThan(20);
		expect(frozenRows).toBe(windowRows);
		expect(mountedCells).toBe(windowRows * 20);
		expect(mountedCells).toBeLessThan(400);
	});
});
