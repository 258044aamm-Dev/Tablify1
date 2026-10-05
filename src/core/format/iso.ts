/**
 * ISO 8601 handling, shared by `date`, `datetime` and the two read-only file-metadata columns.
 *
 * Two rules the whole grid depends on:
 *
 *   1. **A calendar date is timezone-free.** `date` values are `"YYYY-MM-DD"` and never become a `Date`
 *      that a local timezone could shift: formatting one builds a UTC instant and renders it in UTC, so
 *      `2025-09-24` shows as 24 September in every vault, at every hour, in every zone.
 *   2. **An instant is stored with its offset.** `datetime` values are ISO strings and every comparison
 *      goes through epoch milliseconds, so two spellings of the same moment (`Z` and `+06:00`) compare
 *      equal while two different moments never compare by their text.
 *
 * `Intl` fallback: rendering uses `Intl.DateTimeFormat`, which throws for an unusable locale tag. As in
 * `format/numbers.ts`, the requested locale is tried first, then `en`, and the reason is recorded rather
 * than thrown. The calendar arithmetic above never touches `Intl` at all.
 */
import type { FieldContext, FilterOpId } from '../types';
import { toAsciiDigits } from './digits';

/** Formatters are expensive; one per locale+zone+style is kept for the session. */
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Why a locale could not be used, per tag. */
const localeProblems = new Map<string, string>();

/** The locale used when the requested one is unusable. */
const FALLBACK_LOCALE = 'en';

/** The reason a locale could not be used for dates, or `undefined` when it was fine. */
export function localeProblemFor(locale: string): string | undefined {
	return localeProblems.get(locale);
}

/** Escapes text for use inside a regular expression. */
function escapeForRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A date/time formatter for the context, or `undefined` when the locale is unusable. */
function formatterFor(
	cacheKeyLocale: string,
	options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat | undefined {
	const key = `${cacheKeyLocale}|${JSON.stringify(options)}`;
	const cached = formatters.get(key);
	if (cached !== undefined) {
		return cached;
	}
	try {
		const created = new Intl.DateTimeFormat(cacheKeyLocale, options);
		formatters.set(key, created);
		return created;
	} catch (error) {
		localeProblems.set(
			cacheKeyLocale,
			`the locale "${cacheKeyLocale}" is not usable for dates: ${String(error)}`,
		);
		return undefined;
	}
}

/** Formats a date in the context's locale and timezone, falling back to `en` and then to the ISO date. */
export function formatDate(
	ms: number,
	ctx: FieldContext,
	options: Intl.DateTimeFormatOptions,
): string {
	const withZone: Intl.DateTimeFormatOptions = { ...options, timeZone: ctx.timezone };
	const preferred = formatterFor(ctx.locale, withZone);
	if (preferred !== undefined) {
		return preferred.format(new Date(ms));
	}
	const fallback = formatterFor(FALLBACK_LOCALE, withZone);
	return fallback === undefined
		? new Date(ms).toISOString().slice(0, 10)
		: fallback.format(new Date(ms));
}

/** A calendar date's parts, with no timezone involved. */
export type CalendarDate = {
	readonly year: number;
	readonly month: number;
	readonly day: number;
};

/** Epoch milliseconds from an epoch number or an ISO-ish string; `undefined` when neither parses. */
export function instantOf(raw: unknown): number | undefined {
	if (typeof raw === 'number' && Number.isFinite(raw)) {
		return raw;
	}
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (trimmed === '') {
			return undefined;
		}
		const ms = Date.parse(trimmed.includes(' ') ? trimmed.replace(' ', 'T') : trimmed);
		return Number.isNaN(ms) ? undefined : ms;
	}
	return undefined;
}

/** The canonical form of an instant: ISO 8601 in UTC, seconds to the millisecond. */
export function isoFromMs(ms: number): string {
	return new Date(ms).toISOString();
}

/**
 * The local calendar day of an instant, `YYYY-MM-DD`, for grouping and for plain-text export.
 *
 * The day is read in the **vault's timezone** but formatted in a fixed locale (`en-CA` writes ISO order with
 * ASCII digits), because a grouping key must be a stable string: in a `bn-BD` vault the localized form of the
 * same day is `২০২৬-১০-০৫`, and grouping must not depend on that.
 */
