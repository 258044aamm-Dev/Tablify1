/**
 * A menu as data, and the one place an Obsidian `Menu` is built from it.
 *
 * Every menu in the grid — cell, header, gutter — is a **list of specs** produced by a pure function over the
 * store's own facts. The `Menu` is constructed afterwards, in {@link showMenu}, and that split is the whole
 * reason the menus are testable: `tests/dom/menus.test.tsx` compares the *spec* list against the documented one,
 * item by item and in order, without needing Obsidian's DOM, and a second assertion drives a chosen item and
 * checks the command it dispatched.
 *
 * **A disabled item carries its `reason`, and Obsidian cannot show it.** `MenuItem` has
 * `setTitle`/`setIcon`/`setChecked`/`setDisabled`/`setWarning`/`setIsLabel`/`onClick`/`setSection`
 * (obsidian.d.ts §MenuItem, `@since` 0.15.0–0.16.2) and **no** tooltip; there is nowhere to put a sentence. So the
 * reason lives in the spec — asserted by the tests, printed in the step report, and deleted in the same commit
 * that enables the item — rather than being invented as a title suffix nobody asked for. Two of them are
 * permanent conditions (a read-only column, the primary column); the rest are steps 22–24 arriving.
 */
import { Menu } from 'obsidian';

/** One item of one menu. `id` is stable and test-facing; `title` is what a person reads. */
export type MenuItemSpec = {
	/** Stable id: the inventory test compares these, so wording can change freely. */
	readonly id: string;
	readonly title: string;
	/** A Lucide icon name, where the platform has one that means the right thing. */
	readonly icon?: string | undefined;
	/** `true`/`false` renders a check mark; `undefined` renders none. */
	readonly checked?: boolean | undefined;
	readonly disabled?: boolean | undefined;
	/** Why this item is disabled. Not rendered (the API has no tooltip) — see the file header. */
	readonly reason?: string | undefined;
	/** A destructive item: Obsidian tints it and the screen reader says so. */
	readonly warning?: boolean | undefined;
	/** Draw a separator *above* this item. */
	readonly separatorBefore?: boolean | undefined;
	readonly run: () => void;
};

/** Where a menu is shown: at the pointer, or at a position a keyboard asked for. */
export type MenuAnchor =
	| { readonly kind: 'event'; readonly event: MouseEvent }
	| { readonly kind: 'position'; readonly x: number; readonly y: number };

/**
 * Builds and shows the `Menu`. Mouse invocation goes through `showAtMouseEvent`, keyboard invocation (Shift+F10
 * on the active cell) through `showAtPosition` with the cell's own rect — the two APIs the prompt names, and the
 * reason the anchor is a tagged union rather than two call sites.
 */
export function showMenu(specs: readonly MenuItemSpec[], anchor: MenuAnchor): Menu {
	const menu = new Menu();
	for (const spec of specs) {
		if (spec.separatorBefore === true) {
			menu.addSeparator();
		}
		menu.addItem((item) => {
			item.setTitle(spec.title);
			if (spec.icon !== undefined) {
				item.setIcon(spec.icon);
			}
			if (spec.checked !== undefined) {
				item.setChecked(spec.checked);
			}
			if (spec.warning === true) {
				item.setWarning(true);
			}
			item.setDisabled(spec.disabled ?? false);
			item.onClick(() => {
				spec.run();
			});
		});
	}
	if (anchor.kind === 'event') {
		menu.showAtMouseEvent(anchor.event);
	} else {
		menu.showAtPosition({ x: anchor.x, y: anchor.y });
	}
	return menu;
}

/** The ids of a spec list, in order — what the inventory test asserts against. */
export function menuIds(specs: readonly MenuItemSpec[]): readonly string[] {
	return specs.map((spec) => spec.id);
}

/** A runnable item, so tests can fire one by id without touching the DOM. */
export function runMenuItem(specs: readonly MenuItemSpec[], id: string): boolean {
	const spec = specs.find((candidate) => candidate.id === id);
	if (spec === undefined || spec.disabled === true) {
		return false;
	}
	spec.run();
	return true;
}
