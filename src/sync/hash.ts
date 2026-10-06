/**
 * The snapshot hash: **what "this field has not changed since we agreed on it" is computed from.**
 *
 * `docs/03` §Sync state stores `snapshot[recordId][fieldId] = "sha256:…"` and explains what it is for: *"`local ≠
 * snapshot` means the vault changed; `remote ≠ snapshot` means the provider changed; both ⇒ a real conflict."* The
 * document shows SHA-256 in its example, so that is what this is — `crypto.subtle`, the platform's own digest, with
 * no dependency and no hand-rolled hash to get subtly wrong across encodings.
 *
 * Two decisions worth writing down:
 *
 *   · **The hash is over a canonical string, not over JSON as it happens to be spelled.** A value's identity must
 *     not depend on key order, on `undefined` versus a missing key, or on a number's exponent form, so
 *     {@link canonical} sorts object keys, drops `undefined` members, and writes numbers with `String()` — which is
 *     what makes `25` and `25.0` (the same number in two sources) hash alike, and an array's order significant,
 *     which it is.
 *   · **Async, and that is the honest shape.** `crypto.subtle.digest` is asynchronous on the web and in Node 18+;
 *     a synchronous option would mean a second, weaker algorithm living beside this one. The sync path is
 *     asynchronous anyway (it is a network read followed by a diff), so the cost is one `await` in a call chain
 *     that already has dozens.
 */

/**
 * A value's canonical text: objects by sorted key, arrays in order, scalars by their own spelling.
 *
 * `null` is the empty value and is written as `null`; `undefined` inside an object is **dropped** (a key that is
 * not there and a key whose value is `undefined` are the same fact about a record), while inside an array it is
 * written as `null`, because dropping it would shift every element after it.
 */
export function canonical(value: unknown): string {
	if (value === null || value === undefined) {
		return 'null';
	}
	if (typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonical(item)).join(',')}]`;
	}
	if (typeof value === 'object') {
		// `Object.entries` on `object` yields `[string, any]` in this TypeScript version, so the members are
		// re-read as `unknown` through a record view of the same object — a widening, not an assertion: every
		// member of an object is an `unknown` until this module decides what it is.
		const record: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
		const entries = Object.entries(record)
			.filter(([, member]) => member !== undefined)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
		return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${canonical(member)}`).join(',')}}`;
	}
	// A function or a symbol cannot arrive from a vault, a spreadsheet or an API response; if one does, its
	// identity is not something this module can hash, and saying so beats hashing the string "function".
	return `"unhashable:${typeof value}"`;
}

/** A hex digest, from bytes. Lower case, no separators — the form the link file stores. */
function toHex(buffer: ArrayBuffer): string {
	return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * `sha256:<hex>` for one value. The `sha256:` prefix is `docs/03`'s own spelling, and it is load-bearing: it is
 * what lets a future version change the algorithm and still recognise the old hashes.
 */
export async function hashValue(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(canonical(value));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return `sha256:${toHex(digest)}`;
}

/**
 * The hashes for one row's mapped fields: `docs/03`'s `snapshot[recordId]`.
 *
 * Fields with no value are **kept**, as the hash of `null`. A field that was cleared is a change, and a snapshot
 * that omitted it would report "nothing changed" for exactly the edit that matters most.
 */
export async function hashFields(
	values: Readonly<Record<string, unknown>>,
	fields: readonly string[],
): Promise<Readonly<Record<string, string>>> {
	const hashes: Record<string, string> = {};
	for (const field of fields) {
		hashes[field] = await hashValue(values[field] ?? null);
	}
	return hashes;
}
