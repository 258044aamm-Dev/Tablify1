/**
 * The field-type registry: the only dispatch point in the codebase for "what does this type do".
 *
 * The old build branched on `field.type` in about eighteen places across five modules, so every new type
 * meant touching all of them. Here a type is one file that registers itself, and every caller asks the
 * registry. Registration is explicit and additive: adding a type touches exactly one new file plus one
 * import line in `index.ts`, and nothing else — proven by `git diff --stat` in the step-06 report.
 *
 * The registry is a `Map`, frozen in production by `freezeRegistry()` after `index.ts` has registered the
 * shipped types. Tests build their own registries with `createFieldRegistry()`, which is why the mutable
 * operations are methods on an object rather than free functions over a module-level map.
 */
import type { CellValue, FieldDescriptor, FieldTypeId } from '../types';

/** The registry's view of a descriptor: the type parameter is erased, methods stay bivariant. */
export type AnyFieldDescriptor = FieldDescriptor;

/** Why a definition was rejected. A thrown `FieldDefinitionError` carries the whole list. */
export class FieldDefinitionError extends Error {
	readonly problems: readonly string[];

	constructor(problems: readonly string[]) {
		super(`invalid field definition: ${problems.join('; ')}`);
		this.name = 'FieldDefinitionError';
		this.problems = problems;
	}
}

/** A registry of field descriptors. Mutable until `freeze()`; duplicated ids are always refused. */
export interface FieldRegistry {
	/** Adds a descriptor. Throws on a duplicate id, a frozen registry, or an incomplete definition. */
	register(field: FieldDescriptor): void;
	/** The descriptor for an id, or `undefined` — callers fall back rather than throwing. */
	get(id: FieldTypeId): FieldDescriptor | undefined;
	/** Every registered descriptor, in registration order. */
	all(): readonly FieldDescriptor[];
	/** Refuses every later `register`. Called once by `index.ts`, after the shipped types. */
	freeze(): void;
	/** Whether `freeze()` has run. */
	isFrozen(): boolean;
}

/**
 * Structural problems in a descriptor, as sentences. Empty means the definition is usable.
 *
 * No emptiness check on `id`: `FieldTypeId` is a closed union of non-empty literals, so an empty id
 * cannot be typed into a descriptor in the first place.
 */
export function fieldDefinitionProblems<TValue extends CellValue>(
	field: FieldDescriptor<TValue>,
): readonly string[] {
	const problems: string[] = [];
	if (field.label === '') {
		problems.push('label is empty');
	}
	if (field.icon === '') {
		problems.push('icon is empty');
	}
	const methods = [
		'parse',
		'toYaml',
		'formatDisplay',
		'formatPlain',
		'parsePlain',
		'matches',
		'compare',
		'groupKey',
	] as const;
	for (const name of methods) {
		if (typeof field[name] !== 'function') {
			problems.push(`${name}() is missing`);
		}
	}
	if (field.filterOps.length === 0) {
		problems.push('filterOps is empty: a column with no operators cannot be filtered');
	}
	const seen = new Set<string>();
	for (const op of field.filterOps) {
		if (seen.has(op)) {
			problems.push(`filterOps lists "${op}" twice`);
		}
		seen.add(op);
	}
	return problems;
}

/**
 * Checks a descriptor and freezes it, so a registered type cannot be mutated at runtime.
 *
 * Throws `FieldDefinitionError` on a bad definition: this is a programming mistake, not user data, and a
 * malformed descriptor would fail somewhere far away from its cause. User data never reaches this
 * function — untrusted input goes to `parse`, which returns a tagged error instead.
 */
export function defineField<TValue extends CellValue>(
	field: FieldDescriptor<TValue>,
): FieldDescriptor<TValue> {
	const problems = fieldDefinitionProblems(field);
	if (problems.length > 0) {
		throw new FieldDefinitionError(problems);
	}
	return Object.freeze(field);
}

/** Builds an empty registry. Production uses {@link registry}; tests use this for a clean slate. */
export function createFieldRegistry(): FieldRegistry {
	const fields = new Map<FieldTypeId, FieldDescriptor>();
	let frozen = false;

	return {
		register(field) {
			if (frozen) {
				throw new FieldDefinitionError([
					`the registry is frozen: "${field.id}" cannot be registered after freeze()`,
				]);
			}
			const defined = defineField(field);
			if (fields.has(defined.id)) {
				throw new FieldDefinitionError([`"${defined.id}" is already registered`]);
			}
			fields.set(defined.id, defined);
		},
		get: (id) => fields.get(id),
		all: () => [...fields.values()],
		freeze() {
			frozen = true;
		},
		isFrozen: () => frozen,
	};
}

/** The registry the plugin uses. Populated by the imports in `src/core/fieldTypes/index.ts`. */
export const registry: FieldRegistry = createFieldRegistry();

/** Registers a descriptor in the shipped registry. Called at module init, never after `freezeRegistry()`. */
export function registerField(field: FieldDescriptor): void {
	registry.register(field);
}

/** The descriptor for an id, or `undefined`. Callers must handle the fallback; see `resolveField`. */
export function getField(id: FieldTypeId): FieldDescriptor | undefined {
	return registry.get(id);
}

/** Every registered descriptor, in registration order. */
export function allFields(): readonly FieldDescriptor[] {
	return registry.all();
}

/** Refuses further registration. Called by `index.ts` once every shipped type has registered itself. */
export function freezeRegistry(): void {
	registry.freeze();
}

/** Whether the shipped registry is frozen. */
export function isRegistryFrozen(): boolean {
	return registry.isFrozen();
}

/**
 * Asserts that every *registered* descriptor is complete and usable, that ids are unique, and that the
 * registry was frozen.
 *
 * "Complete" is structural — the deep behaviour is the shared contract suite's job
 * (`tests/unit/field-contract.suite.ts`). Ids listed in `FIELD_TYPE_IDS` with no descriptor are not a
 * failure: that is just a type this build has not implemented yet, which is why step 07 can point the
 * suite at the registry as it grows. `target` exists so the assertion itself is testable.
 */
export function assertRegistryComplete(target: FieldRegistry = registry): void {
	const problems: string[] = [];
	for (const field of target.all()) {
		problems.push(
			...fieldDefinitionProblems(field).map((problem) => `${field.id}: ${problem}`),
		);
	}
	const ids = target.all().map((field) => field.id);
	const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
	for (const id of new Set(duplicates)) {
		problems.push(`${id}: registered more than once`);
	}
	if (!target.isFrozen()) {
		problems.push(
			'the registry is not frozen: register every type in index.ts, then freezeRegistry()',
		);
	}
	if (problems.length > 0) {
		throw new FieldDefinitionError(problems);
	}
}
