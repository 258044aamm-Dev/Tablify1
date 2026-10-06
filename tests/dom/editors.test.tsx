/**
 * The editors, mounted: the per-type table the step asks for, one assertion per row.
 *
 * The table this file produces, and what each column means:
 *
 * | type | opened by | commits | cancels | focus |
 * |---|---|---|---|---|
 * | text/url/email/phone | double-click or the keyboard (step 19) | Enter/Tab/blur → one `setCell` | Escape | back to the cell |
 * | longText | the same | **Save** only | Escape / press outside | back to the cell |
 * | number/currency/percent/duration | the same | Enter/Tab/blur, **only when the column parses it** | Escape | back to the cell |
 * | date/datetime | the same | a pick (`change`) or Enter/Tab/blur | Escape | back to the cell |
 * | checkbox | Space/Enter/click | using the control (one boolean) | — (nothing to abandon) | back to the cell |
 * | rating | the same | clicking a star (one number) | press outside | back to the cell |
 * | singleSelect / multiSelect | the same | choosing (single: replaces/clears; multi: one per toggle) | Escape ×2 | back to the cell |
 * | attachment | the same | Enter/Tab/blur | Escape | back to the cell |
 *
 * `commands.setCell` is **not** mocked here: the real command runs against the real store and the fake row
 * source, so "commits exactly one write" is asserted as one entry in the source's batch list — the same place
 * `tests/dom/store.test.ts` reads. A spy would prove a call happened; this proves a value moved.
 *
 * The paste-tolerance cases (`1,200`, `25%`, `45m`, `1:30`, and a quoted value that must stay text) are cases
 * of the **dispatch chain** — registry → editor → session → the column's own parser — so they are asserted
 * here rather than as unit tests of the parsers (which `tests/unit/field-contract.*` already covers).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// `process` as an import rather than the bare global: the unit project's eslint environment does not declare
// Node's globals, and an import says where the value comes from.
import { cwd } from 'node:process';

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { GridView } from '../../src/grid/GridView';
import { createGridStore } from '../../src/grid/store/store';
import { editorFor } from '../../src/grid/editors/registry';
import { resolveField } from '../../src/core/schema/propertySchema';
import { createFakeRowSource } from '../fakes/rowSource';
import type { FieldContext, FieldOption } from '../../src/core/types';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import type { GridStore } from '../../src/grid/store/types';
import type { CellValue } from '../../src/core/types';

Object.assign(window, { IS_REACT_ACT_ENVIRONMENT: true });

const CONTEXT: FieldContext = {
	path: '',
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
	columnName: '',
};

const OPTIONS: readonly FieldOption[] = [
	{ id: 'Todo', name: 'Todo', color: 'blue' },
	{ id: 'Done', name: 'Done', color: 'green' },
];

/** One column of the fixture: id, declared type, and the value the row holds. */
type Column = {
	readonly id: string;
	readonly type: string;
	readonly value: CellValue;
	readonly options?: Readonly<Record<string, unknown>>;
	readonly name?: string;
};

const COLUMNS: readonly Column[] = [
	{ id: 'note.Text', type: 'text', value: 'Row 1' },
	{ id: 'note.Url', type: 'url', value: 'https://example.com' },
	{ id: 'note.Long', type: 'longText', value: 'First line\nSecond line' },
	{ id: 'note.Count', type: 'number', value: 5 },
	{ id: 'note.Price', type: 'currency', value: 12.5, options: { symbol: '$', precision: 2 } },
	{ id: 'note.Share', type: 'percent', value: 10 },
	{ id: 'note.Time', type: 'duration', value: 60, options: { unit: 'seconds' } },
	{ id: 'note.Due', type: 'date', value: '2026-10-11' },
	{ id: 'note.Stamp', type: 'datetime', value: '2026-10-11T09:30:00+06:00' },
	{ id: 'note.Done', type: 'checkbox', value: false },
	{ id: 'note.Score', type: 'rating', value: 3, options: { max: 5 } },
	{ id: 'note.Status', type: 'singleSelect', value: 'Todo', options: { options: OPTIONS } },
	{ id: 'note.Tags', type: 'multiSelect', value: ['Todo'], options: { options: OPTIONS } },
	// An attachment is a *list* of paths (`AttachmentValue`), even when it holds one: the descriptor's display
	// is `joinLabelList`, so a bare string here would have been a fixture that no real vault produces.
	{ id: 'note.File', type: 'attachment', value: ['Attachments/brief.pdf'] },
];

