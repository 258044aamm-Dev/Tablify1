/**
 * Clearing: **which types write something, and which delete the key** — asserted over the frozen registry.
 *
 * `docs/03` §Frontmatter write rules 3 is one sentence — *\"Clearing deletes the key rather than writing
 * `\"\"`/`null`\"* — and the step-22 prompt asks for the same claim as a table: clearing deletes keys for every type
 * that stores nothing for an empty value, and writes the empty representation only where the type requires one.
 *
 * The measured answer is *all sixteen delete, none writes*, and the reason it is a table with one row is worth
 * stating here rather than in prose: the clear path carries a canonical `null` (`core/ops/apply.ts` §`clearCells`),
 * each descriptor's `toJson` is the identity, and the write queue turns a `null` value into `delete
 * frontmatter[key]` (`src/adapters/writeQueue.ts` §`mutateWith`). The three types that could plausibly have
 * needed a representation — `checkbox` → `false`, `multiSelect` → `[]`, `rating` → `0` — all render an absent key
 * as exactly the state a cleared cell means (unchecked, empty list, no stars).
 *
 * **This file is the guard, not the documentation.** The invariant is `toJson(null) === null` for every
 * registered descriptor, and the escape hatch is deliberate: a new field type that *does* require a value on
 * clear fails the first test with its own id in the message, and the fix is to teach the clear path about it —
 * rather than to loosen the test. The second test asserts the other half of the same contract, which is what a
 * paste of an empty cell relies on: `parsePlain('')` is the empty canonical value for every type, too.
 */
import { describe, expect, it } from 'vitest';

import { allFields, isRegistryFrozen } from '../../src/core/fieldTypes/registry';
import type { FieldContext } from '../../src/core/types';
// Importing the barrel is what registers the sixteen types; without it `allFields()` is empty and every
// assertion below would pass vacuously.
import '../../src/core/fieldTypes/index';

/** A context for the calls: the descriptors that need one read only these fields (the fixture's own shape). */
const CONTEXT: FieldContext = {
	now: () => Date.UTC(2026, 9, 6),
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
	columnName: '',
};

/** The types that could plausibly have needed a representation on clear, and the value they would have used. */
const WOULD_HAVE_WRITTEN: Readonly<Record<string, unknown>> = {
	checkbox: false,
	multiSelect: [],
	rating: 0,
};

describe('clearing a cell', () => {
	it('registers sixteen types and is frozen, so this table cannot be half-populated', () => {
		expect(isRegistryFrozen()).toBe(true);
		expect(allFields().length).toBe(16);
	});

	it('deletes the key for every registered type: `toJson(null)` is `null`', () => {
		for (const field of allFields()) {
			expect(
				field.toJson(null, CONTEXT),
				`${field.id}: a cleared cell must delete the key, so its write form of null must be null`,
			).toBeNull();
		}
	});

	it('names the three that would have written a representation, and shows they do not', () => {
		for (const [id, representation] of Object.entries(WOULD_HAVE_WRITTEN)) {
			const field = allFields().find((candidate) => candidate.id === id);
			expect(field, `${id} is in the registry`).toBeDefined();
			expect(field?.toJson(null, CONTEXT)).not.toEqual(representation);
			expect(field?.toJson(null, CONTEXT)).toBeNull();
		}
	});

	it('reads an empty cell as the empty value for every type', () => {
		for (const field of allFields()) {
			const parsed = field.parsePlain('', CONTEXT);
			expect(parsed.ok, `${field.id}: an empty cell must be readable`).toBe(true);
			expect(
				parsed.ok ? parsed.value : 'unreadable',
				`${field.id}: empty is the empty value`,
			).toBeNull();
		}
	});

	it('keeps the invariant in the type that stores the most: `multiSelect` never stores `[]`', () => {
		// `[]` and `null` would both render as an empty cell and would be two different canonical values, which is
		// the shape the contract suite bans; the clear path is one of the places that could have introduced it.
		const multi = allFields().find((field) => field.id === 'multiSelect');
		const parsed = multi?.parsePlain('', CONTEXT);
		expect(parsed?.ok === true ? parsed.value : 'unreadable').toBeNull();
	});
});