export function localDayKey(ms: number, ctx: FieldContext): string {
	const formatter = formatterFor('en-CA', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		timeZone: ctx.timezone,
	});
	return formatter === undefined ? isoFromMs(ms).slice(0, 10) : formatter.format(new Date(ms));
}

/** True when a year is a leap year, in the Gregorian rule. */
function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** The length of a month, so a date can be validated without going through `Date` (years < 100 are messy). */
function daysInMonth(year: number, month: number): number {
	const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return lengths[month - 1] ?? 0;
}

/** True when the parts form a real calendar date: rejects the 31st of February and month 13. */
export function isRealCalendarDate(parts: CalendarDate): boolean {
	if (parts.month < 1 || parts.month > 12 || parts.day < 1) {
		return false;
	}
	return parts.day <= daysInMonth(parts.year, parts.month);
}

/** The canonical text of a calendar date: `YYYY-MM-DD`, zero-padded. */
export function calendarDateText(parts: CalendarDate): string {
	const month = String(parts.month).padStart(2, '0');
	const day = String(parts.day).padStart(2, '0');
	return `${String(parts.year).padStart(4, '0')}-${month}-${day}`;
}

/**
 * Reads a calendar date from text: `YYYY-MM-DD` or `YYYY/MM/DD` only.
 *
 * Day-first and month-first spellings (`05.10.2026`, `10/05/2026`) are deliberately **not** accepted: the
 * same string means two different days in two conventions, and a spreadsheet import that silently picks one
 * is exactly the class of bug this rewrite exists to remove. `2026-10-05` and `2026/10/05` are the two
 * shapes a machine writes, and both are unambiguous.
 */
export function parseCalendarDate(text: string): CalendarDate | undefined {
	const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text.trim());
	if (match === null) {
		return undefined;
	}
	const [, year, month, day] = match;
	if (year === undefined || month === undefined || day === undefined) {
		return undefined;
	}
	const parts: CalendarDate = { year: Number(year), month: Number(month), day: Number(day) };
	return isRealCalendarDate(parts) ? parts : undefined;
}

/**
 * Epoch milliseconds of a calendar date's UTC midnight, for rendering a date that must not shift.
 *
 * The year is applied with `setUTCFullYear`, not `Date.UTC(year, …)`: `Date.UTC` maps the years 0–99 to
 * 1900–1999, so a note that says `0042-03-15` would otherwise render as 1942.
 */
export function calendarDateMs(parts: CalendarDate): number {
	const base = new Date(Date.UTC(2000, parts.month - 1, parts.day));
	base.setUTCFullYear(parts.year);
	return base.getTime();
}

/** Reads a calendar date back out of its canonical text. */
export function calendarDateFromText(text: string): CalendarDate | undefined {
	return parseCalendarDate(text);
}

/**
 * The zone offset in effect at an instant, as `+06:00`. `undefined` when the zone name is unusable.
 *
 * Read through `Intl`'s `longOffset` name rather than computed, so historical offsets and DST are the
 * runtime's problem, not ours. The locale used for reading the name is fixed at `en-US`, because the offset
 * it prints is the same in every locale.
 */
export function offsetFor(ms: number, timezone: string): string | undefined {
	const parts = formatterFor('en-US', {
		timeZone: timezone,
		timeZoneName: 'longOffset',
		year: 'numeric',
	})?.formatToParts(new Date(ms));
	const name = parts?.find((part) => part.type === 'timeZoneName')?.value;
	if (name === undefined) {
		return undefined;
	}
	if (name === 'GMT' || name === 'UTC') {
		return '+00:00';
	}
	const match = /GMT([+-]\d{2}:\d{2})/.exec(name);
	return match?.[1];
}

/** True when ISO text carries its own offset, so it names an instant without the vault's zone. */
export function hasOffset(text: string): boolean {
	return /(?:Z|[+-]\d{2}:\d{2})$/.test(text.trim());
}