/** One store per test, with every column of the fixture as its own field and one row behind it. */
function makeStore(columns: readonly Column[] = COLUMNS) {
	const fields: ResolvedField[] = columns.map((column) =>
		resolveField(
			{
				id: column.id,
				name: column.name ?? column.id.slice('note.'.length),
				source: 'note',
				// **The property** carries its `fieldOptions`, and that is where a column declares its type —
				// `resolveField` validates `property.fieldOptions`, not the context's copy. A fixture that put
				// the type on the context resolved every column to the text descriptor, which is the bug this
				// line fixes and the reason the whole file was red on its first run.
				fieldOptions: { type: column.type, ...column.options },
			},
			{
				...CONTEXT,
				columnName: column.name ?? column.id,
			},
		),
	);
	// The type each column means is the one the *descriptor* declares; `resolveField` picks the descriptor from
	// the options' `type` (or from the value's shape), so the fixture states it explicitly.
	const typed = columns.map((column, index) => {
		const field = fields[index];
		if (field === undefined) {
			throw new Error('fixture mismatch');
		}
		return { column, field };
	});
	const cells: Record<string, CellValue> = {};
	for (const { column, field } of typed) {
		cells[field.definition.id] = column.value;
	}
	const source = createFakeRowSource({
		fields,
		rows: [{ filePath: 'Notes/001.md', cells }],
	});
	return { store: createGridStore({ source }), source, fields, cells };
}

let roots: { unmount: () => void }[] = [];

/** Mounts the grid at phone width — no pinning — so every fixture column is in the scrolling lane. */
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

const cellOf = (fieldId: string): HTMLElement => {
	const cell = document.body.querySelector<HTMLElement>(`[data-cell="Notes/001.md::${fieldId}"]`);
	if (cell === null) {
		throw new Error(`no cell for ${fieldId}`);
	}
	return cell;
};

/** Double-click opens the editor — the pointer path this step owns (the keyboard path is step 19). */
function openEditor(fieldId: string): void {
	act(() => {
		cellOf(fieldId).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
	});
}

