/**
 * Writing a settings file.
 *
 * A settings file is written on a **click path**, not a typing path: nobody types into a dropdown, so the
 * debounce here exists only to merge the burst of writes a slider produces while it is dragged. It is longer
 * than the write queue's 250 ms on purpose (see `SETTINGS_SAVE_DEBOUNCE_MS`).
 *
 * Three rules, each with a test:
 *
 *  - **the file is written only when its serialised value changed**, so opening the settings tab does not
 *    touch the disk and a change that ends where it started leaves the file alone;
 *  - **`undefined` is never written** — it is stripped on the way out, because `JSON.stringify` would drop
 *    the key silently and leave a file with a hole in it;
 *  - **a key that came from `passthrough` is written back verbatim** and can never be set through this
 *    store: a value this version does not understand is not a value it may edit.
 */
import {
	DEFAULT_SETTINGS,
	SETTINGS_VERSION,
	cloneSettings,
	readPath,
	settingRowFor,
	writePath,
} from './schema';
import type { SettingPath, TablifySettings } from './schema';
import { checkSettingValue, loadSettings } from './load';
import type { SettingsWarning } from './load';

/**
 * How long a burst of settings changes is merged before the file is written. The docs name no interval for
 * plugin settings; the write queue's 250 ms is tuned for someone typing in a cell, and a slider drag is not
 * that, so this doubles it. One named constant, so the number has one home.
 */
export const SETTINGS_SAVE_DEBOUNCE_MS = 500;

/** Where the file lives: `Plugin.loadData()` / `Plugin.saveData()`, the `data.json` beside the manifest. */
export type PersistencePort = {
	readonly read: () => Promise<unknown>;
	readonly write: (data: unknown) => Promise<void>;
};

export type SettingsStore = {
	/** Reads the file once and adopts it. Resolves with what the tab should show. */
	readonly load: () => Promise<{
		readonly settings: TablifySettings;
		readonly warnings: readonly SettingsWarning[];
	}>;
	/** The current settings. Always complete, always the current version. */
	readonly get: () => TablifySettings;
	/** What the last load could not read. The tab shows these once and then clears them. */
	readonly warnings: () => readonly SettingsWarning[];
	readonly clearWarnings: () => void;
	/** Sets one setting by its path. Returns false when the path or the value is not accepted. */
	readonly set: (path: SettingPath, value: unknown) => boolean;
	/** Called once per accepted change, and never during a load. */
	readonly subscribe: (listener: () => void) => () => void;
	/** Writes now if anything is pending. Safe to call twice; resolves when the file is current. */
	readonly flush: () => Promise<void>;
	/** Drops a pending write without writing it: the plugin is unloading mid-debounce. */
	readonly dispose: () => void;
	/** How many writes have reached the port. Diagnostics uses it; tests assert on it. */
	readonly writeCount: () => number;
};

/** The two timing primitives the settings store needs, so tests inject the fake clock. */
export type TimerPort = {
	setTimer(callback: () => void, ms: number): number;
	clearTimer(id: number): void;
};

export type SettingsStoreOptions = {
	readonly persistence: PersistencePort;
	/** Defaults to the real timers; tests pass `tests/fakes/clock.ts`. */
	readonly timers?: TimerPort;
	readonly debounceMs?: number;
	/** Called after a failed write. Defaults to silence: the store never prints. */
	readonly onError?: (error: unknown) => void;
};

/** Real timers by default. `setTimeout`/`clearTimeout` are DOM globals and typed as numbers. */
const DEFAULT_TIMERS: TimerPort = {
	setTimer: (callback, ms) => window.setTimeout(callback, ms),
	clearTimer: (id) => {
		window.clearTimeout(id);
	},
};

/**
 * Removes every `undefined` from a payload on its way to disk. `JSON.stringify` would drop such a key
 * silently; doing it here means the object that goes to the port is the object that lands in the file.
 */
export function withoutUndefined(value: Record<string, unknown>): Record<string, unknown> {
	const clean: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (entry !== undefined) {
			clean[key] = stripUndefined(entry);
		}
	}
	return clean;
}

