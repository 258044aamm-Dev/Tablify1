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

export function elementStub(tag = 'div'): ElementStub {
	const el: ElementStub = {
		tag,
		text: '',
		classes: [],
		children: [],
		emptied: 0,
		createEl(childTag, options) {
			const child = elementStub(childTag);
			child.text = options?.text ?? '';
			if (options?.cls !== undefined) {
				child.classes.push(options.cls);
			}
			el.children.push(child);
			return child;
		},
		createDiv(options) {
			return el.createEl('div', options);
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

export class BasesView {
	readonly type = '';
	containerEl: ElementStub = elementStub();

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
		this.commands.length = 0;
		this.statusBarItems.length = 0;
		this.settingTabs.length = 0;
		this.registeredViews.length = 0;
	}
}
