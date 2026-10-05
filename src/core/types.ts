/**
 * The value model, and the vocabulary every other core module speaks. This file is the root of the
 * dependency graph inside `src/core`: it imports nothing, Obsidian and React are barred from this whole
 * directory by the boundary lint, and everything here must stay runnable in a unit test with no host.
 */

/**
 * The canonical cell value.
 *
 * `null` means "no value" — the same thing as an absent frontmatter key, because clearing a property
 * *deletes* it rather than writing `""`/`null` (docs/03 §frontmatter write rules). A field type's own
 * canonical value is a subset of this union: `text` is `string | null`, `checkbox` is `boolean | null`.
 */
export type CellValue = string | number | boolean | null | readonly string[];

/** A YAML-safe scalar: the only shapes a canonical value may reach frontmatter as. */
export type YamlScalar = string | number | boolean | null;

/** A YAML-safe list of scalars. `undefined` is never a member: YAML has no such value. */
export type YamlList = readonly YamlScalar[];

/** Exactly what `toYaml` may return. `null` means "write nothing" — the key is deleted. */
export type YamlValue = YamlScalar | YamlList;

/** A property id is a Bases id, prefixed by its source: `file.name`, `note.Status`, `formula.Total`. */
export type PropertyId = string;

/**
 * The plugin's field types, closed on purpose: every `switch`/`if` over a type id is exhaustively
 * checked, and `isFieldTypeId` is the only way a name from a hand-edited `.base` file enters this union.
 * The two trailing ids are never registered — they are read-only columns backed by file metadata (P11).
 */
export type FieldTypeId =
	| 'text'
	| 'longText'
	| 'number'
	| 'checkbox'
	| 'date'
	| 'datetime'
	| 'url'
	| 'email'
	| 'phone'
	| 'singleSelect'
	| 'multiSelect'
	| 'rating'
	| 'currency'
	| 'percent'
	| 'duration'
	| 'attachment'
	| 'createdTime'
	| 'lastModifiedTime';

/** Every field type id, for narrowing an untrusted name. Kept beside the union so the two cannot drift. */
export const FIELD_TYPE_IDS: readonly FieldTypeId[] = [
	'text',
	'longText',
	'number',
	'checkbox',
	'date',
	'datetime',
	'url',
	'email',
	'phone',
	'singleSelect',
	'multiSelect',
	'rating',
	'currency',
	'percent',
	'duration',
	'attachment',
	'createdTime',
	'lastModifiedTime',
];

/** True when `value` names a field type this plugin ships — the only legal entry into {@link FieldTypeId}. */
export function isFieldTypeId(value: string): value is FieldTypeId {
	return FIELD_TYPE_IDS.some((id) => id === value);
}

/** Which cell editor renders a column. Fewer than the field types: several types share one editor. */
export type EditorId =
	| 'text'
	| 'longText'
	| 'number'
	| 'checkbox'
	| 'date'
	| 'select'
	| 'multiSelect'
	| 'rating'
	| 'attachment'
	| 'readonly';

/**
 * The filter operators, closed. A field type declares the subset it supports in `filterOps`, so the
 * filter builder and the query parser have one list to read. `docs/01` has no operator table; this set
 * is derived from the semantics `docs/02` §Query needs (see PROGRESS.md).
 */
export type FilterOpId =
	| 'is'
	| 'isNot'
	| 'contains'
	| 'notContains'
	| 'startsWith'
	| 'endsWith'
	| 'isEmpty'
	| 'isNotEmpty'
	| 'gt'
	| 'gte'
	| 'lt'
	| 'lte';

/** The outcome of parsing untrusted input: either a canonical value, or a reason and the input. */
export type Parsed<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: string; readonly raw: unknown };

/** Wraps a canonical value as a successful parse. */
export function parsed<T>(value: T): Parsed<T> {
	return { ok: true, value };
}

/** Builds a failed parse. The raw input travels with it, so a preview can show what was rejected. */
export function parseFailed(error: string, raw: unknown): Parsed<never> {
	return { ok: false, error, raw };
}

