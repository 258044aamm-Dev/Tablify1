/**
 * The settings tab's logic, with no Obsidian in it.
 *
 * Obsidian 1.13 renders a settings tab **declaratively**: `PluginSettingTab.getSettingDefinitions()` returns
 * rows and the app draws them. That means the tab's render code is this file — one array — and it can be
 * asserted without a browser, which is why the rows are built here and the class in
 * `TablifySettingTab.ts` is a three-method delegation.
 *
 * (`Setting().addToggle()…` also exists and is not used: `minAppVersion` is 1.13.0, so the declarative path
 * is always available, and maintaining a second imperative renderer for the same rows would double the work
 * of adding a setting — the exact thing the schema exists to prevent.)
 *
 * Row order is the schema's order, grouped into the schema's sections, and **every** row comes from the
 * schema: no name, description or control is written by hand below, and a test asserts one definition per
 * schema row, so a new setting cannot ship without appearing in the tab.
 */
import {
	SETTINGS_SECTIONS,
	SETTING_ROWS,
	SETTING_ROWS_WITHOUT_VALUE,
	readPath,
	settingRowFor,
} from './schema';
import type { SettingRow, SettingRowWithoutValue, TablifySettings } from './schema';
import type { SettingsWarning } from './load';
import type { SettingDefinition, SettingDefinitionGroup, SettingDefinitionItem } from 'obsidian';

/**
 * What this file's `render` callbacks need from a `Setting`: a place to put a read-only line, and a way to
 * add a switch. Declaring the narrow surface (rather than importing the whole class) keeps the callbacks
 * honest about what they touch — and it is what makes them drivable from a test, because a value of this
 * shape can be built without a browser or an assertion.
 */
/** The two calls the flags row makes on one switch. The real `ToggleComponent` satisfies both. */
export type ToggleSurface = {
	setValue(value: boolean): ToggleSurface;
	onChange(callback: (value: boolean) => void): ToggleSurface;
};

export type SettingSurface = {
	readonly controlEl: { setText(text: string): void };
	addToggle(configure: (toggle: ToggleSurface) => unknown): unknown;
};

/** What the tab reads and writes. Every member is a port, so a test passes a plain object. */
export type TabBindings = {
	/** The current settings. Read on every render, never cached: a row's `visible` depends on them. */
	readonly settings: () => TablifySettings;
	/** A setting's default, by path. The control's fallback while a value is being coerced. */
	readonly defaultValue: (path: string) => unknown;
	/** Writes one setting. Returns false when the value is refused. */
	readonly write: (path: string, value: unknown) => boolean;
	/** Re-evaluates the `visible` predicates in place. Call after a write, never a full re-render. */
	readonly refresh: () => void;
	/** Copies text to the clipboard. Rejects when it fails; the caller turns that into a Notice. */
	readonly copy: (text: string) => Promise<void>;
	readonly notify: (message: string) => void;
	/** The read-only versions line. */
	readonly versions: () => string;
	/** The Diagnostics blob, built on demand — it reads the vault's note count. */
	readonly diagnostics: () => string;
};

/**
 * Applies a change to one control, the way the app's declarative renderer does: write, then re-evaluate the
 * predicates that depend on the value. Split out of the class so the debounced save can be asserted with the
 * fake clock.
 */
export function applyControlChange(bindings: TabBindings, key: string, value: unknown): boolean {
	const row = settingRowFor(key);
	if (row === null) {
		return false;
	}
	const accepted = bindings.write(row.path, value);
	if (accepted) {
		bindings.refresh();
	}
	return accepted;
}

/** The Diagnostics row's action: copy, then say so — or say why not. Never throws. */
export async function runDiagnostics(bindings: TabBindings): Promise<void> {
	try {
		await bindings.copy(bindings.diagnostics());
		bindings.notify('Tablify: diagnostics copied to the clipboard.');
	} catch {
		// A refused clipboard (a permission prompt, a sandboxed window) is a message, not a crash.
		bindings.notify(
			'Tablify: could not copy to the clipboard. Your system may be blocking it.',
		);
	}
}

/** The read-only text the versions row shows. */
export function versionsLine(input: {
	readonly pluginVersion: string;
	readonly minAppVersion: string;
}): string {
	return `Tablify ${input.pluginVersion} · Obsidian ${input.minAppVersion} or newer`;
}

