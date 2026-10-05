/**
 * `text` — the reference descriptor, and the template every later field type copies.
 *
 * If you are adding a field type, read this file top to bottom. The shape is:
 *
 *   1. a canonical value type (`TextValue`) — a subset of `CellValue`, `null` for "no value";
 *   2. `parse` for untrusted input: it *never throws*, it returns `parsed(value)` or `parseFailed(...)`;
 *   3. `toYaml` for what reaches frontmatter, `formatDisplay` for the cell, `formatPlain` for the
 *      clipboard and `parsePlain` for a spreadsheet paste;
 *   4. `filterOps` (declared) and `matches`/`compare`/`groupKey` (implemented) — a declared operator that
 *      `matches` does not handle is a bug the shared contract suite catches;
 *   5. metadata: `id`, `label`, `icon`, `editable`, `defaultValue`, `editor`.
 *
 * Two rules that are easy to get wrong, and that the contract suite enforces:
 *   - `parse(formatDisplay(v)) === v` and `parsePlain(formatPlain(v)) === v`, for every canonical value;
 *   - `toYaml` returns only YAML-safe shapes: a scalar, or a flat list of scalars. No `undefined`.
 *
 * Whitespace and Unicode policy, asserted in `tests/unit/field-contract.text.test.ts`:
 *   - frontmatter is authored text, so `parse` **preserves** whitespace and code points exactly as written;
 *   - a pasted cell is machine text, so `parsePlain` **trims** and **normalises to NFC** (`é` typed as
 *     `e` + U+0301 becomes the single code point), because the same name from two apps must not become two
 *     values that group separately;
 *   - a value that is only whitespace is the empty value in both paths, and `toYaml` writes it as "delete
 *     the key" (`null`). So a canonical `text` value is never an empty string.
 *
 * The consequence of never rewriting authored text is that canonical values can be visually identical and
 * distinct (`é` vs `e`+U+0301). `compare` therefore ends with a code-point tiebreak, so a sort is
 * deterministic and `groupKey` stays consistent with `compare`: see the assertion in the shared suite.
 */
import type { FieldContext, FieldDescriptor, FilterOpId, Parsed, YamlValue } from '../types';
import { parseFailed, parsed } from '../types';
import { registerField } from './registry';

/** The canonical value of a `text` cell: a string, or `null` for "no value". Never `""`. */
export type TextValue = string | null;

/** True when a raw value is "there is nothing here": absent, or whitespace only. */
function isEmptyText(value: string): boolean {
	return value.trim() === '';
}

/** A usable filter operand, or a refusal. `null`/`undefined` mean "no operand yet", which is text `""`. */
type Operand = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'invalid' };

/**
 * Reads a filter operand without throwing. Strings are taken as they are, scalars are stringified (a filter
 * on "42" should match the number 42), and an absent operand is the empty string — while an object, array,
 * function or symbol is **invalid** rather than being coerced to `"[object Object]"` or to `""`. That
 * distinction matters: coercing an invalid operand to `""` would make `contains` match every row, which
 * looks like a working filter that silently ignores what the user asked for.
 */
function readOperand(operand: unknown): Operand {
	if (operand === null || operand === undefined) {
		return { kind: 'text', text: '' };
	}
	if (typeof operand === 'string') {
		return { kind: 'text', text: operand };
	}
	if (
		typeof operand === 'number' ||
		typeof operand === 'boolean' ||
		typeof operand === 'bigint'
	) {
		return { kind: 'text', text: String(operand) };
	}
	return { kind: 'invalid' };
}

/** Case-insensitive folding that respects the context locale (Turkish dotless i is the classic trap). */
function fold(text: string, ctx: FieldContext): string {
	return text.toLocaleLowerCase(ctx.locale);
}

/** Equality for `is`/`isNot`: case-insensitive, because filtering a text column is a search, not a diff. */
function equalsText(value: TextValue, operand: unknown, ctx: FieldContext): boolean {
	const read = readOperand(operand);
	return read.kind === 'text' && fold(value ?? '', ctx) === fold(read.text, ctx);
}

