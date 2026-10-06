/**
 * The `obsidian` module, at runtime, for the harness.
 *
 * The published package is **types only** — its `main` field is an empty string — so a browser bundle that
 * imports `obsidian` (which `src/grid/menus/**` and `src/grid/dialogs/**` legitimately do) has nothing to resolve.
 * Every test project already solves this the same way (`tests/mocks/obsidian.ts`, aliased in `vitest.config.ts`);
 * this file is that alias for the harness bundle, and `esbuild` is pointed at it in `harness/build.mjs`.
 *
 * **What it is not.** It is not a reimplementation of anything of ours: it is the *host platform*, which does not
 * exist in a plain browser page. The harness's job is to render the plugin's own components with the plugin's own
 * stylesheet (`docs/07` §Tier 4), and the thirteen assertions never look at Obsidian's chrome — so the menu and
 * modal classes here record what they were asked to do and touch no DOM. That is also why they are *deliberately*
 * minimal: a stub that grew a poor imitation of Obsidian's menu would be a second implementation to keep in step,
 * which is the failure the prompt's own constraint ("a fixture that reimplements a component invalidates the whole
 * gate") is about.
 *
 * `Notice` is real enough to be useful in a page (`window.__harness.notices` collects the messages), and
 * `Platform` answers "not mobile", because the harness renders the desktop shell unless a fixture says otherwise.
 */

/** Every `new Notice(message)` in the page, in order — for a spec that wants to assert a message was raised. */
const notices: string[] = [];

export class Notice {
	readonly message: string;

	constructor(message: string) {
		this.message = message;
		notices.push(message);
	}
}

export function noticeLog(): readonly string[] {
	return notices;
}

/**
 * Obsidian's DOM augmentations, in the two shapes the dialogs use (`Element.createDiv` / `createEl`), implemented
 * on the real DOM. Unlike the test double these are *real* elements: a dialog opened in a page has to be a real
 * element for the focus contract to have anything to record.
 */
type DomInfo = {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string | number | boolean | null>;
	title?: string;
	type?: string;
	value?: string;
	placeholder?: string;
};

function apply(host: Element, child: HTMLElement, info?: DomInfo): void {
	if (info?.cls !== undefined) {
		child.className = Array.isArray(info.cls) ? info.cls.join(' ') : info.cls;
	}
	if (info?.text !== undefined) {
		child.textContent = info.text;
	}
	if (info?.title !== undefined) {
		child.title = info.title;
	}
	if (info?.type !== undefined) {
		child.setAttribute('type', info.type);
	}
	if (info?.value !== undefined) {
		child.setAttribute('value', info.value);
	}
	if (info?.placeholder !== undefined) {
		child.setAttribute('placeholder', info.placeholder);
	}
	for (const [key, value] of Object.entries(info?.attr ?? {})) {
		if (value !== null) {
			child.setAttribute(key, String(value));
		}
	}
	host.append(child);
}

/**
 * Installs the helpers the dialogs call, on the real prototype. No `declare global` here: Obsidian's own
 * `obsidian.d.ts` already augments `Element` for the whole program (that is why `contentEl.createDiv()` type-checks
 * in `src/grid/dialogs/**`), and a second, slightly different declaration would be a second source of truth.
 *
 * **`setText`, `addClass`, `removeClass` and `toggleClass` are step 27's addition**, and they are the reason this
 * function is worth a paragraph: without them the harness page threw on the *first* dialog it opened
 * (`this.titleEl.setText is not a function`, from `Modal.onOpen`) and every dialog-shaped assertion in the suite
 * measured an empty `contentEl`. The helpers existed for `createEl`/`createDiv`/`createSpan`/`empty` only, because
 * those are what the *grid* calls; the dialogs — a later step — call four more, and nothing had run them in a
 * browser to find out. A harness shim is a port like any other: it has to be complete before it is believable.
 */
