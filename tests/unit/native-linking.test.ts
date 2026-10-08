import { describe, expect, it } from 'vitest';

import { linkRowsByKey, normaliseKey } from '../../src/sync/nativeLinking';

describe('first row-to-record link, by one key (R5 Part C, Step 2)', () => {
	it('links a row and a record only when the key is unique on both sides', () => {
		const plan = linkRowsByKey(
			[
				{ rowId: 'row_a', key: 'Ada' },
				{ rowId: 'row_b', key: 'Grace' },
			],
			[
				{ recordId: 'recA', key: 'Ada' },
				{ recordId: 'recB', key: 'Grace' },
			],
		);
		expect(plan.rowMap).toEqual({ row_a: 'recA', row_b: 'recB' });
		expect(plan.unlinkedRows).toEqual([]);
		expect(plan.unlinkedRecords).toEqual([]);
	});

	it('leaves a duplicated key unlinked on both sides, and says so', () => {
		const plan = linkRowsByKey(
			[
				{ rowId: 'row_a', key: 'Ada' },
				{ rowId: 'row_b', key: 'Ada' },
			],
			[{ recordId: 'recA', key: 'Ada' }],
		);
		expect(plan.rowMap).toEqual({});
		expect(plan.unlinkedRows).toEqual([
			{ rowId: 'row_a', reason: 'ambiguous' },
			{ rowId: 'row_b', reason: 'ambiguous' },
		]);
		expect(plan.unlinkedRecords).toEqual([{ recordId: 'recA', reason: 'ambiguous' }]);
	});

	it('does not link when a record key is duplicated remotely', () => {
		const plan = linkRowsByKey(
			[{ rowId: 'row_a', key: 'Ada' }],
			[
				{ recordId: 'recA', key: 'Ada' },
				{ recordId: 'recA2', key: 'Ada' },
			],
		);
		expect(plan.rowMap).toEqual({});
		expect(plan.unlinkedRows).toEqual([{ rowId: 'row_a', reason: 'ambiguous' }]);
		expect(plan.unlinkedRecords).toEqual([
			{ recordId: 'recA', reason: 'ambiguous' },
			{ recordId: 'recA2', reason: 'ambiguous' },
		]);
	});

	it('reports a row with no key and a record with no matching row, and creates neither', () => {
		const plan = linkRowsByKey(
			[{ rowId: 'row_a', key: null }],
			[{ recordId: 'recZ', key: 'Zed' }],
		);
		expect(plan.rowMap).toEqual({});
		expect(plan.unlinkedRows).toEqual([{ rowId: 'row_a', reason: 'no-key' }]);
		expect(plan.unlinkedRecords).toEqual([{ recordId: 'recZ', reason: 'no-match' }]);
	});

	it('ignores surrounding and repeated whitespace, but not case', () => {
		expect(normaliseKey('  Ada   Lovelace ')).toBe('Ada Lovelace');
		expect(normaliseKey('   ')).toBeNull();
		const plan = linkRowsByKey(
			[{ rowId: 'row_a', key: '  Ada   Lovelace ' }],
			[{ recordId: 'recA', key: 'Ada Lovelace' }],
		);
		expect(plan.rowMap).toEqual({ row_a: 'recA' });
		const cased = linkRowsByKey(
			[{ rowId: 'row_a', key: 'ada' }],
			[{ recordId: 'recA', key: 'Ada' }],
		);
		expect(cased.rowMap).toEqual({});
	});
});
