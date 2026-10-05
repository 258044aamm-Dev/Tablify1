/**
 * `checkbox` — a YAML boolean (docs/03 §the mapping table).
 *
 * Three states exist even though the editor shows two: `true`, `false`, and `null` for "nobody has decided
 * yet". `formatDisplay` shows them as `Yes`/`No`/empty so a text context can tell `false` from unset, while
 * `formatPlain` writes `true`/`false`/empty because that is what a spreadsheet column wants.
 *
 * Pasting is forgiving on purpose (`docs/01` §import): `true/false`, `yes/no`, `y/n`, `1/0` and the
 * checkmark all read as answers, because a checkbox column arriving from a spreadsheet is full of all five.
 */
import type { FieldDescriptor, FilterOpId, Parsed, YamlValue } from '../types';
import { parseFailed, parsed } from '../types';
import { registerField } from './registry';

/** The canonical value of a checkbox cell. */
export type CheckboxValue = boolean | null;

/** The words that mean yes and no, lower-cased. A checkmark means yes; a cross means no. */
const TRUE_WORDS: readonly string[] = ['true', 'yes', 'y', '1', 'on', '✓', '✔', 'x', '☑'];
const FALSE_WORDS: readonly string[] = ['false', 'no', 'n', '0', 'off', '✗', '✘', '☐'];

/** Reads a checkbox value from any supported spelling. */
export function readCheckbox(raw: unknown): Parsed<CheckboxValue> {
	if (raw === null || raw === undefined) {
		return parsed(null);
	}
	if (typeof raw === 'boolean') {
		return parsed(raw);
	}
	if (typeof raw === 'number') {
		if (raw === 1) {
			return parsed(true);
		}
		if (raw === 0) {
			return parsed(false);
		}
		return parseFailed('a checkbox holds true or false', raw);
	}
	if (typeof raw === 'string') {
		const word = raw.trim().toLowerCase();
		if (word === '') {
			return parsed(null);
		}
		if (TRUE_WORDS.includes(word)) {
			return parsed(true);
		}
		if (FALSE_WORDS.includes(word)) {
			return parsed(false);
		}
		return parseFailed('a checkbox holds true or false; "yes"/"no" and 1/0 also work', raw);
	}
	return parseFailed('a checkbox holds true or false', raw);
}

export const checkboxField: FieldDescriptor<CheckboxValue> = {
	id: 'checkbox',
	label: 'Checkbox',
	icon: 'lucide-square-check',
	editable: true,
	defaultValue: null,
	editor: 'checkbox',

	parse: (raw: unknown): Parsed<CheckboxValue> => readCheckbox(raw),

	toYaml(value: CheckboxValue): YamlValue {
		return value;
	},

	formatDisplay(value: CheckboxValue): string {
		if (value === null) {
			return '';
		}
		return value ? 'Yes' : 'No';
	},

	/** Machine-readable, so a copy into a spreadsheet is a boolean rather than a word. */
	formatPlain(value: CheckboxValue): string {
		return value === null ? '' : String(value);
	},

	parsePlain: (text: string): Parsed<CheckboxValue> => readCheckbox(text),

	filterOps: ['is', 'isNot', 'isEmpty', 'isNotEmpty'],
	matches(value: CheckboxValue, op: FilterOpId, operand: unknown): boolean {
		const read = readCheckbox(operand);
		const other = read.ok ? read.value : undefined;
		switch (op) {
			case 'isEmpty':
				return value === null;
			case 'isNotEmpty':
				return value !== null;
			case 'is':
				return other !== undefined && value === other;
			case 'isNot':
				return other !== undefined && value !== other;
			case 'contains':
			case 'notContains':
			case 'startsWith':
			case 'endsWith':
			case 'gt':
			case 'gte':
			case 'lt':
			case 'lte':
				return false;
		}
	},
	compare(a: CheckboxValue, b: CheckboxValue): number {
		const rank = (value: CheckboxValue): number => (value === null ? 2 : value ? 1 : 0);
		return rank(a) - rank(b);
	},
	groupKey(value: CheckboxValue): string {
		return value === null ? '' : String(value);
	},
};

registerField(checkboxField);
