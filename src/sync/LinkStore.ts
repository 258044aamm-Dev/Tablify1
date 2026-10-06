/**
 * The link file: **which Airtable table this view is watching, and what was last agreed.**
 *
 * `docs/03` §Sync state is unusually specific, and this file follows it rather than paraphrasing it:
 *
 *   · the path is `<vault>/.tablify/links/<key>.json`, where `<key>` is *"a stable hash of the `.base` path plus the
 *     view name"* and the folder is a dot-folder *"so this never pollutes search or the file explorer"*;
 *   · the document holds `version`, `basePath`, `viewName`, `airtable{baseId,baseName,tableId,tableName}`,
 *     `recordMap`, `fieldMap`, `snapshot`, `lastPulledAt`, `lastPushedAt`;
 *   · the snapshot is `recordId → fieldId → "sha256:…"`, and its reason is stated there: `local ≠ snapshot` means
 *     the vault changed, `remote ≠ snapshot` means Airtable changed, both means a real conflict;
 *   · *"Deleting this folder is safe: it only loses sync linkage"* — which is why a **missing** file is not an
 *     error, and why a **corrupt** one is: re-creating it silently would drop a mapping the user cannot rebuild.
 *
 * ## Forward compatibility, in both directions
 *
 * The step asks for it, and the doc's own version field implies it. Reading keeps every key it does not know (in
 * {@link LinkDocument.unknown}) and writes them back untouched, so a newer build's field survives a round trip
 * through this one; writing stamps `version: 1` and never reorders the known keys, so a diff of the file in a vault
 * shows what actually changed rather than what the serialiser happened to do. And a `version` **newer** than this
 * build refuses to load with a sentence, because guessing at a shape you do not know is how a mapping gets eaten.
 *
 * ## What this file does not do
 *
 * No network, no diffing, no hashing — {@link recordSnapshot} takes the hashes it is given (they come from
 * `hash.ts`, which is asynchronous because `crypto.subtle` is) and the store's job is only to say what is on disk
 * and to write it back atomically. There is no Airtable type here either: the client and this file meet at strings.
 */
import { hashFields } from './hash';
import type { UnmappedField } from './SyncTarget';

/** The header of the link file, as `docs/03` writes it. */
export const LINK_VERSION = 1;

/** Where every link file lives: a dot-folder, so Obsidian neither indexes nor shows it. */
export const LINK_FOLDER = '.tablify/links';

/** The remote link: four strings, exactly the doc's `airtable` object. */
export type LinkTarget = {
	readonly baseId: string;
	readonly baseName: string;
	readonly tableId: string;
	readonly tableName: string;
};

/** `recordMap` and `snapshot`, as the doc spells them. */
export type RecordMap = Readonly<Record<string, string>>;
export type Snapshot = Readonly<Record<string, Readonly<Record<string, string>>>>;

export type LinkDocument = {
	readonly version: number;
	readonly basePath: string;
	readonly viewName: string;
	readonly airtable: LinkTarget;
	/** Local note path → remote record id. */
	readonly recordMap: RecordMap;
	/** Local property name → remote field id. */
	readonly fieldMap: Readonly<Record<string, string>>;
	/** The last agreed value hash per record per field: the three-way diff's third column. */
	readonly snapshot: Snapshot;
	readonly lastPulledAt: string | null;
	readonly lastPushedAt: string | null;
	/** Everything this build does not know, preserved verbatim (forward compatibility, one direction). */
	readonly unknown: Readonly<Record<string, unknown>>;
};

/** Where a link lives, and what went wrong when it did not load. */
export type LinkLoad =
	| {
			readonly ok: true;
			readonly document: LinkDocument;
			/** False when there was no file at all. */ readonly existed: boolean;
	  }
	| { readonly ok: false; readonly reason: string; readonly path: string };

/**
 * The link file's path for one view.
 *
 * `docs/03`: *"a stable hash of the `.base` path plus the view name"*. This is **FNV-1a in two 32-bit halves**,
 * written as 16 hex characters — not a cryptographic hash, and deliberately so: the key only has to be stable,
 * collision-resistant enough for the handful of links a vault holds, and computable without a dependency (the file
 * name is visible in a vault; the *content* hash in `snapshot` is the one that needs SHA-256). The `.base` path and
 * the view name are joined with a newline before hashing, so `a` + `b/c` cannot collide with `a/b` + `c`.
 */
