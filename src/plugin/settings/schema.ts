/**
 * The settings schema — one declaration per setting, and the only place a setting is described.
 *
 * Everything else is derived from this file: the defaults (`DEFAULT_SETTINGS`), the validator (`load.ts`),
 * the tab's rows (`TablifySettingTab`) and the tests that assert "one row per setting". Adding a setting is
 * therefore two edits in the same commit: one entry here, one line in the type below. If a third edit is
 * ever needed, the schema is not doing its job.
 *
 * **What does not live here.** Column widths, column order, the row height a *view* uses, grouping and the
 * per-view filter state live in the `.tablify` document, in that table's view object (`docs/03` §view
 * config; the split is written down as data in `src/plugin/viewState.ts`), not in `data.json`. The one
 * row-height entry below is named `defaultRowHeight` for exactly that reason: it is the value a **new**
 * view starts from, and the value a view actually uses is the `density` its own view object stores. The
 * temptation to put a live view setting in `data.json` is the thing `docs/03` warns against, and it is
 * reported, not taken.
 *
 * **What may never live here.** A token, a secret, anything that identifies an account, and anything that
 * looks like analytics (`docs/09` §what may be stored). The optional sync token of a later milestone goes to
 * `SecretStorage`; no field in this file may ever be its home.
 */
/**
 * The settings object, as the rest of the plugin sees it. Every field has a value: there is no `undefined`
 * anywhere, which is what makes "missing keys take their default" a property of the type rather than a
 * convention each reader has to remember.
 *
 * The sections mirror the tab's sections, and the paths a control is bound to read exactly like the field
 * they write (`import.largeImportThreshold`), so the JSON in `data.json` needs no translation to be read.
 */
export type TablifySettings = {
	readonly version: number;
	readonly rows: {
		/** Empty means the vault root. */
		readonly targetFolder: string;
		readonly filenameTemplate: string;
		readonly dateFormat: DateFormatId;
	};
	readonly import: {
		readonly warnOnLargeImport: boolean;
		readonly largeImportThreshold: number;
		readonly inferTypes: boolean;
		readonly clipboardPasteMode: PasteModeId;
	};
	readonly appearance: {
		readonly followObsidianTheme: boolean;
		readonly defaultRowHeight: RowHeightId;
		readonly motionPreference: MotionPreferenceId;
	};
	readonly legacy: {
		readonly showMigrationEntryPoints: boolean;
	};
	readonly advanced: {
		readonly logLevel: LogLevelId;
		readonly experimental: Readonly<Record<string, boolean>>;
	};
};

/** The current on-disk shape. Bump it only with a migration in `load.ts`. */
export const SETTINGS_VERSION = 1;

export type DateFormatId = 'iso' | 'dayFirst' | 'monthFirst' | 'locale';
export type PasteModeId = 'expand' | 'fill' | 'ask';
export type RowHeightId = 'short' | 'medium' | 'tall';
export type MotionPreferenceId = 'system' | 'reduce' | 'full';
export type LogLevelId = 'off' | 'error' | 'warn' | 'info' | 'debug';

export type SettingsSectionId = 'rows' | 'import' | 'appearance' | 'legacy' | 'advanced';

/** One settings section, in the order the tab renders it. */
export type SettingsSection = {
	readonly id: SettingsSectionId;
	/** The heading the tab shows for this section. */
	readonly heading: string;
	/** One line under the heading, naming what the section decides. */
	readonly description: string;
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
	{
		id: 'rows',
		heading: 'Rows and files',
		description:
			'Where a new note goes and what it is called. Applies to paste, import and the legacy migration.',
	},
	{
		id: 'import',
		heading: 'Import and export',
		description: 'What happens before and while a table comes in from a file or the clipboard.',
	},
	{
		id: 'appearance',
		heading: 'Appearance',
		description:
			'How the grid looks and moves. These are starting values; a view can override them.',
	},
	{
		id: 'legacy',
		heading: 'Legacy files',
		description: 'The read-only import path for the older single-file format.',
	},
	{
		id: 'advanced',
		heading: 'Advanced',
		description:
			'Diagnostics and unfinished features. Everything here is optional and reversible.',
	},
];

/** A setting's value, as it is stored. No setting is ever `undefined`; `null` is not a value either. */
export type SettingValue = string | number | boolean | Readonly<Record<string, boolean>>;

/**
 * The control a row renders. `info` and `action` carry no value: the first is a read-only line, the second
 * is a button. `flags` is the one control with a variable number of switches — it edits the keys of an
 * `experimental`-style record, so a flag added in a later version appears without touching this file.
 */
