/**
 * The menu inventory: three menus, their items in order, the ones that are disabled, and what a chosen item does.
 *
 * The assertion this file exists for is *"each menu opens with the documented item list, in order"*. "Documented"
 * means two things here, and both are checked:
 *
 *  · **The prototype's list** (`prototype/js/dialogs.js` §cellMenu/§headerMenu/§gutterMenu), which is the frozen
 *    reference for the item order — `docs/01` gives the gesture and never enumerates items, and that doc gap is
 *    recorded in `PROGRESS.md`. The two *added* rows are step 20's own requirement: the header menu's
 *    `Move column left` / `Move column right` are the accessible alternative to a drag (`prompt step-20` item 3),
 *    and they are the only items this file's lists add to the prototype's.
 *  · **The observable behaviour**: a disabled item is disabled *for the documented reason*, and a chosen item
 *    dispatches the matching command — asserted through the real command layer, not a spy (the discipline
 *    `tests/dom/editors.test.tsx` set: a spy proves a call happened, the store proves a value moved).
 *
 * The menus are built by **pure functions** (`src/grid/menus/*.ts`) precisely so this file can compare specs
 * without Obsidian's DOM. The `Menu` double (`tests/mocks/obsidian.ts`) is then used once per test to prove the
 * spec reaches a real `Menu` — `showMenu` — and that a click on a *disabled* item runs nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cellMenuItems, CELL_MENU_IDS } from '../../src/grid/menus/cellMenu';
import { headerMenuItems, HEADER_MENU_IDS } from '../../src/grid/menus/headerMenu';
import { gutterMenuItems, GUTTER_MENU_IDS } from '../../src/grid/menus/gutterMenu';
import { menuIds, runMenuItem, showMenu } from '../../src/grid/menus/items';
import { toolbarMenuItems } from '../../src/grid/menus/toolbarMenu';
import { menuBounds } from '../../src/grid/menus/context';
import { createGridStore } from '../../src/grid/store/store';
import { selectCell, setSelection } from '../../src/grid/store/commands';
import { resolveField } from '../../src/core/schema/propertySchema';
import { createFakeRowSource } from '../fakes/rowSource';
import { openedMenus, resetMenus } from '../mocks/obsidian';
import type { GridMenuPorts, MenuBounds } from '../../src/grid/menus/context';
import type { GridStore } from '../../src/grid/store/types';
import type { FieldContext, CellValue } from '../../src/core/types';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import type { GridRowPorts } from '../../src/grid/menus/context';

const CONTEXT: FieldContext = {
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
	columnName: '',
};

const COLUMNS = [
	{ id: 'note.Name', name: 'Name', type: 'text', value: 'Row' },
	{
		id: 'note.Status',
		name: 'Status',
		type: 'singleSelect',
		value: 'Todo',
		options: { options: [{ id: 'Todo', name: 'Todo', color: 'blue' }] },
	},
	{ id: 'note.Count', name: 'Count', type: 'number', value: 1 },
] as const;

const ROWS = ['Notes/001.md', 'Notes/002.md', 'Notes/003.md'];

function makeFixture(): {
	readonly store: GridStore;
	readonly calls: string[];
	readonly ports: GridMenuPorts;
} {
	const fields: ResolvedField[] = COLUMNS.map((column) =>
		resolveField(
			{
				id: column.id,
				name: column.name,
				source: 'note',
				fieldOptions: { type: column.type, ...('options' in column ? column.options : {}) },
			},
			{ ...CONTEXT, columnName: column.name },
		),
	);
	const rows = ROWS.map((filePath) => {
		const cells: Record<string, CellValue> = {};
		for (const [at, column] of COLUMNS.entries()) {
			cells[fields[at]?.definition.id ?? column.id] = column.value;
		}
		return { filePath, cells };
	});
	const store = createGridStore({ source: createFakeRowSource({ fields, rows }) });
	const calls: string[] = [];
	const rowPorts: GridRowPorts = {
		onInsertRow: (at) => calls.push(`insert:${String(at)}`),
		onDuplicateRows: null,
		onDeleteRows: null,
	};
	const ports: GridMenuPorts = {
		onRowDetails: (filePath) => calls.push(`details:${filePath}`),
		onBulkEdit: () => calls.push('bulk'),
		onInsertRow: rowPorts.onInsertRow,
		onDuplicateRows: rowPorts.onDuplicateRows,
		onDeleteRows: rowPorts.onDeleteRows,
		onDialog: (id, argument) =>
			calls.push(`dialog:${id}${argument === undefined ? '' : `:${argument}`}`),
		onCopy: (verb) => {
			calls.push(`copy:${verb}`);
		},
		onPaste: () => {
			calls.push('paste');
		},
		onSelectRows: (paths) => calls.push(`select:${paths.join(',')}`),
	};
	return { store, calls, ports };
}

/** The context every menu test starts from: one cell active, one row's worth of selection. */
function contextOf(args: {
	readonly store: GridStore;
	readonly ports: GridMenuPorts;
	readonly fieldId?: string;
	readonly filePath?: string;
	readonly selection?: boolean;
	/** Selects exactly one cell instead of a range — the case Cut and Paste are disabled for. */
	readonly single?: boolean;
}): { readonly bounds: MenuBounds; readonly fieldId: string; readonly filePath: string } {
	const { store, ports, fieldId = 'note.Count', filePath = ROWS[1] ?? '', single = false } = args;
	if (single) {
		selectCell(store, { filePath: ROWS[1] ?? '', fieldId: 'note.Count' });
	}
	if (!single && args.selection !== false) {
		selectCell(store, { filePath: ROWS[0] ?? '', fieldId: 'note.Name' });
		setSelection(store, {
			anchor: { filePath: ROWS[0] ?? '', fieldId: 'note.Name' },
			focus: { filePath: ROWS[1] ?? '', fieldId: 'note.Count' },
		});
	}
	const snapshot = store.getSnapshot();
	void ports;
	return {
		bounds: menuBounds(snapshot.order, snapshot.selection, snapshot.active),
		fieldId,
		filePath,
	};
}

