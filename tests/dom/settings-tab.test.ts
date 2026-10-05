import { beforeEach, describe, expect, it } from 'vitest';

import TablifyPlugin from '../../src/plugin/main';
import {
	TABLIFY_SETTINGS_INTRO,
	TABLIFY_SETTINGS_TITLE,
} from '../../src/plugin/settings/TablifySettingTab';
import { createdSettings, Plugin, type PluginSettingTab } from '../mocks/obsidian';

function loadedPlugin(): Plugin {
	const plugin = new Plugin();
	Reflect.apply(TablifyPlugin.prototype.onload, plugin, []);
	return plugin;
}

function firstTab(plugin: Plugin): PluginSettingTab {
	const tab = plugin.settingTabs[0];
	if (tab === undefined) {
		throw new Error('the plugin registered no settings tab');
	}
	return tab;
}

/** `createdSettings` is shared by the whole file, so each test starts from an empty record. */
beforeEach(() => {
	createdSettings.length = 0;
});

describe('settings tab', () => {
	it('is registered exactly once, at load', () => {
		expect(loadedPlugin().settingTabs).toHaveLength(1);
	});

	it('renders a heading and an intro paragraph without throwing', () => {
		const tab = firstTab(loadedPlugin());

		expect(() => {
			tab.display();
		}).not.toThrow();

		expect(createdSettings).toHaveLength(1);
		const heading = createdSettings[0];
		expect(heading?.settingName).toBe(TABLIFY_SETTINGS_TITLE);
		expect(heading?.isHeading).toBe(true);
		expect(heading?.description).toBe('');

		const [intro] = tab.containerEl.children;
		expect(tab.containerEl.children).toHaveLength(1);
		expect(intro?.tag).toBe('p');
		expect(intro?.text).toBe(TABLIFY_SETTINGS_INTRO);
		expect(intro?.text).toContain('pre-release');
	});

	it('offers nothing to configure: no inputs, and one heading only', () => {
		const tab = firstTab(loadedPlugin());
		tab.display();

		// The double's Setting has no addText / addToggle / addDropdown, so a real control would throw
		// rather than render; this asserts the other half, that nothing in the tree is an input.
		expect(tab.containerEl.children.filter((child) => child.tag === 'input')).toHaveLength(0);
		expect(tab.containerEl.children.map((child) => child.tag)).toEqual(['p']);
		expect(createdSettings).toHaveLength(1);
	});

	it('empties before it renders, so re-displaying cannot stack duplicates', () => {
		const tab = firstTab(loadedPlugin());
		tab.display();
		tab.display();

		expect(tab.containerEl.emptied).toBe(2);
		expect(tab.containerEl.children).toHaveLength(1);
	});
});