/** True when a row should be rendered at all. Hidden, never disabled (`prompts/step-14` item 4). */
function isVisible(row: SettingRow | SettingRowWithoutValue, settings: TablifySettings): boolean {
	return row.visibleWhen === undefined ? true : row.visibleWhen(settings);
}

/** A default, narrowed to the type its control stores. No assertion: the shape is checked at runtime. */
function defaultFor(
	row: SettingRow,
	bindings: TabBindings,
	kind: 'boolean' | 'string' | 'number',
): unknown {
	const value = bindings.defaultValue(row.path);
	if (kind === 'boolean') {
		return typeof value === 'boolean' ? value : false;
	}
	if (kind === 'number') {
		return typeof value === 'number' ? value : 0;
	}
	return typeof value === 'string' ? value : '';
}

/**
 * One schema row, as a setting definition. The four value-bearing controls map one-to-one onto the API's
 * controls. `flags` is the one that needs a render function, because the number of switches is known only
 * from the value — a flag added by a later version appears in the tab without a change here.
 */
function definitionFor(row: SettingRow, bindings: TabBindings): SettingDefinition {
	const base = {
		name: row.name,
		desc: row.desc,
		aliases: [...row.aliases],
		visible: (): boolean => isVisible(row, bindings.settings()),
	};
	switch (row.control.kind) {
		case 'toggle': {
			// A boolean default is still a boolean even if the file lost the key, so `false` is the fallback
			// rather than `undefined` — the API documents `defaultValue` as the fallback for exactly that case.
			return {
				...base,
				control: {
					type: 'toggle',
					key: row.path,
					defaultValue: defaultFor(row, bindings, 'boolean') === true,
				},
			};
		}
		case 'text': {
			return {
				...base,
				control: {
					type: 'text',
					key: row.path,
					placeholder: row.control.placeholder,
					defaultValue: String(defaultFor(row, bindings, 'string')),
					// A vault path is the one value here a person can get wrong in a way that hurts: an absolute
					// path or a `..` would write outside the vault, so it is refused with a sentence.
					validate: (candidate) => validateVaultFolder(candidate, row.path),
				},
			};
		}
		case 'dropdown': {
			return {
				...base,
				control: {
					type: 'dropdown',
					key: row.path,
					options: { ...row.control.options },
					defaultValue: String(defaultFor(row, bindings, 'string')),
				},
			};
		}
		case 'slider': {
			// No `displayFormat`: it is `@since 1.13.1` and this plugin supports 1.13.0 (the project's own
			// lint rule refuses it outright). The unit therefore lives in the row's description, where it is
			// searchable as well as visible.
			return {
				...base,
				control: {
					type: 'slider',
					key: row.path,
					min: row.control.min,
					max: row.control.max,
					step: row.control.step,
				},
			};
		}
		case 'flags':
		case 'info': {
			// One seam for both: `renderFor` decides what a row of this kind draws, and the definition only
			// says "draw whatever that is".
			const draw = renderFor(row, bindings);
			return { ...base, render: (setting: SettingSurface) => void draw?.(setting) };
		}
		case 'action': {
			return { ...base, action: () => void runDiagnostics(bindings) };
		}
	}
}

/** The only validator in the tab: a folder the plugin will create notes in. */
export function validateVaultFolder(candidate: string, path: string): string | void {
	if (path !== 'rows.targetFolder') {
		return undefined;
	}
	if (candidate.startsWith('/') || candidate.startsWith('\\')) {
		return 'A folder inside the vault: leave off the leading slash.';
	}
	if (candidate.split('/').includes('..')) {
		return 'A folder inside the vault: “..” would leave it.';
	}
	return undefined;
}

/**
 * The render function for a row that draws its own control, or `null` for a row whose control the framework
 * draws. Exported because it is the seam a test drives: the definition below calls exactly this function, so
 * a test that calls it too is testing the wiring rather than a copy of it.
 */
export function renderFor(
	row: SettingRow | SettingRowWithoutValue,
	bindings: TabBindings,
): ((setting: SettingSurface) => void | (() => void)) | null {
	if (row.control.kind === 'flags' && 'path' in row) {
		return (setting) => renderFlags(setting, row, bindings);
	}
	if (row.control.kind === 'info') {
		return (setting) => renderVersions(setting, bindings);
	}
	return null;
}

