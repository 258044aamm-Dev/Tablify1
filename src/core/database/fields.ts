/**
 * Field definitions — R1 step 4.
 *
 * A field is `{ id, name, type }` plus the settings its type understands. The vocabulary of those
 * settings (rating `max`, currency `symbol`/`precision`, duration `unit`) comes from the 0.1.0 Bases-era
 * plugin. It lives here, in the field itself, so a document carries its own schema.
 *
 * Two rules shape every decision in this module:
 *
 *   - **Select labels and colours are metadata; option ids are cell identity.** Renaming an option
 *     edits the field definition and rewrites no cell, because cells hold `opt_…` ids.
 *   - **A field type this build does not know is preserved whole.** {@link UnsupportedField} keeps
 *     the raw object, writes it back byte-identical, and earns a warning — the data is never
 *     dropped and never "converted" into text.
 *
 * Settings a type does not use are not errors and not silently absorbed: they stay in `unknown` and
 * round-trip, because a typo'd or future setting is not a reason to refuse a file, and dropping it
 * would be a reason to stop trusting the writer.
 */
import type { JsonObject, JsonValue, UnknownEntry } from './json';
import { describeJson, isJsonArray, isJsonObject, toCanonicalObject, unknownEntries } from './json';
import { isIdOfKind } from './ids';
import type { LoadError, LoadWarning } from './result';
import type { DocumentFieldTypeId } from './schema';
import { isDocumentFieldTypeId } from './schema';

/** One choice of a select field: the id is identity, the name and colour are presentation. */
export interface SelectOption {
	readonly id: string;
	readonly name: string;
	readonly color: string | null;
	readonly unknown: readonly UnknownEntry[];
}

/** The duration display unit a bare number means. The canonical value is always seconds. */
export type DurationUnit = 'seconds' | 'minutes' | 'hours';

/** Every duration unit, for narrowing an untrusted name. */
export const DURATION_UNITS: readonly DurationUnit[] = ['seconds', 'minutes', 'hours'];

/**
 * Per-type settings, validated per type and otherwise kept verbatim.
 *
 * Every member is optional and absent means "the file did not say" — defaults belong to renderers,
 * not to the codec, so a parse → serialize round trip cannot invent a setting the file never had.
 */
export interface FieldSettings {
	/** `rating`: the star cap. */
	readonly max?: number;
	/** `currency`: the render-only symbol. */
	readonly symbol?: string;
	/** `currency`: the render-only number of decimals. */
	readonly precision?: number;
	/** `duration`: what a bare typed number means. */
	readonly unit?: DurationUnit;
	/** `singleSelect`/`multiSelect`: the option list, in display order. */
	readonly options?: readonly SelectOption[];
	/** `link`: the table the ids point into. */
	readonly targetTableId?: string;
	/** `link`: false (or absent) is a single link; true is an ordered list. */
	readonly allowMultiple?: boolean;
	/** `link`: the field on the target table this link mirrors. Absent means no inverse is shown. */
	readonly inverseFieldId?: string;
	/** `link`: true on the *inverse* side — a field that is derived, never stored in cells
	 * (ADR-0001 §3). The relation itself is owned by the field that names it as its inverse. */
	readonly generated?: boolean;
}

/** A field this build understands. */
export interface FieldDefinition {
	readonly kind: 'field';
	readonly id: string;
	readonly name: string;
	readonly type: DocumentFieldTypeId;
	readonly settings: FieldSettings;
	readonly unknown: readonly UnknownEntry[];
}

/** A field whose type this build does not know: kept whole, written back unchanged. */
export interface UnsupportedField {
	readonly kind: 'unsupported';
	readonly id: string | null;
	readonly name: string | null;
	readonly typeName: string;
	readonly raw: JsonObject;
}

/** A table's field list entry. */
export type TableField = FieldDefinition | UnsupportedField;

