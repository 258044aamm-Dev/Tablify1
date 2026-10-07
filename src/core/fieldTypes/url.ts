/**
 * `url` — a string that is meant to be a link (docs/03 §the mapping table).
 *
 * **A validator, never a coercer.** Any string is stored exactly as written; a value that does not parse as
 * an absolute url is kept and reported as a *warning*, because the alternative to keeping it is deleting a
 * user's data. Only the editor (step 18) refuses to commit a malformed value, and only while editing.
 *
 * The check is `URL.canParse` — the platform's own parser, not a regular expression — with one deliberate
 * exception: `www.example.com` is accepted with a warning and stored unchanged, because a person typing a
 * link into a note should not have to spell the scheme, and silently rewriting their text to `https://…`
 * would rewrite an authored note.
 */
import type { FieldContext, FieldDescriptor, FilterOpId, Parsed, CellValue } from '../types';
import { parseFailed, parsed } from '../types';
import { compareNullableText, matchesText, textGroupKey } from '../format/text';
import { looksLikeUrl } from '../format/validation';
import { registerField } from './registry';

/** The canonical value of a url cell. */
export type UrlValue = string | null;

/** Reads a url: any string is kept; one that does not parse as a link carries a warning. */
export function readUrl(raw: unknown, ctx: FieldContext): Parsed<UrlValue> {
	if (raw === null || raw === undefined) {
		return parsed(null);
	}
	if (typeof raw === 'string') {
		const text = raw.trim();
		if (text === '') {
			return parsed(null);
		}
		if (looksLikeUrl(text)) {
			return parsed(text);
		}
		const schemeLess =
			/^[\w-]+(\.[\w-]+)+\/\S*$/.test(text) || /^www\.[\w-]+(\.[\w-]+)*\S*$/i.test(text);
		return schemeLess
			? parsed(text, 'this link has no scheme (https://); it is stored exactly as typed')
			: parsed(text, 'this does not look like a link; it is stored exactly as typed');
	}
	if (typeof raw === 'number' || typeof raw === 'boolean') {
		return parsed(String(raw), 'a link is text; the value was stringified');
	}
	return parseFailed('a link is text', raw);
}

export const urlField: FieldDescriptor<UrlValue> = {
	id: 'url',
	label: 'URL',
	icon: 'lucide-link',
	editable: true,
	defaultValue: null,
	editor: 'text',

	parse: (raw: unknown, ctx: FieldContext): Parsed<UrlValue> => readUrl(raw, ctx),

	toJson(value: UrlValue): CellValue {
		return value;
	},

	formatDisplay(value: UrlValue, _ctx: FieldContext): string {
		return value ?? '';
	},

	formatPlain(value: UrlValue, _ctx: FieldContext): string {
		return value ?? '';
	},

	/** Normalised and trimmed, like `text`: the same link pasted from two apps is one value. */
	parsePlain(text: string, _ctx: FieldContext): Parsed<UrlValue> {
		const cleaned = text.normalize('NFC').trim();
		return parsed(cleaned === '' ? null : cleaned);
	},

	filterOps: [
		'contains',
		'notContains',
		'is',
		'isNot',
		'startsWith',
		'endsWith',
		'isEmpty',
		'isNotEmpty',
	],
	matches: (value: UrlValue, op: FilterOpId, operand: unknown, ctx: FieldContext): boolean =>
		matchesText(value, op, operand, ctx.locale),
	compare: (a: UrlValue, b: UrlValue, ctx: FieldContext): number =>
		compareNullableText(a, b, ctx.locale),
	groupKey: (value: UrlValue): string => textGroupKey(value),
};

registerField(urlField);
