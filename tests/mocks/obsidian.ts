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

	/**
	 * `Modal.onOpen()` / `Modal.onClose()` (obsidian.d.ts, @since 0.9.16) are virtual, and the real `open()` and
	 * `close()` call them. The double has to do the same or a subclass's rendering — the keyboard help surface is
	 * a loop over `KEY_BINDINGS` in `onOpen` — would never run in a test, and "the modal opened" would be the only
	 * thing anyone could assert.
	 */
	onOpen(): void {}

	onClose(): void {}

	open(): void {
		openedModals.push(this);
		this.onOpen();
	}

	close(): void {
		const index = openedModals.indexOf(this);
		if (index >= 0) {
			openedModals.splice(index, 1);
		}
		this.onClose();
	}
}

/** Every modal opened and not yet closed, in order. */
export const openedModals: Modal[] = [];

/** Every `new Setting(...)` in a test run, in order. */
export const createdSettings: Setting[] = [];

/** The components a declarative setting render callback can ask for. */
export type ToggleStub = {
	value: boolean;
	setValue(value: boolean): ToggleStub;
	onChange(callback: (value: boolean) => void): ToggleStub;
	/** Fires the callback as a click would, so a test drives the real change path. */
	click(value: boolean): void;
};

/**
 * A setting row. `addToggle` exists because the flags row draws one switch per experimental flag; nothing
 * else is implemented, so a call to a control this milestone does not use throws instead of rendering
 * nothing silently.
 */
export class Setting {
	readonly containerEl: ElementStub;
	/** Where a control is placed. The versions row writes its read-only text here. */
	readonly controlEl: ElementStub = elementStub();
	settingName = '';
	isHeading = false;
	description = '';
	readonly toggles: ToggleStub[] = [];

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

	addToggle(configure: (toggle: ToggleStub) => unknown): this {
		let onChange: ((value: boolean) => void) | null = null;
		const toggle: ToggleStub = {
			value: false,
			setValue(value) {
				toggle.value = value;
				return toggle;
			},
			onChange(callback) {
				onChange = callback;
				return toggle;
			},
			click(value) {
				toggle.value = value;
				onChange?.(value);
			},
		};
		configure(toggle);
		this.toggles.push(toggle);
		return this;
	}
}

/**
 * The runtime half of `SettingGroup`. The real class is concrete (its constructor takes the container), and a
 * `render` callback receives one — so a test that calls a `render` built by `settings/tab.ts` needs a value
 * of that shape. `listEl` is a real jsdom element in the `dom` project, and the four builder methods return
 * `this`, exactly like the class they stand in for.
 */
export class SettingGroup {
	listEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		this.listEl = containerEl;
	}

	setHeading(_text: string | DocumentFragment): this {
		return this;
	}

	addClass(..._classes: string[]): this {
		return this;
	}

	addSetting(_cb: (setting: Setting) => void): this {
		return this;
	}

	addSearch(_cb: (component: unknown) => unknown): this {
		return this;
	}

	addExtraButton(_cb: (component: unknown) => unknown): this {
		return this;
	}
}

/**
 * The runtime half of `PluginSettingTab`. Obsidian 1.13 renders a tab declaratively from
 * `getSettingDefinitions()`, so the double holds the definitions the same way and lets a test drive a control
 * through `getControlValue`/`setControlValue` — the two hooks the real app calls.
 */
export class PluginSettingTab {
	readonly containerEl: ElementStub = elementStub();
	icon = '';
	/** How many times `update()` was called: the app re-renders through it after a load. */
	updates = 0;
	refreshes = 0;

	constructor(_app?: unknown, _plugin?: unknown) {
		// Real signature: PluginSettingTab(app: App, plugin: Plugin).
	}

	/** Deprecated in 1.13.0 (`obsidian.d.ts`): the declarative path does not call it. */
	display(): void {
		this.containerEl.empty();
	}

	getSettingDefinitions(): unknown[] {
		return [];
	}

	getControlValue(_key: string): unknown {
		return undefined;
	}

	setControlValue(_key: string, _value: unknown): void {
		// The double records nothing: a subclass override is what a test asserts on.
	}

	refreshDomState(): void {
		this.refreshes += 1;
	}

	update(): void {
		this.updates += 1;
	}
}

