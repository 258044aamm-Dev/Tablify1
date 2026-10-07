/**
 * The schema layer's three jobs: validating untrusted `fieldOptions` (never throwing, always explaining),
 * resolving the two file-metadata columns that P11 made read-only, and deciding what descriptor a column
 * gets when its declared type is missing or unknown.
 */
import { describe, expect, it } from 'vitest';
import {
	createdTimeField,
	fieldContextFor,
	lastModifiedTimeField,
	propertyFromBasesId,
	resolveField,
	validateFieldOptions,
} from '../../src/core/schema/propertySchema';
import { makeContext } from './field-contract.suite';

const ctx = makeContext();
const INSTANT = '2025-09-24T06:26:40.000Z';
const INSTANT_MS = Date.parse(INSTANT);

describe('propertyFromBasesId', () => {
	it('reads the source from the prefix', () => {
		expect(propertyFromBasesId('note.Status')).toEqual({
			id: 'note.Status',
			name: 'Status',
			source: 'note',
		});
		expect(propertyFromBasesId('file.name')).toEqual({
			id: 'file.name',
			name: 'name',
			source: 'file',
		});
		expect(propertyFromBasesId('formula.Total')).toEqual({
			id: 'formula.Total',
			name: 'Total',
			source: 'formula',
		});
	});

	it('treats a bare name as a note property', () => {
		expect(propertyFromBasesId('Status').source).toBe('note');
		expect(propertyFromBasesId('Status').name).toBe('Status');
	});

	it('keeps an unrecognised prefix whole and marks it unknown, rather than guessing a name', () => {
		expect(propertyFromBasesId('weird.thing')).toEqual({
			id: 'weird.thing',
			name: 'weird.thing',
			source: 'unknown',
		});
	});
});

describe('validateFieldOptions', () => {
	it('accepts an absent entry silently: a column with no options is normal', () => {
		expect(validateFieldOptions(undefined)).toEqual({ options: {}, reasons: [] });
		expect(validateFieldOptions(null)).toEqual({ options: {}, reasons: [] });
	});

	it('ignores a non-object entry with a reason', () => {
		const result = validateFieldOptions(['nope']);
		expect(result.options).toEqual({});
		expect(result.reasons).toEqual(['fieldOptions must be an object — ignored']);
	});

	it('keeps the known keys and reports every unknown one', () => {
		const result = validateFieldOptions({
			type: 'currency',
			symbol: '$',
			precision: 2,
			wat: 1,
			alsoWrong: true,
		});
		expect(result.options).toEqual({ type: 'currency', symbol: '$', precision: 2 });
		expect(result.reasons).toEqual([
			'unknown field option "wat" — ignored',
			'unknown field option "alsoWrong" — ignored',
		]);
	});

	it('requires max to be a positive integer', () => {
		expect(validateFieldOptions({ max: 5 }).options.max).toBe(5);
		for (const bad of [0, -1, 2.5, '5', null, Number.NaN]) {
			const result = validateFieldOptions({ max: bad });
			expect(
				result.options.max,
				`max ${JSON.stringify(bad)} must be dropped`,
			).toBeUndefined();
			expect(result.reasons.join(' ')).toContain('max must be an integer of at least 1');
		}
	});

	it('requires precision to be a non-negative integer', () => {
		expect(validateFieldOptions({ precision: 0 }).options.precision).toBe(0);
		expect(validateFieldOptions({ precision: -1 }).options.precision).toBeUndefined();
		expect(validateFieldOptions({ precision: -1 }).reasons.join(' ')).toContain(
			'precision must be an integer',
		);
	});

	it('keeps select options with unique labels and drops the duplicates', () => {
		const result = validateFieldOptions({
			type: 'singleSelect',
			options: [
				{ id: 'o1', name: 'Todo', color: 'gray' },
				{ name: 'Doing' },
				{ name: 'todo' },
			],
		});
		expect(result.options.options).toEqual([
			{ id: 'o1', name: 'Todo', color: 'gray' },
			{ id: 'o2', name: 'Doing' },
		]);
		expect(result.reasons).toEqual(['select option "todo" is a duplicate label — ignored']);
	});

	it('drops a nameless or non-object option, and derives a missing id', () => {
		const result = validateFieldOptions({
			options: [{ name: '  ' }, 'nope', { name: 'Fine', id: '', color: '' }],
		});
		expect(result.options.options).toEqual([{ id: 'o3', name: 'Fine' }]);
		expect(result.reasons).toEqual([
			'select option 0 has no name — ignored',
			'select option 1 is not an object — ignored',
		]);
	});

	it('refuses an options value that is not an array', () => {
		expect(validateFieldOptions({ options: 'Todo, Doing' }).reasons).toEqual([
			'options must be an array — ignored',
		]);
	});

	it('checks a non-empty symbol and a known duration unit', () => {
		expect(validateFieldOptions({ symbol: '' }).reasons).toEqual([
			'symbol must be a non-empty string — ignored',
		]);
		expect(validateFieldOptions({ unit: 'fortnights' }).reasons).toEqual([
			'unit must be one of seconds, minutes, hours — ignored',
		]);
		expect(validateFieldOptions({ unit: 'minutes' }).options.unit).toBe('minutes');
	});

	it('refuses a type that is not a non-empty string, while keeping a declared one', () => {
		expect(validateFieldOptions({ type: 7 }).reasons).toEqual([
			'type must be a non-empty string — ignored',
		]);
		expect(validateFieldOptions({ type: '' }).options.type).toBeUndefined();
		expect(validateFieldOptions({ type: 'rating' }).options.type).toBe('rating');
	});

	it('never throws, whatever it is handed', () => {
		for (const hostile of [
			0,
			'',
			true,
			() => 1,
			Symbol('x'),
			new Date(),
			{ nested: { deep: [1] } },
		]) {
			expect(() => validateFieldOptions(hostile)).not.toThrow();
		}
	});
});