function installDomHelpers(): void {
	if ('createDiv' in Element.prototype) {
		return;
	}
	Object.defineProperty(Element.prototype, 'createDiv', {
		value(this: Element, info?: DomInfo): HTMLDivElement {
			const child = this.ownerDocument.createElement('div');
			apply(this, child, info);
			return child;
		},
	});
	Object.defineProperty(Element.prototype, 'createSpan', {
		value(this: Element, info?: DomInfo): HTMLSpanElement {
			const child = this.ownerDocument.createElement('span');
			apply(this, child, info);
			return child;
		},
	});
	Object.defineProperty(Element.prototype, 'createEl', {
		value(this: Element, tag: string, info?: DomInfo): HTMLElement {
			const child = this.ownerDocument.createElement(tag);
			apply(this, child, info);
			return child;
		},
	});
	Object.defineProperty(Element.prototype, 'empty', {
		value(this: Element): void {
			this.replaceChildren();
		},
	});
	Object.defineProperty(Element.prototype, 'setText', {
		value(this: Element, text: string): Element {
			this.textContent = text;
			return this;
		},
	});
	Object.defineProperty(Element.prototype, 'addClass', {
		value(this: Element, ...classes: string[]): void {
			this.classList.add(...classes);
		},
	});
	Object.defineProperty(Element.prototype, 'removeClass', {
		value(this: Element, ...classes: string[]): void {
			this.classList.remove(...classes);
		},
	});
	/*
	 * `instanceOf` is Obsidian's cross-window-safe `instanceof` (`node.instanceOf(HTMLElement, win?)`), and the
	 * harness calls it in two places that matter: `dialogChoose` (to find the button it is about to click) and the
	 * harness's own `MutationObserver` (to count what a commit changed). Without it the observer threw on every
	 * mutation batch — so `renderCounts()` was reporting zeroes and every render-count assertion was vacuous —
	 * and `dialogChoose` threw the moment a dialog was open. Found by running the suite in step 27; the helpers
	 * existed for the *grid's* DOM calls only.
	 */
	/*
	 * `instanceOf` is answered by **walking the prototype chain**, not by an `instanceof` — and that is not a
	 * stylistic choice. `obsidianmd/prefer-instanceof` forbids the operator here for the reason the rule exists
	 * everywhere else (a cross-realm `instanceof` is a category error), and this function *is* the polyfill that
	 * operator would call, so using it would recurse. The walk does exactly what `instanceof` does for an ordinary
	 * constructor, in the element's own realm, and it is what makes `element.instanceOf(SomeClass)` — Obsidian's
	 * own cross-window-safe idiom, which the grid uses — behave inside the harness.
	 *
	 * The scope is the element's own window (`ownerDocument.defaultView`) falling back to `window`, which is the
	 * page: this file only ever runs in the harness page. No `globalThis` and no suppression comment, because the
	 * repo bans both kinds of shortcut and a stand-in that needs an exemption is not standing in for anything.
	 */
	Object.defineProperty(Element.prototype, 'instanceOf', {
		value(this: Element, type: { readonly name: string }, win?: Window): boolean {
			const scope: unknown =
				win ??
				this.ownerDocument.defaultView ??
				(typeof window === 'undefined' ? null : window);
			const descriptor =
				typeof scope === 'object' && scope !== null
					? Object.getOwnPropertyDescriptor(scope, type.name)
					: undefined;
			const candidate: unknown = descriptor?.value;
			if (typeof candidate !== 'function') {
				// No constructor of that name in the scope: the reference is a lie, and a lie is not an instance.
				return false;
			}
			const target: unknown = Object.getOwnPropertyDescriptor(candidate, 'prototype')?.value;
			if (typeof target !== 'object' || target === null) {
				return false;
			}
			let node: unknown = Object.getPrototypeOf(this);
			while (node !== null) {
				if (node === target) {
					return true;
				}
				node = Object.getPrototypeOf(node);
			}
			return false;
		},
	});
	Object.defineProperty(Element.prototype, 'toggleClass', {
		value(this: Element, classes: string | string[], value: boolean): void {
			for (const name of Array.isArray(classes) ? classes : [classes]) {
				this.classList.toggle(name, value);
			}
		},
	});
}

installDomHelpers();

/** The menu items a page opened, as `{ title, disabled }` — enough for a spec that wants to see one was built. */
export type StubMenuItem = {
	title: string;
	disabled: boolean;
	checked: boolean | null;
	icon: string | null;
};

export class MenuItem {
	private readonly item: StubMenuItem = { title: '', disabled: false, checked: null, icon: null };
	/** The click handler, under a name that is not the method's: a class cannot have both (`setTitle`'s pattern). */
	private handler: (() => void) | null = null;

	setTitle(title: string): this {
		this.item.title = title;
		return this;
	}

	setIcon(icon: string | null): this {
		this.item.icon = icon;
		return this;
	}

	setChecked(checked: boolean | null): this {
		this.item.checked = checked;
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.item.disabled = disabled;
		return this;
	}

	setWarning(): this {
		return this;
	}

	setIsLabel(): this {
		return this;
	}

	setSection(): this {
		return this;
	}

	onClick(callback: () => void): this {
		this.handler = callback;
		return this;
	}

	/** Presses the item. `false` when it is disabled — the real menu does nothing then, too. */
	press(): boolean {
		if (this.item.disabled) {
			return false;
		}
		this.handler?.();
		return true;
	}

