import { Notice, Plugin } from 'obsidian';

import { TablifyView } from './TablifyView';
import { KeyboardHelpModal } from './help/KeyboardHelpModal';
import { TablifySettingTab } from './settings/TablifySettingTab';
import { createSettingsStore } from './settings/save';

/** The view type id Bases stores in a `.base` file. Public contract: never change it after release. */
export const TABLIFY_VIEW_TYPE = 'tablify-grid';

/** The name shown in the Bases view picker. */
export const TABLIFY_VIEW_NAME = 'Tablify grid';

/** The Lucide icon name chosen in `docs/02-architecture.md` (registration example). */
export const TABLIFY_VIEW_ICON = 'lucide-table-2';

/**
 * The environment every column context is built from. The timezone is the machine's, which is what a person
 * expects a date to render in; the locale is the app's, and the core keeps machine-readable strings
 * locale-independent on its own (`localDayKey` forces `en-CA`).
 *
 * The `navigator` guard lives here, in the composition root, rather than in the view: Obsidian always has a
 * `navigator`, and this plugin's unit project runs in node, which does not. One guard at the edge is cheaper
 * than a view that cannot be constructed in a test.
 */
export function pluginEnvironment(): {
	readonly now: () => number;
	readonly timezone: string;
	readonly locale: string;
} {
	return {
		now: () => Date.now(),
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		locale: typeof navigator === 'undefined' ? 'en' : navigator.language,
	};
}

/**
 * Tablify's plugin entry point. It owns exactly four things — a Bases view type, two commands, a
 * settings tab and a status bar item — and no product logic yet.
 */
export default class TablifyPlugin extends Plugin {
	onload(): void {
		// Plugin.registerBasesView(viewId: string, registration: BasesViewRegistration): boolean —
		// obsidian.d.ts, @since 1.10.0. BasesViewRegistration.name / .icon / .factory are @since 1.10.0,
		// and BasesViewFactory(controller: QueryController, containerEl: HTMLElement): BasesView is
		// @since 1.10.0. The boolean is false when Bases is disabled in the vault.
		const registered = this.registerBasesView(TABLIFY_VIEW_TYPE, {
			name: TABLIFY_VIEW_NAME,
			icon: TABLIFY_VIEW_ICON,
			factory: (controller, containerEl) => {
				const view = new TablifyView(
					controller,
					containerEl,
					TABLIFY_VIEW_TYPE,
					pluginEnvironment(),
				);
				// The view owns a write queue and a subscription; both are released when it is disposed.
				// `Component.register` ties the teardown to this plugin's lifetime instead of `window`.
				this.register(() => {
					view.dispose();
				});
				return view;
			},
		});
		if (!registered) {
			// Notice(message: string | DocumentFragment): obsidian.d.ts, @since 0.9.7.
			new Notice('Tablify: enable the Bases core plugin to use the grid view.');
		}

		// Plugin.addCommand(command: Command): Command — obsidian.d.ts, @since 0.9.7.
		this.addCommand({
			id: 'show-version',
			name: 'Show version',
			callback: () => {
				// Plugin.manifest: PluginManifest — obsidian.d.ts, @since 0.9.7.
				new Notice(`Tablify ${this.manifest.version}`);
			},
		});
		this.addCommand({
			id: 'open-keyboard-help',
			name: 'Open keyboard help',
			// Modal constructor(app: App) — obsidian.d.ts, @since 0.14.5; Modal.open(): @since 0.9.16.
			//
			// No default hotkey, deliberately. `?` and `F1` are bound **inside the grid** (step 19's key table):
			// a plugin-level hotkey with no modifier would fire while the user types a question mark in any note
			// in the vault, and the grid is the surface that owns the keyboard when the grid is what has focus.
			callback: () => {
				new KeyboardHelpModal(this.app).open();
			},
		});

		// The settings store owns `data.json`: one reader, one writer, one debounce. `loadData`/`saveData`
		// (obsidian.d.ts @since 0.9.7) are the only paths to the file, and the store is what holds the
		// passthrough bag that keeps a newer version's keys intact. It is disposed with the plugin, so a
		// pending write cannot outlive the view.
		const settings = createSettingsStore({
			persistence: {
				read: () => this.loadData(),
				write: (data) => this.saveData(data),
			},
			onError: (error) => {
				const detail = error instanceof Error ? error.message : 'unknown error';
				new Notice(`Tablify: could not save the settings (${detail}).`);
			},
		});
		this.register(() => {
			settings.dispose();
		});

		// Plugin.addSettingTab(settingTab: PluginSettingTab): void — obsidian.d.ts, @since 0.9.7. The tab
		// renders from the schema on every display; `update()` (SettingTab.update(), @since 1.13.0) is what
		// re-renders it once the file has been read, so the one frame before the load resolves shows defaults
		// and is then corrected rather than left wrong.
		const settingsTab = new TablifySettingTab(this.app, this, {
			store: settings,
			pluginVersion: this.manifest.version,
			minAppVersion: this.manifest.minAppVersion,
			noteCount: () => this.app.vault.getMarkdownFiles().length,
			warnings: () => settings.warnings(),
			warningsShown: () => {
				settings.clearWarnings();
			},
		});
		this.addSettingTab(settingsTab);
		void settings.load().then(() => {
			settingsTab.update();
		});

		// Plugin.addStatusBarItem(): HTMLElement — obsidian.d.ts, @since 0.9.7. The text stays empty
		// until a mounted view has something true to report (step 17); the class is the styling hook, so
		// this proves the API path without inventing data. addClass(..) is the DOM augmentation @1.4.4.
		const statusBarItem = this.addStatusBarItem();
		statusBarItem.addClass('tablify-statusbar');
	}

	onunload(): void {
		// Component.onunload(): virtual void — obsidian.d.ts, @since 0.9.7. Everything registered above
		// is owned by this Plugin instance and Obsidian detaches it on unload: commands, the setting tab,
		// the status bar item and the Bases view type. There is no `unregisterBasesView` in
		// obsidian.d.ts @ 1.13.1, so there is nothing to undo by hand — and nothing else to release,
		// because this plugin starts no timers and adds no window listeners.
		super.onunload();
	}
}
