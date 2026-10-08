/**
 * Exact native database import plans. These tests never route through the legacy note importer or a host/UI.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
	applyOperations,
	buildDatabaseImportPlan,
	describeDatabaseImportPlan,
	parseDocument,
	previewDatabaseImport,
	serializeDocument,
} from '../../src/core/database';
import type {
	DatabaseDocument,
	DatabaseImportPlan,
	DatabaseImportPlanOptions,
	DatabaseImportPreview,
	DatabaseTable,
} from '../../src/core/database';
import { ID_PREFIXES } from '../../src/core/database/ids';
import type { IdKind } from '../../src/core/database/ids';
import type { Matrix } from '../../src/core/selection/clipboard';
import type { FieldTypeId } from '../../src/core/types';

const FIXED_NOW = Date.parse('2026-10-08T10:20:30.000Z');

function fixture(
	file: 'rows-views.tablify' | 'all-field-types.tablify' = 'rows-views.tablify',
): DatabaseDocument {
	const loaded = parseDocument(
		readFileSync(new URL(`../fixtures/tablify/${file}`, import.meta.url), 'utf8'),
	);
	if (!loaded.ok) {
		throw new Error(`the ${file} import fixture must parse`);
	}
	return loaded.document;
}

function emptyDocument(): DatabaseDocument {
	return {
		format: 'tablify',
		version: 1,
		databaseId: 'db_importplan',
		name: 'Import tests',
		tables: [],
		unknown: [],
	};
}

function tableByName(document: DatabaseDocument, name: string): DatabaseTable {
	const table = document.tables.find((candidate) => candidate.name === name);
	if (table === undefined) {
		throw new Error(`the ${name} table must exist`);
	}
	return table;
}

function fieldIdByName(table: DatabaseTable, name: string): string {
	const field = table.fields.find(
		(candidate) => candidate.kind === 'field' && candidate.name === name,
	);
	if (field === undefined || field.kind !== 'field') {
		throw new Error(`the ${name} field must be a supported field in ${table.name}`);
	}
	return field.id;
}

function preview(
	matrix: Matrix,
	overrides: ReadonlyMap<number, FieldTypeId> = new Map(),
	excluded: ReadonlySet<number> = new Set(),
): DatabaseImportPreview {
	const result = previewDatabaseImport(
		{ kind: 'matrix', matrix, name: 'import.csv' },
		{ hasHeader: true, overrides, excluded },
	);
	if (!result.ok) {
		throw new Error(result.reason);
	}
	return result;
}

function sequentialIds(): DatabaseImportPlanOptions['ids'] {
	const counts = new Map<IdKind, number>();
	return (kind) => {
		const next = (counts.get(kind) ?? 0) + 1;
		counts.set(kind, next);
		return `${ID_PREFIXES[kind]}_import${String(next)}`;
	};
}

function planOptions(
	overrides: Partial<Pick<DatabaseImportPlanOptions, 'ids' | 'linkMappings' | 'policy'>> = {},
): DatabaseImportPlanOptions {
	return {
		ids: overrides.ids ?? sequentialIds(),
		context: {
			now: () => FIXED_NOW,
			timezone: 'Europe/Amsterdam',
			locale: 'en-GB',
		},
		...(overrides.linkMappings === undefined ? {} : { linkMappings: overrides.linkMappings }),
		...(overrides.policy === undefined ? {} : { policy: overrides.policy }),
	};
}

function requirePlan(result: ReturnType<typeof buildDatabaseImportPlan>): DatabaseImportPlan {
	if (!result.ok) {
		throw new Error(result.issues.map((issue) => issue.message).join('\n'));
	}
	return result.plan;
}

describe('native database import plan', () => {
	it('creates a table using preview-selected types, descriptor conversions, injected IDs, and measured thresholds', () => {
		const document = emptyDocument();
		const source = preview(
			[
				['Title', 'Amount', 'Status'],
				['  Alpha  ', '4', 'Open'],
				['Beta', 'not-a-number', 'Closed'],
			],
			new Map([
				[0, 'text'],
				[1, 'number'],
				[2, 'singleSelect'],
			]),
		);
		const result = buildDatabaseImportPlan(
			document,
			source,
			{ kind: 'create', tableName: 'Imported projects' },
			planOptions({
				policy: { warnAtOrAboveDocumentBytes: 0, warnAtOrAboveWorkUnits: 0 },
			}),
		);
		const plan = requirePlan(result);

		expect(plan.destination).toEqual({
			kind: 'create',
			tableId: 'tbl_import1',
			tableName: 'Imported projects',
		});
		expect(plan.baseDocumentJson).toBe(serializeDocument(document));
		expect(
			plan.columns.map((column) => [
				column.sourceName,
				column.inferredType,
				column.sourceType,
				column.targetType,
			]),
		).toEqual([
			['Title', 'singleSelect', 'text', 'text'],
			['Amount', 'singleSelect', 'number', 'number'],
			['Status', 'singleSelect', 'singleSelect', 'singleSelect'],
		]);
		expect(plan.columns[2]?.optionsAdded.map((option) => [option.id, option.name])).toEqual([
			['opt_import1', 'Open'],
			['opt_import2', 'Closed'],
		]);
		expect(plan.rows.map((row) => [row.action, row.rowId])).toEqual([
			['create', 'row_import1'],
			['create', 'row_import2'],
		]);
		expect(plan.rows[0]?.cells.map((cell) => [cell.status, cell.value])).toEqual([
			['write', 'Alpha'],
			['write', 4],
			['write', 'opt_import1'],
		]);
		expect(plan.rows[1]?.cells.map((cell) => cell.status)).toEqual([
			'write',
			'skipped',
			'write',
		]);
		expect(plan.skippedValues).toHaveLength(1);
		expect(plan.skippedValues[0]).toMatchObject({
			sourceRow: 2,
			sourceColumn: 1,
			sourceText: 'not-a-number',
			targetType: 'number',
		});
		expect(plan.duplicatePolicy).toBe('preserve-source-rows');
		expect(plan.duplicateDecisions).toContainEqual({
			kind: 'preserve-source-rows',
			rowCount: 2,
		});
		expect(plan.confirmations.map((confirmation) => confirmation.kind)).toContain(
			'accept-skipped-values',
		);
		expect(plan.operations.map((operation) => operation.kind)).toEqual([
			'create-table',
			'create-field',
			'create-field',
			'create-field',
			'create-record',
			'create-record',
		]);
		expect(plan.metrics).toMatchObject({
			sourceRows: 2,
			includedColumns: 3,
			sourceCellsExamined: 6,
			targetRowsScanned: 0,
			rowsCreated: 2,
			rowsUpdated: 0,
			cellsSkipped: 1,
			fieldsCreated: 3,
			optionsCreated: 2,
		});
		expect(plan.metrics.estimatedWorkUnits).toBe(
			plan.metrics.sourceCellsExamined +
				plan.metrics.targetRowsScanned +
				plan.metrics.operationCount,
		);
		expect(plan.metrics.documentBytesAfter - plan.metrics.documentBytesBefore).toBe(
			plan.metrics.documentBytesDelta,
		);
		expect(plan.metrics.documentBytesDelta).toBeGreaterThan(0);
		expect(plan.warnings.map((warning) => warning.code)).toEqual([
			'document-size-threshold',
			'work-threshold',
		]);

		const applied = applyOperations(document, plan.operations);
		expect(applied.ok).toBe(true);
		if (!applied.ok) {
			throw new Error(applied.message);
		}
		const importedTable = tableByName(applied.document, 'Imported projects');
		expect(importedTable.rows).toHaveLength(2);
		expect(
			importedTable.fields.map((field) =>
				field.kind === 'field' ? field.type : field.typeName,
			),
		).toEqual(['text', 'number', 'singleSelect']);
	});

	it('keeps excluded columns visible but out of fields, conversions, operations, and work counts', () => {
		const document = emptyDocument();
		const source = preview(
			[
				['Name', 'Ignore me'],
				['Ada', 'not-a-number'],
			],
			new Map([
				[0, 'text'],
				[1, 'number'],
			]),
			new Set([1]),
		);
		const plan = requirePlan(
			buildDatabaseImportPlan(
				document,
				source,
				{ kind: 'create', tableName: 'Included only' },
				planOptions(),
			),
		);

		expect(
			plan.columns.map((column) => [column.sourceName, column.included, column.mapping]),
		).toEqual([
			['Name', true, 'new'],
			['Ignore me', false, 'excluded'],
		]);
		expect(plan.rows[0]?.cells.map((cell) => cell.sourceColumn)).toEqual([0]);
		expect(plan.skippedValues).toEqual([]);
		expect(plan.metrics).toMatchObject({
			includedColumns: 1,
			sourceCellsExamined: 1,
			cellsSkipped: 0,
			fieldsCreated: 1,
		});
		expect(plan.operations.map((operation) => operation.kind)).toEqual([
			'create-table',
			'create-field',
			'create-record',
		]);
	});

	it('appends through existing field types, asks to confirm suggestions, and reports skipped conversions', () => {
		const document = fixture('all-field-types.tablify');
		const table = tableByName(document, 'Shoots');
		const source = preview(
			[
				['Title', 'Status', 'Grade', 'Tags'],
				['  New shoot  ', 'planned', '4.5', 'Planned, Done, Planned'],
				['Second shoot', 'Archive', 'not-a-rating', 'Done, Done'],
			],
			new Map([
				[0, 'text'],
				[1, 'text'],
				[2, 'text'],
				[3, 'text'],
			]),
		);
		const plan = requirePlan(
			buildDatabaseImportPlan(
				document,
				source,
				{ kind: 'append', tableId: table.id, fieldMapping: { kind: 'suggest-by-name' } },
				planOptions(),
			),
		);
		const statusId = fieldIdByName(table, 'Status');
		const tagsId = fieldIdByName(table, 'Tags');
		const statusOption = table.fields.find(
			(field) => field.kind === 'field' && field.id === statusId,
		);
		if (statusOption?.kind !== 'field') {
			throw new Error('the Status field must be a supported field');
		}
		const existingPlannedId = statusOption.settings.options?.find(
			(option) => option.name === 'Planned',
		)?.id;
		const existingDoneId = statusOption.settings.options?.find(
			(option) => option.name === 'Done',
		)?.id;

		expect(
			plan.columns.map((column) => [column.mapping, column.sourceType, column.targetType]),
		).toEqual([
			['suggested', 'text', 'text'],
			['suggested', 'text', 'singleSelect'],
			['suggested', 'text', 'rating'],
			['suggested', 'text', 'multiSelect'],
		]);
		expect(plan.columns[1]?.optionsAdded.map((option) => option.name)).toEqual(['Archive']);
		expect(plan.rows[0]?.cells.map((cell) => [cell.status, cell.value])).toEqual([
			['write', 'New shoot'],
			['write', existingPlannedId],
			['write', 4.5],
			['write', [existingPlannedId, existingDoneId]],
		]);
		expect(plan.rows[1]?.cells.map((cell) => cell.status)).toEqual([
			'write',
			'write',
			'skipped',
			'write',
		]);
		expect(plan.rows[1]?.cells.find((cell) => cell.fieldId === tagsId)?.value).toEqual([
			expect.stringMatching(/^opt_/),
		]);
		expect(plan.duplicateDecisions).toEqual(
			expect.arrayContaining([
				{
					kind: 'multi-select-values-collapsed',
					sourceRow: 1,
					sourceColumn: 3,
					duplicateCount: 1,
				},
				{
					kind: 'multi-select-values-collapsed',
					sourceRow: 2,
					sourceColumn: 3,
					duplicateCount: 1,
				},
				{ kind: 'preserve-source-rows', rowCount: 2 },
			]),
		);
		expect(plan.confirmations.map((confirmation) => confirmation.kind)).toEqual(
			expect.arrayContaining([
				'suggested-field-mappings',
				'add-select-options',
				'accept-skipped-values',
			]),
		);
		expect(plan.metrics).toMatchObject({
			rowsCreated: 2,
			rowsUpdated: 0,
			cellsSkipped: 1,
			fieldsCreated: 0,
			optionsCreated: 1,
			targetRowsScanned: 0,
		});
		expect(plan.metrics.estimatedWorkUnits).toBe(
			plan.metrics.sourceCellsExamined + plan.metrics.operationCount,
		);
		expect(describeDatabaseImportPlan(plan)).toContain('2 source rows');
		expect(describeDatabaseImportPlan(plan)).not.toMatch(/\.md|\.tabula|note count|folder/i);
	});

	it('replaces only explicitly keyed rows, shows clears, and retains unmatched rows and absent fields', () => {
		const document = fixture();
		const table = tableByName(document, 'Shoots');
		const titleId = fieldIdByName(table, 'Title');
		const statusId = fieldIdByName(table, 'Status');
		const dateId = fieldIdByName(table, 'Shoot date');
		const source = preview(
			[
				['Title', 'Status', 'Shoot date'],
				['Rooftop, dawn', 'Done', ''],
				['New shoot', 'Planned', '2026-10-01'],
			],
			new Map([
				[0, 'text'],
				[1, 'text'],
				[2, 'text'],
			]),
		);
		const plan = requirePlan(
			buildDatabaseImportPlan(
				document,
				source,
				{
					kind: 'replace',
					tableId: table.id,
					fieldMapping: {
						kind: 'field-ids',
						fields: [
							{ sourceColumn: 0, fieldId: titleId },
							{ sourceColumn: 1, fieldId: statusId },
							{ sourceColumn: 2, fieldId: dateId },
						],
					},
					rowMatch: { kind: 'field-id', sourceColumn: 0, fieldId: titleId },
					removeAbsentFields: false,
				},
				planOptions(),
			),
		);

		expect(plan.destination).toMatchObject({
			kind: 'replace',
			rowMatch: { kind: 'field-id', sourceColumn: 0, fieldId: titleId },
			removeAbsentFields: false,
		});
		expect(plan.rows.map((row) => [row.action, row.rowId, row.keyDecision.kind])).toEqual([
			['update', 'row_shot100000000000000000000t', 'matched'],
			['append', 'row_import1', 'not-found'],
		]);
		expect(plan.rows[0]?.cells.map((cell) => [cell.fieldId, cell.status])).toEqual([
			[titleId, 'unchanged'],
			[statusId, 'write'],
			[dateId, 'clear'],
		]);
		expect(plan.unmatchedExistingRows).toEqual([
			{ rowId: 'row_shot200000000000000000000u', reason: 'empty-key' },
			{ rowId: 'row_shot300000000000000000000v', reason: 'key-not-in-import' },
		]);
		expect(plan.duplicatePolicy).toBe('unique-mapped-key');
		expect(plan.duplicateDecisions).toContainEqual({
			kind: 'require-unique-mapped-key',
			fieldId: titleId,
			matchedRows: 1,
			appendedRows: 1,
		});
		const replaceConfirmation = plan.confirmations.find(
			(confirmation) => confirmation.kind === 'replace-values',
		);
		expect(replaceConfirmation).toMatchObject({
			kind: 'replace-values',
			updatedRowIds: ['row_shot100000000000000000000t'],
			appendedRowIds: ['row_import1'],
			clearedCells: [{ sourceRow: 1, fieldId: dateId }],
			unmatchedExistingRowIds: [
				'row_shot200000000000000000000u',
				'row_shot300000000000000000000v',
			],
		});
		expect(plan.metrics).toMatchObject({
			targetRowsScanned: 3,
			rowsMatched: 1,
			rowsUpdated: 1,
			rowsCreated: 1,
			cellsCleared: 1,
			fieldsRemoved: 0,
		});
		expect(plan.operations.map((operation) => operation.kind)).toEqual([
			'set-cells',
			'create-record',
		]);

		const applied = applyOperations(document, plan.operations);
		expect(applied.ok).toBe(true);
		if (!applied.ok) {
			throw new Error(applied.message);
		}
		const updatedTable = tableByName(applied.document, 'Shoots');
		expect(updatedTable.rows).toHaveLength(4);
		expect(updatedTable.rows[0]?.cells.get(dateId)).toBeUndefined();
		expect(updatedTable.fields.map((field) => field.id)).toContain(
			fieldIdByName(table, 'Notes'),
		);
	});

	it('distinguishes empty row keys from unreadable mapped keys and appends both safely', () => {
		const document = fixture('all-field-types.tablify');
		const table = tableByName(document, 'Shoots');
		const countId = fieldIdByName(table, 'Count');
		const plan = requirePlan(
			buildDatabaseImportPlan(
				document,
				preview([['Count'], [''], ['not-a-number']], new Map([[0, 'text']])),
				{
					kind: 'replace',
					tableId: table.id,
					fieldMapping: {
						kind: 'field-ids',
						fields: [{ sourceColumn: 0, fieldId: countId }],
					},
					rowMatch: { kind: 'field-id', sourceColumn: 0, fieldId: countId },
					removeAbsentFields: false,
				},
				planOptions(),
			),
		);

		expect(plan.rows.map((row) => [row.action, row.keyDecision.kind])).toEqual([
			['append', 'empty'],
			['append', 'unreadable'],
		]);
		expect(plan.rows.map((row) => row.cells[0]?.status)).toEqual(['empty', 'skipped']);
		expect(plan.skippedValues).toHaveLength(1);
		expect(plan.skippedValues[0]?.targetType).toBe('number');
		expect(plan.unmatchedExistingRows).toEqual([
			{ rowId: table.rows[0]?.id, reason: 'key-not-in-import' },
		]);
	});

	it('blocks duplicate source keys and duplicate target keys instead of choosing a row', () => {
		const document = fixture();
		const table = tableByName(document, 'Shoots');
		const titleId = fieldIdByName(table, 'Title');
		const destination = {
			kind: 'replace',
			tableId: table.id,
			fieldMapping: { kind: 'field-ids', fields: [{ sourceColumn: 0, fieldId: titleId }] },
			rowMatch: { kind: 'field-id', sourceColumn: 0, fieldId: titleId },
			removeAbsentFields: false,
		} as const;
		const duplicateSource = buildDatabaseImportPlan(
			document,
			preview([['Title'], ['Rooftop, dawn'], ['Rooftop, dawn']]),
			destination,
			planOptions(),
		);
		expect(duplicateSource.ok).toBe(false);
		if (duplicateSource.ok) {
			throw new Error('duplicate source row keys must be rejected');
		}
		expect(duplicateSource.issues).toContainEqual(
			expect.objectContaining({
				code: 'duplicate-source-key',
				sourceRows: [1, 2],
			}),
		);

		const firstTitle = table.rows[0]?.cells.get(titleId);
		if (typeof firstTitle !== 'string') {
			throw new Error('the first target row must have a text key');
		}
		const duplicateTargetDocument: DatabaseDocument = {
			...document,
			tables: document.tables.map((candidate) =>
				candidate.id !== table.id
					? candidate
					: {
							...candidate,
							rows: candidate.rows.map((row, index) =>
								index !== 1
									? row
									: {
											...row,
											cells: new Map(row.cells).set(titleId, firstTitle),
										},
							),
						},
			),
		};
		const duplicateTarget = buildDatabaseImportPlan(
			duplicateTargetDocument,
			preview([['Title'], ['Rooftop, dawn']]),
			destination,
			planOptions(),
		);
		expect(duplicateTarget.ok).toBe(false);
		if (duplicateTarget.ok) {
			throw new Error('duplicate target row keys must be rejected');
		}
		expect(duplicateTarget.issues).toContainEqual(
			expect.objectContaining({
				code: 'duplicate-target-key',
				rowIds: [table.rows[0]?.id, table.rows[1]?.id],
			}),
		);
	});

	it('preserves duplicate source rows without a key and lists every existing replace row as retained', () => {
		const document = fixture();
		const table = tableByName(document, 'Shoots');
		const titleId = fieldIdByName(table, 'Title');
		const plan = requirePlan(
			buildDatabaseImportPlan(
				document,
				preview([['Title'], ['Same source record'], ['Same source record']]),
				{
					kind: 'replace',
					tableId: table.id,
					fieldMapping: {
						kind: 'field-ids',
						fields: [{ sourceColumn: 0, fieldId: titleId }],
					},
					rowMatch: { kind: 'append' },
					removeAbsentFields: false,
				},
				planOptions(),
			),
		);

		expect(plan.rows).toHaveLength(2);
		expect(plan.rows[0]?.rowId).not.toBe(plan.rows[1]?.rowId);
		expect(plan.rows.every((row) => row.action === 'append')).toBe(true);
		expect(plan.duplicatePolicy).toBe('preserve-source-rows');
		expect(plan.duplicateDecisions).toContainEqual({
			kind: 'preserve-source-rows',
			rowCount: 2,
		});
		expect(plan.unmatchedExistingRows).toEqual(
			table.rows.map((row) => ({ rowId: row.id, reason: 'no-row-key' })),
		);
		expect(plan.metrics.targetRowsScanned).toBe(table.rows.length);
		expect(describeDatabaseImportPlan(plan)).toContain('no row key was selected');
		expect(
			plan.confirmations.find((confirmation) => confirmation.kind === 'replace-values'),
		).toMatchObject({
			kind: 'replace-values',
			unmatchedExistingRowIds: table.rows.map((row) => row.id),
		});
	});

	it('requires exact link-value mappings and rejects IDs outside the configured target table', () => {
		const document = fixture();
		const table = tableByName(document, 'Shoots');
		const clients = tableByName(document, 'Clients');
		const linkId = fieldIdByName(table, 'Client');
		const adaId = clients.rows[0]?.id;
		const bobId = clients.rows[1]?.id;
		const otherTableRowId = table.rows[0]?.id;
		if (adaId === undefined || bobId === undefined || otherTableRowId === undefined) {
			throw new Error('the link fixture needs client and shoot rows');
		}
		const source = preview([['Client'], ['Ada'], ['Bob']]);
		const destination = {
			kind: 'append',
			tableId: table.id,
			fieldMapping: { kind: 'field-ids', fields: [{ sourceColumn: 0, fieldId: linkId }] },
		} as const;
		const mapping = {
			sourceColumn: 0,
			fieldId: linkId,
			targetTableId: clients.id,
			values: new Map([
				['Ada', adaId],
				['Bob', bobId],
			]),
		};
		const plan = requirePlan(
			buildDatabaseImportPlan(
				document,
				source,
				destination,
				planOptions({ linkMappings: [mapping] }),
			),
		);
		expect(plan.rows.map((row) => row.cells[0]?.value)).toEqual([adaId, bobId]);
		expect(plan.rows.map((row) => row.cells[0]?.targetType)).toEqual(['link', 'link']);
		expect(plan.metrics.targetRowsScanned).toBe(clients.rows.length);

		const withoutMapping = buildDatabaseImportPlan(
			document,
			preview([['Client'], ['Ada']]),
			destination,
			planOptions(),
		);
		expect(withoutMapping.ok).toBe(false);
		if (withoutMapping.ok) {
			throw new Error('link labels must not be guessed as row identity');
		}
		expect(withoutMapping.issues).toContainEqual(
			expect.objectContaining({ code: 'unmapped-link-value', sourceRow: 1, fieldId: linkId }),
		);

		const wrongTargetTable = buildDatabaseImportPlan(
			document,
			preview([['Client'], ['Ada']]),
			destination,
			planOptions({
				linkMappings: [{ ...mapping, targetTableId: table.id }],
			}),
		);
		expect(wrongTargetTable.ok).toBe(false);
		if (wrongTargetTable.ok) {
			throw new Error('a link map must name the link field’s configured target table');
		}
		expect(wrongTargetTable.issues).toContainEqual(
			expect.objectContaining({ code: 'link-target-mismatch', fieldId: linkId }),
		);

		const invalidTargetId = buildDatabaseImportPlan(
			document,
			preview([['Client'], ['Ada']]),
			destination,
			planOptions({
				linkMappings: [
					{
						...mapping,
						values: new Map([['Ada', otherTableRowId]]),
					},
				],
			}),
		);
		expect(invalidTargetId.ok).toBe(false);
		if (invalidTargetId.ok) {
			throw new Error('a row from another table must not satisfy a link mapping');
		}
		expect(invalidTargetId.issues).toContainEqual(
			expect.objectContaining({ code: 'invalid-link-reference', sourceRow: 1 }),
		);
	});

	it('accepts ordered multi-link row-ID lists only when they match the declared target table', () => {
		const base = fixture();
		const shoots = tableByName(base, 'Shoots');
		const clients = tableByName(base, 'Clients');
		const adaId = clients.rows[0]?.id;
		const bobId = clients.rows[1]?.id;
		if (adaId === undefined || bobId === undefined) {
			throw new Error('the link fixture needs two client rows');
		}
		const multiLinkId = 'fld_multilinkimport';
		const document: DatabaseDocument = {
			...base,
			tables: base.tables.map((table) =>
				table.id !== shoots.id
					? table
					: {
							...table,
							fields: [
								...table.fields,
								{
									kind: 'field',
									id: multiLinkId,
									name: 'Related clients',
									type: 'link',
									settings: { targetTableId: clients.id, allowMultiple: true },
									unknown: [],
								},
							],
						},
			),
		};
		const source = preview([['Related clients'], ['Ada, Bob']]);
		const destination = {
			kind: 'append',
			tableId: shoots.id,
			fieldMapping: {
				kind: 'field-ids',
				fields: [{ sourceColumn: 0, fieldId: multiLinkId }],
			},
		} as const;
		const mapping = {
			sourceColumn: 0,
			fieldId: multiLinkId,
			targetTableId: clients.id,
			values: new Map<string, string | readonly string[]>([['Ada, Bob', [adaId, bobId]]]),
		};
		const plan = requirePlan(
			buildDatabaseImportPlan(
				document,
				source,
				destination,
				planOptions({ linkMappings: [mapping] }),
			),
		);
		expect(plan.rows[0]?.cells[0]?.value).toEqual([adaId, bobId]);

		const wrongCardinality = buildDatabaseImportPlan(
			fixture(),
			preview([['Client'], ['Ada']]),
			{
				kind: 'append',
				tableId: shoots.id,
				fieldMapping: {
					kind: 'field-ids',
					fields: [{ sourceColumn: 0, fieldId: fieldIdByName(shoots, 'Client') }],
				},
			},
			planOptions({
				linkMappings: [
					{
						sourceColumn: 0,
						fieldId: fieldIdByName(shoots, 'Client'),
						targetTableId: clients.id,
						values: new Map([['Ada', [adaId, bobId]]]),
					},
				],
			}),
		);
		expect(wrongCardinality.ok).toBe(false);
		if (wrongCardinality.ok) {
			throw new Error('a list cannot be written to a single-link field');
		}
		expect(wrongCardinality.issues).toContainEqual(
			expect.objectContaining({ code: 'invalid-link-reference' }),
		);
	});
});