/** A wall-clock reading with no zone: what a person types into a datetime cell. */
export type WallTime = CalendarDate & {
	readonly hour: number;
	readonly minute: number;
	readonly second: number;
};

/** Reads `YYYY-MM-DD[ T]HH:mm[:ss]` or a bare `YYYY-MM-DD`. Returns `undefined` when it is not that shape. */
export function parseWallTime(text: string): WallTime | undefined {
	const trimmed = text.trim();
	const dateOnly = parseCalendarDate(trimmed);
	if (dateOnly !== undefined) {
		return { ...dateOnly, hour: 0, minute: 0, second: 0 };
	}
	const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(
		trimmed,
	);
	if (match === null) {
		return undefined;
	}
	const [, year, month, day, hour, minute, second] = match;
	if (
		year === undefined ||
		month === undefined ||
		day === undefined ||
		hour === undefined ||
		minute === undefined
	) {
		return undefined;
	}
	const date: CalendarDate = { year: Number(year), month: Number(month), day: Number(day) };
	const seconds = second === undefined ? 0 : Number(second);
	if (!isRealCalendarDate(date) || Number(hour) > 23 || Number(minute) > 59 || seconds > 59) {
		return undefined;
	}
	return { ...date, hour: Number(hour), minute: Number(minute), second: seconds };
}

/**
 * The ISO text of a wall-clock reading in a zone: the reading exactly as typed, with that zone's offset.
 *
 * The offset is looked up **twice**. The first lookup uses the day — a wall time has no instant yet, so
 * there is nothing else to look up — and the second uses the instant the first lookup produced. That is what
 * makes a reading on a daylight-saving boundary resolve to the offset actually in force at that moment
 * rather than the offset in force at midnight. Two passes always suffice: the second reads the offset of an
 * instant already within an hour of the answer.
 */
export function wallTimeToIso(wall: WallTime, timezone: string): string | undefined {
	const date = calendarDateText(wall);
	const time = `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}:${String(wall.second).padStart(2, '0')}`;
	const at = (offset: string): string => `${date}T${time}${offset}`;
	const first = offsetFor(calendarDateMs(wall), timezone);
	if (first === undefined) {
		return undefined;
	}
	const settled = instantOf(at(first));
	const second = settled === undefined ? undefined : offsetFor(settled, timezone);
	return at(second ?? first);
}

/** Orders two possibly-absent instants by their epoch value; absent last. */
export function compareNullableInstants(a: string | null, b: string | null): number {
	if (a === b) {
		return 0;
	}
	const left = instantOf(a);
	const right = instantOf(b);
	if (left === undefined) {
		return 1;
	}
	if (right === undefined) {
		return -1;
	}
	return left === right ? 0 : left > right ? 1 : -1;
}

/** The instant operators, shared by `datetime` and the read-only file-metadata columns. */
export function instantMatches(value: string | null, op: FilterOpId, operand: unknown): boolean {
	const left = instantOf(value);
	const right = op === 'isEmpty' || op === 'isNotEmpty' ? undefined : instantOf(operand);
	switch (op) {
		case 'isEmpty':
			return value === null;
		case 'isNotEmpty':
			return value !== null;
		case 'is':
			return left !== undefined && right !== undefined && left === right;
		case 'isNot':
			return left !== undefined && right !== undefined && left !== right;
		case 'gt':
			return left !== undefined && right !== undefined && left > right;
		case 'gte':
			return left !== undefined && right !== undefined && left >= right;
		case 'lt':
			return left !== undefined && right !== undefined && left < right;
		case 'lte':
			return left !== undefined && right !== undefined && left <= right;
		case 'contains':
		case 'notContains':
		case 'startsWith':
		case 'endsWith':
			return false;
	}
}

