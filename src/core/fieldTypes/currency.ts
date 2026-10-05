/**
 * `currency` — a number whose symbol and precision are **render-only** (docs/03 §the mapping table).
 *
 * `toYaml` writes the bare number, because a symbol belongs to the view, not to the note: changing `$` to
 * `€` in `fieldOptions` must not rewrite a single file. The symbol is prefixed with the sign in front of it
 * (`-$5.00`); placement is not localised, because a symbol is not a currency code and `Intl`'s currency
 * style needs one. That is a deliberate simplification, recorded here and in PROGRESS.md.
 */
import type { FieldContext, FieldDescriptor, FilterOpId, Parsed, YamlValue } from '../types';
import { parseFailed, parsed } from '../types';
import {
	compareNullableNumbers,
	formatFixed,
	matchesNumeric,
	numericGroupKey,
	parseDecimalLocalized,
} from '../format/numbers';
import { toAsciiDigits } from '../format/digits';
import { registerField } from './registry';

/** The canonical value of a currency cell: a finite number, or `null`. */
export type CurrencyValue = number | null;

/** The default number of decimals when `fieldOptions.precision` is absent. */
const DEFAULT_PRECISION = 2;

/** The symbol configured for this column, or `''` when the base does not ask for one. */
function symbolFor(ctx: FieldContext): string {
	return ctx.fieldOptions.symbol ?? '';
}

/** The decimals configured for this column, defaulting to two. */
function precisionFor(ctx: FieldContext): number {
	return ctx.fieldOptions.precision ?? DEFAULT_PRECISION;
}

/**
 * Reads a monetary amount, so that what `formatDisplay` renders can be typed back in.
 *
 * The symbol may sit on either side of the number, and next to the sign (`-$3.50` on one platform,
 * `$-3.50` on another), so the leading sign is read first and everything that is not part of a number is
 * removed: digits and the two separators (`format/numbers.ts` normalises them in the vault's locale) remain.
 *
 * Two refusals, because silently dropping a character would be a silent data change:
 *   - **a letter** — `12 usd` and `1.2e3 kg` are not amounts this type can read;
 *   - **a percent sign** — an amount with a `%` is a different unit, and this type must not guess.
 */
function readAmount(text: string, ctx: FieldContext): Parsed<CurrencyValue> {
	// The locale's numerals first: a `bn-BD` vault renders `৳১,২৩৪.৫০`, and the extraction below is ASCII.
	const translated = toAsciiDigits(text, ctx.locale);
	if (/\p{L}/u.test(translated)) {
		return parseFailed('an amount is a number, optionally with a currency symbol', text);
	}
	if (translated.includes('%')) {
		return parseFailed('an amount is not a percentage', text);
	}
	const sign = /^[^0-9]*-/.test(translated) ? '-' : '';
	const digits = translated.replace(/[^\d.,]/g, '');
	return parseDecimalLocalized(`${sign}${digits}`, ctx);
}

export const currencyField: FieldDescriptor<CurrencyValue> = {
	id: 'currency',
	label: 'Currency',
	icon: 'lucide-circle-dollar-sign',
	editable: true,
	defaultValue: null,
	editor: 'number',

	parse(raw: unknown, ctx: FieldContext): Parsed<CurrencyValue> {
		if (raw === null || raw === undefined) {
			return parsed(null);
		}
		if (typeof raw === 'number') {
			return Number.isFinite(raw)
				? parsed(raw)
				: parseFailed('this amount is out of range', raw);
		}
		if (typeof raw === 'string') {
			return readAmount(raw, ctx);
		}
		return parseFailed('an amount is expected here', raw);
	},

	toYaml(value: CurrencyValue): YamlValue {
		return value;
	},

	formatDisplay(value: CurrencyValue, ctx: FieldContext): string {
		if (value === null) {
			return '';
		}
		const symbol = symbolFor(ctx);
		const digits = formatFixed(Math.abs(value), ctx, precisionFor(ctx));
		return `${value < 0 ? '-' : ''}${symbol}${digits}`;
	},

	/** The bare number: an export must not depend on what the column renders as. */
	formatPlain(value: CurrencyValue): string {
		return value === null ? '' : String(value);
	},

	parsePlain: (text: string, ctx: FieldContext): Parsed<CurrencyValue> => readAmount(text, ctx),

	filterOps: ['is', 'isNot', 'isEmpty', 'isNotEmpty', 'gt', 'gte', 'lt', 'lte'],
	matches: (value: CurrencyValue, op: FilterOpId, operand: unknown): boolean =>
		matchesNumeric(value, op, operand),
	compare: (a: CurrencyValue, b: CurrencyValue): number => compareNullableNumbers(a, b),
	groupKey: (value: CurrencyValue): string => numericGroupKey(value),
};

registerField(currencyField);