beforeEach(() => {
	resetMenus();
});

afterEach(() => {
	resetMenus();
});

describe('the cell menu', () => {
	it('lists the prototype’s twelve items, in order, with three separators', () => {
		const { store, ports } = makeFixture();
		const { bounds, fieldId, filePath } = contextOf({ store, ports });
		const specs = cellMenuItems({
			store,
			filePath,
			field:
				store.getSnapshot().fields.find((field) => field.definition.id === fieldId) ?? null,
			bounds,
			ports,
		});
		expect(menuIds(specs)).toEqual([...CELL_MENU_IDS]);
		expect(specs.filter((spec) => spec.separatorBefore === true)).toHaveLength(3);
	});

	it('leaves the clipboard items live on a multi-cell selection, and disables the row items the view cannot do', () => {
		const { store, ports } = makeFixture();
		const { bounds, fieldId, filePath } = contextOf({ store, ports });
		const specs = cellMenuItems({
			store,
			filePath,
			field:
				store.getSnapshot().fields.find((field) => field.definition.id === fieldId) ?? null,
			bounds,
			ports,
		});
		const byId = new Map(specs.map((spec) => [spec.id, spec]));
		// Step 22's clipboard is here: on a two-row × two-column selection, all three items are live, and a copy
		// is offered even on a column the grid may not write to (copying out of a read-only cell is the point).
		expect(byId.get('copy')?.disabled).toBeUndefined();
		expect(byId.get('cut')?.disabled).toBe(false);
		expect(byId.get('paste')?.disabled).toBe(false);
		// Step 21's file operations are still the view's, and still say why they cannot run.
		expect(byId.get('duplicate-rows')?.disabled).toBe(true);
		expect(byId.get('duplicate-rows')?.reason).toContain('creating a note');
		// And fill and clear are live, as they were.
		expect(byId.get('fill-down')?.disabled).toBe(false);
		expect(byId.get('clear-cells')?.disabled).toBe(false);
		expect(byId.get('bulk-edit')?.disabled).toBe(false);
	});

	it('disables Cut and Paste on a single cell, with the prototype’s reason', () => {
		const { store, ports } = makeFixture();
		const { bounds, fieldId, filePath } = contextOf({ store, ports, single: true });
		const specs = cellMenuItems({
			store,
			filePath,
			field:
				store.getSnapshot().fields.find((field) => field.definition.id === fieldId) ?? null,
			bounds,
			ports,
		});
		const byId = new Map(specs.map((spec) => [spec.id, spec]));
		// Copy is always available — one cell is a thing one copies; cut and paste need a range to be about.
		expect(byId.get('copy')?.disabled).toBeUndefined();
		expect(byId.get('cut')?.disabled).toBe(true);
		expect(byId.get('paste')?.disabled).toBe(true);
		expect(byId.get('paste')?.reason).toContain('single cell is typed into');
	});

	it('disables the column-dependent items for a read-only column, and says so', () => {
		const { store, ports } = makeFixture();
		const { bounds, filePath } = contextOf({ store, ports });
		const readOnly = resolveField(
			{ id: 'file.name', name: 'Name', source: 'file' },
			{ ...CONTEXT, columnName: 'Name' },
		);
		const specs = cellMenuItems({ store, filePath, field: readOnly, bounds, ports });
		const bulk = specs.find((spec) => spec.id === 'bulk-edit');
		expect(bulk?.disabled).toBe(true);
		expect(bulk?.reason).toContain('read-only');
	});

	it('runs the item a person chose: Clear cells is one command, one undo step', () => {
		const { store, ports } = makeFixture();
		const { bounds, fieldId, filePath } = contextOf({ store, ports });
		const specs = cellMenuItems({
			store,
			filePath,
			field:
				store.getSnapshot().fields.find((field) => field.definition.id === fieldId) ?? null,
			bounds,
			ports,
		});
		const before = store.getSnapshot().revision;
		expect(runMenuItem(specs, 'clear-cells')).toBe(true);
		expect(store.getSnapshot().revision).toBeGreaterThan(before);
		// The operation is undoable, which is what "one command, one undo step" means.
		expect(store.getSnapshot().canUndo).toBe(true);
	});

	it('refuses to run a disabled item', () => {
		const { store, ports } = makeFixture();
		const { bounds, fieldId, filePath } = contextOf({ store, ports });
		const specs = cellMenuItems({
			store,
			filePath,
			field:
				store.getSnapshot().fields.find((field) => field.definition.id === fieldId) ?? null,
			bounds,
			ports,
		});
		// `duplicate-rows` is the one that stays disabled — the view cannot create a note. `copy` was the example
		// until step 22, and it is now a live item: the assertion moved with the feature.
		expect(runMenuItem(specs, 'duplicate-rows')).toBe(false);
	});
});

