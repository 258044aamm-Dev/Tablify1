/**
 * The settings tab, as Obsidian sees it.
 *
 * This file is the Obsidian-facing half and deliberately thin: it subclasses `PluginSettingTab`, hands the
 * rows in `tab.ts` to the app's declarative renderer, and wires the four hooks the renderer calls back
 * (`getControlValue`, `setControlValue`, `refreshDomState`, `update`). Every decision — which rows exist,
 * what is visible, what a change does, what the Diagnostics blob contains — lives in files that do not
 * import `obsidian` at all, so they are testable here and this class has almost nothing to get wrong.
 *
 * **There is no `display()` override.** `SettingTab.display()` is `@deprecated Since 1.13.0` in
 * `obsidian.d.ts`, and the declaration says it is not called when `getSettingDefinitions()` returns a
 * non-empty array. This plugin's `minAppVersion` is 1.13.0, so the declarative path is always the path; a
 * second imperative renderer that no supported version would ever call is dead code, and it would have to
 * agree with the schema forever.
 */
import { Notice, PluginSettingTab } from 'obsidian';
import type { App, Plugin, SettingDefinitionItem } from 'obsidian';

import { DEFAULT_SETTINGS, SETTING_PATHS, readPath } from './schema';
import type { SettingPath, TablifySettings } from './schema';
import { applyControlChange, buildSettingDefinitions, readControl } from './tab';
import type { TabBindings } from './tab';
import { diagnosticsBlob } from './diagnostics';
import type { SettingsWarning } from './load';

/** What the tab needs from the plugin: the store, the two versions, the vault, and the clipboard. */
export type SettingsTabHost = {
	readonly store: {
		readonly get: () => unknown;
		readonly set: (path: SettingPath, value: unknown) => boolean;
	};
	readonly pluginVersion: string;
	readonly minAppVersion: string;
	/** How many markdown notes the vault holds — a count for the Diagnostics blob, never a name. */
	readonly noteCount: () => number;
	/** Copies text to the clipboard. Defaults to `navigator.clipboard.writeText`. */
	readonly copy?: (text: string) => Promise<void>;
	/** Shows a message. Defaults to `new Notice(...)`. */
	readonly notify?: (message: string) => void;
	/** Extra rows above the schema's — the unreadable-settings notices, when there are any. */
	readonly warnings?: () => readonly SettingsWarning[];
	/** Called once the warnings have been rendered, so they are shown exactly once. */
	readonly warningsShown?: () => void;
};

/** The clipboard, if this environment has one. `navigator` is absent in node, not in Obsidian. */
async function copyWithNavigator(text: string): Promise<void> {
	if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
		throw new Error('no clipboard in this environment');
	}
	await navigator.clipboard.writeText(text);
}

export class TablifySettingTab extends PluginSettingTab {
	private readonly host: SettingsTabHost;

	constructor(app: App, plugin: Plugin, host: SettingsTabHost) {
		super(app, plugin);
		this.host = host;
		// The tab is a component; its icon is what Obsidian shows in the settings sidebar (`@since 1.11.0`).
		this.icon = 'lucide-table-2';
	}

	/** The rows. Called on every render, and once for search indexing — hence the `warningsShown` hook. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const shown = this.host.warningsShown === undefined ? undefined : this.takeWarnings();
		return [...buildSettingDefinitions(this.bindings(), shown ?? [])];
	}

	/** What a control reads. The key is a dotted path into the settings object. */
	getControlValue(key: string): unknown {
		const path = SETTING_PATHS.find((candidate) => candidate === key);
		if (path === undefined) {
			return undefined;
		}
		return readControl(this.bindings(), path);
	}

	/** What a control writes: the store's `set`, which validates and debounces the save. */
	setControlValue(key: string, value: unknown): void {
		applyControlChange(this.bindings(), key, value);
	}

	/**
	 * The tab's own bindings. Built per call, so a row's closure reads the *current* settings rather than the
	 * ones that existed when the tab was constructed — which is what makes `visible` correct after a change.
	 */
	private bindings(): TabBindings {
		const host = this.host;
		return {
			settings: () => settingsOf(host),
			defaultValue: (path) => readPath(DEFAULT_SETTINGS, path),
			write: (path, value) => writeSetting(host, path, value),
			refresh: () => {
				this.refreshDomState();
			},
			copy: (text) => (host.copy ?? copyWithNavigator)(text),
			notify: (message) => {
				if (host.notify === undefined) {
					new Notice(message);
					return;
				}
				host.notify(message);
			},
			versions: () =>
				`Tablify ${host.pluginVersion} · Obsidian ${host.minAppVersion} or newer`,
			diagnostics: () =>
				diagnosticsBlob({
					pluginVersion: host.pluginVersion,
					minAppVersion: host.minAppVersion,
					noteCount: host.noteCount(),
					settings: settingsOf(host),
				}),
		};
	}

	/** Takes the pending warnings so the next render does not repeat them. */
	private takeWarnings(): readonly SettingsWarning[] {
		const warnings = this.host.warnings?.() ?? [];
		if (warnings.length > 0) {
			this.host.warningsShown?.();
		}
		return warnings;
	}
}

/**
 * The settings object the tab renders from. The host passes the store's `get`; this narrows it to the shape
 * the tab needs without an assertion, by handing back the defaults when the store has nothing (which cannot
 * happen after load, and is what keeps a pre-load render from throwing).
 *
 * Exported, like the two helpers below it, because they are the parts of this file that carry logic rather
 * than delegation — and a test can drive them with a host object it built itself (see
 * `tests/dom/settings-tab.test.ts`).
 */
export function settingsOf(host: SettingsTabHost): TablifySettings {
	const value: unknown = host.store.get();
	return isSettings(value) ? value : DEFAULT_SETTINGS;
}

/** A structural check for the one place a value arrives from a port rather than from a typed call. */
export function isSettings(value: unknown): value is TablifySettings {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	return 'rows' in value && 'import' in value && 'appearance' in value && 'advanced' in value;
}

/** Writes one setting through the host's store, using the path guard to turn a string into a `SettingPath`. */
export function writeSetting(host: SettingsTabHost, path: string, value: unknown): boolean {
	const known = SETTING_PATHS.find((candidate) => candidate === path);
	if (known === undefined) {
		return false;
	}
	return host.store.set(known, value);
}
