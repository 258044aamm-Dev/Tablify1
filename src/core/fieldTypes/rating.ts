/**
 * `rating` — a number of stars, capped between `0` and `fieldOptions.max` (five by default).
 *
 * Out-of-range input is **clamped with a warning**, never rejected: a rating of 7 in a five-star column is a
 * real answer that needs a decision, and `parse` never throws. The warning is what the import preview shows
 * so the user can see that 7 became 5.
 *
 * A fractional rating is kept as written (`4.5` shows four and a half stars) — half-stars are a real
 * convention, and rounding a value the user typed is data loss.
 */
import type { FieldContext, FieldDescriptor, FilterOpId, Parsed, YamlValue } from '../types';
import { parseFailed, parsed } from '../types';
import {
	compareNullableNumbers,
	formatDecimal,
	matchesNumeric,
	numericGroupKey,
	parseDecimalLocalized,
} from '../format/numbers';
import { registerField } from './registry';

/** The canonical value of a rating cell: a number within `[0, max]`, or `null`. */
export type RatingValue = number | null;

/** The default cap when `fieldOptions.max` is absent (docs/06 §the type table). */
const DEFAULT_MAX = 5;

/** The cap configured for this column, floored at 1 so a misconfigured option cannot cap at nothing. */
function maxFor(ctx: FieldContext): number {
	const configured = ctx.fieldOptions.max;
	return configured === undefined || configured < 1 ? DEFAULT_MAX : configured;
}

/** The glyphs a rating renders with: a full star, a half star, and an empty star. */
const GLYPH_FULL = '★';
/**
 * A half. `½` rather than the astrological-looking `⯨` (U+2BE8): the vulgar fraction exists in every font a
 * user is likely to have, and a cell that renders as an empty box is worse than one that says "half".
 * {@link GLYPH_HALF_LEGACY} is still *read*, because a rating copied out of a build that wrote it must
 * parse back to the same number.
 */
const GLYPH_HALF = '½';
const GLYPH_HALF_LEGACY = '⯨';
const GLYPH_EMPTY = '☆';

/** Any character that means half a star. */
const HALVES: readonly string[] = [GLYPH_HALF, GLYPH_HALF_LEGACY];

/** Reads the star glyphs in a string as a number, or `undefined` when there are none. */
function glyphSum(text: string): number | undefined {
	let total = 0;
	let seen = false;
	for (const character of text) {
		if (character === GLYPH_FULL) {
			total += 1;
			seen = true;
		} else if (HALVES.includes(character)) {
			total += 0.5;
			seen = true;
		} else if (character === GLYPH_EMPTY) {
			seen = true;
		}
	}
	return seen ? total : undefined;
}

/** Clamps a rating into `[0, max]`, reporting what it did rather than refusing the value. */
function clampRating(value: number, ctx: FieldContext): Parsed<RatingValue> {
	const max = maxFor(ctx);
	if (value < 0) {
		return parsed(0, `a rating cannot be negative; "${String(value)}" was read as 0`);
	}
	if (value > max) {
		return parsed(
			max,
			`this column caps ratings at ${String(max)}; "${String(value)}" was read as ${String(max)}`,
		);
	}
	return parsed(value);
}

/**
 * Reads a rating: a number, a star string, or the star string with its number (`★★★★☆ 4.3/5`).
 *
 * The star string is a real input shape, not a curiosity: it is what a copy out of this grid produces, so
 * `parse(formatDisplay(v))` must return `v`. Two rules make that work — the glyphs sum to the value, and a
 * **number written after the glyphs wins**, because it is the more precise of the two statements.
 */
export function readRating(raw: unknown, ctx: FieldContext): Parsed<RatingValue> {
	if (raw === null || raw === undefined) {
		return parsed(null);
	}
	if (typeof raw === 'string') {
		const text = raw.trim();
		if (text === '') {
			return parsed(null);
		}
		const stars = glyphSum(text);
		if (stars !== undefined) {
			const rest = text
				.replace(/[★☆½⯨]/g, ' ')
				.replace(/\/\s*\d+(?:[.,]\d+)?/g, ' ')
				.trim();
			const written = /-?\d+(?:[.,]\d+)?/.exec(rest)?.[0];
			return clampRating(
				written === undefined ? stars : Number(written.replace(',', '.')),
				ctx,
			);
		}
		// `4.3/5` and `4/5` are written by people; the total is redundant (it is the column's `max`).
		const numeric = parseDecimalLocalized(text.replace(/\s*\/\s*\d+(?:[.,]\d+)?\s*$/, ''), ctx);
		return numeric.ok
			? numeric.value === null
				? parsed(null)
				: clampRating(numeric.value, ctx)
			: numeric;
	}
	if (typeof raw === 'number') {
		return Number.isFinite(raw)
			? clampRating(raw, ctx)
			: parseFailed('a rating is a number', raw);
	}
	return parseFailed('a rating is a number, or a star string', raw);
}

export const ratingField: FieldDescriptor<RatingValue> = {
	id: 'rating',
	label: 'Rating',
	icon: 'lucide-star',
	editable: true,
	defaultValue: null,
	editor: 'rating',

	parse: (raw: unknown, ctx: FieldContext): Parsed<RatingValue> => readRating(raw, ctx),

	toYaml(value: RatingValue): YamlValue {
		return value;
	},

	/**
	 * Stars for a reader, plus the number when the glyphs cannot say the value exactly — a screen reader
	 * cannot count glyphs, and `parse` reads this form straight back.
	 */
	formatDisplay(value: RatingValue, ctx: FieldContext): string {
		if (value === null) {
			return '';
		}
		const max = maxFor(ctx);
		const full = Math.floor(value);
		const fraction = value - full;
		const half = fraction >= 0.5 ? 1 : 0;
		const empty = Math.max(0, Math.ceil(max) - full - half);
		// A half is the one fraction the glyphs can say exactly; anything else adds its number, which is what
		// `parse` prefers when both are present.
		const shown =
			fraction > 0 && fraction !== 0.5 ? ` ${formatDecimal(value, ctx)}/${String(max)}` : '';
		return `${GLYPH_FULL.repeat(full)}${half === 1 ? GLYPH_HALF : ''}${GLYPH_EMPTY.repeat(empty)}${shown}`;
	},

	/** The number alone: a star string is not a value a spreadsheet can use. */
	formatPlain(value: RatingValue): string {
		return value === null ? '' : String(value);
	},

	parsePlain: (text: string, ctx: FieldContext): Parsed<RatingValue> => readRating(text, ctx),

	filterOps: ['is', 'isNot', 'isEmpty', 'isNotEmpty', 'gt', 'gte', 'lt', 'lte'],
	matches(value: RatingValue, op: FilterOpId, operand: unknown): boolean {
		return matchesNumeric(value, op, operand);
	},
	compare: (a: RatingValue, b: RatingValue): number => compareNullableNumbers(a, b),
	groupKey: (value: RatingValue): string => numericGroupKey(value),
};

registerField(ratingField);
