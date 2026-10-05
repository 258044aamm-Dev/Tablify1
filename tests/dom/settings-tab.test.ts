/**
 * The settings tab.
 *
 * Obsidian 1.13 renders a tab declaratively from `PluginSettingTab.getSettingDefinitions()`, so the tab's own
 * render code is the array in `src/plugin/settings/tab.ts` — and that is what these tests walk. The class in
 * `TablifySettingTab.ts` is the thin Obsidian-facing half; what is asserted about it here is that it *is* the
 * API's tab (subclass, three hooks) and that its hooks delegate to the same pure functions.
 *
 * The three things the step asks for, in order:
 *  - one row per schema row, iterated from the schema rather than listed by hand (so a new setting cannot
 *    ship without a row, and a removed one cannot leave a stale assertion);
 *  - a hidden row that appears when its condition turns on, driven through the real store;
 *  - a control change that reaches the save path **exactly once**, asserted on the fake clock.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
	DEFAULT_SETTINGS,
	SETTINGS_SECTIONS,
	SETTING_ROWS,
	SETTING_ROWS_WITHOUT_VALUE,
	isRecord,
	readPath,
} from '../../src/plugin/settings/schema';
import type { TablifySettings } from '../../src/plugin/settings/schema';
import { createSettingsStore } from '../../src/plugin/settings/save';
import type { PersistencePort, SettingsStore } from '../../src/plugin/settings/save';
import {
	applyControlChange,
	buildSettingDefinitions,
	controlKeys,
	isGroup,
	renderFor,
	runDiagnostics,
	validateVaultFolder,
	versionsLine,
} from '../../src/plugin/settings/tab';
import {
	diagnosticsBlob,
	looksSecret,
	redactedSettings,
} from '../../src/plugin/settings/diagnostics';
import {
	TablifySettingTab,
	isSettings,
	settingsOf,
	writeSetting,
} from '../../src/plugin/settings/TablifySettingTab';
import type { SettingsTabHost } from '../../src/plugin/settings/TablifySettingTab';
import { PluginSettingTab, createdSettings, noticeLog } from '../mocks/obsidian';
import type { SettingDefinition, SettingDefinitionItem } from 'obsidian';
import type { SettingSurface, TabBindings, ToggleSurface } from '../../src/plugin/settings/tab';
import { createFakeClock } from '../fakes/clock';

/**
 * The blob, as an object. `JSON.parse` is `any`, and this project does not assert: the shape is checked, and
 * a blob that is not an object is a failure with a message rather than a type error somewhere else.
 */
function parseBlob(blob: string): Record<string, unknown> {
	const value: unknown = JSON.parse(blob);
	if (!isRecord(value)) {
		throw new Error('the diagnostics blob is not an object');
	}
	return value;
}

/** A definition that is a row (not a group, list or page). Groups are the only items with `items`. */
function isRow(item: SettingDefinitionItem): item is SettingDefinition {
	return !isGroup(item) && !('items' in item);
}

/** Every row in a flat list, so a test can find one by name without walking groups twice. */
function flatten(definitions: readonly SettingDefinitionItem[]): readonly SettingDefinition[] {
	const flat: SettingDefinition[] = [];
	for (const item of definitions) {
		if (isRow(item)) {
			flat.push(item);
			continue;
		}
		if (isGroup(item) && item.items !== undefined) {
			flat.push(...item.items.filter(isRow));
		}
	}
	return flat;
}

function groupHeadings(definitions: readonly SettingDefinitionItem[]): readonly string[] {
	return definitions.filter(isGroup).map((group) => group.heading ?? '');
}

