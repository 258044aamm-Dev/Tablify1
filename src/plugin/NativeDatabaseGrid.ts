/**
 * Native DOM renderer for the active `.tablify` table.
 *
 * This deliberately does not import React or mount the legacy `GridView`: the native FileView reads the
 * canonical `DatabaseStoreSnapshot`, derives its query output, and renders stable row/field IDs directly.
 * Field formatting and query evaluation reuse the existing pure descriptor and pipeline contracts. The
 * row window is likewise the existing pure arithmetic, not a second virtualization rule.
 */
import type { DatabaseStore, DatabaseStoreSnapshot } from '../adapters/tablifyFile';
import { viewCellOf } from '../core/database/projection';
import type { ActiveTableSnapshot } from '../core/database/projection';
import type { FieldDefinition, TableField } from '../core/database/fields';
import { createRelationInspector } from '../core/database/relations';
import type { RelationInspector } from '../core/database/relations';
import type { DatabaseDocument, DatabaseTable } from '../core/database/schema';
import { isInvalidCell } from '../core/database/values';
import type { TableView } from '../core/database/views';
import type { TableRow } from '../core/database/rows';
import { resolveField } from '../core/schema/propertySchema';
import type { PropertyDefinition, ResolvedField } from '../core/schema/propertySchema';
import { isFieldTypeId } from '../core/types';
import type { CellValue, EditorId, FieldContext, FieldOption, FieldOptions } from '../core/types';
import type { CellState } from '../core/database/rows';
import { buildView } from '../core/view/pipeline';
import type { ViewResult } from '../core/view/pipeline';
import type { RowView } from '../core/query/evaluate';
import type { CellEdit, DatabaseOperation } from '../core/database/operations';
import type { Matrix } from '../core/selection/clipboard';
import { fromHtml, fromTsv, toHtml, toTsv } from '../core/selection/clipboard';
import type { CellValue as ClipboardCellValue } from '../core/types';
import { Notice } from 'obsidian';
import { rowHeightOf, rowWindow } from '../grid/store/window';
import type { RowDensity } from '../grid/store/window';

export interface NativeGridEnvironment {
	readonly now: () => number;
	readonly timezone: string;
	readonly locale: string;
}

interface NativeColumn {
	readonly field: ResolvedField;
	readonly stored: TableField;
}

interface NativeDataItem {
	readonly kind: 'data';
	readonly rowId: string;
	readonly resultIndex: number;
}

interface NativeGroupItem {
	readonly kind: 'group';
	readonly key: string;
	readonly label: string;
	readonly count: number;
}

type NativeGridItem = NativeDataItem | NativeGroupItem;

interface NativeGridModel {
	readonly databaseId: string;
	readonly document: DatabaseDocument;
	readonly key: string;
	readonly table: DatabaseTable;
	readonly activeTable: ActiveTableSnapshot;
	readonly view: TableView | null;
	readonly columns: readonly NativeColumn[];
	readonly visibleColumns: readonly NativeColumn[];
	readonly result: ViewResult;
	readonly items: readonly NativeGridItem[];
	readonly visibleRows: readonly RowView[];
	readonly rowItemIndex: ReadonlyMap<string, number>;
	readonly rowsByTableId: ReadonlyMap<string, ReadonlyMap<string, TableRow>>;
	readonly labelColumnsByTableId: ReadonlyMap<string, readonly NativeColumn[]>;
	readonly relationInspector: RelationInspector;
	readonly generatedInverseRowsByCell: ReadonlyMap<string, readonly NativeInverseRow[]>;
	readonly density: RowDensity;
	readonly notes: readonly string[];
}

/** A rectangle of visible cells, in visible-row and visible-column indices. */
interface NativeCellRange {
	readonly rows: readonly RowView[];
	readonly columns: readonly NativeColumn[];
	readonly top: number;
	readonly bottom: number;
	readonly left: number;
	readonly right: number;
	readonly rowIndex: ReadonlyMap<string, number>;
}

interface NativeCellSelection {
	readonly databaseId: string;
	readonly tableId: string;
	readonly rowId: string;
	readonly fieldId: string;
}

type NativeEditDraft = string | boolean | readonly string[];

interface NativeCellEditor extends NativeCellSelection {
	readonly draft: NativeEditDraft;
	readonly error: string | null;
	readonly search: string;
}

interface NativeGridContext {
	readonly scroll: HTMLElement;
	readonly grid: HTMLTableElement;
	readonly body: HTMLTableSectionElement;
	readonly model: NativeGridModel;
	readonly rowHeight: number;
	readonly store: DatabaseStore;
}

interface NativeLinkChoice {
	readonly id: string;
	readonly label: string;
	readonly broken: boolean;
}

interface NativeInverseRow {
	readonly tableId: string;
	readonly rowId: string;
	readonly label: string;
}

interface NativeGridNavigationTarget {
	readonly tableId: string;
	readonly rowId: string;
}

let nextGridInstance = 0;
const HEADER_HEIGHT = 40;
const DEFAULT_COLUMN_WIDTH = 180;

function optionsFor(field: FieldDefinition): FieldOptions {
	const settings = field.settings;
	const options: FieldOptions = {
		type: field.type,
		...(settings.max === undefined ? {} : { max: settings.max }),
		...(settings.symbol === undefined ? {} : { symbol: settings.symbol }),
		...(settings.precision === undefined ? {} : { precision: settings.precision }),
		...(settings.unit === undefined ? {} : { unit: settings.unit }),
		...(settings.options === undefined
			? {}
			: {
					options: settings.options.map((option): FieldOption =>
						option.color === null
							? { id: option.id, name: option.name }
							: { id: option.id, name: option.name, color: option.color },
					),
				}),
	};
	return options;
}

function resolveNativeColumn(
	stored: TableField,
	environment: NativeGridEnvironment,
): NativeColumn | null {
	if (stored.id === null) {
		return null;
	}
	const name = stored.kind === 'unsupported' ? (stored.name ?? stored.typeName) : stored.name;
	const fieldOptions =
		stored.kind === 'unsupported' ? { type: stored.typeName } : optionsFor(stored);
	const definition: PropertyDefinition = {
		id: stored.id,
		name,
		source: 'database',
		fieldOptions,
	};
	const context: FieldContext = {
		now: environment.now,
		timezone: environment.timezone,
		locale: environment.locale,
		fieldOptions,
		columnName: name,
	};
	const resolved = resolveField(definition, context);
	if (stored.kind === 'unsupported') {
		return {
			stored,
			field: {
				...resolved,
				readOnly: true,
				reasons: [...resolved.reasons, 'this field type is not supported by this build'],
			},
		};
	}
	if (!isFieldTypeId(stored.type)) {
		// `link` stays outside the scalar field descriptor contract. Its labels, relation state and
		// selection editor use the canonical database model directly below, never the text descriptor.
		return {
			stored,
			field: {
				...resolved,
				readOnly: true,
				reasons: [
					...resolved.reasons,
					'link presentation and editing are handled by the linked-record step',
				],
			},
		};
	}
	return { stored, field: resolved };
}

function gridValue(activeTable: ActiveTableSnapshot, rowId: string, fieldId: string): CellValue {
	const stored = viewCellOf(activeTable, rowId, fieldId);
	if (stored === undefined || stored === null || isInvalidCell(stored)) {
		return null;
	}
	return stored;
}

/** True when the event came from an open cell editor, whose own text input keeps its native clipboard. */
function isInsideEditor(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest('[data-native-editor]') !== null;
}

function editorOf(field: ResolvedField): EditorId {
	return field.descriptor.editor ?? 'text';
}

