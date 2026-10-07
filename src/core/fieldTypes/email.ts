/**
 * `email` — a string that is meant to be an address (docs/03 §the mapping table).
 *
 * Like `url`: a validator, never a coercer. The shape check is deliberately permissive (`something@domain.tld`
 * with no spaces) because the only truly correct email validator is "send a message and see", and a false
 * rejection costs a user their data. Case is preserved — a local part is technically case-sensitive, and
 * lower-casing someone's address is not this plugin's decision — while **matching and grouping fold case**,
 * because the same person writing `Sam@Example.com` and `sam@example.com` means one value.
 */
import type { FieldContext, FieldDescriptor, FilterOpId, Parsed, CellValue } from '../types';
import { parseFailed, parsed } from '../types';
import { compareNullableText, matchesText, textGroupKey } from '../format/text';
import { looksLikeEmail } from '../format/validation';
import { registerField } from './registry';

/** The canonical value of an email cell. */
export type EmailValue = string | null;

/** Reads an address: any string is kept; one that does not look like an address carries a warning. */
export function readEmail(raw: unknown, ctx: FieldContext): Parsed<EmailValue> {
	if (raw === null || raw === undefined) {
		return parsed(null);
	}
	if (typeof raw === 'string') {
		const text = raw.trim();
		if (text === '') {
			return parsed(null);
		}
		return looksLikeEmail(text)
			? parsed(text)
			: parsed(
					text,
					'this does not look like an email address; it is stored exactly as typed',
				);
	}
	return parseFailed('an email address is text', raw);
}

export const emailField: FieldDescriptor<EmailValue> = {
	id: 'email',
	label: 'Email',
	icon: 'lucide-mail',
	editable: true,
	defaultValue: null,
	editor: 'text',

	parse: (raw: unknown, ctx: FieldContext): Parsed<EmailValue> => readEmail(raw, ctx),

	toJson(value: EmailValue): CellValue {
		return value;
	},

	formatDisplay(value: EmailValue, _ctx: FieldContext): string {
		return value ?? '';
	},

	formatPlain(value: EmailValue, _ctx: FieldContext): string {
		return value ?? '';
	},

	parsePlain(text: string, _ctx: FieldContext): Parsed<EmailValue> {
		const cleaned = text.normalize('NFC').trim();
		return cleaned === ''
			? parsed(null)
			: looksLikeEmail(cleaned)
				? parsed(cleaned)
				: parsed(cleaned, 'this does not look like an email address');
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
	matches: (value: EmailValue, op: FilterOpId, operand: unknown, ctx: FieldContext): boolean =>
		matchesText(value, op, operand, ctx.locale),
	compare: (a: EmailValue, b: EmailValue, ctx: FieldContext): number =>
		compareNullableText(a, b, ctx.locale),
	groupKey: (value: EmailValue): string => textGroupKey(value),
};

registerField(emailField);
