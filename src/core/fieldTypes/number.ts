/**
 * `number` — a plain decimal, stored as a YAML number (docs/03 §the mapping table).
 *
 * Display groups digits in the vault's locale; the clipboard and export do not, so a copied value pastes
 * back as the same number in any spreadsheet. Precision is never trimmed for display: the cell may be too
 * narrow to show every digit, but the value it shows is the value that is stored.
 */
import type { FieldContext, FieldDescriptor, FilterOpId, Parsed, YamlValue } from '../types';
import { parseFailed, parsed } from '../types';
import {
	compareNullableNumbers,
	formatDecimal,
	matchesNumeric,
	numericGroupKey,
	parseDecimalLocalized,
} from '../format/numbers';
import { registerField } from './registry';

/** The canonical value of a numeric cell: a finite number, or `null` for "no value". */
export type NumberValue = number | null;

/**
 * Reads any supported input as a number: a finite number, a decimal string in the vault's locale (so the
 * value a cell displays can be typed back into it), or the empty value.
 */
export function readNumber(raw: unknown, ctx: FieldContext): Parsed<NumberValue> {
	if (raw === null || raw === undefined) {
		return parsed(null);
	}
	if (typeof raw === 'number') {
		return Number.isFinite(raw) ? parsed(raw) : parseFailed('this number is out of range', raw);
	}
	if (typeof raw === 'string') {
		return parseDecimalLocalized(raw, ctx);
	}
	return parseFailed('a number is expected here', raw);
}

export const numberField: FieldDescriptor<NumberValue> = {
	id: 'number',
	label: 'Number',
	icon: 'lucide-hash',
	editable: true,
	defaultValue: null,
	editor: 'number',

	parse: (raw: unknown, ctx: FieldContext): Parsed<NumberValue> => readNumber(raw, ctx),

	toYaml(value: NumberValue): YamlValue {
		return value;
	},

	formatDisplay(value: NumberValue, ctx: FieldContext): string {
		return value === null ? '' : formatDecimal(value, ctx);
	},

	/** No grouping: this is the form a spreadsheet and `parsePlain` both understand. */
	formatPlain(value: NumberValue): string {
		return value === null ? '' : String(value);
	},

	parsePlain: (text: string, ctx: FieldContext): Parsed<NumberValue> =>
		parseDecimalLocalized(text, ctx),

	filterOps: ['is', 'isNot', 'isEmpty', 'isNotEmpty', 'gt', 'gte', 'lt', 'lte'],
	matches: (value: NumberValue, op: FilterOpId, operand: unknown): boolean =>
		matchesNumeric(value, op, operand),
	compare: (a: NumberValue, b: NumberValue): number => compareNullableNumbers(a, b),
	groupKey: (value: NumberValue): string => numericGroupKey(value),
};

registerField(numberField);