/** One select option. Identity is the `name` (the value frontmatter stores); `id` and `color` are presentation. */
export type FieldOption = {
	readonly id: string;
	readonly name: string;
	readonly color?: string;
};

/** The unit a `duration` value is stored and rendered in. Seconds is the storage default (P12). */
export type DurationUnit = 'seconds' | 'minutes' | 'hours';

/**
 * The validated per-field options for one column, as stored in the `.base` view config. Unknown keys are
 * dropped by `validateFieldOptions()` in `schema/propertySchema.ts`, which also records why; `type` stays a
 * plain string because an unknown type name must reach the registry fallback instead of failing validation.
 */
export type FieldOptions = {
	readonly type?: string;
	readonly options?: readonly FieldOption[];
	readonly max?: number;
	readonly symbol?: string;
	readonly precision?: number;
	readonly unit?: DurationUnit;
};

/**
 * The shape of `@standard-schema/spec` v1, declared locally: the package is a dependency decision this
 * step was fenced against, and nothing implements it yet (see PROGRESS.md). Structurally identical, so
 * swapping in the real import later is a one-line change.
 */
export type StandardSchemaV1<TInput = unknown, TOutput = TInput> = {
	readonly '~standard': {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (
			value: unknown,
		) =>
			| { readonly value: TOutput }
			| { readonly issues: readonly { readonly message: string }[] };
		readonly types?: { readonly input: TInput; readonly output: TOutput };
	};
};

/** Everything a descriptor may know about the world that is not the value itself. */
export type FieldContext = {
	/** Vault-relative path of the note the value belongs to: `Projects/Widening.md`. */
	readonly path: string;
	/** Current time, epoch milliseconds. A function so a long-lived render cannot hold a stale clock. */
	readonly now: () => number;
	/** IANA zone used when rendering an instant: `Asia/Dhaka`. */
	readonly timezone: string;
	/** BCP-47 tag used for formatting and collation: `en-GB`. */
	readonly locale: string;
	/** The validated options for this column. */
	readonly fieldOptions: FieldOptions;
	/** The column's visible name: used in messages, never as a key. */
	readonly columnName: string;
};

/**
 * The contract every field type implements. Quoted from `docs/02-architecture.md` §the field-type
 * registry and implemented exactly as written; the methods are declared in method syntax on purpose,
 * because that is what lets `FieldDescriptor<string | null>` be stored as a `FieldDescriptor`.
 */
export interface FieldDescriptor<TValue = CellValue> {
	/** Type id, e.g. `"currency"`. The registry key. */
	readonly id: FieldTypeId;
	/** Human-facing name, sentence case. */
	readonly label: string;
	/** lucide icon name. */
	readonly icon: string;
	/** `false` ⇒ rendered read-only and never written. */
	readonly editable: boolean;
	/** The value a newly created cell holds before anyone types. */
	readonly defaultValue: TValue;

	/** Canonical value from a frontmatter-ish input. Never throws; returns a tagged error. */
	parse(raw: unknown, ctx: FieldContext): Parsed<TValue>;

	/** Canonical value → what actually gets written to frontmatter. */
	toYaml(value: TValue, ctx: FieldContext): YamlValue;

	/** Canonical value → what the cell shows. */
	formatDisplay(value: TValue, ctx: FieldContext): string;

	/** Canonical value → plain text for clipboard/TSV/export. */
	formatPlain(value: TValue, ctx: FieldContext): string;

	/** Plain text from a spreadsheet paste → canonical value. */
	parsePlain(text: string, ctx: FieldContext): Parsed<TValue>;

	/** Which filter operators apply; drives the filter UI and the query parser. */
	readonly filterOps: readonly FilterOpId[];
	matches(value: TValue, op: FilterOpId, operand: unknown, ctx: FieldContext): boolean;
	compare(a: TValue, b: TValue, ctx: FieldContext): number;
	groupKey(value: TValue, ctx: FieldContext): string;

	/** Which cell editor renders it. Defaults to `id` (resolved by the grid, which knows the editor set). */
	readonly editor?: EditorId;
	/** Per-field options validation. Unused so far: see {@link StandardSchemaV1} and PROGRESS.md. */
	readonly optionsSchema?: StandardSchemaV1;
}
