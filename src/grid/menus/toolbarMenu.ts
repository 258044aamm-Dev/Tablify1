/**
 * The toolbar's overflow menu: the same actions the toolbar's own buttons offer, for a toolbar that has no room
 * for them.
 *
 * `docs/04` §Touch: "Toolbar collapses to an overflow menu below 520 px width; the toolbar never wraps to two
 * rows." The threshold is the **toolbar's own width** (which is the pane's, minus nothing), not the device: a
 * 400 px sidebar on a 27-inch display has a narrow toolbar and collapses too, and it must — the buttons would
 * otherwise be pushed off the right edge where nobody can reach them.
 *
 * **What stays outside the menu.** The one action the view is *about* — New row — stays a button, because a
 * primary action behind a `⋯` is a primary action nobody finds. Undo and Redo move in: they are frequent but
 * not primary, and they have keyboard shortcuts that keep working either way (`docs/05` §The keyboard map).
 *
 * Steps 22–24 add Import, Export and Sync to this same list: they are exactly the "occasional" actions an
 * overflow menu exists for, and the spec list is the one place to add them.
 */
import type { MenuItemSpec } from './items';

/** Everything the overflow menu needs, gathered at open time — a menu is a picture of a moment. */
export type ToolbarMenuContext = {
	readonly canUndo: boolean;
	readonly canRedo: boolean;
	/** The wording `undo` would use, from the store. `null` when there is nothing to undo. */
	readonly undoLabel: string | null;
	readonly onUndo: () => void;
	readonly onRedo: () => void;
	/** The view's create-a-note action, or `null` when this view cannot create notes. */
	readonly onNewRow: (() => void) | null;
};

/**
 * The items, in order. Every disabled item carries its `reason` — the audit trail
 * `tests/unit/menus.test.ts` asserts against (`MenuItem` has no tooltip, so the reason is data, not UI).
 */
export function toolbarMenuItems(context: ToolbarMenuContext): readonly MenuItemSpec[] {
	const items: MenuItemSpec[] = [
		{
			id: 'new-row',
			title: 'New row',
			icon: 'plus',
			disabled: context.onNewRow === null,
			...(context.onNewRow === null ? { reason: 'This view cannot create notes.' } : {}),
			run: () => {
				context.onNewRow?.();
			},
		},
		{
			id: 'undo',
			title: context.undoLabel === null ? 'Undo' : `Undo ${context.undoLabel}`,
			icon: 'undo-2',
			separatorBefore: true,
			disabled: !context.canUndo,
			...(context.canUndo ? {} : { reason: 'Nothing to undo.' }),
			run: () => {
				context.onUndo();
			},
		},
		{
			id: 'redo',
			title: 'Redo',
			icon: 'redo-2',
			disabled: !context.canRedo,
			...(context.canRedo ? {} : { reason: 'Nothing to redo.' }),
			run: () => {
				context.onRedo();
			},
		},
	];
	return items;
}
