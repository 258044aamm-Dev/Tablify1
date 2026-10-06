/**
 * The edit session, as a state machine: no React, no DOM, no store.
 *
 * This file exists because the interesting failures of cell editing are *state* failures, not rendering ones:
 *
 *  · a commit that fails must leave the editor open with the draft intact (a value silently lost is the worst
 *    bug this grid can have);
 *  · opening a second cell must not throw away what was typed in the first (`docs/01` §Core interaction model
 *    makes leaving a cell a commit — *Enter: edit the cell; committing moves down one row*);
 *  · `Escape` must close a nested option list **before** it closes the editor;
 *  · nothing may write per keystroke — `update()` is the only thing a keystroke does.
 *
 * `parse` and `commit` are injected, so each test states its own story explicitly rather than reaching into a
 * field registry: the point here is the machine, and `tests/dom/editors.test.tsx` is where the same machine
 * meets the real descriptors.
 */
import { describe, expect, it, vi } from 'vitest';

import { createEditSession } from '../../src/grid/editSession';
import type { CommitResult, EditSession } from '../../src/grid/editSession';
import type { CellRef } from '../../src/core/ops/types';

const A: CellRef = { filePath: 'Notes/A.md', fieldId: 'note.Name' };
const B: CellRef = { filePath: 'Notes/B.md', fieldId: 'note.Status' };

/** A session whose collaborators are spies a test can inspect. */
function harness(options?: {
	readonly parse?: (ref: CellRef, draft: string) => CommitResult & { readonly value?: unknown };
	readonly commit?: (ref: CellRef, value: unknown) => CommitResult;
	readonly onFinish?: (ref: CellRef | null) => void;
}) {
	const writes: { ref: CellRef; value: unknown }[] = [];
	const active: (CellRef | null)[] = [];
	const session: EditSession = createEditSession({
		commit: (ref, value) => {
			const result = options?.commit?.(ref, value) ?? { ok: true };
			if (result.ok) {
				writes.push({ ref, value });
			}
			return result;
		},
		...(options?.parse === undefined ? {} : { parse: options.parse }),
		onActiveChange: (ref) => {
			active.push(ref);
		},
		...(options?.onFinish === undefined ? {} : { onFinish: options.onFinish }),
	});
	return { session, writes, active };
}

describe('editSession — the shape of an edit', () => {
	it('starts idle, opens, and reports the draft it was seeded with', () => {
		const { session } = harness();
		expect(session.get().status).toBe('idle');
		expect(session.get().ref).toBeNull();

		session.open(A, 'Row 1');
		expect(session.get().status).toBe('editing');
		expect(session.get().ref).toEqual(A);
		expect(session.get().draft).toBe('Row 1');
	});

	it('writes nothing for a keystroke: `update` only replaces the draft', () => {
		const { session, writes } = harness();
		session.open(A, '');
		for (const text of ['R', 'Ro', 'Row']) {
			session.update(text);
		}
		expect(writes).toHaveLength(0);
		expect(session.get().draft).toBe('Row');
	});

	it('commits once, with the parsed value, and ends the edit', () => {
		const parse = vi.fn((_ref: CellRef, draft: string) => ({
			ok: true as const,
			value: draft.length,
		}));
		const { session, writes, active } = harness({ parse });

		session.open(A, '1234');
		session.commit();

		expect(parse).toHaveBeenCalledTimes(1);
		expect(writes).toEqual([{ ref: A, value: 4 }]);
		expect(session.get().status).toBe('idle');
		// The mirror the cells subscribe to is told both times: which cell, then none.
		expect(active).toEqual([A, null]);
	});

	it('cancels without a write, from a state the store never had to change', () => {
		const { session, writes } = harness();
		session.open(A, 'typed but abandoned');
		session.cancel();

		expect(writes).toHaveLength(0);
		expect(session.get().status).toBe('idle');
		// Nothing was written, so nothing needs restoring: the store still holds the old value because it was
		// never told anything.
		expect(session.get().draft).toBe('');
	});

	it('cancels an idle session as a no-op rather than throwing', () => {
		const { session } = harness();
		expect(() => {
			session.cancel();
		}).not.toThrow();
		expect(session.get().status).toBe('idle');
	});
});