export class Plugin {
	manifest: { version: string; minAppVersion: string } = {
		version: '0.0.0',
		minAppVersion: '1.13.0',
	};
	/**
	 * The app, as far as this plugin touches it: the vault's markdown file list (Diagnostics counts notes)
	 * and nothing else. `loadData`/`saveData` below stand in for `data.json`.
	 */
	app: unknown = { vault: { getMarkdownFiles: (): unknown[] => [] } };
	/** What `saveData` was last given, and how many times it was called. */
	savedData: unknown = null;
	saveCount = 0;
	/** What `loadData` will return. `null` is what a fresh install has. */
	loadedData: unknown = null;
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

	loadData(): Promise<unknown> {
		return Promise.resolve(this.loadedData);
	}

	saveData(data: unknown): Promise<void> {
		this.savedData = data;
		this.saveCount += 1;
		return Promise.resolve();
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

/**
 * The double for `Menu` / `MenuItem` (obsidian.d.ts, `Menu` @since 0.15.3, `MenuItem` 0.15.0–0.16.2).
 *
 * It keeps the *items a menu was built with*, in order, with their labels, icons, check state, disabled state and
 * warning flag — which is exactly what `tests/dom/menus.test.tsx` asserts: the menu inventory, item by item.
 * `showAtMouseEvent`/`showAtPosition`/`hide`/`close`/`onHide` are recorded rather than drawn, because a menu's
 * appearance is Obsidian's business and this plugin may not reinvent it.
 *
 * `onClick` fires the callback the way the real item's click does, so a test can drive "the user chose Delete
 * rows" through the real code path.
 */
export type MenuItemStub = {
	title: string;
	icon: string | null;
	checked: boolean | null;
	disabled: boolean;
	warning: boolean;
	section: string | null;
	/** Fires the item's own `onClick`, and answers whether it was allowed to. */
	click(): boolean;
};

export type MenuStub = {
	readonly items: MenuItemStub[];
	/** `Menu.addSeparator()` — separators are recorded as `null` slots between items. */
	readonly separators: number[];
	shownAt: { x: number; y: number } | null;
	hidden: number;
	readonly callbacks: (() => void)[];
};

/** Every menu shown in a test run, in order. Cleared by `resetMenus()`. */
export const openedMenus: MenuStub[] = [];

export function resetMenus(): void {
	openedMenus.length = 0;
}

export class MenuItem {
	private readonly item: MenuItemStub;
	private readonly handler: { current: (() => void) | null } = { current: null };

	constructor(item: MenuItemStub) {
		this.item = item;
	}

	setTitle(title: string | DocumentFragment): this {
		this.item.title = typeof title === 'string' ? title : (title.textContent ?? '');
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

	setWarning(warning: boolean): this {
		this.item.warning = warning;
		return this;
	}

	setIsLabel(isLabel: boolean): this {
		this.item.section = isLabel ? 'label' : this.item.section;
		return this;
	}

	setSection(section: string): this {
		this.item.section = section;
		return this;
	}

	onClick(callback: () => void): this {
		this.handler.current = callback;
		this.item.click = () => {
			// The real `MenuItem` does nothing when it is disabled; the double is the same, because a test that
			// fires a disabled item proves less than the menu inventory it is trying to check.
			if (this.item.disabled) {
				return false;
			}
			callback();
			return true;
		};
		return this;
	}
}

export class Menu {
	readonly stub: MenuStub = {
		items: [],
		separators: [],
		shownAt: null,
		hidden: 0,
		callbacks: [],
	};

	constructor() {
		openedMenus.push(this.stub);
	}

	addItem(callback: (item: MenuItem) => unknown): this {
		const item: MenuItemStub = {
			title: '',
			icon: null,
			checked: null,
			disabled: false,
			warning: false,
			section: null,
			click: () => false,
		};
		this.stub.items.push(item);
		callback(new MenuItem(item));
		return this;
	}

	addSeparator(): this {
		this.stub.separators.push(this.stub.items.length);
		return this;
	}

	setNoIcon(): this {
		return this;
	}

	showAtMouseEvent(event: MouseEvent): this {
		this.stub.shownAt = { x: event.clientX, y: event.clientY };
		return this;
	}

	showAtPosition(position: { x: number; y: number }): this {
		this.stub.shownAt = { x: position.x, y: position.y };
		return this;
	}

	hide(): this {
		this.stub.hidden += 1;
		return this;
	}

	close(): void {
		this.hide();
	}

	onHide(callback: () => void): void {
		this.stub.callbacks.push(callback);
	}
}
