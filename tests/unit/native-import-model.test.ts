import { describe, expect, it } from 'vitest';

import type { DatabaseImportApplyResult } from '../../src/adapters/tablifyFile';
import type { DatabaseDocument, DatabaseTable } from '../../src/core/database';
import { ID_PREFIXES } from '../../src/core/database/ids';
import type { IdKind } from '../../src/core/database/ids';
import {
	confirmationLines,
	defaultTableName,
	destinationOf,
	initialDraft,
	planOf,
	previewOf,
	progressLine,
	resultMessage,
	targetFieldsOf,
} from '../../src/plugin/nativeImport/model';
import type { ImportDraft, ImportPlanEnvironment } from '../../src/plugin/nativeImport/model';

const ENV: ImportPlanEnvironment = {
	createId: (() => {
		const counts = new Map<IdKind, number>();
		return (kind: IdKind): string => {
			const next = (counts.get(kind) ?? 0) + 1;
			counts.set(kind, next);
			return `${ID_PREFIXES[kind]}_model${String(next)}`;
		};
	})(),
	now: () => Date.parse('2026-10-08T10:20:30.000Z'),
	timezone: 'UTC',
	locale: 'en-GB',
};

function emptyDocument(): DatabaseDocument {
	return {
		format: 'tablify',
		version: 1,
		databaseId: `db_${'m'.repeat(26)}`,
		name: 'Model',
		tables: [],
		unknown: [],
	};
}

function draftWith(text: string, overrides: Partial<ImportDraft> = {}): ImportDraft {
	return {
		...initialDraft({ sourceName: 'people.tsv', activeTableId: null }),
		text,
		...overrides,
	};
}

const TWO_COLUMNS = 'Name\tQty\nAda\t2\nGrace\t3\n';

describe('native import model', () => {
	it('names a new table after the file, without its extension', () => {
		expect(defaultTableName('contacts.final.tsv')).toBe('contacts.final');
		expect(defaultTableName('.hidden')).toBe('.hidden');
		expect(defaultTableName('   .csv')).toBe('Imported table');
	});

	it('gives one sentence per apply outcome and says what did not change', () => {
		const saved = {
			kind: 'saved',
			appliedRecords: 2,
			committedRecords: 2,
			operationCount: 3,
			wrote: true,
			revision: 'r1',
		} satisfies DatabaseImportApplyResult;
		expect(resultMessage(saved)).toContain('2 record(s)');
		expect(resultMessage({ kind: 'cancelled', committedRecords: 0, message: 'x' })).toBe(
			'Import cancelled. Nothing was changed.',
		);
		expect(resultMessage({ kind: 'no-op', committedRecords: 0, operationCount: 0 })).toBe(
			'There was nothing to import.',
		);
		const unsaved = {
			kind: 'applied-unsaved',
			appliedRecords: 1,
			committedRecords: 0,
			operationCount: 1,
			failure: { kind: 'conflict', expected: 'a', found: 'b' },
		} satisfies DatabaseImportApplyResult;
		const message = resultMessage(unsaved);
		expect(message).toContain('in this window');
		expect(message).toContain('the file changed on disk');
		expect(message).toContain('Undo reverts the import');
	});

	it('shows a read-only or link field with its reason, and never offers it as a target', () => {
		const table = {
			id: 'tbl_model1',
			name: 'T',
			fields: [
				{
					kind: 'field',
					id: 'fld_a',
					name: 'Plain',
					type: 'text',
					settings: {},
					unknown: [],
				},
				{
					kind: 'field',
					id: 'fld_b',
					name: 'Created',
					type: 'createdTime',
					settings: {},
					unknown: [],
				},
				{
					kind: 'field',
					id: 'fld_c',
					name: 'Refers',
					type: 'link',
					settings: {},
					unknown: [],
				},
			],
			rows: [],
			views: [],
			unknown: [],
		} satisfies DatabaseTable;
		const choices = targetFieldsOf(table);
		expect(choices.map((choice) => choice.selectable)).toEqual([true, false, false]);
		expect(choices[1]?.reason).toContain('Read-only');
		expect(choices[2]?.reason).toContain('row-ID');
	});

	it('refuses append without a table, and replace with a key that is not mapped', () => {
		const preview = previewOf(draftWith(TWO_COLUMNS));
		if (!preview.ok) {
			throw new Error('fixture must read');
		}
		const noTable = destinationOf(
			draftWith(TWO_COLUMNS, { mode: 'append', tableId: null }),
			preview,
		);
		expect(noTable.ok).toBe(false);
		const unmappedKey = destinationOf(
			draftWith(TWO_COLUMNS, {
				mode: 'replace',
				tableId: 'tbl_x',
				keyColumn: 0,
				fieldTargets: new Map(),
			}),
			preview,
		);
		expect(unmappedKey.ok).toBe(false);
	});

	it('builds the exact create plan from the source and refuses an empty source with the reader reason', () => {
		const ok = planOf(emptyDocument(), draftWith(TWO_COLUMNS, { newTableName: 'People' }), ENV);
		expect(ok.ok).toBe(true);
		if (ok.ok) {
			expect(ok.summary).toContain('2');
			expect(confirmationLines(ok.plan)).toEqual([]);
		}
		const empty = planOf(emptyDocument(), draftWith(''), ENV);
		expect(empty.ok).toBe(false);
		if (!empty.ok) {
			expect(empty.reasons.length).toBeGreaterThan(0);
		}
	});

	it('reads the preview with the draft choices, so an excluded column is not previewed as included', () => {
		const draft = draftWith(TWO_COLUMNS, { excluded: new Set([1]) });
		const preview = previewOf(draft);
		expect(preview.ok).toBe(true);
		if (preview.ok) {
			expect(preview.columns.find((column) => column.index === 1)?.included).toBe(false);
		}
	});

	it('uses the same progress lines the runner phases map to', () => {
		expect(progressLine('checking', 0)).toContain('Checking');
		expect(progressLine('ready-to-apply', 3)).toBe(
			'Ready to apply 3 record(s). Cancel is still available.',
		);
		expect(progressLine('unknown', 0)).toBe('');
	});
});
