/**
 * `longText` — text with newlines, canonical as a **JSON string** (`docs/03` §3: *“Preserve exact
 * content; long text may contain newlines”*).
 *
 * The difference from `text` is the editor and the newlines, not the encoding. A Markdown note may
 * present a multi-line value as a YAML block scalar because that is what a person can read and edit
 * there — but that choice is a *function of the text* (does it contain a newline?) and it belongs to
 * whoever writes the note, not to this value: the descriptor hands over one string, and the note path
 * decides how to spell it. A `.tablify` document spells it as an ordinary JSON string with `\n`.
 *
 * A value that is only whitespace is `null`: an empty long-text cell means "no value", never a block scalar
 * full of spaces. Interior whitespace and newlines are preserved exactly.
 */
import type { FieldDescriptor, FilterOpId, Parsed, CellValue } from '../types';
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
	 * A note's frontmatter may carry a multi-line value as a YAML block scalar (docs/03 §the mapping
	 * table, about notes); that choice is a *function of the value* (it contains a newline), so the note
	 * writer derives it when it writes instead of the value carrying a flag. Keeping the style out of
	 * `CellValue` is also what lets `parse(toJson(v))` work: the stored form is one of the shapes `parse`
	 * reads.
	 */
	toJson(value: LongTextValue): CellValue {
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
