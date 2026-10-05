/**
 * `longText` — text with newlines, written as a YAML block scalar (docs/03 §the mapping table).
 *
 * The difference from `text` is not the editor, it is the **file**: a long value becomes
 *
 *     Notes: |-
 *       First line
 *       Second line
 *
 * because a block scalar is what a person can read and edit in a note, and a quoted scalar with `\n` escapes
 * is what they cannot. A short value stays a plain scalar. The style choice travels on the value as a
 * {@link YamlTextNode}, so the write queue emits the decision this type made rather than re-guessing it.
 *
 * A value that is only whitespace is `null`: an empty long-text cell means "no value", never a block scalar
 * full of spaces. Interior whitespace and newlines are preserved exactly.
 */
import type { FieldDescriptor, FilterOpId, Parsed, YamlValue } from '../types';
import { parseFailed, parsed } from '../types';
import { compareNullableText, matchesText, textGroupKey } from '../format/text';
import { registerField } from './registry';

/** The canonical value of a long-text cell. A value is never `""`; whitespace-only becomes `null`. */
export type LongTextValue = string | null;

/** Reads long text from a string. Newlines are preserved as written, with `\r\n` normalised to `\n`. */
export function readLongText(raw: unknown): Parsed<LongTextValue> {
	if (raw === null || raw === undefined) {
		return parsed(null);
	}
	if (typeof raw === 'string') {
		const normalised = raw.replace(/\r\n?/g, '\n');
		return normalised.trim() === '' ? parsed(null) : parsed(normalised);
	}
	if (typeof raw === 'number' || typeof raw === 'boolean') {
		return parsed(String(raw));
	}
	return parseFailed('text is expected here', raw);
}

export const longTextField: FieldDescriptor<LongTextValue> = {
	id: 'longText',
	label: 'Long text',
	icon: 'lucide-align-left',
	editable: true,
	defaultValue: null,
	editor: 'longText',

	parse: (raw: unknown): Parsed<LongTextValue> => readLongText(raw),

	/**
	 * The text itself — a plain string, never a style wrapper.
	 *
	 * docs/03 says a multi-line value is written as a YAML block scalar; that choice is a *function of the
	 * value* (it contains a newline), so the serializer derives it when it writes (step 12) instead of the
	 * value carrying a flag. Keeping it out of `YamlValue` is also what lets `parse(toYaml(v))` work: the
	 * write form is one of the shapes `parse` reads.
	 */
	toYaml(value: LongTextValue): YamlValue {
		return value;
	},

	/**
	 * The value, newlines and all. Collapsing them into spaces would make `parse(formatDisplay(v)) === v`
	 * false, and how a cell wraps or clips its text is the cell renderer's decision (step 16), not this
	 * descriptor's.
	 */
	formatDisplay(value: LongTextValue): string {
		return value ?? '';
	},

	formatPlain(value: LongTextValue): string {
		return value ?? '';
	},

	parsePlain: (text: string): Parsed<LongTextValue> => readLongText(text),

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
	matches(value: LongTextValue, op: FilterOpId, operand: unknown): boolean {
		return matchesText(value, op, operand);
	},
	compare: (a: LongTextValue, b: LongTextValue): number => compareNullableText(a, b),
	groupKey: (value: LongTextValue): string => textGroupKey(value),
};

registerField(longTextField);