/** The bindings a test drives: a real store, an injected clipboard, and counters for both. */
function harness(options?: { readonly file?: unknown; readonly clipboard?: () => Promise<void> }) {
	const writes: unknown[] = [];
	const persistence: PersistencePort = {
		read: () => Promise.resolve(options?.file ?? null),
		write: (data) => {
			writes.push(data);
			return Promise.resolve();
		},
	};
	const clock = createFakeClock();
	const store: SettingsStore = createSettingsStore({ persistence, timers: clock });
	const notices: string[] = [];
	let refreshes = 0;
	const bindings: TabBindings = {
		settings: () => store.get(),
		defaultValue: (path) => readPath(DEFAULT_SETTINGS, path),
		write: (path, value) => {
			const row = SETTING_ROWS.find((candidate) => candidate.path === path);
			return row === undefined ? false : store.set(row.path, value);
		},
		refresh: () => {
			refreshes += 1;
		},
		copy: options?.clipboard ?? (() => Promise.resolve()),
		notify: (message) => notices.push(message),
		versions: () => versionsLine({ pluginVersion: '0.1.0', minAppVersion: '1.13.0' }),
		diagnostics: () =>
			diagnosticsBlob({
				pluginVersion: '0.1.0',
				minAppVersion: '1.13.0',
				noteCount: 12,
				settings: store.get(),
			}),
	};
	return {
		store,
		clock,
		writes,
		notices,
		bindings,
		refreshes: () => refreshes,
		definitions: () => buildSettingDefinitions(bindings),
	};
}

beforeEach(() => {
	createdSettings.length = 0;
	noticeLog.length = 0;
});