describe('editSession — failures keep the value', () => {
	it('keeps the editor open, the draft and the error when the parse refuses', () => {
		const { session, writes } = harness({
			parse: () => ({ ok: false, reason: 'a number is expected here' }),
		});
		session.open(A, '12 apples');
		const result = session.commit();

		expect(result).toEqual({ ok: false, reason: 'a number is expected here' });
		expect(writes).toHaveLength(0);
		expect(session.get().status).toBe('editing');
		expect(session.get().draft).toBe('12 apples');
		expect(session.get().error).toBe('a number is expected here');
	});

	it('keeps the editor open, the draft and the error when the write fails', () => {
		const { session, writes } = harness({
			parse: (_ref, draft) => ({ ok: true, value: draft }),
			commit: () => ({ ok: false, reason: 'the row "Notes/A.md" is not in this view' }),
		});
		session.open(A, 'Row 1');
		session.commit();

		expect(writes).toHaveLength(0);
		expect(session.get().status).toBe('editing');
		expect(session.get().draft).toBe('Row 1');
		expect(session.get().error).toContain('not in this view');
	});

	it('clears the error as soon as the user edits again', () => {
		const { session } = harness({ parse: () => ({ ok: false, reason: 'no' }) });
		session.open(A, 'x');
		session.commit();
		expect(session.get().error).toBe('no');
		session.update('xy');
		expect(session.get().error).toBeNull();
	});
});

describe('editSession — one editor at a time', () => {
	it('commits the first edit when a second cell is opened', () => {
		const { session, writes } = harness({
			parse: (_ref, draft) => ({ ok: true, value: draft }),
		});
		session.open(A, 'first');
		session.update('first edited');
		session.open(B, 'second');

		// `docs/01` §Core interaction model: leaving a cell by the grid's own navigation commits it (Enter
		// commits and moves down, Tab commits and moves right) — a click somewhere else is that same move.
		expect(writes).toEqual([{ ref: A, value: 'first edited' }]);
		expect(session.get().ref).toEqual(B);
		expect(session.get().draft).toBe('second');
	});

	it('does not steal the edit when the first one cannot be committed', () => {
		const { session } = harness({ parse: () => ({ ok: false, reason: 'unreadable' }) });
		session.open(A, 'nope');
		const result = session.open(B, 'second');

		expect(result.ok).toBe(false);
		expect(session.get().ref).toEqual(A);
		expect(session.get().draft).toBe('nope');
		expect(session.get().error).toBe('unreadable');
	});
});

describe('editSession — Escape and the nested layer', () => {
	it('closes the option list first and the editor second', () => {
		const { session } = harness();
		session.open(A, 'Todo');
		session.setListOpen(true);

		expect(session.escape()).toBe('closedList');
		expect(session.get().status).toBe('editing');
		expect(session.get().listOpen).toBe(false);

		expect(session.escape()).toBe('cancelled');
		expect(session.get().status).toBe('idle');
	});

	it('answers `none` for an Escape with nothing open', () => {
		const { session } = harness();
		expect(session.escape()).toBe('none');
	});
});

describe('editSession — the value a write carries', () => {
	it('writes an explicitly handed value without parsing it (a select, a checkbox)', () => {
		const parse = vi.fn((_ref: CellRef, draft: string) => ({
			ok: true as const,
			value: draft,
		}));
		const { session, writes } = harness({ parse });
		session.open(A, 'Todo');
		session.commit(['Todo', 'Done']);

		expect(parse).not.toHaveBeenCalled();
		expect(writes).toEqual([{ ref: A, value: ['Todo', 'Done'] }]);
	});

	it('notifies listeners on every state change and not on a no-op', () => {
		const { session } = harness();
		const seen: string[] = [];
		const stop = session.subscribe(() => {
			seen.push(session.get().status);
		});
		session.open(A, 'x');
		session.update('y');
		session.cancel();
		stop();
		session.open(A, 'z');

		expect(seen).toEqual(['editing', 'editing', 'idle']);
	});
});
