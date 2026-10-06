/**
 * The keyboard table: one row per binding, each with **an event that must produce it**.
 *
 * `docs/01` §Core interaction model is the spec and `src/plugin/help/keyBindings.ts` is the surface that renders
 * it for a person. This file is the third leg, and it is the one that can be *executed*: every row carries an
 * example `keydown` and `tests/unit/keybindings-match.test.ts` asserts that the real resolver answers exactly
 * that row's id. A row deleted from the resolver, or a switching mistake that routes `Space` to the wrong
 * action, turns that test red — which is the only way a keyboard table stays true after the fifth person edits
 * it.
 *
 * The ids are the same strings as `KEY_BINDINGS`' ids, and a row here with no counterpart there (or the other
 * way round) fails the same test. The binding ids are typed, so the compiler catches a typo in this file rather
 * than the test discovering it.
 */
import type { KeyContext, KeyEventLike } from './handler';

/** The bindings a `keydown` can produce. One for each keyboard row of `KEY_BINDINGS`. */
export type KeyBindingId =
	| 'move'
	| 'navigate-edges'
	| 'edit'
	| 'commit-tab'
	| 'type-to-replace'
	| 'toggle-checkbox'
	| 'clipboard'
	| 'undo-redo'
	| 'select-all'
	| 'bulk-edit'
	| 'clear'
	| 'fill'
	| 'escape'
	| 'help';

/** A key event with every modifier spelled out, so an example reads as the keys a person presses. */
type ExampleEvent = KeyEventLike;

export type KeyTableRow = {
	readonly id: KeyBindingId;
	/** How the keys are written for a person. Matches `KEY_BINDINGS`' wording, id for id. */
	readonly keys: string;
	/** One event that must resolve to {@link id}. Modifiers default to "not held". */
	readonly example: ExampleEvent;
	/** Context this example needs (`editing`, `checkbox`). Absent ⇒ nothing is open and no cell is a checkbox. */
	readonly context?: KeyContext | undefined;
};

/**
 * `pageRows: 12` is the example's screenful: in the product the grid measures the visible band and divides by
 * the row height, so a page key jumps exactly what the pane shows. A test does not need a pane to make that
 * point, and the resolver only ever multiplies by it.
 */
const IDLE: KeyContext = { editing: false, checkbox: false, pageRows: 12 };
const CHECKBOX: KeyContext = { editing: false, checkbox: true, pageRows: 12 };
const EDITING: KeyContext = { editing: true, checkbox: false, pageRows: 12 };

/** A key with no modifiers held. Overrides apply on top, so an example names only what it presses. */
const key = (key_: string, overrides: Partial<ExampleEvent> = {}): ExampleEvent => ({
	key: key_,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...overrides,
});

export const KEY_TABLE: readonly KeyTableRow[] = [
	{
		id: 'move',
		keys: 'Arrow keys (Shift to extend)',
		example: key('ArrowDown'),
	},
	{
		id: 'move',
		keys: 'Arrow keys (Shift to extend)',
		example: key('ArrowRight', { shiftKey: true }),
	},
	{
		id: 'navigate-edges',
		keys: 'Home / End / PageUp / PageDown / Ctrl+Home / Ctrl+End',
		example: key('PageDown'),
	},
	{
		id: 'navigate-edges',
		keys: 'Home / End / PageUp / PageDown / Ctrl+Home / Ctrl+End',
		example: key('End'),
	},
	{
		id: 'navigate-edges',
		keys: 'Home / End / PageUp / PageDown / Ctrl+Home / Ctrl+End',
		example: key('End', { ctrlKey: true }),
	},
	{
		id: 'edit',
		keys: 'Enter / F2',
		example: key('Enter'),
	},
	{
		id: 'edit',
		keys: 'Enter / F2',
		example: key('F2'),
	},
	{
		id: 'commit-tab',
		keys: 'Tab / Shift+Tab',
		example: key('Tab'),
	},
	{
		id: 'commit-tab',
		keys: 'Tab / Shift+Tab',
		example: key('Tab', { shiftKey: true }),
	},
	{
		id: 'type-to-replace',
		keys: 'Any printable key',
		example: key('k'),
	},
	{
		id: 'type-to-replace',
		keys: 'Any printable key',
		example: key(' '),
	},
	{
		id: 'toggle-checkbox',
		keys: 'Space on a checkbox cell',
		example: key(' '),
		context: CHECKBOX,
	},
	{
		id: 'clipboard',
		keys: 'Cmd/Ctrl+C / X / V',
		example: key('c', { ctrlKey: true }),
	},
	{
		id: 'clipboard',
		keys: 'Cmd/Ctrl+C / X / V',
		example: key('v', { metaKey: true }),
	},
	{
		id: 'undo-redo',
		keys: 'Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z / Ctrl+Y',
		example: key('z', { ctrlKey: true }),
	},
	{
		id: 'undo-redo',
		keys: 'Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z / Ctrl+Y',
		example: key('Z', { metaKey: true, shiftKey: true }),
	},
	{
		id: 'select-all',
		keys: 'Cmd/Ctrl+A',
		example: key('a', { ctrlKey: true }),
	},
	{
		id: 'bulk-edit',
		keys: 'Cmd/Ctrl+Enter',
		example: key('Enter', { ctrlKey: true }),
	},
	{
		id: 'clear',
		keys: 'Delete / Backspace',
		example: key('Delete'),
	},
	{
		id: 'clear',
		keys: 'Delete / Backspace',
		example: key('Backspace'),
	},
	{
		id: 'fill',
		keys: 'Alt+D / Alt+R (also Cmd/Ctrl+D, Ctrl+R)',
		example: key('d', { altKey: true }),
	},
	{
		id: 'fill',
		keys: 'Alt+D / Alt+R (also Cmd/Ctrl+D, Ctrl+R)',
		example: key('D', { altKey: true, shiftKey: true }),
	},
	{
		id: 'fill',
		keys: 'Alt+D / Alt+R (also Cmd/Ctrl+D, Ctrl+R)',
		example: key('d', { ctrlKey: true }),
	},
	{
		id: 'escape',
		keys: 'Escape',
		example: key('Escape'),
	},
	{
		id: 'help',
		keys: 'F1 / ?',
		example: key('F1'),
	},
	{
		id: 'help',
		keys: 'F1 / ?',
		example: key('?', { shiftKey: true }),
	},
];

/**
 * The keys whose intent is **observed rather than handled** while an editor is open, plus the context that makes
 * them so. They are not bindings: the editor's own handler commits, and the grid only needs to know where the
 * selection should land afterwards (`docs/01`: *committing moves down one row*; *commit and move right*).
 */
export const EDITING_CONTEXT: KeyContext = EDITING;

/** Exported for the tests that need a "nothing is open" context without rebuilding one. */
export const IDLE_CONTEXT: KeyContext = IDLE;