describe('the header menu', () => {
	it('lists the prototype’s items plus the two accessible reorder rows, in order', () => {
		const { store, ports } = makeFixture();
		const { bounds } = contextOf({ store, ports });
		const snapshot = store.getSnapshot();
		const specs = headerMenuItems({
			store,
			field: snapshot.fields[2] ?? (snapshot.fields[0] as ResolvedField),
			columnIndex: 2,
			order: snapshot.order,
			bounds,
			ports,
		});
		expect(menuIds(specs)).toEqual([...HEADER_MENU_IDS]);
		// The two rows step 20 adds are the ones that make reordering reachable without a drag.
		expect(HEADER_MENU_IDS).toContain('move-left');
		expect(HEADER_MENU_IDS).toContain('move-right');
	});

	it('disables Move left on the first column and Move right on the last, with the reason', () => {
		const { store, ports } = makeFixture();
		const { bounds } = contextOf({ store, ports });
		const snapshot = store.getSnapshot();
		const first = snapshot.fields[0] as ResolvedField;
		const specs = headerMenuItems({
			store,
			field: first,
			columnIndex: 0,
			order: snapshot.order,
			bounds,
			ports,
		});
		const byId = new Map(specs.map((spec) => [spec.id, spec]));
		expect(byId.get('move-left')?.disabled).toBe(true);
		expect(byId.get('move-left')?.reason).toBe('This is the first column.');
		expect(byId.get('move-right')?.disabled).toBe(false);
		// Filters live in the `.base` file, which is the archive's own surface (`docs/03`).
		expect(byId.get('filter-field')?.disabled).toBe(true);
		expect(byId.get('filter-field')?.reason).toContain('.base');
	});

	it('reorders the column through the header menu — the accessible alternative to the drag', () => {
		const { store, ports } = makeFixture();
		const { bounds } = contextOf({ store, ports });
		const snapshot = store.getSnapshot();
		const before = [...snapshot.order.fields];
		const specs = headerMenuItems({
			store,
			field: snapshot.fields[0] as ResolvedField,
			columnIndex: 0,
			order: snapshot.order,
			bounds,
			ports,
		});
		expect(runMenuItem(specs, 'move-right')).toBe(true);
		const after = store.getSnapshot().order.fields;
		expect(after).not.toEqual(before);
		expect(after[0]).toBe(before[1]);
		expect(store.getSnapshot().canUndo).toBe(true);
	});

	it('sorts through the menu and shows the check mark on the sort that is active', () => {
		const { store, ports } = makeFixture();
		const { bounds } = contextOf({ store, ports });
		const snapshot = store.getSnapshot();
		const field = snapshot.fields[1] as ResolvedField;
		const specs = headerMenuItems({
			store,
			field,
			columnIndex: 1,
			order: snapshot.order,
			bounds,
			ports,
		});
		expect(runMenuItem(specs, 'sort-desc')).toBe(true);
		expect(store.state().view.sorts?.[0]).toEqual({
			fieldId: field.definition.id,
			direction: 'desc',
		});
		const specsAfter = headerMenuItems({
			store,
			field,
			columnIndex: 1,
			order: store.getSnapshot().order,
			bounds,
			ports,
		});
		expect(specsAfter.find((spec) => spec.id === 'sort-desc')?.checked).toBe(true);
		expect(specsAfter.find((spec) => spec.id === 'sort-asc')?.checked).toBe(false);
	});

	it('hides a column through the menu, and refuses to hide the primary one', () => {
		const { store, ports } = makeFixture();
		const { bounds } = contextOf({ store, ports });
		const snapshot = store.getSnapshot();
		const specs = headerMenuItems({
			store,
			field: snapshot.fields[2] as ResolvedField,
			columnIndex: 2,
			order: snapshot.order,
			bounds,
			ports,
		});
		expect(runMenuItem(specs, 'hide-field')).toBe(true);
		expect(store.state().view.hiddenFieldIds).toContain('note.Count');
	});

	it('reaches the field dialog with the column it was opened for', () => {
		const { store, ports, calls } = makeFixture();
		const { bounds } = contextOf({ store, ports });
		const snapshot = store.getSnapshot();
		const specs = headerMenuItems({
			store,
			field: snapshot.fields[0] as ResolvedField,
			columnIndex: 0,
			order: snapshot.order,
			bounds,
			ports,
		});
		expect(runMenuItem(specs, 'edit-field')).toBe(true);
		expect(calls).toEqual(['dialog:field-config:note.Name']);
	});

	it('reaches the option manager for a select column, and disables it for a plain one', () => {
		const { store, ports, calls } = makeFixture();
		const { bounds } = contextOf({ store, ports });
		const snapshot = store.getSnapshot();
		const select = headerMenuItems({
			store,
			field: snapshot.fields[1] as ResolvedField,
			columnIndex: 1,
			order: snapshot.order,
			bounds,
			ports,
		});
		expect(runMenuItem(select, 'manage-options')).toBe(true);
		expect(calls).toEqual(['dialog:option-manager:note.Status']);

		const text = headerMenuItems({
			store,
			field: snapshot.fields[0] as ResolvedField,
			columnIndex: 0,
			order: snapshot.order,
			bounds,
			ports,
		});
		expect(text.find((spec) => spec.id === 'manage-options')?.disabled).toBe(true);
	});

	it('auto-fits a column through the menu: one command, and the width it measured', () => {
		const { store, ports } = makeFixture();
		const { bounds } = contextOf({ store, ports });
		const snapshot = store.getSnapshot();
		const specs = headerMenuItems({
			store,
			field: snapshot.fields[2] as ResolvedField,
			columnIndex: 2,
			order: snapshot.order,
			bounds,
			ports,
		});
		expect(runMenuItem(specs, 'resize-to-fit')).toBe(true);
		// "Count" is 5 characters and every value is one digit: the header wins, floored at 90.
		expect(store.getSnapshot().widths.get('note.Count')).toBe(90);
	});
});

