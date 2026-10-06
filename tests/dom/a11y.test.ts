/**
 * The ARIA contract of the grid, asserted **on the mounted tree** rather than on the builders.
 *
 * `src/grid/a11y/roles.tsx` owns the roles; `tests/unit/` proves the builders return them. What neither proves
 * is that the components *use* them — a builder nothing spreads is a comment with a return type. So this file
 * mounts the real `GridView` against the fake row source and reads the attributes off real elements, which is
 * the only way to catch the failure mode that matters: a rewrite of a component that quietly drops the
 * `aria-*` props it used to spread.
 *
 * Four statements from `docs/04` §Accessibility, one `describe` each:
 *
 *  · **one grid, real indices** — the root is the grid and its `aria-rowcount` is the *view's* count while only a
 *    window of rows is mounted (`docs/04`: *"Indices count virtualized-but-absent cells"*); every mounted row
 *    and cell carries one-based `aria-rowindex`/`aria-colindex` in view space;
 *  · **exactly one tab stop, never a positive one** — the roving `tabindex` moves the stop to the active cell and
 *    the grid gives its own up, so the count of `tabindex="0"` elements is 1 before and 1 after; and no element
 *    anywhere carries a `tabindex` above 0, which is the one ARIA mistake that reorders a whole document;
 *  · **read-only cells say so** — a `formula.*` column is not editable, and its cells carry `aria-readonly="true"`
 *    plus a `title` saying why, rather than opening an editor that discards what is typed into it. Editable
 *    cells carry **no** `aria-readonly` attribute at all: `false` is the ARIA default for a grid cell, so the
 *    attribute is present only where it is informative;
 *  · **exactly one polite region, and it is the operations one** — `.tablify-live` is `role="status"` with
 *    `aria-live="polite"`, it exists while empty (a region created together with its text has no change for a
 *    screen reader to observe), and it is the *only* live region in a grid that has rows. This is the assertion
 *    that found a real defect during step 27: the status bar carried `role="status"` too, so its "3 cells in 2
 *    rows selected" would have been announced on every arrow key. The status bar is now a named group, and the
 *    empty state keeps its own region for the opposite reason — that text appears once, as a filter's answer.
 *
 * jsdom has no layout, so the window settles deterministically and every cell is in one lane; that is why the
 * "mounted rows are fewer than the row count" assertion is stable here. The browser-native halves (a real screen
 * reader, real focus order) are `docs/manual-test-log.md` work, not this file's.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { GridView } from '../../src/grid/GridView';
import {
	ACTIVE_TAB_INDEX,
	IDLE_TAB_INDEX,
	cellTabIndex,
	rootTabIndex,
} from '../../src/grid/keyboard/focus';
import { announcementOf, cellRoleProps } from '../../src/grid/a11y/roles';
import { createGridStore } from '../../src/grid/store/store';
import { resolveField } from '../../src/core/schema/propertySchema';
import { createFakeRowSource } from '../fakes/rowSource';
import type { CellValue, FieldContext } from '../../src/core/types';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
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

/**
 * Three columns, one of them uneditable **by source**: a `formula.*` property is never writable from the grid
 * (`propertySchema.ts`), so its cells must announce that rather than pretend to be inputs.
 */
const COLUMNS = [
	{ id: 'note.Name', name: 'Name', type: 'text', value: 'Row' },
	{ id: 'note.Status', name: 'Status', type: 'singleSelect', value: 'Todo' },
	{ id: 'formula.Score', name: 'Score', type: 'number', value: 3 },
] as const;

const ROWS = 40;

type Fixture = {
	readonly store: GridStore;
	readonly ids: readonly string[];
};

function makeFixture(): Fixture {
	const fields: ResolvedField[] = COLUMNS.map((column) =>
		resolveField(
			{
				id: column.id,
				name: column.name,
				// `note.*` is writable, `formula.*` is not — the prefix decides, not this test.
				source: column.id.startsWith('formula.') ? 'formula' : 'note',
				fieldOptions: { type: column.type },
			},
			{ ...CONTEXT, columnName: column.name },
		),
	);
	const rows = Array.from({ length: ROWS }, (_unused, index) => {
		const cells: Record<string, CellValue> = {};
		for (const [at, column] of COLUMNS.entries()) {
			const id = fields[at]?.definition.id ?? column.id;
			cells[id] = column.type === 'number' ? index : column.value;
		}
		return { filePath: `Notes/${String(index).padStart(3, '0')}.md`, cells };
	});
	return {
		store: createGridStore({ source: createFakeRowSource({ fields, rows }) }),
		ids: fields.map((field) => field.definition.id),
	};
}

let roots: { unmount: () => void }[] = [];