export type SettingControl =
	| { readonly kind: 'toggle' }
	| { readonly kind: 'text'; readonly placeholder: string }
	| { readonly kind: 'dropdown'; readonly options: Readonly<Record<string, string>> }
	| {
			readonly kind: 'slider';
			readonly min: number;
			readonly max: number;
			readonly step: number;
			readonly unit: string;
	  }
	| { readonly kind: 'flags' }
	| { readonly kind: 'info' }
	| { readonly kind: 'action' };

/** Every value-bearing path, spelled out so a typo is a compile error rather than a silent default. */
export type SettingPath =
	| 'rows.targetFolder'
	| 'rows.filenameTemplate'
	| 'rows.dateFormat'
	| 'import.warnOnLargeImport'
	| 'import.largeImportThreshold'
	| 'import.inferTypes'
	| 'import.clipboardPasteMode'
	| 'appearance.followObsidianTheme'
	| 'appearance.defaultRowHeight'
	| 'appearance.motionPreference'
	| 'legacy.showMigrationEntryPoints'
	| 'advanced.logLevel'
	| 'advanced.experimental';

/**
 * The defaults, written out once. A default is a **value**, never `undefined`: a settings file that loses a
 * key must fall back to something a person could have chosen deliberately, and the fallbacks are also what
 * the tab shows when a file is missing entirely.
 *
 * Two of them are worth their comment. `largeImportThreshold: 250` is the number `docs/01` names for the
 * large-import warning. `clipboardPasteMode: 'expand'` is the behaviour of every spreadsheet a person has
 * used: pasting below the last row makes room.
 */
export const DEFAULT_SETTINGS: TablifySettings = Object.freeze({
	version: SETTINGS_VERSION,
	rows: Object.freeze({
		targetFolder: '',
		filenameTemplate: '{{Name}}',
		dateFormat: 'iso',
	}),
	import: Object.freeze({
		warnOnLargeImport: true,
		largeImportThreshold: 250,
		inferTypes: true,
		clipboardPasteMode: 'expand',
	}),
	appearance: Object.freeze({
		followObsidianTheme: false,
		defaultRowHeight: 'medium',
		motionPreference: 'system',
	}),
	legacy: Object.freeze({
		showMigrationEntryPoints: true,
	}),
	advanced: Object.freeze({
		logLevel: 'off',
		experimental: Object.freeze({}),
	}),
});

/** A row that carries a value. `info` and `action` rows are `SettingRowWithoutValue`. */
export type SettingRow = {
	readonly path: SettingPath;
	readonly section: SettingsSectionId;
	/** The row's name, in the tab. */
	readonly name: string;
	/** What changing it does — not what it is. A description that restates the name is a bug. */
	readonly desc: string;
	readonly control: SettingControl;
	/** Extra words Obsidian's settings search matches on. */
	readonly aliases: readonly string[];
	/**
	 * Hidden — never disabled — while this returns false. `docs/01` §views and `prompts/step-14` item 4 both
	 * require hiding, because a disabled control implies a value that could be turned on somewhere else.
	 */
	readonly visibleWhen?: (settings: TablifySettings) => boolean;
};

/** A read-only or action row: no value, so no default and no validator. */
export type SettingRowWithoutValue = {
	readonly id: string;
	readonly section: SettingsSectionId;
	readonly name: string;
	readonly desc: string;
	readonly control: SettingControl;
	readonly aliases: readonly string[];
	readonly visibleWhen?: (settings: TablifySettings) => boolean;
};

/**
 * The rows, in render order. Section membership and order come from `SETTINGS_SECTIONS`, so a row placed in
 * a section that is not declared is a compile error.
 */
