/**
 * `parseViewPatch` — the reader for the `.base` sidecar's `tablifyViewConfig` (step 27).
 *
 * The property under test is **totality**: this function is handed a string out of a file the user owns, and a
 * sidecar that has been hand-edited, half-written, or written by an older build must not be able to stop a grid
 * from opening. Every case below is therefore as much about what is *dropped* as about what is read.
 *
 * `tests/unit/**` may not import `src/grid`, and does not need to: the patch type and this reader are core.
 */
import { describe, expect, it } from 'vitest';
import { isEmptyViewPatch, parseViewPatch } from '../../src/core/view/patch';

/** A patch with one of everything the sidebar can hold. */
const full = {
	search: 'shipping',
	sorts: [
		{ fieldId: 'note.Due', direction: 'asc' },
		{ fieldId: 'note.Name', direction: 'desc' },
	],
	groupBy: 'note.Status',
	collapsedKeys: ['Doing', ''],
	hiddenFieldIds: ['note.Secret'],
	columnOrder: ['note.Name', 'note.Due'],
};

describe('parseViewPatch reads a patch back', () => {
	it('round-trips exactly what the write path produced', () => {
		// The writer's side is `JSON.stringify(patch)` in `BasesSource`; this is that string, read back.
		expect(parseViewPatch(JSON.stringify(full))).toEqual(full);
	});

	it('accepts an already-parsed object, which is what a test hands it', () => {
		expect(parseViewPatch(full)).toEqual(full);
	});

	it('keeps an empty group key, which is the "no value" group rather than an absent setting', () => {
		// `''` is a real key in the pipeline (`EMPTY_GROUP_LABEL`), so a truthiness test would lose a collapse.
		expect(parseViewPatch({ collapsedKeys: [''] }).collapsedKeys).toEqual(['']);
	});

	it('reports an empty patch as empty, so the view can skip the store option entirely', () => {
		expect(isEmptyViewPatch(parseViewPatch(undefined))).toBe(true);
		expect(isEmptyViewPatch(parseViewPatch({}))).toBe(true);
		expect(isEmptyViewPatch(parseViewPatch(full))).toBe(false);
	});

	it('reads a patch with one key and leaves the rest absent rather than defaulting them', () => {
		// Absent means "leave it alone" in `ViewPatch`. Defaulting here would silently overrule the vault.
		const patch = parseViewPatch({ groupBy: 'note.Status' });
		expect(patch).toEqual({ groupBy: 'note.Status' });
		expect('hiddenFieldIds' in patch).toBe(false);
	});
});

describe('parseViewPatch cannot be broken by the file it reads', () => {
	it('answers an empty patch for every shape of nothing', () => {
		for (const nothing of [undefined, null, '', '   ', 0, false, [], 'null', '"a string"']) {
			expect(parseViewPatch(nothing)).toEqual({});
		}
	});

	it('survives truncated or mangled JSON, which is what a half-written sidecar looks like', () => {
		for (const broken of ['{', '{"search":', '{"search":"a"', 'not json at all', '{{}}']) {
			expect(parseViewPatch(broken)).toEqual({});
		}
	});

	it('drops a key whose type is wrong instead of coercing it', () => {
		// A string where a list belongs means "this setting did not survive", never a one-character list.
		expect(parseViewPatch({ collapsedKeys: 'Doing' })).toEqual({});
		expect(parseViewPatch({ groupBy: 7 })).toEqual({});
		expect(parseViewPatch({ search: { text: 'x' } })).toEqual({});
		expect(parseViewPatch({ columnOrder: null })).toEqual({});
	});

	it('drops the entries of a list that are not strings and keeps the ones that are', () => {
		expect(parseViewPatch({ hiddenFieldIds: ['note.A', 3, null, 'note.B'] })).toEqual({
			hiddenFieldIds: ['note.A', 'note.B'],
		});
	});

	it('drops a sort it cannot read, and keeps the sorts around it', () => {
		expect(
			parseViewPatch({
				sorts: [
					{ fieldId: 'note.Due', direction: 'asc' },
					{ fieldId: 'note.Name', direction: 'sideways' },
					{ fieldId: 42, direction: 'asc' },
					{ fieldId: 'note.Tag' },
					'note.Nope',
					null,
				],
			}),
		).toEqual({ sorts: [{ fieldId: 'note.Due', direction: 'asc' }] });
	});

	it("ignores every key it does not own, including a future build's", () => {
		expect(parseViewPatch({ ...full, somethingNew: 1, tablifyViewConfig: 'nested' })).toEqual(
			full,
		);
	});

	it('answers a fresh object every time, so two views cannot share one patch', () => {
		const first = parseViewPatch(full);
		const second = parseViewPatch(full);
		expect(first).not.toBe(second);
		expect(first.collapsedKeys).not.toBe(second.collapsedKeys);
	});
});
