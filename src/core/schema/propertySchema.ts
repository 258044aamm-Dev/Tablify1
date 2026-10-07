/**
 * Property → field resolution: the one place that decides what a column *is*.
 *
 * Three jobs live here, and each is deliberately forgiving, because every input is hand-editable:
 *
 *   1. `validateFieldOptions` turns the untrusted `fieldOptions` entry from a `.base` file into a typed
 *      object, dropping what it cannot use **and saying why**. Nothing here throws on bad user data.
 *   2. The two file-metadata columns (`created time`, `last modified time`) are read-only descriptors built
 *      in this file. P11 dropped the stored field types: the values come from `file.ctime`/`file.mtime`,
 *      so they are never written and never appear in frontmatter.
 *   3. `resolveField` picks the descriptor: the declared type when the registry knows it, otherwise `text`
 *      with a recorded reason. A hand-edited `.base` can never make the grid fail to open.
 *
 * Note on the return type: `resolveField` returns a `ResolvedField` rather than a bare `FieldDescriptor`,
 * because the step requires the reasons to be *recorded* and a descriptor has nowhere to carry them. The
 * descriptor itself is unchanged from `docs/02-architecture.md`.
 */
import type {
	DurationUnit,
	FieldContext,
	FieldDescriptor,
	FieldOption,
	FieldOptions,
	FieldTypeId,
	FilterOpId,
	Parsed,
	PropertyId,
	CellValue,
} from '../types';
import { isFieldTypeId, parseFailed, parsed } from '../types';
import { getField } from '../fieldTypes';
import { textField } from '../fieldTypes/text';

/** Where a Bases property comes from. Everything that is not a note property is read-only. */
export type PropertySource = 'note' | 'file' | 'formula' | 'unknown';

/** One column, as the Bases view describes it, plus the raw `fieldOptions` entry if the `.base` has one. */
export type PropertyDefinition = {
	/** Prefixed Bases id: `note.Status`, `file.name`, `formula.Total`, or a bare name for note properties. */
	readonly id: PropertyId;
	/** The bare name after the prefix. */
	readonly name: string;
	/** The source the prefix implies. */
	readonly source: PropertySource;
	/** The raw `fieldOptions` entry for this property. Untrusted: it was hand-editable YAML. */
	readonly fieldOptions?: unknown;
};

/** A resolved column: the descriptor to use, whether the column can be written, and what was decided. */
export type ResolvedField = {
	/**
	 * The column this resolution is about: its prefixed id, its name and its source. The query layer needs
	 * it (a filter names a column, and the evaluator must find one), and so does every message that has to
	 * say *which* column it is about, which is why it travels with the resolution instead of beside it.
	 */
	readonly definition: PropertyDefinition;
	readonly descriptor: FieldDescriptor;
	/** True when the grid must render the cell disabled and the write queue must refuse an edit. */
	readonly readOnly: boolean;
	/** Human-readable notes about the resolution: a fallback, a dropped option, a read-only source. */
	readonly reasons: readonly string[];
	/** The validated options, also present in `context.fieldOptions`. */
	readonly options: FieldOptions;
	/** The per-column context every descriptor call for this column must receive. */
	readonly context: FieldContext;
};

/** How a caller looks a type id up. Defaults to the shipped registry; tests inject their own. */
export type FieldLookup = (id: FieldTypeId) => FieldDescriptor | undefined;

/** Option keys the plugin understands. Anything else is dropped with a reason. */
const KNOWN_OPTION_KEYS: readonly string[] = [
	'type',
	'options',
	'max',
	'symbol',
	'precision',
	'unit',
];

/** Duration units, the closed set `unit` may take. */
const DURATION_UNITS: readonly DurationUnit[] = ['seconds', 'minutes', 'hours'];

/** Narrows an untrusted string to a duration unit. */
function isDurationUnit(value: string): value is DurationUnit {
	return DURATION_UNITS.some((known) => known === value);
}

/** The result of validating untrusted options: what survived, and why the rest did not. */
type ValidatedOptions = { readonly options: FieldOptions; readonly reasons: readonly string[] };

/** Reads a property's name and source out of a Bases id, treating a bare name as a note property. */
export function propertyFromBasesId(id: PropertyId): PropertyDefinition {
	const separator = id.indexOf('.');
	if (separator < 0) {
		return { id, name: id, source: 'note' };
	}
	const prefix = id.slice(0, separator);
	const name = id.slice(separator + 1);
	if (prefix === 'file' || prefix === 'formula' || prefix === 'note') {
		return { id, name, source: prefix };
	}
	return { id, name: id, source: 'unknown' };
}