export const SETTING_ROWS: readonly SettingRow[] = [
	{
		path: 'rows.targetFolder',
		section: 'rows',
		name: 'Folder for new notes',
		desc: 'Where a created note is written. Leave it empty to use the vault root; the folder must already exist.',
		control: { kind: 'text', placeholder: 'e.g. Projects/Project plan' },
		aliases: ['path', 'destination'],
	},
	{
		path: 'rows.filenameTemplate',
		section: 'rows',
		name: 'File name template',
		desc: 'The name a new note gets. {{Column}} is replaced by that column’s value in the row; an empty or unfilled template falls back to “Row 1”, “Row 2”, and so on.',
		control: { kind: 'text', placeholder: '{{Name}}' },
		aliases: ['title', 'pattern', 'note name'],
	},
	{
		path: 'rows.dateFormat',
		section: 'rows',
		name: 'Date format',
		desc: 'How a date is shown in the grid and written back to the note. The note stores the same value either way, so changing this never rewrites your files.',
		control: {
			kind: 'dropdown',
			options: {
				iso: 'ISO 8601 (2026-10-06)',
				dayFirst: 'Day first (06/10/2026)',
				monthFirst: 'Month first (10/06/2026)',
				locale: 'Follow the app’s locale',
			},
		},
		aliases: ['date', 'format', 'dmy', 'mdy'],
	},
	{
		path: 'import.warnOnLargeImport',
		section: 'import',
		name: 'Warn before a large import',
		desc: 'Show the row count and the legacy-file alternative before creating a lot of notes. Off means the preview dialog still appears, without the warning.',
		control: { kind: 'toggle' },
		aliases: ['threshold', 'bulk', 'big'],
	},
	{
		path: 'import.largeImportThreshold',
		section: 'import',
		name: 'Large import threshold',
		desc: 'The row count, from 10 to 5000, above which an import is treated as large and the legacy-file option is offered first.',
		control: { kind: 'slider', min: 10, max: 5000, step: 10, unit: 'rows' },
		aliases: ['limit', 'size'],
		// Hidden while the warning is off: a threshold that triggers nothing is a disabled control in
		// disguise, so it is not rendered at all (`prompts/step-14` item 4).
		visibleWhen: (settings) => settings.import.warnOnLargeImport,
	},
	{
		path: 'import.inferTypes',
		section: 'import',
		name: 'Detect column types',
		desc: 'Guess each column’s type from the values that came in. Off imports every column as plain text, which is the right choice when a column only looks numeric.',
		control: { kind: 'toggle' },
		aliases: ['inference', 'guessing', 'types'],
	},
	{
		path: 'import.clipboardPasteMode',
		section: 'import',
		name: 'Pasting a block',
		desc: 'What a pasted block does when it reaches past the last row or column: grow the table, or stay inside the selection and keep the rest of the block on the clipboard.',
		control: {
			kind: 'dropdown',
			options: {
				expand: 'Grow the table',
				fill: 'Fill the selection only',
				ask: 'Ask each time',
			},
		},
		aliases: ['clipboard', 'paste', 'ctrl-v'],
	},
	{
		path: 'appearance.followObsidianTheme',
		section: 'appearance',
		name: 'Follow my Obsidian theme',
		desc: 'Use your theme’s surfaces, text and accent instead of Tablify’s own. The grid keeps its layout either way.',
		control: { kind: 'toggle' },
		aliases: ['theme', 'colours', 'colors', 'dark'],
	},
	{
		path: 'appearance.defaultRowHeight',
		section: 'appearance',
		name: 'Row height for new views',
		desc: 'The row height a view starts with. Each view stores the height it actually uses in its own database file, so changing this never resizes a grid you already set up.',
		control: {
			kind: 'dropdown',
			options: {
				short: 'Short',
				medium: 'Medium',
				tall: 'Tall',
			},
		},
		aliases: ['density', 'spacing', 'compact'],
	},
	{
		path: 'appearance.motionPreference',
		section: 'appearance',
		name: 'Motion',
		desc: 'Follow your system’s reduced-motion setting, or override it. Keyboard actions never animate, whatever this says.',
		control: {
			kind: 'dropdown',
			options: {
				system: 'Follow the system',
				reduce: 'Reduce motion',
				full: 'Allow motion',
			},
		},
		aliases: ['animation', 'accessibility', 'reduced'],
	},
	{
		path: 'legacy.showMigrationEntryPoints',
		section: 'legacy',
		name: 'Show import entries for the legacy format',
		desc: 'Offer the old single-file format in the commands and menus. The file is only ever read, and nothing is written until you confirm the dry run.',
		control: { kind: 'toggle' },
		aliases: ['tabula', 'migration', 'old files'],
	},
	{
		path: 'advanced.logLevel',
		section: 'advanced',
		name: 'Log level',
		desc: 'How much Tablify writes to the developer console (View ▸ Toggle developer tools). Off by default: the plugin is silent unless you ask it not to be.',
		control: {
			kind: 'dropdown',
			options: {
				off: 'Off',
				error: 'Errors only',
				warn: 'Warnings and errors',
				info: 'Info and above',
				debug: 'Everything',
			},
		},
		aliases: ['debug', 'console', 'verbose'],
	},
	{
		path: 'advanced.experimental',
		section: 'advanced',
		name: 'Experimental features',
		desc: 'Features that are not finished. Nothing here is enabled by default, and each one can be turned off again.',
		control: { kind: 'flags' },
		aliases: ['beta', 'preview', 'flags'],
		// No flags exist in this build, so the row is hidden rather than shown empty — and it appears the
		// moment a flag exists, which is the "hidden, not disabled" rule with a condition that can actually
		// turn on today (`tests/dom/settings-tab.test.ts` proves both halves).
		visibleWhen: (settings) => Object.keys(settings.advanced.experimental).length > 0,
	},
];