export function linkKey(basePath: string, viewName: string): string {
	const text = `${basePath}\n${viewName}`;
	// Two independent 32-bit FNV-1a passes with different offsets: cheap, and 64 bits of output.
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

/** The path of a link file, as the doc spells it. */
export function linkPath(basePath: string, viewName: string): string {
	return `${LINK_FOLDER}/${linkKey(basePath, viewName)}.json`;
}

/** A fresh document for a new link. Nothing has been pulled or pushed, so both stamps are `null`. */
export function newLinkDocument(input: {
	readonly basePath: string;
	readonly viewName: string;
	readonly target: LinkTarget;
}): LinkDocument {
	return {
		version: LINK_VERSION,
		basePath: input.basePath,
		viewName: input.viewName,
		airtable: input.target,
		recordMap: {},
		fieldMap: {},
		snapshot: {},
		lastPulledAt: null,
		lastPushedAt: null,
		unknown: {},
	};
}

/** What the store needs of a vault: read a text file, write one, and say whether a path exists. */
export type LinkVault = {
	/** The file's text, or `null` when there is no such file. Never throws for a missing file. */
	readonly read: (path: string) => Promise<string | null>;
	/** Writes, creating the folder when it is missing. */
	readonly write: (path: string, text: string) => Promise<void>;
};

/** The keys this build knows. Everything else in a file is kept, not dropped. */
const KNOWN = new Set([
	'version',
	'basePath',
	'viewName',
	'airtable',
	'recordMap',
	'fieldMap',
	'snapshot',
	'lastPulledAt',
	'lastPushedAt',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string record, or an empty one — a `recordMap` that arrived as a list is a corrupt file, not a mapping. */
function stringRecord(value: unknown): Record<string, string> {
	if (!isRecord(value)) {
		return {};
	}
	const out: Record<string, string> = {};
	for (const [key, member] of Object.entries(value)) {
		if (typeof member === 'string') {
			out[key] = member;
		}
	}
	return out;
}

/** `snapshot`: record id → field id → hash, dropping anything that is not a string. */
function snapshotRecord(value: unknown): Snapshot {
	if (!isRecord(value)) {
		return {};
	}
	const out: Record<string, Record<string, string>> = {};
	for (const [record, fields] of Object.entries(value)) {
		out[record] = stringRecord(fields);
	}
	return out;
}

/**
 * Parses a link file. **Every failure is a sentence**, never a throw and never a fresh document: a corrupt file
 * that was silently replaced would take the field mapping with it (`docs/03`: deleting the folder is safe because
 * *"it only loses sync linkage"* — losing it without being told is not the same thing).
 */
export function parseLink(text: string, path: string): LinkLoad {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {
			ok: false,
			path,
			reason: `${path} is not valid JSON — it may have been edited by hand or truncated.`,
		};
	}
	if (!isRecord(parsed)) {
		return { ok: false, path, reason: `${path} does not hold an object.` };
	}
	const version = parsed['version'];
	if (typeof version !== 'number') {
		return { ok: false, path, reason: `${path} has no version number.` };
	}
	if (version > LINK_VERSION) {
		return {
			ok: false,
			path,
			reason: `${path} was written by a newer version of Tablify (link format ${String(version)}, this build reads ${String(LINK_VERSION)}).`,
		};
	}
	const airtable = parsed['airtable'];
	if (
		!isRecord(airtable) ||
		typeof airtable['baseId'] !== 'string' ||
		typeof airtable['tableId'] !== 'string'
	) {
		return {
			ok: false,
			path,
			reason: `${path} has no Airtable base and table — the link is unusable.`,
		};
	}
	const unknown: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (!KNOWN.has(key)) {
			unknown[key] = value;
		}
	}
	const document: LinkDocument = {
		version,
		basePath: typeof parsed['basePath'] === 'string' ? parsed['basePath'] : '',
		viewName: typeof parsed['viewName'] === 'string' ? parsed['viewName'] : '',
		airtable: {
			baseId: airtable['baseId'],
			baseName: typeof airtable['baseName'] === 'string' ? airtable['baseName'] : '',
			tableId: airtable['tableId'],
			tableName: typeof airtable['tableName'] === 'string' ? airtable['tableName'] : '',
		},
		recordMap: stringRecord(parsed['recordMap']),
		fieldMap: stringRecord(parsed['fieldMap']),
		snapshot: snapshotRecord(parsed['snapshot']),
		lastPulledAt: typeof parsed['lastPulledAt'] === 'string' ? parsed['lastPulledAt'] : null,
		lastPushedAt: typeof parsed['lastPushedAt'] === 'string' ? parsed['lastPushedAt'] : null,
		unknown,
	};
	return { ok: true, document, existed: true };
}

/** The file's text. Known keys first in the doc's order, then whatever this build did not recognise. */
export function serialiseLink(document: LinkDocument): string {
	const known: Record<string, unknown> = {
		version: LINK_VERSION,
		basePath: document.basePath,
		viewName: document.viewName,
		airtable: document.airtable,
		recordMap: document.recordMap,
		fieldMap: document.fieldMap,
		snapshot: document.snapshot,
		lastPulledAt: document.lastPulledAt,
		lastPushedAt: document.lastPushedAt,
	};
	for (const [key, value] of Object.entries(document.unknown)) {
		known[key] = value;
	}
	return `${JSON.stringify(known, null, 2)}\n`;
}

/** The link store over a vault: the only thing in this file that touches storage. */
export type LinkStore = {
	readonly path: string;
	/** Loads, or answers with a reason. A missing file is `{ok: true, existed: false, …new document}`. */
	load(basePath: string, viewName: string, target: LinkTarget): Promise<LinkLoad>;
	/** Writes the document back. Nothing else in the plugin writes a link file. */
	save(document: LinkDocument): Promise<void>;
};

export function createLinkStore(
	vault: LinkVault,
	input: {
		readonly basePath: string;
		readonly viewName: string;
	},
): LinkStore {
	const path = linkPath(input.basePath, input.viewName);
	return {
		path,
		async load(basePath, viewName, target) {
			const text = await vault.read(path);
			if (text === null) {
				// Not an error: `docs/03` — the folder is disposable, so a view that has never been linked simply
				// has no file, and the document that answers is the one a first sync would write.
				return {
					ok: true,
					document: newLinkDocument({ basePath, viewName, target }),
					existed: false,
				};
			}
			return parseLink(text, path);
		},
		async save(document) {
			await vault.write(path, serialiseLink(document));
		},
	};
}

/**
 * The snapshot after a successful pull: the hashes of the values that were just agreed on.
 *
 * Replaced rather than merged, per record and per field: the snapshot means *"this is what both sides had last
 * time we looked"*, and keeping a stale hash for a field that changed is how a conflict is reported forever.
 */
export async function recordSnapshot(
	snapshot: Snapshot,
	recordId: string,
	values: Readonly<Record<string, unknown>>,
	fields: readonly string[],
): Promise<Snapshot> {
	const hashes = await hashFields(values, fields);
	return { ...snapshot, [recordId]: hashes };
}

/** What a link file is missing, for the message a person reads before their first sync. */
export function describeLink(document: LinkDocument, unmapped: readonly UnmappedField[]): string {
	const parts = [
		`Linked to ${document.airtable.baseName || document.airtable.baseId} › ${document.airtable.tableName || document.airtable.tableId}`,
	];
	const locals = unmapped.filter((field) => field.side === 'local');
	const remotes = unmapped.filter((field) => field.side === 'remote');
	if (locals.length > 0) {
		parts.push(
			`${String(locals.length)} column(s) with no Airtable field: ${locals.map((field) => field.name).join(', ')}`,
		);
	}
	if (remotes.length > 0) {
		parts.push(
			`${String(remotes.length)} Airtable field(s) with no column: ${remotes.map((field) => field.name).join(', ')}`,
		);
	}
	return parts.join(' · ');
}
