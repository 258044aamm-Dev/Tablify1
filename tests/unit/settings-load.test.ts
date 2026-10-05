/**
 * Reading and writing `data.json`.
 *
 * The migration table the step asks for is the first describe block: six inputs, each with the settings that
 * come out and the warning that comes with them. Everything after it is the store's side — the debounce, the
 * "write only when it changed" rule and the passthrough invariant — because those are the three ways a
 * settings file gets corrupted, and each one is one test away from being obvious.
 */
import { describe, expect, it } from 'vitest';

import {
	DEFAULT_SETTINGS,
	SETTINGS_VERSION,
	SETTING_PATHS,
	cloneSettings,
	readPath,
	settingRowFor,
} from '../../src/plugin/settings/schema';
import type { TablifySettings } from '../../src/plugin/settings/schema';
import { MIGRATIONS, loadSettings } from '../../src/plugin/settings/load';
import {
	SETTINGS_SAVE_DEBOUNCE_MS,
	createSettingsStore,
	payloadFor,
	withoutUndefined,
} from '../../src/plugin/settings/save';
import type { PersistencePort } from '../../src/plugin/settings/save';
import { createFakeClock } from '../fakes/clock';

/** A persistence port that records what it was asked to write, and can be told to fail. */
function fakePersistence(initial: unknown = null): PersistencePort & {
	readonly writes: unknown[];
	readonly writeCount: () => number;
	readOnly: boolean;
} {
	const writes: unknown[] = [];
	let fail = false;
	return {
		writes,
		writeCount: () => writes.length,
		get readOnly() {
			return fail;
		},
		set readOnly(value: boolean) {
			fail = value;
		},
		read: () => Promise.resolve(initial),
		write: (data) => {
			if (fail) {
				return Promise.reject(new Error('disk is read-only'));
			}
			writes.push(data);
			return Promise.resolve();
		},
	};
}

/** The value at a path, for the one-line assertions below (`readPath` returns `unknown`). */
function valueAt(settings: TablifySettings, path: string): unknown {
	return readPath(settings, path);
}