/** Renders an instant for a reader: locale date and time in the context's timezone. */
export function formatInstantDisplay(value: string | null, ctx: FieldContext): string {
	const ms = instantOf(value);
	return ms === undefined ? '' : formatDate(ms, ctx, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Groups instants by their local calendar day. */
export function instantGroupKey(value: string | null, ctx: FieldContext): string {
	const ms = instantOf(value);
	return ms === undefined ? '' : localDayKey(ms, ctx);
}

/**
 * A locale's date and time shapes, built from `Intl` itself.
 *
 * The point is that the grid renders dates with the vault's locale, so it must be able to read back what it
 * rendered — otherwise a user cannot type the date they are looking at. Rather than assume a pattern, the
 * pattern is *derived*: `Intl` formats a reference date, the parts say which component comes where, and a
 * matching expression is assembled from that. Which means the order and the separators are correct for every
 * locale automatically: `22 Nov 2001` in `en-GB`, `Nov 22, 2001` in `en-US`, `22.11.2001` in `de-DE`.
 *
 * Ambiguity is resolved by the locale, never by a guess: in `de-DE` a dot-separated date is day-first
 * because that is what the locale means by it; in `en-US` it is not a date at all.
 */
type DatePattern = {
	readonly regex: RegExp;
	readonly components: readonly ('day' | 'month' | 'year')[];
	/** Lower-cased month names, matched after removing punctuation; long and short forms both included. */
	readonly monthNames: ReadonlyMap<string, number>;
	/** True when the locale writes the month as digits, in which case `monthNames` is empty. */
	readonly numericMonth: boolean;
};

type TimePattern = {
	readonly regex: RegExp;
	readonly hour12: boolean;
	/** The locale's AM/PM words, folded, mapped to `am`/`pm`. Empty for a 24-hour locale. */
	readonly periods: ReadonlyMap<string, 'am' | 'pm'>;
};

const datePatterns = new Map<string, DatePattern | null>();
const timePatterns = new Map<string, TimePattern | null>();

/** A reference date with every component distinct, so the parts cannot be confused for one another. */
const REFERENCE = { year: 2001, month: 11, day: 22 };

/** Strips punctuation and case from a month name so `sept.` and `Sept` compare equal. */
function foldMonth(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]/gu, '')
		.trim();
}

/** Builds the locale's month-name table from `Intl`, or `undefined` when the locale is unusable. */
function monthNamesFor(locale: string): ReadonlyMap<string, number> | undefined {
	const names = new Map<string, number>();
	for (const style of ['long', 'short'] as const) {
		const formatter = formatterFor(locale, { month: style, day: 'numeric', timeZone: 'UTC' });
		if (formatter === undefined) {
			return undefined;
		}
		for (let month = 1; month <= 12; month += 1) {
			const parts = formatter.formatToParts(
				new Date(Date.UTC(REFERENCE.year, month - 1, REFERENCE.day)),
			);
			const value = parts.find((part) => part.type === 'month')?.value;
			if (value === undefined) {
				continue;
			}
			const folded = foldMonth(value);
			if (folded !== '' && !/^\d+$/.test(folded)) {
				names.set(folded, month);
			}
		}
	}
	return names;
}

/** Builds a pattern for the locale's `medium` date, or `null` when it cannot be used. */
function datePatternFor(locale: string): DatePattern | null {
	const cached = datePatterns.get(locale);
	if (cached !== undefined) {
		return cached;
	}
	const formatter = formatterFor(locale, { dateStyle: 'medium', timeZone: 'UTC' });
	const monthNames = monthNamesFor(locale);
	if (formatter === undefined || monthNames === undefined) {
		datePatterns.set(locale, null);
		return null;
	}
	const parts = formatter.formatToParts(
		new Date(Date.UTC(REFERENCE.year, REFERENCE.month - 1, REFERENCE.day)),
	);
	const components: ('day' | 'month' | 'year')[] = [];
	const pieces: string[] = [];
	const names = [...monthNames.keys()].sort((a, b) => b.length - a.length).map(escapeForRegExp);
	let numericMonth = false;
	for (const part of parts) {
		if (part.type === 'day') {
			components.push('day');
			pieces.push('([\\p{Nd}]{1,2})');
		} else if (part.type === 'year') {
			components.push('year');
			// One to four digits: the canonical form is padded, but a rendered year 1 is written `1`.
			pieces.push('([\\p{Nd}]{1,4})');
		} else if (part.type === 'month') {
			components.push('month');
			if (/^\p{Nd}+$/u.test(part.value)) {
				numericMonth = true;
				pieces.push('([\\p{Nd}]{1,2})');
			} else {
				pieces.push(`(${names.join('|')})`);
			}
		} else if (part.type === 'literal') {
			// Any run of punctuation or spaces, so `Nov 22, 2001` and `22 Nov 2001` both match their locale.
			pieces.push('[^\\p{L}\\p{N}]*');
		}
	}
	if (components.length !== 3) {
		datePatterns.set(locale, null);
		return null;
	}
	const pattern: DatePattern = {
		regex: new RegExp(pieces.join(''), 'iu'),
		components,
		monthNames,
		numericMonth,
	};
	datePatterns.set(locale, pattern);
	return pattern;
}

