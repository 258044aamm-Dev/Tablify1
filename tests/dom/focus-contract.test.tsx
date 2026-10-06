/**
 * The focus contract, on real elements — plus the help surface it is wired into.
 *
 * The rule being tested is one sentence (`a11y/focusContract.ts`): **focus goes back to the opener, but only if it
 * was lost.** Two of these tests are the ones that matter, because they are the two ways the naive version
 * (always restore) is wrong:
 *
 *  · *"a dialog that opens while a menu closes keeps focus inside itself"* — the sequence a person produces a
 *    hundred times a day (a cell menu, "edit field…", a dialog) and the one where a restore is a robbery: the
 *    menu closing behind the dialog would pull the keyboard out of the thing being typed into.
 *  · *"an opener that is gone is not restored to"* — a menu opened from a button that the action it performed
 *    removed (a deleted row, a hidden column). Focusing a detached node moves focus to `<body>` and the user is
 *    left typing into nothing.
 *
 * The last test opens the **real** help modal through the plugin's own command, which is also the assertion that
 * the surface renders `KEY_BINDINGS` — one row per binding, no prose — rather than a hand-written page that
 * drifts from the table.
 */
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import {
	closeSurface,
	ESCAPE_OWNER,
	hasOpenSurface,
	openSurface,
	openerOf,
	resetSurfaces,
	SURFACE_KINDS,
	topSurface,
} from '../../src/grid/a11y/focusContract';
import { KeyboardHelpModal } from '../../src/plugin/help/KeyboardHelpModal';
import { KEY_BINDINGS } from '../../src/plugin/help/keyBindings';
import TablifyPlugin from '../../src/plugin/main';
import { openedModals, Plugin } from '../mocks/obsidian';
import type { ElementStub } from '../mocks/obsidian';
import type { SurfaceKind } from '../../src/grid/a11y/focusContract';

Object.assign(window, { IS_REACT_ACT_ENVIRONMENT: true });

let roots: { unmount: () => void }[] = [];

afterEach(() => {
	for (const root of roots) {
		act(() => {
			root.unmount();
		});
	}
	roots = [];
	resetSurfaces();
	document.body.replaceChildren();
});

/** The scene: two openers and two containers, which is all a surface needs to be. */
function Scene(): ReactElement {
	return createElement(
		'div',
		null,
		createElement('button', { 'data-opener': 'menu' }, 'Open menu'),
		createElement(
			'div',
			{ 'data-container': 'menu' },
			createElement('button', { 'data-inside': 'menu' }, 'Rename'),
		),
		createElement('button', { 'data-opener': 'dialog' }, 'Edit field'),
		createElement(
			'div',
			{ 'data-container': 'dialog' },
			createElement('button', { 'data-inside': 'dialog' }, 'Confirm'),
		),
	);
}

function mount(): void {
	const root = createRoot(document.body);
	roots.push(root);
	act(() => {
		root.render(createElement(Scene));
	});
}

function el(selector: string): HTMLElement {
	const found = document.body.querySelector<HTMLElement>(selector);
	if (found === null) {
		throw new Error(`the scene has no element for ${selector}`);
	}
	return found;
}

/** Focus an element the way a person does, and report what the document says afterwards. */
function focusOn(selector: string): void {
	act(() => {
		el(selector).focus();
	});
	expect(document.activeElement).toBe(el(selector));
}

const inside = (selector: string): boolean => el(selector).contains(document.activeElement);

