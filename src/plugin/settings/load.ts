/**
 * Reading a settings file.
 *
 * `data.json` is user-editable — someone will open it in a text editor, and a sync service will one day
 * merge two of them. So this reader assumes nothing: no key need be present, no value need have the right
 * type, and a value written by a **newer** Tablify must survive a load/save cycle by this one. Three rules
 * carry that:
 *
 *  1. a key that is missing takes its default;
 *  2. a key whose type is wrong takes its default **and** produces a warning the tab shows once — silently
 *     discarding a value someone typed is worse than replacing it loudly;
 *  3. a key this version does not know is kept in a `passthrough` bag and written back on save, so an older
 *     build cannot destroy a newer build's settings by opening the vault.
 *
 * `migrate` is a pure function of the raw value, with a version table (see `MIGRATIONS`): it never touches
 * the disk, never throws, and never returns a settings object whose fields are `undefined`.
 */
import {
	DEFAULT_SETTINGS,
	SETTINGS_VERSION,
	SETTING_ROWS,
	cloneSettings,
	isRecord,
	readPath,
	writePath,
} from './schema';
import type { SettingRow, TablifySettings } from './schema';

/** One field that could not be read, in the words the tab shows. */
export type SettingsWarning = {
	/** The dotted path, or the key name for a top-level unknown value. */
	readonly path: string;
	/** `'defaulted'` — the value was unusable and the default is in its place. `'unknown'` — kept as it is. */
	readonly kind: 'defaulted' | 'unknown';
	readonly message: string;
};

export type LoadedSettings = {
	readonly settings: TablifySettings;
	/** Keys this version does not know, verbatim, to be written back unchanged on the next save. */
	readonly passthrough: Readonly<Record<string, unknown>>;
	/** The version the file carried, when it carried one. `undefined` means "no version field". */
	readonly migratedFrom?: number;
	readonly warnings: readonly SettingsWarning[];
};

/**
 * The version table. Each entry lifts a file **at** that version to the next one, and is applied in order,
 * so a `version: 0` file is lifted to 1 and a `version: 1` file is already current. A pure function per
 * entry: `(raw) => raw`. Nothing here may read the clock, the vault or the app.
 *
 * There is exactly one entry because there has only ever been one shape. The table exists anyway: the
 * second shape will need it, and a migration written after the fact is a migration that has to guess what
 * the old files looked like.
 */
export const MIGRATIONS: Readonly<
	Record<number, (raw: Record<string, unknown>) => Record<string, unknown>>
> = {
	0: (raw) => {
		// Version 0 is "no version field at all" — the shape a hand-written `data.json` has. It is lifted
		// verbatim; every value in it is read by the same validator as version 1, so nothing is guessed.
		return { ...raw, version: 1 };
	},
};

/** The shape `checkSettingValue` returns: the value to use, or the sentence saying why not. */
export type CheckedValue = { readonly value: unknown; readonly problem: string | null };

/**
 * What kind of value a control stores. The validator uses the control kind rather than a second table of
 * types, so a row cannot be added to the schema with a control whose values this file does not know how to
 * check. Exported because the store validates a change with exactly the same rule it uses on load — a value
 * that could not be read is also a value that may not be written.
 */
export function checkSettingValue(row: SettingRow, raw: unknown): CheckedValue {
	const control = row.control;
	switch (control.kind) {
		case 'toggle': {
			return typeof raw === 'boolean'
				? { value: raw, problem: null }
				: { value: null, problem: 'expected true or false' };
		}
		case 'text': {
			return typeof raw === 'string'
				? { value: raw, problem: null }
				: { value: null, problem: 'expected a piece of text' };
		}
		case 'dropdown': {
			// `Object.hasOwn` is ES2022 and this project's lib is ES2018; `in` is the ES2018 spelling and
			// reads the same for an object literal created here.
			return typeof raw === 'string' && raw in control.options
				? { value: raw, problem: null }
				: {
						value: null,
						problem: `expected one of ${Object.keys(control.options).join(', ')}`,
					};
		}
		case 'slider': {
			if (typeof raw !== 'number' || !Number.isFinite(raw)) {
				return { value: null, problem: 'expected a number' };
			}
			if (raw < control.min || raw > control.max) {
				return {
					value: null,
					problem: `expected a number between ${String(control.min)} and ${String(control.max)}`,
				};
			}
			return { value: raw, problem: null };
		}
		case 'flags': {
			if (!isRecord(raw)) {
				return { value: null, problem: 'expected an object of switch names' };
			}
			const flags: Record<string, boolean> = {};
			for (const [key, entry] of Object.entries(raw)) {
				// A flag whose value is not a boolean is dropped rather than defaulted: the flag has no
				// default of its own, and "off" is the only safe reading of an unreadable switch.
				if (typeof entry === 'boolean') {
					flags[key] = entry;
				}
			}
			return { value: flags, problem: null };
		}
		case 'info':
		case 'action': {
			return { value: null, problem: 'this row stores no value' };
		}
	}
}

