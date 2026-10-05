/**
 * Locale-aware number rendering and reading, shared by `number`, `currency`, `percent`, `rating` and
 * `duration` — and the numeric operator semantics they all implement.
 *
 * The split is deliberate and is what makes a copy round-trip: `formatDisplay` renders for a reader (locale
 * grouping, a symbol, a unit), while `formatPlain` renders for a machine — no grouping, `.` as the decimal
 * separator, no thousands separator — so `parsePlain(formatPlain(v)) === v` holds in every locale. Reading a
 * value back is the same split in reverse: the **localized** reader understands what a cell displays
 * (`parseDecimalLocalized`), while the strict `parseDecimal` is the machine grammar every canonical value
 * satisfies.
 *
 * **`Intl` fallback.** `Intl.NumberFormat` throws a `RangeError` for a locale tag it cannot use (for example
 * a vault whose locale setting is misspelled — the message is `RangeError: Incorrect locale information
 * provided`). Rather than let a render throw, every lookup walks three steps: the requested locale, then
 * `en`, then a plain decimal rendering of the value. The reason is recorded so a caller can show it;
 * `localeProblemFor` reads it back, and `tests/unit/field-roundtrip.test.ts` asserts both the fallback
 * output and the recorded reason.
 */
import type { FieldContext, FilterOpId, Parsed } from '../types';
import { parseFailed, parsed } from '../types';
import { toAsciiDigits } from './digits';

/** Formatters are expensive; one per locale+options is kept for the session. */
const formatters = new Map<string, Intl.NumberFormat>();

/** Why a locale could not be used, per locale tag. Read by {@link localeProblemFor}. */
const localeProblems = new Map<string, string>();

/** The locale used when the requested one is unusable. `en` exists in every ICU build. */
const FALLBACK_LOCALE = 'en';

/** The reason a locale could not be used, or `undefined` when it formatted fine. */
export function localeProblemFor(locale: string): string | undefined {
	return localeProblems.get(locale);
}

/** A formatter for a locale and options, or `undefined` when that locale is unusable. */
function formatterFor(
	locale: string,
	options: Intl.NumberFormatOptions,
): Intl.NumberFormat | undefined {
	const key = `${locale}|${JSON.stringify(options)}`;
	const cached = formatters.get(key);
	if (cached !== undefined) {
		return cached;
	}
	try {
		const created = new Intl.NumberFormat(locale, options);
		formatters.set(key, created);
		return created;
	} catch (error) {
		// `String(error)` is the point: the recorded reason names the RangeError and its message, which is
		// what a settings screen needs to tell the user that their locale tag is not usable.
		localeProblems.set(
			locale,
			`the locale "${locale}" is not usable for numbers: ${String(error)}`,
		);
		return undefined;
	}
}

/**
 * Formats a number for a reader. Falls back to `en` and then to a plain rendering when the context's locale
 * is unusable, so no render can throw.
 */
export function formatDecimal(
	value: number,
	ctx: FieldContext,
	options: Intl.NumberFormatOptions = {},
): string {
	const preferred = formatterFor(ctx.locale, options);
	if (preferred !== undefined) {
		return preferred.format(value);
	}
	const fallback = formatterFor(FALLBACK_LOCALE, options);
	return fallback === undefined ? String(value) : fallback.format(value);
}