/** Every value-bearing row, keyed by path, so a string path from a control can be resolved at runtime. */
const ROWS_BY_PATH: ReadonlyMap<string, SettingRow> = new Map(
	SETTING_ROWS.map((row) => [row.path, row]),
);

/** The row that owns a path, or `null`. The store refuses a write to a path this does not know. */
export function settingRowFor(path: string): SettingRow | null {
	return ROWS_BY_PATH.get(path) ?? null;
}

/** Every value-bearing path, in schema order. A test asserts this list and the type stay in step. */
export const SETTING_PATHS: readonly SettingPath[] = SETTING_ROWS.map((row) => row.path);

/** The rows that carry no value: the versions line, and the Diagnostics button. */
/**
 * Reads one setting by its dotted path. Returns `undefined` only when the path cannot exist — a caller that
 * needs a value should read `DEFAULT_SETTINGS` through the same path, which is how `load.ts` fills gaps.
 */
export function readPath(settings: object, path: string): unknown {
	let current: unknown = settings;
	for (const part of path.split('.')) {
		if (!isRecord(current)) {
			return undefined;
		}
		current = current[part];
	}
	return current;
}

/**
 * Writes one setting by its dotted path. The object is mutated in place: callers pass a clone they own
 * (`load.ts` while validating, the store while editing), never `DEFAULT_SETTINGS`, which is frozen.
 */
export function writePath(target: object, path: string, value: unknown): void {
	const container = containerOf(target, path);
	if (container === null) {
		return;
	}
	container.container[container.last] = value;
}

/**
 * Walks a dotted path to the object that holds the last key. `null` when a step is missing or is not an
 * object — the caller then does nothing, which is what "a path that does not exist on this shape" means.
 */
export function containerOf(
	target: object,
	path: string,
): { readonly container: Record<string, unknown>; readonly last: string } | null {
	const parts = path.split('.');
	const last = parts[parts.length - 1];
	if (last === undefined) {
		return null;
	}
	let current: Record<string, unknown> | null = isRecord(target) ? target : null;
	for (const part of parts.slice(0, -1)) {
		if (current === null) {
			return null;
		}
		const next: unknown = current[part];
		current = isRecord(next) ? next : null;
	}
	return current === null ? null : { container: current, last };
}

/** An object that can be walked and written. Arrays are excluded: nothing in the settings is a list. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A settings clone with every level mutable, so `writePath` can do its work without an assertion. Written
 * out field by field on purpose: a generic deep clone would need a cast, and a cast here would hide a key
 * added to the type but forgotten in the clone.
 */
export function cloneSettings(settings: TablifySettings): {
	version: number;
	rows: { targetFolder: string; filenameTemplate: string; dateFormat: DateFormatId };
	import: {
		warnOnLargeImport: boolean;
		largeImportThreshold: number;
		inferTypes: boolean;
		clipboardPasteMode: PasteModeId;
	};
	appearance: {
		followObsidianTheme: boolean;
		defaultRowHeight: RowHeightId;
		motionPreference: MotionPreferenceId;
	};
	legacy: { showMigrationEntryPoints: boolean };
	advanced: { logLevel: LogLevelId; experimental: Record<string, boolean> };
} {
	return {
		version: settings.version,
		rows: {
			targetFolder: settings.rows.targetFolder,
			filenameTemplate: settings.rows.filenameTemplate,
			dateFormat: settings.rows.dateFormat,
		},
		import: {
			warnOnLargeImport: settings.import.warnOnLargeImport,
			largeImportThreshold: settings.import.largeImportThreshold,
			inferTypes: settings.import.inferTypes,
			clipboardPasteMode: settings.import.clipboardPasteMode,
		},
		appearance: {
			followObsidianTheme: settings.appearance.followObsidianTheme,
			defaultRowHeight: settings.appearance.defaultRowHeight,
			motionPreference: settings.appearance.motionPreference,
		},
		legacy: { showMigrationEntryPoints: settings.legacy.showMigrationEntryPoints },
		advanced: {
			logLevel: settings.advanced.logLevel,
			experimental: { ...settings.advanced.experimental },
		},
	};
}

export const SETTING_ROWS_WITHOUT_VALUE: readonly SettingRowWithoutValue[] = [
	{
		id: 'about.versions',
		section: 'advanced',
		name: 'Version',
		desc: 'The installed plugin version, the oldest Obsidian it supports, and the version running now.',
		control: { kind: 'info' },
		aliases: ['about', 'release', 'build'],
	},
	{
		id: 'about.diagnostics',
		section: 'advanced',
		name: 'Diagnostics',
		desc: 'Copy a short summary — versions, settings and row counts — to the clipboard for a bug report. It contains no note text and no secret.',
		control: { kind: 'action' },
		aliases: ['copy', 'report', 'support', 'troubleshooting'],
	},
];