describe('the rows', () => {
	it('renders one definition per schema row, in schema order', () => {
		const { definitions } = harness();
		const items = flatten(definitions());
		const names = items.map((item) => item.name);
		const expected = [
			...SETTING_ROWS.map((row) => row.name),
			...SETTING_ROWS_WITHOUT_VALUE.filter((row) => row.section === 'advanced').map(
				(row) => row.name,
			),
		];
		// The advanced section holds both a value row and the two valueless ones, and the groups are built per
		// section — so the assertion is "every schema name appears exactly once", which is the property that
		// matters, plus the count.
		for (const name of expected) {
			expect(
				names.filter((candidate) => candidate === name),
				`row “${name}”`,
			).toHaveLength(1);
		}
		expect(items).toHaveLength(SETTING_ROWS.length + SETTING_ROWS_WITHOUT_VALUE.length);
		// And the rendered row names are exactly the schema's names, with nothing hand-written.
		expect([...names].sort()).toEqual([...expected].sort());
	});

	it('groups the rows into the schema’s sections, in order', () => {
		const { definitions } = harness();
		expect(groupHeadings(definitions())).toEqual(
			SETTINGS_SECTIONS.map((section) => section.heading),
		);
	});

	it('binds every value row to its own path, and no row twice', () => {
		const { definitions } = harness();
		const keys = controlKeys(definitions());
		// Every row whose control the framework draws. The flags row is the one exception: it draws its own
		// switches, so it carries a render function instead of a key — asserted here so the exception stays
		// deliberate.
		const drawn = SETTING_ROWS.filter((row) => row.control.kind !== 'flags');
		expect(keys).toEqual(drawn.map((row) => row.path));
		expect(
			SETTING_ROWS.filter((row) => row.control.kind === 'flags').map((row) => row.path),
		).toEqual(['advanced.experimental']);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('names each row and says what changing it does', () => {
		const { definitions } = harness();
		for (const item of flatten(definitions())) {
			expect(item.name.length).toBeGreaterThan(0);
			expect(item.desc, `no description for “${item.name}”`).toBeDefined();
			expect(typeof item.desc === 'string' ? item.desc.length : 0).toBeGreaterThan(40);
		}
	});
});

describe('the controls', () => {
	it('maps each control kind onto the API’s control of the same name', () => {
		const { definitions } = harness();
		const kinds = new Map<string, string>();
		for (const item of definitions()) {
			if (!isGroup(item) || item.items === undefined) {
				continue;
			}
			for (const child of item.items) {
				if ('control' in child && child.control !== undefined && child.control !== null) {
					kinds.set(child.control.key, child.control.type);
				}
			}
		}
		const byPath = new Map(SETTING_ROWS.map((row) => [row.path, row.control.kind]));
		for (const [path, kind] of byPath) {
			const expected = kind === 'flags' ? undefined : kind;
			if (expected !== undefined) {
				expect(kinds.get(path), `control for ${path}`).toBe(expected);
			}
		}
		// The flags row renders imperatively, and it is the only one that does.
		expect(kinds.has('advanced.experimental')).toBe(false);
	});

	it('carries the slider’s range, and keeps the unit in the description (1.13.0 has no displayFormat)', () => {
		const { definitions } = harness();
		const slider = definitions()
			.filter(isGroup)
			.flatMap((group) => group.items ?? [])
			.map((child) => ('control' in child ? child.control : undefined))
			.find((control) => control !== undefined && control.type === 'slider');
		expect(slider).toBeDefined();
		if (slider === undefined || slider.type !== 'slider') {
			return;
		}
		expect(slider.min).toBe(10);
		expect(slider.max).toBe(5000);
		expect(slider.step).toBe(10);
		// `displayFormat` is `@since 1.13.1`; the unit is in the row's description instead, and the range is
		// stated there too so the slider is usable without touching it.
		expect('displayFormat' in slider).toBe(false);
		const row = SETTING_ROWS.find(
			(candidate) => candidate.path === 'import.largeImportThreshold',
		);
		expect(row?.desc).toContain('10 to 5000');
		expect(row?.desc).toContain('row count');
	});

	it('refuses a folder that would leave the vault, and accepts one inside it', () => {
		expect(validateVaultFolder('Projects/Plan', 'rows.targetFolder')).toBeUndefined();
		expect(validateVaultFolder('', 'rows.targetFolder')).toBeUndefined();
		expect(validateVaultFolder('/etc', 'rows.targetFolder')).toContain('leading slash');
		expect(validateVaultFolder('../outside', 'rows.targetFolder')).toContain(
			'“..” would leave it',
		);
		// The validator only guards the folder row: it is not applied to the file-name template.
		expect(validateVaultFolder('/etc', 'rows.filenameTemplate')).toBeUndefined();
	});
});

describe('hiding, not disabling', () => {
	it('hides the threshold row while the warning is off, and shows it when it is on', () => {
		const { bindings, definitions } = harness();
		const rowFor = (name: string): SettingDefinition | undefined =>
			flatten(definitions()).find((item) => item.name === name);
		const visible = (name: string): boolean => {
			const row = rowFor(name);
			const predicate = row?.visible;
			return predicate === undefined
				? true
				: typeof predicate === 'function'
					? predicate()
					: predicate;
		};
		expect(visible('Warn before a large import')).toBe(true);
		expect(visible('Large import threshold')).toBe(true);
		// Turn the warning off: the threshold row is gone from the render, not greyed out.
		applyControlChange(bindings, 'import.warnOnLargeImport', false);
		expect(visible('Warn before a large import')).toBe(true);
		expect(visible('Large import threshold')).toBe(false);
		// And back on again.
		applyControlChange(bindings, 'import.warnOnLargeImport', true);
		expect(visible('Large import threshold')).toBe(true);
	});

	it('hides the experimental rows until a flag exists, then shows one switch per flag', () => {
		const { bindings, definitions } = harness();
		const hidden = flatten(definitions()).find((item) => item.name === 'Experimental features');
		const predicate = hidden?.visible;
		expect(
			predicate === undefined
				? true
				: typeof predicate === 'function'
					? predicate()
					: predicate,
		).toBe(false);
		expect(applyControlChange(bindings, 'advanced.experimental', { betaImport: true })).toBe(
			true,
		);
		// Rendering it draws one switch, wired to the store rather than to a local copy. `renderFor` is the
		// function the definition itself calls, so this drives the real wiring.
		const flagsRow = SETTING_ROWS.find((row) => row.path === 'advanced.experimental');
		expect(flagsRow).toBeDefined();
		if (flagsRow === undefined) {
			return;
		}
		expect(
			flatten(definitions()).find((item) => item.name === 'Experimental features')?.render,
		).toBeDefined();
		const probe = surface();
		renderFor(flagsRow, bindings)?.(probe.setting);
		expect(probe.toggles).toHaveLength(1);
		probe.toggles[0]?.click(false);
		expect(bindings.settings().advanced.experimental.betaImport).toBe(false);
	});
});

/**
 * A `Setting` as our render callbacks see it. They declare `SettingSurface` — the two things they touch — so
 * a test can build one without a browser, an Obsidian class or an assertion, and a real `Setting` satisfies
 * the same surface when Obsidian renders the row.
 */
type ProbeToggle = {
	value: boolean;
	onChange: ((value: boolean) => void) | null;
	click(value: boolean): void;
};

type SurfaceProbe = {
	readonly setting: SettingSurface;
	readonly lines: string[];
	readonly toggles: ProbeToggle[];
};

function surface(): SurfaceProbe {
	const lines: string[] = [];
	const toggles: ProbeToggle[] = [];
	const setting: SettingSurface = {
		controlEl: {
			setText: (text) => {
				lines.push(text);
			},
		},
		addToggle: (configure) => {
			const entry: ProbeToggle = { value: false, onChange: null, click: () => undefined };
			const toggle: ToggleSurface = {
				setValue(value) {
					entry.value = value;
					return toggle;
				},
				onChange(callback) {
					entry.onChange = callback;
					return toggle;
				},
			};
			entry.click = (value) => {
				entry.value = value;
				entry.onChange?.(value);
			};
			toggles.push(entry);
			configure(toggle);
			return undefined;
		},
	};
	return { setting, lines, toggles };
}

describe('a change reaches the save path once', () => {
	it('writes once after the debounce, for a control change', async () => {
		const { bindings, clock, writes } = harness();
		expect(applyControlChange(bindings, 'rows.targetFolder', 'Projects/Plan')).toBe(true);
		// The store debounces, so nothing is on disk yet — and exactly one timer is pending.
		expect(writes).toHaveLength(0);
		expect(clock.pending()).toBe(1);
		clock.runTimers();
		await Promise.resolve();
		expect(writes).toHaveLength(1);
		expect(writes[0]).toMatchObject({ rows: { targetFolder: 'Projects/Plan' } });
	});

	it('refreshes the predicates after a write, and does not refresh when the value was refused', () => {
		const { bindings, refreshes } = harness();
		applyControlChange(bindings, 'import.largeImportThreshold', 100);
		expect(refreshes()).toBe(1);
		applyControlChange(bindings, 'import.largeImportThreshold', 'soon');
		expect(refreshes()).toBe(1);
		applyControlChange(bindings, 'rows.notAThing', true);
		expect(refreshes()).toBe(1);
	});
});

describe('the versions row and Diagnostics', () => {
	it('shows the plugin version and the minimum app version', () => {
		expect(versionsLine({ pluginVersion: '0.1.0', minAppVersion: '1.13.0' })).toBe(
			'Tablify 0.1.0 · Obsidian 1.13.0 or newer',
		);
		const { definitions, bindings } = harness();
		const row = SETTING_ROWS_WITHOUT_VALUE.find(
			(candidate) => candidate.id === 'about.versions',
		);
		expect(row).toBeDefined();
		if (row === undefined) {
			return;
		}
		expect(
			flatten(definitions()).find((item) => item.name === 'Version')?.render,
		).toBeDefined();
		const probe = surface();
		renderFor(row, bindings)?.(probe.setting);
		expect(probe.lines).toEqual(['Tablify 0.1.0 · Obsidian 1.13.0 or newer']);
	});

	it('copies the blob and says so; a refused clipboard is a Notice, never a throw', async () => {
		const ok = harness();
		await runDiagnostics(ok.bindings);
		expect(ok.notices).toEqual(['Tablify: diagnostics copied to the clipboard.']);

		const refused = harness({ clipboard: () => Promise.reject(new Error('blocked')) });
		await runDiagnostics(refused.bindings);
		expect(refused.notices).toEqual([
			'Tablify: could not copy to the clipboard. Your system may be blocking it.',
		]);
	});

	it('contains versions, settings and a note count — and no secret, whatever a setting is called', () => {
		const settings: TablifySettings = {
			...DEFAULT_SETTINGS,
			advanced: { logLevel: 'off', experimental: {} },
		};
		const blob = diagnosticsBlob({
			pluginVersion: '0.1.0',
			minAppVersion: '1.13.0',
			noteCount: 12,
			settings,
		});
		const parsed = parseBlob(blob);
		expect(blob).toContain('"version": "0.1.0"');
		expect(blob).toContain('"notes": 12');
		expect(blob).toContain('"followObsidianTheme": false');
		// The guard fires on a secret-looking key, which is what keeps this honest when step 25 adds a sync
		// section: nothing about a credential can leave the device through this button.
		expect(looksSecret('apiKey')).toBe(true);
		expect(looksSecret('access_token')).toBe(true);
		expect(looksSecret('baseId')).toBe(false);
		expect(redactedSettings({ sync: { token: 'pat-123', baseId: 'app1' } })).toEqual({
			sync: { token: '<removed>', baseId: 'app1' },
		});
		expect(blob).not.toContain('baseId');
		expect(parsed).toMatchObject({ plugin: { name: 'Tablify', minAppVersion: '1.13.0' } });
	});

	it('sorts keys, so two reports of the same state are the same text', () => {
		const input = {
			pluginVersion: '0.1.0',
			minAppVersion: '1.13.0',
			noteCount: 1,
			settings: DEFAULT_SETTINGS,
		};
		expect(diagnosticsBlob(input)).toBe(diagnosticsBlob({ ...input }));
		expect(diagnosticsBlob(input).indexOf('"appearance"')).toBeLessThan(
			diagnosticsBlob(input).indexOf('"import"'),
		);
	});
});

describe('the tab’s host wiring', () => {
	/** The smallest host that satisfies the port: a store object, and counters for what it was asked. */
	function host(initial: unknown) {
		const written: { path: string; value: unknown }[] = [];
		const tabHost: SettingsTabHost = {
			store: {
				get: () => initial,
				set: (path, value) => {
					written.push({ path, value });
					return true;
				},
			},
			pluginVersion: '0.1.0',
			minAppVersion: '1.13.0',
			noteCount: () => 3,
		};
		return { tabHost, written };
	}

	it('narrows what the store hands back, and falls back to the defaults for a value that is not settings', () => {
		const real = host(DEFAULT_SETTINGS);
		expect(settingsOf(real.tabHost)).toBe(DEFAULT_SETTINGS);
		expect(isSettings(DEFAULT_SETTINGS)).toBe(true);
		for (const odd of [null, 'nope', 42, {}, { rows: {} }]) {
			expect(isSettings(odd), `isSettings(${JSON.stringify(odd)})`).toBe(false);
			expect(settingsOf(host(odd).tabHost)).toBe(DEFAULT_SETTINGS);
		}
	});

	it('writes only a path that is in the schema, and passes the value through unchanged', () => {
		const { tabHost, written } = host(DEFAULT_SETTINGS);
		expect(writeSetting(tabHost, 'rows.filenameTemplate', '{{Title}}')).toBe(true);
		expect(written).toEqual([{ path: 'rows.filenameTemplate', value: '{{Title}}' }]);
		expect(writeSetting(tabHost, 'rows.notASetting', 'x')).toBe(false);
		expect(writeSetting(tabHost, '__warning.0', false)).toBe(false);
		expect(written).toHaveLength(1);
	});
});

describe('the tab class', () => {
	it('is the API’s tab, with the three hooks the declarative renderer calls', () => {
		// At runtime `PluginSettingTab` here is the double, and the tab class was compiled against it: the
		// subclass relationship is real, not inferred.
		expect(Object.getPrototypeOf(TablifySettingTab)).toBe(PluginSettingTab);
		const prototype: object = TablifySettingTab.prototype;
		for (const method of ['getSettingDefinitions', 'getControlValue', 'setControlValue']) {
			expect(typeof Reflect.get(prototype, method), method).toBe('function');
		}
		// There is no `display()` override: the declarative path is the only render path (minAppVersion
		// 1.13.0), and the API deprecates it.
		expect(Object.getOwnPropertyNames(prototype).includes('display')).toBe(false);
	});
});
