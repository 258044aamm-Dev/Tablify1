/**
 * Row details: the "a row is a note" story, made concrete and read-only.
 *
 * The prototype showed a fake frontmatter preview with a caption admitting it was fake
 * (`prototype/js/dialogs.js` §rowDetails). This version shows the **real** thing: the row's own values, rendered
 * through each column's `formatPlain` — the same function the clipboard and the export will use in steps 22 and 24
 * — laid out as the `key: value` lines that will end up in the note's frontmatter.
 *
 * Two honest limits, both stated *in the dialog* rather than discovered by a person:
 *
 *  · The YAML shown is the **canonical values** as the descriptors would write them, not the file's actual bytes.
 *    The real bytes are the note, and `docs/03` §frontmatter write rules are the contract for how they are
 *    produced — reading them back to show here would be a second reader of the same file (step 13's reader is for
 *    `.tabula`, not for notes).
 *  · The row's path is shown as given by the source, because that is the one thing the grid knows exactly.
 *
 * Everything else in it is real content: the row's values, its pending writes, and whether any cell of it is
 * waiting on the write queue — which is the question "did my edit save?" answered where a person is already
 * looking.
 */
import { selectCellDisplay } from '../store/selectors';
import { openDialog } from './base';
import type { DialogSpec } from './base';
import type { App } from 'obsidian';
import type { GridModal } from './base';
import type { GridStore } from '../store/types';
import type { RowId } from '../../core/ops/types';

export type RowDetailsInput = {
	readonly store: GridStore;
	readonly filePath: RowId;
	readonly onClosed?: (() => void) | undefined;
};

/** The YAML-ish `key: value` lines for a row, one per column, in render order. */
export function rowDetailLines(store: GridStore, filePath: RowId): readonly string[] {
	const state = store.state();
	const order = store.getSnapshot().order;
	return order.fields.map((fieldId) => {
		const field = state.fields.find((candidate) => candidate.definition.id === fieldId);
		const key = field?.definition.name.toLowerCase().replace(/\s+/gu, '_') ?? fieldId;
		const text = selectCellDisplay(state, { filePath, fieldId });
		return `${key}: ${text}`;
	});
}

export function rowDetailsSpec(input: RowDetailsInput): DialogSpec {
	const { store, filePath, onClosed } = input;
	const lines = rowDetailLines(store, filePath);
	// The write queue's own count: "did my edit save?" answered where a person is already looking.
	const pending = store.getSnapshot().pending;

	return {
		kind: 'dialog',
		title: 'Row details',
		subtitle: filePath,
		...(onClosed === undefined ? {} : { onClosed }),
		body: ({ contentEl }) => {
			const pre = contentEl.createEl('pre', { cls: 'tablify-dlg-yaml' });
			pre.setText(['---', ...lines, '---'].join('\n'));

			contentEl.createDiv({
				cls: 'tablify-dlg-hint',
				text:
					pending === 0
						? 'Every value is written. The lines above are the canonical values as the column types would write them.'
						: `${String(pending)} value(s) are still on their way to the file.`,
			});
			contentEl.createDiv({
				cls: 'tablify-dlg-hint',
				text: 'This is a preview of the note’s frontmatter, not the file’s bytes: the note is the file.',
			});
		},
		primary: { label: 'Close', run: () => undefined },
	};
}

/** Opens the dialog {@link rowDetailsSpec} describes — build, open, done. */
export function openRowDetailsDialog(app: App, input: RowDetailsInput): GridModal {
	return openDialog(app, rowDetailsSpec(input));
}
