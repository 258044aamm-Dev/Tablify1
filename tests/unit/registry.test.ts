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
import { getField as lookupField } from '../../src/core/fieldTypes';
import { checkboxField } from '../../src/core/fieldTypes/checkbox';
import { textField } from '../../src/core/fieldTypes/text';
import { resolveField } from '../../src/core/schema/propertySchema';
import { DOCS_03_TYPES, NEVER_STORED_FIELD_IDS, makeContext } from './field-contract.suite';

const ctx = makeContext();

describe('the shipped registry', () => {
	it('is complete and frozen', () => {
		expect(() => assertRegistryComplete()).not.toThrow();
		expect(isRegistryFrozen()).toBe(true);
	});

	it('holds exactly the types this build ships, in the order docs/03 lists them', () => {
		// The comparison the step asks for: the registered set, in order, equals `docs/03`'s mapping table.
		// A missing type is then a failing test rather than a discovery made in production.
		expect(allFields().map((field) => field.id)).toEqual([...DOCS_03_TYPES]);
		expect(allFields()).toHaveLength(16);
		expect(getField('text')).toBe(textField);
		expect(getField('checkbox')).toBe(checkboxField);
	});

	it('refuses registration after freeze()', () => {
		expect(() => registerField(textField)).toThrow(FieldDefinitionError);
		expect(() => registerField(textField)).toThrow(/frozen/);
	});

	it('has no descriptor for the two file-metadata ids, which are resolved as read-only columns', () => {
		// The registry is "what a note can store"; these two are read from the file (P11) and built by
		// `schema/propertySchema.ts` instead, so they are deliberately absent here.
		for (const id of NEVER_STORED_FIELD_IDS) {
			expect(getField(id)).toBeUndefined();
		}
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
	it('resolves a known-but-unregistered type to text, with the reason recorded', () => {
		// Every id this build knows is registered now, so the branch is reached through a lookup that reports
		// `currency` as missing — which is exactly the state a partial build (or a future type) is in.
		const resolved = resolveField(
			{
				id: 'note.Status',
				name: 'Status',
				source: 'database',
				fieldOptions: { type: 'currency' },
			},
			ctx,
			(id) => (id === 'currency' ? undefined : lookupField(id)),
		);
		expect(resolved.descriptor.id).toBe('text');
		expect(resolved.readOnly).toBe(false);
		expect(resolved.reasons.join(' | ')).toContain(
			'"currency" is not implemented in this build',
		);
	});

	it('resolves a type name that does not exist at all to text, with a different reason', () => {
		const resolved = resolveField(
			{ id: 'note.Thing', name: 'Thing', source: 'database', fieldOptions: { type: 'wat' } },
			ctx,
		);
		expect(resolved.descriptor.id).toBe('text');
		expect(resolved.reasons.join(' | ')).toContain('unknown field type "wat"');
	});

	it('treats the auto-numbering type P11 dropped as unknown rather than resurrecting it', () => {
		const resolved = resolveField(
			{ id: 'note.N', name: 'N', source: 'database', fieldOptions: { type: 'autoNumber' } },
			ctx,
		);
		expect(resolved.descriptor.id).toBe('text');
		expect(resolved.reasons.join(' | ')).toContain('unknown field type "autoNumber"');
	});

	it('still resolves to something renderable when the lookup knows nothing at all', () => {
		const resolved = resolveField(
			{ id: 'note.X', name: 'X', source: 'database' },
			ctx,
			() => undefined,
		);
		expect(resolved.descriptor.id).toBe('text');
	});
});