/** Trimmed, lower-cased, punctuation-free form of a name, for comparing spellings across eras. */
function normalizeName(name: string): string {
	return name.toLowerCase().replace(/[\s_-]/g, '');
}

/**
 * Names that mean "created" and "modified" downstream of P11. Applied to `file.*` properties, and to note
 * properties only under the exact legacy spellings, so a note property called "Created" keeps its own
 * value rather than silently becoming file metadata.
 */
const CREATED_NAMES: readonly string[] = ['ctime', 'created', 'createdtime', 'creationtime'];
const MODIFIED_NAMES: readonly string[] = [
	'mtime',
	'modified',
	'lastmodifiedtime',
	'modificationtime',
];
const LEGACY_STORED_NAMES: readonly string[] = ['createdtime', 'lastmodifiedtime'];

/** The `FieldOption`s in a raw `options` array: kept when usable, dropped with a reason when not. */
function readOptions(raw: readonly unknown[], reasons: string[]): readonly FieldOption[] {
	const kept: FieldOption[] = [];
	const seenNames = new Set<string>();
	raw.forEach((entry, index) => {
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
			reasons.push(`select option ${index} is not an object — ignored`);
			return;
		}
		const record: Record<string, unknown> = { ...entry };
		const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
		if (name === '') {
			reasons.push(`select option ${index} has no name — ignored`);
			return;
		}
		const folded = name.toLowerCase();
		if (seenNames.has(folded)) {
			reasons.push(`select option "${name}" is a duplicate label — ignored`);
			return;
		}
		seenNames.add(folded);
		const id =
			typeof record['id'] === 'string' && record['id'] !== ''
				? record['id']
				: `o${index + 1}`;
		const color =
			typeof record['color'] === 'string' && record['color'] !== ''
				? record['color']
				: undefined;
		kept.push(color === undefined ? { id, name } : { id, name, color });
	});
	return kept;
}

/** Reads one numeric option, dropping it with a reason unless it is an integer inside the allowed range. */
function readInteger(
	raw: unknown,
	key: string,
	minimum: number,
	reasons: string[],
): number | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < minimum) {
		reasons.push(`${key} must be an integer of at least ${minimum} — ignored`);
		return undefined;
	}
	return raw;
}

/**
 * Validates a raw `fieldOptions` entry. Never throws: an unusable entry yields `{}` plus reasons, because
 * the plugin must open a hand-edited `.base` rather than refuse it. Unknown keys are ignored (with a
 * reason, so the report can show what the file asked for), `max` must be a positive integer, and select
 * option labels must be unique.
 */
export function validateFieldOptions(raw: unknown): ValidatedOptions {
	const reasons: string[] = [];
	if (raw === null || raw === undefined) {
		return { options: {}, reasons };
	}
	if (typeof raw !== 'object' || Array.isArray(raw)) {
		reasons.push('fieldOptions must be an object — ignored');
		return { options: {}, reasons };
	}
	const record: Record<string, unknown> = { ...raw };
	const options: {
		type?: string;
		options?: readonly FieldOption[];
		max?: number;
		symbol?: string;
		precision?: number;
		unit?: DurationUnit;
	} = {};

	for (const key of Object.keys(record)) {
		if (!KNOWN_OPTION_KEYS.includes(key)) {
			reasons.push(`unknown field option "${key}" — ignored`);
		}
	}

	const type = record['type'];
	if (type !== undefined) {
		if (typeof type === 'string' && type !== '') {
			options.type = type;
		} else {
			reasons.push('type must be a non-empty string — ignored');
		}
	}

	const list = record['options'];
	if (list !== undefined) {
		if (Array.isArray(list)) {
			const kept = readOptions(list, reasons);
			if (kept.length > 0) {
				options.options = kept;
			}
		} else {
			reasons.push('options must be an array — ignored');
		}
	}

	const max = readInteger(record['max'], 'max', 1, reasons);
	if (max !== undefined) {
		options.max = max;
	}

	const precision = readInteger(record['precision'], 'precision', 0, reasons);
	if (precision !== undefined) {
		options.precision = precision;
	}

	const symbol = record['symbol'];
	if (symbol !== undefined) {
		if (typeof symbol === 'string' && symbol !== '') {
			options.symbol = symbol;
		} else {
			reasons.push('symbol must be a non-empty string — ignored');
		}
	}

	const unit = record['unit'];
	if (unit !== undefined) {
		if (typeof unit === 'string' && isDurationUnit(unit)) {
			options.unit = unit;
		} else {
			reasons.push(`unit must be one of ${DURATION_UNITS.join(', ')} — ignored`);
		}
	}

	return { options, reasons };
}

