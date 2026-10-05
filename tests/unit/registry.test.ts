/**
 * The registry's own rules: it is complete, it refuses duplicates, it freezes, and an unknown type name
 * from a hand-edited `.base` file resolves to `text` **with a reason** rather than throwing.
 *
 * Importing `src/core/fieldTypes` is what registers the shipped types — that import is the test's stand-in
 * for the plugin's module graph, and the assertions below are about the shipped registry, not a copy.
 */
import { describe, expect, it } from 'vitest';
import {
	allFields,
	assertRegistryComplete,
	createFieldRegistry,
	defineField,
	FieldDefinitionError,
	getField,
	isRegistryFrozen,
	registerField,
} from '../../src/core/fieldTypes';
import { textField } from '../../src/core/fieldTypes/text';
import { resolveField } from '../../src/core/schema/propertySchema';
import { makeContext } from './field-contract.suite';

const ctx = makeContext();

describe('the shipped registry', () => {
	it('is complete and frozen', () => {
		expect(() => assertRegistryComplete()).not.toThrow();
		expect(isRegistryFrozen()).toBe(true);
	});

	it('holds exactly the types this build ships', () => {
		expect(allFields().map((field) => field.id)).toEqual(['text']);
		expect(getField('text')).toBe(textField);
	});

	it('refuses registration after freeze()', () => {
		expect(() => registerField(textField)).toThrow(FieldDefinitionError);
		expect(() => registerField(textField)).toThrow(/frozen/);
	});

	it('has no descriptor for a type that is not registered yet', () => {
		expect(getField('currency')).toBeUndefined();
		expect(getField('checkbox')).toBeUndefined();
	});
});

describe('a registry a test owns', () => {
	it('accepts a descriptor, returns it by id, and lists it', () => {
		const registry = createFieldRegistry();
		registry.register(textField);
		expect(registry.get('text')).toBe(textField);
		expect(registry.all()).toHaveLength(1);
	});

	it('refuses the same id twice, naming it', () => {
		const registry = createFieldRegistry();
		registry.register(textField);
		expect(() => registry.register(textField)).toThrow(/"text" is already registered/);
	});

	it('refuses a second registration once frozen', () => {
		const registry = createFieldRegistry();
		registry.freeze();
		expect(registry.isFrozen()).toBe(true);
		expect(() => registry.register(textField)).toThrow(/cannot be registered after freeze/);
	});

	it('is not frozen until it is told to be', () => {
		expect(createFieldRegistry().isFrozen()).toBe(false);
	});

	it('refuses a registry that was never frozen, and passes an empty frozen one', () => {
		expect(() => assertRegistryComplete(createFieldRegistry())).toThrow(/not frozen/);
		const empty = createFieldRegistry();
		empty.freeze();
		expect(() => assertRegistryComplete(empty)).not.toThrow();
	});
});

describe('defineField', () => {
	it('returns the descriptor and freezes it', () => {
		const defined = defineField(textField);
		expect(Object.isFrozen(defined)).toBe(true);
	});

	it('rejects an incomplete definition, listing every problem at once', () => {
		let problems: readonly string[] = [];
		try {
			defineField({ ...textField, label: '', icon: '', filterOps: [] });
		} catch (error) {
			expect(error).toBeInstanceOf(FieldDefinitionError);
			if (error instanceof FieldDefinitionError) {
				problems = error.problems;
			}
		}
		expect(problems).toContain('label is empty');
		expect(problems).toContain('icon is empty');
		expect(problems).toContain(
			'filterOps is empty: a column with no operators cannot be filtered',
		);
	});

	it('rejects a duplicated operator in filterOps', () => {
		expect(() => defineField({ ...textField, filterOps: ['is', 'is'] })).toThrow(/"is" twice/);
	});
});

describe('the fallback path', () => {
	it('resolves a type this build does not implement to text, with the reason recorded', () => {
		const resolved = resolveField(
			{
				id: 'note.Status',
				name: 'Status',
				source: 'note',
				fieldOptions: { type: 'currency' },
			},
			ctx,
		);
		expect(resolved.descriptor.id).toBe('text');
		expect(resolved.readOnly).toBe(false);
		expect(resolved.reasons.join(' | ')).toContain(
			'"currency" is not implemented in this build',
		);
	});

	it('resolves a type name that does not exist at all to text, with a different reason', () => {
		const resolved = resolveField(
			{ id: 'note.Thing', name: 'Thing', source: 'note', fieldOptions: { type: 'wat' } },
			ctx,
		);
		expect(resolved.descriptor.id).toBe('text');
		expect(resolved.reasons.join(' | ')).toContain('unknown field type "wat"');
	});

	it('treats the auto-numbering type P11 dropped as unknown rather than resurrecting it', () => {
		const resolved = resolveField(
			{ id: 'note.N', name: 'N', source: 'note', fieldOptions: { type: 'autoNumber' } },
			ctx,
		);
		expect(resolved.descriptor.id).toBe('text');
		expect(resolved.reasons.join(' | ')).toContain('unknown field type "autoNumber"');
	});

	it('still resolves to something renderable when the lookup knows nothing at all', () => {
		const resolved = resolveField(
			{ id: 'note.X', name: 'X', source: 'note' },
			ctx,
			() => undefined,
		);
		expect(resolved.descriptor.id).toBe('text');
	});
});
