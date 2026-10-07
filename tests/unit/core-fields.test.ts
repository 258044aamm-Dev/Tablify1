/**
 * Field definitions — R1 step 4's gate.
 *
 * The three claims the rest of the phase leans on:
 *
 *   1. **Every supported type has a legal shape and is read.** A loop builds a minimal valid field
 *      for all nineteen document field types; if a type is added to the union without a shape here,
 *      the loop fails rather than the reader silently refusing real documents.
 *   2. **Settings are validated per type, and non-applicable settings are preserved, not refused.**
 *      `max` on a currency field is not an error and not absorbed — it stays an unknown entry and
 *      round-trips. A typo is not a reason to refuse a file; a lost setting is.
 *   3. **A type this build does not know is preserved whole.** The unsupported field is kept as its
 *      raw object, warned about, and written back unchanged.
 */
import { describe, expect, it } from 'vitest';

import { parseDocument, serializeDocument } from '../../src/core/database/envelope';
import type {
	FieldDefinition,
	JsonValue,
	LoadError,
	LoadWarning,
	TableField,
} from '../../src/core/database/index';
import { DOCUMENT_FIELD_TYPE_IDS, optionsOf, serializeField } from '../../src/core/database/index';
import type { DocumentFieldTypeId } from '../../src/core/database/schema';

const DATABASE_ID = 'db_test0000000000000000000z';
const TABLE_ID = 'tbl_test0000000000000000000z';

/** Wrap a field list in the smallest legal document, optionally adding table-level keys. */
function documentText(
	fields: JsonValue,
	tableExtra: Readonly<Record<string, JsonValue>> = {},
): string {
	const table: Record<string, JsonValue> = {
		id: TABLE_ID,
		name: 'Tasks',
		fields,
		rows: [],
		views: [],
		...tableExtra,
	};
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: DATABASE_ID,
		name: 'Test',
		tables: [table],
	});
}

/** Parse a document that is expected to load, and hand back its first table's fields. */
function fieldsOf(
	fields: JsonValue,
	tableExtra: Readonly<Record<string, JsonValue>> = {},
): readonly TableField[] {
	const text = documentText(fields, tableExtra);
	const result = parseDocument(text);
	if (!result.ok) {
		throw new Error(
			`expected a load; got ${result.errors.map((error) => `${error.code} at ${error.path}`).join(', ')}`,
		);
	}
	return result.document.tables[0]?.fields ?? [];
}

/** Parse a document that is expected to be refused, and hand back the errors. */
function errorsOf(fields: JsonValue): readonly LoadError[] {
	const result = parseDocument(documentText(fields));
	if (result.ok) {
		throw new Error('the test expected a refusal, and the document parsed');
	}
	return result.errors;
}

/** Parse a document that is expected to load with warnings, and hand back the warnings. */
function warningsOf(fields: JsonValue): readonly LoadWarning[] {
	const result = parseDocument(documentText(fields));
	if (!result.ok) {
		throw new Error('the test expected a load');
	}
	return result.warnings;
}

/** The first field of a one-field document, narrowed to the supported kind. */
function fieldOf(fields: JsonValue): FieldDefinition {
	const [field] = fieldsOf(fields);
	if (field === undefined || field.kind !== 'field') {
		throw new Error('expected one supported field');
	}
	return field;
}

/** A minimal valid field of `type`, with every required setting present. */
function minimalField(type: DocumentFieldTypeId, id: string): JsonValue {
	const base: Record<string, JsonValue> = { id, name: `Column ${id}`, type };
	if (type === 'singleSelect' || type === 'multiSelect') {
		base.options = [];
	}
	if (type === 'link') {
		base.targetTableId = TABLE_ID;
	}
	return base;
}

function fieldId(index: number): string {
	return `fld_test0000000000000000000${'abcdefghijklmnopqrstuvwxyz'.charAt(index)}`;
}

function optionId(index: number): string {
	return `opt_test0000000000000000000${'abcdefghijklmnopqrstuvwxyz'.charAt(index)}`;
}

