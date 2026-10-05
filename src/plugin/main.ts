import { Modal, Notice, Plugin } from 'obsidian';

import { TablifyPlaceholderView } from './TablifyPlaceholderView';
import { KEY_BINDINGS } from './help/keyBindings';
import { TablifySettingTab } from './settings/TablifySettingTab';

/** The view type id Bases stores in a `.base` file. Public contract: never change it after release. */
export const TABLIFY_VIEW_TYPE = 'tablify-grid';

/** The name shown in the Bases view picker. */
export const TABLIFY_VIEW_NAME = 'Tablify grid';

/** The Lucide icon name chosen in `docs/02-architecture.md` (registration example). */
export const TABLIFY_VIEW_ICON = 'lucide-table-2';

/**
 * The static keyboard reference behind the `open-keyboard-help` command. Step 19 replaces the surface
 * with the real help view; the text it renders comes from `KEY_BINDINGS`, which does not change.
 */
export class KeyboardHelpModal extends Modal {
	onOpen(): void {
		// Modal.onOpen(): virtual void — obsidian.d.ts, @since 0.9.16; Modal.titleEl / Modal.contentEl
		// are @since 0.14.5; createEl / setText are the DOM augmentations @since 1.4.4.
		this.titleEl.setText('Tablify keyboard');
		const list = this.contentEl.createEl('dl', { cls: 'tablify-help-list' });
		for (const binding of KEY_BINDINGS) {
			list.createEl('dt', { text: binding.keys });
			list.createEl('dd', { text: binding.description });
		}
		this.contentEl.createEl('p', {
			cls: 'tablify-help-note',
			text: 'These bindings arrive with the grid. Nothing in this build accepts keyboard input yet.',
		});
	}
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
			factory: (controller, containerEl) =>
				new TablifyPlaceholderView(controller, containerEl, TABLIFY_VIEW_TYPE),
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
			callback: () => {
				new KeyboardHelpModal(this.app).open();
			},
		});

		// Plugin.addSettingTab(settingTab: PluginSettingTab): void — obsidian.d.ts, @since 0.9.7.
		this.addSettingTab(new TablifySettingTab(this.app, this));

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