/**
 * The locale's AM/PM words, read from `Intl` by formatting a known morning hour and a known evening hour.
 * Derived rather than hard-coded, so `bn-BD` (`AM`/`PM`), `en-US` (`AM`/`PM`) and a locale that writes
 * `ص`/`م` are all read correctly.
 */
function dayPeriodsFor(locale: string): ReadonlyMap<string, 'am' | 'pm'> {
	const periods = new Map<string, 'am' | 'pm'>();
	const formatter = formatterFor(locale, {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
		timeZone: 'UTC',
	});
	if (formatter === undefined) {
		return periods;
	}
	for (const [hour, answer] of [
		[9, 'am'],
		[21, 'pm'],
	] as const) {
		const parts = formatter.formatToParts(
			new Date(Date.UTC(REFERENCE.year, REFERENCE.month - 1, REFERENCE.day, hour, 45)),
		);
		const written = parts.find((part) => part.type === 'dayPeriod')?.value;
		if (written !== undefined) {
			periods.set(foldMonth(written), answer);
		}
	}
	return periods;
}

/** Builds a pattern for the locale's `short` time, or `null` when it cannot be used. */
function timePatternFor(locale: string): TimePattern | null {
	const cached = timePatterns.get(locale);
	if (cached !== undefined) {
		return cached;
	}
	const formatter = formatterFor(locale, { timeStyle: 'short', timeZone: 'UTC' });
	if (formatter === undefined) {
		timePatterns.set(locale, null);
		return null;
	}
	const parts = formatter.formatToParts(
		new Date(Date.UTC(REFERENCE.year, REFERENCE.month - 1, REFERENCE.day, 13, 45)),
	);
	const periods = dayPeriodsFor(locale);
	const hour12 = parts.some((part) => part.type === 'dayPeriod');
	const pieces: string[] = [];
	for (const part of parts) {
		if (part.type === 'hour') {
			pieces.push('([\\p{Nd}]{1,2})');
		} else if (part.type === 'minute') {
			pieces.push('([\\p{Nd}]{2})');
		} else if (part.type === 'dayPeriod') {
			const words = [...periods.keys()]
				.sort((a, b) => b.length - a.length)
				.map(escapeForRegExp);
			// Any word in that slot, so a locale with a period word this table did not see still matches and
			// is then refused by name rather than by a confusing no-match.
			pieces.push(words.length === 0 ? '([\\p{L}.]+)' : `(${words.join('|')}|[\\p{L}.]+)`);
		} else if (part.type === 'literal') {
			pieces.push('[^\\p{L}\\p{N}]*');
		}
	}
	const pattern: TimePattern = { regex: new RegExp(pieces.join(''), 'iu'), hour12, periods };
	timePatterns.set(locale, pattern);
	return pattern;
}

/** The numeric fields a locale pattern captured, in the order it captured them. */
function numbersFrom(match: RegExpExecArray): string[] {
	return match.slice(1).filter((part): part is string => part !== undefined);
}

/**
 * Turns a date match into calendar parts, or `undefined` when the parts are not a real date. Captured digits
 * are translated from the locale's numerals first (`format/digits.ts`).
 */
