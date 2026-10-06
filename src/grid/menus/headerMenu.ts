/**
 * The header menu: everything about a *column*, in the order the prototype lists it
 * (`prototype/js/dialogs.js` §headerMenu).
 *
 * Two of the items are the accessible alternative the prompt requires: **Move left** / **Move right** change the
 * column order with a click, so the drag in `src/grid/pointer/reorderColumn.ts` is never the only way to reorder a
 * column. They call the same command, with `index ± 1`.
 *
 * The sort items write `ViewConfig.sorts` through `setViewConfig`, which is one undoable step (`docs/02` §The view
 * pipeline). `Filter this field…` is **disabled permanently and for an architectural reason**: filters are not a
 * view setting in this product — they live in the `.base` file, which is Bases' own, and `docs/03` makes the
 * `.base` sidecar the place they are edited. Offering an enabled item that opened a grid-made filter editor would
 * be a second, divergent filter model.
 */
import { reorderColumn, resizeColumn, setViewConfig } from '../store/commands';
import { autoFitWidth } from '../pointer/resizeColumn';
import { columnTexts, hasFieldOptions, isPrimary } from './context';
import type { MenuItemSpec } from './items';
import type { HeaderMenuContext } from './context';
import type { SortSpec } from '../../core/view/pipeline';

/** The documented item order of the header menu. */
export const HEADER_MENU_IDS = [
	'sort-asc',
	'sort-desc',
	'add-sort',
	'group-by',
	'filter-field',
	'hide-field',
	'show-field',
	'edit-field',
	'change-type',
	'manage-options',
	'insert-field-right',
	'move-left',
	'move-right',
	'resize-to-fit',
	'delete-field',
] as const;

