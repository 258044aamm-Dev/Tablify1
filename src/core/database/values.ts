/**
 * Cell values in JSON — R1 step 3, and the concrete half of ADR-0004.
 *
 * The model has exactly three states per cell, and the differences between them are the point:
 *
 *   1. **no value** — canonical `null` in memory, an omitted key in the file. A missing key and an
 *      explicit `null` both read as this; they are the same statement.
 *   2. **a value** — including every value that looks falsy: `false`, `0`, `""`, a one-item list.
 *      None of them collapses into "empty"; the matrix in ADR-0004 is the law here.
 *   3. **an invalid value** — a JSON value the field cannot represent (an object, a number where a
 *      date belongs, a duplicate option id). It is **preserved exactly as the file had it** inside
 *      {@link InvalidCell}, reported through the parser's warnings, and written back unchanged. A
 *      codec that repairs or drops what it does not understand is a codec that loses data quietly.
 *
 * `decodeCell` and `encodeCell` are total over their inputs and never throw. `encodeCell` has three
 * outcomes rather than two — write, omit, or `unwritable` with a reason — because a canonical value
 * that does not fit its field type is either a caller bug or a corrupted row, and silently omitting
 * the key would be exactly the class of loss this module exists to prevent.
 *
 * Two units are fixed once, here: `percent` stores percent points (`25` is 25%), and `duration`
 * stores a whole number of seconds. `date` values are `YYYY-MM-DD` and never touch a timezone;
 * `datetime` values must carry their own offset (`Z` or `±HH:MM`), because an instant without a
 * zone parsed on the machine of whoever happens to read it is a different instant.
 */
import { hasOffset, instantOf, parseCalendarDate } from '../format/iso';
import { isIdOfKind } from './ids';
import type { JsonValue } from './json';
import type { DocumentFieldTypeId } from './schema';

/** The canonical in-memory value of one cell. `null` is "no value" — never "empty". */
export type CanonicalCell = string | number | boolean | null | readonly string[];

/** A value the field cannot represent, kept exactly as the file spelled it. */
export interface InvalidCell {
	readonly invalid: true;
	readonly raw: JsonValue;
	readonly reason: string;
}

/** The verdict of decoding one cell: a canonical value, or the preserved invalid one. */
export type CellDecode =
	| { readonly kind: 'value'; readonly value: CanonicalCell }
	| { readonly kind: 'invalid'; readonly value: InvalidCell };

/** The verdict of encoding one cell: write it, omit the key, or report it unwritable. */
export type CellEncode =
	| { readonly kind: 'write'; readonly json: JsonValue }
	| { readonly kind: 'omit' }
	| { readonly kind: 'unwritable'; readonly reason: string };

/** True for a preserved invalid value. */
export function isInvalidCell(value: CanonicalCell | InvalidCell): value is InvalidCell {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Package a raw value as the preserved invalid shape. */
export function invalidCell(raw: JsonValue, reason: string): InvalidCell {
	return { invalid: true, raw, reason };
}

function value(cell: CanonicalCell): CellDecode {
	return { kind: 'value', value: cell };
}

function invalid(raw: JsonValue, reason: string): CellDecode {
	return { kind: 'invalid', value: invalidCell(raw, reason) };
}

/** True when the JSON value is usable as a text cell. Any string is; validators only warn. */
function decodeText(raw: JsonValue): CellDecode {
	return typeof raw === 'string' ? value(raw) : invalid(raw, 'not a string');
}

/** Finite JSON numbers, shared by `number`, `currency` and `percent` (percent points). */
function decodeNumber(raw: JsonValue): CellDecode {
	if (typeof raw === 'number' && Number.isFinite(raw)) {
		return value(raw);
	}
	return invalid(raw, 'not a finite number');
}

/** A whole, non-negative number — `duration` (seconds) and `rating` share this shape. */
function decodeWholeCount(raw: JsonValue, unit: string): CellDecode {
	if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) {
		return value(raw);
	}
	return invalid(raw, `not a whole, non-negative number of ${unit}`);
}

/** Why a string cannot serve as a vault-relative attachment path, or `undefined` when it can. */
function attachmentPathProblem(path: string): string | undefined {
	if (path.trim() === '') {
		return 'an empty path';
	}
	if (path.startsWith('/') || path.startsWith('\\')) {
		return 'an absolute path';
	}
	if (/^[a-zA-Z]:/.test(path)) {
		return 'a path that names a drive';
	}
	if (path.split(/[\\/]/).includes('..')) {
		return 'a path that climbs out of the vault';
	}
	return undefined;
}