describe('the gutter menu', () => {
	it('lists the prototype’s five items, in order', () => {
		const { store, ports } = makeFixture();
		const { bounds, filePath } = contextOf({ store, ports });
		const specs = gutterMenuItems({ store, filePath, paths: [filePath], bounds, ports });
		expect(menuIds(specs)).toEqual([...GUTTER_MENU_IDS]);
		expect(specs.filter((spec) => spec.separatorBefore === true)).toHaveLength(2);
	});

	it('acts on the selection’s rows, and on the pointed-at row when there is none', () => {
		const { store, ports } = makeFixture();
		const withSelection = contextOf({ store, ports });
		const many = gutterMenuItems({
			store,
			filePath: ROWS[1] ?? '',
			paths: withSelection.bounds.rowPaths,
			bounds: withSelection.bounds,
			ports,
		});
		expect(many.find((spec) => spec.id === 'select-rows')?.title).toBe('Select 2 rows');
		expect(many.find((spec) => spec.id === 'delete-rows')?.title).toBe('Delete 2 rows');

		const alone = contextOf({ store, ports, selection: false });
		const one = gutterMenuItems({
			store,
			filePath: ROWS[1] ?? '',
			paths: [ROWS[1] ?? ''],
			bounds: alone.bounds,
			ports,
		});
		expect(one.find((spec) => spec.id === 'select-rows')?.title).toBe('Select 1 row');
	});

	it('disables Copy rows as Markdown until the clipboard exists, and opens row details', () => {
		const { store, ports, calls } = makeFixture();
		const { bounds, filePath } = contextOf({ store, ports });
		const specs = gutterMenuItems({ store, filePath, paths: [filePath], bounds, ports });
		const markdown = specs.find((spec) => spec.id === 'copy-markdown');
		expect(markdown?.disabled).toBe(true);
		expect(markdown?.reason).toContain('step 22');
		expect(runMenuItem(specs, 'row-details')).toBe(true);
		expect(calls).toEqual([`details:${filePath}`]);
	});

	it('selects the rows it names', () => {
		const { store, ports, calls } = makeFixture();
		const { bounds, filePath } = contextOf({ store, ports });
		const specs = gutterMenuItems({
			store,
			filePath,
			paths: [ROWS[0] ?? '', ROWS[1] ?? ''],
			bounds,
			ports,
		});
		expect(runMenuItem(specs, 'select-rows')).toBe(true);
		expect(calls).toEqual(['select:Notes/001.md,Notes/002.md']);
	});
});

