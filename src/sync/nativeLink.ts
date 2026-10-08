/**
 * The link sidecar for a **native table** (R5 Part C, Steps 2 and 3).
 *
 * One local `databaseId + tableId` maps to one remote base and table. A saved view is not the identity. The file
 * is `<vault>/.tablify/links/<key>.json`, the same dot-folder the legacy `.base` links use, but its key is hashed from
 * a different namespace, so the two can never name the same file.
 *
 * ## What is stored, and why it is keyed by remote IDs
 *
 * The document keeps `rowId → remoteRecordId` and `fieldId → remoteFieldId` as the mappings. The agreed snapshot is
 * stored **exactly as the engine produces it**: remote record ID → remote field ID → hash. The engine already keys its
 * snapshot by remote identity, so nothing is translated, and a local rename or reorder cannot make a stored hash point
 * at the wrong remote cell.

 * ## Step 3: old links are not read here
 *
 * Nothing in this module reads or writes a legacy `.base` link. A legacy file stays on disk, untouched, and the user
 * links a `.tablify` table afresh. Migrating old snapshots would need its own approved converter.
 *
 * ## Forward compatibility, both directions
 *
 * As the legacy link does: unknown top-level keys are kept in {@link NativeLinkDocument.unknown} and written back, and
 * a `version` newer than this build refuses to load with a sentence. A corrupt file is also a refusal, never a silent
 * new link, because re-creating it would drop a mapping the user cannot rebuild.
 *
 * No network, no file system: the vault port belongs to the host. Token material never enters this file.
 */
import type { LinkTarget, Snapshot } from './LinkStore';

/** The format this build writes and reads. */
export const NATIVE_LINK_VERSION = 1;

/** Same dot-folder as the legacy links, so it is hidden from search and the file explorer. */
export const NATIVE_LINK_FOLDER = '.tablify/links';

/** The mappings and snapshot of one linked native table. */
export type NativeLinkDocument = {
	readonly version: number;
	readonly databaseId: string;
	readonly tableId: string;
	readonly target: LinkTarget;
	/** Local field ID → remote field ID. */
	readonly fieldMap: Readonly<Record<string, string>>;
	/** Local row ID → remote record ID. A row absent here has no record and is reported, never created. */
	readonly rowMap: Readonly<Record<string, string>>;
	/** Remote record ID → remote field ID → agreed value hash (`sha256:…`). */
	readonly snapshot: Snapshot;
	readonly lastPulledAt: string | null;
	readonly lastPushedAt: string | null;
	/** Top-level keys this build does not know, kept verbatim so a newer build's data survives a round trip. */
	readonly unknown: Readonly<Record<string, unknown>>;
};

export type NativeLinkLoad =
	| { readonly ok: true; readonly document: NativeLinkDocument }
	| { readonly ok: false; readonly reason: string };

/**
 * A stable key for one native table. The input starts with a namespace line, and a legacy key's input contains one
 * newline (a `.base` path cannot contain one), so the two inputs cannot be equal. Two 32-bit FNV-1a passes, as the
 * legacy key uses.
 */
