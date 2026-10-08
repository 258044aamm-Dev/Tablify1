import { describe, expect, it } from 'vitest';

import { linkPath } from '../../src/sync/LinkStore';
import {
	newNativeLink,
	nativeLinkKey,
	nativeLinkPath,
	parseNativeLink,
	serialiseNativeLink,
} from '../../src/sync/nativeLink';
import type { NativeLinkDocument } from '../../src/sync/nativeLink';

const TARGET = {
	baseId: 'appBASE',
	baseName: 'Studio',
	tableId: 'tblCLIENTS',
	tableName: 'Clients',
};

function linked(): NativeLinkDocument {
	return {
		...newNativeLink({ databaseId: 'db_a', tableId: 'tbl_main', target: TARGET }),
		fieldMap: { fld_name: 'fldREMOTE1' },
		rowMap: { row_ada: 'recADA' },
		snapshot: { recADA: { fldREMOTE1: 'sha256:aa' } },
		lastPulledAt: '2026-10-08T10:00:00.000Z',
	};
}

describe('native link identity (R5 Part C, Step 2)', () => {
	it('is one file per databaseId and tableId, not per saved view', () => {
		expect(nativeLinkKey('db_a', 'tbl_main')).toBe(nativeLinkKey('db_a', 'tbl_main'));
		expect(nativeLinkKey('db_a', 'tbl_main')).not.toBe(nativeLinkKey('db_a', 'tbl_other'));
		expect(nativeLinkKey('db_a', 'tbl_main')).not.toBe(nativeLinkKey('db_b', 'tbl_main'));
		expect(nativeLinkPath('db_a', 'tbl_main')).toMatch(
			/^\.tablify\/links\/[0-9a-f]{16}\.json$/,
		);
	});

	it('never names the same file as a legacy .base link, even for the same strings', () => {
		const legacy = linkPath('db_a', 'tbl_main');
		expect(nativeLinkPath('db_a', 'tbl_main')).not.toBe(legacy);
	});
});

describe('native link file', () => {
	it('round-trips every known field, and keeps a newer build’s unknown keys verbatim', () => {
		const text = serialiseNativeLink({ ...linked(), unknown: { futureNote: { kept: true } } });
		const loaded = parseNativeLink(text, 'links/x.json');
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) {
			throw new Error('a written link must read back');
		}
		expect(loaded.document.rowMap).toEqual({ row_ada: 'recADA' });
		expect(loaded.document.fieldMap).toEqual({ fld_name: 'fldREMOTE1' });
		expect(loaded.document.unknown).toEqual({ futureNote: { kept: true } });
		expect(serialiseNativeLink(loaded.document)).toBe(text);
	});

	it('refuses a newer format with a sentence, rather than guessing at its shape', () => {
		const text = JSON.stringify({ ...JSON.parse(serialiseNativeLink(linked())), version: 9 });
		const loaded = parseNativeLink(text, 'links/x.json');
		expect(loaded.ok).toBe(false);
		if (loaded.ok) {
			throw new Error('a newer version must not load');
		}
		expect(loaded.reason).toContain('newer version of Tablify');
	});

	it('refuses a corrupt file rather than re-creating a link that would drop its mappings', () => {
		const truncated = serialiseNativeLink(linked()).slice(0, 40);
		const loaded = parseNativeLink(truncated, 'links/x.json');
		expect(loaded.ok).toBe(false);
		if (loaded.ok) {
			throw new Error('a truncated link must not load');
		}
		expect(loaded.reason).toContain('not valid JSON');
	});

	it('refuses a file whose mappings are not strings', () => {
		const bad = JSON.stringify({
			...JSON.parse(serialiseNativeLink(linked())),
			rowMap: { row_ada: 7 },
		});
		expect(parseNativeLink(bad, 'links/x.json').ok).toBe(false);
	});
});

describe('snapshot', () => {
	it('is stored as the engine keeps it, under remote record and field IDs', () => {
		const loaded = parseNativeLink(serialiseNativeLink(linked()), 'links/x.json');
		expect(loaded.ok && loaded.document.snapshot).toEqual({
			recADA: { fldREMOTE1: 'sha256:aa' },
		});
	});
});