describe('the migration table', () => {
	it('{} → every default, no warning', () => {
		const loaded = loadSettings({});
		expect(loaded.settings).toEqual(DEFAULT_SETTINGS);
		expect(loaded.warnings).toEqual([]);
		// An empty object is a file with no version field, which is version 0 — so it is reported as migrated
		// from 0 rather than as "never had a version". A **missing** file is the different case: it has no
		// version either, and `loadSettings(null)` reports nothing at all.
		expect(loaded.migratedFrom).toBe(0);
		expect(loadSettings(null).migratedFrom).toBeUndefined();
	});

	it('a partial file → the stored values, the rest at their defaults', () => {
		const loaded = loadSettings({ rows: { targetFolder: 'Projects/Plan' } });
		expect(loaded.settings.rows.targetFolder).toBe('Projects/Plan');
		expect(loaded.settings.rows.filenameTemplate).toBe(DEFAULT_SETTINGS.rows.filenameTemplate);
		expect(loaded.settings.import).toEqual(DEFAULT_SETTINGS.import);
		expect(loaded.warnings).toEqual([]);
	});

	it('a wrong type → the default, and one warning naming the row and the reason', () => {
		const loaded = loadSettings({
			import: { largeImportThreshold: 'many', warnOnLargeImport: 'yes' },
			appearance: { defaultRowHeight: 'enormous' },
		});
		expect(loaded.settings.import.largeImportThreshold).toBe(250);
		expect(loaded.settings.import.warnOnLargeImport).toBe(true);
		expect(loaded.settings.appearance.defaultRowHeight).toBe('medium');
		expect(loaded.warnings.map((warning) => warning.path)).toEqual([
			'import.warnOnLargeImport',
			'import.largeImportThreshold',
			'appearance.defaultRowHeight',
		]);
		expect(loaded.warnings[0]?.kind).toBe('defaulted');
		expect(loaded.warnings[0]?.message).toContain('Warn before a large import');
		expect(loaded.warnings[0]?.message).toContain('keeps its default (on)');
		expect(loaded.warnings[1]?.message).toContain('expected a number');
		expect(loaded.warnings[2]?.message).toContain('expected one of short, medium, tall');
	});

	it('an out-of-range number → the default, with the range in the warning', () => {
		const loaded = loadSettings({ import: { largeImportThreshold: 999999 } });
		expect(loaded.settings.import.largeImportThreshold).toBe(250);
		expect(loaded.warnings[0]?.message).toContain('between 10 and 5000');
	});

	it('unknown keys → kept in passthrough, warned, and written back on the next save', async () => {
		const loaded = loadSettings({
			somethingNewer: { deep: [1, 2, 3] },
			rows: { targetFolder: 'Notes' },
		});
		expect(loaded.passthrough).toEqual({ somethingNewer: { deep: [1, 2, 3] } });
		expect(loaded.warnings.map((warning) => warning.kind)).toEqual(['unknown']);
		expect(loaded.warnings[0]?.message).toContain('written back on the next save');

		// The store reads the *file*, so the file is what the port is given — the passthrough has to come
		// through a real load, not through a value the test assembled.
		const persistence = fakePersistence({
			somethingNewer: { deep: [1, 2, 3] },
			rows: { targetFolder: 'Notes' },
		});
		const clock = createFakeClock();
		const store = createSettingsStore({ persistence, timers: clock });
		await store.load();
		expect(store.set('rows.targetFolder', 'Notes/Plan')).toBe(true);
		clock.advance(SETTINGS_SAVE_DEBOUNCE_MS);
		await store.flush();
		expect(persistence.writes).toHaveLength(1);
		expect(persistence.writes[0]).toMatchObject({
			somethingNewer: { deep: [1, 2, 3] },
			version: 1,
		});
	});

	it('version 0 → lifted to the current version by `MIGRATIONS[0]`, without changing a value', () => {
		const loaded = loadSettings({
			rows: { filenameTemplate: '{{Title}}' },
			appearance: { followObsidianTheme: true },
		});
		expect(loaded.migratedFrom).toBe(0);
		expect(loaded.settings.version).toBe(SETTINGS_VERSION);
		expect(loaded.settings.rows.filenameTemplate).toBe('{{Title}}');
		expect(loaded.settings.appearance.followObsidianTheme).toBe(true);
		expect(loaded.warnings).toEqual([]);
		// The migration is pure: the same input gives the same output, twice.
		expect(loadSettings({ rows: { filenameTemplate: '{{Title}}' } }).settings).toEqual(
			loadSettings({ rows: { filenameTemplate: '{{Title}}' } }).settings,
		);
		expect(MIGRATIONS[0]?.({ a: 1 })).toEqual({ a: 1, version: 1 });
	});

	it('a future version → nothing is changed, nothing throws, and one warning says so', () => {
		const raw = { version: 99, rows: { targetFolder: 'Kept' }, futureSection: { x: true } };
		const loaded = loadSettings(raw);
		expect(loaded.migratedFrom).toBe(99);
		expect(loaded.settings.rows.targetFolder).toBe('Kept');
		expect(loaded.settings.version).toBe(SETTINGS_VERSION);
		expect(loaded.passthrough).toEqual({ futureSection: { x: true } });
		expect(loaded.warnings).toHaveLength(2);
		expect(loaded.warnings[0]).toMatchObject({ path: 'version', kind: 'unknown' });
		expect(loaded.warnings[0]?.message).toContain('newer version');
		// A save by this version writes the keys it does not understand and its own version number.
		expect(payloadFor(loaded.settings, loaded.passthrough)).toMatchObject({
			futureSection: { x: true },
			version: 1,
		});
	});

	it('a settings file that is not an object → defaults and one warning, never a throw', () => {
		for (const raw of [null, undefined, 'nonsense', 42, [1, 2]]) {
			const loaded = loadSettings(raw);
			expect(loaded.settings).toEqual(DEFAULT_SETTINGS);
		}
		expect(loadSettings('nonsense').warnings).toHaveLength(1);
		expect(loadSettings(null).warnings).toEqual([]);
	});
});