export function nativeLinkKey(databaseId: string, tableId: string): string {
	const text = `native-link-v1\n${databaseId}\n${tableId}`;
	const half = (offset: number): string => {
		let hash = offset;
		for (const character of text) {
			hash ^= character.codePointAt(0) ?? 0;
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
		return hash.toString(16).padStart(8, '0');
	};
	return `${half(0x811c9dc5)}${half(0x1b873593)}`;
}

/** The path of a native table's link file. */
export function nativeLinkPath(databaseId: string, tableId: string): string {
	return `${NATIVE_LINK_FOLDER}/${nativeLinkKey(databaseId, tableId)}.json`;
}

/** A fresh link. Nothing has been pulled or pushed, so both stamps are `null` and the mappings are empty. */
export function newNativeLink(input: {
	readonly databaseId: string;
	readonly tableId: string;
	readonly target: LinkTarget;
}): NativeLinkDocument {
	return {
		version: NATIVE_LINK_VERSION,
		databaseId: input.databaseId,
		tableId: input.tableId,
		target: { ...input.target },
		fieldMap: {},
		rowMap: {},
		snapshot: {},
		lastPulledAt: null,
		lastPushedAt: null,
		unknown: {},
	};
}

const KNOWN_KEYS: ReadonlySet<string> = new Set([
	'version',
	'databaseId',
	'tableId',
	'target',
	'fieldMap',
	'rowMap',
	'snapshot',
	'lastPulledAt',
	'lastPushedAt',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> | null {
	if (!isRecord(value)) {
		return null;
	}
	const out: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== 'string') {
			return null;
		}
		out[key] = entry;
	}
	return out;
}

function snapshotOf(value: unknown): Snapshot | null {
	if (!isRecord(value)) {
		return null;
	}
	const out: Record<string, Record<string, string>> = {};
	for (const [recordId, fields] of Object.entries(value)) {
		const map = stringMap(fields);
		if (map === null) {
			return null;
		}
		out[recordId] = map;
	}
	return out;
}

/**
 * Reads a native link file. A missing file is the caller's concern (no link yet), so this only sees text. Refusals
 * are sentences: a newer version, a corrupt file, or a shape this build cannot trust.
 */
export function parseNativeLink(text: string, path: string): NativeLinkLoad {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {
			ok: false,
			reason: `${path} is not valid JSON, so the link cannot be read. It was not changed.`,
		};
	}
	if (!isRecord(parsed)) {
		return { ok: false, reason: `${path} does not hold a link object. It was not changed.` };
	}
	const version = parsed['version'];
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
		return {
			ok: false,
			reason: `${path} has no valid version, so the link cannot be read. It was not changed.`,
		};
	}
	if (version > NATIVE_LINK_VERSION) {
		return {
			ok: false,
			reason: `${path} was written by a newer version of Tablify (format ${String(version)}). Update Tablify to use this link.`,
		};
	}
	const targetRaw = parsed['target'];
	const fieldMap = stringMap(parsed['fieldMap']);
	const rowMap = stringMap(parsed['rowMap']);
	const snapshot = snapshotOf(parsed['snapshot']);
	if (
		typeof parsed['databaseId'] !== 'string' ||
		typeof parsed['tableId'] !== 'string' ||
		!isRecord(targetRaw) ||
		typeof targetRaw['baseId'] !== 'string' ||
		typeof targetRaw['tableId'] !== 'string' ||
		fieldMap === null ||
		rowMap === null ||
		snapshot === null
	) {
		return {
			ok: false,
			reason: `${path} is damaged, so the link cannot be read. It was not changed.`,
		};
	}
	const unknown: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (!KNOWN_KEYS.has(key)) {
			unknown[key] = value;
		}
	}
	return {
		ok: true,
		document: {
			version,
			databaseId: parsed['databaseId'],
			tableId: parsed['tableId'],
			target: {
				baseId: targetRaw['baseId'],
				baseName: typeof targetRaw['baseName'] === 'string' ? targetRaw['baseName'] : '',
				tableId: targetRaw['tableId'],
				tableName: typeof targetRaw['tableName'] === 'string' ? targetRaw['tableName'] : '',
			},
			fieldMap,
			rowMap,
			snapshot,
			lastPulledAt:
				typeof parsed['lastPulledAt'] === 'string' ? parsed['lastPulledAt'] : null,
			lastPushedAt:
				typeof parsed['lastPushedAt'] === 'string' ? parsed['lastPushedAt'] : null,
			unknown,
		},
	};
}

/**
 * The file text. The known keys keep one fixed order so a diff shows what changed; unknown keys follow. The version
 * is always written as this build's own.
 */
export function serialiseNativeLink(document: NativeLinkDocument): string {
	const body: Record<string, unknown> = {
		version: NATIVE_LINK_VERSION,
		databaseId: document.databaseId,
		tableId: document.tableId,
		target: document.target,
		fieldMap: document.fieldMap,
		rowMap: document.rowMap,
		snapshot: document.snapshot,
		lastPulledAt: document.lastPulledAt,
		lastPushedAt: document.lastPushedAt,
		...document.unknown,
	};
	return `${JSON.stringify(body, null, 2)}\n`;
}
