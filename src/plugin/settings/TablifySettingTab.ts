import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';

/** Shown at the top of the tab while the plugin has nothing to configure. */
export const TABLIFY_SETTINGS_TITLE = 'Tablify';

export const TABLIFY_SETTINGS_INTRO =
	'Tablify is pre-release. Nothing is configurable yet: the grid settings, the view presets and the optional sync arrive in later milestones.';

/**
 * The settings tab. It exists from this step so the plugin's shape is complete — the four surfaces a
 * plugin can own are a view, a command, a status bar item and a settings tab — and so `addSettingTab`
 * is exercised. It must render without any settings object, because the settings schema arrives in
 * step 14; it therefore reads no state at all.
 */
export class TablifySettingTab extends PluginSettingTab {
	constructor(app: App, plugin: Plugin) {
		// PluginSettingTab constructor(app: App, plugin: Plugin) — obsidian.d.ts, @since 0.9.7.
		super(app, plugin);
	}

	/** SettingTab.display(): abstract void — obsidian.d.ts, @since 1.13.0. */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		// Setting(containerEl): obsidian.d.ts, @since 0.9.7; setName(): @since 0.9.7; setHeading():
		// @since 0.9.16. Obsidian's own linter requires headings to be built this way, and the table of
		// settings that follows in step 14 uses the same constructor.
		new Setting(containerEl).setName(TABLIFY_SETTINGS_TITLE).setHeading();
		// empty() / createEl(): global DOM augmentations — obsidian.d.ts, @since 1.4.4.
		containerEl.createEl('p', { text: TABLIFY_SETTINGS_INTRO });
	}
}
