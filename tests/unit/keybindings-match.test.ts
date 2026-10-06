/**
 * The help table and the handler, held in step by **ids**.
 *
 * Two files describe one keyboard model: `src/plugin/help/keyBindings.ts` renders it for a person, and
 * `src/grid/keyboard/keyTable.ts` is the executable half that `handler.ts` answers to. Wording is allowed to
 * differ — "Arrow keys" and "Arrow keys (Shift to extend)" are the same binding, and a help table that had to
 * match a code table character for character would be neither readable nor maintainable. What may not differ is
 * the **set of actions**:
 *
 *   · every id in the handler's table exists in `KEY_BINDINGS`;
 *   · every id in `KEY_BINDINGS` is either in the handler's table or in `NON_KEYBOARD_BINDINGS`, with a reason
 *     attached to it in the same file a reader is looking at;
 *   · no id is in both (a binding cannot be "handled by the keyboard" and "a drag");
 *   · and every row of the handler's table is *executed* — its example event is fed to the real resolver and has
 *     to come back with that row's id, so the table cannot drift into a wish list.
 *
 * The last assertion is the one that earns this file its place. Without it, `KEY_TABLE` would be a second list of
 * intentions that a deleted `switch` case would leave untouched and green.
 */
import { describe, expect, it } from 'vitest';

import { KEY_BINDINGS, NON_KEYBOARD_BINDINGS } from '../../src/plugin/help/keyBindings';
import { resolveKey } from '../../src/grid/keyboard/handler';
import { KEY_TABLE } from '../../src/grid/keyboard/keyTable';

/** Plain strings on purpose: this file compares *sets of names* across two modules that do not share a type. */
const helpIds: readonly string[] = KEY_BINDINGS.map((binding) => binding.id);
const tableIds: readonly string[] = [...new Set(KEY_TABLE.map((row) => row.id))];
const gestureIds: readonly string[] = NON_KEYBOARD_BINDINGS.map((entry) => entry.id);

describe('the two keyboard tables', () => {
	it(`describes the same ${String(helpIds.length)} actions (${String(tableIds.length)} key rows + ${String(gestureIds.length)} gestures)`, () => {
		expect(helpIds.length).toBe(tableIds.length + gestureIds.length);
		expect(new Set(helpIds).size).toBe(helpIds.length);
		expect(new Set([...tableIds, ...gestureIds])).toEqual(new Set(helpIds));
	});

	it('has one stable id per binding in the help table', () => {
		for (const binding of KEY_BINDINGS) {
			expect(binding.id).toMatch(/^[a-z][a-z-]*$/);
			expect(binding.keys.trim()).not.toBe('');
			expect(binding.description.trim()).not.toBe('');
		}
	});

	it('keeps every non-keyboard binding out of the key table, and gives it a reason', () => {
		for (const entry of NON_KEYBOARD_BINDINGS) {
			expect(tableIds).not.toContain(entry.id);
			expect(helpIds).toContain(entry.id);
			expect(entry.reason.length).toBeGreaterThan(20);
		}
	});

	it('covers every binding the help table promises with either a key row or a reason', () => {
		expect(helpIds.filter((id) => !tableIds.includes(id) && !gestureIds.includes(id))).toEqual(
			[],
		);
	});

	for (const row of KEY_TABLE) {
		it(`${String(row.id)}: ${row.keys} — the example event really resolves to it`, () => {
			const intent = resolveKey(
				row.example,
				row.context ?? { editing: false, checkbox: false, pageRows: 12 },
			);
			expect(intent?.id).toBe(row.id);
		});
	}
});