/** Builds the per-column context: the base context, plus this column's name and validated options. */
export function fieldContextFor(
	property: PropertyDefinition,
	base: FieldContext,
	options: FieldOptions,
): FieldContext {
	return { ...base, fieldOptions: options, columnName: property.name };
}

/** Formatters are expensive to build, so one per locale+zone is cached for the life of the session. */
const displayFormatters = new Map<string, Intl.DateTimeFormat>();
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(
	cache: Map<string, Intl.DateTimeFormat>,
	ctx: FieldContext,
	options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
	const key = `${ctx.locale}|${ctx.timezone}|${String(options.dateStyle ?? '')}${String(options.timeStyle ?? '')}`;
	const cached = cache.get(key);
	if (cached !== undefined) {
		return cached;
	}
	const created = new Intl.DateTimeFormat(ctx.locale, { ...options, timeZone: ctx.timezone });
	cache.set(key, created);
	return created;
}

/** Epoch milliseconds from an ISO string or an epoch number; `undefined` when neither parses. */
function instantOf(raw: unknown): number | undefined {
	if (typeof raw === 'number' && Number.isFinite(raw)) {
		return raw;
	}
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (trimmed === '') {
			return undefined;
		}
		const ms = Date.parse(trimmed);
		return Number.isNaN(ms) ? undefined : ms;
	}
	return undefined;
}

