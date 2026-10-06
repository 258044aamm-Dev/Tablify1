/**
 * The keyboard table, executed.
 *
 * `docs/01` §Core interaction model is the spec and `src/grid/keyboard/handler.ts` implements it; this test is
 * the thing that makes a divergence between the two a **failure** rather than a discovery. It reads the doc's own
 * markdown table, and asserts three things:
 *
 *  1. every doc row is either covered by a case below or declared as a gesture row (a click, a drag, a long
 *     press — things no `keydown` can serve);
 *  2. the number of doc rows **without** a test is zero, and that number is in the test's *name*, so the raw
 *     vitest output carries the evidence;
 *  3. each case resolves to the intent the doc promises — including the fields, not just the id: `Shift` extends
 *     rather than moves, `Shift+Tab` goes backwards, `Cmd+Enter` is the bulk edit and not a commit, and a chord
 *     is never mistaken for the printable character under it.
 *
 * The doc's wording is matched loosely (whitespace and punctuation are normalised) but the *gestures* are exact:
 * a row whose keys change is a row this test stops covering, which is the intent — the doc and the handler are
 * the same contract read twice.
 */
import { cwd } from 'node:process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveKey } from '../../src/grid/keyboard/handler';
import type { GridIntent, KeyContext, KeyEventLike } from '../../src/grid/keyboard/handler';

const CONTEXT: KeyContext = { editing: false, checkbox: false, pageRows: 12 };
const CHECKBOX: KeyContext = { editing: false, checkbox: true, pageRows: 12 };
const EDITING: KeyContext = { editing: true, checkbox: false, pageRows: 12 };

/** A key event with nothing held, so a case names only what it presses. */
function key(key_: string, overrides: Partial<KeyEventLike> = {}): KeyEventLike {
	return {
		key: key_,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		...overrides,
	};
}

type Case = {
	/** The doc row's gesture, normalised the same way the reader normalises it. */
	readonly doc: string;
	readonly event: KeyEventLike;
	readonly context?: KeyContext;
	/** The intent's id, plus the fields that make the row mean what it says. */
	readonly expect: Partial<GridIntent> & { readonly id: GridIntent['id'] };
};

const CASES: readonly Case[] = [
	// ── the doc's "Core interaction model" table, row by row ────────────────────────────────────────────────
	{
		doc: 'Arrow keys',
		event: key('ArrowDown'),
		expect: { id: 'move', edge: 'down', extend: false },
	},
	{
		doc: 'Arrow keys',
		event: key('ArrowLeft', { shiftKey: true }),
		expect: { id: 'move', edge: 'left', extend: true },
	},
	{
		doc: 'Home / End / PageUp / PageDown / Ctrl+Home / Ctrl+End',
		event: key('Home'),
		expect: { id: 'navigate-edges', edge: 'rowStart', extend: false, steps: 1 },
	},
	{
		doc: 'Home / End / PageUp / PageDown / Ctrl+Home / Ctrl+End',
		event: key('PageDown'),
		expect: { id: 'navigate-edges', edge: 'down', steps: 12, extend: false },
	},
	{
		doc: 'Home / End / PageUp / PageDown / Ctrl+Home / Ctrl+End',
		event: key('Home', { ctrlKey: true }),
		expect: { id: 'navigate-edges', edge: 'tableStart', extend: false, steps: 1 },
	},
	{ doc: 'Enter', event: key('Enter'), expect: { id: 'edit' } },
	{
		doc: 'Tab / Shift+Tab',
		event: key('Tab'),
		expect: { id: 'commit-tab', direction: 'forward' },
	},
	{
		doc: 'Tab / Shift+Tab',
		event: key('Tab', { shiftKey: true }),
		expect: { id: 'commit-tab', direction: 'backward' },
	},
	{
		doc: 'Any printable key on an unfocused cell',
		event: key('q'),
		expect: { id: 'type-to-replace', text: 'q' },
	},
	{
		doc: 'Space on a checkbox cell',
		event: key(' '),
		context: CHECKBOX,
		expect: { id: 'toggle-checkbox' },
	},
	{
		doc: 'Cmd/Ctrl+C / X / V',
		event: key('c', { ctrlKey: true }),
		expect: { id: 'clipboard', verb: 'copy' },
	},
	{
		doc: 'Cmd/Ctrl+C / X / V',
		event: key('x', { metaKey: true }),
		expect: { id: 'clipboard', verb: 'cut' },
	},
	{
		doc: 'Cmd/Ctrl+C / X / V',
		event: key('v', { ctrlKey: true }),
		expect: { id: 'clipboard', verb: 'paste' },
	},
	{
		doc: 'Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z',
		event: key('z', { ctrlKey: true }),
		expect: { id: 'undo-redo', verb: 'undo' },
	},
	{
		doc: 'Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z',
		event: key('z', { metaKey: true, shiftKey: true }),
		expect: { id: 'undo-redo', verb: 'redo' },
	},
	{ doc: 'Cmd/Ctrl+A', event: key('a', { metaKey: true }), expect: { id: 'select-all' } },
	{ doc: 'Cmd/Ctrl+Enter', event: key('Enter', { ctrlKey: true }), expect: { id: 'bulk-edit' } },
	{ doc: 'Delete / Backspace', event: key('Delete'), expect: { id: 'clear' } },
	{ doc: 'Delete / Backspace', event: key('Backspace'), expect: { id: 'clear' } },

	// ── the two rows below the table that this step owes ─────────────────────────────────────────────────────
	// "Fill down/right from a selection" is a *bulk operation* in `docs/01` §capabilities and a key row in the
	// approved prototype (`prototype/js/dialogs.js`, the keyboard help surface: "Ctrl + D or Alt + D — Fill down").
	{
		doc: 'Fill down',
		event: key('d', { altKey: true }),
		expect: { id: 'fill', direction: 'down' },
	},
	{
		doc: 'Fill down',
		event: key('d', { ctrlKey: true }),
		expect: { id: 'fill', direction: 'down' },
	},
	{
		doc: 'Fill right',
		event: key('r', { altKey: true }),
		expect: { id: 'fill', direction: 'right' },
	},
	{
		doc: 'Fill right',
		event: key('r', { ctrlKey: true }),
		expect: { id: 'fill', direction: 'right' },
	},
	// Escape and the help key are the prototype's "Surfaces" group ("Esc — close the menu, the popover or the
	// dialog"; "F1 or ? — this help"). Escape's *grid* meaning is the second half of the same row: it lets go of
	// the selection once nothing is open.
	{ doc: 'Escape', event: key('Escape'), expect: { id: 'escape' } },
	{ doc: 'Escape', event: key('F1'), expect: { id: 'help' } },
	{ doc: 'Escape', event: key('?'), expect: { id: 'help' } },
];

