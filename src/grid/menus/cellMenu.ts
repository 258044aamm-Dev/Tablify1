/**
 * The cell menu: what right-clicking (or long-pressing, or `Shift+F10` on) a cell offers.
 *
 * The item list is the prototype's (`prototype/js/dialogs.js` §cellMenu), which is the frozen reference for the
 * menu inventory — `docs/01` §Core interaction model gives the *gesture* ("Right-click / long-press → Context
 * menu: cell, row, column or selection actions") and never enumerates items (a doc gap recorded in
 * `PROGRESS.md`). Pluralisation follows the prototype: *"Copy 2×3"*, *"Delete rows"*, *"Insert row above"*.
 *
 * Three items are disabled **because the feature that serves them lands in a later step**, and their `reason`
 * says which: `copy`/`cut`/`paste` are the clipboard (step 22). They are present rather than absent because a
 * menu that grows an item every milestone is a menu whose muscle memory breaks every milestone — and because the
 * inventory test is the contract.
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
	const clipboardReason = 'The clipboard lands in step 22 (copy/cut/paste, three paste modes).';

	const specs: MenuItemSpec[] = [
		{
			id: 'copy',
			title: multi ? `Copy ${count}` : 'Copy',
			icon: 'copy',
			disabled: true,
			reason: clipboardReason,
			run: () => undefined,
		},
		{
			id: 'cut',
			title: 'Cut',
			icon: 'scissors',
			disabled: true,
			reason: clipboardReason,
			run: () => undefined,
		},
		{
			id: 'paste',
			title: 'Paste',
			icon: 'clipboard-paste',
			// The prototype enables Paste only for a multi-cell target: pasting one value into one cell is typing.
			disabled: true,
			reason: multi
				? clipboardReason
				: 'Paste needs a multi-cell selection; a single cell is typed into.',
			run: () => undefined,
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
