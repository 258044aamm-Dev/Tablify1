/**
 * `multiSelect` — several labels from the column's option list, stored as a **YAML list of labels**
 * (docs/03 §the mapping table).
 *
 *     Tags:
 *      - research
 *      - draft
 *
 * Rules, and why each one exists:
 *
 *   1. **Order is preserved as written.** The list is a value, not a set: a user who typed `draft, research`
 *      meant that order, and re-sorting it on every read would rewrite their note for no reason.
 *   2. **The same label twice is one label.** Case-insensitive, because `Draft` and `draft` are the same
 *      option; the first occurrence's spelling survives.
 *   3. **A known label is canonicalised to the list's spelling**, exactly as `singleSelect` does, so grouping
 *      never splits one option into two.
 *   4. **An empty list is `null`.** A canonical multi-select value is never `[]`: "no value" has one
 *      representation, not two, which is what keeps `isEmpty` and grouping honest.
 *   5. **The clipboard form quotes labels that contain a comma** (see `format/text.ts`), so
 *      `parsePlain(formatPlain(v)) === v` holds even for a label like `Berlin, Mitte`.
 */
import type { FieldContext, FieldDescriptor, FilterOpId, Parsed, YamlValue } from '../types';
import { parseFailed, parsed } from '../types';
import { joinLabelList, splitLabelList } from '../format/text';
import { registerField } from './registry';

/** The canonical value of a multi-select cell: an ordered list of labels, or `null`. Never `[]`. */
export type MultiSelectValue = readonly string[] | null;

/** The option names configured for this column, in the order the option manager shows them. */
function optionNamesFor(ctx: FieldContext): readonly string[] {
	return (ctx.fieldOptions.options ?? []).map((option) => option.name);
}

/** The list's spelling of a label, when the list knows it. */
function canonicalLabel(label: string, ctx: FieldContext): string {
	const folded = label.toLocaleLowerCase(ctx.locale);
	return (
		optionNamesFor(ctx).find((name) => name.toLocaleLowerCase(ctx.locale) === folded) ?? label
	);
}

/**
 * Turns raw labels into a canonical list: trimmed, de-duplicated case-insensitively in the context's locale,
 * canonicalised to the option list's spelling, with unknown labels reported once in the warning.
 */
function canonicalise(labels: readonly string[], ctx: FieldContext): Parsed<MultiSelectValue> {
	const seen = new Set<string>();
	const kept: string[] = [];
	const unknown: string[] = [];
	for (const raw of labels) {
		const text = raw.trim();
		if (text === '') {
			continue;
		}
		const canonical = canonicalLabel(text, ctx);
		const key = canonical.toLocaleLowerCase(ctx.locale);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		kept.push(canonical);
		if (
			optionNamesFor(ctx).length > 0 &&
			canonical === text &&
			!optionNamesFor(ctx).includes(text)
		) {
			unknown.push(text);
		}
	}
	if (kept.length === 0) {
		return parsed(null);
	}
	const warning =
		unknown.length === 0
			? undefined
			: `${unknown.map((label) => `"${label}"`).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not in this column's options yet; stored as typed`;
	return parsed(kept, warning);
}

/** Reads a multi-select value from a list, or from the comma-separated clipboard form. */
export function readMultiSelect(raw: unknown, ctx: FieldContext): Parsed<MultiSelectValue> {
	if (raw === null || raw === undefined) {
		return parsed(null);
	}
	if (Array.isArray(raw)) {
		const items: readonly unknown[] = raw;
		const texts = items.filter((item): item is string => typeof item === 'string');
		if (texts.length !== items.length) {
			return parseFailed(
				'a multi-select expects labels, but this list has non-text members',
				raw,
			);
		}
		return canonicalise(texts, ctx);
	}
	if (typeof raw === 'string') {
		return canonicalise(splitLabelList(raw), ctx);
	}
	if (typeof raw === 'number' || typeof raw === 'boolean') {
		return canonicalise([String(raw)], ctx);
	}
	return parseFailed('a multi-select expects a list of labels', raw);
}

export const multiSelectField: FieldDescriptor<MultiSelectValue> = {
	id: 'multiSelect',
	label: 'Multi-select',
	icon: 'lucide-tags',
	editable: true,
	defaultValue: null,
	editor: 'multiSelect',

	parse: (raw: unknown, ctx: FieldContext): Parsed<MultiSelectValue> => readMultiSelect(raw, ctx),

	/** A flat list of scalars: the only YAML shape short of a nested map (see `YamlValue`). */
	toYaml(value: MultiSelectValue): YamlValue {
		return value;
	},

	/**
	 * The same text as {@link formatPlain}, and deliberately not a plain `join(', ')`: a label that contains
	 * a comma must survive the round-trip, so it is quoted here too. The cell renderer shows the members
	 * individually (step 16); this is the text form a screen reader reads and a copy writes.
	 */
	formatDisplay(value: MultiSelectValue, _ctx: FieldContext): string {
		return value === null ? '' : joinLabelList(value);
	},

	/** The quoted form, so a label with a comma survives the trip through a spreadsheet. */
	formatPlain(value: MultiSelectValue, _ctx: FieldContext): string {
		return value === null ? '' : joinLabelList(value);
	},

	parsePlain: (text: string, ctx: FieldContext): Parsed<MultiSelectValue> =>
		canonicalise(splitLabelList(text), ctx),

	filterOps: ['contains', 'notContains', 'isEmpty', 'isNotEmpty'],
	matches(value: MultiSelectValue, op: FilterOpId, operand: unknown, ctx: FieldContext): boolean {
		switch (op) {
			case 'isEmpty':
				return value === null || value.length === 0;
			case 'isNotEmpty':
				return value !== null && value.length > 0;
			default: {
				if (value === null || typeof operand !== 'string') {
					return false;
				}
				const needle = operand.normalize('NFC').trim().toLocaleLowerCase(ctx.locale);
				if (needle === '') {
					return op === 'notContains';
				}
				const has = value.some((label) =>
					label.toLocaleLowerCase(ctx.locale).includes(needle),
				);
				return op === 'contains' ? has : !has;
			}
		}
	},
	/** Compares the canonical joined form, so the order of a list is not lost in a sort. */
	compare(a: MultiSelectValue, b: MultiSelectValue, _ctx: FieldContext): number {
		const text = (value: MultiSelectValue): string | null =>
			value === null ? null : value.join('\u0000');
		if (text(a) === text(b)) {
			return 0;
		}
		if (a === null) {
			return 1;
		}
		if (b === null) {
			return -1;
		}
		const left = a.join('\u0000');
		const right = b.join('\u0000');
		return left === right ? 0 : left < right ? -1 : 1;
	},
	/** The labels, folded and sorted, so `draft, research` and `research, draft` group together. */
	groupKey(value: MultiSelectValue, ctx: FieldContext): string {
		if (value === null) {
			return '';
		}
		return value
			.map((label) => label.trim().toLocaleLowerCase(ctx.locale))
			.sort()
			.join('\u0000');
	},
};

registerField(multiSelectField);
