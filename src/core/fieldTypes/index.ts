/**
 * The registration point for the shipped field types, and the only module anything else should import.
 *
 * **Adding a field type is one new file plus one line here.** The module registers itself when it is
 * evaluated, so the `export … from` line below *is* the registration — there is no separate `registerField`
 * call to add, no array to append to, and no order to respect. Order is irrelevant because nothing reads the
 * registry until the freeze at the bottom of this file, and a duplicate id is refused by `register()`.
 *
 * The registry is frozen on the last line: nothing can register after module init, and a late registration
 * fails loudly instead of half-working.
 */
export { textField } from './text';

import { freezeRegistry } from './registry';

freezeRegistry();

export {
	allFields,
	assertRegistryComplete,
	createFieldRegistry,
	defineField,
	FieldDefinitionError,
	fieldDefinitionProblems,
	freezeRegistry,
	getField,
	isRegistryFrozen,
	registerField,
} from './registry';
export type { AnyFieldDescriptor, FieldRegistry } from './registry';
