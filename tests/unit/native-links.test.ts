import { describe, expect, it } from 'vitest';

import {
	invertRowMap,
	localLinksToRemote,
	remoteLinksToLocal,
	unresolvedLinksOf,
} from '../../src/sync/nativeLinks';

const MAP = { row_a: 'recA', row_b: 'recB', row_c: 'recC' };

describe('local → remote link translation', () => {
	it('translates every target, in the cell order, and keeps duplicates', () => {
		expect(localLinksToRemote(['row_b', 'row_a', 'row_b'], MAP)).toEqual({
			ok: true,
			ids: ['recB', 'recA', 'recB'],
		});
	});

	it('translates an empty list to an empty list, which is a real value (the cell is empty on purpose)', () => {
		expect(localLinksToRemote([], MAP)).toEqual({ ok: true, ids: [] });
	});

	it('refuses the whole cell when any target has no entry, and names every unresolved target', () => {
		expect(localLinksToRemote(['row_a', 'row_x', 'row_y'], MAP)).toEqual({
			ok: false,
			unresolved: ['row_x', 'row_y'],
		});
	});

	it('does not treat an inherited property as a mapping', () => {
		expect(localLinksToRemote(['toString'], MAP)).toEqual({
			ok: false,
			unresolved: ['toString'],
		});
	});
});

describe('remote → local link translation', () => {
	const inverse = invertRowMap(MAP);

	it('translates every record back to its row, in the provider order', () => {
		if (!inverse.ok) throw new Error('the fixture map must invert');
		expect(remoteLinksToLocal(['recC', 'recA'], inverse.byRecord)).toEqual({
			ok: true,
			ids: ['row_c', 'row_a'],
		});
	});

	it('reports a record with no local row, and does not invent one', () => {
		if (!inverse.ok) throw new Error('the fixture map must invert');
		expect(remoteLinksToLocal(['recA', 'recZ'], inverse.byRecord)).toEqual({
			ok: false,
			unresolved: ['recZ'],
		});
	});
});

describe('inverse row map', () => {
	it('refuses when two rows point at one record, and names the record and the rows', () => {
		expect(invertRowMap({ row_a: 'rec1', row_b: 'rec1', row_c: 'rec2' })).toEqual({
			ok: false,
			recordId: 'rec1',
			rows: ['row_a', 'row_b'],
		});
	});
});

describe('unresolved links for a run', () => {
	it('lists only the rows whose cell cannot be translated, and says which targets', () => {
		const cells = [
			{ rowId: 'row_a', targets: ['row_b'] },
			{ rowId: 'row_b', targets: ['row_a', 'row_x'] },
			{ rowId: 'row_c', targets: [] },
		];
		expect(unresolvedLinksOf(cells, MAP)).toEqual([{ rowId: 'row_b', unresolved: ['row_x'] }]);
	});

	it('is empty when the whole field translates, which is the only case a write may proceed', () => {
		expect(unresolvedLinksOf([{ rowId: 'row_a', targets: ['row_a'] }], MAP)).toEqual([]);
	});
});
