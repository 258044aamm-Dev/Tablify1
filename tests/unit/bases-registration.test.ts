import { describe, expect, it } from 'vitest';

import TablifyPlugin, {
	TABLIFY_VIEW_ICON,
	TABLIFY_VIEW_NAME,
	TABLIFY_VIEW_TYPE,
} from '../../src/plugin/main';
import { elementStub, Plugin, type ViewRegistration } from '../mocks/obsidian';

function loadPlugin(): Plugin {
	const plugin = new Plugin();
	Reflect.apply(TablifyPlugin.prototype.onload, plugin, []);
	return plugin;
}

function firstRegistration(plugin: Plugin): ViewRegistration {
	const entry = plugin.registeredViews[0];
	if (entry === undefined) {
		throw new Error('the plugin registered no Bases view');
	}
	return entry.registration;
}

describe('Bases view registration', () => {
	it('registers exactly one view type, under the documented id', () => {
		const plugin = loadPlugin();
		expect(plugin.registeredViews).toHaveLength(1);
		expect(plugin.registeredViews[0]?.id).toBe('tablify-grid');
		expect(TABLIFY_VIEW_TYPE).toBe('tablify-grid');
	});

	it('gives the registration the documented name and icon', () => {
		const registration = firstRegistration(loadPlugin());
		expect(registration.name).toBe(TABLIFY_VIEW_NAME);
		expect(registration.name.trim().length).toBeGreaterThan(0);
		expect(registration.icon).toBe(TABLIFY_VIEW_ICON);
	});

	it('the factory builds a view into the container Bases hands it', () => {
		const registration = firstRegistration(loadPlugin());
		const containerEl = elementStub();
		const view = registration.factory({}, containerEl);

		expect(view.containerEl).toBe(containerEl);
		expect(view.type).toBe(TABLIFY_VIEW_TYPE);
		// One host element is mounted inside the container; the grid owns the rest of the DOM later.
		expect(containerEl.children).toHaveLength(1);
		expect(containerEl.children[0]?.classes).toContain('tablify-view-host');
	});

	it('renders a truthful empty summary when Bases reports an empty dataset', () => {
		const registration = firstRegistration(loadPlugin());
		const containerEl = elementStub();
		const view = registration.factory({}, containerEl);

		expect(() => {
			view.onDataUpdated();
		}).not.toThrow();
		// The container still holds exactly one host element, and the host states what it actually has.
		expect(containerEl.children).toHaveLength(1);
		const host = containerEl.children[0];
		expect(host?.children[0]?.classes).toContain('tablify-placeholder-status');
		expect(host?.children[0]?.text).toContain('0 rows × 0 columns');
		expect(host?.children.slice(1)).toHaveLength(0);
	});

	it('unload leaves no registered view, no commands and no status bar item', () => {
		const plugin = loadPlugin();
		expect(plugin.registeredViews).toHaveLength(1);
		// Five since R5 Part C added the native table's sync command (see `plugin-smoke.test.ts`).
		expect(plugin.commands).toHaveLength(5);
		expect(plugin.statusBarItems).toHaveLength(1);

		Reflect.apply(TablifyPlugin.prototype.onunload, plugin, []);

		expect(plugin.registeredViews).toHaveLength(0);
		expect(plugin.commands).toHaveLength(0);
		expect(plugin.statusBarItems).toHaveLength(0);
	});
});