/** Rounds a number to a number of decimals without floating-point drift in the rendered text. */
export function roundTo(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

/** `formatDecimal` with a fixed number of decimals, used by `currency` and `percent`. */
export function formatFixed(value: number, ctx: FieldContext, decimals: number): string {
	return formatDecimal(roundTo(value, decimals), ctx, {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	});
}

/**
 * Parses a machine-readable decimal: an optional sign, digits with optional `_`, `'` or space grouping, an
 * optional `.` fraction and an optional exponent. A comma is refused with a message instead of guessed at,
 * because `1,234` is a thousand and a decimal fraction in different locales and the canonical form is
 * unambiguous. Empty input is `null` (no value), not an error.
 */
export function parseDecimal(text: string): Parsed<number | null> {
	const cleaned = text.replace(/[\s_']/g, '');
	if (cleaned === '') {
		return parsed(null);
	}
	if (cleaned.includes(',')) {
		return parseFailed(
			'a number must use "." as its decimal separator; "1,5" is ambiguous',
			text,
		);
	}
	if (!/^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(cleaned)) {
		return parseFailed('this is not a number', text);
	}
	const value = Number(cleaned);
	if (!Number.isFinite(value)) {
		return parseFailed('this number is out of range', text);
	}
	return parsed(value);
}

/** The separators a locale writes numbers with, read from `Intl` rather than assumed. */
export type NumberSeparators = {
	readonly group: string;
	readonly decimal: string;
};

/** The locale's group and decimal separators. Falls back to `.`/`,` when `Intl` cannot be used. */
export function separatorsFor(locale: string): NumberSeparators {
	const formatter = formatterFor(locale, { useGrouping: true, minimumFractionDigits: 1 });
	const fallback: NumberSeparators = { group: ',', decimal: '.' };
	if (formatter === undefined) {
		return fallback;
	}
	const parts = formatter.formatToParts(12345.6);
	const group = parts.find((part) => part.type === 'group')?.value;
	const decimal = parts.find((part) => part.type === 'decimal')?.value;
	return { group: group ?? fallback.group, decimal: decimal ?? fallback.decimal };
}

/**
 * Whether a run of groups divided by the locale's separator is a real grouping: Western (`1,234,567`) or
 * Indian (`12,34,567`), both of which `Intl` produces depending on the locale.
 *
 * This test is what separates "read the number the cell is showing" from "guess at a typo": `1,5` in an
 * `en-GB` vault is not a grouped number by either rule (a single trailing group is not three digits, and two
 * groups cannot be Indian), so it is left alone and the strict grammar refuses it with a message. That is
 * deliberate — silently reading `1,5` as 15 would be a data-destroying guess.
 */
function groupingHolds(groups: readonly string[]): boolean {
	const first = groups[0];
	if (first === undefined || first.length < 1 || first.length > 3) {
		return false;
	}
	const rest = groups.slice(1);
	if (rest.some((group) => group.length === 0)) {
		return false;
	}
	if (rest.every((group) => group.length === 3)) {
		return true;
	}
	// Indian grouping: a final group of three, then groups of two, with a leading group of one or two.
	const last = rest[rest.length - 1];
	return (
		first.length <= 2 &&
		last !== undefined &&
		last.length === 3 &&
		rest.slice(0, -1).every((group) => group.length === 2)
	);
}

/**
 * Parses a number the way the vault's locale writes it, which is the form `formatDisplay` renders.
 *
 * Three steps, in this order, and the order is the whole trick:
 *
 *   1. **The locale's own numerals are translated to ASCII** (`format/digits.ts`): a `bn-BD` vault shows
 *      `১,২৩৪.৫`, and a value a user can see must be a value they can type.
 *   2. **The locale's group separator is removed when the grouping is real** (Western or Indian, see
 *      {@link groupingHolds}), and its decimal separator is normalised to `.`. A separator that is not a
 *      grouping is left in place, so the strict grammar refuses it rather than mis-reading it.
 *   3. The **strict** grammar of {@link parseDecimal} takes over: one `.`, one optional sign, no guessing.
 *
 * A vault with an unusable locale falls back to `.`/`,` (see {@link separatorsFor}), which is the same
 * fallback the formatter uses — so what is displayed and what is read back always agree.
 */
export function parseDecimalLocalized(text: string, ctx: FieldContext): Parsed<number | null> {
	const trimmed = toAsciiDigits(text.trim(), ctx.locale);
	if (trimmed === '') {
		return parsed(null);
	}
	const { group, decimal } = separatorsFor(ctx.locale);
	let cleaned = trimmed;
	if (group !== '' && decimal !== group) {
		const decimalAt = cleaned.indexOf(decimal);
		const integerPart = decimalAt === -1 ? cleaned : cleaned.slice(0, decimalAt);
		const fractionPart = decimalAt === -1 ? '' : cleaned.slice(decimalAt + decimal.length);
		const groups = integerPart.split(group);
		if (groups.length > 1 && groupingHolds(groups) && !fractionPart.includes(group)) {
			cleaned = `${groups.join('')}${decimalAt === -1 ? '' : `.${fractionPart}`}`;
		} else if (decimal !== '.') {
			cleaned = cleaned.split(decimal).join('.');
		}
	}
	return parseDecimal(cleaned);
}

/**
 * A numeric filter operand, or a refusal. Same discipline as `text`'s operand reading: an absent operand is
 * invalid here (unlike text, where "no operand" is the empty string), because "is null" is what `isEmpty` is
 * for, and an operand that cannot be a number must not silently match every row.
 */
export type NumericOperand =
	{ readonly kind: 'number'; readonly value: number } | { readonly kind: 'invalid' };

/** Reads a filter operand as a number: a number, or a string in the canonical decimal form. */
export function readNumericOperand(operand: unknown): NumericOperand {
	if (typeof operand === 'number' && Number.isFinite(operand)) {
		return { kind: 'number', value: operand };
	}
	if (typeof operand === 'string') {
		const parsedOperand = parseDecimal(operand);
		if (parsedOperand.ok && parsedOperand.value !== null) {
			return { kind: 'number', value: parsedOperand.value };
		}
	}
	return { kind: 'invalid' };
}

/** Orders two possibly-absent numbers: values ascending, absent last, equal values stable. */
export function compareNullableNumbers(a: number | null, b: number | null): number {
	if (a === b) {
		return 0;
	}
	if (a === null) {
		return 1;
	}
	if (b === null) {
		return -1;
	}
	return a > b ? 1 : -1;
}

/** The grouping key of a possibly-absent number: its canonical text, or `""` for absent. */
export function numericGroupKey(value: number | null): string {
	return value === null ? '' : String(value);
}

/**
 * Every operator the five numeric types declare, in one place: `is`, `isNot`, `isEmpty`, `isNotEmpty` and
 * the four comparisons. A text operator returns false rather than answering with a string comparison.
 */
export function matchesNumeric(value: number | null, op: FilterOpId, operand: unknown): boolean {
	const read = readNumericOperand(operand);
	switch (op) {
		case 'isEmpty':
			return value === null;
		case 'isNotEmpty':
			return value !== null;
		case 'is':
			return read.kind === 'number' && value === read.value;
		case 'isNot':
			return read.kind === 'number' && value !== read.value;
		case 'gt':
			return read.kind === 'number' && value !== null && value > read.value;
		case 'gte':
			return read.kind === 'number' && value !== null && value >= read.value;
		case 'lt':
			return read.kind === 'number' && value !== null && value < read.value;
		case 'lte':
			return read.kind === 'number' && value !== null && value <= read.value;
		case 'contains':
		case 'notContains':
		case 'startsWith':
		case 'endsWith':
			return false;
	}
}
