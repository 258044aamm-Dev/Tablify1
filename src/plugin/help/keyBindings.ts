/**
 * The keyboard model, as data. Transcribed from `docs/01-spec.md` §"Core interaction model".
 *
 * This array is the single source of truth for keyboard help: the modal in `main.ts` renders it today,
 * and the real help surface in the grid milestone reuses it unchanged. No UI logic lives here, so it
 * can be unit-tested and rendered by anything.
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