export const textField: FieldDescriptor<TextValue> = {
	id: 'text',
	label: 'Text',
	icon: 'lucide-type',
	editable: true,
	defaultValue: null,
	editor: 'text',

	/**
	 * Untrusted input → canonical value. Strings are preserved verbatim (whitespace and all) except that
	 * whitespace-only becomes `null`; numbers and booleans are stringified because a note with `title: 42`
	 * should show "42" rather than nothing; a list of strings is joined with ", " and reported by the
	 * migration summary; absent is the empty value; anything else is a tagged failure carrying the input.
	 */
	parse(raw: unknown, _ctx: FieldContext): Parsed<TextValue> {
		if (raw === null || raw === undefined) {
			return parsed(null);
		}
		if (typeof raw === 'string') {
			return parsed(isEmptyText(raw) ? null : raw);
		}
		if (typeof raw === 'number' || typeof raw === 'boolean') {
			return parsed(String(raw));
		}
		if (Array.isArray(raw)) {
			const items: readonly unknown[] = raw;
			if (items.length === 0) {
				return parsed(null);
			}
			const texts = items.filter((item): item is string => typeof item === 'string');
			if (texts.length !== items.length) {
				return parseFailed(
					'text expects a string, but this is a list with non-text members',
					raw,
				);
			}
			return parsed(texts.join(', '));
		}
		return parseFailed('text expects a string', raw);
	},

	/**
	 * Canonical value → frontmatter. The value is written exactly as it is (see the whitespace policy in
	 * the file header); `null` means "no value", which the write queue turns into a deleted key rather than
	 * an empty string.
	 */
	toYaml(value: TextValue, _ctx: FieldContext): YamlValue {
		return value;
	},

	/** Canonical value → cell text. Truncation, wrapping and ellipsis belong to the cell renderer. */
	formatDisplay(value: TextValue, _ctx: FieldContext): string {
		return value ?? '';
	},

	/**
	 * Canonical value → clipboard/TSV/export text. Identical to the display form for text; escaping tabs and
	 * newlines is the export layer's job (step 24), because only it knows the target format.
	 */
	formatPlain(value: TextValue, _ctx: FieldContext): string {
		return value ?? '';
	},

	/**
	 * A pasted cell → canonical value. Trims and normalises to NFC: spreadsheet cells and other apps pad
	 * without meaning to and mix composed and decomposed accents, and neither should create a second value.
	 */
	parsePlain(text: string, _ctx: FieldContext): Parsed<TextValue> {
		const cleaned = text.normalize('NFC').trim();
		return parsed(isEmptyText(cleaned) ? null : cleaned);
	},

	filterOps: [
		'is',
		'isNot',
		'contains',
		'notContains',
		'startsWith',
		'endsWith',
		'isEmpty',
		'isNotEmpty',
	],

	/**
	 * Implements every operator in `filterOps`. Any other operator returns false: the numeric operators are
	 * deliberately not declared for text, so a filter asking whether a text value is greater than 5 is not
	 * silently answered by a string comparison.
	 */
	matches(value: TextValue, op: FilterOpId, operand: unknown, ctx: FieldContext): boolean {
		const read = readOperand(operand);
		const needle = read.kind === 'text' ? fold(read.text, ctx) : '';
		const haystack = fold(value ?? '', ctx);
		switch (op) {
			case 'is':
				return equalsText(value, operand, ctx);
			case 'isNot':
				return !equalsText(value, operand, ctx);
			case 'contains':
				return read.kind === 'text' && haystack.includes(needle);
			case 'notContains':
				return read.kind === 'text' && !haystack.includes(needle);
			case 'startsWith':
				return read.kind === 'text' && haystack.startsWith(needle);
			case 'endsWith':
				return read.kind === 'text' && haystack.endsWith(needle);
			case 'isEmpty':
				return value === null || isEmptyText(value);
			case 'isNotEmpty':
				return value !== null && !isEmptyText(value);
			case 'gt':
			case 'gte':
			case 'lt':
			case 'lte':
				return false;
		}
	},

	/**
	 * Total order: locale-aware collation, then a code-unit tiebreak so two distinct strings never compare
	 * equal (a collator that ignores case would otherwise make `compare("a", "A") === 0` while
	 * `groupKey` still separates them — the contract suite checks exactly that consistency). The absent
	 * value sorts last: empty rows belong at the bottom of a sort, not above the A's.
	 */
	compare(a: TextValue, b: TextValue, ctx: FieldContext): number {
		if (a === b) {
			return 0;
		}
		if (a === null) {
			return 1;
		}
		if (b === null) {
			return -1;
		}
		const collated = a.localeCompare(b, ctx.locale, { sensitivity: 'variant' });
		if (collated !== 0) {
			return collated > 0 ? 1 : -1;
		}
		return a < b ? -1 : 1;
	},

	/**
	 * The grouping key: the value itself, and `""` for the absent value.
	 *
	 * This is an internal key, not a label — a group header shows a representative row's `formatDisplay`.
	 * The empty key cannot collide with a real value, because a canonical text value is never `""`
	 * (whitespace-only input parses to `null`), which is what keeps `compare(a, b) === 0 ⇒ same groupKey`
	 * true for every pair.
	 */
	groupKey(value: TextValue, _ctx: FieldContext): string {
		return value ?? '';
	},
};

// Self-registration: importing this module is what adds the type to the registry. That is the whole point
// of the one-line pattern in `index.ts` — a new field type never edits a list of types.
registerField(textField);
