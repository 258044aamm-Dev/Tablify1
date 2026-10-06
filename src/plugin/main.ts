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

/** The workspace leaf type a Bases view lives in. `getLeavesOfType` takes the leaf's type, not the view's. */
const BASES_LEAF_TYPE = 'bases';

/**
 * Where link files live. **Mirrored** from `LINK_FOLDER` in `src/sync/LinkStore.ts` — and the reason for the mirror
 * is the point of this step: a static import of anything under `src/sync/**` would put the sync module graph back
 * into this file's graph, which is exactly what the dynamic import exists to avoid. `tests/unit/startup.test.ts`
 * asserts the two constants agree, so the mirror cannot drift silently.
 */
export const LINK_FOLDER_MIRROR = '.tablify/links';

/** A live grid view and the container it was built into, so a Bases leaf can be traced back to its view. */
type LiveView = { readonly view: TablifyView; readonly containerEl: HTMLElement };

/**
 * The sync host's type, taken from the module **it will be loaded from**.
 *
 * `typeof import('…')` is a type-position expression: TypeScript resolves it, and this file never imports the
 * module at runtime. `import type { createSyncHost } from './sync/host'` would do the same thing — except that a
 * tool reading the import list (including the startup proof) cannot tell a type-only import from a value one
 * without parsing further, and the inline form makes the "no static reference" claim checkable by eye.
 */
type SyncHost = ReturnType<(typeof import('./sync/host'))['createSyncHost']>;

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
 * Tablify's plugin entry point. It owns exactly five things — a Bases view type, three commands, a settings tab and
 * a status bar item — and no product logic: the grid, the import wizard and the export dialog each own their own,
 * and sync is a module this file loads only when somebody asks for it (`docs/02` §composition root).
 */