export function headerMenuItems(context: HeaderMenuContext): readonly MenuItemSpec[] {
	const { store, field, columnIndex, order, ports } = context;
	const fieldId = field.definition.id;
	const view = store.state().view;
	const sorts = view.sorts ?? [];
	const primary = isPrimary(field);
	const hasOptions = hasFieldOptions(field);
	const single = sorts.length === 1 ? sorts[0] : undefined;
	// `docs/02` §the view pipeline: a sort is `{ fieldId, direction }`. One sort replaces the chain, which is what
	// "Sort ascending" means on a column that had two sorts on it.

	const isLogged = sorts.some((sort) => sort.fieldId === fieldId);
	const hidden = (view.hiddenFieldIds ?? []).includes(fieldId);
	const first = columnIndex === 0;
	const last = columnIndex >= order.fields.length - 1;

	const oneSort = (direction: 'asc' | 'desc'): readonly SortSpec[] => [{ fieldId, direction }];

	return [
		{
			id: 'sort-asc',
			title: 'Sort ascending',
			icon: 'arrow-up-narrow-wide',
			checked: single?.fieldId === fieldId && single.direction === 'asc',
			run: () => {
				setViewConfig(store, { sorts: oneSort('asc') }, 'Sort ascending');
			},
		},
		{
			id: 'sort-desc',
			title: 'Sort descending',
			icon: 'arrow-down-wide-narrow',
			checked: single?.fieldId === fieldId && single.direction === 'desc',
			run: () => {
				setViewConfig(store, { sorts: oneSort('desc') }, 'Sort descending');
			},
		},
		{
			id: 'add-sort',
			title: 'Add to sort (multi-sort)…',
			icon: 'list-ordered',
			// Checked, not a toggle-off: the item always *adds* this column to the sort chain (the prototype opened a
			// sort panel here; step 20's View options dialog is that panel, and the menu's job is one command).
			checked: isLogged && sorts.length > 1,
			disabled: isLogged && sorts.length > 1,
			reason:
				isLogged && sorts.length > 1
					? 'This column is already in the sort chain.'
					: undefined,
			run: () => {
				const next = sorts.some((sort) => sort.fieldId === fieldId)
					? sorts
					: [...sorts, { fieldId, direction: 'asc' as const }];
				setViewConfig(store, { sorts: next }, 'Add to sort');
			},
		},
		{
			id: 'group-by',
			title: 'Group by this field',
			icon: 'rows-3',
			checked: view.groupBy === fieldId,
			run: () => {
				setViewConfig(
					store,
					{ groupBy: view.groupBy === fieldId ? undefined : fieldId },
					view.groupBy === fieldId ? 'Stop grouping' : 'Group by this field',
				);
			},
		},
		{
			id: 'filter-field',
			title: 'Filter this field…',
			icon: 'filter',
			separatorBefore: true,
			disabled: true,
			reason: 'Filters belong to the `.base` file, not to a grid-made filter editor — edit them in Bases.',
			run: () => undefined,
		},
		{
			id: 'hide-field',
			title: hidden ? 'Show field' : 'Hide field',
			icon: hidden ? 'eye' : 'eye-off',
			disabled: primary && !hidden,
			reason: primary && !hidden ? 'The primary column cannot be hidden.' : undefined,
			run: () => {
				const current = view.hiddenFieldIds ?? [];
				const next = hidden
					? current.filter((id) => id !== fieldId)
					: [...current, fieldId];
				setViewConfig(
					store,
					{ hiddenFieldIds: next },
					hidden ? 'Show field' : 'Hide field',
				);
			},
		},
		{
			id: 'show-field',
			title: 'Show all fields',
			icon: 'eye',
			disabled: (view.hiddenFieldIds ?? []).length === 0,
			reason: (view.hiddenFieldIds ?? []).length === 0 ? 'No column is hidden.' : undefined,
			run: () => {
				setViewConfig(store, { hiddenFieldIds: [] }, 'Show all fields');
			},
		},
		{
			id: 'edit-field',
			title: 'Edit field…',
			icon: 'settings-2',
			separatorBefore: true,
			run: () => {
				ports.onDialog('field-config', fieldId);
			},
		},
		{
			id: 'change-type',
			title: 'Change type…',
			icon: 'shapes',
			// The prototype opens the same dialog from both items; the dialog is where the type lives, and a second
			// dialog for one section of it would be two places to look for the same thing.
			run: () => {
				ports.onDialog('field-config', fieldId);
			},
		},
		{
			id: 'manage-options',
			title: hasOptions ? 'Manage options…' : 'Duplicate field',
			icon: hasOptions ? 'palette' : 'copy-plus',
			// `Duplicate field` needs the `addField` op with the same options; `Remove` is a step-23 command.
			disabled: !hasOptions,
			reason: hasOptions
				? undefined
				: 'This column has no options to manage (duplicate arrives with the field commands in step 23).',
			run: () => {
				ports.onDialog('option-manager', fieldId);
			},
		},
		{
			id: 'insert-field-right',
			title: 'Insert field right',
			icon: 'between-horizontal-end',
			disabled: true,
			reason: 'Adding a column changes the schema; the field commands land in step 23.',
			run: () => undefined,
		},
		{
			id: 'move-left',
			title: 'Move column left',
			icon: 'arrow-left',
			separatorBefore: true,
			disabled: first,
			reason: first ? 'This is the first column.' : undefined,
			run: () => {
				reorderColumn(store, fieldId, columnIndex - 1);
			},
		},
		{
			id: 'move-right',
			title: 'Move column right',
			icon: 'arrow-right',
			disabled: last,
			reason: last ? 'This is the last column.' : undefined,
			run: () => {
				// An insertion index in the current order: one to the right of where the column is now.
				reorderColumn(store, fieldId, columnIndex + 1);
			},
		},
		{
			id: 'resize-to-fit',
			title: 'Resize to fit contents',
			icon: 'move-horizontal',
			separatorBefore: true,
			run: () => {
				resizeColumn(
					store,
					fieldId,
					autoFitWidth(field.definition.name, columnTexts(store, fieldId)),
				);
			},
		},
		{
			id: 'delete-field',
			title: 'Delete field',
			icon: 'trash-2',
			warning: true,
			disabled: true,
			reason: primary
				? 'The primary column cannot be deleted: it names each row’s note.'
				: 'Deleting a column rewrites every note’s frontmatter; that command lands in step 23.',
			run: () => undefined,
		},
	];
}

/** The id list of the built menu — the inventory test's subject. */
export function headerMenuIdList(context: HeaderMenuContext): readonly string[] {
	return headerMenuItems(context).map((spec) => spec.id);
}