/** Mounts into `document.body` at phone width: one lane, so every cell is in the DOM lane under test. */
function mount(store: GridStore): HTMLElement {
	const root = createRoot(document.body);
	roots.push(root);
	act(() => {
		root.render(
			createElement(GridView, {
				store,
				presentation: { density: 'medium' },
				initialPaneWidth: 389,
			}),
		);
	});
	return document.body;
}

afterEach(() => {
	for (const root of roots) {
		act(() => {
			root.unmount();
		});
	}
	roots = [];
	document.body.replaceChildren();
});

function all(selector: string): Element[] {
	return Array.from(document.body.querySelectorAll(selector));
}

function attr(selector: string, name: string): (string | null)[] {
	return all(selector).map((element) => element.getAttribute(name));
}

describe('one grid, in view space', () => {
	it('is the grid, and its counts are the view’s, not the DOM window’s', () => {
		const { store, ids } = makeFixture();
		const body = mount(store);
		const grid = body.querySelector<HTMLElement>('.tablify-root');
		expect(grid?.getAttribute('role')).toBe('grid');
		expect(grid?.getAttribute('aria-label')).toBe('Tablify grid');
		expect(grid?.getAttribute('aria-rowcount')).toBe(String(ROWS));
		expect(grid?.getAttribute('aria-colcount')).toBe(String(ids.length));

		// The window is a window: 40 rows configured, far fewer mounted — and the count above still says 40.
		const mountedRows = all('.grid-row');
		expect(mountedRows.length).toBeGreaterThan(0);
		expect(mountedRows.length).toBeLessThan(ROWS);
	});

	it('numbers rows and cells from one, in view order, with no zero anywhere', () => {
		const { store, ids } = makeFixture();
		mount(store);

		const rowIndices = attr('.grid-row', 'aria-rowindex').map((value) => Number(value));
		expect(rowIndices.length).toBeGreaterThan(0);
		expect(rowIndices).not.toContain(0);
		expect(rowIndices).not.toContain(null);
		expect(rowIndices[0]).toBe(1);
		// Strictly increasing: a screen reader reading "row 1, row 1, row 3" is a bug in the window arithmetic.
		expect([...rowIndices].sort((a, b) => a - b)).toEqual(rowIndices);

		const colIndices = attr('.grid-row .cell', 'aria-colindex').map((value) => Number(value));
		expect(colIndices).not.toContain(0);
		expect(colIndices).not.toContain(null);
		expect(Math.max(...colIndices)).toBe(ids.length);

		// Every cell is a gridcell with a selection state of its own, and rows report theirs.
		expect(attr('.grid-row .cell', 'role').every((value) => value === 'gridcell')).toBe(true);
		expect(attr('.grid-row .cell', 'aria-selected').every((value) => value === 'false')).toBe(
			true,
		);
		expect(attr('.grid-row', 'aria-selected').every((value) => value === 'false')).toBe(true);

		// The header lane is a row of columnheaders, and the gutter head names column zero — the one column
		// index that is legitimately 0, because it is not part of the data columns.
		const headers = all('.hcell[role="columnheader"]');
		expect(headers.length).toBeGreaterThan(0);
		expect(attr('.hcell[role="columnheader"]', 'aria-colindex').includes('1')).toBe(true);
	});
});

describe('read-only cells', () => {
	it('marks the formula column read-only, with a reason, and leaves editable cells unflagged', () => {
		const { store } = makeFixture();
		mount(store);

		const readonly = all('.cell[aria-readonly="true"]');
		expect(readonly.length).toBeGreaterThan(0);
		for (const element of readonly) {
			// `docs/01` §Editing: disabled cells explain themselves instead of silently discarding input.
			expect(element.getAttribute('title')).toBe('This column is read-only');
		}
		// The flagged cells are exactly the formula column's, and the writable columns say nothing at all:
		// `aria-readonly="false"` is the ARIA default for a cell, so absence is the correct encoding.
		expect(
			readonly.every((element) => element.getAttribute('data-field') === 'formula.Score'),
		).toBe(true);
		expect(all('.cell[aria-readonly="false"]')).toEqual([]);
		expect(
			all('.cell[data-field="note.Name"]').every(
				(element) => !element.hasAttribute('aria-readonly'),
			),
		).toBe(true);
	});

	it('returns the flag from the builder only when the cell is uneditable', () => {
		const editable = cellRoleProps({
			rowIndex: 0,
			columnIndex: 0,
			selected: false,
			readOnly: false,
		});
		expect(editable['aria-readonly']).toBeUndefined();
		expect(editable.title).toBeUndefined();
		const uneditable = cellRoleProps({
			rowIndex: 4,
			columnIndex: 2,
			selected: true,
			readOnly: true,
		});
		expect(uneditable['aria-readonly']).toBe(true);
		expect(uneditable.title).toBe('This column is read-only');
		// Indices stay one-based in the builder too, so the two halves cannot drift.
		expect(uneditable['aria-rowindex']).toBe(5);
		expect(uneditable['aria-colindex']).toBe(3);
	});
});