describe('the file-metadata columns P11 made read-only', () => {
	it('resolves file.ctime to the created-time column, with the reason recorded', () => {
		const resolved = resolveField(propertyFromBasesId('file.ctime'), ctx);
		expect(resolved.descriptor).toBe(createdTimeField);
		expect(resolved.readOnly).toBe(true);
		expect(resolved.reasons.join(' | ')).toContain('read-only: the value is file metadata');
	});

	it('resolves file.mtime, and the legacy note properties, to the same columns', () => {
		expect(resolveField(propertyFromBasesId('file.mtime'), ctx).descriptor).toBe(
			lastModifiedTimeField,
		);
		expect(
			resolveField({ id: 'note.createdTime', name: 'createdTime', source: 'note' }, ctx)
				.descriptor,
		).toBe(createdTimeField);
		expect(
			resolveField(
				{ id: 'note.lastModifiedTime', name: 'lastModifiedTime', source: 'note' },
				ctx,
			).descriptor,
		).toBe(lastModifiedTimeField);
	});

	it('does not claim a note property named "Created": that is a value the user typed', () => {
		const resolved = resolveField({ id: 'note.Created', name: 'Created', source: 'note' }, ctx);
		expect(resolved.descriptor.id).toBe('text');
		expect(resolved.readOnly).toBe(false);
		expect(resolved.reasons.join(' | ')).toContain('no field type declared');
	});

	it('accepts an ISO string and epoch milliseconds, and canonicalises both to ISO', () => {
		expect(createdTimeField.parse(INSTANT, ctx)).toEqual({ ok: true, value: INSTANT });
		expect(createdTimeField.parse(INSTANT_MS, ctx)).toEqual({ ok: true, value: INSTANT });
		expect(createdTimeField.parse('', ctx)).toEqual({ ok: true, value: null });
	});

	it('refuses nonsense with the input attached', () => {
		const result = createdTimeField.parse('the day before yesterday', ctx);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('Created time expects an ISO date string');
			expect(result.raw).toBe('the day before yesterday');
		}
	});

	it('renders in the context locale and timezone, and groups by local day', () => {
		expect(createdTimeField.formatDisplay(INSTANT, ctx)).toBe('24 Sept 2025, 06:26');
		expect(createdTimeField.formatPlain(INSTANT, ctx)).toBe('2025-09-24 06:26');
		expect(createdTimeField.groupKey(INSTANT, ctx)).toBe('2025-09-24');
		expect(createdTimeField.groupKey(null, ctx)).toBe('');
	});

	it('renders the same instant differently in another timezone', () => {
		const dhaka = makeContext({ timezone: 'Asia/Dhaka' });
		expect(createdTimeField.formatDisplay(INSTANT, dhaka)).toBe('24 Sept 2025, 12:26');
		expect(createdTimeField.groupKey(INSTANT, dhaka)).toBe('2025-09-24');
		// 20:00 in Tokyo is still the 24th; 20:00 in UTC is the same instant, one day earlier in Tokyo.
		const tokyo = makeContext({ timezone: 'Asia/Tokyo' });
		expect(lastModifiedTimeField.formatDisplay('2025-09-24T20:00:00.000Z', tokyo)).toBe(
			'25 Sept 2025, 05:00',
		);
	});

	it('writes nothing, and says so by being uneditable', () => {
		expect(createdTimeField.editable).toBe(false);
		expect(createdTimeField.editor).toBe('readonly');
		expect(createdTimeField.toJson(INSTANT, ctx)).toBeNull();
		expect(createdTimeField.defaultValue).toBeNull();
	});

	it('parses a pasted date in the plain form as well as ISO', () => {
		expect(createdTimeField.parsePlain('2025-09-24 06:26', ctx)).toEqual({
			ok: true,
			value: '2025-09-24T06:26:00.000Z',
		});
		expect(createdTimeField.parsePlain('   ', ctx)).toEqual({ ok: true, value: null });
		expect(createdTimeField.parsePlain('sometime', ctx).ok).toBe(false);
	});

	it('compares instants, sorts the absent value last, and filters on time', () => {
		const earlier = '2025-09-24T06:00:00.000Z';
		expect(createdTimeField.compare(earlier, INSTANT, ctx)).toBeLessThan(0);
		expect(createdTimeField.compare(INSTANT, earlier, ctx)).toBeGreaterThan(0);
		expect(createdTimeField.compare(null, earlier, ctx)).toBe(1);
		expect(createdTimeField.compare(null, null, ctx)).toBe(0);
		// A value that cannot be read as a date sorts with the absent ones: last, and deterministically.
		expect(createdTimeField.compare('not a date', earlier, ctx)).toBe(1);
		expect(createdTimeField.compare(earlier, 'not a date', ctx)).toBe(-1);
		expect(createdTimeField.matches(INSTANT, 'gt', earlier, ctx)).toBe(true);
		expect(createdTimeField.matches(INSTANT, 'lte', earlier, ctx)).toBe(false);
		expect(createdTimeField.matches(INSTANT, 'is', INSTANT_MS, ctx)).toBe(true);
		expect(createdTimeField.matches(INSTANT, 'is', '2025-09-25', ctx)).toBe(false);
		expect(createdTimeField.matches(null, 'isEmpty', undefined, ctx)).toBe(true);
		expect(createdTimeField.matches(INSTANT, 'isNotEmpty', undefined, ctx)).toBe(true);
		expect(createdTimeField.matches(INSTANT, 'contains', 'Sept', ctx)).toBe(false);
		// A comparison against an operand that is not a date is false, not a throw and not a guess.
		expect(createdTimeField.matches(INSTANT, 'gte', 'soon', ctx)).toBe(false);
		expect(createdTimeField.matches(INSTANT, 'lt', undefined, ctx)).toBe(false);
	});
});

