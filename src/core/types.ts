/**
 * The value model, and the vocabulary every other core module speaks. This file is the root of the
 * dependency graph inside `src/core`: it imports nothing, Obsidian and React are barred from this whole
 * directory by the boundary lint, and everything here must stay runnable in a unit test with no host.
 */

/**
 * The canonical cell value — the one value vocabulary this project has, and the shape a `.tablify`
 * document stores (R3 step 3).
 *
 * `null` means "no value", and it is **not** the same thing as `false`, `0`, `""` or `[]`: clearing a
 * cell is `null`, and every falsy value that a field type can really hold stays itself (ADR-0004's
 * matrix). A field type's own canonical value is a subset of this union: `text` is `string | null`,
 * `checkbox` is `boolean | null`, a `link` is `string | string[] | null`.
 *
 * Lists are lists of **strings** — option ids, row ids, vault-relative attachment paths — because the
 * three list-valued types all hold identifiers or addresses, never mixtures. A scalar-only list shape
 * (`readonly (string | number | boolean | null)[]`) belonged to the YAML era and is gone: the document
 * writes this union, and `CanonicalCell` in `core/database/values.ts` is deliberately the same union,
 * asserted as mutually assignable in `tests/unit/value-vocabulary.test.ts`.
 *
 * Nothing here says *how* a value is spelled in a file. A `.tablify` document writes it as JSON; a
 * Markdown note's frontmatter writes a scalar or a flat list as YAML, which is the note path's own
 * business (R6 removes that path). The descriptors no longer carry a YAML conversion — see
 * {@link FieldDescriptor.toJson}.
 */
export type CellValue = string | number | boolean | null | readonly string[];

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

/**
 * The outcome of parsing untrusted input: either a canonical value, or a reason and the input.
 *
 * A successful parse may still carry a `warning` — a value that was accepted but deserves mention: a
 * malformed-but-tolerated url, a select label that is not in the option list yet, a rating that had to be
 * clamped, a two-part duration whose reading was a judgement call. Warnings are not failures, and the
 * caller decides whether to show them (the import preview does; a cell edit usually does not).
 */
export type Parsed<T> =
	| { readonly ok: true; readonly value: T; readonly warning?: string }
	| { readonly ok: false; readonly error: string; readonly raw: unknown };

/** Wraps a canonical value as a successful parse. Pass `warning` when the value needed a judgement call. */
export function parsed<T>(value: T, warning?: string): Parsed<T> {
	return warning === undefined ? { ok: true, value } : { ok: true, value, warning };
}

/** Builds a failed parse. The raw input travels with it, so a preview can show what was rejected. */
export function parseFailed(error: string, raw: unknown): Parsed<never> {
	return { ok: false, error, raw };
}

/**
 * One select option, as the descriptor vocabulary has always carried it: `{ id, name, color? }`.
 *
 * **Two identities, and the rule that separates them (R3 step 3's documented call).** In a `.tablify`
 * document the option's **id** is identity: a cell holds `opt_…`, and `name`/`color`/order live in the
 * field's metadata, so renaming or recolouring an option rewrites no cell (`core/database/fields.ts`
 * says the same thing from the document's side — see `SelectOption`). On a Markdown note's frontmatter
 * the **label** is identity, because that is the only thing a note can spell, and it must stay that way
 * while that path still runs: the note model lets a person type a brand-new option, so mapping labels to
 * ids there would either invent ids for labels no metadata knows (silently mutating the data) or drop the
 * value (worse). R6 deletes the note path; until then the label is an opaque string to every descriptor
 * and the document's id identity is the destination.
 */
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

/**
 * Everything a descriptor may know about the world that is not the value itself.
 *
 * There is deliberately **no path** here (R3 step 3). A descriptor answers questions about a value and
 * its column; where a cell's bytes live — a document path, a note path, a Base's sidecar — is the
 * repository's or the view's knowledge, and passing it in was how a pure field type ended up able to
 * resolve a file. Attachment *existence* and link *labels* are resolved by the adapter/view through a
 * read-only lookup; the core stores a vault-relative path or a row id and nothing more.
 */
export type FieldContext = {
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

	/**
	 * Canonical value from an untrusted input: a value read from a file (a document cell, a note's
	 * frontmatter), a pasted cell or an import cell. Never throws; returns a tagged error.
	 */
	parse(raw: unknown, ctx: FieldContext): Parsed<TValue>;

	/**
	 * Canonical value → the value a document stores, in the one canonical vocabulary (R3 step 3).
	 *
	 * For most types this is the identity, which is the point: the document stores what the field type
	 * calls the value, so there is no second encoding to keep in step and no YAML shape to translate.
	 * `null` answers "nothing to write" — a document omits the key. Never an object and never
	 * `undefined`: one value, one machine-readable spelling.
	 */
	toJson(value: TValue, ctx: FieldContext): CellValue;

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