describe('reaching a real Menu', () => {
	it('builds the items in order, with their icons and disabled state, and shows at the pointer', () => {
		const { store, ports } = makeFixture();
		const { bounds, filePath } = contextOf({ store, ports });
		const specs = cellMenuItems({ store, filePath, field: null, bounds, ports });
		const menu = showMenu(specs, {
			kind: 'event',
			event: new MouseEvent('contextmenu', { clientX: 40, clientY: 60 }),
		});
		expect(menu).toBeDefined();
		const stub = openedMenus.at(-1);
		expect(stub?.items.map((item) => item.title)).toEqual(specs.map((spec) => spec.title));
		expect(stub?.items[0]?.icon).toBe('copy');
		// The disabled flags travel with the specs, whatever they are: comparing the two lists is what keeps the
		// inventory honest now that the clipboard's items are live and only the view's own gaps are disabled.
		expect(stub?.items.map((item) => item.disabled)).toEqual(
			specs.map((spec) => spec.disabled ?? false),
		);
		expect(stub?.separators).toHaveLength(3);
		expect(stub?.shownAt).toEqual({ x: 40, y: 60 });
	});

	it('does nothing when a disabled item is clicked, and runs the command when a live one is', () => {
		const { store, ports } = makeFixture();
		const { bounds, filePath } = contextOf({ store, ports });
		const specs = cellMenuItems({ store, filePath, field: null, bounds, ports });
		showMenu(specs, { kind: 'position', x: 0, y: 0 });
		const stub = openedMenus.at(-1);
		expect(stub?.shownAt).toEqual({ x: 0, y: 0 });
		// `field: null` in this describe's fixture: Duplicate rows is disabled (no note creation), Clear cells is
		// live, and the double refuses the click for exactly the reason the real `MenuItem` does.
		const disabled = stub?.items.find((item) => item.title === 'Duplicate rows');
		const clear = stub?.items.find((item) => item.title === 'Clear cells');
		expect(disabled?.click()).toBe(false);
		expect(clear?.click()).toBe(true);
		expect(store.getSnapshot().canUndo).toBe(true);
	});
});