describe('resolveField, source by source', () => {
	it('leaves a note column editable', () => {
		const resolved = resolveField(
			{ id: 'note.Notes', name: 'Notes', source: 'note', fieldOptions: { type: 'text' } },
			ctx,
		);
		expect(resolved.descriptor.id).toBe('text');
		expect(resolved.readOnly).toBe(false);
		expect(resolved.reasons).toEqual([]);
	});

	it('marks a file and a formula column read-only, whatever type it resolves to', () => {
		for (const [id, source] of [
			['file.name', 'file'],
			['formula.Total', 'formula'],
		] as const) {
			const resolved = resolveField({ id, name: id.slice(id.indexOf('.') + 1), source }, ctx);
			expect(resolved.readOnly, `${id} must be read-only`).toBe(true);
			expect(resolved.reasons.join(' | '), `${id} must say why`).toContain(
				'not writable from the grid',
			);
		}
	});

	it('marks an unmapped property read-only, since nothing knows how to write it', () => {
		const resolved = resolveField(propertyFromBasesId('weird.thing'), ctx);
		expect(resolved.readOnly).toBe(true);
		expect(resolved.reasons.join(' ')).toContain(
			'unknown properties are not writable from the grid',
		);
	});

	it('carries the validated options and the column name into the descriptor context', () => {
		const resolved = resolveField(
			{
				id: 'note.Notes',
				name: 'Notes',
				source: 'note',
				fieldOptions: { type: 'text', max: 5, wat: true },
			},
			ctx,
		);
		expect(resolved.options).toEqual({ type: 'text', max: 5 });
		expect(resolved.context.columnName).toBe('Notes');
		expect(resolved.context.fieldOptions).toEqual({ type: 'text', max: 5 });
		expect(resolved.context.locale).toBe(ctx.locale);
		expect(resolved.reasons).toEqual(['unknown field option "wat" — ignored']);
	});
});

describe('fieldContextFor', () => {
	it('replaces the column name and options and keeps everything else', () => {
		const property = propertyFromBasesId('note.Status');
		const context = fieldContextFor(property, ctx, { max: 3 });
		expect(context.columnName).toBe('Status');
		expect(context.fieldOptions).toEqual({ max: 3 });
		expect(context.timezone).toBe(ctx.timezone);
		expect(context.now()).toBe(ctx.now());
	});
});
