/**
 * The gutter menu: what right-clicking a row number offers (`prototype/js/dialogs.js` §gutterMenu).
 *
 * The list is short on purpose, and its rule is the prototype's: the menu acts on **the selection's rows**, and
 * when there is no selection it acts on the pointed-at row. That single sentence is why "Delete 3 rows" on a
 * three-row selection deletes three notes and the same item on a bare row number deletes one — without the menu
 * having two modes.
 *
 * `Copy rows as Markdown` is the odd one out: it is a clipboard item, it is exactly what a person wants when
 * they are about to paste a table into a note, and it is **disabled until step 22** with its reason, like the
 * cell menu's clipboard items. `Row details…` is enabled because it is a read-only dialog — the row-as-note story
 * made visible, which needs no write path at all.
 */
import { menuIds } from './items';
import type { MenuItemSpec } from './items';
import type { GutterMenuContext } from './context';

/** The documented item order of the gutter menu. */
export const GUTTER_MENU_IDS = [
	'select-rows',
	'row-details',
	'duplicate-rows',
	'copy-markdown',
	'delete-rows',
] as const;

export function gutterMenuItems(context: GutterMenuContext): readonly MenuItemSpec[] {
	const { filePath, paths, ports } = context;
	const count = paths.length;
	const rowLabel = count === 1 ? 'row' : 'rows';

	return [
		{
			id: 'select-rows',
			title: `Select ${String(count)} ${rowLabel}`,
			icon: 'check-square',
			run: () => {
				ports.onSelectRows(paths);
			},
		},
		{
			id: 'row-details',
			title: 'Row details…',
			icon: 'file-text',
			run: () => {
				ports.onRowDetails(filePath);
			},
		},
		{
			id: 'duplicate-rows',
			title: 'Duplicate',
			icon: 'copy-plus',
			separatorBefore: true,
			disabled: ports.onDuplicateRows === null,
			reason:
				ports.onDuplicateRows === null
					? 'Duplicating a row means creating a note for it; this view cannot create notes.'
					: undefined,
			run: () => {
				ports.onDuplicateRows?.(paths);
			},
		},
		{
			id: 'copy-markdown',
			title: 'Copy rows as Markdown',
			icon: 'clipboard-copy',
			disabled: true,
			reason: 'The clipboard lands in step 22 (TSV + HTML + Markdown, three paste modes).',
			run: () => undefined,
		},
		{
			id: 'delete-rows',
			title: `Delete ${String(count)} ${rowLabel}`,
			icon: 'trash-2',
			warning: true,
			separatorBefore: true,
			disabled: ports.onDeleteRows === null,
			reason:
				ports.onDeleteRows === null
					? 'Deleting a row deletes its note, and that is the view owner’s decision, not the grid’s.'
					: undefined,
			run: () => {
				ports.onDeleteRows?.(paths);
			},
		},
	];
}

/** The id list of the built menu — the inventory test's subject. */
export function gutterMenuIdList(context: GutterMenuContext): readonly string[] {
	return menuIds(gutterMenuItems(context));
}
