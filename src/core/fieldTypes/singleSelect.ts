/**
 * `singleSelect` — one value from the column's option list, canonical as a **string** (`docs/03` §3).
 *
 * Which string, exactly, is the one thing to be careful about, and `types.ts` §`FieldOption` states the
 * rule in full: a `.tablify` document stores the option **id** (`opt_…`, with labels and colours in the
 * field's metadata), while a Markdown note's frontmatter stores the **label** because a note cannot spell
 * anything else. This descriptor treats the string as opaque and works in whichever spelling it is
 * handed: it canonicalises against `ctx.fieldOptions` to keep one spelling per option and never invents
 * an id or a label of its own.
 *
 * Three rules, and the reasoning for each:
 *
 *   1. **An unknown label is kept, with a warning.** Select options are created by typing (that is how the
 *      old build's option manager worked, and how the upstream schema works), so a value the list does not
 *      know about is normal input, not an error. `parse` never throws, and the import preview shows it.
 *   2. **A known label is canonicalised to the list's spelling.** If the list says `Doing` and the file says
 *      `doing`, the value becomes `Doing` — one option, not two that differ only in case. Without this,
 *      grouping by a select column would show `Doing` and `doing` as separate groups forever.
 *   3. **Identity is exact, so the round-trip is exact.** `toJson` writes the label as it stands, and
 *      `parse` of that label is that label — which is what `parse(toJson(v)) === v` requires.
 *
 * Colours and order live in `fieldOptions`, which is the `.base` sidecar's business, not the note's; a label
 * moved or recoloured rewrites no files.
 */
import type { FieldContext, FieldDescriptor, FilterOpId, Parsed, CellValue } from '../types';
import { parseFailed, parsed } from '../types';
import { compareNullableText, matchesText, textGroupKey } from '../format/text';
import { registerField } from './registry';

/** The canonical value of a single-select cell: a label, or `null` for "no value". */
export type SingleSelectValue = string | null;

/**
 * The option names configured for this column, in the order the option manager shows them.
 *
 * `fieldOptions.options` is a list of `{ id, name, color? }`. Which of `id`/`name` is identity depends on
 * where the value is stored — the document says `id`, a note says `name` (see `types.ts` §`FieldOption`)
 * — so this helper resolves the *names*, which is the vocabulary a note path and this descriptor's
 * canonicalisation both need.
 */
export function optionNamesFor(ctx: FieldContext): readonly string[] {
	return (ctx.fieldOptions.options ?? []).map((option) => option.name);
}

/** The list's spelling of a label, when the list knows it. */
function canonicalLabel(label: string, ctx: FieldContext): string | undefined {
	const folded = label.toLocaleLowerCase(ctx.locale);
	return optionNamesFor(ctx).find((name) => name.toLocaleLowerCase(ctx.locale) === folded);
}

/**
 * Reads a select value: an unknown label is accepted with a warning, a known one is canonicalised, and an
 * empty cell is `null`.
 */
export function readSingleSelect(raw: unknown, ctx: FieldContext): Parsed<SingleSelectValue> {
	if (raw === null || raw === undefined) {
		return parsed(null);
	}
	if (typeof raw === 'string') {
		const text = raw.trim();
		if (text === '') {
			return parsed(null);
		}
		const known = canonicalLabel(text, ctx);
		if (known !== undefined) {
			return parsed(known);
		}
		return optionNamesFor(ctx).length === 0
			? parsed(text)
			: parsed(text, `"${text}" is not in this column's options yet; it is stored as typed`);
	}
	if (typeof raw === 'number' || typeof raw === 'boolean') {
		return readSingleSelect(String(raw), ctx);
	}
	if (Array.isArray(raw)) {
		// A one-element list is a single-select value: an import from a spreadsheet often produces this.
		if (raw.length === 0) {
			return parsed(null);
		}
		if (raw.length > 1) {
			return parseFailed('this column holds one option; the input is a list of several', raw);
		}
		const only = readSingleSelect(raw[0], ctx);
		// Re-tag a refusal with the input this call was given, so a failure always carries what arrived.
		return only.ok ? only : parseFailed(only.error, raw);
	}
	return parseFailed('an option label is text', raw);
}

export const singleSelectField: FieldDescriptor<SingleSelectValue> = {
	id: 'singleSelect',
	label: 'Select',
	icon: 'lucide-chevron-down',
	editable: true,
	defaultValue: null,
	editor: 'select',

	parse: (raw: unknown, ctx: FieldContext): Parsed<SingleSelectValue> =>
		readSingleSelect(raw, ctx),

	toJson(value: SingleSelectValue): CellValue {
		return value;
	},

	/** A colour dot is the cell renderer's business (step 16); here the label is the whole value. */
	formatDisplay(value: SingleSelectValue, _ctx: FieldContext): string {
		return value ?? '';
	},

	formatPlain(value: SingleSelectValue, _ctx: FieldContext): string {
		return value ?? '';
	},

	parsePlain: (text: string, ctx: FieldContext): Parsed<SingleSelectValue> =>
		readSingleSelect(text, ctx),

	filterOps: ['is', 'isNot', 'contains', 'notContains', 'isEmpty', 'isNotEmpty'],
	matches: (
		value: SingleSelectValue,
		op: FilterOpId,
		operand: unknown,
		ctx: FieldContext,
	): boolean => matchesText(value, op, operand, ctx.locale),
	compare: (a: SingleSelectValue, b: SingleSelectValue, ctx: FieldContext): number =>
		compareNullableText(a, b, ctx.locale),
	groupKey: (value: SingleSelectValue): string => textGroupKey(value),
};

registerField(singleSelectField);
