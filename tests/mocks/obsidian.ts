/**
 * Runtime double for the `obsidian` package.
 *
 * The published package is types-only — its `main` field is an empty string — so nothing can import it
 * at runtime. Vitest resolves `obsidian` to this file (see `vitest.config.ts`), while TypeScript keeps
 * using the real `obsidian.d.ts` for every type. That split is the whole design: plugin code is written
 * and type-checked against the real API, and tests talk to this double.
 *
 * Two rules keep the double honest:
 *   - Every addition must be justified by a test that needs it; never widen it "just in case".
 *   - `Setting` is deliberately absent. If product code constructs one, the test fails loudly instead
 *     of silently rendering nothing.
 *
 * It is DOM-free on purpose: element stubs are plain objects, so the same double works in the `unit`
 * (node) and `dom` (jsdom) projects, and nothing here needs a real browser.
 */

/** Every `new Notice(message)` in a test run, in order. */
export const noticeLog: string[] = [];

export class Notice {
	readonly message: string;

	constructor(message: string) {
		this.message = message;
		noticeLog.push(message);
	}
}

/** A stand-in for an element: enough of the Obsidian DOM augmentation to assert on. */
export type ElementStub = {
	tag: string;
	text: string;
	classes: string[];
	children: ElementStub[];
	emptied: number;
	createEl(tag: string, options?: { cls?: string; text?: string }): ElementStub;
	createDiv(options?: { cls?: string; text?: string }): ElementStub;
	addClass(...classes: string[]): void;
	setText(text: string): void;
	empty(): void;
};

function buildChild(tag: string, options?: { cls?: string; text?: string }): ElementStub {
	const child = elementStub(tag);
	child.text = options?.text ?? '';
	if (options?.cls !== undefined) {
		child.classes.push(options.cls);
	}
	return child;
}

export function elementStub(tag = 'div'): ElementStub {
	const el: ElementStub = {
		tag,
		text: '',
		classes: [],
		children: [],
		emptied: 0,
		createEl(childTag, options) {
			const child = buildChild(childTag, options);
			el.children.push(child);
			return child;
		},
		createDiv(options) {
			const child = buildChild('div', options);
			el.children.push(child);
			return child;
		},
		addClass(...classes) {
			el.classes.push(...classes);
		},
		setText(text) {
			el.text = text;
		},
		empty() {
			el.emptied += 1;
			el.children.length = 0;
			el.text = '';
		},
	};
	return el;
}

/** The shape a registration must have for the double to accept it. */
export type ViewFactory = (
	controller: unknown,
	containerEl: ElementStub,
) => { containerEl: ElementStub; type: string; onDataUpdated(): void };

export type ViewRegistration = {
	name: string;
	icon: string;
	factory: ViewFactory;
	options?: (config: unknown) => unknown[];
};

/**
 * The double for `BasesViewConfig` (obsidian.d.ts @1.10.0). It stores what a test sets and answers the
 * readers the plugin uses: `get`, `getOrder`, `getSort`, `getDisplayName` and `set`. A view's own
 * settings travel in the `.base` file through `set`, so the double has to keep them.
 */
export type BasesViewConfigStub = {
	readonly values: Map<string, unknown>;
	get(key: string): unknown;
	getAsPropertyId(key: string): string | null;
	getOrder(): string[];
	getSort(): { property: string; direction: string }[];
	getDisplayName(propertyId: string): string;
	set(key: string, value: unknown): void;
};

export function createConfigStub(order: string[] = []): BasesViewConfigStub {
	const values = new Map<string, unknown>();
	return {
		values,
		get: (key) => values.get(key),
		getAsPropertyId: (key) =>
			typeof values.get(key) === 'string' ? String(values.get(key)) : null,
		// `config.getOrder()` is the config's own column list; a test sets it when it wants columns.
		getOrder: () => order,
		getSort: () => [],
		// `getDisplayName` always answers in the real API; the double says "no rename" with the bare name.
		getDisplayName: (propertyId) =>
			propertyId.includes('.') ? propertyId.slice(propertyId.indexOf('.') + 1) : propertyId,
		set: (key, value) => {
			values.set(key, value);
		},
	};
}

