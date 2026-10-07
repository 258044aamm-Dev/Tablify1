/**
 * `duration` — seconds in the canonical value, rendered `h:mm:ss` (docs/03 §the mapping table, P12).
 *
 * The parser rule, written down because the old build got it wrong (`prototype/AUDIT-REPORT.md` §8: typing
 * `45m` stored **45 seconds** — an unanchored clock regex matched a prefix, and a bare number was read in
 * the field's unit before explicit units were considered):
 *
 *   1. **An explicit unit always wins.** `45m` is 2,700 seconds, `2h` is 7,200, `1h30m` is 5,400, `90s` is
 *      90. Units may be combined with or without spaces, and a fraction is allowed (`1.5h`).
 *   2. **A bare number is read in the column's own unit** — `fieldOptions.unit`, seconds by default
 *      (`90` ⇒ 90 s; `unit: minutes` ⇒ `90` is 5,400 s). Units are never guessed from magnitude.
 *   3. **A clock form is `h:mm` or `h:mm:ss`**, hours first, matching what this type renders.
 *   4. **Nothing is rejected as "ambiguous" except a shape with two real readings** — and one shape has
 *      one: `1:30` reads as 1 h 30 m (clock, hours first) or as 1 m 30 s (mm:ss). It is accepted with a
 *      **warning** naming both readings, so an import preview can show the user what it did. Every explicit
 *      unit form is unambiguous and therefore silent: `45m` is not a judgement call.
 *   5. Rejected: a unit followed by a unit-less number (`1h 30`), a leading or trailing colon (`:30`, `1:`),
 *      four clock groups, word units (`45 minutes`), and negative values — a duration is a length of time.
 *
 * The old build's other reported bug (`AUDIT-REPORT.md` §13, a value turning into nonsense when a column's
 * type changed) is a *conversion* bug, not a parsing one: nothing here reads the raw value of another type.
 */
import type { FieldContext, FieldDescriptor, FilterOpId, Parsed, CellValue } from '../types';
import { parseFailed, parsed } from '../types';
import {
	compareNullableNumbers,
	matchesNumeric,
	numericGroupKey,
	parseDecimalLocalized,
} from '../format/numbers';
import { registerField } from './registry';

/** The canonical value of a duration cell: whole or fractional seconds, or `null`. */
export type DurationValue = number | null;

/** `h:mm` or `h:mm:ss`. */
const CLOCK_FORM = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/;

/**
 * A length written entirely in unit groups: `45m`, `2h`, `1h30m`, `1h 30m`, `90s`. The whole string must
 * match, which is what keeps `1h 30` (a unit followed by a bare number) out of this reader.
 */
const UNIT_GROUPS_WHOLE = /^\s*(?:\d+(?:\.\d+)?\s*(?:h|m|s)\s*)+$/i;

/** One `<number><unit>` group inside a string that already matched the whole-string form. */
const UNIT_GROUP = /(\d+(?:\.\d+)?)\s*(h|m|s)/gi;

/** Seconds in one unit. The regexes above only produce these three. */
function secondsPerUnit(unit: string): number {
	switch (unit.toLowerCase()) {
		case 'h':
			return 3600;
		case 'm':
			return 60;
		default:
			return 1;
	}
}

/** The unit a bare number is read in, from `fieldOptions.unit` (seconds by default, P12). */
function unitSeconds(ctx: FieldContext): number {
	const unit = ctx.fieldOptions.unit;
	return unit === 'hours' ? 3600 : unit === 'minutes' ? 60 : 1;
}

/** Seconds from a clock form, with a warning when `h:mm` could also be read as `mm:ss`. */
function fromClockForm(text: string): Parsed<DurationValue> | undefined {
	const match = CLOCK_FORM.exec(text);
	if (match === null) {
		return undefined;
	}
	const [, hours, minutes, seconds] = match;
	if (hours === undefined || minutes === undefined) {
		return undefined;
	}
	const hourPart = Number(hours);
	const minutePart = Number(minutes);
	const secondPart = seconds === undefined ? 0 : Number(seconds);
	if (minutePart > 59 || secondPart > 59) {
		return parseFailed(
			'a clock form reads h:mm[:ss]; minutes and seconds must be under 60',
			text,
		);
	}
	const total = hourPart * 3600 + minutePart * 60 + secondPart;
	if (seconds === undefined && hourPart < 60) {
		return parsed(
			total,
			`"${text}" was read as ${hourPart} h ${minutePart} m (clock form); write 0:${hours}:${minutes} for ${hourPart} m ${minutePart} s`,
		);
	}
	return parsed(total);
}

