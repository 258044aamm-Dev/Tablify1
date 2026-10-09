/**
 * Property → field resolution: the one place that decides what a column *is*.
 *
 * Three jobs live here, and each is deliberately forgiving, because every input is hand-editable:
 *
 *   1. `validateFieldOptions` turns the untrusted `fieldOptions` entry from a `.base` file into a typed
 *      object, dropping what it cannot use **and saying why**. Nothing here throws on bad user data.
 *   2. The two timestamp columns (`created time`, `last modified time`) are read-only descriptors built
 *      in this file. Native `.tablify` views supply each row's `createdAt`/`updatedAt` metadata. Neither source writes a cell or frontmatter.
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
	CellValue,
} from '../types';
import { isFieldTypeId, parseFailed, parsed } from '../types';
import { getField } from '../fieldTypes';
import { textField } from '../fieldTypes/text';

/**
 * Where one transient query-layer property comes from. The only source the shipped adapters produce is
 * `database`, the tag for native `.tablify` fields; the native schema itself has no source field.
 */
export type PropertySource = 'database';

/** A query-layer column projection, plus the raw options its adapter supplied. */
export type PropertyDefinition = {
	/** The query key: a native stable field id. */
	readonly id: string;
	/** The column's visible name. */
	readonly name: string;
	/** Transient source tag supplied by the adapter; never read from a native schema field. */
	readonly source: PropertySource;
	/** The raw options entry supplied by the adapter. Untrusted at a file boundary. */
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
 * Builds one of the two read-only timestamp descriptors used by native views.
 *
 * `toJson` always returns `null` — not "no value", but "nothing to write": the column is not stored in a
 * cell, so a write queue must never reach this branch. The adapter supplies its authoritative metadata:
 * a native `.tablify` view passes the row's `createdAt`/`updatedAt` string from its document metadata.
 */
function createTimestampField(
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

/** The read-only `created time` descriptor; each adapter supplies the correct per-row source. */
export const createdTimeField = createTimestampField('createdTime', 'Created time', 'lucide-clock');

/** The read-only `last modified time` descriptor; each adapter supplies the correct per-row source. */
export const lastModifiedTimeField = createTimestampField(
	'lastModifiedTime',
	'Last modified time',
	'lucide-history',
);

/**
 * Resolves a column to the descriptor that renders and writes it.
 *
 * Order: native row timestamp metadata → a declared type from the registry → `text` with a reason. A
 * descriptor marked non-editable is read-only; ordinary native database fields remain eligible for writes.
 */
export function resolveField(
	property: PropertyDefinition,
	ctx: FieldContext,
	lookup: FieldLookup = getField,
): ResolvedField {
	const validated = validateFieldOptions(property.fieldOptions);
	const reasons = [...validated.reasons];
	const context = fieldContextFor(property, ctx, validated.options);

	const declared = validated.options.type;
	const databaseTime =
		declared === 'createdTime'
			? createdTimeField
			: declared === 'lastModifiedTime'
				? lastModifiedTimeField
				: undefined;
	if (databaseTime !== undefined) {
		reasons.push(
			'read-only: this value comes from row metadata and is never stored in cells (R3 step 7)',
		);
		return {
			definition: property,
			descriptor: databaseTime,
			readOnly: true,
			reasons,
			options: validated.options,
			context,
		};
	}

	if (declared !== undefined && isFieldTypeId(declared)) {
		const found = lookup(declared);
		if (found !== undefined) {
			return {
				definition: property,
				descriptor: found,
				readOnly: !found.editable,
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
		readOnly: false,
		reasons,
		options: validated.options,
		context,
	};
}