function partsFromDateMatch(
	match: RegExpExecArray,
	pattern: DatePattern,
	locale: string,
): CalendarDate | undefined {
	const captured = numbersFrom(match).map((part) => toAsciiDigits(part, locale));
	let day: number | undefined;
	let month: number | undefined;
	let year: number | undefined;
	pattern.components.forEach((component, index) => {
		const raw = captured[index];
		if (raw === undefined) {
			return;
		}
		if (component === 'day') {
			day = Number(raw);
		} else if (component === 'year') {
			year = Number(raw);
		} else if (pattern.numericMonth) {
			month = Number(raw);
		} else {
			month = pattern.monthNames.get(foldMonth(raw));
		}
	});
	if (day === undefined || month === undefined || year === undefined) {
		return undefined;
	}
	const parts: CalendarDate = { year, month, day };
	return isRealCalendarDate(parts) ? parts : undefined;
}

/**
 * Reads a date the way a locale writes it (the form `date.formatDisplay` produces).
 *
 * The vault's locale is tried first, then `en` — the same two steps `formatDate` uses to render, so whatever
 * a cell shows, this reads back. Both steps fail only for a text that is not a date in either.
 */
export function parseLocalizedDate(text: string, ctx: FieldContext): CalendarDate | undefined {
	for (const locale of [ctx.locale, FALLBACK_LOCALE]) {
		const pattern = datePatternFor(locale);
		if (pattern === null) {
			continue;
		}
		const match = pattern.regex.exec(text.trim());
		if (match !== null) {
			const parts = partsFromDateMatch(match, pattern, locale);
			if (parts !== undefined) {
				return parts;
			}
		}
	}
	return undefined;
}

/**
 * Reads a date and an optional time the way a locale writes them, as a wall-clock reading.
 *
 * The time is read from the text **after** the date match, never from the whole string: an unanchored search
 * would happily read the year `2026` as the hour `20:26`. Same locale-then-`en` fallback as the date reader.
 */
export function parseLocalizedWallTime(text: string, ctx: FieldContext): WallTime | undefined {
	for (const locale of [ctx.locale, FALLBACK_LOCALE]) {
		const pattern = datePatternFor(locale);
		if (pattern === null) {
			continue;
		}
		const dateMatch = pattern.regex.exec(text);
		if (dateMatch === null) {
			continue;
		}
		const parts = partsFromDateMatch(dateMatch, pattern, locale);
		if (parts === undefined) {
			continue;
		}
		const rest = text.slice(dateMatch.index + dateMatch[0].length);
		const timePattern = timePatternFor(locale);
		const timeMatch = timePattern === null ? null : timePattern.regex.exec(rest);
		if (timePattern === null || timeMatch === null) {
			return { ...parts, hour: 0, minute: 0, second: 0 };
		}
		const captured = numbersFrom(timeMatch).map((part) => toAsciiDigits(part, locale));
		const hourText = captured[0];
		const minuteText = captured[1];
		if (hourText === undefined || minuteText === undefined) {
			continue;
		}
		let hour = Number(hourText);
		const minute = Number(minuteText);
		if (timePattern.hour12) {
			const written = timeMatch[3];
			const period =
				written === undefined ? undefined : timePattern.periods.get(foldMonth(written));
			if (period === undefined) {
				continue;
			}
			hour = hour % 12;
			if (period === 'pm') {
				hour += 12;
			}
		}
		if (hour > 23 || minute > 59) {
			continue;
		}
		return { ...parts, hour, minute, second: 0 };
	}
	return undefined;
}

/**
 * The canonical text of an instant: UTC, `Z`-suffixed, seconds precision unless the value has milliseconds.
 *
 * One spelling per moment is what makes `parse(formatDisplay(v)) === v` true for a datetime cell: the
 * alternative — keeping whichever offset the file happened to write — means the same moment has several
 * text forms, and any round-trip assertion (and any diff of a note the plugin touched) becomes fragile.
 * `2026-10-05T09:30:00Z` is also what a person reads most easily in frontmatter.
 */
export function canonicalInstantText(ms: number): string {
	const iso = new Date(ms).toISOString();
	return ms % 1000 === 0 ? `${iso.slice(0, 19)}Z` : iso;
}
