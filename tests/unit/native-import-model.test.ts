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
	linkSourceValuesOf,
	linkTargetRowsOf,
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

/** A valid row ID shape for the planner's row check (`row_` plus 26 lowercase letters or digits). */
function rowId(stem: string): string {
	return `row_${(stem + '0'.repeat(26)).slice(0, 26)}`;
}

function linkDocument(): DatabaseDocument {
	const clients: DatabaseTable = {
		id: 'tbl_clients',
		name: 'Clients',
		fields: [
			{
				kind: 'field',
				id: 'fld_cname',
				name: 'Name',
				type: 'text',
				settings: {},
				unknown: [],
			},
		],
		rows: [
			{
				id: rowId('ada'),
				cells: new Map([['fld_cname', 'Ada']]),
				createdAt: null,
				updatedAt: null,
				unknown: [],
			},
			{ id: rowId('grace'), cells: new Map(), createdAt: null, updatedAt: null, unknown: [] },
		],
		views: [],
		unknown: [],
	};
	const orders: DatabaseTable = {
		id: 'tbl_orders',
		name: 'Orders',
		fields: [
			{
				kind: 'field',
				id: 'fld_client',
				name: 'Client',
				type: 'link',
				settings: { targetTableId: 'tbl_clients' },
				unknown: [],
			},
		],
		rows: [],
		views: [],
		unknown: [],
	};
	return { ...emptyDocument(), tables: [clients, orders] };
}

describe('native import link values', () => {
	const ADA = rowId('ada');
	const GRACE = rowId('grace');

	it('offers a link field as a target only when its target table exists in the database', () => {
		const document = linkDocument();
		const orders = document.tables[1];
		if (orders === undefined) {
			throw new Error('the link fixture has an orders table');
		}
		expect(targetFieldsOf(orders, document.tables)[0]?.selectable).toBe(true);
		expect(targetFieldsOf(orders)[0]?.selectable).toBe(false);
	});

	it('lists each distinct, non-blank source value once, in first-seen order', () => {
		const preview = previewOf(draftWith('Client\nAda\n\nAda\nGrace\n'));
		if (!preview.ok) {
			throw new Error('the link source must read');
		}
		expect(linkSourceValuesOf(preview, 0)).toEqual(['Ada', 'Grace']);
	});

	it('labels target rows by their first text field, and by ID when that is blank', () => {
		const document = linkDocument();
		expect(linkTargetRowsOf(document.tables, 'tbl_clients')).toEqual([
			{ rowId: ADA, label: 'Ada' },
			{ rowId: GRACE, label: GRACE },
		]);
		expect(linkTargetRowsOf(document.tables, 'tbl_missing')).toBeNull();
	});

	it('plans the link when every source value has a chosen row, and blocks on the one that has none', () => {
		const document = linkDocument();
		const text = 'Client\nAda\nGrace\n';
		const base = draftWith(text, {
			mode: 'append',
			tableId: 'tbl_orders',
			fieldTargets: new Map([[0, 'fld_client']]),
		});

		const partial = planOf(
			document,
			{ ...base, linkValues: new Map([[0, new Map([['Ada', [ADA]]])]]) },
			ENV,
		);
		expect(partial.ok).toBe(false);
		if (partial.ok) {
			throw new Error('a value with no chosen row must block the import');
		}
		expect(partial.reasons.join('\n')).toContain(
			'Link value "Grace" has no explicit row-ID mapping',
		);

		const complete = planOf(
			document,
			{
				...base,
				linkValues: new Map([
					[
						0,
						new Map([
							['Ada', [ADA]],
							['Grace', [GRACE]],
						]),
					],
				]),
			},
			ENV,
		);
		expect(complete.ok).toBe(true);
	});

	it('takes an ordered list for a multi-link field, and never turns a list into a single link', () => {
		const document = linkDocument();
		const orders = document.tables[1];
		if (orders === undefined) {
			throw new Error('the link fixture has an orders table');
		}
		const multi: DatabaseDocument = {
			...document,
			tables: [
				document.tables[0] ?? orders,
				{
					...orders,
					fields: [
						{
							kind: 'field',
							id: 'fld_client',
							name: 'Client',
							type: 'link',
							settings: { targetTableId: 'tbl_clients', allowMultiple: true },
							unknown: [],
						},
					],
				},
			],
		};
		const base = draftWith('Client\nAda\n', {
			mode: 'append',
			tableId: 'tbl_orders',
			fieldTargets: new Map([[0, 'fld_client']]),
		});

		const list = planOf(
			multi,
			{ ...base, linkValues: new Map([[0, new Map([['Ada', [ADA, GRACE]]])]]) },
			ENV,
		);
		expect(list.ok).toBe(true);

		const single = planOf(
			document,
			{ ...base, linkValues: new Map([[0, new Map([['Ada', [ADA, GRACE]]])]]) },
			ENV,
		);
		expect(single.ok).toBe(false);
		if (single.ok) {
			throw new Error('a list must not be written to a single link');
		}
		expect(single.reasons.join('\n')).toContain('no explicit row-ID mapping');
	});
});
