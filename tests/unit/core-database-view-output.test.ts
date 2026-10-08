/**
 * Native table/view selection composed with the pure query pipeline — R3's multi-table isolation gate.
 *
 * The database document owns each table's saved views; the query pipeline receives only the selected
 * table's stable-ID fields and rows plus that table's selected saved view. This test composes those pure
 * pieces without importing the legacy grid store or any host/UI module.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildView } from '../../src/core/view/pipeline';
import type { ViewConfig, ViewResult } from '../../src/core/view/pipeline';
import { resolveField } from '../../src/core/schema/propertySchema';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import type { RowView } from '../../src/core/query/evaluate';
import {
	cellOf,
	isInvalidCell,
	parseDocument,
	projectTable,
	viewAt,
	viewCellOf,
} from '../../src/core/database';
import type {
	ActiveTableSnapshot,
	CellState,
	DatabaseDocument,
	TableView,
} from '../../src/core/database';
import type { CellValue, FieldContext } from '../../src/core/types';

function fixtureText(): string {
	return readFileSync(new URL('../fixtures/tablify/rows-views.tablify', import.meta.url), 'utf8');
}

function fixture(): DatabaseDocument {
	const loaded = parseDocument(fixtureText());
	if (!loaded.ok) {
		throw new Error('the two-table rows-views fixture must parse');
	}
	return loaded.document;
}

function idAt(entries: readonly { readonly id: string | null }[], index: number): string {
	const id = entries[index]?.id;
	if (id === undefined || id === null) {
		throw new Error(`fixture entry ${String(index)} must have an id`);
	}
	return id;
}

function snapshotOf(document: DatabaseDocument, tableId: string): ActiveTableSnapshot {
	const snapshot = projectTable(document, tableId);
	if (snapshot === null) {
		throw new Error(`fixture table ${tableId} must exist`);
	}
	return snapshot;
}

const baseContext: FieldContext = {
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
	columnName: '',
};

/** Transient adapter into the shared resolver; the native document model has no source key. */
function queryFields(snapshot: ActiveTableSnapshot): readonly ResolvedField[] {
	return snapshot.fields.flatMap((field) => {
		if (field.kind !== 'field' || field.id === null) {
			return [];
		}
		return [
			resolveField(
				{
					id: field.id,
					name: field.name,
					source: 'database',
					fieldOptions: { type: field.type, ...field.settings },
				},
				baseContext,
			),
		];
	});
}

function queryValue(value: CellState | undefined): CellValue {
	if (value === undefined || isInvalidCell(value)) {
		return null;
	}
	return value;
}

function queryRows(snapshot: ActiveTableSnapshot): readonly RowView[] {
	return snapshot.rows.map((row) => {
		const cells: Record<string, CellValue> = {};
		for (const field of snapshot.fields) {
			if (field.id !== null) {
				cells[field.id] = queryValue(viewCellOf(snapshot, row.id, field.id));
			}
		}
		return { rowId: row.id, cells };
	});
}

function viewConfig(view: TableView): ViewConfig {
	return {
		sorts: view.sorts.map(({ fieldId, direction }) => ({ fieldId, direction })),
		...(view.groupBy === null ? {} : { groupBy: view.groupBy }),
		hiddenFieldIds: view.hiddenFieldIds,
		columnOrder: view.columnOrder,
		collapsedKeys: view.collapsedKeys,
	};
}

function outputFor(snapshot: ActiveTableSnapshot, viewId: string): ViewResult {
	const selected = viewAt(snapshot, viewId);
	if (selected === undefined) {
		throw new Error(`view ${viewId} must belong to table ${snapshot.tableId}`);
	}
	return buildView({
		fields: queryFields(snapshot),
		rows: queryRows(snapshot),
		view: viewConfig(selected),
		queryAst: selected.filterExpr,
	});
}