/** The setting keys each type claims. Anything else on a field stays unknown and round-trips. */
const SETTING_KEYS: { readonly [type in DocumentFieldTypeId]: readonly string[] } = {
	text: [],
	longText: [],
	url: [],
	email: [],
	phone: [],
	number: [],
	currency: ['symbol', 'precision'],
	percent: [],
	duration: ['unit'],
	rating: ['max'],
	checkbox: [],
	date: [],
	datetime: [],
	singleSelect: ['options'],
	multiSelect: ['options'],
	attachment: [],
	link: ['targetTableId', 'allowMultiple', 'inverseFieldId', 'generated'],
	createdTime: [],
	lastModifiedTime: [],
};

/** The keys a field object owns, in the order the schema names them. */
function fieldKeysFor(type: DocumentFieldTypeId): readonly string[] {
	return ['id', 'name', 'type', ...SETTING_KEYS[type]];
}

/** Where a problem is, as JSONPath into the document. */
type Path = string;

/** Read one select option. Returns `undefined` when the option is not usable. */
function readOption(value: JsonValue, path: Path, errors: LoadError[]): SelectOption | undefined {
	if (!isJsonObject(value)) {
		errors.push({
			code: 'invalid-option',
			message: `Every select option must be a JSON object, not ${describeJson(value)}.`,
			path,
		});
		return undefined;
	}
	const id = value['id'];
	if (typeof id !== 'string' || !isIdOfKind('option', id)) {
		errors.push({
			code: 'invalid-option-id',
			message:
				'Every select option needs an id shaped like opt_ followed by lowercase letters and digits.',
			path: `${path}.id`,
		});
		return undefined;
	}
	const name = value['name'];
	if (typeof name !== 'string' || name === '') {
		errors.push({
			code: 'invalid-option-name',
			message: 'Every select option needs a non-empty name.',
			path: `${path}.name`,
		});
		return undefined;
	}
	const color = value['color'];
	if (color !== undefined && color !== null && typeof color !== 'string') {
		errors.push({
			code: 'invalid-option-color',
			message: `An option colour must be a string or null, not ${describeJson(color)}.`,
			path: `${path}.color`,
		});
		return undefined;
	}
	return {
		id,
		name,
		color: typeof color === 'string' ? color : null,
		unknown: unknownEntries(value, ['id', 'name', 'color']),
	};
}

/** Read the option list of a select field. */
function readOptions(
	value: JsonValue,
	path: Path,
	errors: LoadError[],
): readonly SelectOption[] | undefined {
	if (!isJsonArray(value)) {
		errors.push({
			code: 'invalid-field-options',
			message: `The option list must be an array, not ${describeJson(value)}.`,
			path,
		});
		return undefined;
	}
	const options: SelectOption[] = [];
	const firstIndexById = new Map<string, number>();
	value.forEach((item, index) => {
		const option = readOption(item, `${path}[${index}]`, errors);
		if (option === undefined) {
			return;
		}
		const first = firstIndexById.get(option.id);
		if (first === undefined) {
			firstIndexById.set(option.id, index);
			options.push(option);
		} else {
			errors.push({
				code: 'duplicate-option-id',
				message: `The option id "${option.id}" is used by both options[${first}] and options[${index}].`,
				path: `${path}[${index}]`,
			});
		}
	});
	return options;
}

