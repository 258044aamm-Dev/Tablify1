import { Notice, Plugin, TFile } from 'obsidian';

import { createSessionRegistry } from '../adapters/tablifyFile/registry';
import { createVaultPort } from '../adapters/tablifyFile/vaultPort';
import { createIdFactory } from '../core/database';
import { TABLIFY_FILE_EXTENSION, TABLIFY_FILE_VIEW_TYPE, TablifyFileView } from './TablifyFileView';
import { KeyboardHelpModal } from './help/KeyboardHelpModal';
import { TablifySettingTab } from './settings/TablifySettingTab';
import { createSettingsStore } from './settings/save';

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
 * Tablify's plugin entry point. It owns the `.tablify` file view and its extension, four commands and a settings tab,
 * and no product logic: the grid, the import wizard and the export dialog each own their own, and sync is a module
 * this file loads only when somebody asks for it (`docs/02` §composition root).
 */
export default class TablifyPlugin extends Plugin {
	onload(): void {
		/**
		 * Everything `onload` owns lives in this scope: the session registry and the commands' helpers.
		 *
		 * That is not a style choice. `onload` is the only method Obsidian calls on a `Plugin`, and this project's
		 * house double drives it exactly as the app does — `Reflect.apply(TablifyPlugin.prototype.onload, double, [])`
		 * — so anything `onload` reads off `this` must be something the double also has. Closures over locals are
		 * the one shape that works in both worlds, and a plugin's `onload` scope is where this state belongs anyway.
		 */
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

		// Plugin.addStatusBarItem(): HTMLElement — obsidian.d.ts, @since 0.9.7. The text stays empty until a
		// mounted view has a link to report (step 26); the class is the styling hook, so this proves the API
		// path without inventing data. addClass(..) is the DOM augmentation @1.4.4.
		// ---------------------------------------------------------------------------------------------
		// The native `.tablify` file view (R2 step 6)
		// ---------------------------------------------------------------------------------------------

		/**
		 * The one file port and the one registry for this plugin's lifetime: one session per open path,
		 * however many panes show it. Both live in this `onload` scope (the shape the house double can
		 * drive), and the registry is torn down through `this.register`, so a disabled plugin leaves no
		 * vault listener, no open session and no pending write behind — to the extent the host lets an
		 * unload finish, which is exactly what the R2 probe kit measures on a real device.
		 */
		const vaultPort = createVaultPort(this.app.vault);
		const nativeIds = createIdFactory({
			randomValues(length: number): Uint8Array {
				if (typeof window === 'undefined') {
					throw new Error('this host has no window.crypto; secure ids cannot be created');
				}
				const bytes = new Uint8Array(length);
				window.crypto.getRandomValues(bytes);
				return bytes;
			},
		});
		const registry = createSessionRegistry(vaultPort, { ids: nativeIds });
		this.register(() => {
			void registry.disposeAll();
		});

		/**
		 * `Plugin.registerView(viewType: string, viewCreator: ViewCreator): void` — obsidian.d.ts :4974,
		 * @since 0.9.7 — plus `Plugin.registerExtensions(extensions: string[], viewType: string): void` —
		 * obsidian.d.ts :4985, @since 0.9.7. Together they are the whole routing contract: a `.tablify`
		 * file opens in this view, with no other plugin involved.
		 */
		this.registerView(TABLIFY_FILE_VIEW_TYPE, (leaf) => {
			return new TablifyFileView(leaf, {
				registry,
				createId: nativeIds,
				environment: pluginEnvironment(),
				copyDatabase: async (path, text) => {
					await vaultPort.create(path, text);
				},
			});
		});
		this.registerExtensions([TABLIFY_FILE_EXTENSION], TABLIFY_FILE_VIEW_TYPE);

		/** `Untitled`, `Untitled 2`, … — the first free name, so create never overwrites a file. */
		const uniqueDatabasePath = async (): Promise<string> => {
			let index = 1;
			for (;;) {
				const suffix = index === 1 ? '' : ` ${String(index)}`;
				const candidate = `Untitled${suffix}.${TABLIFY_FILE_EXTENSION}`;
				if (!(await vaultPort.exists(candidate))) {
					return candidate;
				}
				index += 1;
			}
		};

		this.addCommand({
			id: 'create-database',
			name: 'Create new database',
			callback: () => {
				void (async () => {
					const path = await uniqueDatabasePath();
					const name = path.slice(0, path.length - TABLIFY_FILE_EXTENSION.length - 1);
					const created = await registry.create(path, name);
					if (!created.ok) {
						new Notice('Tablify: the database could not be created.');
						return;
					}
					const file = this.app.vault.getAbstractFileByPath(path);
					if (!(file instanceof TFile)) {
						new Notice('Tablify: the database was created but could not be opened.');
						return;
					}
					await this.app.workspace.getLeaf('tab').openFile(file);
				})();
			},
		});

		// ---------------------------------------------------------------------------------------------
		// Sync: loaded on demand, never on this path (step 26, deliverable 4)
		// ---------------------------------------------------------------------------------------------

		// The native table's sync (R5 Part C). Loaded only when invoked, like the panel above, so startup does not
		// evaluate it. It acts on the table this pane shows and on nothing else.
		this.addCommand({
			id: 'sync-native-table',
			name: 'Sync this table',
			callback: () => {
				void (async () => {
					const store =
						this.app.workspace.getActiveViewOfType(TablifyFileView)?.activeStore() ??
						null;
					if (store === null) {
						new Notice('Tablify: open a Tablify table first.');
						return;
					}
					try {
						const { openNativeSyncPanel } = await import('./sync/nativeCommand');
						openNativeSyncPanel({ app: this.app, store });
					} catch (error) {
						new Notice(
							`Tablify: ${error instanceof Error ? error.message : 'the table could not be synced'}`,
						);
					}
				})();
			},
		});
	}

	onunload(): void {
		// Component.onunload(): virtual void — obsidian.d.ts, @since 0.9.7. Everything registered above
		// is owned by this Plugin instance and Obsidian detaches it on unload: commands, the setting tab,
		// the file view type and the extension. The R2 registry unsubscribes and
		// flushes through the teardown registered in `onload`; whether the host lets that promise finish
		// before the plugin is gone is a real-device question, not an assumption (probe kit R2).
		super.onunload();
	}
}
