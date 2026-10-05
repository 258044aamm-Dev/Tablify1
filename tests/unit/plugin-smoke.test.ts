import { describe, expect, it } from 'vitest';

import TablifyPlugin from '../../src/plugin/main';
// The same module the plugin's `import ... from 'obsidian'` resolves to (see vitest.config.ts):
// asserting through the double keeps these tests type-safe, because the published package is types-only.
import { noticeLog, openedModals, Plugin } from '../mocks/obsidian';

/** Load the plugin against the double, exactly as Obsidian would load it. */
function loadPlugin(version = '9.9.9'): Plugin {
	const plugin = new Plugin();
	plugin.manifest = { version };
	Reflect.apply(TablifyPlugin.prototype.onload, plugin, []);
	return plugin;
}

describe('plugin entry point', () => {
	it('default-exports a class that extends Plugin', () => {
		expect(TablifyPlugin).toBeTypeOf('function');
		expect(Object.getPrototypeOf(TablifyPlugin)).toBe(Plugin);
	});

	it('declares onload and onunload', () => {
		expect(typeof TablifyPlugin.prototype.onload).toBe('function');
		expect(typeof TablifyPlugin.prototype.onunload).toBe('function');
	});

	it('has no top-level side effects on import', () => {
		expect(noticeLog).toEqual([]);
		expect(openedModals).toEqual([]);
	});

	it('registers exactly two commands, with stable ids', () => {
		const plugin = loadPlugin();
		expect(plugin.commands.map((command) => command.id)).toEqual([
			'show-version',
			'open-keyboard-help',
		]);
	});

	it('show-version notices the manifest version', () => {
		const plugin = loadPlugin('9.9.9');
		const command = plugin.commands.find((entry) => entry.id === 'show-version');
		command?.callback();
		expect(noticeLog).toEqual(['Tablify 9.9.9']);
	});

	it('open-keyboard-help opens a modal and leaves it open', () => {
		const plugin = loadPlugin();
		const command = plugin.commands.find((entry) => entry.id === 'open-keyboard-help');
		command?.callback();
		expect(openedModals).toHaveLength(1);
	});

	it('releases everything on unload and does not throw', () => {
		const plugin = loadPlugin();
		expect(plugin.commands).toHaveLength(2);
		expect(() => {
			Reflect.apply(TablifyPlugin.prototype.onunload, plugin, []);
		}).not.toThrow();
		expect(plugin.commands).toHaveLength(0);
	});
});