describe('the schema and the defaults', () => {
	it('every declared path has a default that is not undefined', () => {
		for (const path of SETTING_PATHS) {
			expect(valueAt(DEFAULT_SETTINGS, path), `no default for ${path}`).not.toBeUndefined();
		}
	});

	it('every default survives a load/save cycle unchanged', () => {
		const payload = payloadFor(DEFAULT_SETTINGS, {});
		const round = loadSettings(JSON.parse(JSON.stringify(payload)));
		expect(round.settings).toEqual(DEFAULT_SETTINGS);
		expect(round.warnings).toEqual([]);
	});

	it('resolve the value rows by path, and refuse a path that is not in the schema', () => {
		expect(settingRowFor('rows.filenameTemplate')?.section).toBe('rows');
		expect(settingRowFor('not.a.setting')).toBeNull();
		expect(settingRowFor('rows')).toBeNull();
	});

	it('carry a description that says what changes, not what the setting is', () => {
		for (const path of SETTING_PATHS) {
			const row = settingRowFor(path);
			expect(row?.desc.length, `short description for ${path}`).toBeGreaterThan(40);
		}
	});
});

describe('the store', () => {
	function storeWith(initial: unknown) {
		const persistence = fakePersistence(initial);
		const clock = createFakeClock();
		const store = createSettingsStore({ persistence, timers: clock });
		return { persistence, clock, store };
	}

	it('writes nothing when nothing changed', async () => {
		const { store, persistence, clock } = storeWith({ rows: { targetFolder: 'Notes' } });
		await store.load();
		clock.advance(2000);
		await store.flush();
		expect(persistence.writeCount()).toBe(0);
	});

	it('writes once after the debounce, and once per burst, not once per change', async () => {
		const { store, persistence, clock } = storeWith(null);
		await store.load();
		expect(store.set('rows.targetFolder', 'A')).toBe(true);
		expect(store.set('rows.targetFolder', 'AB')).toBe(true);
		expect(store.set('rows.targetFolder', 'ABC')).toBe(true);
		expect(clock.pending()).toBe(1);
		expect(persistence.writeCount()).toBe(0);

		clock.advance(SETTINGS_SAVE_DEBOUNCE_MS);
		await store.flush();
		expect(persistence.writeCount()).toBe(1);
		const written = persistence.writes[0];
		expect(written).toMatchObject({ rows: { targetFolder: 'ABC' } });
		expect(store.get().rows.targetFolder).toBe('ABC');
	});

	it('writes again only when the value really changed', async () => {
		const { store, persistence, clock } = storeWith(null);
		await store.load();
		store.set('rows.targetFolder', 'A');
		clock.advance(SETTINGS_SAVE_DEBOUNCE_MS);
		expect(persistence.writeCount()).toBe(1);
		// Back to where it started: the file already holds this value, so the second write is skipped.
		store.set('rows.targetFolder', '');
		clock.advance(SETTINGS_SAVE_DEBOUNCE_MS);
		expect(persistence.writeCount()).toBe(1);
		store.set('rows.targetFolder', 'B');
		clock.advance(SETTINGS_SAVE_DEBOUNCE_MS);
		expect(persistence.writeCount()).toBe(2);
	});

	it('refuses a value the validator refuses', async () => {
		const { store, persistence, clock } = storeWith(null);
		await store.load();
		expect(store.set('import.largeImportThreshold', 12)).toBe(true);
		expect(store.set('import.largeImportThreshold', 'soon')).toBe(false);
		expect(store.set('import.largeImportThreshold', 900000)).toBe(false);
		expect(store.get().import.largeImportThreshold).toBe(12);
		clock.advance(SETTINGS_SAVE_DEBOUNCE_MS);
		expect(persistence.writeCount()).toBe(1);
	});

	it('keeps the change in memory and retries the write when the disk refuses', async () => {
		const persistence = fakePersistence(null);
		const clock = createFakeClock();
		const errors: unknown[] = [];
		const store = createSettingsStore({
			persistence,
			timers: clock,
			onError: (error) => errors.push(error),
		});
		await store.load();
		persistence.readOnly = true;
		store.set('rows.targetFolder', 'Notes');
		clock.advance(SETTINGS_SAVE_DEBOUNCE_MS);
		await store.flush();
		await Promise.resolve();
		expect(errors).toHaveLength(1);
		// The value the person chose is still there, and the next flush tries again.
		expect(store.get().rows.targetFolder).toBe('Notes');
		persistence.readOnly = false;
		await store.flush();
		expect(persistence.writeCount()).toBe(1);
		expect(persistence.writes[0]).toMatchObject({ rows: { targetFolder: 'Notes' } });
	});

	it('notifies listeners once per accepted change and never during a load', async () => {
		const { store } = storeWith({ rows: { targetFolder: 'Notes' } });
		const calls: number[] = [];
		store.subscribe(() => calls.push(1));
		await store.load();
		expect(calls).toHaveLength(0);
		store.set('rows.targetFolder', 'Notes/Plan');
		store.set('rows.targetFolder', 'Notes/Plan 2');
		expect(calls).toHaveLength(2);
		store.set('rows.targetFolder', 'Notes/Plan 2');
		expect(calls).toHaveLength(2);
	});

	it('drops a pending write on dispose, and clears the listeners', async () => {
		const { store, persistence, clock } = storeWith(null);
		await store.load();
		store.set('rows.targetFolder', 'Gone');
		store.dispose();
		expect(clock.pending()).toBe(0);
		await store.flush();
		expect(persistence.writeCount()).toBe(0);
	});
});

