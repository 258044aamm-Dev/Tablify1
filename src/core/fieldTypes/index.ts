/**
 * The registration point for the shipped field types, and the only module anything else should import.
 *
 * **Adding a field type is one new file plus one line here.** The module registers itself when it is
 * evaluated, so the `export … from` line below *is* the registration — there is no separate `registerField`
 * call to add, no array to append to, and no order to respect. Order is irrelevant because nothing reads the
 * registry until the freeze at the bottom of this file, and a duplicate id is refused by `register()`.
 *
 * The sixteen types below are the ones in the mapping table of `docs/03`, which is the source of truth; the
 * count in `docs/06` is a convenience. Two ids in `FIELD_TYPE_IDS` are deliberately **not** here, because
 * neither is stored in a note: `createdTime` and `lastModifiedTime` are read from `file.ctime`/`file.mtime`
 * (P11), so `schema/propertySchema.ts` builds them as read-only descriptors of its own (its
 * `createFileTimeField`) instead of registering one here — the registry is "what a note can store".
 *
 * The registry is frozen on the last line: nothing can register after module init, and a late registration
 * fails loudly instead of half-working.
 */
// The order below is the order of the mapping table in `docs/03`, which is also the order a type picker
// lists them in; `tests/unit/field-contract.all.test.ts` asserts the registry matches it.
export { textField } from './text';
export { longTextField } from './longText';
export { numberField } from './number';
export { checkboxField } from './checkbox';
export { dateField } from './date';
export { datetimeField } from './datetime';
export { urlField } from './url';
export { emailField } from './email';
export { phoneField } from './phone';
export { singleSelectField } from './singleSelect';
export { multiSelectField } from './multiSelect';
export { ratingField } from './rating';
export { currencyField } from './currency';
export { percentField } from './percent';
export { durationField } from './duration';
export { attachmentField } from './attachment';

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
