/**
 * The Diagnostics blob: what a person pastes into a bug report.
 *
 * It is built by a pure function so that what leaves the device is testable, and it is filtered so that what
 * leaves the device **cannot** be a secret: any key whose name looks like a credential is replaced before
 * serialisation. Today no setting is a credential — the optional sync token of a later milestone goes to
 * `SecretStorage` and never into `data.json` (`docs/09` §what may be stored) — so the filter is a guard,
 * not a workaround, and there is a test that asserts it fires.
 *
 * It contains no note text, no file names, no folder paths and no counts of anything but notes.
 */
import { cloneSettings } from './schema';
import type { TablifySettings } from './schema';

/** Key names that never reach the clipboard, whatever they hold. Case-insensitive substring match. */
const SECRET_HINTS: readonly string[] = [
	'token',
	'secret',
	'password',
	'passphrase',
	'apikey',
	'api_key',
	'credential',
	'email',
	'account',
];

export type DiagnosticsInput = {
	readonly pluginVersion: string;
	readonly minAppVersion: string;
	/** How many markdown notes the vault holds. A count, never a name. */
	readonly noteCount: number;
	readonly settings: TablifySettings;
};

/** True when a key name looks like something that must not be copied anywhere. */
export function looksSecret(key: string): boolean {
	const lower = key.toLowerCase().replace(/[\s-]/g, '_');
	return SECRET_HINTS.some((hint) => lower.includes(hint));
}

/**
 * The settings with every secret-looking key replaced by `"<removed>"`. Recursive, because a future
 * settings file may nest: `advanced.experimental` is already a record, and step 25's sync section will be
 * one too.
 */
export function redactedSettings(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => redactedSettings(entry));
	}
	if (typeof value !== 'object' || value === null) {
		return value;
	}
	const clean: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		clean[key] = looksSecret(key) ? '<removed>' : redactedSettings(entry);
	}
	return clean;
}

/**
 * The blob, as the text that goes on the clipboard. Keys are sorted so two reports of the same state are
 * identical strings — which is what makes "paste your diagnostics" comparable between two people.
 */
export function diagnosticsBlob(input: DiagnosticsInput): string {
	const payload = {
		plugin: {
			name: 'Tablify',
			version: input.pluginVersion,
			minAppVersion: input.minAppVersion,
		},
		vault: { notes: input.noteCount },
		settings: redactedSettings(cloneSettings(input.settings)),
	};
	return JSON.stringify(payload, sortedKeys(), 2);
}

/**
 * A `JSON.stringify` replacer that sorts object keys. Arrays keep their order, because order is data there;
 * objects in this payload are all unordered records.
 */
export function sortedKeys(): (key: string, value: unknown) => unknown {
	return (_key, value) => {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) {
			return value;
		}
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort()) {
			sorted[key] = Reflect.get(value, key);
		}
		return sorted;
	};
}
