/**
 * `datetime` — an instant, stored as ISO 8601 in UTC (docs/03 §the mapping table).
 *
 * **One spelling per moment.** The canonical form is `2026-10-05T09:30:00Z`, with milliseconds only when the
 * value actually has them. That is what makes `parse(formatDisplay(v)) === v` true, and what keeps two notes
 * that mean the same moment from looking different in a diff. The consequence, stated plainly: an input that
 * carries another offset (`2026-10-05T15:30:00+06:00`) is converted to UTC on parse — the **moment** is
 * preserved to the millisecond, the spelling is not. A file written by another app therefore gets normalised
 * once, the first time the plugin writes it, and never changes again.
 *
 * **A value with no offset is a wall-clock reading**, resolved in the vault's timezone (`ctx.timezone`):
 * `2026-10-05 09:30` in a note means nine-thirty where the vault lives. Values with an offset are absolute
 * and ignore the vault's zone entirely.
 *
 * Comparisons always go through epoch milliseconds, so `09:30Z` and `03:30Z` compare by the moment, never by
 * their text.
 */
import type { FieldContext, FieldDescriptor, FilterOpId, Parsed, YamlValue } from '../types';
import { parseFailed, parsed } from '../types';
import {
	canonicalInstantText,
	compareNullableInstants,
	formatInstantDisplay,
	hasOffset,
	instantGroupKey,
	instantMatches,
	instantOf,
	parseLocalizedWallTime,
	parseWallTime,
	wallTimeToIso,
} from '../format/iso';
import { registerField } from './registry';

/** The canonical value of a datetime cell: ISO 8601 text, or `null`. */
export type DateTimeValue = string | null;

/** Reads an instant from text or from a number of epoch milliseconds, and normalises it to UTC. */
export function readDateTime(raw: unknown, ctx: FieldContext): Parsed<DateTimeValue> {
	if (raw === null || raw === undefined) {
		return parsed(null);
	}
	if (typeof raw === 'number') {
		const ms = instantOf(raw);
		return ms === undefined
			? parseFailed('this timestamp is not a valid instant', raw)
			: parsed(canonicalInstantText(ms));
	}
	if (typeof raw !== 'string') {
		return parseFailed('a date and time are expected, for example 2026-10-05 09:30', raw);
	}
	const text = raw.trim();
	if (text === '') {
		return parsed(null);
	}
	// Absolute: the value names its own instant, so the vault's timezone is not involved.
	if (hasOffset(text)) {
		const ms = instantOf(text);
		return ms === undefined
			? parseFailed('that is not a valid ISO 8601 instant', raw)
			: parsed(canonicalInstantText(ms));
	}
	// A wall-clock reading: what a person types, or what `formatDisplay` renders in the vault's locale.
	const wall = parseWallTime(text) ?? parseLocalizedWallTime(text, ctx);
	if (wall === undefined) {
		return parseFailed('a date and time are expected, for example 2026-10-05 09:30', raw);
	}
	const iso = wallTimeToIso(wall, ctx.timezone);
	const ms = iso === undefined ? undefined : instantOf(iso);
	return ms === undefined
		? parseFailed(`the timezone "${ctx.timezone}" is not usable here`, raw)
		: parsed(canonicalInstantText(ms));
}

export const datetimeField: FieldDescriptor<DateTimeValue> = {
	id: 'datetime',
	label: 'Date and time',
	icon: 'lucide-clock',
	editable: true,
	defaultValue: null,
	editor: 'date',

	parse: (raw: unknown, ctx: FieldContext): Parsed<DateTimeValue> => readDateTime(raw, ctx),

	toYaml(value: DateTimeValue): YamlValue {
		return value;
	},

	/** Rendered in the vault's locale and timezone, because an instant is only meaningful in a zone. */
	formatDisplay: (value: DateTimeValue, ctx: FieldContext): string =>
		formatInstantDisplay(value, ctx),

	/** The stored ISO text: machine-readable, and the form `parsePlain` reads back unchanged. */
	formatPlain(value: DateTimeValue): string {
		return value ?? '';
	},

	parsePlain: (text: string, ctx: FieldContext): Parsed<DateTimeValue> => readDateTime(text, ctx),

	filterOps: ['is', 'isNot', 'isEmpty', 'isNotEmpty', 'gt', 'gte', 'lt', 'lte'],
	matches: (value: DateTimeValue, op: FilterOpId, operand: unknown): boolean =>
		instantMatches(value, op, operand),
	compare: (a: DateTimeValue, b: DateTimeValue): number => compareNullableInstants(a, b),
	groupKey: (value: DateTimeValue, ctx: FieldContext): string => instantGroupKey(value, ctx),
};

registerField(datetimeField);