	snapshot(): StubMenuItem {
		return { ...this.item };
	}
}

export class Menu {
	readonly items: MenuItem[] = [];

	constructor() {
		openedMenus.push(this);
	}

	addItem(callback: (item: MenuItem) => unknown): this {
		const item = new MenuItem();
		this.items.push(item);
		callback(item);
		return this;
	}

	addSeparator(): this {
		return this;
	}

	setNoIcon(): this {
		return this;
	}

	showAtMouseEvent(): this {
		return this;
	}

	showAtPosition(): this {
		return this;
	}

	hide(): this {
		return this;
	}

	close(): void {
		// Nothing to close: the stub never drew anything.
	}

	onHide(): void {
		// Likewise.
	}

	/** The titles of the items built, in order — what a spec asserts against. */
	titles(): readonly string[] {
		return this.items.map((item) => item.snapshot().title);
	}
}

/** Every menu built in the page, in order. */
export const openedMenus: Menu[] = [];

/**
 * `Modal`, real enough to be opened and measured: it appends an overlay with the classes Obsidian uses
 * (`modal-container` / `modal` / `modal-close-button`), so a dialog's own `contentEl` really is in the document
 * and the focus contract has something to restore.
 */
export class Modal {
	readonly containerEl: HTMLDivElement;
	readonly modalEl: HTMLDivElement;
	readonly titleEl: HTMLDivElement;
	readonly contentEl: HTMLDivElement;
	private readonly doc: Document;
	private overlay: HTMLElement | null = null;

	constructor(_app?: unknown) {
		this.doc = document;
		this.containerEl = this.doc.createElement('div');
		this.containerEl.className = 'modal-container';
		this.modalEl = this.doc.createElement('div');
		this.modalEl.className = 'modal';
		this.modalEl.setAttribute('tabindex', '-1');
		this.titleEl = this.doc.createElement('div');
		this.titleEl.className = 'modal-title';
		this.contentEl = this.doc.createElement('div');
		this.contentEl.className = 'modal-content';
		this.modalEl.append(this.titleEl, this.contentEl);
		this.containerEl.append(this.modalEl);
	}

	onOpen(): void {
		// Subclasses render.
	}

	onClose(): void {
		// Subclasses clean up.
	}

	/**
	 * Escape closes the topmost modal.
	 *
	 * This is the **host's** behaviour, not a plugin's: `src/grid/a11y/focusContract.ts` describes what a real
	 * Obsidian gives every modal — *"a focus trap, Escape and a restore of their own"* — and
	 * `src/grid/dialogs/BulkEditDialog.ts` leans on it in a comment (*"the modal's own Escape still closes"*).
	 * The stand-in had neither the trap nor Escape, and step 27 found it the hard way: tier-4 assertion 22 pressed
	 * Escape to dismiss the View options dialog and then clicked the toolbar, and Playwright waited 90 s for a
	 * click that a still-open `.modal-container` was intercepting. The suite was right and the shim was wrong.
	 *
	 * Only the top of the stack answers, so a dialog opened from a dialog closes first — and an event a surface has
	 * already handled (`defaultPrevented`, e.g. an editor cancelling its own edit) is left alone, which is the same
	 * precedence Obsidian's scopes give a focused surface.
	 */
	private readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape' || event.defaultPrevented) {
			return;
		}
		if (openedModals[openedModals.length - 1] !== this) {
			return;
		}
		this.close();
	};

	open(): void {
		this.doc.body.append(this.containerEl);
		this.overlay = this.containerEl;
		openedModals.push(this);
		this.doc.addEventListener('keydown', this.onDocumentKeyDown);
		this.onOpen();
	}

	close(): void {
		this.doc.removeEventListener('keydown', this.onDocumentKeyDown);
		this.overlay?.remove();
		this.overlay = null;
		const at = openedModals.indexOf(this);
		if (at >= 0) {
			openedModals.splice(at, 1);
		}
		this.onClose();
	}

	/** Kept for API parity with the real class; the harness has no keyboard-inset observer. */
	setTitle(title: string): this {
		this.titleEl.textContent = title;
		return this;
	}
}

/** Every open modal, in order — the same bookkeeping the real `Modal` leaves to the app. */
export const openedModals: Modal[] = [];

export class Component {
	onload(): void {
		// Nothing to load.
	}

	onunload(): void {
		// Nothing to unload.
	}

	register(): void {
		// Components own their own children in Obsidian; the harness has none.
	}
}

/** The app the dialogs are handed. Only what they touch: nothing — they are built with `document`. */
export const app = {
	vault: {},
	metadataCache: {},
	fileManager: {},
};

export const Platform = { isMobile: false, isDesktop: true, isMobileApp: false };
