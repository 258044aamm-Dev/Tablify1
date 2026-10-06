/**
 * Option manager: the labels, colours and order of a select column's options.
 *
 * The prototype's `optionManager` (`prototype/js/dialogs.js` §optionManager) is the reference: one row per option
 * with the colour swatch, the label, the usage count, and a reorder pair; a footer with `+ Add option` and `Done`.
 *
 * **Everything here is read-only in step 20, and the reason is the same as the field dialog's**: an option list is
 * the `.base` sidecar's (`docs/03` §option colours and order live in the sidecar), and the command that writes it
 * is `setFieldOptions` — which exists in the core and is exposed as a grid command in step 23. What this dialog
 * proves today is the part that has real content: **which options are in use, and how many times**, computed from
 * the values the grid is actually showing, including values that are *not* in the option list (an orphaned value
 * is a thing a person needs to see — the migration notes in `docs/03` exist because of them).
 */
import { openDialog } from './base';
import type { DialogSpec } from './base';
import { hasFieldOptions } from '../menus/context';
import type { App } from 'obsidian';
import type { ResolvedField } from '../../core/schema/propertySchema';
import type { CellValue, FieldOption } from '../../core/types';
import type { GridModal } from './base';
import type { GridStore } from '../store/types';

export type OptionManagerInput = {
	readonly store: GridStore;
	readonly field: ResolvedField;
	readonly onClosed?: (() => void) | undefined;
};

/** One option's row: swatch, label, usage. */
function optionRow(host: HTMLElement, option: FieldOption, used: number): void {
	const line = host.createDiv({ cls: 'tablify-dlg-row' });
	const swatch = line.createSpan({ cls: 'tablify-dlg-swatch' });
	// The colour is a name from the sidecar, not a CSS value: `docs/04` keeps colour decisions in `tokens.css`, so
	// the swatch carries the name as a data attribute and the stylesheet decides how a *name* is painted.
	swatch.setAttribute('data-color', option.color ?? 'default');
	swatch.setAttribute('aria-hidden', 'true');
	line.createSpan({ cls: 'tablify-dlg-row-label', text: option.name });
	line.createSpan({ cls: 'tablify-dlg-row-value', text: `${String(used)} row(s)` });
}

export function optionManagerSpec(input: OptionManagerInput): DialogSpec {
	const { store, field, onClosed } = input;
	// The declared options, straight off the resolved field — the same list the select editor offers — and the
	// values the grid is showing, read through the core's own row table (the grid holds no second copy).
	const defined: readonly FieldOption[] | null = hasFieldOptions(field)
		? (field.options.options ?? null)
		: null;
	const values: readonly CellValue[] = store
		.state()
		.table.rows.map((row) => row.cells[field.definition.id] ?? null);

	// Count what the grid is showing, per option id — and remember every value that has no option, because those
	// are the ones a person opens this dialog to find.
	const counts = new Map<string, number>();
	const orphans = new Map<string, number>();
	const known = new Set((defined ?? []).map((option) => option.id));
	for (const value of values) {
		const ids = Array.isArray(value)
			? value.map((entry) => String(entry))
			: [String(value ?? '')];
		for (const id of ids) {
			if (id === '') {
				continue;
			}
			const bucket = known.has(id) ? counts : orphans;
			bucket.set(id, (bucket.get(id) ?? 0) + 1);
		}
	}

	return {
		kind: 'dialog',
		title: `Options: ${field.definition.name}`,
		subtitle: 'Option labels, colours and order live in the `.base` sidecar.',
		...(onClosed === undefined ? {} : { onClosed }),
		body: ({ contentEl }) => {
			contentEl.createDiv({ cls: 'tablify-dlg-section', text: 'Defined options' });
			if (defined === null || defined.length === 0) {
				contentEl.createDiv({
					cls: 'tablify-dlg-hint',
					text: 'This column has no options defined, so it accepts any value.',
				});
			}
			for (const option of defined ?? []) {
				optionRow(contentEl, option, counts.get(option.id) ?? 0);
			}

			if (orphans.size > 0) {
				contentEl.createDiv({ cls: 'tablify-dlg-section', text: 'Values with no option' });
				contentEl.createDiv({
					cls: 'tablify-dlg-hint',
					text: 'These values are in the notes but not in the option list. Nothing is deleted by showing them.',
				});
				for (const [id, used] of orphans) {
					const line = contentEl.createDiv({ cls: 'tablify-dlg-row' });
					line.createSpan({ cls: 'tablify-dlg-row-label', text: id });
					line.createSpan({
						cls: 'tablify-dlg-row-value',
						text: `${String(used)} row(s)`,
					});
				}
			}

			contentEl.createDiv({
				cls: 'tablify-dlg-hint',
				text: 'Adding, renaming, recolouring and reordering write the `.base` sidecar; those commands arrive with the field commands in step 23.',
			});
		},
		primary: { label: 'Done', run: () => undefined },
	};
}

/** Opens the dialog {@link optionManagerSpec} describes — build, open, done. */
export function openOptionManagerDialog(app: App, input: OptionManagerInput): GridModal {
	return openDialog(app, optionManagerSpec(input));
}