describe('the focus contract', () => {
	it('a grid popover gives focus back to the cell it was opened from', () => {
		mount();
		focusOn('[data-opener="menu"]');
		const surface = openSurface(
			'grid-popover',
			el('[data-container="menu"]'),
			openerOf(document),
		);
		focusOn('[data-inside="menu"]');

		expect(closeSurface(surface)).toBe('restored');
		expect(document.activeElement).toBe(el('[data-opener="menu"]'));
	});

	it('a dialog that opens while a menu closes keeps focus inside itself', () => {
		mount();
		focusOn('[data-opener="menu"]');
		const menu = openSurface('menu', el('[data-container="menu"]'), openerOf(document));
		focusOn('[data-inside="menu"]');

		// The dialog opens on top: its opener is what was focused inside the menu, and focus moves into it.
		const dialog = openSurface('dialog', el('[data-container="dialog"]'), openerOf(document));
		focusOn('[data-inside="dialog"]');

		// The menu closes *behind* the dialog. Its container no longer holds focus, so it must not take it back.
		expect(closeSurface(menu)).toBe('kept');
		expect(inside('[data-container="dialog"]')).toBe(true);

		// And when the dialog itself closes, focus goes back to where the dialog was opened from.
		expect(closeSurface(dialog)).toBe('restored');
		expect(document.activeElement).toBe(el('[data-inside="menu"]'));
	});

	it('restores when focus has gone nowhere at all', () => {
		mount();
		focusOn('[data-opener="dialog"]');
		const surface = openSurface('dialog', el('[data-container="dialog"]'), openerOf(document));
		focusOn('[data-inside="dialog"]');

		act(() => {
			el('[data-inside="dialog"]').blur();
		});
		expect(document.activeElement).toBe(document.body);

		expect(closeSurface(surface)).toBe('restored');
		expect(document.activeElement).toBe(el('[data-opener="dialog"]'));
	});

	it('does not restore into a detached opener, and says so', () => {
		mount();
		focusOn('[data-opener="menu"]');
		const opener = el('[data-opener="menu"]');
		const surface = openSurface('menu', el('[data-container="menu"]'), openerOf(document));
		focusOn('[data-inside="menu"]');

		act(() => {
			opener.remove();
		});
		expect(opener.isConnected).toBe(false);
		// The gesture that removed the opener took focus with it: nothing in the document has the keyboard.
		act(() => {
			el('[data-inside="menu"]').blur();
		});
		expect(document.activeElement).toBe(document.body);

		expect(closeSurface(surface)).toBe('lost');
		expect(document.activeElement).toBe(document.body);
	});

	it('ignores a close it has already handled', () => {
		mount();
		focusOn('[data-opener="menu"]');
		const surface = openSurface('menu', el('[data-container="menu"]'), openerOf(document));
		focusOn('[data-inside="menu"]');
		expect(closeSurface(surface)).toBe('restored');
		// A host that closes a surface twice (Obsidian's own modals do, on unload) must not restore twice.
		expect(closeSurface(surface)).toBe('kept');
	});

	it('knows what is on top, so Escape can close one surface and not two', () => {
		mount();
		expect(hasOpenSurface()).toBe(false);
		expect(topSurface()).toBeNull();

		const menu = openSurface('menu', el('[data-container="menu"]'), null);
		const dialog = openSurface('dialog', el('[data-container="dialog"]'), null);
		expect(hasOpenSurface()).toBe(true);
		expect(topSurface()).toBe(dialog);

		closeSurface(dialog);
		expect(topSurface()).toBe(menu);
		closeSurface(menu);
		expect(topSurface()).toBeNull();
	});

	it('names an Escape owner for every kind of surface, and no kind twice', () => {
		const kinds: readonly SurfaceKind[] = SURFACE_KINDS;
		const owned = ESCAPE_OWNER.map((entry) => entry.surface);
		expect([...owned].sort()).toEqual([...kinds].sort());
		expect(new Set(owned).size).toBe(owned.length);
		for (const entry of ESCAPE_OWNER) {
			expect(entry.owner.length).toBeGreaterThan(20);
			expect(entry.effect.length).toBeGreaterThan(20);
		}
	});
});

/** Walks a stub tree, so "no prose" can be asserted as an absence of paragraphs anywhere in the surface. */
function stubsOf(stub: ElementStub): ElementStub[] {
	return [stub, ...stub.children.flatMap(stubsOf)];
}

describe('the help surface', () => {
	it('renders one row per binding from keyBindings.ts, and no prose', () => {
		const plugin = new Plugin();
		Reflect.apply(TablifyPlugin.prototype.onload, plugin, []);
		const command = plugin.commands.find((entry) => entry.id === 'open-keyboard-help');
		expect(command).toBeDefined();
		command?.callback();

		const modal = openedModals[0];
		expect(modal).toBeInstanceOf(KeyboardHelpModal);
		if (modal === undefined) {
			throw new Error('the command opened no modal');
		}
		expect(modal.titleEl.text).toBe('Tablify keyboard');

		const table = modal.contentEl.children[0];
		const body = table?.children[0];
		expect(table?.tag).toBe('table');
		expect(body?.tag).toBe('tbody');
		expect(body?.children.map((row) => row.children[0]?.text)).toEqual(
			KEY_BINDINGS.map((binding) => binding.keys),
		);
		expect(body?.children.map((row) => row.children[1]?.text)).toEqual(
			KEY_BINDINGS.map((binding) => binding.description),
		);
		// No paragraph, no blurb: the reference is the table (`docs/01` §the help surface).
		expect(stubsOf(modal.contentEl).filter((stub) => stub.tag === 'p')).toEqual([]);
		// A fresh plugin instance registers two commands, and the second one is the help surface's door.
		Reflect.apply(TablifyPlugin.prototype.onunload, plugin, []);
	});

	it('gives focus back to whatever opened it, when focus was lost meanwhile', () => {
		const plugin = new Plugin();
		Reflect.apply(TablifyPlugin.prototype.onload, plugin, []);
		mount();
		focusOn('[data-opener="menu"]');

		const before = openedModals.length;
		plugin.commands.find((entry) => entry.id === 'open-keyboard-help')?.callback();
		const modal = openedModals[before];
		expect(modal).toBeDefined();

		// What the host does on close: the modal's node goes away and focus falls to the document. The
		// contract's job is only the last step — put it back where the person was.
		act(() => {
			el('[data-opener="menu"]').blur();
		});
		expect(document.activeElement).toBe(document.body);

		act(() => {
			modal?.close();
		});
		expect(document.activeElement).toBe(el('[data-opener="menu"]'));
	});

	it('leaves focus alone when something newer has it', () => {
		const plugin = new Plugin();
		Reflect.apply(TablifyPlugin.prototype.onload, plugin, []);
		mount();
		focusOn('[data-opener="menu"]');

		const before = openedModals.length;
		plugin.commands.find((entry) => entry.id === 'open-keyboard-help')?.callback();
		const modal = openedModals[before];

		// A newer surface (the scene's dialog) has the keyboard: closing the help must not steal it back.
		focusOn('[data-inside="dialog"]');
		act(() => {
			modal?.close();
		});
		expect(document.activeElement).toBe(el('[data-inside="dialog"]'));
	});
});