describe('the payload', () => {
	it('never contains an undefined value', () => {
		const settings = cloneSettings(DEFAULT_SETTINGS);
		// An extra key that a hand-written file could have, holding nothing.
		const withHole: Record<string, unknown> = payloadFor(settings, {});
		withHole.dangling = undefined;
		const clean = withoutUndefined(withHole);
		expect(Object.keys(clean)).not.toContain('dangling');
		expect(JSON.stringify(clean)).not.toContain('undefined');
	});

	it('lets a passthrough key through but never a version', () => {
		const payload = payloadFor(DEFAULT_SETTINGS, { version: 99, extra: 'kept' });
		expect(payload.version).toBe(SETTINGS_VERSION);
		expect(payload.extra).toBe('kept');
	});

	it('round-trips a fully customised settings object through JSON unchanged', () => {
		// Every setting off its default, one line each, so the round trip cannot pass by accident.
		const customised: TablifySettings = {
			...cloneSettings(DEFAULT_SETTINGS),
			rows: {
				targetFolder: 'Projects/Plan',
				filenameTemplate: '{{Title}}',
				dateFormat: 'locale',
			},
			import: {
				warnOnLargeImport: false,
				largeImportThreshold: 10,
				inferTypes: false,
				clipboardPasteMode: 'ask',
			},
			appearance: {
				followObsidianTheme: true,
				defaultRowHeight: 'tall',
				motionPreference: 'reduce',
			},
			legacy: { showMigrationEntryPoints: false },
			advanced: { logLevel: 'debug', experimental: { betaImport: true } },
		};
		const round = loadSettings(JSON.parse(JSON.stringify(payloadFor(customised, {}))));
		expect(round.settings).toEqual(customised);
		expect(round.warnings).toEqual([]);
	});
});
