import { describe, expect, it } from 'vitest';

import {
	MAX_DATABASE_HISTORY_DEPTH,
	clearDatabaseHistory,
	createDatabaseHistory,
	planDatabaseRedo,
	planDatabaseUndo,
	pushDatabaseHistory,
	summarizeDatabaseHistory,
} from '../../src/core/database/history';
import type { DatabaseHistoryEntry } from '../../src/core/database/history';
import type { DatabaseOperation } from '../../src/core/database/operations';

const original: DatabaseOperation = { kind: 'set-document-name', name: 'Before' };
const changed: DatabaseOperation = { kind: 'set-document-name', name: 'After' };

function entry(label = 'Rename database'): DatabaseHistoryEntry {
	return { label, operations: [changed], inverse: [original] };
}

describe('database operation history', () => {
	it('starts empty with the inherited, bounded depth', () => {
		const history = createDatabaseHistory();
		expect(MAX_DATABASE_HISTORY_DEPTH).toBe(60);
		expect(history).toEqual({ depthLimit: 60, undo: [], redo: [] });
		expect(summarizeDatabaseHistory(history)).toEqual({
			canUndo: false,
			canRedo: false,
			undoLabel: null,
			redoLabel: null,
			depth: 0,
			redoDepth: 0,
		});
	});

	it('plans undo and redo without consuming entries before the caller accepts them', () => {
		const recorded = pushDatabaseHistory(createDatabaseHistory(), entry());
		const undo = planDatabaseUndo(recorded);
		expect(undo?.operations).toEqual([original]);
		expect(undo?.label).toBe('Rename database');
		// Planning is pure: only the returned next state has moved the step to redo.
		expect(recorded.undo).toHaveLength(1);
		expect(recorded.redo).toHaveLength(0);
		expect(undo?.next.undo).toHaveLength(0);
		expect(undo?.next.redo).toHaveLength(1);

		const redo = undo === null ? null : planDatabaseRedo(undo.next);
		expect(redo?.operations).toEqual([changed]);
		expect(redo?.label).toBe('Rename database');
		expect(redo?.next.undo).toHaveLength(1);
		expect(redo?.next.redo).toHaveLength(0);
	});

	it('treats one operation batch as one labeled action and clears redo on new work', () => {
		const batch: readonly DatabaseOperation[] = [
			{ kind: 'set-document-name', name: 'New name' },
			{ kind: 'rename-table', tableId: 'tbl_' + 'a'.repeat(26), name: 'New table' },
		];
		const first = pushDatabaseHistory(createDatabaseHistory(), {
			label: 'Rename database and table',
			operations: batch,
			inverse: [
				{ kind: 'rename-table', tableId: 'tbl_' + 'a'.repeat(26), name: 'Old table' },
				{ kind: 'set-document-name', name: 'Old name' },
			],
		});
		expect(first.undo).toHaveLength(1);
		expect(first.undo[0]?.operations).toEqual(batch);
		const afterUndo = planDatabaseUndo(first)?.next;
		if (afterUndo === undefined) {
			throw new Error('the batch should be undoable');
		}
		const afterNewEdit = pushDatabaseHistory(afterUndo, entry('Another action'));
		expect(afterNewEdit.undo.map((step) => step.label)).toEqual(['Another action']);
		expect(afterNewEdit.redo).toEqual([]);
	});

	it('caps undo depth and lets an explicit zero-depth policy disable recording', () => {
		let history = createDatabaseHistory(2);
		for (let index = 0; index < 4; index += 1) {
			history = pushDatabaseHistory(history, {
				label: `Edit ${String(index)}`,
				operations: [{ kind: 'set-document-name', name: `Name ${String(index)}` }],
				inverse: [{ kind: 'set-document-name', name: `Name ${String(index - 1)}` }],
			});
		}
		expect(history.undo.map((step) => step.label)).toEqual(['Edit 2', 'Edit 3']);
		expect(planDatabaseUndo(history)?.label).toBe('Edit 3');

		const disabled = createDatabaseHistory(0);
		expect(pushDatabaseHistory(disabled, entry())).toEqual(disabled);
		expect(planDatabaseUndo(disabled)).toBeNull();
	});

	it('copies caller-owned data and preserves Map and undefined operation payloads', () => {
		const widths = new Map<string, number>([['fld_' + 'c'.repeat(26), 240]]);
		const action: DatabaseHistoryEntry = {
			label: 'Set view layout',
			operations: [
				{
					kind: 'update-view',
					tableId: 'tbl_' + 'a'.repeat(26),
					viewId: 'view_' + 'b'.repeat(26),
					patch: { widths, groupBy: undefined },
				},
			],
			inverse: [{ kind: 'set-document-name', name: 'Before' }],
		};
		const history = pushDatabaseHistory(createDatabaseHistory(), action);
		widths.set('fld_' + 'd'.repeat(26), 500);
		const viewOperation = action.operations[0];
		if (viewOperation?.kind !== 'update-view') {
			throw new Error('the history entry should contain a view operation');
		}
		Reflect.set(viewOperation.patch, 'groupBy', 'fld_' + 'd'.repeat(26));

		const stored = history.undo[0]?.operations[0];
		expect(stored?.kind).toBe('update-view');
		if (stored?.kind === 'update-view') {
			expect(stored.patch.widths).toEqual(new Map([['fld_' + 'c'.repeat(26), 240]]));
			expect(stored.patch.groupBy).toBeUndefined();
		}
		const planned = planDatabaseUndo(history);
		expect(structuredClone(planned?.operations)).toEqual(planned?.operations);
	});

	it('rejects callbacks, host/class instances, dates, and cycles instead of storing them', () => {
		const invalidEntries: readonly unknown[] = [
			{
				...entry(),
				operations: [{ kind: 'set-document-name', name: 'x', callback: () => undefined }],
			},
			{
				...entry(),
				operations: [{ kind: 'set-document-name', name: new Date() }],
			},
		];
		for (const candidate of invalidEntries) {
			expect(() => {
				// @ts-expect-error Exercise untrusted runtime data that the public type excludes.
				pushDatabaseHistory(createDatabaseHistory(), candidate);
			}).toThrow();
		}

		const circular: DatabaseOperation = { kind: 'set-document-name', name: 'temporary' };
		Reflect.set(circular, 'name', circular);
		expect(() =>
			pushDatabaseHistory(createDatabaseHistory(), {
				label: 'Circular',
				operations: [circular],
				inverse: [original],
			}),
		).toThrow(/circular/i);
	});

	it('clears both stacks without changing the history limit', () => {
		const oneStep = pushDatabaseHistory(createDatabaseHistory(4), entry());
		const withRedo = planDatabaseUndo(oneStep)?.next;
		if (withRedo === undefined) {
			throw new Error('the step should be undoable');
		}
		expect(clearDatabaseHistory(withRedo)).toEqual({ depthLimit: 4, undo: [], redo: [] });
	});
});
