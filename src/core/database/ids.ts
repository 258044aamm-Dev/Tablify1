/**
 * Stable identifiers — R1 step 2.
 *
 * Every entity in a `.tablify` document is named by an id that survives renames and moves: the
 * database, its tables, fields, rows, saved views and select options. A path is never identity
 * (docs/03 §principles), so nothing here is derived from a filename, a heading, a row index or a
 * display label — ids are handed out once and then referenced.
 *
 * Two spellings exist for one id, and the difference is deliberate:
 *
 *   - **Canonical** — what this build writes: a kind prefix, `_`, then 26 characters of Crockford
 *     base32 over 16 random bytes. The random bytes come from an **injected** {@link IdSource};
 *     nothing in `src/core` reaches for a platform random API, and a test injects a seeded source
 *     to get the same ids every run.
 *   - **Accepted** — what {@link isIdOfKind} admits when reading: the same prefix and 1–64 body
 *     characters of `[a-z0-9]`. Broader than canonical on purpose: a hand-edited or future-written
 *     id that is still safely shaped must not be refused, and refusing it would teach users that
 *     editing their own file breaks it. Canonical-ness is a generation rule, not a read rule.
 *
 * Uniqueness is a *document* property and is checked where the objects meet:
 * {@link findDuplicates} finds repeats in one list; the envelope rejects a document whose table
 * ids repeat, and each later step applies the same rule to its own collection.
 */

/** The kinds of entity that carry an id. One prefix each, so a stray id is self-describing. */
export type IdKind = 'database' | 'table' | 'field' | 'row' | 'view' | 'option';

/**
 * Every id kind, for iterating without a cast. Kept beside the union so the two cannot drift —
 * and deliberately the only list: `Object.keys` over the prefix map would hand back `string[]`,
 * which would need an assertion, and this repository bans those outright.
 */
export const ID_KINDS: readonly IdKind[] = ['database', 'table', 'field', 'row', 'view', 'option'];

/** The prefix written in front of every id body. */
export const ID_PREFIXES: { readonly [kind in IdKind]: string } = {
	database: 'db',
	table: 'tbl',
	field: 'fld',
	row: 'row',
	view: 'viw',
	option: 'opt',
};

/** The canonical body length: 16 random bytes as Crockford base32 (ceil(128 / 5) = 26). */
export const ID_BODY_LENGTH = 26;

/** Crockford base32: no `i`, `l`, `o` or `u`, so ids cannot be misread as another id. */
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

/** The accepted body shape on read: short enough to bound the document, permissive on letters. */
const ACCEPTED_BODY = '[a-z0-9]{1,64}';

const PATTERNS: { readonly [kind in IdKind]: RegExp } = {
	database: new RegExp(`^${ID_PREFIXES.database}_${ACCEPTED_BODY}$`),
	table: new RegExp(`^${ID_PREFIXES.table}_${ACCEPTED_BODY}$`),
	field: new RegExp(`^${ID_PREFIXES.field}_${ACCEPTED_BODY}$`),
	row: new RegExp(`^${ID_PREFIXES.row}_${ACCEPTED_BODY}$`),
	view: new RegExp(`^${ID_PREFIXES.view}_${ACCEPTED_BODY}$`),
	option: new RegExp(`^${ID_PREFIXES.option}_${ACCEPTED_BODY}$`),
};

/** True when `value` is shaped like an id of `kind` — the only accepted spelling on read. */
export function isIdOfKind(kind: IdKind, value: string): boolean {
	return PATTERNS[kind].test(value);
}

/** Which kind of id `value` is, or `undefined` when it is not shaped like any of them. */
export function idKindOf(value: string): IdKind | undefined {
	return ID_KINDS.find((kind) => PATTERNS[kind].test(value));
}

/**
 * The random bytes every id is built from, injected.
 *
 * The core never calls a platform source itself (R1 step 2: "ID generation belongs at an injected
 * boundary"). R2 supplies the real one; a test supplies a seeded, reproducible one.
 */
export interface IdSource {
	randomValues(length: number): Uint8Array;
}

/** Encode bytes as Crockford base32, big-endian: the first character is the first five bits. */
function encodeBase32(bytes: Uint8Array): string {
	let out = '';
	let buffer = 0;
	let bits = 0;
	for (const byte of bytes) {
		buffer = (buffer << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			out += CROCKFORD.charAt((buffer >>> bits) & 31);
		}
	}
	if (bits > 0) {
		out += CROCKFORD.charAt((buffer << (5 - bits)) & 31);
	}
	return out;
}

/**
 * Build the id factory for a document store, over an injected {@link IdSource}.
 *
 * The factory is total for a well-behaved source and throws only when the source returns the wrong
 * number of bytes — a programming error at the boundary, not user input, and silently padding a
 * short read would mint colliding ids.
 */
export function createIdFactory(source: IdSource): (kind: IdKind) => string {
	return (kind) => {
		const bytes = source.randomValues(16);
		if (bytes.length !== 16) {
			throw new Error(`the id source returned ${bytes.length} bytes; 16 are required`);
		}
		return `${ID_PREFIXES[kind]}_${encodeBase32(bytes)}`;
	};
}

/**
 * Every value in `values` that occurs more than once, each reported once, in the order its repeat
 * is first seen. Empty for a list whose members are unique — the common case, and the cheap one.
 */
export function findDuplicates(values: readonly string[]): readonly string[] {
	const seen = new Set<string>();
	const reported = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		if (seen.has(value) && !reported.has(value)) {
			reported.add(value);
			out.push(value);
		}
		seen.add(value);
	}
	return out;
}
