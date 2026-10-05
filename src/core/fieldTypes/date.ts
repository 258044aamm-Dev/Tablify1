/**
 * `date` — a calendar date stored as `"YYYY-MM-DD"`, never as a `Date` object (docs/03 §the mapping table).
 *
 * A calendar date has no timezone, so nothing here ever converts one: `formatDisplay` renders the date at
 * UTC midnight in UTC, which is why `2025-09-24` shows as 24 September at every hour of the day and in every
 * vault. Comparisons are between calendar days, not instants.
 *
 * A value that arrives as a full instant (`2025-09-24T06:26:00Z`) is truncated to its **date part as
 * written** — no conversion to the vault's zone. A date column is about the day somebody wrote down.
 */
import type { FieldContext, FieldDescriptor, FilterOpId, Parsed, YamlValue } from '../types';
import { parseFailed, parsed } from '../types';
import {
	calendarDateFromText,
	calendarDateMs,
	calendarDateText,
	formatDate,
	parseCalendarDate,
	parseLocalizedDate,
} from '../format/iso';
import { compareNullableNumbers, matchesNumeric } from '../format/numbers';
import { registerField } from './registry';

/** The canonical value of a date cell: `YYYY-MM-DD`, or `null`. */
export type DateValue = string | null;

/**
 * Reads a calendar date from a string: the canonical `YYYY-MM-DD`, the date part of an instant as written,
 * or the locale's own medium rendering — which is what `formatDisplay` produces, so the date a user is
 * looking at can be typed back into the cell.
 */
export function readDate(raw: unknown, ctx: FieldContext): Parsed<DateValue> {
	if (raw === null || raw === undefined) {
		return parsed(null);
	}
	if (typeof raw !== 'string') {
		return parseFailed('a date is expected as text, for example 2026-10-05', raw);
	}
	const trimmed = raw.trim();
	if (trimmed === '') {
		return parsed(null);
	}
	const bare = parseCalendarDate(trimmed);
	if (bare !== undefined) {
		return parsed(calendarDateText(bare));
	}
	const datePart = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2})(?:[ T]|$)/.exec(trimmed)?.[1];
	if (datePart !== undefined) {
		const fromPart = parseCalendarDate(datePart);
		return fromPart === undefined
			? parseFailed('that day does not exist in this calendar', raw)
			: parsed(calendarDateText(fromPart));
	}
	const localized = parseLocalizedDate(trimmed, ctx);
	return localized === undefined
		? parseFailed('a date is expected, for example 2026-10-05', raw)
		: parsed(calendarDateText(localized));
}

export const dateField: FieldDescriptor<DateValue> = {
	id: 'date',
	label: 'Date',
	icon: 'lucide-calendar',
	editable: true,
	defaultValue: null,
	editor: 'date',

	parse: (raw: unknown, ctx: FieldContext): Parsed<DateValue> => readDate(raw, ctx),

	toYaml(value: DateValue): YamlValue {
		return value;
	},

	/** Rendered at UTC midnight in UTC: a calendar date must not shift with the vault's timezone. */
	formatDisplay(value: DateValue, ctx: FieldContext): string {
		const parts = value === null ? undefined : calendarDateFromText(value);
		if (parts === undefined) {
			return '';
		}
		const utc: FieldContext = { ...ctx, timezone: 'UTC' };
		return formatDate(calendarDateMs(parts), utc, { dateStyle: 'medium' });
	},

	formatPlain(value: DateValue): string {
		return value ?? '';
	},

	parsePlain: (text: string, ctx: FieldContext): Parsed<DateValue> => readDate(text, ctx),

	filterOps: ['is', 'isNot', 'isEmpty', 'isNotEmpty', 'gt', 'gte', 'lt', 'lte'],
	matches(value: DateValue, op: FilterOpId, operand: unknown, ctx: FieldContext): boolean {
		const asDay = (input: unknown): number | null => {
			const read = readDate(input, ctx);
			if (!read.ok || read.value === null) {
				return null;
			}
			const parts = calendarDateFromText(read.value);
			return parts === undefined ? null : calendarDateMs(parts);
		};
		return matchesNumeric(asDay(value), op, asDay(operand));
	},
	compare(a: DateValue, b: DateValue): number {
		const asDay = (value: DateValue): number | null => {
			const parts = value === null ? undefined : calendarDateFromText(value);
			return parts === undefined ? null : calendarDateMs(parts);
		};
		return compareNullableNumbers(asDay(a), asDay(b));
	},
	groupKey(value: DateValue): string {
		return value ?? '';
	},
};

registerField(dateField);
