/**
 * The keyboard, end to end on a mounted grid: real events, the real store, the real write path.
 *
 * `tests/unit/keyboard-table.test.ts` proves the *table* (event → intent). This file proves the other half — that
 * the intent reaches the store and the DOM: arrows move the active cell and are `preventDefault`ed, a keystroke
 * opens the editor on the cell and replaces its text, `Space` toggles a checkbox **without** entering edit mode,
 * `Delete` clears through one op, `Tab` walks the grid and then leaves it, `Alt+D` fills, the roving `tabindex`
 * keeps exactly one thing tabbable, and the listener is gone when the view is.
 *
 * Two assertions are here rather than in the unit table because they are *statements about the product* and no
 * pure function can make them:
 *
 *  · **`Cmd+C` is not handled yet.** The clipboard is step 22. Until then the grid must not swallow the key — a
 *    grid that eats the copy it cannot perform is worse than one that does nothing — and this is the test that
 *    will have to change (deliberately) when step 22 lands.
 *  · **`Esc` at the top of an open popover leaves nothing behind in the DOM.** Asserted as a node count straight
 *    after the event, not after a timeout: a surface that needs a tick to disappear is a surface that flickers.
 *
 * jsdom has no layout, so every measurement is 0 — the pane shows no rows, `PageDown` moves one row, and the
 * reveal arithmetic is a no-op. That is fine here: the arithmetic has its own unit tests and the pixels are step
 * 21's harness. What this file tests is the *wiring*, and the wiring is geometry-free.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GridView } from '../../src/grid/GridView';
import { attachGridKeyboard } from '../../src/grid/keyboard/handler';
import { createGridStore } from '../../src/grid/store/store';
import { resolveField } from '../../src/core/schema/propertySchema';
import { createFakeRowSource } from '../fakes/rowSource';
import type { FieldContext, CellValue } from '../../src/core/types';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import type { FakeRowSource } from '../fakes/rowSource';
import type { GridStore } from '../../src/grid/store/types';
import type { CellRef } from '../../src/core/ops/types';

Object.assign(window, { IS_REACT_ACT_ENVIRONMENT: true });

const CONTEXT: FieldContext = {
	path: '',
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
	columnName: '',
};

/** Four columns × three rows: enough cells for a `Tab` walk, a `Delete`, a fill and a checkbox. */
const COLUMNS = [
	{ id: 'note.Name', name: 'Name', type: 'text', value: 'Row' },
	{ id: 'note.Status', name: 'Status', type: 'singleSelect', value: 'Todo' },
	{ id: 'note.Done', name: 'Done', type: 'checkbox', value: false },
	{ id: 'note.Count', name: 'Count', type: 'number', value: 2 },
] as const;

const ROWS = ['Notes/001.md', 'Notes/002.md', 'Notes/003.md'];

type Fixture = {
	readonly store: GridStore;
	readonly source: FakeRowSource;
	readonly ids: string[];
};

function makeFixture(): Fixture {
	const fields: ResolvedField[] = COLUMNS.map((column) =>
		resolveField(
			{
				id: column.id,
				name: column.name,
				source: 'note',
				// The *property* declares the type (step 18's lesson: `resolveField` validates
				// `property.fieldOptions`, not the context's copy).
				fieldOptions: { type: column.type },
			},
			{ ...CONTEXT, columnName: column.name },
		),
	);
	const rows = ROWS.map((filePath, index) => {
		const cells: Record<string, CellValue> = {};
		for (const [at, column] of COLUMNS.entries()) {
			cells[fields[at]?.definition.id ?? column.id] =
				index === 0 ? column.value : column.value;
		}
		return { filePath, cells };
	});
	const source = createFakeRowSource({ fields, rows });
	return {
		store: createGridStore({ source }),
		source,
		ids: fields.map((field) => field.definition.id),
	};
}

let roots: { unmount: () => void }[] = [];

afterEach(() => {
	for (const root of roots) {
		act(() => {
			root.unmount();
		});
	}
	roots = [];
	document.body.replaceChildren();
});