/** Every top-level key the schema knows, for the passthrough split. */
const KNOWN_TOP_LEVEL_KEYS: readonly string[] = [
	'version',
	'rows',
	'import',
	'appearance',
	'legacy',
	'advanced',
];

/** Lifts a raw file to the current version, running each entry in order. Never throws. */
function migrate(raw: Record<string, unknown>): {
	readonly raw: Record<string, unknown>;
	readonly from?: number;
} {
	const version =
		typeof raw.version === 'number' && Number.isInteger(raw.version) ? raw.version : undefined;
	if (version === undefined) {
		// No version field is version 0, the shape hand-written files have.
		return { raw: MIGRATIONS[0]?.(raw) ?? raw, from: 0 };
	}
	if (version >= SETTINGS_VERSION) {
		// Current or newer: nothing is lifted and nothing is dropped. A newer file's unknown keys survive
		// through the passthrough bag, which is the whole point of not validating strictly.
		return { raw, from: version };
	}
	let current = raw;
	for (let step = version; step < SETTINGS_VERSION; step += 1) {
		const lift = MIGRATIONS[step];
		if (lift === undefined) {
			// A gap in the table: the file is left as it is and the validator fills the gaps with defaults.
			return { raw: current, from: version };
		}
		current = lift(current);
	}
	return { raw: current, from: version };
}

/**
 * Reads a settings file. The returned object is always complete, always the current version, and always
 * safe to hand to the tab.
 */
export function loadSettings(raw: unknown): LoadedSettings {
	const warnings: SettingsWarning[] = [];
	if (raw === null || raw === undefined) {
		return { settings: DEFAULT_SETTINGS, passthrough: {}, warnings };
	}
	if (!isRecord(raw)) {
		return {
			settings: DEFAULT_SETTINGS,
			passthrough: {},
			warnings: [
				{
					path: '',
					kind: 'defaulted',
					message:
						'the settings file does not contain an object, so every setting is at its default',
				},
			],
		};
	}

	const { raw: lifted, from } = migrate(raw);
	if (from !== undefined && from > SETTINGS_VERSION) {
		warnings.push({
			path: 'version',
			kind: 'unknown',
			message: `this settings file was written by a newer version of Tablify (${String(from)}); it is left as it is and read as best it can be`,
		});
	}

	// Start from the defaults, then fill in the values that could be read. `cloneSettings` gives every level
	// a fresh addressable object, `writePath` puts a value at a dotted path, and neither needs an assertion.
	const settings = cloneSettings(DEFAULT_SETTINGS);
	for (const row of SETTING_ROWS) {
		const stored = readPath(lifted, row.path);
		// A key that is absent is not a mistake and must not warn: it is what a fresh install looks like.
		if (stored === undefined) {
			continue;
		}
		const checked = checkSettingValue(row, stored);
		if (checked.problem === null) {
			writePath(settings, row.path, checked.value);
			continue;
		}
		warnings.push({
			path: row.path,
			kind: 'defaulted',
			message: `“${row.name}” keeps its default (${describeDefault(readPath(DEFAULT_SETTINGS, row.path))}): the stored value ${checked.problem}.`,
		});
	}

	const passthrough: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(lifted)) {
		if (!KNOWN_TOP_LEVEL_KEYS.includes(key)) {
			passthrough[key] = value;
			warnings.push({
				path: key,
				kind: 'unknown',
				message: `“${key}” is not a setting this version knows; it is kept exactly as it is and written back on the next save.`,
			});
		}
	}
	// An older file's `version` is replaced by the current one on the next save, which is the point of a
	// migration; anything else at the top level is preserved.
	settings.version = SETTINGS_VERSION;

	return {
		settings,
		passthrough,
		...(from === undefined ? {} : { migratedFrom: from }),
		warnings,
	};
}

/** The default, written the way a settings row would show it. Used in the warning above. */
function describeDefault(value: unknown): string {
	if (typeof value === 'boolean') {
		return value ? 'on' : 'off';
	}
	if (typeof value === 'string') {
		return value === '' ? 'empty' : value;
	}
	if (typeof value === 'number') {
		return String(value);
	}
	return 'its default';
}
