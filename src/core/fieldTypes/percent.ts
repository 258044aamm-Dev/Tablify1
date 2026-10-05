/**
 * `percent` — human-first, and deliberately not fraction-first (docs/08 §P12).
 *
 * **The divergence, stated once and asserted in `tests/unit/field-roundtrip.test.ts`:**
 * this plugin stores `25` for 25 %. The upstream schema stores `0.25` for 25 % and multiplies by 100 to
 * render. The stored number here is therefore the number a person reads: opening the note in a text editor
 * shows `progress: 25`, which is the whole point of "frontmatter must stay human-readable and
 * hand-editable" (docs/03 §the mapping table). Sync maps between the two conventions (step 26); nothing
 * else scales, and `parse(0.25)` means a quarter of one percent — never 25 %.
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

/** The canonical value of a percent cell: the number of percent, so `25` is 25 %. */
export type PercentValue = number | null;

/** A pasted `25%` and a stored `25` are the same claim; the sign is stripped and nothing is scaled. */
function parsePercentText(text: string, ctx: FieldContext): Parsed<PercentValue> {
	return parseDecimalLocalized(text.trim().replace(/\s*%$/, ''), ctx);
}

export const percentField: FieldDescriptor<PercentValue> = {
	id: 'percent',
	label: 'Percent',
	icon: 'lucide-percent',
	editable: true,
	defaultValue: null,
	editor: 'number',

	parse(raw: unknown, ctx: FieldContext): Parsed<PercentValue> {
		if (raw === null || raw === undefined) {
			return parsed(null);
		}
		if (typeof raw === 'number') {
			return Number.isFinite(raw)
				? parsed(raw)
				: parseFailed('this percentage is out of range', raw);
		}
		if (typeof raw === 'string') {
			return parsePercentText(raw, ctx);
		}
		return parseFailed('a percentage is expected here', raw);
	},

	toYaml(value: PercentValue): YamlValue {
		return value;
	},

	formatDisplay(value: PercentValue, ctx: FieldContext): string {
		return value === null ? '' : `${formatDecimal(value, ctx)}%`;
	},

	formatPlain(value: PercentValue): string {
		return value === null ? '' : String(value);
	},

	parsePlain: (text: string, ctx: FieldContext): Parsed<PercentValue> =>
		parsePercentText(text, ctx),

	filterOps: ['is', 'isNot', 'isEmpty', 'isNotEmpty', 'gt', 'gte', 'lt', 'lte'],
	matches: (value: PercentValue, op: FilterOpId, operand: unknown): boolean =>
		matchesNumeric(value, op, operand),
	compare: (a: PercentValue, b: PercentValue): number => compareNullableNumbers(a, b),
	groupKey: (value: PercentValue): string => numericGroupKey(value),
};

registerField(percentField);
