/**
 * Format checks for `url`, `email` and `phone`.
 *
 * These are **validators, not coercers**: none of them rewrites a value. `parse` accepts any string and adds
 * a warning when it does not look like the type's shape, because a note is a user's data and a plugin that
 * refuses to store what it cannot parse is a plugin that loses data. Only the editor (step 18) blocks a
 * commit on a malformed value, and only while the field is being edited.
 *
 * The checks are deliberately permissive and linear — no nested quantifiers, nothing that can backtrack —
 * because they run on every parse of a column.
 */
import { parseCalendarDate } from './iso';

/** True when the text parses as an absolute url with a scheme. `URL.canParse` does the real work. */
export function looksLikeUrl(text: string): boolean {
	return URL.canParse(text.trim());
}

/** True when the text has the shape `something@something.tld`. Not RFC 5322, and not trying to be. */
export function looksLikeEmail(text: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text.trim());
}

/**
 * True when the text could be a phone number: at least six digits, and only digits plus the punctuation a
 * number is written with. Deliberately permissive — phone numbers are national, and a plugin that rejects a
 * real number is worse than one that accepts a typo.
 */
export function looksLikePhone(text: string): boolean {
	const trimmed = text.trim();
	if (!/^[+()\d][\d\s().\u2013-]*$/.test(trimmed)) {
		return false;
	}
	return trimmed.replace(/\D/g, '').length >= 6;
}

/** True when the text is a calendar date this plugin accepts, for the date types' warnings. */
export function looksLikeDate(text: string): boolean {
	return parseCalendarDate(text) !== undefined;
}