/** The local calendar day of an instant, `YYYY-MM-DD`, for grouping and for plain-text export. */
function localDay(ms: number, ctx: FieldContext): string {
	const parts = formatterFor(dayFormatters, ctx, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(new Date(ms));
	const value = (kind: Intl.DateTimeFormatPartTypes): string =>
		parts.find((part) => part.type === kind)?.value ?? '';
	return `${value('year')}-${value('month')}-${value('day')}`;
}

/**
 * Builds one of the two read-only, file-metadata-backed descriptors.
 *
 * `toJson` always returns `null` — not "no value", but "nothing to write": the column is not stored, so the
 * write queue must never reach this branch (it refuses when `ResolvedField.readOnly` is set). The value
 * itself comes from the adapter, which passes `file.ctime`/`file.mtime` as epoch milliseconds.
 */
function createFileTimeField(
	id: 'createdTime' | 'lastModifiedTime',
	label: string,
	icon: string,
): FieldDescriptor<string | null> {
	const filterOps: readonly FilterOpId[] = [
		'is',
		'isNot',
		'isEmpty',
		'isNotEmpty',
		'gt',
		'gte',
		'lt',
		'lte',
	];
	return {
		id,
		label,
		icon,
		editable: false,
		defaultValue: null,
		editor: 'readonly',
		parse(raw: unknown, _ctx: FieldContext): Parsed<string | null> {
			const ms = instantOf(raw);
			if (raw === null || raw === undefined || raw === '') {
				return parsed(null);
			}
			if (ms === undefined) {
				return parseFailed(
					`${label} expects an ISO date string or epoch milliseconds`,
					raw,
				);
			}
			return parsed(new Date(ms).toISOString());
		},
		toJson(_value: string | null, _ctx: FieldContext): CellValue {
			return null;
		},
		formatDisplay(value: string | null, ctx: FieldContext): string {
			const ms = instantOf(value);
			if (ms === undefined) {
				return '';
			}
			return formatterFor(displayFormatters, ctx, {
				dateStyle: 'medium',
				timeStyle: 'short',
			}).format(new Date(ms));
		},
		formatPlain(value: string | null, ctx: FieldContext): string {
			const ms = instantOf(value);
			if (ms === undefined) {
				return '';
			}
			return `${localDay(ms, ctx)} ${formatterFor(displayFormatters, ctx, { timeStyle: 'short' }).format(new Date(ms))}`;
		},
		parsePlain(text: string, _ctx: FieldContext): Parsed<string | null> {
			const trimmed = text.trim();
			if (trimmed === '') {
				return parsed(null);
			}
			const ms = instantOf(trimmed.replace(' ', 'T'));
			if (ms === undefined) {
				return parseFailed(`${label} expects a date, for example 2026-10-05 09:30`, text);
			}
			return parsed(new Date(ms).toISOString());
		},
		filterOps,
		matches(
			value: string | null,
			op: FilterOpId,
			operand: unknown,
			_ctx: FieldContext,
		): boolean {
			const left = instantOf(value);
			const right = instantOf(op === 'isEmpty' || op === 'isNotEmpty' ? undefined : operand);
			switch (op) {
				case 'isEmpty':
					return value === null;
				case 'isNotEmpty':
					return value !== null;
				case 'is':
					return left !== undefined && right !== undefined && left === right;
				case 'isNot':
					return !(left !== undefined && right !== undefined && left === right);
				case 'gt':
					return left !== undefined && right !== undefined && left > right;
				case 'gte':
					return left !== undefined && right !== undefined && left >= right;
				case 'lt':
					return left !== undefined && right !== undefined && left < right;
				case 'lte':
					return left !== undefined && right !== undefined && left <= right;
				case 'contains':
				case 'notContains':
				case 'startsWith':
				case 'endsWith':
					return false;
			}
		},
		compare(a: string | null, b: string | null, _ctx: FieldContext): number {
			if (a === b) {
				return 0;
			}
			const left = instantOf(a);
			const right = instantOf(b);
			if (left === undefined) {
				return 1;
			}
			if (right === undefined) {
				return -1;
			}
			return left === right ? 0 : left > right ? 1 : -1;
		},
		groupKey(value: string | null, ctx: FieldContext): string {
			const ms = instantOf(value);
			return ms === undefined ? '' : localDay(ms, ctx);
		},
	};
}

/** The read-only `created time` column, backed by `file.ctime` (P11: the stored field type is gone). */
export const createdTimeField = createFileTimeField('createdTime', 'Created time', 'lucide-clock');

/** The read-only `last modified time` column, backed by `file.mtime` (P11). */
export const lastModifiedTimeField = createFileTimeField(
	'lastModifiedTime',
	'Last modified time',
	'lucide-history',
);

/** The file-metadata descriptor a property means, if it means one. */
function fileTimeFieldFor(property: PropertyDefinition): FieldDescriptor | undefined {
	const folded = normalizeName(property.name);
	if (property.source === 'file') {
		if (CREATED_NAMES.some((name) => name === folded)) {
			return createdTimeField;
		}
		if (MODIFIED_NAMES.some((name) => name === folded)) {
			return lastModifiedTimeField;
		}
		return undefined;
	}
	// A note property is only ever file metadata under the exact names P11 retired: anything else keeps its
	// own value, because a note property called "Created" is a value the user typed.
	if (LEGACY_STORED_NAMES.some((name) => name === folded)) {
		return folded === 'createdtime' ? createdTimeField : lastModifiedTimeField;
	}
	return undefined;
}

/**
 * Resolves a column to the descriptor that renders and writes it.
 *
 * Order: file metadata (P11) → the declared `fieldOptions.type` when the registry knows it → `text` with a
 * reason. File and formula columns are always read-only; a descriptor can also declare `editable: false`.
 */
export function resolveField(
	property: PropertyDefinition,
	ctx: FieldContext,
	lookup: FieldLookup = getField,
): ResolvedField {
	const validated = validateFieldOptions(property.fieldOptions);
	const reasons = [...validated.reasons];
	const context = fieldContextFor(property, ctx, validated.options);

	const fileTime = fileTimeFieldFor(property);
	if (fileTime !== undefined) {
		reasons.push(
			'read-only: the value is file metadata, so it is never stored in frontmatter (P11)',
		);
		return {
			definition: property,
			descriptor: fileTime,
			readOnly: true,
			reasons,
			options: validated.options,
			context,
		};
	}

	const readOnlyBySource = property.source !== 'note';
	if (readOnlyBySource) {
		reasons.push(`read-only: ${property.source} properties are not writable from the grid`);
	}

	const declared = validated.options.type;
	if (declared !== undefined && isFieldTypeId(declared)) {
		const found = lookup(declared);
		if (found !== undefined) {
			return {
				definition: property,
				descriptor: found,
				readOnly: readOnlyBySource || !found.editable,
				reasons,
				options: validated.options,
				context,
			};
		}
		reasons.push(
			`field type "${declared}" is not implemented in this build — falling back to text`,
		);
	} else if (declared !== undefined) {
		reasons.push(`unknown field type "${declared}" — falling back to text`);
	} else {
		reasons.push('no field type declared — text until the value shape says otherwise');
	}

	// `text` is the fallback of last resort, taken from the descriptor itself rather than through the
	// registry, so a caller-injected lookup that knows nothing still resolves to something renderable.
	const fallback = lookup('text') ?? textField;
	return {
		definition: property,
		descriptor: fallback,
		readOnly: readOnlyBySource,
		reasons,
		options: validated.options,
		context,
	};
}
