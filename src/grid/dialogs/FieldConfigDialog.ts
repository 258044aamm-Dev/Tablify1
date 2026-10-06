/**
 * Field config: what a column *is* — its name, its type, and the type's own options.
 *
 * This dialog is deliberately **read-mostly in step 20**, and says so on screen. `docs/03` §the field contract
 * makes a column's identity part of the `.base` sidecar (the property's `fieldOptions`), and the command that
 * writes it (`setFieldOptions`) is a core op that the grid's step-20 command set does not expose yet — renaming a
 * property rewrites frontmatter keys, and that is step 23's territory (`prompt step-23`: "the field commands").
 * So:
 *
 *  · **Name and type are shown, not edited**, with the resolved descriptor's own label and icon and the reasons
 *    the resolution recorded (`ResolvedField.reasons`) — which is information nothing else in the product shows.
 *  · **The type's options are listed**, read from the same validated `FieldOptions` every descriptor reads, so
 *    "what does this column think its precision is" has one answer.
 *  · The primary action is `Done`, and the footer says where the editable version lives (the `.base` file), which
 *    is the honest version of "this button does nothing yet".
 *
 * That is not a stub dressed up as a feature: it is a dialog whose *body* is real (the resolution, the options,
 * the read-only verdict) and whose missing half is named. A disabled "Save" would be worse — it would suggest the
 * dialog was ever going to save.
 */
import { openDialog } from './base';
import type { DialogSpec } from './base';
import { isPrimary } from '../menus/context';
import type { App } from 'obsidian';
import type { ResolvedField } from '../../core/schema/propertySchema';
import type { GridModal } from './base';
import type { GridStore } from '../store/types';

export type FieldConfigInput = {
	readonly store: GridStore;
	readonly field: ResolvedField;
	readonly onClosed?: (() => void) | undefined;
};

/** One `key: value` line of the options list. */
function optionLine(host: HTMLElement, key: string, value: string): void {
	const line = host.createDiv({ cls: 'tablify-dlg-row' });
	line.createSpan({ cls: 'tablify-dlg-row-label', text: key });
	line.createSpan({ cls: 'tablify-dlg-row-value', text: value });
}

export function fieldConfigSpec(input: FieldConfigInput): DialogSpec {
	const { store, field, onClosed } = input;
	const values = store.getSnapshot().order.rows.length;

	return {
		kind: 'dialog',
		title: `Field: ${field.definition.name}`,
		subtitle: isPrimary(field)
			? 'The primary column names each row’s note.'
			: 'A column is a property in the `.base` sidecar; its values are the notes’ frontmatter.',
		...(onClosed === undefined ? {} : { onClosed }),
		body: ({ contentEl }) => {
			contentEl.createDiv({ cls: 'tablify-dlg-section', text: 'Type' });
			const type = contentEl.createDiv({ cls: 'tablify-dlg-type' });
			type.createSpan({ cls: 'tablify-dlg-type-icon', text: field.descriptor.icon });
			type.createSpan({ cls: 'tablify-dlg-type-label', text: field.descriptor.label });
			type.createSpan({
				cls: 'tablify-dlg-hint',
				text: field.descriptor.editable ? 'Editable' : 'Computed / read-only',
			});

			contentEl.createDiv({ cls: 'tablify-dlg-section', text: 'This column' });
			optionLine(contentEl, 'Property id', field.definition.id);
			optionLine(contentEl, 'Source', field.definition.source);
			optionLine(contentEl, 'Cell editor', field.descriptor.editor ?? field.descriptor.id);
			optionLine(contentEl, 'Rows in this view', String(values));

			const options = Object.entries(field.options);
			contentEl.createDiv({ cls: 'tablify-dlg-section', text: 'Options' });
			if (options.length === 0) {
				contentEl.createDiv({ cls: 'tablify-dlg-hint', text: 'This type has no options.' });
			}
			for (const [key, value] of options) {
				optionLine(
					contentEl,
					key,
					typeof value === 'string' ? value : JSON.stringify(value),
				);
			}

			if (field.reasons.length > 0) {
				contentEl.createDiv({
					cls: 'tablify-dlg-section',
					text: 'Notes from the resolver',
				});
				for (const reason of field.reasons) {
					contentEl.createDiv({ cls: 'tablify-dlg-hint', text: reason });
				}
			}

			contentEl.createDiv({
				cls: 'tablify-dlg-hint',
				text: field.readOnly
					? 'This column is read-only: the grid renders it disabled rather than discarding input.'
					: 'Editing the name, the type or the options writes the `.base` sidecar; that command arrives with the field commands in step 23.',
			});
		},
		primary: { label: 'Done', run: () => undefined },
	};
}

/** Opens the dialog {@link fieldConfigSpec} describes — build, open, done. */
export function openFieldConfigDialog(app: App, input: FieldConfigInput): GridModal {
	return openDialog(app, fieldConfigSpec(input));
}