/** Mounts at phone width: one lane, no pinning, so every cell is in the scrolling lane. */
function mount(store: GridStore, onHelp?: () => void): void {
	const root = createRoot(document.body);
	roots.push(root);
	act(() => {
		root.render(
			createElement(GridView, {
				store,
				presentation: { density: 'medium' },
				initialPaneWidth: 389,
				...(onHelp === undefined ? {} : { onHelp }),
			}),
		);
	});
}

function rootEl(): HTMLElement {
	const root = document.body.querySelector<HTMLElement>('.tablify-root');
	if (root === null) {
		throw new Error('no grid is mounted');
	}
	return root;
}

function cellEl(ref: CellRef): HTMLElement {
	const cell = document.body.querySelector<HTMLElement>(
		`[data-cell="${ref.filePath}::${ref.fieldId}"]`,
	);
	if (cell === null) {
		throw new Error(`no cell for ${ref.filePath}::${ref.fieldId}`);
	}
	return cell;
}

/** The active cell, as the store sees it. */
function active(store: GridStore): CellRef {
	const ref = store.getSnapshot().active;
	if (ref === null) {
		throw new Error('nothing is active');
	}
	return ref;
}

function ref(store: GridStore, filePath: string, index: number): CellRef {
	const fieldId = store.getSnapshot().order.fields[index];
	if (fieldId === undefined) {
		throw new Error(`no column ${String(index)}`);
	}
	return { filePath, fieldId };
}

/** Presses a key on an element and reports whether the grid handled it (`preventDefault`). */
function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}): boolean {
	let handled = false;
	act(() => {
		handled = !target.dispatchEvent(
			new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
		);
	});
	return handled;
}

/** Every value the fake source holds, for the assertions that care about what reached the "vault". */
async function settle(store: GridStore): Promise<void> {
	await act(async () => {
		await store.flush();
	});
}