/** Read the settings for one supported field type. Errors are structural; unknown keys are kept. */
function readSettings(
	type: DocumentFieldTypeId,
	value: JsonObject,
	path: Path,
	errors: LoadError[],
): FieldSettings | undefined {
	const settings: {
		max?: number;
		symbol?: string;
		precision?: number;
		unit?: DurationUnit;
		options?: readonly SelectOption[];
		targetTableId?: string;
		allowMultiple?: boolean;
		inverseFieldId?: string;
		generated?: boolean;
	} = {};
	let failed = false;

	const fail = (code: string, message: string, at: string): void => {
		errors.push({ code, message, path: at });
		failed = true;
	};

	if (type === 'rating') {
		const max = value['max'];
		if (max !== undefined) {
			if (typeof max !== 'number' || !Number.isInteger(max) || max < 1) {
				fail(
					'invalid-rating-max',
					`A rating cap must be a whole number of 1 or more, not ${describeJson(max)}.`,
					`${path}.max`,
				);
			} else {
				settings.max = max;
			}
		}
	}

	if (type === 'currency') {
		const symbol = value['symbol'];
		if (symbol !== undefined) {
			if (typeof symbol !== 'string') {
				fail(
					'invalid-currency-symbol',
					`A currency symbol must be a string, not ${describeJson(symbol)}.`,
					`${path}.symbol`,
				);
			} else {
				settings.symbol = symbol;
			}
		}
		const precision = value['precision'];
		if (precision !== undefined) {
			if (
				typeof precision !== 'number' ||
				!Number.isInteger(precision) ||
				precision < 0 ||
				precision > 8
			) {
				fail(
					'invalid-currency-precision',
					`A currency precision must be a whole number from 0 to 8, not ${describeJson(precision)}.`,
					`${path}.precision`,
				);
			} else {
				settings.precision = precision;
			}
		}
	}

	if (type === 'duration') {
		const unit = value['unit'];
		if (unit !== undefined) {
			const chosen = DURATION_UNITS.find((candidate) => candidate === unit);
			if (chosen === undefined) {
				fail(
					'invalid-duration-unit',
					`A duration unit must be seconds, minutes or hours, not ${describeJson(unit)}.`,
					`${path}.unit`,
				);
			} else {
				settings.unit = chosen;
			}
		}
	}

	if (type === 'singleSelect' || type === 'multiSelect') {
		const options = value['options'];
		if (options === undefined) {
			fail(
				'missing-field-options',
				'A select field needs an options list, even when it is empty.',
				`${path}.options`,
			);
		} else {
			const read = readOptions(options, `${path}.options`, errors);
			if (read !== undefined) {
				settings.options = read;
			} else {
				failed = true;
			}
		}
	}

	if (type === 'link') {
		const target = value['targetTableId'];
		if (target === undefined) {
			fail(
				'missing-link-target',
				'A link field needs the id of the table it points into.',
				`${path}.targetTableId`,
			);
		} else if (typeof target !== 'string' || !isIdOfKind('table', target)) {
			fail(
				'malformed-link-target',
				`A link target must be a table id shaped like tbl_, not ${describeJson(target)}.`,
				`${path}.targetTableId`,
			);
		} else {
			settings.targetTableId = target;
		}
		const allowMultiple = value['allowMultiple'];
		if (allowMultiple !== undefined) {
			if (typeof allowMultiple !== 'boolean') {
				fail(
					'invalid-link-cardinality',
					`allowMultiple must be true or false, not ${describeJson(allowMultiple)}.`,
					`${path}.allowMultiple`,
				);
			} else {
				settings.allowMultiple = allowMultiple;
			}
		}
		const inverse = value['inverseFieldId'];
		if (inverse !== undefined && inverse !== null) {
			if (typeof inverse !== 'string' || !isIdOfKind('field', inverse)) {
				fail(
					'malformed-inverse-field',
					`An inverse field must be a field id shaped like fld_, not ${describeJson(inverse)}.`,
					`${path}.inverseFieldId`,
				);
			} else {
				settings.inverseFieldId = inverse;
			}
		}
		const generated = value['generated'];
		if (generated !== undefined) {
			if (typeof generated !== 'boolean') {
				fail(
					'invalid-generated-flag',
					`The generated marker must be true or false, not ${describeJson(generated)}.`,
					`${path}.generated`,
				);
			} else {
				settings.generated = generated;
			}
		}
	}

	if (failed) {
		return undefined;
	}
	return settings;
}