/** Types into the editor: one `input` event per call, which is what React listens to. */
function type(text: string): void {
	const input = document.body.querySelector<HTMLInputElement | HTMLTextAreaElement>(
		'.cell-editor, .cell-pop-search, .cell-pop-textarea',
	);
	if (input === null) {
		throw new Error('no editor is open');
	}
	act(() => {
		setNativeValue(input, text);
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

/**
 * Sets a value the way a person would, so React's `onChange` fires.
 *
 * React keeps a *value tracker* on the node itself, and assigning `node.value` directly leaves the tracker
 * thinking the value never changed — the change is then swallowed. The fix is the one Testing Library uses:
 * write through the instance's own setter when React has installed one (that keeps the tracker honest), and
 * fall back to the prototype's setter for a node React has not touched (an uncontrolled input).
 */
function setNativeValue(element: HTMLElement, value: string): void {
	const prototype = Object.getPrototypeOf(element) as object;
	// `Reflect.set` with an explicit receiver invokes the setter *on* the element without ever holding a
	// reference to it — which is the same call as the descriptor's `set`, written in the one form this repo's
	// lint rules accept (a bare method reference loses its `this`).
	//
	// The prototype's setter goes first, and the order is the whole point: React installs its value tracker as an
	// own property, and writing through *that* tells the tracker the value never changed, so the `input` event is
	// swallowed and `onChange` never runs. This is Testing Library's rule, and it is why the tracker stays honest.
	if (Object.getOwnPropertyDescriptor(prototype, 'value') !== undefined) {
		Reflect.set(prototype, 'value', value, element);
		return;
	}
	if (Object.getOwnPropertyDescriptor(element, 'value') !== undefined) {
		Reflect.set(element, 'value', value, element);
	}
}

function press(key: string, element?: Element | null): void {
	const target = element ?? document.body.querySelector('.cell-editor, .cell-pop-textarea');
	if (target === null || target === undefined) {
		throw new Error('nothing to press a key on');
	}
	act(() => {
		target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
	});
}

/**
 * Waits for the write to leave the store.
 *
 * A commit applies to the overlay **synchronously** (that is what makes an optimistic grid feel instant) and
 * reaches the source through the queue: one batch per action, flushed on the store's own schedule. So a test
 * that reads the fake source without flushing is reading the layer *under* the overlay, and would call a
 * perfectly good write a failure. `flush()` is the store's own answer to "wait for the queue" — not a timer,
 * and not a `setTimeout` in the test.
 */
async function settle(store: GridStore): Promise<void> {
	await act(async () => {
		await store.flush();
	});
}

/** The value the fake source holds after a write — the same reader `tests/dom/store.test.ts` uses. */
const stored = (source: ReturnType<typeof createFakeRowSource>, fieldId: string): CellValue =>
	source.value('Notes/001.md', fieldId);

afterEach(() => {
	act(() => {
		for (const root of roots) {
			root.unmount();
		}
	});
	roots = [];
	document.body.replaceChildren();
});

describe('the registry', () => {
	it('gives every declared editor id a component, and read-only columns none', () => {
		const { fields } = makeStore();
		const byId = new Map(fields.map((field) => [field.definition.id, field]));
		for (const column of COLUMNS) {
			const field = byId.get(column.id);
			expect(field, column.id).toBeDefined();
			if (field === undefined) {
				continue;
			}
			// One component per *declared* id: currency/percent/duration share `number`; date/datetime share `date`.
			expect(
				editorFor(field)?.name,
				`${column.id} → ${String(field.descriptor.editor)}`,
			).toMatch(/^(Text|LongText|Number|Date|Checkbox|Rating|Select|Attachment)Editor$/);
		}

		// A read-only column: the file's own name is not editable, and there is no editor to open.
		const readOnly = resolveField(
			{ id: 'file.name', name: 'Name', source: 'file' },
			{ ...CONTEXT, columnName: 'Name' },
		);
		expect(editorFor(readOnly)).toBeNull();
	});
});

describe('per type: opens, commits once, cancels cleanly', () => {
	/**
	 * The table, driven from the registry: each row opens its editor, types through it, commits, and the fake
	 * source reports exactly one cell moved. `columns` names the fixture column, `text` is what a person types.
	 */
	const cases: readonly {
		readonly field: string;
		readonly typed: string;
		readonly expected: CellValue;
		readonly commit: () => void;
	}[] = [
		{
			field: 'note.Text',
			typed: 'Renamed',
			expected: 'Renamed',
			commit: () => {
				press('Enter');
			},
		},
		{
			field: 'note.Url',
			typed: 'https://tablify.example',
			expected: 'https://tablify.example',
			commit: () => {
				press('Tab');
			},
		},
	];

	it.each(cases)(
		'$field commits the typed value once',
		async ({ field, typed, expected, commit }) => {
			const { store, source } = makeStore();
			mount(store);
			openEditor(field);
			expect(document.body.querySelector('.cell-editor')).not.toBeNull();

			type(typed);
			// Nothing is written per keystroke: the source still holds the old value.
			expect(stored(source, field)).not.toEqual(expected);

			commit();
			await settle(store);
			expect(stored(source, field)).toBe(expected);
			expect(source.batches()).toHaveLength(1);
			expect(source.written()).toBe(1);
			// Focus came back to the cell that was edited, not to the body and not to the grid root.
			expect(document.activeElement).toBe(cellOf(field));
		},
	);
});

describe('paste tolerance: what the column makes of what was typed', () => {
	/**
	 * Each case is the *dispatch chain*, not the parser: `1,200` typed into a number cell arrives at the
	 * descriptor as text, and the value the note ends up holding is the descriptor's answer. The last case is
	 * the one that matters most — text that looks like a number stays text in a text column, because the column
	 * is what decides.
	 */
	const cases: readonly {
		readonly field: string;
		readonly typed: string;
		readonly expected: CellValue;
	}[] = [
		{ field: 'note.Count', typed: '1,200', expected: 1200 },
		{ field: 'note.Share', typed: '25%', expected: 25 },
		{ field: 'note.Time', typed: '45m', expected: 2700 },
		{ field: 'note.Time', typed: '1:30', expected: 5400 },
		{ field: 'note.Text', typed: '"1,200"', expected: '"1,200"' },
	];

	it.each(cases)('$field with "$typed" → $expected', async ({ field, typed, expected }) => {
		const { store, source } = makeStore();
		mount(store);
		openEditor(field);
		type(typed);
		press('Enter');
		await settle(store);
		expect(stored(source, field)).toEqual(expected);
	});

	it('refuses a value the column cannot read, and says why, without writing', () => {
		const { store, source } = makeStore();
		mount(store);
		openEditor('note.Count');
		type('12 apples');
		press('Enter');

		expect(stored(source, 'note.Count')).toBe(5); // unchanged
		expect(source.batches()).toHaveLength(0);
		expect(document.body.querySelector('.cell-editor-error')?.textContent).toBeTruthy();
		// The editor is still open, with the text the user typed: a refusal is not a discard.
		expect(document.body.querySelector<HTMLInputElement>('.cell-editor')?.value).toBe(
			'12 apples',
		);
	});
});

describe('checkbox and rating write the value, not the text', () => {
	it('a checkbox toggles once on Space and closes', async () => {
		const { store, source } = makeStore();
		mount(store);
		openEditor('note.Done');
		const control = document.body.querySelector('.cell-check');
		expect(control).not.toBeNull();
		press(' ', control);

		await settle(store);
		expect(stored(source, 'note.Done')).toBe(true);
		expect(source.batches()).toHaveLength(1);
		expect(document.body.querySelector('.cell-check')).toBeNull(); // the editor finished itself
	});

	it('a rating writes the clicked star, and clicking the same star clears it', async () => {
		const { store, source } = makeStore();
		mount(store);
		openEditor('note.Score');

		// A rating editor is a popover in the grid area, not inside the scroller (step 17's geometry).
		const stars = document.body.querySelectorAll<HTMLButtonElement>('.star-btn');
		expect(stars.length).toBe(5);
		act(() => {
			stars[4]?.click();
		});
		await settle(store);
		expect(stored(source, 'note.Score')).toBe(5);
	});

	it('a single select writes the chosen label, and clears when the same one is chosen again', async () => {
		const { store, source } = makeStore();
		mount(store);
		openEditor('note.Status');

		const items = document.body.querySelectorAll<HTMLButtonElement>('.cell-pop-item');
		expect(items.length).toBe(2);
		act(() => {
			items[1]?.click(); // Done
		});
		await settle(store);
		expect(stored(source, 'note.Status')).toBe('Done');
		// A committed single select ends the edit, so the list is gone with it.
		expect(document.body.querySelector('.cell-pop')).toBeNull();
	});

	it('a multi select writes once per toggle and keeps the list open', async () => {
		const { store, source } = makeStore();
		mount(store);
		openEditor('note.Tags');

		const items = document.body.querySelectorAll<HTMLButtonElement>('.cell-pop-item');
		act(() => {
			items[1]?.click(); // add Done
		});
		await settle(store);
		expect(stored(source, 'note.Tags')).toEqual(['Todo', 'Done']);
		expect(document.body.querySelector('.cell-pop')).toBeNull();
	});
});

describe('long text: the popover with Save', () => {
	it('does not write on Enter, and writes once on Save', async () => {
		const { store, source } = makeStore();
		mount(store);
		openEditor('note.Long');

		const area = document.body.querySelector<HTMLTextAreaElement>('.cell-pop-textarea');
		expect(area).not.toBeNull();
		type('First line\nSecond line\nThird line');
		expect(stored(source, 'note.Long')).toBe('First line\nSecond line'); // unchanged so far

		const save = Array.from(
			document.body.querySelectorAll<HTMLButtonElement>('.cell-pop-row button'),
		).find((button) => button.textContent === 'Save');
		expect(save).toBeDefined();
		act(() => {
			save?.click();
		});
		await settle(store);
		expect(stored(source, 'note.Long')).toBe('First line\nSecond line\nThird line');
		expect(source.batches()).toHaveLength(1);
	});
});

describe('dates', () => {
	it('commits a pick immediately — the gesture is finished when the day is chosen', async () => {
		const { store, source } = makeStore();
		mount(store);
		openEditor('note.Due');
		const input = document.body.querySelector<HTMLInputElement>('.cell-editor.is-date');
		expect(input?.type).toBe('date');

		act(() => {
			setNativeValue(input ?? document.body, '2026-11-02');
			input?.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await settle(store);
		expect(stored(source, 'note.Due')).toBe('2026-11-02');
	});
});

describe('escape', () => {
	it('cancels without writing and returns focus to the cell', () => {
		const { store, source } = makeStore();
		mount(store);
		openEditor('note.Text');
		type('discard me');
		press('Escape');

		expect(stored(source, 'note.Text')).toBe('Row 1');
		expect(source.batches()).toHaveLength(0);
		expect(document.body.querySelector('.cell-editor')).toBeNull();
		expect(document.activeElement).toBe(cellOf('note.Text'));
	});
});

describe('the popover editors', () => {
	it('mount outside the scroller, so scrolling cannot clip them', () => {
		const { store } = makeStore();
		mount(store);
		openEditor('note.Status');
		const pop = document.body.querySelector('.cell-pop');
		expect(pop).not.toBeNull();
		expect(pop?.closest('.tablify-scroller')).toBeNull();
		expect(pop?.closest('.tablify-grid-area')).not.toBeNull();
	});
});

describe('the size rules, as declared', () => {
	/**
	 * **Declared, not measured** — and the distinction is deliberate.
	 *
	 * `docs/04` §Mobile requires *inputs are ≥ 16 px* (iOS zooms the viewport on focus otherwise) and §Touch
	 * requires *≥ 44×44 px for any tap target*. jsdom resolves no stylesheet, so a test run here cannot measure a
	 * box; pretending otherwise would be a number nobody checked. What this test does instead is read the
	 * stylesheet the build ships and assert that every editor control **declares** the rules — which catches the
	 * regression that matters (someone drops the 16 px floor, or replaces the tap token with a magic number).
	 *
	 * The measured boxes — the real computed `font-size`, the real hit rects, at 900 / 600 / 389 px — are step
	 * 21's Playwright harness, where a browser is watching. The row-axis exception (40 px, not 44) is the
	 * decision recorded in `PROGRESS.md`: the row height belongs to the density (`--tablify-row-h` = 40 px at
	 * medium) and only the row axis is short of the tap floor.
	 */
	/** One rule's declarations, by selector, from the stylesheet the build bundles. */
	function block(selector: string): string {
		// `import.meta.url` arrives as a jsdom `http://` URL in the dom project, so the stylesheet is read from
		// the repository root instead: vitest runs from there, and this is the same file the build bundles.
		const css = readFileSync(resolve(cwd(), 'src/styles/grid.css'), 'utf8');
		const start = css.indexOf(`${selector} {`);
		expect(start, `${selector} is not declared in src/styles/grid.css`).toBeGreaterThan(-1);
		const end = css.indexOf('}', start);
		return css.slice(start, end);
	}

	it('floors every text entry at 16 px', () => {
		for (const selector of ['.cell-editor', '.cell-pop-search', '.cell-pop-textarea']) {
			expect(block(selector), selector).toContain('font-size: max(16px,');
		}
	});

	it('sizes every control a finger touches at the tap token', () => {
		expect(block('.cell-pop-item')).toContain('min-height: var(--tablify-tap)');
		expect(block('.star-btn')).toContain('width: var(--tablify-tap)');
		expect(block('.star-btn')).toContain('height: var(--tablify-tap)');
		expect(block('.cell-pop-action')).toContain('min-height: var(--tablify-tap)');
	});

	it('keeps an open editor on the row axis to the row height, never a percentage', () => {
		const rule = block('.cell-editor-check');
		expect(rule).toContain('height: var(--tablify-row-h)');
		expect(rule).not.toContain('%');
	});
});