/** The doc rows no `keydown` can serve. Each one is a gesture, and the pointer work is step 20's. */
const GESTURE_ROWS: readonly string[] = [
	'Click / tap',
	'Shift+click / drag',
	'Right-click / long-press',
	'Drag column edge',
	'Drag row-number handle',
	'Type-ahead in a select cell',
];

/** The doc's table, read from the file so a row edited there stops being covered here. */
function docGestures(): string[] {
	const doc = readFileSync(resolve(cwd(), 'docs/01-spec.md'), 'utf8');
	const section = doc.slice(doc.indexOf('## Core interaction model'));
	const table = section.slice(0, section.indexOf('\n\n', section.indexOf('| Gesture')));
	const gestures: string[] = [];
	for (const line of table.split('\n')) {
		const first = line.split('|')[1]?.trim() ?? '';
		if (first === '' || first === 'Gesture' || first.startsWith('---')) {
			continue;
		}
		gestures.push(first.replace(/\s+/g, ' '));
	}
	return gestures;
}

/** The doc's cell text with the markup noise removed: `**bold**`, backticks, and stray whitespace. */
function normalise(text: string): string {
	return text
		.replace(/[*`]/g, '')
		.replace(/\s*\/\s*/g, ' / ')
		.replace(/\s+/g, ' ')
		.trim();
}

describe('the doc table, row by row', () => {
	const gestures = docGestures();
	const covered = new Set(CASES.map((testCase) => normalise(testCase.doc)));
	const uncovered = gestures.filter((gesture) => {
		const plain = normalise(gesture);
		return !covered.has(plain) && !GESTURE_ROWS.includes(plain);
	});

	it(`covers every row of docs/01 §Core interaction model: ${String(gestures.length)} rows, ${String(uncovered.length)} without a test`, () => {
		expect(uncovered).toEqual([]);
	});

	it('names only rows the doc (or the prototype help table) actually has', () => {
		const known = new Set([
			...gestures.map(normalise),
			...GESTURE_ROWS.map(normalise),
			'Fill down',
			'Fill right',
			'Escape',
		]);
		expect([...covered].filter((row) => !known.has(row))).toEqual([]);
	});

	for (const testCase of CASES) {
		const { event, expect: wanted } = testCase;
		const label = `${normalise(testCase.doc)} → ${wanted.id} (${[
			event.ctrlKey ? 'ctrl' : '',
			event.metaKey ? 'meta' : '',
			event.altKey ? 'alt' : '',
			event.shiftKey ? 'shift' : '',
			event.key,
		]
			.filter((part) => part !== '')
			.join('+')})`;
		it(`${label}`, () => {
			const intent = resolveKey(event, testCase.context ?? CONTEXT);
			expect(intent).toEqual(wanted);
		});
	}
});

describe('the resolver’s edges', () => {
	it('answers nothing at all while an editor owns the keyboard, except the two commit keys', () => {
		expect(resolveKey(key('ArrowDown'), EDITING)).toBeNull();
		expect(resolveKey(key('a', { ctrlKey: true }), EDITING)).toBeNull();
		expect(resolveKey(key('Enter'), EDITING)).toEqual({
			id: 'commit-move',
			direction: 'down',
		});
		expect(resolveKey(key('Tab'), EDITING)).toEqual({
			id: 'commit-move',
			direction: 'forward',
		});
		expect(resolveKey(key('Tab', { shiftKey: true }), EDITING)).toEqual({
			id: 'commit-move',
			direction: 'backward',
		});
	});

	it('never reads a chord as the printable character under it', () => {
		expect(resolveKey(key('d', { metaKey: true }), CONTEXT)).toEqual({
			id: 'fill',
			direction: 'down',
		});
		expect(resolveKey(key('a', { altKey: true }), CONTEXT)).toBeNull();
		expect(resolveKey(key('Shift', { shiftKey: true }), CONTEXT)).toBeNull();
		expect(resolveKey(key('F5'), CONTEXT)).toBeNull();
	});

	it('reads Space as text everywhere except a checkbox cell', () => {
		expect(resolveKey(key(' '), CONTEXT)).toEqual({ id: 'type-to-replace', text: ' ' });
		expect(resolveKey(key(' '), CHECKBOX)).toEqual({ id: 'toggle-checkbox' });
	});

	it('does not treat a key while an IME is composing as a shortcut', () => {
		expect(resolveKey({ ...key('Enter'), isComposing: true }, CONTEXT)).toBeNull();
	});
});
