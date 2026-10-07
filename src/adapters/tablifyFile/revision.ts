/**
 * Document revisions — how the session knows the text it loaded is still the text on disk.
 *
 * ADR-0005 requires a save to state the revision it was computed from and to refuse when the disk
 * has moved on. The revision is computed **over the raw text**, never over the model: a file that
 * changed only its whitespace is a file someone else touched, and the decision to overwrite it is
 * the user's, not this code's.
 *
 * Two independent FNV-1a passes over the code units, plus the length, keep this dependency-free —
 * `node:crypto` and `SubtleCrypto` are both wrong here (one is a Node module in a mobile plugin,
 * the other is async and unavailable in the core's tests). This is a change detector, not a
 * security primitive, and it says so in its own name: `detectRevision`.
 */

/** FNV-1a over the string's UTF-16 code units, with the offset/prime pair the caller supplies. */
function fnv1a(text: string, offset: number): number {
	let hash = offset >>> 0;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash >>> 0;
}

function hex8(value: number): string {
	return value.toString(16).padStart(8, '0');
}

/**
 * A stable fingerprint of the exact text: `"<hash>-<hash>-<length>"`. Equal strings produce equal
 * revisions; any single-code-unit change changes both hashes with overwhelming probability.
 */
export function detectRevision(text: string): string {
	return `${hex8(fnv1a(text, 0x811c9dc5))}-${hex8(fnv1a(text, 0x9e3779b9))}-${String(text.length)}`;
}