describe('every supported field type', () => {
	it('has a minimal legal shape that the reader accepts without errors or warnings', () => {
		const types = DOCUMENT_FIELD_TYPE_IDS;
		const fields: JsonValue = types.map((type, index) => minimalField(type, fieldId(index)));
		const read = fieldsOf(fields);
		expect(read).toHaveLength(types.length);
		types.forEach((type, index) => {
			const field = read[index];
			expect(field?.kind).toBe('field');
			if (field?.kind === 'field') {
				expect(field.type).toBe(type);
			}
		});
		expect(warningsOf(fields)).toEqual([]);
	});
});

describe('settings are validated per type', () => {
	it('reads rating max, currency symbol and precision, and duration unit', () => {
		const [rating, currency, duration] = fieldsOf([
			{ id: fieldId(0), name: 'Rating', type: 'rating', max: 10 },
			{ id: fieldId(1), name: 'Fee', type: 'currency', symbol: '€', precision: 2 },
			{ id: fieldId(2), name: 'Length', type: 'duration', unit: 'minutes' },
		]);
		expect(rating?.kind === 'field' && rating.settings).toEqual({ max: 10 });
		expect(currency?.kind === 'field' && currency.settings).toEqual({
			symbol: '€',
			precision: 2,
		});
		expect(duration?.kind === 'field' && duration.settings).toEqual({ unit: 'minutes' });
	});

	it('refuses a rating cap below one', () => {
		const errors = errorsOf([{ id: fieldId(0), name: 'R', type: 'rating', max: 0 }]);
		expect(errors.map((error) => error.code)).toEqual(['invalid-rating-max']);
		expect(errors[0]?.path).toBe('$.tables[0].fields[0].max');
	});

	it('refuses a currency symbol that is not a string and a precision outside 0–8', () => {
		expect(
			errorsOf([{ id: fieldId(0), name: 'C', type: 'currency', symbol: 5 }]).map(
				(e) => e.code,
			),
		).toEqual(['invalid-currency-symbol']);
		expect(
			errorsOf([{ id: fieldId(0), name: 'C', type: 'currency', precision: 9 }]).map(
				(e) => e.code,
			),
		).toEqual(['invalid-currency-precision']);
	});

	it('refuses an unknown duration unit', () => {
		const errors = errorsOf([
			{ id: fieldId(0), name: 'L', type: 'duration', unit: 'fortnights' },
		]);
		expect(errors.map((error) => error.code)).toEqual(['invalid-duration-unit']);
	});

	it('requires a target table id on a link, and validates cardinality and inverse ids', () => {
		expect(errorsOf([{ id: fieldId(0), name: 'L', type: 'link' }]).map((e) => e.code)).toEqual([
			'missing-link-target',
		]);
		expect(
			errorsOf([{ id: fieldId(0), name: 'L', type: 'link', targetTableId: 'Clients' }]).map(
				(e) => e.code,
			),
		).toEqual(['malformed-link-target']);
		expect(
			errorsOf([
				{
					id: fieldId(0),
					name: 'L',
					type: 'link',
					targetTableId: TABLE_ID,
					allowMultiple: 'yes',
				},
			]).map((e) => e.code),
		).toEqual(['invalid-link-cardinality']);
		expect(
			errorsOf([
				{
					id: fieldId(0),
					name: 'L',
					type: 'link',
					targetTableId: TABLE_ID,
					inverseFieldId: 'nope',
				},
			]).map((e) => e.code),
		).toEqual(['malformed-inverse-field']);
	});

	it('reads a full link definition, including a generated inverse', () => {
		const field = fieldOf([
			{
				id: fieldId(0),
				name: 'Client',
				type: 'link',
				targetTableId: TABLE_ID,
				allowMultiple: true,
				inverseFieldId: fieldId(1),
			},
			// The inverse itself, so the declaration names a field this document really has (step
			// 6's invariant): generated on the target side, and it points back into this table.
			{
				id: fieldId(1),
				name: 'Shoots',
				type: 'link',
				targetTableId: TABLE_ID,
				generated: true,
			},
		]);
		expect(field.settings).toEqual({
			targetTableId: TABLE_ID,
			allowMultiple: true,
			inverseFieldId: fieldId(1),
		});
	});
});

