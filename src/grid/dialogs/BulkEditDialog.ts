/**
 * Bulk edit: one value, every cell of the selection — `Cmd/Ctrl+Enter`'s dialog, and the third item of the cell
 * menu's lower group.
 *
 * `docs/01` §Core interaction model says *"Cmd/Ctrl+Enter — edit the column across the whole selection"*, and the
 * grid already keeps that promise **without** this dialog: pressing the key opens the cell's own editor with the
 * selection armed, and the commit fans out through `setCells` (one batch, one undo step — step 19). This dialog is
 * the same operation for the person who would rather type once and press Apply, which is what the menu item
 * promises ("Set every selected row to…").
 *
 * The number of cells is on screen before the write, in the product's own voice, because "how many notes am I
 * about to change?" is the question a bulk write has to answer before it happens.
 */
import { sizeOf } from '../../core/selection/range';
import { valueOfEmptyDraft } from '../editSession';
import { openDialog } from './base';
import type { App } from 'obsidian';
import type { DialogSpec } from './base';
import type { GridModal } from './base';
import type { GridStore } from '../store/types';
import type { PropertyId } from '../../core/types';

export type BulkEditInput = {
	readonly store: GridStore;
	/** The column the selection's active cell is in; its name is what the dialog names. */
	readonly fieldId: PropertyId;
	/** The value to write into every selected cell, once the person presses Apply. */
	readonly onApply: (value: string | null) => void;
};

export function bulkEditSpec(input: BulkEditInput): DialogSpec {
	const { store, fieldId, onApply } = input;
	const snapshot = store.getSnapshot();
	const range = snapshot.selection;
	const size = range === null ? { rows: 0, fields: 0 } : sizeOf(range, snapshot.order);
	const cells = size.rows * size.fields;
	const field = snapshot.fields.find((candidate) => candidate.definition.id === fieldId);
	let draft = '';

	return {
		kind: 'dialog',
		title: `Set every selected row to…`,
		subtitle: `${String(cells)} cell(s) in “${field?.definition.name ?? fieldId}”.`,
		body: ({ contentEl }) => {
			const row = contentEl.createDiv({ cls: 'tablify-dlg-row' });
			row.createSpan({ cls: 'tablify-dlg-row-label', text: 'Value' });
			const input = row.createEl('input', { cls: 'tablify-dlg-input', type: 'text' });
			input.addEventListener('input', () => {
				draft = input.value;
			});
			input.addEventListener('keydown', (event) => {
				// `Enter` applies, as it does in every dialog with one field. The modal's own Escape still closes.
				if (event.key === 'Enter') {
					event.preventDefault();
					onApply(draft === '' ? valueOfEmptyDraft() : draft);
				}
			});
			contentEl.createDiv({
				cls: 'tablify-dlg-hint',
				text: 'The value is parsed by the column’s own type, exactly as a typed cell would be. An empty value clears the cells.',
			});
			// Focus the field, so the dialog is one keystroke away from being useful.
			window.setTimeout(() => {
				input.focus();
			}, 0);
		},
		primary: {
			label: 'Apply',
			run: () => {
				onApply(draft === '' ? valueOfEmptyDraft() : draft);
			},
		},
		secondary: { label: 'Cancel', run: () => undefined },
	};
}

/** Opens the dialog {@link bulkEditSpec} describes. */
export function openBulkEditDialog(app: App, input: BulkEditInput): GridModal {
	return openDialog(app, bulkEditSpec(input));
}