/** An ordered list of strings of one id kind, with no duplicates. `[]` is no value. */
function decodeIdList(
	raw: JsonValue,
	kind: 'option' | 'row',
	plural: string,
	singular: string,
): CellDecode {
	if (!Array.isArray(raw)) {
		return invalid(raw, `not a list of ${plural}`);
	}
	if (raw.length === 0) {
		return value(null);
	}
	const items: string[] = [];
	for (const item of raw) {
		if (typeof item !== 'string' || !isIdOfKind(kind, item)) {
			return invalid(raw, `not a list of ${plural}`);
		}
		if (items.includes(item)) {
			return invalid(raw, `the same ${singular} twice`);
		}
		items.push(item);
	}
	return value(items);
}

/** Ordered vault-relative attachment paths. `[]` is no value; a missing file is not a value error. */
function decodeAttachments(raw: JsonValue): CellDecode {
	if (!Array.isArray(raw)) {
		return invalid(raw, 'not a list of attachment paths');
	}
	if (raw.length === 0) {
		return value(null);
	}
	const paths: string[] = [];
	for (const item of raw) {
		if (typeof item !== 'string') {
			return invalid(raw, 'not a list of attachment paths');
		}
		const problem = attachmentPathProblem(item);
		if (problem !== undefined) {
			return invalid(raw, `not a vault-relative attachment path: ${problem}`);
		}
		paths.push(item);
	}
	return value(paths);
}

/** Decode one cell against its field type. `undefined` (an absent key) is no value, for every type. */
export function decodeCell(type: DocumentFieldTypeId, raw: JsonValue | undefined): CellDecode {
	if (raw === undefined || raw === null) {
		return value(null);
	}
	switch (type) {
		case 'text':
		case 'longText':
		case 'url':
		case 'email':
		case 'phone':
			return decodeText(raw);
		case 'number':
		case 'currency':
		case 'percent':
			return decodeNumber(raw);
		case 'duration':
			return decodeWholeCount(raw, 'seconds');
		case 'rating':
			return decodeWholeCount(raw, 'rating points');
		case 'checkbox':
			return typeof raw === 'boolean' ? value(raw) : invalid(raw, 'not true or false');
		case 'date': {
			if (typeof raw !== 'string') {
				return invalid(raw, 'not a calendar date');
			}
			return parseCalendarDate(raw) === undefined
				? invalid(raw, 'not a calendar date')
				: value(raw);
		}
		case 'datetime': {
			if (typeof raw !== 'string' || instantOf(raw) === undefined) {
				return invalid(raw, 'not an instant');
			}
			// The offset check runs second on purpose: "yesterday" is not a zone-less instant, it is
			// not an instant at all, and the message should say the true thing.
			if (!hasOffset(raw)) {
				return invalid(raw, 'an instant without an offset');
			}
			return value(raw);
		}
		case 'singleSelect': {
			if (typeof raw !== 'string' || !isIdOfKind('option', raw)) {
				return invalid(raw, 'not an option id');
			}
			// A shaped but unknown option id is *valid at this layer*: whether it belongs to the
			// field's option list is the field validator's finding (step 6), and the value stays
			// either way (ADR-0004 §4).
			return value(raw);
		}
		case 'multiSelect':
			return decodeIdList(raw, 'option', 'option ids', 'option id');
		case 'attachment':
			return decodeAttachments(raw);
		case 'link': {
			if (typeof raw === 'string') {
				return isIdOfKind('row', raw) ? value(raw) : invalid(raw, 'not a row id');
			}
			// Cardinality against the field's `allowMultiple` is step 6's check; both spellings are
			// recognised here so the single-link case has one canonical in-memory form per document.
			return decodeIdList(raw, 'row', 'row ids', 'row id');
		}
		case 'createdTime':
		case 'lastModifiedTime':
			return invalid(raw, 'a read-only time column; its value comes from the file');
	}
}

/** Deep equality for canonical values: same scalar, or same list in the same order. */
function sameValue(a: CanonicalCell, b: CanonicalCell): boolean {
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
			return false;
		}
		return a.every((item, index) => item === b[index]);
	}
	return a === b;
}

/**
 * Encode one cell for writing.
 *
 * The candidate JSON is decoded again and compared to the value that was handed in; only a value
 * that survives its own codec is written. That check is the difference between "the writer wrote
 * something" and "the writer wrote *this*", and it costs one comparison per cell.
 */
export function encodeCell(
	type: DocumentFieldTypeId,
	cell: CanonicalCell | InvalidCell,
): CellEncode {
	if (isInvalidCell(cell)) {
		return { kind: 'write', json: cell.raw };
	}
	if (cell === null) {
		return { kind: 'omit' };
	}
	if (type === 'createdTime' || type === 'lastModifiedTime') {
		return { kind: 'unwritable', reason: 'a read-only time column is never written' };
	}
	const decoded = decodeCell(type, cell);
	if (decoded.kind !== 'value') {
		return { kind: 'unwritable', reason: decoded.value.reason };
	}
	if (!sameValue(decoded.value, cell)) {
		return { kind: 'unwritable', reason: 'the value does not fit its field type' };
	}
	return { kind: 'write', json: cell };
}