describe('select options', () => {
	const select: JsonValue = [
		{
			id: fieldId(0),
			name: 'Status',
			type: 'singleSelect',
			options: [
				{ id: optionId(0), name: 'Planned', color: 'blue', icon: 'star' },
				{ id: optionId(1), name: 'Done' },
			],
		},
	];

	it('keeps option order, labels, colours and unknown option keys', () => {
		const field = fieldOf(select);
		const options = optionsOf(field);
		expect(options.map((option) => option.id)).toEqual([optionId(0), optionId(1)]);
		expect(options.map((option) => option.name)).toEqual(['Planned', 'Done']);
		expect(options[0]?.color).toBe('blue');
		expect(options[1]?.color).toBeNull();
		expect(options[0]?.unknown).toEqual([{ key: 'icon', value: 'star' }]);
	});

	it('treats a rename as metadata: the option id, not the label, is the cell identity', () => {
		const renamed = fieldOf([
			{
				id: fieldId(0),
				name: 'Status',
				type: 'singleSelect',
				options: [{ id: optionId(0), name: 'Backlog', color: 'blue' }],
			},
		]);
		expect(optionsOf(renamed)[0]?.id).toBe(optionId(0));
		expect(optionsOf(renamed)[0]?.name).toBe('Backlog');
	});

	it('requires the options list on a select field', () => {
		expect(
			errorsOf([{ id: fieldId(0), name: 'S', type: 'singleSelect' }]).map((e) => e.code),
		).toEqual(['missing-field-options']);
		expect(
			errorsOf([{ id: fieldId(0), name: 'S', type: 'multiSelect', options: 'many' }]).map(
				(e) => e.code,
			),
		).toEqual(['invalid-field-options']);
	});

	it('refuses duplicate option ids, missing names and non-string colours', () => {
		const duplicate = errorsOf([
			{
				id: fieldId(0),
				name: 'S',
				type: 'singleSelect',
				options: [
					{ id: optionId(0), name: 'A' },
					{ id: optionId(0), name: 'B' },
				],
			},
		]);
		expect(duplicate.map((error) => error.code)).toEqual(['duplicate-option-id']);
		expect(duplicate[0]?.path).toBe('$.tables[0].fields[0].options[1]');
		expect(
			errorsOf([
				{
					id: fieldId(0),
					name: 'S',
					type: 'singleSelect',
					options: [{ id: optionId(0), name: '' }],
				},
			]).map((e) => e.code),
		).toEqual(['invalid-option-name']);
		expect(
			errorsOf([
				{
					id: fieldId(0),
					name: 'S',
					type: 'singleSelect',
					options: [{ id: optionId(0), name: 'A', color: 7 }],
				},
			]).map((e) => e.code),
		).toEqual(['invalid-option-color']);
	});
});

describe('unsupported field types', () => {
	const summary: JsonValue = [
		{ id: fieldId(0), name: 'Summary', type: 'aiSummary', model: 'gpt-x', depth: 2 },
	];

	it('are preserved whole and warned about, never converted or dropped', () => {
		const [field] = fieldsOf(summary);
		expect(field?.kind).toBe('unsupported');
		if (field?.kind !== 'unsupported') {
			return;
		}
		expect(field.typeName).toBe('aiSummary');
		expect(field.id).toBe(fieldId(0));
		expect(field.raw).toEqual({
			id: fieldId(0),
			name: 'Summary',
			type: 'aiSummary',
			model: 'gpt-x',
			depth: 2,
		});
		const warnings = warningsOf(summary);
		expect(warnings.map((warning) => warning.code)).toEqual(['unsupported-field-type']);
		expect(warnings[0]?.message).toContain('aiSummary');
	});

	it('write back their raw object unchanged', () => {
		const [field] = fieldsOf(summary);
		if (field === undefined) {
			throw new Error('expected a field');
		}
		expect(serializeField(field)).toEqual({
			id: fieldId(0),
			name: 'Summary',
			type: 'aiSummary',
			model: 'gpt-x',
			depth: 2,
		});
	});
});