/**
 * Seconds from one or more `<number><unit>` groups, or `undefined` when the text is not that shape at all.
 *
 * The whole string is matched first, in one pass with no shared cursor: an earlier version replaced each
 * match in place and kept the regex's `lastIndex` across the mutation, which read `1h30m` as `1h` plus a
 * leftover `30` and refused it. One pass over an already-validated string cannot drift like that.
 */
function fromUnitGroups(text: string): Parsed<DurationValue> | undefined {
	if (!UNIT_GROUPS_WHOLE.test(text)) {
		return undefined;
	}
	let total = 0;
	UNIT_GROUP.lastIndex = 0;
	for (let match = UNIT_GROUP.exec(text); match !== null; match = UNIT_GROUP.exec(text)) {
		const amount = match[1];
		const unit = match[2];
		if (amount === undefined || unit === undefined) {
			continue;
		}
		total += Number(amount) * secondsPerUnit(unit);
	}
	UNIT_GROUP.lastIndex = 0;
	return parsed(Math.round(total));
}

/** Reads a duration from text or a number, following the five rules in the file header. */
export function readDuration(raw: unknown, ctx: FieldContext): Parsed<DurationValue> {
	if (raw === null || raw === undefined) {
		return parsed(null);
	}
	if (typeof raw === 'number') {
		if (!Number.isFinite(raw)) {
			return parseFailed('this duration is out of range', raw);
		}
		return raw < 0
			? parseFailed('a duration cannot be negative', raw)
			: parsed(Math.round(raw * unitSeconds(ctx)));
	}
	if (typeof raw !== 'string') {
		return parseFailed('a duration is expected, for example 1:30 or 45m', raw);
	}
	const text = raw.trim();
	if (text === '') {
		return parsed(null);
	}
	if (text.startsWith('-')) {
		return parseFailed('a duration cannot be negative', raw);
	}
	const clock = fromClockForm(text);
	if (clock !== undefined) {
		return clock;
	}
	const groups = fromUnitGroups(text);
	if (groups !== undefined) {
		return groups;
	}
	// A unit letter in a string that is not the group shape is the one real mistake worth naming.
	if (/[hms]/i.test(text) && /\d/.test(text)) {
		return parseFailed(
			'a duration mixes a unit with a number that has none; every number needs a unit (1h 30m)',
			raw,
		);
	}
	const bare = parseDecimalLocalized(text, ctx);
	if (!bare.ok) {
		return parseFailed('a duration is expected, for example 1:30, 45m or 90', raw);
	}
	if (bare.value === null) {
		return parsed(null);
	}
	return bare.value < 0
		? parseFailed('a duration cannot be negative', raw)
		: parsed(Math.round(bare.value * unitSeconds(ctx)));
}

/** `h:mm:ss`, the form docs/03 renders and the form `parsePlain` reads back without a warning. */
export function durationText(seconds: number): string {
	const sign = seconds < 0 ? '-' : '';
	const whole = Math.floor(Math.abs(seconds));
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor((whole % 3600) / 60);
	const rest = whole % 60;
	return `${sign}${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export const durationField: FieldDescriptor<DurationValue> = {
	id: 'duration',
	label: 'Duration',
	icon: 'lucide-timer',
	editable: true,
	defaultValue: null,
	editor: 'number',

	parse: (raw: unknown, ctx: FieldContext): Parsed<DurationValue> => readDuration(raw, ctx),

	toJson(value: DurationValue): CellValue {
		return value;
	},

	formatDisplay(value: DurationValue): string {
		return value === null ? '' : durationText(value);
	},

	/** The same three-part form as the display: `m:ss` would be a second reading of the same text. */
	formatPlain(value: DurationValue): string {
		return value === null ? '' : durationText(value);
	},

	parsePlain: (text: string, ctx: FieldContext): Parsed<DurationValue> => readDuration(text, ctx),

	filterOps: ['is', 'isNot', 'isEmpty', 'isNotEmpty', 'gt', 'gte', 'lt', 'lte'],
	matches(value: DurationValue, op: FilterOpId, operand: unknown, ctx: FieldContext): boolean {
		// A duration operand may be written the way a person writes one (`45m`), not only in seconds.
		const written = typeof operand === 'string' ? readDuration(operand, ctx) : undefined;
		const usable = written !== undefined && written.ok ? written.value : operand;
		return matchesNumeric(value, op, usable);
	},
	compare: (a: DurationValue, b: DurationValue): number => compareNullableNumbers(a, b),
	groupKey: (value: DurationValue): string => numericGroupKey(value),
};

registerField(durationField);