/** Read one entry of a table's field list. */
function readField(
	value: JsonValue,
	path: Path,
	errors: LoadError[],
	warnings: LoadWarning[],
): TableField | undefined {
	if (!isJsonObject(value)) {
		errors.push({
			code: 'invalid-field',
			message: `Every field must be a JSON object, not ${describeJson(value)}.`,
			path,
		});
		return undefined;
	}

	const id = value['id'];
	const name = value['name'];
	const typeName = value['type'];
	const idOk = typeof id === 'string' && isIdOfKind('field', id);
	const nameOk = typeof name === 'string' && name !== '';

	if (!idOk) {
		errors.push({
			code: 'invalid-field-id',
			message:
				'Every field needs an id shaped like fld_ followed by lowercase letters and digits.',
			path: `${path}.id`,
		});
	}
	if (!nameOk) {
		errors.push({
			code: 'invalid-field-name',
			message: 'Every field needs a non-empty name.',
			path: `${path}.name`,
		});
	}

	if (typeof typeName !== 'string') {
		errors.push({
			code: 'invalid-field-type',
			message: 'Every field needs a type name.',
			path: `${path}.type`,
		});
		return undefined;
	}

	if (!isDocumentFieldTypeId(typeName)) {
		// The structured unsupported result: everything about this field is preserved verbatim and a
		// warning names the type, so a newer build's column survives a round trip through this one.
		warnings.push({
			code: 'unsupported-field-type',
			message: `The field type "${typeName}" is not one this build reads; the field is preserved as it is and never rewritten.`,
			path,
		});
		return {
			kind: 'unsupported',
			id: idOk ? id : null,
			name: nameOk ? name : null,
			typeName,
			raw: value,
		};
	}

	if (!idOk || !nameOk) {
		return undefined;
	}

	const settings = readSettings(typeName, value, path, errors);
	if (settings === undefined) {
		return undefined;
	}

	return {
		kind: 'field',
		id,
		name,
		type: typeName,
		settings,
		unknown: unknownEntries(value, fieldKeysFor(typeName)),
	};
}

/**
 * Read a table's field list. Every field needs an id, a name and a type; ids are unique within the
 * table; a type this build does not know becomes an {@link UnsupportedField} with a warning.
 */
export function readFields(
	source: JsonValue | undefined,
	path: Path,
	errors: LoadError[],
	warnings: LoadWarning[],
): readonly TableField[] {
	if (source === undefined) {
		errors.push({
			code: 'missing-fields',
			message: 'Every table needs a fields list, even when it is empty.',
			path,
		});
		return [];
	}
	if (!isJsonArray(source)) {
		errors.push({
			code: 'invalid-fields',
			message: `The fields list must be an array, not ${describeJson(source)}.`,
			path,
		});
		return [];
	}

	const fields: TableField[] = [];
	const firstIndexById = new Map<string, number>();
	source.forEach((item, index) => {
		const field = readField(item, `${path}[${index}]`, errors, warnings);
		if (field === undefined) {
			return;
		}
		const id = field.id;
		if (id === null) {
			fields.push(field);
			return;
		}
		const first = firstIndexById.get(id);
		if (first === undefined) {
			firstIndexById.set(id, index);
			fields.push(field);
		} else {
			errors.push({
				code: 'duplicate-field-id',
				message: `The field id "${id}" is used by both fields[${first}] and fields[${index}].`,
				path: `${path}[${index}]`,
			});
		}
	});
	return fields;
}

/** Serialize a select option: id, name, colour, then whatever else the file had. */
function serializeOption(option: SelectOption): JsonValue {
	return toCanonicalObject(
		[
			['id', option.id],
			['name', option.name],
			['color', option.color ?? undefined],
		],
		option.unknown,
	);
}

/** The setting entries of a supported field, in the schema's order, absent values omitted. */
function serializeSettings(
	field: FieldDefinition,
): readonly (readonly [string, JsonValue | undefined])[] {
	const { settings } = field;
	switch (field.type) {
		case 'rating':
			return [['max', settings.max]];
		case 'currency':
			return [
				['symbol', settings.symbol],
				['precision', settings.precision],
			];
		case 'duration':
			return [['unit', settings.unit]];
		case 'singleSelect':
		case 'multiSelect':
			return [['options', settings.options?.map((option) => serializeOption(option))]];
		case 'link':
			return [
				['targetTableId', settings.targetTableId],
				['allowMultiple', settings.allowMultiple],
				['inverseFieldId', settings.inverseFieldId],
				['generated', settings.generated],
			];
		default:
			return [];
	}
}

/** Write a field back. An unsupported field writes its preserved object, unchanged. */
export function serializeField(field: TableField): JsonValue {
	if (field.kind === 'unsupported') {
		return field.raw;
	}
	return toCanonicalObject(
		[['id', field.id], ['name', field.name], ['type', field.type], ...serializeSettings(field)],
		field.unknown,
	);
}

/** The option list of a select field, or an empty list for every other type. */
export function optionsOf(field: FieldDefinition): readonly SelectOption[] {
	return field.settings.options ?? [];
}
