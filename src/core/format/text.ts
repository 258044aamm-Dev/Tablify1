/**
 * Text comparison, matching and grouping, shared by `text`, `longText`, `url`, `email` and `phone`.
 *
 * Two rules that everything in the grid depends on:
 *
 *   1. **Equality is by collation, not by code unit.** Ordering and matching use the vault's locale, so `a`
 *      sorts with `A` rather than after every upper-case letter. When collation says two values are equal,
 *      `groupKey` must be equal too — that is what keeps "group by" and "sort by" from disagreeing — so
 *      `compare` breaks a collation tie with a code-point comparison, and `groupKey` returns a case-folded
 *      form of the value.
 *   2. **An absent value sorts last, and is its own group.** `null` means "no value", which is not the same
 *      as the empty string, and it must never be sorted between `A` and `B`.
 */
import type { FilterOpId } from '../types';

/** One collator per locale; constructing one is expensive. */
const collators = new Map<string, Intl.Collator>();

/** Why a locale could not be used for collation, per tag. */
const localeProblems = new Map<string, string>();

/** The locale used when the requested one is unusable. */
const FALLBACK_LOCALE = 'en';

/** Orders two texts. Values ascending, absent last, and a collation tie broken by code point. */
export function compareNullableText(
	a: string | null,
	b: string | null,
	locale = FALLBACK_LOCALE,
): number {
	if (a === null) {
		return b === null ? 0 : 1;
	}
	if (b === null) {
		return -1;
	}
	const collated = collatorFor(locale)?.compare(a, b) ?? (a < b ? -1 : a > b ? 1 : 0);
	if (collated !== 0) {
		return collated < 0 ? -1 : 1;
	}
	// Equal under collation: fall back to code points, so `compare` is a total order and equal means equal.
	return a === b ? 0 : a < b ? -1 : 1;
}

/** A collator, or `undefined` when the locale is unusable. The reason is recorded for the caller. */
function collatorFor(locale: string): Intl.Collator | undefined {
	const cached = collators.get(locale);
	if (cached !== undefined) {
		return cached;
	}
	try {
		const created = new Intl.Collator(locale, { sensitivity: 'variant', numeric: true });
		collators.set(locale, created);
		return created;
	} catch (error) {
		localeProblems.set(
			locale,
			`the locale "${locale}" is not usable for text: ${String(error)}`,
		);
		return undefined;
	}
}

/** The reason a locale could not be used for text, or `undefined` when it was fine. */
export function localeProblemFor(locale: string): string | undefined {
	return localeProblems.get(locale);
}

/**
 * The grouping key of a text value: case-folded with runs of whitespace collapsed, so a column of `Done`
 * and `done ` groups as one value. `null` groups under `""`, which no real value can produce.
 */
export function textGroupKey(value: string | null): string {
	return value === null ? '' : value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * Reads a filter operand without throwing, with the same policy `text` established in step 06: strings are
 * taken as they are, scalars are stringified (a filter on "42" should match the number `42`), an absent
 * operand is the empty string, and anything else — an object, an array, a function, a symbol — is
 * **invalid** rather than being coerced to `"[object Object]"` or `""`.
 */
export type TextOperand =
	{ readonly kind: 'text'; readonly text: string } | { readonly kind: 'invalid' };

/** Reads a filter operand as text. See {@link TextOperand} for the policy. */
export function readTextOperand(operand: unknown): TextOperand {
	if (operand === null || operand === undefined) {
		return { kind: 'text', text: '' };
	}
	if (typeof operand === 'string') {
		return { kind: 'text', text: operand };
	}
	if (
		typeof operand === 'number' ||
		typeof operand === 'boolean' ||
		typeof operand === 'bigint'
	) {
		return { kind: 'text', text: String(operand) };
	}
	return { kind: 'invalid' };
}

/**
 * The text operators, in one place: the same semantics `text` implements, so every text-shaped type answers
 * a filter identically. Matching is substring-based on a folded form (NFC, trimmed, lower-cased in the
 * context's locale) because filtering a text column is a search, not a diff.
 */
export function matchesText(
	value: string | null,
	op: FilterOpId,
	operand: unknown,
	locale = FALLBACK_LOCALE,
): boolean {
	const normal = (text: string): string => text.normalize('NFC').trim().toLocaleLowerCase(locale);
	switch (op) {
		case 'isEmpty':
			return value === null || value.trim() === '';
		case 'isNotEmpty':
			return value !== null && value.trim() !== '';
		default: {
			const read = readTextOperand(operand);
			if (read.kind === 'invalid' || value === null) {
				return false;
			}
			const haystack = normal(value);
			const needle = normal(read.text);
			switch (op) {
				case 'contains':
					return haystack.includes(needle);
				case 'notContains':
					return !haystack.includes(needle);
				case 'startsWith':
					return haystack.startsWith(needle);
				case 'endsWith':
					return haystack.endsWith(needle);
				case 'is':
					return haystack === needle;
				case 'isNot':
					return haystack !== needle;
				default:
					return false;
			}
		}
	}
}

/**
 * The clipboard form of a list of labels, and the reader for it.
 *
 * A comma inside a label is the one thing that can break `parsePlain(formatPlain(v)) === v` for a
 * multi-value cell, so the two halves are written together and the escaping rule is explicit: a label
 * containing a comma, a double quote or a newline is written inside double quotes, with `"` doubled —
 * RFC 4180's rule, which is also what a spreadsheet does. Everything else is written bare.
 */
export function joinLabelList(labels: readonly string[]): string {
	return labels
		.map((label) => (/[",\n]/.test(label) ? `"${label.split('"').join('""')}"` : label))
		.join(', ');
}

/** Splits what {@link joinLabelList} wrote (and what a spreadsheet paste contains) back into labels. */
export function splitLabelList(text: string): readonly string[] {
	const labels: string[] = [];
	let current = '';
	let quoted = false;
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		if (character === undefined) {
			continue;
		}
		if (quoted) {
			if (character === '"') {
				if (text[index + 1] === '"') {
					current += '"';
					index += 1;
				} else {
					quoted = false;
				}
			} else {
				current += character;
			}
		} else if (character === '"') {
			quoted = true;
		} else if (character === ',') {
			if (current.trim() !== '') {
				labels.push(current.trim());
			}
			current = '';
		} else {
			current += character;
		}
	}
	if (current.trim() !== '') {
		labels.push(current.trim());
	}
	return labels;
}