describe('the grid keyboard', () => {
	it('moves the active cell with the arrows, and handles the key', () => {
		const { store } = makeFixture();
		mount(store);
		act(() => {
			cellEl({
				filePath: ROWS[0] ?? '',
				fieldId: store.getSnapshot().order.fields[0] ?? '',
			}).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		});
		expect(active(store)).toEqual(ref(store, ROWS[0] ?? '', 0));

		expect(press(rootEl(), 'ArrowDown')).toBe(true);
		expect(active(store)).toEqual(ref(store, ROWS[1] ?? '', 0));

		// An arrow with Shift extends: the anchor stays where the *move* left it (a plain arrow moves the range,
		// it does not extend one), and the focus walks right.
		expect(press(rootEl(), 'ArrowRight', { shiftKey: true })).toBe(true);
		const snapshot = store.getSnapshot();
		expect(snapshot.anchor).toEqual(ref(store, ROWS[1] ?? '', 0));
		expect(snapshot.active).toEqual(ref(store, ROWS[1] ?? '', 1));

		// At the edge there is nowhere to go, and the key is *still* the grid's: absorbing it is what stops the
		// arrow scrolling the application behind the table.
		expect(press(rootEl(), 'ArrowUp')).toBe(true);
		expect(store.getSnapshot().active).toEqual(ref(store, ROWS[0] ?? '', 1));
		expect(press(rootEl(), 'ArrowUp')).toBe(true);
		expect(store.getSnapshot().active).toEqual(ref(store, ROWS[0] ?? '', 1));
	});

	it('jumps a screenful with PageDown, and focuses the cell that moved', () => {
		const { store } = makeFixture();
		mount(store);
		act(() => {
			cellEl(ref(store, ROWS[0] ?? '', 0)).dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true }),
			);
		});
		expect(press(rootEl(), 'PageDown')).toBe(true);
		// jsdom's pane has no height, so a page is one row: the assertion is that the *move* happened and that
		// focus followed it, not how tall a page is.
		expect(active(store)).toEqual(ref(store, ROWS[1] ?? '', 0));
		expect(document.activeElement).toBe(cellEl(ref(store, ROWS[1] ?? '', 0)));
	});

	it('opens the editor on Enter and replaces the cell’s text when you type', () => {
		const { store } = makeFixture();
		mount(store);
		act(() => {
			cellEl(ref(store, ROWS[0] ?? '', 0)).dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true }),
			);
		});

		expect(press(rootEl(), 'Enter')).toBe(true);
		expect(store.getSnapshot().editing).not.toBeNull();
		const input = document.body.querySelector<HTMLInputElement>('.cell-editor');
		expect(input?.value).toBe('Row');

		// Escape is the editor's key, not the grid's: it cancels the edit and gives focus back to the cell. The
		// observable difference from the grid's own Escape is the *selection* — the grid's would let go of it,
		// and cancelling an edit must not.
		press(input ?? rootEl(), 'Escape');
		expect(store.getSnapshot().editing).toBeNull();
		expect(document.activeElement).toBe(cellEl(ref(store, ROWS[0] ?? '', 0)));
		expect(store.getSnapshot().selection).not.toBeNull();
	});

	it('starts an edit with the key that was pressed, replacing the content', () => {
		const { store } = makeFixture();
		mount(store);
		act(() => {
			cellEl(ref(store, ROWS[0] ?? '', 0)).dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true }),
			);
		});
		expect(press(rootEl(), 'Z')).toBe(true);
		const input = document.body.querySelector<HTMLInputElement>('.cell-editor');
		expect(input?.value).toBe('Z');
	});

	it('commits with Enter and moves the selection down, and with Tab sideways', async () => {
		const { store } = makeFixture();
		mount(store);
		act(() => {
			cellEl(ref(store, ROWS[0] ?? '', 0)).dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true }),
			);
		});
		press(rootEl(), 'Enter');

		const input = document.body.querySelector<HTMLInputElement>('.cell-editor');
		if (input === null) {
			throw new Error('the editor did not open');
		}
		act(() => {
			input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		});
		await settle(store);

		// `docs/01`: "Enter — edit the cell; committing moves down one row".
		expect(store.getSnapshot().editing).toBeNull();
		expect(active(store)).toEqual(ref(store, ROWS[1] ?? '', 0));
		expect(document.activeElement).toBe(cellEl(ref(store, ROWS[1] ?? '', 0)));

		// And Tab commits and moves right.
		press(rootEl(), 'Enter');
		const second = document.body.querySelector<HTMLInputElement>('.cell-editor');
		if (second === null) {
			throw new Error('the editor did not open the second time');
		}
		act(() => {
			second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
		});
		await settle(store);
		expect(active(store)).toEqual(ref(store, ROWS[1] ?? '', 1));
	});

	it('toggles a checkbox with Space, without entering edit mode', async () => {
		const { store, source } = makeFixture();
		mount(store);
		const checkbox = ref(store, ROWS[0] ?? '', 2);
		act(() => {
			cellEl(checkbox).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		});

		expect(press(rootEl(), ' ')).toBe(true);
		await settle(store);
		expect(source.value(ROWS[0] ?? '', checkbox.fieldId)).toBe(true);
		// The doc's word for it is "toggle without entering edit mode": no session was opened at all.
		expect(store.getSnapshot().editing).toBeNull();
		expect(document.body.querySelector('.cell-editor-check')).toBeNull();

		expect(press(rootEl(), ' ')).toBe(true);
		await settle(store);
		expect(source.value(ROWS[0] ?? '', checkbox.fieldId)).toBe(false);
	});

	it('clears the selection with Delete, as one op', async () => {
		const { store, source } = makeFixture();
		mount(store);
		const target = ref(store, ROWS[0] ?? '', 0);
		act(() => {
			cellEl(target).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		});
		expect(press(rootEl(), 'Delete')).toBe(true);
		await settle(store);
		expect(source.value(ROWS[0] ?? '', target.fieldId)).toBeNull();
		expect(source.batches().at(-1)?.length).toBe(1);
	});

	it('selects everything with Cmd/Ctrl+A and lets go with Escape, which then does nothing', () => {
		const { store } = makeFixture();
		mount(store);
		act(() => {
			cellEl(ref(store, ROWS[1] ?? '', 1)).dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true }),
			);
		});
		const current = active(store);

		expect(press(rootEl(), 'a', { metaKey: true })).toBe(true);
		const selection = store.getSnapshot().selection;
		expect(selection).not.toBeNull();
		expect(selection?.anchor).toEqual(ref(store, ROWS[0] ?? '', 0));
		// The keyboard does not travel: `Cmd+A` selects around the cell you were already on.
		expect(selection?.focus).toEqual(current);

		expect(press(rootEl(), 'Escape')).toBe(true);
		expect(store.getSnapshot().selection).toBeNull();
		// With nothing selected there is nothing to let go of, so the key is the browser's again.
		expect(press(rootEl(), 'Escape')).toBe(false);
	});

	it('fills down from the top of the range with Alt+D', async () => {
		const { store, source } = makeFixture();
		mount(store);
		const first = ref(store, ROWS[0] ?? '', 0);
		act(() => {
			cellEl(first).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		});
		press(rootEl(), 'ArrowDown', { shiftKey: true });

		expect(press(rootEl(), 'd', { altKey: true })).toBe(true);
		await settle(store);
		expect(source.value(ROWS[1] ?? '', first.fieldId)).toBe('Row');
	});

	it('walks the grid with Tab and hands the key back at the last cell', () => {
		const { store } = makeFixture();
		mount(store);
		const order = store.getSnapshot().order;
		const lastRow = order.rows.at(-1) ?? '';
		const lastField = order.fields.at(-1) ?? '';
		const last: CellRef = { filePath: lastRow, fieldId: lastField };

		act(() => {
			cellEl(last).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		});
		// The last cell of the grid: `Tab` is not ours any more (the browser moves focus on).
		expect(press(rootEl(), 'Tab')).toBe(false);

		const first: CellRef = { filePath: order.rows[0] ?? '', fieldId: order.fields[0] ?? '' };
		act(() => {
			cellEl(first).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		});
		expect(press(rootEl(), 'Tab')).toBe(true);
		expect(active(store)).toEqual({
			filePath: order.rows[0] ?? '',
			fieldId: order.fields[1] ?? '',
		});
		// …and backwards from the first cell leaves the grid the other way.
		expect(press(rootEl(), 'Tab', { shiftKey: true })).toBe(true);
		expect(active(store)).toEqual(first);
		expect(press(rootEl(), 'Tab', { shiftKey: true })).toBe(false);
	});

	it('handles the copy chords itself, and leaves paste to the browser (step 22)', () => {
		const { store } = makeFixture();
		mount(store);
		act(() => {
			cellEl(ref(store, ROWS[0] ?? '', 0)).dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true }),
			);
		});
		/*
		 * Copy and cut are the grid's: `Cmd/Ctrl+C` is caught so that the *event* path can put both flavours on
		 * the clipboard (`fillCopyEvent`), and cut is the same copy followed by the clear.
		 *
		 * Paste is deliberately **not** handled, and this assertion is the reason it is worth stating: the browser's
		 * own `paste` event carries `text/html` as well as `text/plain`, and reading the clipboard ourselves would
		 * mean getting the text flavour only — a downgrade. So `Cmd/Ctrl+V` stays the browser's, and the grid
		 * listens for the event that comes out of it.
		 */
		expect(press(rootEl(), 'c', { metaKey: true })).toBe(true);
		expect(press(rootEl(), 'x', { ctrlKey: true })).toBe(true);
		expect(press(rootEl(), 'v', { ctrlKey: true })).toBe(false);
	});

	it('opens the keyboard reference with F1 and ?', () => {
		const { store } = makeFixture();
		const onHelp = vi.fn();
		mount(store, onHelp);
		expect(press(rootEl(), 'F1')).toBe(true);
		expect(press(rootEl(), '?')).toBe(true);
		expect(onHelp).toHaveBeenCalledTimes(2);
	});

	it('keeps exactly one thing tabbable: the grid, until a cell is', () => {
		const { store } = makeFixture();
		mount(store);
		const tabbable = (): number =>
			document.body.querySelectorAll<HTMLElement>(
				'.tablify-root [tabindex="0"], .tablify-root[tabindex="0"]',
			).length;
		// Nothing is selected: the grid itself is the way in, and no cell is a tab stop.
		expect(rootEl().getAttribute('tabindex')).toBe('0');
		expect(
			document.body.querySelectorAll('.tablify-root [data-cell][tabindex="0"]').length,
		).toBe(0);
		expect(tabbable()).toBe(1);

		act(() => {
			cellEl(ref(store, ROWS[1] ?? '', 1)).dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true }),
			);
		});
		expect(rootEl().getAttribute('tabindex')).toBe('-1');
		expect(
			document.body.querySelectorAll('.tablify-root [data-cell][tabindex="0"]').length,
		).toBe(1);
		expect(cellEl(ref(store, ROWS[1] ?? '', 1)).getAttribute('tabindex')).toBe('0');
		expect(tabbable()).toBe(1);
	});

	it('routes focus that lands on the grid to the active cell', () => {
		const { store } = makeFixture();
		mount(store);
		act(() => {
			cellEl(ref(store, ROWS[0] ?? '', 0)).dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true }),
			);
		});
		act(() => {
			rootEl().focus();
		});
		expect(document.activeElement).toBe(cellEl(ref(store, ROWS[0] ?? '', 0)));
	});

	it('announces the write in the polite live region', async () => {
		const { store } = makeFixture();
		mount(store);
		act(() => {
			cellEl(ref(store, ROWS[0] ?? '', 0)).dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true }),
			);
		});
		press(rootEl(), 'Enter');
		const input = document.body.querySelector<HTMLInputElement>('.cell-editor');
		if (input === null) {
			throw new Error('the editor did not open');
		}
		// Committing the value that was already there is still a write: one cell, one note.
		act(() => {
			input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		});
		await settle(store);
		const live = document.body.querySelector('.tablify-live');
		expect(live?.getAttribute('aria-live')).toBe('polite');
		expect(live?.textContent).toBe('1 cell updated in 1 note');
	});

	it('closes a popover with Escape, list first and then the editor, leaving nothing in the DOM', () => {
		const { store } = makeFixture();
		mount(store);
		const select = ref(store, ROWS[0] ?? '', 1);
		act(() => {
			cellEl(select).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		});
		expect(press(rootEl(), 'Enter')).toBe(true);
		expect(document.body.querySelector('[data-popover="cell"]')).not.toBeNull();

		const search = document.body.querySelector<HTMLInputElement>('.cell-pop-search');
		// One press closes the option list; the editor is still open, which is the state machine's rule
		// (`editSession.escape()` answers `closedList` before it answers `cancelled`).
		press(search ?? rootEl(), 'Escape');
		expect(store.getSnapshot().editing).not.toBeNull();

		// The second press closes the editor, and the popover is gone the moment the event returns — no timeout,
		// no lingering node: a surface that needs a tick to disappear is a surface that flickers.
		press(search ?? rootEl(), 'Escape');
		expect(store.getSnapshot().editing).toBeNull();
		expect(document.body.querySelectorAll('[data-popover="cell"]').length).toBe(0);
	});

	it('is not a global key handler: the document does not answer the grid’s keys', () => {
		const { store } = makeFixture();
		mount(store);
		const before = store.getSnapshot().selection;
		// Dispatched on the document element, the event never passes through the grid — so a handler registered
		// on `document` or `window` (which `docs/04` and the step's fence both forbid) would be the only thing
		// that could answer it.
		expect(press(document.documentElement, 'ArrowDown')).toBe(false);
		expect(store.getSnapshot().selection).toBe(before);
		// The same key on the grid is handled: the test is not passing because nothing works.
		expect(press(rootEl(), 'ArrowDown')).toBe(true);
		expect(store.getSnapshot().selection).not.toBeNull();
	});

	it('attaches one listener to the element it is given, and lets go on detach', () => {
		const seen: string[] = [];
		const attachment = attachGridKeyboard(document.body, {
			context: () => ({ editing: false, checkbox: false, pageRows: 1 }),
			dispatch: (intent) => {
				seen.push(intent.id);
				return true;
			},
		});
		expect(press(document.body, 'ArrowDown')).toBe(true);
		expect(seen).toEqual(['move']);

		attachment.detach();
		expect(press(document.body, 'ArrowDown')).toBe(false);
		expect(seen).toEqual(['move']);
	});

	it('detaches its listener when the view unmounts', () => {
		const { store } = makeFixture();
		mount(store);
		const root = rootEl();
		for (const mounted of roots) {
			act(() => {
				mounted.unmount();
			});
		}
		roots = [];
		// The element is out of the document, but the listener would still fire if it had been left attached.
		expect(press(root, 'ArrowDown')).toBe(false);
		expect(store.getSnapshot().selection).toBeNull();
	});
});
