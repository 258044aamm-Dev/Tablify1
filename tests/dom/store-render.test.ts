/**
 * `docs/07` §Tier 3, rule 1, as a number: **a keystroke re-renders one cell, not the grid.**
 *
 * This is a render counter, so it needs real React: 60 rows × 2 columns of the store's own hooks mounted in
 * jsdom, then one keystroke. The components here are probes, not product code — the product's `Cell` arrives
 * in step 17 — but they call the same hooks with the same store, so what they measure is the mechanism the
 * product will use, not a stand-in for it.
 *
 * The honest number is not "one render" and pretending otherwise would hide the design: a keystroke is one
 * fact that three surfaces display. The cell shows the new text, the row shows its pending dot, the status bar
 * shows its pending count. Three components re-render; the other 178 do not. The rule the number exists to
 * protect is "the grid does not re-render" — 181 mounted components, 3 renders.
 */
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { createGridStore } from '../../src/grid/store/store';
import { setCell } from '../../src/grid/store/commands';
import {
	useCellDisplay,
	useCellFlags,
	useRowFlags,
	useStore,
} from '../../src/grid/store/selectors';
import { createFakeRowSource } from '../fakes/rowSource';
import { resolveField } from '../../src/core/schema/propertySchema';
import type { FieldContext } from '../../src/core/types';
import type { CellRef } from '../../src/core/ops/types';
import type { GridStore } from '../../src/grid/store/types';

// React only relaxes its `act()` warning when the environment announces itself. jsdom makes `window` the
// global object here, so this is the same object React reads.
Object.assign(window, { IS_REACT_ACT_ENVIRONMENT: true });

const CONTEXT: FieldContext = {
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
	columnName: '',
};

const FIELDS = [
	resolveField({ id: 'note.Name', name: 'Name', source: 'note' }, CONTEXT),
	resolveField({ id: 'note.Status', name: 'Status', source: 'note' }, CONTEXT),
];

const ROWS = 60;

function makeStore() {
	const rows = Array.from({ length: ROWS }, (_unused, index) => ({
		filePath: `Notes/${String(index).padStart(3, '0')}.md`,
		cells: {
			'note.Name': `Row ${String(index)}`,
			'note.Status': index % 2 === 0 ? 'Todo' : 'Done',
		},
	}));
	const source = createFakeRowSource({ fields: FIELDS, rows });
	return { store: createGridStore({ source }), source, rows };
}

const refOf = (filePath: string, fieldId = 'note.Name'): CellRef => ({ filePath, fieldId });

/** Every render of every probe in the tree, by label. */
type Counts = Map<string, number>;

const counts: Counts = new Map();
const bump = (label: string): void => {
	counts.set(label, (counts.get(label) ?? 0) + 1);
};

/**
 * A cell, exactly as the product's `Cell` will be built: the value as text from `useCellDisplay`, and the flags
 * it draws with from `useCellFlags`. One component, two subscriptions — the pending ring and the in-range wash
 * belong to the cell, so a keystroke must repaint one component here, not two.
 */
function CellProbe({
	store,
	ref,
}: {
	readonly store: GridStore;
	readonly ref: CellRef;
}): ReactElement {
	bump(`cell:${ref.filePath}:${ref.fieldId}`);
	const text = useCellDisplay(store, ref);
	const flags = useCellFlags(store, ref);
	return createElement(
		'span',
		{
			'data-cell': cellId(ref),
			'data-pending': String(flags.pending),
			'data-in-range': String(flags.inRange),
		},
		text,
	);
}

const cellId = (ref: CellRef): string => `${ref.filePath}::${ref.fieldId}`;

/** A row: its flags, which is where the pending dot and the row checkbox come from. */
function RowProbe({
	store,
	filePath,
}: {
	readonly store: GridStore;
	readonly filePath: string;
}): ReactElement {
	bump(`row:${filePath}`);
	const flags = useRowFlags(store, filePath);
	return createElement('div', {
		'data-dirty': String(flags.dirty),
		'data-checked': String(flags.checked),
	});
}

/**
 * The toolbar and the status bar: the surfaces that *are* allowed to read the whole snapshot. They read
 * primitives, because a selector that built a fresh object per call would make `useSyncExternalStore` compare a
 * new object every time — which is why the product's status bar passes `selectStatusSummary` a comparator.
 */
function ChromeProbe({ store }: { readonly store: GridStore }): ReactElement {
	bump('chrome');
	const rows = useStore(store, (snapshot) => snapshot.rows.length);
	const pending = useStore(store, (snapshot) => snapshot.pending);
	return createElement('div', null, `${String(rows)}/${String(pending)}`);
}

let roots: { unmount: () => void }[] = [];

/**
 * Mounts into `document.body` itself. React builds the elements, so the test never calls `createElement` for a
 * host element — which is both the Obsidian-flavoured lint rule's requirement and the truthful thing: the test
 * owns a React root, not a hand-made container.
 */
