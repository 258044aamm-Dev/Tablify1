/**
 * The JSON value model the document codec speaks, and the only place JSON text meets the core.
 *
 * `JSON.parse` hands back `any`; {@link toJsonValue} turns that into a closed union **by structure**,
 * never by assertion (this repository bans type assertions outright). The converter is total for
 * everything `JSON.parse` can produce and returns `undefined` for the shapes JSON cannot represent
 * (`undefined`, functions, bigint, symbols), so a caller can treat its result as the parse's verdict.
 *
 * Serialization goes through {@link toCanonicalObject}. That is where the written key order is fixed:
 * the schema's keys first, in the order the schema names them, then the keys this version does not
 * know — preserved, never dropped (R1 step 1). JSON objects are unordered by specification, so
 * "preserved" is the promise; "same position as the original file" is not.
 */
/** Every value a `.tablify` document may contain. Mirrors the JSON spec, no extensions. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;

/** A JSON object with this codec's guarantee: every value is itself a {@link JsonValue}. */
export interface JsonObject {
	readonly [key: string]: JsonValue;
}

/** A key the schema does not read, kept with its value so the round trip loses nothing. */
export interface UnknownEntry {
	readonly key: string;
	readonly value: JsonValue;
}

/** True for a JSON object — and for `null`/arrays too? No: both are excluded here, deliberately. */
export function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for a JSON array. */
export function isJsonArray(value: unknown): value is readonly JsonValue[] {
	return Array.isArray(value);
}

/**
 * Convert a value of unknown origin — in practice, `JSON.parse`'s output — into the model, or
 * `undefined` when it is not a JSON value at all. Recurses through arrays and objects; a nested
 * non-JSON value invalidates its entire parent, because a half-converted tree is a lie.
 */
export function toJsonValue(value: unknown): JsonValue | undefined {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : undefined;
	}
	if (Array.isArray(value)) {
		const items: JsonValue[] = [];
		for (const item of value) {
			const converted = toJsonValue(item);
			if (converted === undefined) {
				return undefined;
			}
			items.push(converted);
		}
		return items;
	}
	if (isJsonObject(value)) {
		const out: Record<string, JsonValue> = {};
		for (const [key, item] of Object.entries(value)) {
			const converted = toJsonValue(item);
			if (converted === undefined) {
				return undefined;
			}
			out[key] = converted;
		}
		return out;
	}
	return undefined;
}

/** The verdict of parsing raw file text: a value, or a calm report that it is not one. */
export type JsonTextParse =
	| { readonly ok: true; readonly value: JsonValue }
	| { readonly ok: false; readonly error: string };

/** Parse file text. Never throws on bad input — a corrupted file is a result, not an exception. */
export function parseJsonText(text: string): JsonTextParse {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : 'unknown parse failure',
		};
	}
	const value = toJsonValue(parsed);
	if (value === undefined) {
		return { ok: false, error: 'the text parses to a value JSON cannot represent' };
	}
	return { ok: true, value };
}

/**
 * Build the object to serialize: known keys first (skipping `undefined`, which is this codec's
 * "key absent"), then unknown entries whose key the schema did not claim.
 */
export function toCanonicalObject(
	known: readonly (readonly [key: string, value: JsonValue | undefined])[],
	unknown: readonly UnknownEntry[],
): JsonObject {
	const out: Record<string, JsonValue> = {};
	const claimed = new Set<string>();
	for (const [key, value] of known) {
		claimed.add(key);
		if (value !== undefined) {
			out[key] = value;
		}
	}
	for (const entry of unknown) {
		if (!claimed.has(entry.key)) {
			out[entry.key] = entry.value;
		}
	}
	return out;
}

/** The written form of a document value: two-space JSON, one trailing newline, stable key order. */
export function stringifyJson(value: JsonValue): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

/** The keys of `record` that `known` does not claim, in the order the record lists them. */
export function unknownEntries(
	record: JsonObject,
	known: readonly string[],
): readonly UnknownEntry[] {
	const claimed = new Set(known);
	const out: UnknownEntry[] = [];
	for (const [key, value] of Object.entries(record)) {
		if (!claimed.has(key)) {
			out.push({ key, value });
		}
	}
	return out;
}