describe('settings a type does not own', () => {
	it('stay unknown and round-trip, instead of being refused or absorbed', () => {
		const [field] = fieldsOf([
			{ id: fieldId(0), name: 'Title', type: 'text', wobble: 3 },
			{ id: fieldId(1), name: 'Fee', type: 'currency', max: 5 },
		]);
		expect(field?.kind === 'field' && field.unknown).toEqual([{ key: 'wobble', value: 3 }]);
		const [, currency] = fieldsOf([
			{ id: fieldId(0), name: 'Title', type: 'text', wobble: 3 },
			{ id: fieldId(1), name: 'Fee', type: 'currency', max: 5 },
		]);
		expect(currency?.kind === 'field' && currency.settings).toEqual({});
		expect(currency?.kind === 'field' && currency.unknown).toEqual([{ key: 'max', value: 5 }]);
	});
});

describe('field identity and shape', () => {
	it('refuses a missing id, name or type', () => {
		expect(errorsOf([{ name: 'A', type: 'text' }]).map((e) => e.code)).toEqual([
			'invalid-field-id',
		]);
		expect(errorsOf([{ id: fieldId(0), type: 'text' }]).map((e) => e.code)).toEqual([
			'invalid-field-name',
		]);
		expect(errorsOf([{ id: fieldId(0), name: 'A' }]).map((e) => e.code)).toEqual([
			'invalid-field-type',
		]);
		expect(errorsOf(['not a field']).map((e) => e.code)).toEqual(['invalid-field']);
	});

	it('refuses a repeated field id, naming both positions', () => {
		const errors = errorsOf([
			{ id: fieldId(0), name: 'A', type: 'text' },
			{ id: fieldId(0), name: 'B', type: 'text' },
		]);
		expect(errors.map((error) => error.code)).toEqual(['duplicate-field-id']);
		expect(errors[0]?.message).toContain('fields[0] and fields[1]');
	});

	it('requires the fields list itself', () => {
		const text = JSON.stringify({
			format: 'tablify',
			version: 1,
			databaseId: DATABASE_ID,
			name: 'Test',
			tables: [{ id: TABLE_ID, name: 'Tasks' }],
		});
		const result = parseDocument(text);
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.errors.map((error) => error.code)).toEqual([
			'missing-fields',
			'missing-rows',
			'missing-views',
		]);
		expect(result.errors[0]?.path).toBe('$.tables[0].fields');
	});
});

describe('writing fields back', () => {
	it('writes id, name, type, then settings and unknown keys, and omits an absent colour', () => {
		const [field] = fieldsOf([
			{
				id: fieldId(0),
				name: 'Status',
				type: 'singleSelect',
				options: [{ id: optionId(0), name: 'Done' }],
				wobble: 1,
			},
		]);
		if (field === undefined) {
			throw new Error('expected a field');
		}
		const written = JSON.stringify(serializeField(field), null, 2);
		const order = ['"id"', '"name"', '"type"', '"options"', '"wobble"'].map((key) =>
			written.indexOf(key),
		);
		expect(order.every((index) => index > -1)).toBe(true);
		expect(order).toEqual([...order].sort((a, b) => a - b));
		expect(written).not.toContain('"color"');

		// And the whole document round-trips through the writer unchanged.
		const once = serializeDocument({
			format: 'tablify',
			version: 1,
			databaseId: DATABASE_ID,
			name: 'Test',
			tables: [
				{ id: TABLE_ID, name: 'Tasks', fields: [field], rows: [], views: [], unknown: [] },
			],
			unknown: [],
		});
		const again = parseDocument(once);
		expect(again.ok).toBe(true);
		if (again.ok) {
			expect(serializeDocument(again.document)).toBe(once);
		}
	});
});