export class BasesView {
	readonly type = '';
	containerEl: ElementStub = elementStub();
	/**
	 * `BasesView.app` (obsidian.d.ts @1.10.0). Only the members plugin code touches while constructing a
	 * view: the metadata cache. It has no `on` method here, which is what the view's own
	 * `typeof … === 'function'` guard exists for — the real app always has one, a double need not.
	 */
	app: { readonly metadataCache: Record<string, unknown> } = { metadataCache: {} };
	/** `BasesView.config` (@1.10.0). */
	config: BasesViewConfigStub = createConfigStub();
	/** `BasesView.data` (@1.10.0) — replaced wholesale by Obsidian, exactly as this double is. */
	data: { readonly data: unknown[]; readonly properties: string[] } = {
		data: [],
		properties: [],
	};
	/** `BasesView.allProperties` (@1.10.0). */
	allProperties: string[] = [];

	onDataUpdated(): void {
		// The view renders here; the double records nothing because tests assert on the container.
	}
}

export class Modal {
	readonly titleEl = elementStub('h2');
	readonly contentEl = elementStub('div');

	constructor(_app?: unknown) {
		// Real signature: Modal(app: App). The double accepts anything.
	}

	open(): void {
		openedModals.push(this);
	}

	close(): void {
		const index = openedModals.indexOf(this);
		if (index >= 0) {
			openedModals.splice(index, 1);
		}
	}
}

/** Every modal opened and not yet closed, in order. */
export const openedModals: Modal[] = [];

/** Every `new Setting(...)` in a test run, in order. */
export const createdSettings: Setting[] = [];

/**
 * A setting row. `addText`, `addToggle`, `addDropdown` and `addButton` are deliberately absent: this
 * milestone must not offer anything to configure, and a call to a method that does not exist throws
 * instead of silently rendering nothing.
 */
export class Setting {
	readonly containerEl: ElementStub;
	settingName = '';
	isHeading = false;
	description = '';

	constructor(containerEl: ElementStub) {
		this.containerEl = containerEl;
		createdSettings.push(this);
	}

	setName(name: string): this {
		this.settingName = name;
		return this;
	}

	setHeading(): this {
		this.isHeading = true;
		return this;
	}

	setDesc(desc: string): this {
		this.description = desc;
		return this;
	}
}

export class PluginSettingTab {
	readonly containerEl: ElementStub = elementStub();

	constructor(_app?: unknown, _plugin?: unknown) {
		// Real signature: PluginSettingTab(app: App, plugin: Plugin).
	}

	/** Subclasses render here; a tab that does not override it renders nothing. */
	display(): void {
		this.containerEl.empty();
	}
}

export class Plugin {
	manifest: { version: string } = { version: '0.0.0' };
	app: unknown = {};
	readonly commands: { id: string; name: string; callback: () => void }[] = [];
	readonly statusBarItems: ElementStub[] = [];
	readonly settingTabs: PluginSettingTab[] = [];
	readonly registeredViews: { id: string; registration: ViewRegistration }[] = [];
	/**
	 * `Component.register(callback)` (obsidian.d.ts @0.9.7): a teardown the plugin hands to Obsidian. The
	 * real app calls these on unload, so the double does too — a test may then assert that what a factory
	 * registered is not left running, which is the whole reason the factory registers anything.
	 */
	readonly cleanups: (() => void)[] = [];

	register(callback: () => void): void {
		this.cleanups.push(callback);
	}

	addCommand(command: { id: string; name: string; callback: () => void }): {
		id: string;
		name: string;
		callback: () => void;
	} {
		this.commands.push(command);
		return command;
	}

	addStatusBarItem(): ElementStub {
		const item = elementStub('div');
		this.statusBarItems.push(item);
		return item;
	}

	addSettingTab(tab: PluginSettingTab): void {
		this.settingTabs.push(tab);
	}

	registerBasesView(viewId: string, registration: ViewRegistration): boolean {
		this.registeredViews.push({ id: viewId, registration });
		return true;
	}

	/**
	 * Obsidian detaches everything a plugin registered when it unloads. The double does the same, so a
	 * test can assert that nothing survives `onunload()` — otherwise that assertion would be vacuous.
	 */
	onunload(): void {
		// Obsidian runs what the plugin registered, then drops it. In that order, so a teardown that reads
		// something the plugin owns still sees it.
		for (const cleanup of this.cleanups.splice(0, this.cleanups.length)) {
			cleanup();
		}
		this.commands.length = 0;
		this.statusBarItems.length = 0;
		this.settingTabs.length = 0;
		this.registeredViews.length = 0;
	}
}
