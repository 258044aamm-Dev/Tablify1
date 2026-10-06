/**
 * The keyboard model, as data. Transcribed from `docs/01-spec.md` §"Core interaction model".
 *
 * This array is the single source of truth for keyboard help: `KeyboardHelpModal.ts` (this folder) renders it,
 * one row per binding, and `src/grid/keyboard/keyTable.ts` is the *executable* twin of the same list — the
 * match test (`tests/unit/keybindings-match.test.ts`) holds the two in step by comparing **ids**, so wording can
 * change freely and an action cannot quietly go missing. No UI logic lives here, so it can be unit-tested and
 * rendered by anything.
 */
export type KeyBinding = {
	/** Stable id: safe as a map key and as a DOM id. */
	id: string;
	/** The key or gesture, written for a person to read. */
	keys: string;
	/** One sentence: what it does. */
	description: string;
};

export const KEY_BINDINGS: readonly KeyBinding[] = [
	{
		id: 'move',
		keys: 'Arrow keys',
		description: 'Move the active cell; hold Shift to extend the range.',
	},
	{
		id: 'navigate-edges',
		keys: 'Home / End / PageUp / PageDown / Ctrl+Home / Ctrl+End',
		description: 'Jump to the edges of the grid.',
	},
	{ id: 'edit', keys: 'Enter', description: 'Edit the cell; committing moves down one row.' },
	{ id: 'commit-tab', keys: 'Tab / Shift+Tab', description: 'Commit and move right / left.' },
	{
		id: 'type-to-replace',
		keys: 'Any printable key',
		description: 'Start editing an unfocused cell, replacing its content.',
	},
	{
		id: 'toggle-checkbox',
		keys: 'Space on a checkbox cell',
		description: 'Toggle the checkbox without entering edit mode.',
	},
	{
		id: 'clipboard',
		keys: 'Cmd/Ctrl+C / X / V',
		description: 'Copy, cut or paste the selected range as TSV and HTML.',
	},
	{
		id: 'undo-redo',
		keys: 'Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z',
		description: 'Undo or redo the last grid operation.',
	},
	{ id: 'select-all', keys: 'Cmd/Ctrl+A', description: 'Select all rows in the current view.' },
	{
		id: 'bulk-edit',
		keys: 'Cmd/Ctrl+Enter',
		description: 'Edit the column across the whole selection, bottom up.',
	},
	{
		id: 'clear',
		keys: 'Delete / Backspace',
		description: 'Clear the values in the selection.',
	},
	{
		id: 'fill',
		keys: 'Alt+D / Alt+R (also Cmd/Ctrl+D, Ctrl+R)',
		description: 'Fill the top row of the selection down, or the left column across.',
	},
	{
		id: 'escape',
		keys: 'Escape',
		description: 'Close the surface on top; with nothing open, clear the selection.',
	},
	{
		id: 'help',
		keys: 'F1 / ?',
		description: 'Open this keyboard reference.',
	},
	{
		id: 'context-menu',
		keys: 'Right-click / long-press',
		description: 'Open the context menu for the cell, row, column or selection.',
	},
	{
		id: 'resize-column',
		keys: 'Drag a column edge',
		description: 'Resize the column; double-click the edge to fit its content.',
	},
	{ id: 'reorder-row', keys: 'Drag a row-number handle', description: 'Reorder rows.' },
	{
		id: 'type-ahead',
		keys: 'Type ahead in a select cell',
		description: 'Filter options, and create one on the fly when allowed.',
	},
];

/**
 * The bindings that no `keydown` in `src/grid/keyboard/handler.ts` can serve, with the reason for each.
 *
 * They are in this file rather than in the test because a help table is a promise: it lists things a person can
 * do, and the question "what implements this row?" has to be answerable next to the row. The match test requires
 * every id here to be either handled by the keyboard table or listed below — so a new row cannot be added
 * without saying which code serves it, and a row whose code arrives later (the menus' `Shift+F10` path, the drag
 * sessions) moves out of this list and into the table in the same step.
 */
export const NON_KEYBOARD_BINDINGS: readonly {
	readonly id: string;
	readonly reason: string;
}[] = [
	{
		id: 'context-menu',
		reason: 'A pointer gesture; its keyboard path (Shift+F10) arrives with the menus in step 20.',
	},
	{
		id: 'resize-column',
		reason: 'A drag of a column edge; the pointer session is step 20.',
	},
	{
		id: 'reorder-row',
		reason: 'A drag of the row handle; the pointer session is step 20.',
	},
	{
		id: 'type-ahead',
		reason: 'Handled by the select popover, which owns the keyboard while it is open.',
	},
];