/** The recursive half: nested objects are records too, and an array keeps its length. */
function stripUndefined(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => stripUndefined(entry));
	}
	if (typeof value !== 'object' || value === null) {
		return value;
	}
	const clean: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (entry !== undefined) {
			clean[key] = stripUndefined(entry);
		}
	}
	return clean;
}

/**
 * The object that goes to disk: the current settings, every passthrough key exactly as it was read, and the
 * current version last so that nothing can override it. A file that was migrated is written as a current
 * file; a file that was newer keeps its unknown keys and is written back with our version number, which is
 * the honest statement — this build did write it.
 */
export function payloadFor(
	settings: TablifySettings,
	passthrough: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
	return {
		...cloneSettings(settings),
		...passthrough,
		version: SETTINGS_VERSION,
	};
}

/**
 * The store. It owns the in-memory settings, the passthrough bag, the warnings from the last load and the
 * debounce. Nothing else in the plugin writes `data.json`, and nothing else keeps a copy of the settings.
 */
export function createSettingsStore(options: SettingsStoreOptions): SettingsStore {
	const timers = options.timers ?? DEFAULT_TIMERS;
	const debounceMs = options.debounceMs ?? SETTINGS_SAVE_DEBOUNCE_MS;

	let settings: TablifySettings = DEFAULT_SETTINGS;
	let passthrough: Record<string, unknown> = {};
	let warnings: SettingsWarning[] = [];
	let dirty = false;
	let timer: number | null = null;
	let lastWritten: string | null = null;
	let writes = 0;
	const listeners = new Set<() => void>();

	const notify = (): void => {
		for (const listener of [...listeners]) {
			listener();
		}
	};

	const writeNow = async (): Promise<void> => {
		if (timer !== null) {
			timers.clearTimer(timer);
			timer = null;
		}
		if (!dirty) {
			return;
		}
		const payload = withoutUndefined(payloadFor(settings, passthrough));
		const serialised = JSON.stringify(payload);
		dirty = false;
		if (serialised === lastWritten) {
			// The disk already holds this exact value: the change ended where it started (`largeImportThreshold`
			// dragged to its own number, say). Nothing to write.
			return;
		}
		try {
			await options.persistence.write(payload);
			lastWritten = serialised;
			writes += 1;
		} catch (error) {
			// The change stays in memory and the flag goes back on, so the next change — or an explicit
			// flush — tries again rather than losing the value the person just chose.
			dirty = true;
			options.onError?.(error);
		}
	};

	const schedule = (): void => {
		dirty = true;
		if (timer !== null) {
			timers.clearTimer(timer);
		}
		timer = timers.setTimer(() => {
			timer = null;
			void writeNow();
		}, debounceMs);
	};

	return {
		async load() {
			const raw: unknown = await options.persistence.read();
			const loaded = loadSettings(raw);
			settings = loaded.settings;
			passthrough = { ...loaded.passthrough };
			warnings = [...loaded.warnings];
			// What we just read is what the disk holds, so an untouched tab writes nothing.
			lastWritten = JSON.stringify(withoutUndefined(payloadFor(settings, passthrough)));
			return { settings, warnings };
		},

		get: () => settings,
		warnings: () => warnings,
		clearWarnings: () => {
			warnings = [];
		},
		writeCount: () => writes,

		set(path, value) {
			// A path that is not in the schema may not be written through here: the runtime half of the rule
			// that a passthrough key is never editable. The compiler already refuses a typed path that does
			// not exist; this refuses one that arrives as a string.
			const row = settingRowFor(path);
			if (row === null) {
				return false;
			}
			const checked = checkSettingValue(row, value);
			if (checked.problem !== null) {
				return false;
			}
			// A value equal to the one already stored is accepted and does nothing: no listener fires (the tab
			// has nothing to re-render), and the file is not marked dirty (it already holds this value).
			if (JSON.stringify(readPath(settings, path)) === JSON.stringify(checked.value)) {
				return true;
			}
			const next = cloneSettings(settings);
			writePath(next, path, checked.value);
			settings = next;
			schedule();
			notify();
			return true;
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},

		flush: writeNow,

		dispose() {
			if (timer !== null) {
				timers.clearTimer(timer);
				timer = null;
			}
			dirty = false;
			listeners.clear();
		},
	};
}
