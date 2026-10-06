/**
 * The cell menu: what right-clicking (or long-pressing, or `Shift+F10` on) a cell offers.
 *
 * The item list is the prototype's (`prototype/js/dialogs.js` §cellMenu), which is the frozen reference for the
 * menu inventory — `docs/01` §Core interaction model gives the *gesture* ("Right-click / long-press → Context
 * menu: cell, row, column or selection actions") and never enumerates items (a doc gap recorded in
 * `PROGRESS.md`). Pluralisation follows the prototype: *"Copy 2×3"*, *"Delete rows"*, *"Insert row above"*.
 *
 * The clipboard's three items are live as of step 22, and two details of theirs are the prototype's: **Cut** and
 * **Paste** stay disabled unless the target is more than one cell (*"Paste needs a multi-cell selection; a single
 * cell is typed into"* is the prototype's own reason), and the count in the title (*"Copy 2×3"*) is the
 * selection's shape rather than its cell count.
 */
import { clearSelection, fillDown, fillRight } from '../store/commands';
import { menuIds } from './items';
import type { MenuItemSpec } from './items';
import type { CellMenuContext } from './context';

/** The documented item order of the cell menu. Exported so the test can name the list it is checking. */
export const CELL_MENU_IDS = [
	'copy',
	'cut',
	'paste',
	'insert-row-above',
	'insert-row-below',
	'duplicate-rows',
	'delete-rows',
	'fill-down',
	'fill-right',
	'clear-cells',
	'bulk-edit',
	'row-details',
] as const;

export function cellMenuItems(context: CellMenuContext): readonly MenuItemSpec[] {
	const { store, filePath, field, bounds, ports } = context;
	const multi = bounds.rows > 1 || bounds.fields > 1;
	const count = `${String(bounds.rows)}×${String(bounds.fields)}`;
	const rows = bounds.rowPaths;
	const rowLabel = rows.length === 1 ? 'row' : 'rows';
	const readOnly = field === null || field.readOnly || !field.descriptor.editable;

	const specs: MenuItemSpec[] = [
		{
			id: 'copy',
			title: multi ? `Copy ${count}` : 'Copy',
			icon: 'copy',
			// A copy is not a write: it is offered even on a read-only column, because copying a value out of a
			// note the grid may not edit is exactly what a person does with one.
			run: () => {
				ports.onCopy('copy');
			},
		},
		{
			id: 'cut',
			title: 'Cut',
			icon: 'scissors',
			// Cut is a copy **then** a clear, so a read-only target has nothing to cut.
			disabled: !multi || readOnly,
			reason: !multi
				? 'Cut needs a multi-cell selection; cutting one cell is typing over it.'
				: readOnly
					? 'This column is read-only, so there is nothing to cut from it.'
					: undefined,
			run: () => {
				ports.onCopy('cut');
			},
		},
		{
			id: 'paste',
			title: 'Paste',
			icon: 'clipboard-paste',
			// The prototype enables Paste only for a multi-cell target: pasting one value into one cell is typing.
			disabled: !multi,
			reason: multi
				? undefined
				: 'Paste needs a multi-cell selection; a single cell is typed into.',
			run: () => {
				ports.onPaste();
			},
		},
		{
			id: 'insert-row-above',
			title: 'Insert row above',
			icon: 'arrow-up-to-line',
			disabled: ports.onInsertRow === null,
			reason:
				ports.onInsertRow === null
					? 'This view cannot create notes, so it cannot insert a row (a row is a file).'
					: undefined,
			separatorBefore: true,
			run: () => {
				ports.onInsertRow?.(bounds.top);
			},
		},
		{
			id: 'insert-row-below',
			title: 'Insert row below',
			icon: 'arrow-down-to-line',
			disabled: ports.onInsertRow === null,
			reason:
				ports.onInsertRow === null
					? 'This view cannot create notes, so it cannot insert a row (a row is a file).'
					: undefined,
			run: () => {
				ports.onInsertRow?.(bounds.bottom + 1);
			},
		},
		{
			id: 'duplicate-rows',
			title: rows.length > 1 ? 'Duplicate rows' : 'Duplicate row',
			icon: 'copy-plus',
			disabled: ports.onDuplicateRows === null,
			reason:
				ports.onDuplicateRows === null
					? 'Duplicating a row means creating a note for it; this view cannot create notes.'
					: undefined,
			run: () => {
				ports.onDuplicateRows?.(rows);
			},
		},
		{
			id: 'delete-rows',
			title: `Delete ${String(rows.length)} ${rowLabel}`,
			icon: 'trash-2',
			warning: true,
			disabled: ports.onDeleteRows === null,
			reason:
				ports.onDeleteRows === null
					? 'Deleting a row deletes its note, and that is the view owner’s decision, not the grid’s.'
					: undefined,
			run: () => {
				ports.onDeleteRows?.(rows);
			},
		},
		{
			id: 'fill-down',
			title: 'Fill down',
			icon: 'arrow-down',
			separatorBefore: true,
			disabled: bounds.rows < 2,
			reason: bounds.rows < 2 ? 'Select more than one row to fill down.' : undefined,
			run: () => {
				fillDown(store);
			},
		},
		{
			id: 'fill-right',
			title: 'Fill right',
			icon: 'arrow-right',
			disabled: bounds.fields < 2,
			reason: bounds.fields < 2 ? 'Select more than one column to fill right.' : undefined,
			run: () => {
				fillRight(store);
			},
		},
		{
			id: 'clear-cells',
			title: 'Clear cells',
			icon: 'eraser',
			disabled: !multi,
			reason: multi ? undefined : 'Select more than one cell to clear in one go.',
			run: () => {
				clearSelection(store);
			},
		},
		{
			id: 'bulk-edit',
			title: `Set every selected ${rowLabel} to…`,
			icon: 'pencil-line',
			separatorBefore: true,
			disabled: readOnly,
			reason: readOnly ? 'This column is read-only; there is nothing to write.' : undefined,
			run: () => {
				ports.onBulkEdit();
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
	];
	return specs;
}

/** The id list of the built menu — see {@link menuIds}. Used by the inventory test. */
export function cellMenuIdList(context: CellMenuContext): readonly string[] {
	return menuIds(cellMenuItems(context));
}