describe('multi-table saved-view query output', () => {
	it('filters, sorts, groups, and hides fields only for the selected table and saved view', () => {
		const document = fixture();
		const shootsTable = document.tables[0];
		const clientsTable = document.tables[1];
		if (shootsTable === undefined || clientsTable === undefined) {
			throw new Error('the fixture must have Shoots and Clients tables');
		}
		const shoots = snapshotOf(document, shootsTable.id);
		const clients = snapshotOf(document, clientsTable.id);
		const sortedId = idAt(shoots.views, 0);
		const groupedFilterId = idAt(shoots.views, 1);
		const rowOne = idAt(shoots.rows, 0);
		const rowTwo = idAt(shoots.rows, 1);
		const rowThree = idAt(shoots.rows, 2);

		const sorted = outputFor(shoots, sortedId);
		const filteredAndGrouped = outputFor(shoots, groupedFilterId);
		const clientRows = buildView({
			fields: queryFields(clients),
			rows: queryRows(clients),
			view: {},
			queryAst: null,
		});

		expect(sorted.rows.map((row) => row.rowId)).toEqual([rowOne, rowTwo, rowThree]);
		expect(sorted.totalRows).toBe(3);
		expect(sorted.matchedRows).toBe(3);
		expect(filteredAndGrouped.rows.map((row) => row.rowId)).toEqual([rowThree]);
		expect(filteredAndGrouped.totalRows).toBe(3);
		expect(filteredAndGrouped.matchedRows).toBe(1);
		expect(filteredAndGrouped.hiddenFieldIds).toContain(idAt(shoots.fields, 6));
		expect(filteredAndGrouped.groups.map((group) => group.key)).toEqual(['']);
		expect(filteredAndGrouped.groups[0]?.rows.map((row) => row.rowId)).toEqual([rowThree]);

		// The Clients table has no saved views. Neither the Shoots filter nor its group state leaks across.
		expect(clients.views).toEqual([]);
		expect(viewAt(clients, sortedId)).toBeUndefined();
		expect(clientRows.rows.map((row) => row.rowId)).toEqual(clients.rows.map((row) => row.id));
		expect(clientRows.totalRows).toBe(2);
		expect(clientRows.matchedRows).toBe(2);
		expect(clientRows.groups).toEqual([]);
	});

	it('resolves native time fields from row metadata as read-only descriptors', () => {
		const loaded = parseDocument(
			readFileSync(
				new URL('../fixtures/tablify/all-field-types.tablify', import.meta.url),
				'utf8',
			),
		);
		if (!loaded.ok) {
			throw new Error('the all-field-types fixture must parse');
		}
		const document = loaded.document;
		const table = document.tables[0];
		if (table === undefined) {
			throw new Error('the fixture must contain its primary table');
		}
		const snapshot = snapshotOf(document, table.id);
		const rowId = idAt(snapshot.rows, 0);
		const createdField = snapshot.fields.find(
			(field) => field.kind === 'field' && field.type === 'createdTime',
		);
		const modifiedField = snapshot.fields.find(
			(field) => field.kind === 'field' && field.type === 'lastModifiedTime',
		);
		if (createdField?.kind !== 'field' || modifiedField?.kind !== 'field') {
			throw new Error('the fixture must contain both native timestamp fields');
		}
		const fields = queryFields(snapshot);
		const created = fields.find((field) => field.definition.id === createdField.id);
		const modified = fields.find((field) => field.definition.id === modifiedField.id);
		const createdValue = viewCellOf(snapshot, rowId, createdField.id);
		const modifiedValue = viewCellOf(snapshot, rowId, modifiedField.id);
		if (
			created === undefined ||
			modified === undefined ||
			typeof createdValue !== 'string' ||
			typeof modifiedValue !== 'string'
		) {
			throw new Error('the fixture must provide row-owned timestamp metadata');
		}

		expect(createdValue).toBe('2026-01-02T09:00:00Z');
		expect(modifiedValue).toBe('2026-01-03T10:30:00+01:00');
		expect(cellOf(snapshot, rowId, createdField.id)).toBeUndefined();
		expect(cellOf(snapshot, rowId, modifiedField.id)).toBeUndefined();
		expect(created.descriptor.id).toBe('createdTime');
		expect(modified.descriptor.id).toBe('lastModifiedTime');
		expect(created.readOnly).toBe(true);
		expect(modified.readOnly).toBe(true);
		expect(created.descriptor.formatDisplay(createdValue, created.context)).not.toBe('');
		expect(created.descriptor.groupKey(createdValue, created.context)).toBe('2026-01-02');
		expect(created.descriptor.toJson(createdValue, created.context)).toBeNull();

		// The transient `database` adapter tag must not accidentally make ordinary fields read-only.
		const title = fields.find((field) => field.definition.name === 'Title');
		expect(title?.readOnly).toBe(false);
	});
});