export default class TablifyPlugin extends Plugin {
	onload(): void {
		// Plugin.registerBasesView(viewId: string, registration: BasesViewRegistration): boolean —
		// obsidian.d.ts, @since 1.10.0. BasesViewRegistration.name / .icon / .factory are @since 1.10.0,
		// and BasesViewFactory(controller: QueryController, containerEl: HTMLElement): BasesView is
		// @since 1.10.0. The boolean is false when Bases is disabled in the vault.
		/**
		 * Everything `onload` owns lives in this scope: the live views, the status bar item and the sync host.
		 *
		 * That is not a style choice. `onload` is the only method Obsidian calls on a `Plugin`, and this project's
		 * house double drives it exactly as the app does — `Reflect.apply(TablifyPlugin.prototype.onload, double, [])`
		 * — so anything `onload` reads off `this` must be something the double also has. Closures over locals are
		 * the one shape that works in both worlds, and a plugin's `onload` scope is where this state belongs anyway.
		 */
		const liveViews: LiveView[] = [];
		let syncHost: SyncHost | null = null;

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
				// The registry is what makes `activeTablifyView()` answerable at all: `BasesView` declares no
				// public way back from a leaf to the view instance, so the factory keeps what the factory built.
				const entry: LiveView = { view, containerEl };
				liveViews.push(entry);
				// The view owns a write queue and a subscription; both are released when it is disposed.
				// `Component.register` ties the teardown to this plugin's lifetime instead of `window`.
				this.register(() => {
					const at = liveViews.indexOf(entry);
					if (at >= 0) {
						liveViews.splice(at, 1);
					}
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

		// Plugin.addStatusBarItem(): HTMLElement — obsidian.d.ts, @since 0.9.7. The text stays empty until a
		// mounted view has a link to report (step 26); the class is the styling hook, so this proves the API
		// path without inventing data. addClass(..) is the DOM augmentation @1.4.4.
		const statusBarItem = this.addStatusBarItem();
		statusBarItem.addClass('tablify-statusbar');

		// ---------------------------------------------------------------------------------------------
		// Sync: loaded on demand, never on this path (step 26, deliverable 4)
		// ---------------------------------------------------------------------------------------------

		/** The live view behind the active Bases leaf, or `null` when the focused pane is not a Tablify grid. */
		const activeView = (): TablifyView | null => {
			if (liveViews.length === 0) {
				return null;
			}
			const leaves = this.app.workspace.getLeavesOfType(BASES_LEAF_TYPE);
			if (leaves.length === 0) {
				return null;
			}
			// `getMostRecentLeaf()` rather than `activeLeaf`: the latter is deprecated in `obsidian.d.ts` 1.13.1
			// ("use `getActiveViewOfType`" — which cannot help here, because a Bases view is not a `View`). The most
			// recent leaf is the pane a person was last in, and containment below is what makes it the right one.
			const recent = this.app.workspace.getMostRecentLeaf();
			const ordered =
				recent === null ? leaves : [recent, ...leaves.filter((leaf) => leaf !== recent)];
			for (const leaf of ordered) {
				for (const entry of liveViews) {
					if (leaf.view.containerEl.contains(entry.containerEl)) {
						return entry.view;
					}
				}
			}
			return null;
		};

		/**
		 * The sync host, loaded on demand: one import per session, and every caller goes through here.
		 *
		 * `await import('./sync/host')` is the dynamic import under test. The host's ports are this plugin's answer
		 * to "what does the vault look like from the sync code's point of view": the active view, the two file
		 * operations the link store needs, the status bar item, and notices.
		 */
		const syncHostFor = async (): Promise<SyncHost> => {
			const existing = syncHost;
			if (existing !== null) {
				return existing;
			}
			const { createSyncHost } = await import('./sync/host');
			const host = createSyncHost({
				activeView,
				files: {
					// `DataAdapter.read` rejects on a missing file; the link store wants `null`, because a view that
					// was never linked is not an error (`docs/03`: the link folder is disposable).
					read: async (path) => {
						try {
							return await this.app.vault.adapter.read(path);
						} catch {
							return null;
						}
					},
					write: async (path, text) => {
						// The adapter does not create a missing parent, and `.tablify/links` is a dot-folder only
						// this plugin writes: create it once, then write. `exists` first keeps `mkdir` from throwing.
						const parent = path.slice(0, path.lastIndexOf('/'));
						if (parent !== '' && !(await this.app.vault.adapter.exists(parent))) {
							await this.app.vault.adapter.mkdir(parent);
						}
						await this.app.vault.adapter.write(path, text);
					},
				},
				setStatus: (text) => {
					statusBarItem.setText(text);
				},
				notify: (message) => {
					new Notice(message);
				},
			});
			syncHost = host;
			return host;
		};

		/**
		 * Loads the sync module **only if a link file exists**, then asks it for the badge text.
		 *
		 * One directory listing is the whole cost for a vault without sync: no module, no client, no request. When a
		 * link file is there, the host is loaded and asked for the badge — which reads the link and writes a string
		 * and does nothing else (`docs/01` §Sync UX: sync is manual, and this is the read-only part).
		 */
		const refreshBadge = async (): Promise<void> => {
			let linked = false;
			try {
				const listing = await this.app.vault.adapter.list(LINK_FOLDER_MIRROR);
				linked = listing.files.length > 0;
			} catch {
				// No folder yet is the normal state of a vault that has never synced.
				linked = false;
			}
			if (!linked && syncHost === null) {
				statusBarItem.setText('');
				return;
			}
			try {
				const host = await syncHostFor();
				await host.updateStatus();
			} catch {
				statusBarItem.setText('');
			}
		};

		const badge = (): void => {
			void refreshBadge();
		};
		this.app.workspace.onLayoutReady(badge);
		this.registerEvent(this.app.workspace.on('active-leaf-change', badge));

		// Plugin.addCommand(command: Command): Command — obsidian.d.ts, @since 0.9.7. This is the other way into the
		// sync feature, and the only one that loads it with no link file: the person asked for it by name.
		// Named for what it opens rather than for the service: the panel and the settings copy are where a person
		// reads which service this talks to, and Obsidian's own UI-text rule wants sentence case.
		this.addCommand({
			id: 'open-sync-panel',
			name: 'Open the sync panel',
			callback: () => {
				void (async () => {
					try {
						const host = await syncHostFor();
						await host.open();
					} catch (error) {
						new Notice(
							`Tablify: ${error instanceof Error ? error.message : 'the sync panel could not be opened'}`,
						);
					}
				})();
			},
		});
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