/** One switch per flag. Drawn imperatively because the keys come from the value, not from the schema. */
function renderFlags(
	setting: SettingSurface,
	row: SettingRow,
	bindings: TabBindings,
): void | (() => void) {
	const flags = bindings.settings().advanced.experimental;
	for (const name of Object.keys(flags).sort()) {
		setting.addToggle((toggle) => {
			toggle.setValue(flags[name] === true).onChange((value) => {
				const next = { ...bindings.settings().advanced.experimental, [name]: value };
				bindings.write(row.path, next);
			});
		});
	}
	return undefined;
}

/** The versions line: read-only, written where a control would be, so it reads like a value and is not one. */
function renderVersions(setting: SettingSurface, bindings: TabBindings): void | (() => void) {
	setting.controlEl.setText(bindings.versions());
	return undefined;
}

/** A row with no value: the read-only versions line, and the Diagnostics button. */
function definitionWithoutValue(
	row: SettingRowWithoutValue,
	bindings: TabBindings,
): SettingDefinition {
	const base = {
		name: row.name,
		desc: row.desc,
		aliases: [...row.aliases],
		visible: (): boolean => isVisible(row, bindings.settings()),
	};
	if (row.control.kind === 'action') {
		return { ...base, action: () => void runDiagnostics(bindings) };
	}
	const draw = renderFor(row, bindings);
	return { ...base, render: (setting: SettingSurface) => void draw?.(setting) };
}

/**
 * The whole tab: one group per section, one item per row, the unreadable-settings notices first.
 *
 * `warnings` are the sentences from the last load that could not be honoured. The caller shows them **once**
 * — it clears them on the same pass — because a row that keeps saying "this value was replaced" after it has
 * been read is noise, and because the next save has already written the default.
 */
export function buildSettingDefinitions(
	bindings: TabBindings,
	warnings: readonly SettingsWarning[] = [],
): readonly SettingDefinitionItem[] {
	const items: SettingDefinitionItem[] = [];
	if (warnings.length > 0) {
		items.push({
			type: 'group',
			heading: 'Settings that could not be read',
			cls: 'tablify-settings-warnings',
			items: warnings.map((warning, index) => ({
				// A warning is prose, not a switch: an empty definition renders the name and the sentence and
				// offers nothing to change.
				name: warning.path === '' ? `Settings file (${String(index + 1)})` : warning.path,
				desc: warning.message,
				searchable: false,
			})),
		});
	}
	for (const section of SETTINGS_SECTIONS) {
		const valued = SETTING_ROWS.filter((row) => row.section === section.id).map((row) =>
			definitionFor(row, bindings),
		);
		const valueless = SETTING_ROWS_WITHOUT_VALUE.filter(
			(row) => row.section === section.id,
		).map((row) => definitionWithoutValue(row, bindings));
		// No group-level `search`: it is `@since 1.13.1`. Obsidian's own settings search still indexes every
		// row (that is what `name`/`desc`/`aliases` are for), which is the feature that matters.
		items.push({
			type: 'group',
			heading: section.heading,
			cls: `tablify-settings-${section.id}`,
			items: [...valued, ...valueless],
		});
	}
	return items;
}

/** A group in the definition union. The union has no single discriminant, so this reads the shape. */
export function isGroup(item: SettingDefinitionItem): item is SettingDefinitionGroup {
	return 'type' in item && (item.type === 'group' || item.type === 'list');
}

/** Every path a control is bound to, in tab order. Used by the tests that walk the definitions. */
export function controlKeys(definitions: readonly SettingDefinitionItem[]): readonly string[] {
	const keys: string[] = [];
	for (const item of definitions) {
		if (!isGroup(item) || item.items === undefined) {
			continue;
		}
		for (const child of item.items) {
			if ('control' in child && child.control !== undefined && child.control !== null) {
				keys.push(child.control.key);
			}
		}
	}
	return keys;
}

/** Reads one setting's current value. Kept here so the class's `getControlValue` is one line. */
export function readControl(bindings: TabBindings, key: string): unknown {
	return readPath(bindings.settings(), key);
}
