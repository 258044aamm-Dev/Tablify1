import { describe, expect, it } from 'vitest';

import TablifyPlugin from '../../src/plugin/main';
// The same module the plugin's `import ... from 'obsidian'` resolves to (see vitest.config.ts):
// asserting through the double keeps these tests type-safe, because the published package is types-only.
import { noticeLog, Plugin } from '../mocks/obsidian';

/** The receiver `onload()` is written against: a manifest and a command registrar. */
function makeReceiver() {
	const commands: { id: string; name: string; callback: () => void }[] = [];
	return {
		commands,
		manifest: { version: '9.9.9' },
		addCommand: (command: { id: string; name: string; callback: () => void }): void => {
			commands.push(command);
		},
	};
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
	});

	it('registers exactly one command, show-version, which notices the manifest version', () => {
		const receiver = makeReceiver();
		Reflect.apply(TablifyPlugin.prototype.onload, receiver, []);

		expect(receiver.commands).toHaveLength(1);
		const command = receiver.commands[0];
		expect(command?.id).toBe('show-version');
		expect(command?.name).toBe('Show version');

		command?.callback();
		expect(noticeLog).toEqual(['Tablify 9.9.9']);
	});

	it('releases nothing on unload and does not throw', () => {
		expect(() => {
			Reflect.apply(TablifyPlugin.prototype.onunload, makeReceiver(), []);
		}).not.toThrow();
	});
});