function isStringList(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

function editDraftOf(field: ResolvedField, value: CellState | undefined): NativeEditDraft | null {
	if (
		field.readOnly ||
		!field.descriptor.editable ||
		(value !== undefined && isInvalidCell(value))
	) {
		return null;
	}
	const current = value ?? null;
	switch (editorOf(field)) {
		case 'readonly':
			return null;
		case 'checkbox':
			return current === true;
		case 'select':
			return typeof current === 'string'
				? current
				: (field.options.options?.length ?? 0) > 0
					? ''
					: null;
		case 'multiSelect':
			return isStringList(current)
				? [...current]
				: (field.options.options?.length ?? 0) > 0
					? []
					: null;
		default:
			return field.descriptor.formatPlain(current, field.context);
	}
}

function isLinkColumn(column: NativeColumn): column is NativeColumn & {
	readonly stored: FieldDefinition & { readonly type: 'link' };
} {
	return column.stored.kind === 'field' && column.stored.type === 'link';
}

const UNEDITABLE_LINK_FINDINGS = new Set([
	'missing-target-table',
	'generated-field',
	'unreadable-value',
	'duplicate-reference',
	'cardinality-mismatch',
]);

function linkDraftOf(
	model: NativeGridModel,
	column: NativeColumn,
	rowId: string,
): readonly string[] | null {
	if (!isLinkColumn(column) || column.stored.settings.generated === true) {
		return null;
	}
	const targetTableId = column.stored.settings.targetTableId;
	if (
		targetTableId === undefined ||
		!model.document.tables.some((table) => table.id === targetTableId)
	) {
		return null;
	}
	const inspection = model.relationInspector.inspectLinkCell(
		model.table.id,
		rowId,
		column.stored.id,
	);
	if (
		inspection === undefined ||
		inspection.state === 'unreadable' ||
		inspection.findings.some((finding) => UNEDITABLE_LINK_FINDINGS.has(finding.code))
	) {
		return null;
	}
	// Missing/foreign row IDs are deliberately retained in the draft so the user can remove them; a
	// no-op commit does not rewrite them, and a new selection is validated by the core operation.
	return inspection.references.map((reference) => reference.id);
}

function editDraftFor(
	model: NativeGridModel,
	column: NativeColumn,
	rowId: string,
	value: CellState | undefined,
): NativeEditDraft | null {
	return isLinkColumn(column)
		? linkDraftOf(model, column, rowId)
		: editDraftOf(column.field, value);
}

function sameLinkSelection(current: CellState | undefined, rowIds: readonly string[]): boolean {
	if (current === undefined || current === null) {
		return rowIds.length === 0;
	}
	const currentIds =
		typeof current === 'string' ? [current] : isStringList(current) ? current : null;
	return (
		currentIds !== null &&
		currentIds.length === rowIds.length &&
		currentIds.every((id, index) => id === rowIds[index])
	);
}

function linkCellValue(
	column: NativeColumn & { readonly stored: FieldDefinition & { readonly type: 'link' } },
	rowIds: readonly string[],
): CellValue {
	if (rowIds.length === 0) {
		return null;
	}
	return column.stored.settings.allowMultiple === true ? [...rowIds] : (rowIds[0] ?? null);
}

function rowLabelFromMaps(
	rowsByTableId: ReadonlyMap<string, ReadonlyMap<string, TableRow>>,
	labelColumnsByTableId: ReadonlyMap<string, readonly NativeColumn[]>,
	tableId: string,
	rowId: string,
): string {
	const row = rowsByTableId.get(tableId)?.get(rowId);
	if (row === undefined) {
		return `Missing row · ${rowId}`;
	}
	for (const column of labelColumnsByTableId.get(tableId) ?? []) {
		const value = row.cells.get(column.field.definition.id);
		if (value === undefined || value === null || isInvalidCell(value)) {
			continue;
		}
		const label = displayCellValue(column, value).trim();
		if (label !== '') {
			return label;
		}
	}
	return `Row ${rowId}`;
}

function rowLabel(model: NativeGridModel, tableId: string, rowId: string): string {
	return rowLabelFromMaps(model.rowsByTableId, model.labelColumnsByTableId, tableId, rowId);
}

function inverseRowsKey(tableId: string, fieldId: string, rowId: string): string {
	return `${tableId}|${fieldId}|${rowId}`;
}

function generatedInverseRowsByCell(
	document: DatabaseDocument,
	rowsByTableId: ReadonlyMap<string, ReadonlyMap<string, TableRow>>,
	labelColumnsByTableId: ReadonlyMap<string, readonly NativeColumn[]>,
	relationInspector: RelationInspector,
): ReadonlyMap<string, readonly NativeInverseRow[]> {
	const rowsByKey = new Map<string, NativeInverseRow[]>();
	const seenByKey = new Map<string, Set<string>>();
	for (const sourceTable of document.tables) {
		for (const owner of sourceTable.fields) {
			if (
				owner.kind !== 'field' ||
				owner.type !== 'link' ||
				owner.settings.generated === true ||
				owner.settings.targetTableId === undefined ||
				owner.settings.inverseFieldId === undefined
			) {
				continue;
			}
			const targetTable = document.tables.find(
				(table) => table.id === owner.settings.targetTableId,
			);
			const inverse = targetTable?.fields.find(
				(field) => field.id === owner.settings.inverseFieldId,
			);
			if (
				targetTable === undefined ||
				inverse?.kind !== 'field' ||
				inverse.type !== 'link' ||
				inverse.settings.generated !== true ||
				inverse.settings.targetTableId !== sourceTable.id
			) {
				continue;
			}
			for (const sourceRow of sourceTable.rows) {
				const inspection = relationInspector.inspectLinkCell(
					sourceTable.id,
					sourceRow.id,
					owner.id,
				);
				for (const reference of inspection?.references ?? []) {
					if (
						reference.state !== 'resolved' ||
						reference.ownerTableId !== targetTable.id
					) {
						continue;
					}
					const key = inverseRowsKey(targetTable.id, inverse.id, reference.id);
					const sourceKey = `${sourceTable.id}|${sourceRow.id}`;
					const seen = seenByKey.get(key) ?? new Set<string>();
					if (seen.has(sourceKey)) {
						continue;
					}
					seen.add(sourceKey);
					seenByKey.set(key, seen);
					const rows = rowsByKey.get(key) ?? [];
					rows.push({
						tableId: sourceTable.id,
						rowId: sourceRow.id,
						label: `${sourceTable.name}: ${rowLabelFromMaps(
							rowsByTableId,
							labelColumnsByTableId,
							sourceTable.id,
							sourceRow.id,
						)}`,
					});
					rowsByKey.set(key, rows);
				}
			}
		}
	}
	return rowsByKey;
}

function generatedInverseRows(
	model: NativeGridModel,
	rowId: string,
	field: FieldDefinition & { readonly type: 'link' },
): readonly NativeInverseRow[] {
	return (
		model.generatedInverseRowsByCell.get(inverseRowsKey(model.table.id, field.id, rowId)) ?? []
	);
}

function sameCellValue(left: CellState | undefined, right: CellValue): boolean {
	if (left === undefined || left === null) {
		return right === null;
	}
	if (isInvalidCell(left)) {
		return false;
	}
	if (isStringList(left) || isStringList(right)) {
		return (
			isStringList(left) &&
			isStringList(right) &&
			left.length === right.length &&
			left.every((item, index) => item === right[index])
		);
	}
	return left === right;
}

function displayCellValue(column: NativeColumn, value: CellState | undefined): string {
	if (value === undefined || value === null) {
		return '';
	}
	if (isInvalidCell(value)) {
		const serialized = JSON.stringify(value.raw) ?? 'null';
		return `Invalid value · ${serialized}`;
	}
	if (column.stored.kind === 'field' && column.stored.type === 'singleSelect') {
		if (typeof value !== 'string') {
			return column.field.descriptor.formatDisplay(value, column.field.context);
		}
		return (
			column.field.options.options?.find((option) => option.id === value)?.name ??
			`Unknown option · ${value}`
		);
	}
	if (column.stored.kind === 'field' && column.stored.type === 'multiSelect') {
		if (!isStringList(value)) {
			return column.field.descriptor.formatDisplay(value, column.field.context);
		}
		return value
			.map(
				(id) =>
					column.field.options.options?.find((option) => option.id === id)?.name ??
					`Unknown option · ${id}`,
			)
			.join(', ');
	}
	return column.field.descriptor.formatDisplay(value, column.field.context);
}

function queryValueOf(column: NativeColumn, value: CellValue): CellValue {
	if (column.stored.kind !== 'field') {
		return value;
	}
	const options = column.field.options.options ?? [];
	if (column.stored.type === 'singleSelect' && typeof value === 'string') {
		return options.find((option) => option.id === value)?.name ?? value;
	}
	if (column.stored.type === 'multiSelect' && isStringList(value)) {
		return value.map((id) => options.find((option) => option.id === id)?.name ?? id);
	}
	return value;
}

function rowViewOf(
	activeTable: ActiveTableSnapshot,
	rowId: string,
	columns: readonly NativeColumn[],
): RowView {
	const cells: Record<string, CellValue> = {};
	for (const column of columns) {
		const fieldId = column.field.definition.id;
		cells[fieldId] = queryValueOf(column, gridValue(activeTable, rowId, fieldId));
	}
	return { rowId, cells };
}

function modelOf(
	snapshot: DatabaseStoreSnapshot,
	selectedViewId: string | null,
	environment: NativeGridEnvironment,
): NativeGridModel | null {
	const activeTable = snapshot.activeTable;
	if (activeTable === null) {
		return null;
	}
	const table = activeTable.table;
	const view =
		selectedViewId === null
			? null
			: (table.views.find((candidate) => candidate.id === selectedViewId) ?? null);
	const columnsByTableId = new Map<string, readonly NativeColumn[]>();
	for (const documentTable of snapshot.document.tables) {
		const tableColumns = documentTable.fields.flatMap((stored) => {
			const resolved = resolveNativeColumn(stored, environment);
			return resolved === null ? [] : [resolved];
		});
		columnsByTableId.set(documentTable.id, tableColumns);
	}
	const columns = columnsByTableId.get(table.id) ?? [];
	const labelColumnsByTableId = new Map<string, readonly NativeColumn[]>();
	const rowsByTableId = new Map<string, ReadonlyMap<string, TableRow>>();
	for (const documentTable of snapshot.document.tables) {
		labelColumnsByTableId.set(
			documentTable.id,
			(columnsByTableId.get(documentTable.id) ?? []).filter(
				(column) =>
					column.stored.kind === 'field' &&
					column.stored.type !== 'link' &&
					column.stored.type !== 'createdTime' &&
					column.stored.type !== 'lastModifiedTime',
			),
		);
		rowsByTableId.set(
			documentTable.id,
			new Map(documentTable.rows.map((row) => [row.id, row])),
		);
	}
	const relationInspector = createRelationInspector(snapshot.document);
	const derivedRowsByCell = generatedInverseRowsByCell(
		snapshot.document,
		rowsByTableId,
		labelColumnsByTableId,
		relationInspector,
	);
	const rowViews = activeTable.rows.map((row) => rowViewOf(activeTable, row.id, columns));
	const result = buildView({
		fields: columns.map((column) => column.field),
		rows: rowViews,
		view:
			view === null
				? {}
				: {
						sorts: view.sorts.map(({ fieldId, direction }) => ({ fieldId, direction })),
						...(view.groupBy === null ? {} : { groupBy: view.groupBy }),
						collapsedKeys: view.collapsedKeys,
						hiddenFieldIds: view.hiddenFieldIds,
						columnOrder: view.columnOrder,
					},
		queryAst: view?.filterExpr ?? null,
	});
	const byId = new Map(columns.map((column) => [column.field.definition.id, column]));
	const visibleColumns = result.columnOrder
		.filter((fieldId) => !result.hiddenFieldIds.includes(fieldId))
		.flatMap((fieldId) => {
			const column = byId.get(fieldId);
			return column === undefined ? [] : [column];
		});
	const resultIndex = new Map(result.rows.map((row, index) => [row.rowId, index]));
	const items: NativeGridItem[] = [];
	if (result.groups.length > 0) {
		for (const group of result.groups) {
			items.push({ kind: 'group', key: group.key, label: group.label, count: group.count });
			if (!group.collapsed) {
				for (const row of group.rows) {
					const index = resultIndex.get(row.rowId);
					if (index !== undefined) {
						items.push({ kind: 'data', rowId: row.rowId, resultIndex: index });
					}
				}
			}
		}
	} else {
		for (const [index, row] of result.rows.entries()) {
			items.push({ kind: 'data', rowId: row.rowId, resultIndex: index });
		}
	}
	const rowItemIndex = new Map<string, number>();
	const visibleRows: RowView[] = [];
	items.forEach((item, index) => {
		if (item.kind === 'data') {
			rowItemIndex.set(item.rowId, index);
			const row = result.rows[item.resultIndex];
			if (row !== undefined) {
				visibleRows.push(row);
			}
		}
	});
	const notes: string[] = [];
	const unaddressableCount = table.fields.filter((field) => field.id === null).length;
	if (unaddressableCount > 0) {
		notes.push(`${String(unaddressableCount)} field(s) without stable IDs are omitted.`);
	}
	const unsupportedCount = table.fields.filter((field) => field.kind === 'unsupported').length;
	if (unsupportedCount > 0) {
		notes.push('Unsupported field types are shown read-only where their IDs are available.');
	}
	if (columns.some((column) => isLinkColumn(column))) {
		notes.push(
			'Linked-record labels use the first non-empty supported non-link, non-timestamp field in target-field order; if none is available, the row ID is shown. This is a display convention only, not a primary-field setting.',
		);
	}
	if (view !== null && view.filterProblems.length > 0) {
		notes.push(
			`Some saved filter details could not be read: ${view.filterProblems.join('; ')}`,
		);
	}
	return {
		databaseId: snapshot.document.databaseId,
		document: snapshot.document,
		key: `${snapshot.document.databaseId}\u0000${table.id}`,
		table,
		activeTable,
		view,
		columns,
		visibleColumns,
		result,
		items,
		visibleRows,
		rowItemIndex,
		rowsByTableId,
		labelColumnsByTableId,
		relationInspector,
		generatedInverseRowsByCell: derivedRowsByCell,
		density: view?.density ?? 'medium',
		notes,
	};
}

function cellDomId(prefix: string, rowId: string, fieldId: string): string {
	return `${prefix}-cell-${rowId}-${fieldId}`;
}

function timestampFor(environment: NativeGridEnvironment): string | null {
	const date = new Date(environment.now());
	return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** One native DOM grid per FileView instance; selection and scroll are keyed by stable table/row/field ids. */
export class NativeDatabaseGrid {
	private readonly instanceId = `tablify-native-grid-${String(nextGridInstance++)}`;
	private tableKey: string | null = null;
	private selection: NativeCellSelection | null = null;
	/** Other corner of a shift-extended range; the active cell is the focus corner. */
	private rangeAnchor: NativeCellSelection | null = null;
	private renderedRange: NativeCellRange | null = null;
	private editing: NativeCellEditor | null = null;
	private context: NativeGridContext | null = null;
	private readonly scrollTopByTable = new Map<string, number>();
	private pendingNavigation: NativeGridNavigationTarget | null = null;
	private onNavigateToRow: (tableId: string, rowId: string) => void = () => undefined;

	constructor(private readonly environment: NativeGridEnvironment) {}

	/** Queue selection/scroll for a linked row before the target table is rendered. */
	navigateToRecord(tableId: string, rowId: string): void {
		this.pendingNavigation = { tableId, rowId };
	}

	/** Commit a draft before pane-level navigation; return false without changing panes on validation failure. */
	commitPending(): boolean {
		const context = this.context;
		if (this.editing === null) {
			return true;
		}
		if (context === null) {
			return false;
		}
		return this.commitEditor(
			undefined,
			context.scroll,
			context.grid,
			context.body,
			context.model,
			context.rowHeight,
			context.store,
		);
	}

	/** Explicit disk reload discards only the uncommitted editor draft; document state stays untouched. */
	cancelPending(): void {
		const context = this.context;
		if (this.editing === null) {
			return;
		}
		this.editing = null;
		if (context !== null) {
			this.renderRows(
				context.scroll,
				context.grid,
				context.body,
				context.model,
				context.rowHeight,
				context.store,
			);
			context.grid.focus({ preventScroll: true });
		}
	}

	render(
		host: HTMLElement,
		store: DatabaseStore,
		snapshot: DatabaseStoreSnapshot,
		selectedViewId: string | null,
		onNavigateToRow: (tableId: string, rowId: string) => void = () => undefined,
	): void {
		this.context = null;
		this.onNavigateToRow = onNavigateToRow;
		let focusGridAfterRender = false;
		const model = modelOf(snapshot, selectedViewId, this.environment);
		const nextTableKey = model?.key ?? null;
		if (this.tableKey !== nextTableKey) {
			this.tableKey = nextTableKey;
			this.selection = null;
			this.editing = null;
		}
		const pendingNavigation = this.pendingNavigation;
		if (model !== null && pendingNavigation?.tableId === model.table.id) {
			this.pendingNavigation = null;
			if (model.activeTable.rowById.has(pendingNavigation.rowId)) {
				const firstColumn = model.visibleColumns[0];
				if (firstColumn !== undefined) {
					this.selection = {
						databaseId: model.databaseId,
						tableId: model.table.id,
						rowId: pendingNavigation.rowId,
						fieldId: firstColumn.field.definition.id,
					};
				}
				const itemIndex = model.rowItemIndex.get(pendingNavigation.rowId);
				if (itemIndex !== undefined) {
					this.scrollTopByTable.set(
						model.key,
						Math.max(0, itemIndex * rowHeightOf(model.density)),
					);
				}
				focusGridAfterRender = true;
			}
		}
		if (
			this.editing !== null &&
			(model === null ||
				this.editing.databaseId !== model.databaseId ||
				this.editing.tableId !== model.table.id ||
				!model.visibleRows.some((row) => row.rowId === this.editing?.rowId) ||
				!model.visibleColumns.some(
					(column) => column.field.definition.id === this.editing?.fieldId,
				))
		) {
			this.editing = null;
		}
		if (
			this.selection !== null &&
			(model === null ||
				this.selection.databaseId !== model.databaseId ||
				this.selection.tableId !== model.table.id ||
				!model.visibleRows.some((row) => row.rowId === this.selection?.rowId) ||
				!model.visibleColumns.some(
					(column) => column.field.definition.id === this.selection?.fieldId,
				))
		) {
			this.selection = null;
		}

		host.empty();
		host.setAttribute('role', 'region');
		host.addClass('tablify-grid-area');
		host.addClass('tablify-native-grid');
		if (model === null) {
			host.setAttribute('aria-label', 'Table grid');
			const empty = host.createDiv({ cls: 'tablify-native-grid-placeholder' });
			empty.createEl('h2', { text: 'No tables yet' });
			empty.createEl('p', {
				text: 'Create a table to start organizing records in this database.',
			});
			return;
		}

		const viewTitle = model.view === null ? '' : ` — ${model.view.name}`;
		const accessibleTitle = `Grid for ${model.table.name}${viewTitle}`;
		host.setAttribute('aria-label', accessibleTitle);
		const rowHeight = rowHeightOf(model.density);
		host.style.setProperty('--tablify-row-h', `${String(rowHeight)}px`);
		const scroll = host.createDiv({ cls: 'tablify-native-grid-scroll' });
		const grid = scroll.createEl('table', { cls: 'tablify-native-grid-table' });
		grid.id = this.instanceId;
		grid.tabIndex = 0;
		grid.setAttribute('role', 'grid');
		grid.setAttribute('aria-label', accessibleTitle);
		grid.setAttribute('aria-readonly', 'false');
		grid.setAttribute('aria-rowcount', String(model.items.length + 1));
		grid.setAttribute('aria-colcount', String(model.visibleColumns.length + 1));
		grid.setAttribute('data-table-id', model.table.id);
		grid.setAttribute('data-view-id', model.view?.id ?? '');
		grid.setAttribute('data-focus-key', 'native-grid');

		const head = grid.createEl('thead');
		head.setAttribute('role', 'rowgroup');
		const header = head.createEl('tr');
		header.setAttribute('role', 'row');
		header.setAttribute('aria-rowindex', '1');
		const rowHeader = header.createEl('th', { cls: 'tablify-native-row-number' });
		rowHeader.setAttribute('role', 'columnheader');
		rowHeader.setAttribute('aria-label', 'Row number');
		rowHeader.setAttribute('aria-colindex', '1');
		rowHeader.setText('#');
		for (const [index, column] of model.visibleColumns.entries()) {
			const fieldId = column.field.definition.id;
			const cell = header.createEl('th', { cls: 'tablify-native-column-header' });
			cell.setAttribute('role', 'columnheader');
			cell.setAttribute('aria-colindex', String(index + 2));
			cell.setAttribute('data-field-id', fieldId);
			cell.setAttribute('title', column.field.definition.name);
			cell.setText(column.field.definition.name);
			cell.style.width = `${String(model.view?.widths.get(fieldId) ?? DEFAULT_COLUMN_WIDTH)}px`;
		}

		const body = grid.createEl('tbody');
		body.setAttribute('role', 'rowgroup');
		this.context = { scroll, grid, body, model, rowHeight, store };
		const savedScroll = this.scrollTopByTable.get(model.key) ?? 0;
		scroll.scrollTop = savedScroll;
		const renderRows = (): void => {
			this.renderRows(scroll, grid, body, model, rowHeight, store);
		};
		scroll.addEventListener('scroll', () => {
			this.scrollTopByTable.set(model.key, scroll.scrollTop);
			renderRows();
		});
		grid.addEventListener('click', (event: MouseEvent) => {
			const target = event.target;
			if (
				!(target instanceof Element) ||
				target.closest('[data-native-editor], [data-link-navigation]') !== null
			) {
				return;
			}
			const cell = target.closest<HTMLElement>('[data-row-id][data-field-id]');
			const rowId = cell?.getAttribute('data-row-id');
			const fieldId = cell?.getAttribute('data-field-id');
			if (
				rowId === null ||
				rowId === undefined ||
				fieldId === null ||
				fieldId === undefined
			) {
				return;
			}
			this.rangeAnchor = null;
			const nextSelection = {
				databaseId: model.databaseId,
				tableId: model.table.id,
				rowId,
				fieldId,
			};
			if (this.editing !== null) {
				this.commitEditor(nextSelection, scroll, grid, body, model, rowHeight, store);
				return;
			}
			this.activate(nextSelection, scroll, grid, body, model, rowHeight, store);
		});
		grid.addEventListener('dblclick', (event: MouseEvent) => {
			const target = event.target;
			if (
				!(target instanceof Element) ||
				target.closest('[data-native-editor], [data-link-navigation]') !== null
			) {
				return;
			}
			const cell = target.closest<HTMLElement>('[data-row-id][data-field-id]');
			const rowId = cell?.getAttribute('data-row-id');
			const fieldId = cell?.getAttribute('data-field-id');
			if (
				rowId !== null &&
				rowId !== undefined &&
				fieldId !== null &&
				fieldId !== undefined
			) {
				this.beginEdit(
					{ databaseId: model.databaseId, tableId: model.table.id, rowId, fieldId },
					scroll,
					grid,
					body,
					model,
					rowHeight,
					store,
				);
			}
		});
		grid.addEventListener('keydown', (event: KeyboardEvent) => {
			this.onKeyDown(event, scroll, grid, body, model, rowHeight, store);
		});
		grid.addEventListener('copy', (event: ClipboardEvent) => {
			this.onClipboardCopy(event, model, store, false);
		});
		grid.addEventListener('cut', (event: ClipboardEvent) => {
			this.onClipboardCopy(event, model, store, true);
		});
		grid.addEventListener('paste', (event: ClipboardEvent) => {
			if (this.editing !== null || isInsideEditor(event.target)) {
				return;
			}
			const data = event.clipboardData;
			const html = data?.getData('text/html') ?? '';
			const matrix =
				(html === '' ? null : fromHtml(html)) ?? fromTsv(data?.getData('text/plain') ?? '');
			if ((matrix[0]?.length ?? 0) === 0) {
				return;
			}
			event.preventDefault();
			this.pasteMatrix(matrix, model, store);
		});
		renderRows();
		if (focusGridAfterRender) {
			grid.focus({ preventScroll: true });
		}

		const notes = [...model.notes];
		if (model.visibleColumns.length === 0) {
			notes.unshift('This table has no addressable fields yet.');
		}
		if (notes.length > 0) {
			const note = host.createDiv({
				cls: 'tablify-native-grid-note',
				text: notes.join(' '),
			});
			note.setAttribute('role', 'note');
		}
	}

	private renderRows(
		scroll: HTMLElement,
		grid: HTMLTableElement,
		body: HTMLTableSectionElement,
		model: NativeGridModel,
		rowHeight: number,
		store: DatabaseStore,
	): void {
		this.renderedRange = this.rangeAnchor === null ? null : this.rangeOf(model);
		const window = rowWindow({
			scrollTop: Math.max(0, scroll.scrollTop - HEADER_HEIGHT),
			viewportHeight: scroll.clientHeight,
			rowHeight,
			rowCount: model.items.length,
		});
		const rendered: HTMLTableRowElement[] = [];
		const columnCount = model.visibleColumns.length + 1;
		if (window.start > 0) {
			rendered.push(this.spacerRow(body, columnCount, window.start * rowHeight));
		}
		for (const [offset, item] of model.items.slice(window.start, window.end).entries()) {
			const absoluteIndex = window.start + offset;
			if (item.kind === 'group') {
				rendered.push(this.groupRow(body, item, columnCount, absoluteIndex + 2));
			} else {
				rendered.push(
					this.dataRow(
						body,
						item,
						model,
						absoluteIndex + 2,
						scroll,
						grid,
						rowHeight,
						store,
					),
				);
			}
		}
		const remaining = model.items.length - window.end;
		if (remaining > 0) {
			rendered.push(this.spacerRow(body, columnCount, remaining * rowHeight));
		}
		body.replaceChildren(...rendered);
		const activeDescendant = this.activeDescendant(model, window.start, window.end);
		if (activeDescendant === null) {
			grid.removeAttribute('aria-activedescendant');
		} else {
			grid.setAttribute('aria-activedescendant', activeDescendant);
		}
	}

	private spacerRow(
		body: HTMLTableSectionElement,
		columnCount: number,
		height: number,
	): HTMLTableRowElement {
		const row = body.createEl('tr', { cls: 'tablify-native-spacer-row' });
		row.setAttribute('role', 'presentation');
		row.setAttribute('aria-hidden', 'true');
		const cell = row.createEl('td');
		cell.colSpan = Math.max(1, columnCount);
		cell.style.height = `${String(height)}px`;
		cell.addClass('tablify-native-spacer-cell');
		return row;
	}

	private groupRow(
		body: HTMLTableSectionElement,
		item: NativeGroupItem,
		columnCount: number,
		rowIndex: number,
	): HTMLTableRowElement {
		const row = body.createEl('tr', { cls: 'tablify-native-group-row' });
		row.setAttribute('role', 'row');
		row.setAttribute('aria-rowindex', String(rowIndex));
		row.setAttribute('data-group-key', item.key);
		const cell = row.createEl('td', { cls: 'tablify-native-group-cell' });
		cell.setAttribute('role', 'gridcell');
		cell.colSpan = Math.max(1, columnCount);
		cell.setText(`${item.label} · ${String(item.count)} rows`);
		return row;
	}

	private dataRow(
		body: HTMLTableSectionElement,
		item: NativeDataItem,
		model: NativeGridModel,
		rowIndex: number,
		scroll: HTMLElement,
		grid: HTMLTableElement,
		rowHeight: number,
		store: DatabaseStore,
	): HTMLTableRowElement {
		const row = model.activeTable.rowById.get(item.rowId);
		const element = body.createEl('tr', { cls: 'tablify-native-data-row' });
		element.setAttribute('role', 'row');
		element.setAttribute('aria-rowindex', String(rowIndex));
		element.setAttribute('data-row-id', item.rowId);
		element.setAttribute(
			'aria-label',
			`Row ${String(item.resultIndex + 1)}, record ${item.rowId}`,
		);
		const number = element.createEl('th', { cls: 'tablify-native-row-number' });
		number.setAttribute('role', 'rowheader');
		number.setAttribute('aria-colindex', '1');
		number.setAttribute('data-row-id', item.rowId);
		number.setText(String(item.resultIndex + 1));
		for (const [index, column] of model.visibleColumns.entries()) {
			const fieldId = column.field.definition.id;
			const cell = element.createEl('td', { cls: 'tablify-native-cell' });
			cell.id = cellDomId(this.instanceId, item.rowId, fieldId);
			cell.setAttribute('role', 'gridcell');
			cell.setAttribute('aria-colindex', String(index + 2));
			cell.setAttribute('data-row-id', item.rowId);
			cell.setAttribute('data-field-id', fieldId);
			const value = viewCellOf(model.activeTable, item.rowId, fieldId);
			const invalidValue =
				value !== undefined && value !== null && isInvalidCell(value) ? value : null;
			const editable = editDraftFor(model, column, item.rowId, value) !== null;
			cell.setAttribute('aria-readonly', String(!editable));
			if (invalidValue !== null) {
				const serialized = JSON.stringify(invalidValue.raw) ?? 'null';
				cell.setAttribute('data-invalid-cell', 'true');
				cell.setAttribute('title', `Preserved invalid value: ${serialized}`);
			}
			const isEditing =
				this.editing?.databaseId === model.databaseId &&
				this.editing.tableId === model.table.id &&
				this.editing.rowId === item.rowId &&
				this.editing.fieldId === fieldId;
			if (isEditing) {
				cell.addClass('is-editing');
				this.renderCellEditor(
					cell,
					column,
					item.rowId,
					model,
					scroll,
					grid,
					body,
					rowHeight,
					store,
				);
			} else if (isLinkColumn(column)) {
				this.renderLinkCell(cell, column, item.rowId, model);
			} else {
				cell.setText(displayCellValue(column, value));
			}
			const isSelected =
				this.selection?.databaseId === model.databaseId &&
				this.selection.tableId === model.table.id &&
				this.selection.rowId === item.rowId &&
				this.selection.fieldId === fieldId;
			if (isSelected) {
				cell.setAttribute('aria-selected', 'true');
				cell.addClass('is-active');
			}
			const range = this.renderedRange;
			const rowPosition = range?.rowIndex.get(item.rowId);
			if (
				range !== null &&
				rowPosition !== undefined &&
				rowPosition >= range.top &&
				rowPosition <= range.bottom &&
				index >= range.left &&
				index <= range.right
			) {
				cell.addClass('is-in-range');
			}
			const width = model.view?.widths.get(fieldId) ?? DEFAULT_COLUMN_WIDTH;
			cell.style.width = `${String(width)}px`;
		}
		// Keep the row variable read above as an explicit consistency check for stale projections in dev/test.
		if (row === undefined) {
			element.setAttribute('data-stale-row', 'true');
		}
		return element;
	}

	private renderLinkCell(
		cell: HTMLTableCellElement,
		column: NativeColumn & { readonly stored: FieldDefinition & { readonly type: 'link' } },
		rowId: string,
		model: NativeGridModel,
	): void {
		const field = column.stored;
		const inspection = model.relationInspector.inspectLinkCell(model.table.id, rowId, field.id);
		const ownerRow = model.rowsByTableId.get(model.table.id)?.get(rowId);
		const storedValue = ownerRow?.cells.get(field.id);
		const unexpectedInverseValue =
			field.settings.generated === true && storedValue !== undefined && storedValue !== null;
		const labels: string[] = [];
		cell.addClass('tablify-native-link-cell');
		const content = cell.createDiv({ cls: 'tablify-native-link-content' });
		if (inspection !== undefined) {
			cell.setAttribute('data-link-state', inspection.state);
			const messages = inspection.findings.map((finding) => finding.message);
			if (messages.length > 0) {
				cell.setAttribute('title', messages.join(' '));
			}
		}

		if (field.settings.generated === true) {
			const derivedRows = generatedInverseRows(model, rowId, field);
			const sourceTableAvailable = model.document.tables.some(
				(table) => table.id === field.settings.targetTableId,
			);
			cell.setAttribute('data-link-state', derivedRows.length > 0 ? 'resolved' : 'empty');
			for (const derived of derivedRows) {
				const sourceTable = model.document.tables.find(
					(table) => table.id === derived.tableId,
				);
				if (sourceTable === undefined) {
					continue;
				}
				this.appendLinkNavigationButton(
					content,
					derived.tableId,
					derived.rowId,
					derived.label,
					sourceTable.name,
				);
				labels.push(derived.label);
			}
			if (!sourceTableAvailable) {
				cell.addClass('is-broken-link');
				cell.setAttribute('data-link-state', 'broken');
				const message = `Missing source table · ${field.settings.targetTableId ?? 'not configured'}`;
				content.createSpan({ cls: 'tablify-native-link-broken', text: message });
				labels.push(message);
			}
			if (unexpectedInverseValue) {
				cell.addClass('is-broken-link');
				cell.setAttribute('data-link-state', 'broken');
				cell.setAttribute(
					'title',
					'Generated inverse values are derived and are never read from stored cell data.',
				);
				const warning = content.createSpan({
					cls: 'tablify-native-link-warning',
					text: 'Stored inverse data ignored',
				});
				warning.setAttribute('role', 'note');
				labels.push('Stored inverse data ignored');
			}
			if (derivedRows.length === 0 && !unexpectedInverseValue && sourceTableAvailable) {
				content.createSpan({
					cls: 'tablify-native-link-empty',
					text: 'No linked records',
				});
				labels.push('No linked records');
			}
			cell.setAttribute('aria-label', `${field.name}: ${labels.join('; ')}`);
			return;
		}

		if (inspection === undefined) {
			cell.addClass('is-broken-link');
			cell.setAttribute('data-link-state', 'unreadable');
			cell.setAttribute('aria-label', `${field.name}: link data unavailable`);
			cell.setText('Link data unavailable');
			return;
		}
		for (const reference of inspection.references) {
			if (reference.state === 'resolved' && reference.ownerTableId !== null) {
				const targetTable = model.document.tables.find(
					(table) => table.id === reference.ownerTableId,
				);
				if (targetTable !== undefined) {
					const label = rowLabel(model, targetTable.id, reference.id);
					this.appendLinkNavigationButton(
						content,
						targetTable.id,
						reference.id,
						label,
						targetTable.name,
					);
					labels.push(label);
					continue;
				}
			}
			const message =
				reference.state === 'missing-row'
					? `Missing row · ${reference.id}`
					: reference.state === 'foreign-row'
						? `Wrong table · ${model.document.tables.find((table) => table.id === reference.ownerTableId)?.name ?? 'unknown table'} · ${reference.id}`
						: `Missing target table · ${inspection.targetTableId ?? field.settings.targetTableId ?? 'unknown'}`;
			const broken = content.createSpan({
				cls: 'tablify-native-link-broken',
				text: message,
			});
			broken.setAttribute('role', 'note');
			labels.push(message);
		}
		if (inspection.state === 'unreadable') {
			cell.addClass('is-broken-link');
			const status = content.createSpan({
				cls: 'tablify-native-link-broken',
				text: 'Unreadable link value',
			});
			status.setAttribute('role', 'note');
			labels.push('Unreadable link value');
		} else if (inspection.findings.length > 0 || inspection.state === 'broken') {
			cell.addClass('is-broken-link');
			if (inspection.references.length === 0 && labels.length === 0) {
				const status = content.createSpan({
					cls: 'tablify-native-link-broken',
					text: 'Link target needs repair',
				});
				status.setAttribute('role', 'note');
				labels.push('Link target needs repair');
			}
		}
		if (labels.length === 0) {
			content.createSpan({ cls: 'tablify-native-link-empty', text: 'No linked records' });
			labels.push('No linked records');
		}
		cell.setAttribute('aria-label', `${field.name}: ${labels.join('; ')}`);
	}

	private appendLinkNavigationButton(
		container: HTMLElement,
		tableId: string,
		rowId: string,
		label: string,
		tableName: string,
	): void {
		const button = container.createEl('button', {
			cls: 'tablify-native-link-button',
			text: label,
		});
		button.type = 'button';
		button.setAttribute('data-link-navigation', 'true');
		button.setAttribute('data-target-table-id', tableId);
		button.setAttribute('data-target-row-id', rowId);
		button.setAttribute('aria-label', `Open ${label} in ${tableName}`);
		button.onclick = (event: MouseEvent): void => {
			event.preventDefault();
			event.stopPropagation();
			this.onNavigateToRow(tableId, rowId);
		};
	}

	private renderCellEditor(
		cell: HTMLTableCellElement,
		column: NativeColumn,
		rowId: string,
		model: NativeGridModel,
		scroll: HTMLElement,
		grid: HTMLTableElement,
		body: HTMLTableSectionElement,
		rowHeight: number,
		store: DatabaseStore,
	): void {
		const edit = this.editing;
		if (edit === null) {
			return;
		}
		const editor = editorOf(column.field);
		const label = `${column.field.definition.name}, row ${String(model.result.rows.findIndex((row) => row.rowId === rowId) + 1)}`;
		const bind = (control: HTMLElement, accessibleLabel = label): void => {
			control.setAttribute('data-native-editor', 'true');
			control.setAttribute('data-focus-key', 'native-grid-editor');
			control.setAttribute('aria-label', accessibleLabel);
			control.addEventListener('keydown', (event: KeyboardEvent) => {
				this.onEditorKeyDown(event, scroll, grid, body, model, rowHeight, store);
			});
		};
		const updateDraft = (draft: NativeEditDraft, control: HTMLElement): void => {
			const current = this.editing;
			if (current !== null) {
				this.editing = { ...current, draft, error: null };
			}
			control.removeAttribute('aria-invalid');
			cell.querySelector('.tablify-native-cell-editor-error')?.remove();
		};

		if (isLinkColumn(column)) {
			this.renderLinkCellEditor(cell, column, rowId, model, edit, bind, updateDraft);
		} else if (editor === 'checkbox') {
			const input = cell.createEl('input', {
				cls: 'tablify-native-cell-editor tablify-native-checkbox-editor',
				type: 'checkbox',
			});
			input.checked = edit.draft === true;
			bind(input);
			input.addEventListener('change', () => updateDraft(input.checked, input));
		} else if (editor === 'select') {
			const select = cell.createEl('select', { cls: 'tablify-native-cell-editor' });
			const none = select.createEl('option', { text: 'No value' });
			none.value = '';
			const current = typeof edit.draft === 'string' ? edit.draft : '';
			const options = column.field.options.options ?? [];
			if (current !== '' && !options.some((option) => option.id === current)) {
				const unknown = select.createEl('option', { text: `Unknown option · ${current}` });
				unknown.value = current;
			}
			for (const option of options) {
				const entry = select.createEl('option', { text: option.name });
				entry.value = option.id;
			}
			select.value = current;
			bind(select);
			select.addEventListener('change', () => updateDraft(select.value, select));
		} else if (editor === 'multiSelect') {
			const wrapper = cell.createDiv({ cls: 'tablify-native-multi-select-editor' });
			wrapper.setAttribute('data-native-editor', 'true');
			const options = [...(column.field.options.options ?? [])];
			const selected = isStringList(edit.draft) ? [...edit.draft] : [];
			const knownIds = new Set(options.map((option) => option.id));
			for (const id of selected) {
				if (!knownIds.has(id)) {
					options.push({ id, name: `Unknown option · ${id}` });
				}
			}
			for (const option of options) {
				const labelEl = wrapper.createEl('label', {
					cls: 'tablify-native-multi-select-option',
				});
				const checkbox = labelEl.createEl('input', { type: 'checkbox' });
				checkbox.checked = selected.includes(option.id);
				bind(checkbox);
				checkbox.addEventListener('change', () => {
					const current = this.editing;
					const draft = isStringList(current?.draft) ? [...current.draft] : [];
					const next = checkbox.checked
						? draft.includes(option.id)
							? draft
							: [...draft, option.id]
						: draft.filter((id) => id !== option.id);
					updateDraft(next, checkbox);
				});
				labelEl.createSpan({ text: option.name });
			}
		} else if (editor !== 'readonly') {
			const input =
				editor === 'longText'
					? cell.createEl('textarea', { cls: 'tablify-native-cell-editor' })
					: cell.createEl('input', {
							cls: 'tablify-native-cell-editor',
							type: 'text',
						});
			input.value = typeof edit.draft === 'string' ? edit.draft : '';
			if (editor === 'number' || editor === 'rating') {
				input.setAttribute('inputmode', 'decimal');
			}
			bind(input);
			input.addEventListener('input', () => updateDraft(input.value, input));
		}

		if (edit.error !== null) {
			const error = cell.createDiv({
				cls: 'tablify-native-cell-editor-error',
				text: edit.error,
			});
			error.id = `${this.instanceId}-error-${rowId}-${column.stored.id ?? 'field'}`;
			error.setAttribute('role', 'alert');
			for (const control of Array.from(
				cell.querySelectorAll<HTMLElement>('[data-native-editor]'),
			)) {
				control.setAttribute('aria-describedby', error.id);
				control.setAttribute('aria-invalid', 'true');
			}
		}
	}

	private renderLinkCellEditor(
		cell: HTMLTableCellElement,
		column: NativeColumn & { readonly stored: FieldDefinition & { readonly type: 'link' } },
		rowId: string,
		model: NativeGridModel,
		edit: NativeCellEditor,
		bind: (control: HTMLElement, accessibleLabel?: string) => void,
		updateDraft: (draft: NativeEditDraft, control: HTMLElement) => void,
	): void {
		const field = column.stored;
		const wrapper = cell.createDiv({ cls: 'tablify-native-link-editor' });
		wrapper.setAttribute('data-native-editor', 'true');
		wrapper.setAttribute('role', 'group');
		wrapper.setAttribute('aria-label', `${field.name} linked-record editor`);
		const targetTableId = field.settings.targetTableId;
		const targetTable = model.document.tables.find((table) => table.id === targetTableId);
		if (targetTable === undefined) {
			wrapper.createDiv({
				cls: 'tablify-native-link-editor-empty',
				text: 'The target table is unavailable. This link is read-only until it is restored.',
			});
			return;
		}

		const search = wrapper.createEl('input', {
			cls: 'tablify-native-link-search',
			type: 'search',
		});
		search.type = 'search';
		search.placeholder = `Search ${targetTable.name}`;
		search.value = edit.search;
		bind(search, `Search ${targetTable.name} records`);

		const choices: NativeLinkChoice[] = targetTable.rows.map((row) => ({
			id: row.id,
			label: rowLabel(model, targetTable.id, row.id),
			broken: false,
		}));
		const knownIds = new Set(choices.map((choice) => choice.id));
		const inspection = model.relationInspector.inspectLinkCell(model.table.id, rowId, field.id);
		for (const reference of inspection?.references ?? []) {
			if (knownIds.has(reference.id) && reference.state === 'resolved') {
				continue;
			}
			const ownerName = model.document.tables.find(
				(table) => table.id === reference.ownerTableId,
			)?.name;
			const label =
				reference.state === 'missing-row'
					? `Missing row · ${reference.id}`
					: reference.state === 'foreign-row'
						? `Wrong table · ${ownerName ?? 'unknown table'} · ${reference.id}`
						: `Missing target table · ${reference.id}`;
			choices.push({ id: reference.id, label, broken: true });
			knownIds.add(reference.id);
		}

		const fieldset = wrapper.createEl('fieldset', {
			cls: 'tablify-native-link-choice-group',
		});
		fieldset.createEl('legend', { text: `Choose ${field.name}` });
		const list = fieldset.createDiv({ cls: 'tablify-native-link-choice-list' });
		const searchableChoices: HTMLElement[] = [];
		const noResults = list.createDiv({
			cls: 'tablify-native-link-no-results',
			text: 'No matching records.',
		});
		noResults.hidden = true;
		noResults.setAttribute('role', 'status');
		noResults.setAttribute('aria-live', 'polite');
		const selected = isStringList(edit.draft) ? [...edit.draft] : [];

		const addChoiceLabel = (choice: NativeLinkChoice): HTMLLabelElement => {
			const labelElement = list.createEl('label', {
				cls: choice.broken
					? 'tablify-native-link-choice is-broken-link'
					: 'tablify-native-link-choice',
			});
			labelElement.setAttribute('data-link-option', 'true');
			labelElement.setAttribute('data-link-search-text', choice.label.toLocaleLowerCase());
			searchableChoices.push(labelElement);
			const control = labelElement.createEl('input', {
				type: field.settings.allowMultiple === true ? 'checkbox' : 'radio',
			});
			control.type = field.settings.allowMultiple === true ? 'checkbox' : 'radio';
			control.value = choice.id;
			control.setAttribute('value', choice.id);
			if (field.settings.allowMultiple === true) {
				control.checked = selected.includes(choice.id);
				bind(control, `Link to ${choice.label}`);
				control.addEventListener('change', () => {
					const current = this.editing;
					const draft = isStringList(current?.draft) ? [...current.draft] : [];
					const next = control.checked
						? draft.includes(choice.id)
							? draft
							: [...draft, choice.id]
						: draft.filter((id) => id !== choice.id);
					updateDraft(next, control);
				});
			} else {
				control.name = `${this.instanceId}-link-${rowId}-${field.id}`;
				control.checked = selected[0] === choice.id;
				bind(control, `Select ${choice.label}`);
				control.addEventListener('change', () => {
					if (control.checked) {
						updateDraft([choice.id], control);
					}
				});
			}
			labelElement.createSpan({ text: choice.label });
			return labelElement;
		};

		if (field.settings.allowMultiple !== true) {
			const clearLabel = list.createEl('label', {
				cls: 'tablify-native-link-choice tablify-native-link-clear',
			});
			const clear = clearLabel.createEl('input', { type: 'radio' });
			clear.type = 'radio';
			clear.name = `${this.instanceId}-link-${rowId}-${field.id}`;
			clear.value = '';
			clear.checked = selected.length === 0;
			bind(clear, `Clear ${field.name}`);
			clear.addEventListener('change', () => {
				if (clear.checked) {
					updateDraft([], clear);
				}
			});
			clearLabel.createSpan({ text: 'No linked record' });
		}
		for (const choice of choices) {
			addChoiceLabel(choice);
		}
		if (choices.length === 0) {
			const empty = list.createDiv({
				cls: 'tablify-native-link-editor-empty',
				text: `No records in ${targetTable.name}.`,
			});
			empty.setAttribute('role', 'note');
		}

		const applySearch = (): void => {
			const query = search.value.trim().toLocaleLowerCase();
			let matches = 0;
			for (const option of searchableChoices) {
				const searchText = option.getAttribute('data-link-search-text') ?? '';
				const visible = query === '' || searchText.includes(query);
				option.hidden = !visible;
				if (visible) {
					matches += 1;
				}
			}
			noResults.hidden = query === '' || matches > 0;
		};
		search.addEventListener('input', () => {
			const current = this.editing;
			if (current !== null) {
				this.editing = { ...current, search: search.value };
			}
			applySearch();
		});
		applySearch();
	}

	private beginEdit(
		selection: NativeCellSelection,
		scroll: HTMLElement,
		grid: HTMLTableElement,
		body: HTMLTableSectionElement,
		model: NativeGridModel,
		rowHeight: number,
		store: DatabaseStore,
	): void {
		const column = model.visibleColumns.find(
			(candidate) => candidate.field.definition.id === selection.fieldId,
		);
		if (column === undefined) {
			return;
		}
		const current = viewCellOf(model.activeTable, selection.rowId, selection.fieldId);
		const draft = editDraftFor(model, column, selection.rowId, current);
		if (draft === null) {
			return;
		}
		this.selection = selection;
		this.editing = { ...selection, draft, error: null, search: '' };
		this.renderRows(scroll, grid, body, model, rowHeight, store);
		this.focusEditor(grid);
	}

	private focusEditor(grid: HTMLTableElement): void {
		grid.querySelector<HTMLElement>(
			'input[data-native-editor], select[data-native-editor], textarea[data-native-editor]',
		)?.focus();
	}

	private cancelEditor(
		scroll: HTMLElement,
		grid: HTMLTableElement,
		body: HTMLTableSectionElement,
		model: NativeGridModel,
		rowHeight: number,
		store: DatabaseStore,
	): void {
		this.editing = null;
		this.renderRows(scroll, grid, body, model, rowHeight, store);
		grid.focus({ preventScroll: true });
	}

	private nextSelection(
		model: NativeGridModel,
		rowDelta: number,
		columnDelta: number,
		wrapColumns: boolean,
	): NativeCellSelection | undefined {
		const selection = this.selection;
		if (selection === null) {
			return undefined;
		}
		const rows = model.visibleRows;
		const rowIndex = rows.findIndex((row) => row.rowId === selection.rowId);
		const columnIndex = model.visibleColumns.findIndex(
			(column) => column.field.definition.id === selection.fieldId,
		);
		if (rowIndex < 0 || columnIndex < 0) {
			return undefined;
		}
		let nextRow = rowIndex + rowDelta;
		let nextColumn = columnIndex + columnDelta;
		if (wrapColumns && nextColumn < 0) {
			nextRow -= 1;
			nextColumn = model.visibleColumns.length - 1;
		} else if (wrapColumns && nextColumn >= model.visibleColumns.length) {
			nextRow += 1;
			nextColumn = 0;
		}
		const row = rows[nextRow];
		const column = model.visibleColumns[nextColumn];
		return row === undefined || column === undefined
			? undefined
			: {
					databaseId: model.databaseId,
					tableId: model.table.id,
					rowId: row.rowId,
					fieldId: column.field.definition.id,
				};
	}

	private commitEditor(
		next: NativeCellSelection | undefined,
		scroll: HTMLElement,
		grid: HTMLTableElement,
		body: HTMLTableSectionElement,
		model: NativeGridModel,
		rowHeight: number,
		store: DatabaseStore,
	): boolean {
		const edit = this.editing;
		if (edit === null) {
			return true;
		}
		const column = model.visibleColumns.find(
			(candidate) => candidate.field.definition.id === edit.fieldId,
		);
		if (column === undefined) {
			this.editing = null;
			this.renderRows(scroll, grid, body, model, rowHeight, store);
			grid.focus({ preventScroll: true });
			return true;
		}
		let value: CellValue;
		let linkRowIds: readonly string[] | null = null;
		if (isLinkColumn(column)) {
			if (!isStringList(edit.draft)) {
				this.editing = {
					...edit,
					error: 'Choose one or more records before saving this link.',
				};
				this.renderRows(scroll, grid, body, model, rowHeight, store);
				this.focusEditor(grid);
				return false;
			}
			linkRowIds = edit.draft;
			value = linkCellValue(column, linkRowIds);
		} else {
			switch (editorOf(column.field)) {
				case 'checkbox':
					value = edit.draft === true;
					break;
				case 'select':
					value = typeof edit.draft === 'string' && edit.draft !== '' ? edit.draft : null;
					break;
				case 'multiSelect':
					value =
						isStringList(edit.draft) && edit.draft.length > 0 ? [...edit.draft] : null;
					break;
				default: {
					if (typeof edit.draft !== 'string') {
						this.editing = {
							...edit,
							error: 'This field editor has an invalid draft.',
						};
						this.renderRows(scroll, grid, body, model, rowHeight, store);
						this.focusEditor(grid);
						return false;
					}
					if (edit.draft.trim() === '') {
						value = null;
						break;
					}
					const parsed = column.field.descriptor.parse(edit.draft, column.field.context);
					if (!parsed.ok) {
						this.editing = { ...edit, error: parsed.error };
						this.renderRows(scroll, grid, body, model, rowHeight, store);
						this.focusEditor(grid);
						return false;
					}
					value = column.field.descriptor.toJson(parsed.value, column.field.context);
					break;
				}
			}
		}

		const current = viewCellOf(model.activeTable, edit.rowId, edit.fieldId);
		const unchanged =
			linkRowIds === null
				? sameCellValue(current, value)
				: sameLinkSelection(current, linkRowIds);
		if (unchanged) {
			this.editing = null;
			if (next !== undefined) {
				this.selection = next;
			}
			this.renderRows(scroll, grid, body, model, rowHeight, store);
			grid.focus({ preventScroll: true });
			return true;
		}

		const previousSelection = this.selection;
		this.editing = null;
		if (next !== undefined) {
			this.selection = next;
		}
		const updatedAt = timestampFor(this.environment);
		const operation =
			linkRowIds === null
				? {
						kind: 'set-cells' as const,
						tableId: edit.tableId,
						rowId: edit.rowId,
						edits: [{ fieldId: edit.fieldId, value }],
						...(updatedAt === null ? {} : { updatedAt }),
					}
				: {
						kind: 'set-link' as const,
						tableId: edit.tableId,
						rowId: edit.rowId,
						fieldId: edit.fieldId,
						rowIds: linkRowIds,
						...(updatedAt === null ? {} : { updatedAt }),
					};
		const result = store.dispatch(operation, `Edit cell: ${column.field.definition.name}`);
		if (!result.ok) {
			this.editing = { ...edit, error: result.message };
			this.selection = previousSelection;
			this.renderRows(scroll, grid, body, model, rowHeight, store);
			this.focusEditor(grid);
			return false;
		}
		return true;
	}

	private onEditorKeyDown(
		event: KeyboardEvent,
		scroll: HTMLElement,
		grid: HTMLTableElement,
		body: HTMLTableSectionElement,
		model: NativeGridModel,
		rowHeight: number,
		store: DatabaseStore,
	): void {
		const edit = this.editing;
		if (edit === null) {
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			this.cancelEditor(scroll, grid, body, model, rowHeight, store);
			return;
		}
		if (event.key === 'Tab') {
			const target = event.target;
			const linkEditor =
				target instanceof Element
					? target.closest<HTMLElement>('.tablify-native-link-editor')
					: null;
			if (linkEditor !== null) {
				const controls = Array.from(
					linkEditor.querySelectorAll<HTMLElement>('[data-native-editor]'),
				).filter(
					(control) =>
						control.tabIndex >= 0 &&
						!control.hasAttribute('disabled') &&
						control.closest('[hidden]') === null,
				);
				const currentIndex = target instanceof HTMLElement ? controls.indexOf(target) : -1;
				const nextIndex = currentIndex + (event.shiftKey ? -1 : 1);
				if (nextIndex >= 0 && nextIndex < controls.length) {
					event.preventDefault();
					controls[nextIndex]?.focus();
					return;
				}
			}
			event.preventDefault();
			const next = this.nextSelection(model, 0, event.shiftKey ? -1 : 1, true);
			this.commitEditor(next, scroll, grid, body, model, rowHeight, store);
			return;
		}
		if (event.key !== 'Enter') {
			return;
		}
		const column = model.visibleColumns.find(
			(candidate) => candidate.field.definition.id === edit.fieldId,
		);
		if (column?.field.descriptor.editor === 'longText' && !event.ctrlKey && !event.metaKey) {
			return;
		}
		event.preventDefault();
		const next = this.nextSelection(model, event.shiftKey ? -1 : 1, 0, false);
		this.commitEditor(next, scroll, grid, body, model, rowHeight, store);
	}

	private activeDescendant(model: NativeGridModel, start: number, end: number): string | null {
		const selection = this.selection;
		if (
			selection === null ||
			selection.databaseId !== model.databaseId ||
			selection.tableId !== model.table.id
		) {
			return null;
		}
		const index = model.rowItemIndex.get(selection.rowId);
		if (index === undefined || index < start || index >= end) {
			return null;
		}
		if (
			!model.visibleColumns.some((column) => column.field.definition.id === selection.fieldId)
		) {
			return null;
		}
		return cellDomId(this.instanceId, selection.rowId, selection.fieldId);
	}

	private activate(
		selection: NativeCellSelection,
		scroll: HTMLElement,
		grid: HTMLTableElement,
		body: HTMLTableSectionElement,
		model: NativeGridModel,
		rowHeight: number,
		store: DatabaseStore,
	): void {
		this.selection = selection;
		const index = model.rowItemIndex.get(selection.rowId);
		if (index !== undefined) {
			const rowTop = HEADER_HEIGHT + index * rowHeight;
			const visibleTop = scroll.scrollTop + HEADER_HEIGHT;
			const visibleBottom = scroll.scrollTop + scroll.clientHeight;
			if (rowTop < visibleTop) {
				scroll.scrollTop = Math.max(0, rowTop - HEADER_HEIGHT);
			} else if (rowTop + rowHeight > visibleBottom) {
				scroll.scrollTop = Math.max(0, rowTop + rowHeight - scroll.clientHeight);
			}
			this.scrollTopByTable.set(model.key, scroll.scrollTop);
		}
		this.renderRows(scroll, grid, body, model, rowHeight, store);
		grid.focus({ preventScroll: true });
	}

	/** The rectangle from the range anchor to the active cell; without an anchor, the active cell alone. */
	private rangeOf(model: NativeGridModel): NativeCellRange | null {
		const corner = this.rangeAnchor ?? this.selection;
		const focus = this.selection;
		if (
			corner === null ||
			focus === null ||
			corner.databaseId !== model.databaseId ||
			corner.tableId !== model.table.id ||
			focus.databaseId !== model.databaseId ||
			focus.tableId !== model.table.id
		) {
			return null;
		}
		const rowIndex = new Map(
			model.visibleRows.map((row, index) => [row.rowId, index] as const),
		);
		const columnIndexOf = (fieldId: string): number =>
			model.visibleColumns.findIndex((column) => column.field.definition.id === fieldId);
		const rowA = rowIndex.get(corner.rowId);
		const rowB = rowIndex.get(focus.rowId);
		const colA = columnIndexOf(corner.fieldId);
		const colB = columnIndexOf(focus.fieldId);
		if (rowA === undefined || rowB === undefined || colA < 0 || colB < 0) {
			return null;
		}
		const top = Math.min(rowA, rowB);
		const bottom = Math.max(rowA, rowB);
		const left = Math.min(colA, colB);
		const right = Math.max(colA, colB);
		return {
			rows: model.visibleRows.slice(top, bottom + 1),
			columns: model.visibleColumns.slice(left, right + 1),
			top,
			bottom,
			left,
			right,
			rowIndex,
		};
	}

	/**
	 * Clear every editable cell in the range as one undoable step. Read-only cells and cells that
	 * are already empty are skipped, so a clear never dispatches a no-op or a refused edit.
	 */
	private clearSelection(
		model: NativeGridModel,
		store: DatabaseStore,
		options: { readonly keepLinks?: boolean } = {},
	): void {
		const range = this.rangeOf(model);
		if (range === null) {
			return;
		}
		const updatedAt = timestampFor(this.environment);
		const stamp = updatedAt === null ? {} : { updatedAt };
		const operations: DatabaseOperation[] = [];
		let changed = 0;
		for (const row of range.rows) {
			const edits: CellEdit[] = [];
			for (const column of range.columns) {
				const fieldId = column.field.definition.id;
				const current = viewCellOf(model.activeTable, row.rowId, fieldId);
				if (editDraftFor(model, column, row.rowId, current) === null) {
					continue;
				}
				if (isLinkColumn(column)) {
					if (options.keepLinks !== true && !sameLinkSelection(current, [])) {
						changed += 1;
						operations.push({
							kind: 'set-link',
							tableId: model.table.id,
							rowId: row.rowId,
							fieldId,
							rowIds: [],
							...stamp,
						});
					}
					continue;
				}
				if (!sameCellValue(current, null)) {
					changed += 1;
					edits.push({ fieldId, value: null });
				}
			}
			if (edits.length > 0) {
				operations.push({
					kind: 'set-cells',
					tableId: model.table.id,
					rowId: row.rowId,
					edits,
					...stamp,
				});
			}
		}
		// The range ends with the clear: drop the anchor before dispatch so the re-render shows one cell.
		this.rangeAnchor = null;
		if (operations.length === 0) {
			return;
		}
		const label =
			range.rows.length * range.columns.length === 1 && changed === 1
				? `Clear cell: ${range.columns[0]?.field.definition.name ?? ''}`
				: 'Clear cells';
		store.dispatch(
			operations.length === 1 && operations[0] !== undefined ? operations[0] : operations,
			label,
		);
	}

	/** The range as text, one row per visible row. Link columns are left out here and counted by the caller. */
	private rangeMatrix(
		model: NativeGridModel,
	): { readonly matrix: Matrix; readonly omittedLinks: number } | null {
		const range = this.rangeOf(model);
		if (range === null) {
			return null;
		}
		const columns = range.columns.filter((column) => !isLinkColumn(column));
		const matrix = range.rows.map((row) =>
			columns.map((column) => {
				const stored = viewCellOf(model.activeTable, row.rowId, column.field.definition.id);
				if (stored === undefined || stored === null || isInvalidCell(stored)) {
					return '';
				}
				return column.field.descriptor.formatPlain(stored, column.field.context);
			}),
		);
		return { matrix, omittedLinks: range.columns.length - columns.length };
	}

	/** Copy (and, for cut, clear) the range onto the clipboard as TSV and HTML. */
	private onClipboardCopy(
		event: ClipboardEvent,
		model: NativeGridModel,
		store: DatabaseStore,
		cut: boolean,
	): void {
		if (this.editing !== null || isInsideEditor(event.target)) {
			return;
		}
		const copied = this.rangeMatrix(model);
		if (copied === null) {
			return;
		}
		event.preventDefault();
		if (copied.omittedLinks > 0) {
			new Notice(`${String(copied.omittedLinks)} link column(s) are not copied.`);
		}
		if ((copied.matrix[0]?.length ?? 0) === 0) {
			return;
		}
		event.clipboardData?.setData('text/plain', toTsv(copied.matrix));
		event.clipboardData?.setData('text/html', toHtml(copied.matrix));
		if (cut) {
			this.clearSelection(model, store, { keepLinks: true });
		}
	}

	/**
	 * Paste a clipboard matrix with its top-left cell at the range corner. Each cell is parsed by its
	 * column's own `parse` and `toJson`, the same path a typed edit takes. Link columns, read-only cells,
	 * unparseable text, and cells past the table edge are skipped and counted in one notice.
	 */
	private pasteMatrix(matrix: Matrix, model: NativeGridModel, store: DatabaseStore): void {
		const range = this.rangeOf(model);
		if (range === null) {
			return;
		}
		const updatedAt = timestampFor(this.environment);
		const stamp = updatedAt === null ? {} : { updatedAt };
		const operations: DatabaseOperation[] = [];
		let skippedLinks = 0;
		let skippedReadOnly = 0;
		let rejected = 0;
		let outside = 0;
		const single = matrix[0]?.[0] ?? '';
		const block: Matrix =
			matrix.length === 1 &&
			(matrix[0]?.length ?? 0) === 1 &&
			range.rows.length * range.columns.length > 1
				? range.rows.map(() => range.columns.map(() => single))
				: matrix;
		block.forEach((cells, offsetRow) => {
			const targetRow = model.visibleRows[range.top + offsetRow];
			if (targetRow === undefined) {
				outside += cells.length;
				return;
			}
			const edits: CellEdit[] = [];
			cells.forEach((text, offsetColumn) => {
				const column = model.visibleColumns[range.left + offsetColumn];
				if (column === undefined) {
					outside += 1;
					return;
				}
				const fieldId = column.field.definition.id;
				const current = viewCellOf(model.activeTable, targetRow.rowId, fieldId);
				if (editDraftFor(model, column, targetRow.rowId, current) === null) {
					skippedReadOnly += 1;
					return;
				}
				if (isLinkColumn(column)) {
					skippedLinks += 1;
					return;
				}
				let value: ClipboardCellValue;
				if (text.trim() === '') {
					value = null;
				} else {
					const parsedCell = column.field.descriptor.parse(text, column.field.context);
					if (!parsedCell.ok) {
						rejected += 1;
						return;
					}
					value = column.field.descriptor.toJson(parsedCell.value, column.field.context);
				}
				if (!sameCellValue(current, value)) {
					edits.push({ fieldId, value });
				}
			});
			if (edits.length > 0) {
				operations.push({
					kind: 'set-cells',
					tableId: model.table.id,
					rowId: targetRow.rowId,
					edits,
					...stamp,
				});
			}
		});
		const skipped = [
			skippedLinks > 0 ? `${String(skippedLinks)} link cell(s)` : '',
			skippedReadOnly > 0 ? `${String(skippedReadOnly)} read-only cell(s)` : '',
			rejected > 0 ? `${String(rejected)} value(s) that do not fit their column` : '',
			outside > 0 ? `${String(outside)} cell(s) past the table edge` : '',
		].filter((part) => part !== '');
		if (skipped.length > 0) {
			new Notice(`Paste skipped ${skipped.join(', ')}.`);
		}
		if (operations.length === 0) {
			return;
		}
		store.dispatch(operations, 'Paste cells');
	}

	/**
	 * Fill the range from its first row (down) or first column (right). The source cell's canonical value
	 * is written into every editable target in one undoable step. Link columns, read-only cells, and invalid
	 * source cells are skipped; a single notice counts what was left out.
	 */
	private fillRange(
		direction: 'down' | 'right',
		model: NativeGridModel,
		store: DatabaseStore,
	): void {
		const range = this.rangeOf(model);
		if (range === null || range.rows.length * range.columns.length <= 1) {
			return;
		}
		const updatedAt = timestampFor(this.environment);
		const stamp = updatedAt === null ? {} : { updatedAt };
		const editsByRow = new Map<string, CellEdit[]>();
		let skippedLinks = 0;
		let skippedReadOnly = 0;
		let skippedInvalid = 0;
		const target = (
			rowId: string,
			column: NativeColumn,
			source: CellState | undefined,
		): void => {
			const fieldId = column.field.definition.id;
			if (isLinkColumn(column)) {
				skippedLinks += 1;
				return;
			}
			if (source === undefined || source === null || isInvalidCell(source)) {
				skippedInvalid += 1;
				return;
			}
			const current = viewCellOf(model.activeTable, rowId, fieldId);
			if (editDraftFor(model, column, rowId, current) === null) {
				skippedReadOnly += 1;
				return;
			}
			if (!sameCellValue(current, source)) {
				const edits = editsByRow.get(rowId) ?? [];
				edits.push({ fieldId, value: source });
				editsByRow.set(rowId, edits);
			}
		};
		const first = range.rows[0];
		const firstColumn = range.columns[0];
		if (direction === 'down' && first !== undefined) {
			for (const column of range.columns) {
				const source = viewCellOf(
					model.activeTable,
					first.rowId,
					column.field.definition.id,
				);
				for (const row of range.rows.slice(1)) {
					target(row.rowId, column, source);
				}
			}
		}
		if (direction === 'right' && firstColumn !== undefined) {
			for (const row of range.rows) {
				const source = viewCellOf(
					model.activeTable,
					row.rowId,
					firstColumn.field.definition.id,
				);
				for (const column of range.columns.slice(1)) {
					target(row.rowId, column, source);
				}
			}
		}
		const skipped = [
			skippedLinks > 0 ? `${String(skippedLinks)} link cell(s)` : '',
			skippedReadOnly > 0 ? `${String(skippedReadOnly)} read-only cell(s)` : '',
			skippedInvalid > 0 ? `${String(skippedInvalid)} invalid source value(s)` : '',
		].filter((part) => part !== '');
		if (skipped.length > 0) {
			new Notice(`Fill skipped ${skipped.join(', ')}.`);
		}
		const operations: DatabaseOperation[] = [...editsByRow.entries()].map(([rowId, edits]) => ({
			kind: 'set-cells' as const,
			tableId: model.table.id,
			rowId,
			edits,
			...stamp,
		}));
		if (operations.length === 0) {
			return;
		}
		store.dispatch(operations, direction === 'down' ? 'Fill down' : 'Fill right');
	}

	private onKeyDown(
		event: KeyboardEvent,
		scroll: HTMLElement,
		grid: HTMLTableElement,
		body: HTMLTableSectionElement,
		model: NativeGridModel,
		rowHeight: number,
		store: DatabaseStore,
	): void {
		const target = event.target;
		if (
			target instanceof Element &&
			target.closest('[data-native-editor], [data-link-navigation]') !== null
		) {
			return;
		}
		const rows = model.visibleRows;
		const columns = model.visibleColumns;
		if (rows.length === 0 || columns.length === 0) {
			return;
		}
		const selectionIsCurrent =
			this.selection?.databaseId === model.databaseId &&
			this.selection.tableId === model.table.id;
		let rowIndex = selectionIsCurrent
			? rows.findIndex((row) => row.rowId === this.selection?.rowId)
			: -1;
		let columnIndex = selectionIsCurrent
			? columns.findIndex((column) => column.field.definition.id === this.selection?.fieldId)
			: -1;
		const hadSelection = rowIndex >= 0 && columnIndex >= 0;
		if (rowIndex < 0) {
			rowIndex = 0;
		}
		if (columnIndex < 0) {
			columnIndex = 0;
		}
		if (event.key === 'Enter' || event.key === 'F2') {
			event.preventDefault();
			this.rangeAnchor = null;
			const row = rows[rowIndex];
			const column = columns[columnIndex];
			if (row !== undefined && column !== undefined) {
				this.beginEdit(
					{
						databaseId: model.databaseId,
						tableId: model.table.id,
						rowId: row.rowId,
						fieldId: column.field.definition.id,
					},
					scroll,
					grid,
					body,
					model,
					rowHeight,
					store,
				);
			}
			return;
		}
		if (!hadSelection && event.key.startsWith('Arrow')) {
			const row = rows[0];
			const column = columns[0];
			if (row !== undefined && column !== undefined) {
				event.preventDefault();
				this.activate(
					{
						databaseId: model.databaseId,
						tableId: model.table.id,
						rowId: row.rowId,
						fieldId: column.field.definition.id,
					},
					scroll,
					grid,
					body,
					model,
					rowHeight,
					store,
				);
			}
			return;
		}
		if (
			event.altKey &&
			!event.ctrlKey &&
			!event.metaKey &&
			hadSelection &&
			(event.code === 'KeyD' || event.code === 'KeyR')
		) {
			event.preventDefault();
			this.fillRange(event.code === 'KeyD' ? 'down' : 'right', model, store);
			return;
		}
		if (
			(event.key === 'Delete' || event.key === 'Backspace') &&
			hadSelection &&
			!event.altKey &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.shiftKey
		) {
			event.preventDefault();
			this.clearSelection(model, store);
			return;
		}
		if (event.key === 'Escape' && this.rangeAnchor !== null) {
			event.preventDefault();
			this.rangeAnchor = null;
			this.renderRows(scroll, grid, body, model, rowHeight, store);
			return;
		}
		if (event.shiftKey && event.key.startsWith('Arrow')) {
			this.rangeAnchor ??= hadSelection ? this.selection : null;
		} else {
			this.rangeAnchor = null;
		}
		let handled = true;
		switch (event.key) {
			case 'ArrowDown':
				rowIndex = Math.min(rows.length - 1, rowIndex + 1);
				break;
			case 'ArrowUp':
				rowIndex = Math.max(0, rowIndex - 1);
				break;
			case 'ArrowRight':
				columnIndex = Math.min(columns.length - 1, columnIndex + 1);
				break;
			case 'ArrowLeft':
				columnIndex = Math.max(0, columnIndex - 1);
				break;
			case 'Home':
				columnIndex = 0;
				if (event.ctrlKey || event.metaKey) {
					rowIndex = 0;
				}
				break;
			case 'End':
				columnIndex = columns.length - 1;
				if (event.ctrlKey || event.metaKey) {
					rowIndex = rows.length - 1;
				}
				break;
			default:
				handled = false;
				break;
		}
		if (!handled) {
			return;
		}
		event.preventDefault();
		const row = rows[rowIndex];
		const column = columns[columnIndex];
		if (row === undefined || column === undefined) {
			return;
		}
		this.activate(
			{
				databaseId: model.databaseId,
				tableId: model.table.id,
				rowId: row.rowId,
				fieldId: column.field.definition.id,
			},
			scroll,
			grid,
			body,
			model,
			rowHeight,
			store,
		);
	}
}