describe('the tab stops', () => {
	it('keeps exactly one stop, hands it to the active cell, and never goes positive', () => {
		const { store, ids } = makeFixture();
		const body = mount(store);

		// At rest the grid itself is the way in — one stop, and it is the root.
		expect(body.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
		expect(body.querySelector('.tablify-root')?.getAttribute('tabindex')).toBe('0');

		// A press on a cell moves the roving stop to it, and the root gives its own up.
		const first = ids[0] ?? '';
		const cell = body.querySelector<HTMLElement>(`[data-cell="Notes/000.md::${first}"]`);
		expect(cell).not.toBeNull();
		act(() => {
			cell?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		});

		const stops = body.querySelectorAll('[tabindex="0"]');
		expect(stops).toHaveLength(1);
		expect(stops[0]?.classList.contains('cell')).toBe(true);
		expect(body.querySelector('.tablify-root')?.getAttribute('tabindex')).toBe(
			String(IDLE_TAB_INDEX),
		);

		// Nothing inside the grid may carry a positive `tabindex`: it would take the stop out of document order.
		const positive = all('[tabindex]').filter(
			(element) => Number(element.getAttribute('tabindex')) > 0,
		);
		expect(positive).toEqual([]);

		// The constants and the two opposite readings of the same boolean: the *root* takes the stop only while
		// nothing is selected, and a *cell* takes it only while it is the active one — which is why exactly one
		// element is ever tabbable, and why both halves must be asserted rather than assumed.
		expect(ACTIVE_TAB_INDEX).toBe(0);
		expect(IDLE_TAB_INDEX).toBe(-1);
		expect(rootTabIndex(true)).toBe(IDLE_TAB_INDEX);
		expect(rootTabIndex(false)).toBe(ACTIVE_TAB_INDEX);
		expect(cellTabIndex(true)).toBe(ACTIVE_TAB_INDEX);
		expect(cellTabIndex(false)).toBe(IDLE_TAB_INDEX);
	});
});

describe('the live regions', () => {
	it('has exactly one in a populated grid: the operations region, polite and empty at rest', () => {
		const { store } = makeFixture();
		mount(store);
		const regions = all('[role="status"]');
		// One. The status bar is a named group (step 27), so it is not here — that is the point of the count.
		expect(regions).toHaveLength(1);
		expect(regions[0]?.className).toBe('tablify-live');
		expect(regions[0]?.getAttribute('aria-live')).toBe('polite');
		expect(regions[0]?.getAttribute('aria-atomic')).toBe('true');
		expect(regions[0]?.textContent ?? '').toBe('');

		// The summary is still in the accessibility tree, just not shouting: a group with a name.
		const bar = document.body.querySelector('.tablify-statusbar');
		expect(bar?.getAttribute('role')).toBe('group');
		expect(bar?.getAttribute('aria-label')).toBe('Grid status');
		expect(bar?.getAttribute('aria-live')).toBeNull();
		expect(bar?.textContent ?? '').toContain('rows');
	});

	it('reads back the write report after a real cell write', async () => {
		const { store, ids } = makeFixture();
		mount(store);
		const fieldId = ids[0] ?? '';
		await act(async () => {
			store.dispatch({
				label: 'Set Name',
				ops: [{ kind: 'setCell', filePath: 'Notes/000.md', fieldId, value: 'Renamed' }],
			});
			await store.flush();
		});

		const region = document.body.querySelector('.tablify-live');
		// The sentence is `announcementOf`'s, and it describes what reached the file: one cell, one note.
		expect(region?.textContent).toBe('1 cell updated in 1 note');
		const report = store.getSnapshot();
		expect(announcementOf(report)).toBe(region?.textContent);
	});

	it('keeps the empty state’s own region, because that message appears once', () => {
		const fields: ResolvedField[] = [
			resolveField({ id: 'note.Name', name: 'Name', source: 'note' }, CONTEXT),
		];
		const store = createGridStore({ source: createFakeRowSource({ fields, rows: [] }) });
		mount(store);
		const empty = document.body.querySelector('.tablify-empty');
		expect(empty?.getAttribute('role')).toBe('status');
		expect(empty?.textContent ?? '').toContain('empty');
		// Nothing was written and nothing is selected, so the operations region says nothing at all.
		expect(document.body.querySelector('.tablify-live')?.textContent ?? '').toBe('');
	});
});
