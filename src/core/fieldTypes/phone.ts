/**
 * `phone` — a string that is meant to be a phone number (docs/03 §the mapping table).
 *
 * **The value is never reformatted.** `+1 (415) 555-0132` is stored exactly as typed, because a plugin has no
 * business deciding where a country's parentheses belong, and because rewriting a phone number changes what
 * a dialler does with it. Display, clipboard and the stored value all carry the same text.
 *
 * The check is only "could this be a number": six digits or more, and nothing but digits and the punctuation
 * people write numbers with. Fewer digits is a warning, not a failure.
 */
import type { FieldContext, FieldDescriptor, FilterOpId, Parsed, CellValue } from '../types';
import { parseFailed, parsed } from '../types';
import { compareNullableText, matchesText, textGroupKey } from '../format/text';
import { looksLikePhone } from '../format/validation';
import { registerField } from './registry';

/** The canonical value of a phone cell. */
export type PhoneValue = string | null;

/** Reads a phone number: any string is kept; one that cannot be a number carries a warning. */
export function readPhone(raw: unknown, ctx: FieldContext): Parsed<PhoneValue> {
	if (raw === null || raw === undefined) {
		return parsed(null);
	}
	if (typeof raw === 'string') {
		const text = raw.trim();
		if (text === '') {
			return parsed(null);
		}
		return looksLikePhone(text)
			? parsed(text)
			: parsed(text, 'this does not look like a phone number; it is stored exactly as typed');
	}
	if (typeof raw === 'number' && Number.isFinite(raw)) {
		// A spreadsheet hands a phone column over as digits, which is the one conversion worth doing here.
		return looksLikePhone(String(raw))
			? parsed(String(raw))
			: parsed(String(raw), 'this does not look like a phone number');
	}
	return parseFailed('a phone number is text', raw);
}

export const phoneField: FieldDescriptor<PhoneValue> = {
	id: 'phone',
	label: 'Phone',
	icon: 'lucide-phone',
	editable: true,
	defaultValue: null,
	editor: 'text',

	parse: (raw: unknown, ctx: FieldContext): Parsed<PhoneValue> => readPhone(raw, ctx),

	toJson(value: PhoneValue): CellValue {
		return value;
	},

	formatDisplay(value: PhoneValue, _ctx: FieldContext): string {
		return value ?? '';
	},

	formatPlain(value: PhoneValue, _ctx: FieldContext): string {
		return value ?? '';
	},

	parsePlain(text: string, _ctx: FieldContext): Parsed<PhoneValue> {
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
	matches: (value: PhoneValue, op: FilterOpId, operand: unknown, ctx: FieldContext): boolean =>
		matchesText(value, op, operand, ctx.locale),
	compare: (a: PhoneValue, b: PhoneValue, ctx: FieldContext): number =>
		compareNullableText(a, b, ctx.locale),
	groupKey: (value: PhoneValue): string => textGroupKey(value),
};

registerField(phoneField);