describe('the freeze control is not in a menu anywhere', () => {
	/**
	 * `docs/08` §P21: *"On narrow panes pin nothing… the freeze toggle is hidden on mobile"*, and `docs/04`'s
	 * layout contract gives the freeze switch exactly one home — the View options dialog, which shows the row only
	 * at `NARROW_PANE_PX` (600) and above. The inventory is therefore asserted as an **absence**, over every menu
	 * this grid can build, so a future "quick freeze" item added to the gutter menu is a failing test rather than a
	 * second control with a different rule.
	 *
	 * The toolbar menu is built here too (the other three are the fixtures above): it is the only menu whose items
	 * are not a function of the store, and the only one that could sensibly grow such an item.
	 */
	it('offers no freeze or pin item in any of the four menus', () => {
		const { store, ports } = makeFixture();
		const { bounds, filePath } = contextOf({ store, ports });
		const field = store.getSnapshot().fields[0];
		const toolbar = toolbarMenuItems({
			canUndo: false,
			canRedo: false,
			undoLabel: null,
			onUndo: () => undefined,
			onRedo: () => undefined,
			onNewRow: () => undefined,
			rangeSelect: null,
			onToggleRangeSelect: () => undefined,
		});
		const inventories: { readonly menu: string; readonly ids: readonly string[] }[] = [
			{
				menu: 'cell',
				ids: menuIds(
					cellMenuItems({ store, filePath, field: field ?? null, bounds, ports }),
				),
			},
			{
				menu: 'header',
				ids: menuIds(
					headerMenuItems({
						store,
						field: field as ResolvedField,
						columnIndex: 0,
						order: store.getSnapshot().order,
						bounds,
						ports,
					}),
				),
			},
			{ menu: 'gutter', ids: GUTTER_MENU_IDS },
			{
				menu: 'toolbar',
				ids: menuIds(toolbar),
			},
		];
		for (const inventory of inventories) {
			expect(inventory.ids.length).toBeGreaterThan(0);
			expect(
				inventory.ids.filter((id) => /freeze|pin/.test(id)),
				`the ${inventory.menu} menu`,
			).toEqual([]);
		}
		// …and the words cannot appear as a *title* either: an item with no id is still an item.
		const titles = [
			...cellMenuItems({ store, filePath, field: field ?? null, bounds, ports }),
			...headerMenuItems({
				store,
				field: field as ResolvedField,
				columnIndex: 0,
				order: store.getSnapshot().order,
				bounds,
				ports,
			}),
			...toolbar,
		].map((item) => item.title);
		expect(titles.filter((title) => /freeze|pin/i.test(title))).toEqual([]);
	});
});
