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
import type { DatabaseTable } from '../core/database/schema';
import { isInvalidCell } from '../core/database/values';
import type { TableView } from '../core/database/views';
import { resolveField } from '../core/schema/propertySchema';
import type { PropertyDefinition, ResolvedField } from '../core/schema/propertySchema';
import { isFieldTypeId } from '../core/types';
import type { CellValue, EditorId, FieldContext, FieldOption, FieldOptions } from '../core/types';
import type { CellState } from '../core/database/rows';
import { buildView } from '../core/view/pipeline';
import type { ViewResult } from '../core/view/pipeline';
import type { RowView } from '../core/query/evaluate';
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
	readonly density: RowDensity;
	readonly notes: readonly string[];
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
}

interface NativeGridContext {
	readonly scroll: HTMLElement;
	readonly grid: HTMLTableElement;
	readonly body: HTMLTableSectionElement;
	readonly model: NativeGridModel;
	readonly rowHeight: number;
	readonly store: DatabaseStore;
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
		// `link` stores row IDs, but its ID-to-label lookup/editor is implemented in R4 step 3. Until then
		// use the text descriptor to show the IDs, and never make a link cell look editable.
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
	const columns = table.fields.flatMap((stored) => {
		const resolved = resolveNativeColumn(stored, environment);
		return resolved === null ? [] : [resolved];
	});
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
	if (columns.some((column) => column.stored.kind === 'field' && column.stored.type === 'link')) {
		notes.push(
			'Link cells currently show stored row IDs read-only; linked-record labels and editing are next.',
		);
	}
	if (view !== null && view.filterProblems.length > 0) {
		notes.push(
			`Some saved filter details could not be read: ${view.filterProblems.join('; ')}`,
		);
	}
	return {
		databaseId: snapshot.document.databaseId,
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
	private editing: NativeCellEditor | null = null;
	private context: NativeGridContext | null = null;
	private readonly scrollTopByTable = new Map<string, number>();

	constructor(private readonly environment: NativeGridEnvironment) {}

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
	): void {
		this.context = null;
		const model = modelOf(snapshot, selectedViewId, this.environment);
		const nextTableKey = model?.key ?? null;
		if (this.tableKey !== nextTableKey) {
			this.tableKey = nextTableKey;
			this.selection = null;
			this.editing = null;
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
			if (!(target instanceof Element) || target.closest('[data-native-editor]') !== null) {
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
			if (!(target instanceof Element) || target.closest('[data-native-editor]') !== null) {
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
		renderRows();

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
			const editable = editDraftOf(column.field, value) !== null;
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
			const width = model.view?.widths.get(fieldId) ?? DEFAULT_COLUMN_WIDTH;
			cell.style.width = `${String(width)}px`;
		}
		// Keep the row variable read above as an explicit consistency check for stale projections in dev/test.
		if (row === undefined) {
			element.setAttribute('data-stale-row', 'true');
		}
		return element;
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
		const bind = (control: HTMLElement): void => {
			control.setAttribute('data-native-editor', 'true');
			control.setAttribute('data-focus-key', 'native-grid-editor');
			control.setAttribute('aria-label', label);
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

		if (editor === 'checkbox') {
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
			error.setAttribute('role', 'alert');
		}
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
		const draft = editDraftOf(column.field, current);
		if (draft === null) {
			return;
		}
		this.selection = selection;
		this.editing = { ...selection, draft, error: null };
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
		switch (editorOf(column.field)) {
			case 'checkbox':
				value = edit.draft === true;
				break;
			case 'select':
				value = typeof edit.draft === 'string' && edit.draft !== '' ? edit.draft : null;
				break;
			case 'multiSelect':
				value = isStringList(edit.draft) && edit.draft.length > 0 ? [...edit.draft] : null;
				break;
			default: {
				if (typeof edit.draft !== 'string') {
					this.editing = { ...edit, error: 'This field editor has an invalid draft.' };
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

		const current = viewCellOf(model.activeTable, edit.rowId, edit.fieldId);
		if (sameCellValue(current, value)) {
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
		const result = store.dispatch(
			{
				kind: 'set-cells',
				tableId: edit.tableId,
				rowId: edit.rowId,
				edits: [{ fieldId: edit.fieldId, value }],
				...(updatedAt === null ? {} : { updatedAt }),
			},
			`Edit cell: ${column.field.definition.name}`,
		);
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
		if (target instanceof Element && target.closest('[data-native-editor]') !== null) {
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