function mount(store: GridStore): HTMLElement {
	const root = createRoot(document.body);
	act(() => {
		root.render(
			createElement(
				'div',
				null,
				// The chrome reads the window; the grid only ever mounts the rows in it.
				createElement(ChromeProbe, { store }),
				...Array.from({ length: ROWS }, (_unused, index) => {
					const filePath = `Notes/${String(index).padStart(3, '0')}.md`;
					return createElement(
						'div',
						{ key: filePath },
						createElement(RowProbe, { store, filePath }),
						...FIELDS.map((field) =>
							createElement(CellProbe, {
								key: field.definition.id,
								store,
								ref: refOf(filePath, field.definition.id),
							}),
						),
					);
				}),
			),
		);
	});
	roots.push(root);
	return document.body;
}

afterEach(() => {
	for (const root of roots) {
		act(() => {
			root.unmount();
		});
	}
	roots = [];
	counts.clear();
	document.body.replaceChildren();
});

describe('rule 1 — one keystroke, three surfaces, and a grid that stays put', () => {
	it('a keystroke is three renders, and its confirmation is three more', async () => {
		const { store, source } = makeStore();
		mount(store);

		// 60 rows + 120 cells + the chrome = 181 mounted components, each rendered once to begin with.
		expect([...counts.values()].reduce((sum, count) => sum + count, 0)).toBe(
			1 + ROWS + ROWS * FIELDS.length,
		);
		counts.clear();

		const target = refOf('Notes/007.md');
		act(() => {
			expect(setCell(store, target, 'Renamed by the user')).toEqual({ ok: true });
		});

		// The optimistic half: three surfaces display this one fact — the cell's text and its pending ring, the
		// row's pending dot, and the status line's count. The other 178 components do not render *at all*.
		expect([...counts.keys()].sort()).toEqual([
			'cell:Notes/007.md:note.Name',
			'chrome',
			'row:Notes/007.md',
		]);
		expect(source.written()).toBe(0); // Nothing is on disk yet: these renders came from the optimistic value.

		// The confirmation half. The value is the same string, so the cell re-renders for exactly one reason: its
		// pending ring goes out. The row's dot and the status line's count follow the same fact.
		counts.clear();
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		expect([...counts.keys()].sort()).toEqual([
			'cell:Notes/007.md:note.Name',
			'chrome',
			'row:Notes/007.md',
		]);
		expect(source.written()).toBe(1);
	});

	it('shows the new text in the DOM, and only in that cell', async () => {
		const { store } = makeStore();
		const container = mount(store);
		const textOf = (filePath: string, fieldId: string): string =>
			container.querySelector(`[data-cell="${filePath}::${fieldId}"]`)?.textContent ?? '';

		expect(textOf('Notes/007.md', 'note.Name')).toBe('Row 7');

		act(() => {
			setCell(store, refOf('Notes/007.md'), 'Renamed by the user');
		});
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(textOf('Notes/007.md', 'note.Name')).toBe('Renamed by the user');
		expect(textOf('Notes/008.md', 'note.Name')).toBe('Row 8');
		expect(textOf('Notes/007.md', 'note.Status')).toBe('Done');
	});

	it('re-renders the cells a range covers, and only those', () => {
		const { store } = makeStore();
		mount(store);
		counts.clear();

		// A range down one column: three cells draw an in-range wash, and the same three rows get a checkbox,
		// because a range that spans those rows from their first column marks them as selected.
		act(() => {
			store.select({ anchor: refOf('Notes/000.md'), focus: refOf('Notes/002.md') });
		});

		expect([...counts.keys()].filter((key) => key.startsWith('cell:')).sort()).toEqual([
			'cell:Notes/000.md:note.Name',
			'cell:Notes/001.md:note.Name',
			'cell:Notes/002.md:note.Name',
		]);
		expect([...counts.keys()].filter((key) => key.startsWith('row:')).sort()).toEqual([
			'row:Notes/000.md',
			'row:Notes/001.md',
			'row:Notes/002.md',
		]);
		// The window has not moved and nothing is pending, so the chrome is not woken.
		expect(counts.get('chrome')).toBeUndefined();
	});

	it('re-renders a rectangle of cells, and stops at its edges', () => {
		const { store } = makeStore();
		mount(store);
		counts.clear();

		act(() => {
			store.select({
				anchor: refOf('Notes/000.md'),
				focus: refOf('Notes/002.md', 'note.Status'),
			});
		});

		// Six cells: two columns × three rows. Everything else — 114 cells, 57 rows — is still asleep.
		const cells = [...counts.keys()].filter((key) => key.startsWith('cell:'));
		expect(cells).toHaveLength(6);
		expect(cells).toContain('cell:Notes/002.md:note.Status');
		expect(cells).not.toContain('cell:Notes/003.md:note.Name');
		expect([...counts.keys()].filter((key) => key.startsWith('row:'))).toHaveLength(3);
	});
});
