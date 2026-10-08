/**
 * A native table as an export matrix (R5 Part B). Pure: it reads a projected table and the three context values
 * the field descriptors need, and returns text. No vault, no clock, no host.
 *
 * Scope and omissions are data, not prose, so the dialog can state them exactly:
 *
 *  - **Scope is the whole table in manual order, or a saved view** (ADR-0003). A view runs the grid's own
 *    `buildView`; the dialog states which scope was used.
 *  - **Unsupported and link fields are omitted and counted.** Link values are record IDs, and a readable
 *    representation needs the target table's labels; that is not built yet, so a link column is reported, not
 *    silently exported as IDs.
 *  - **`display` is what a cell shows, `raw` is text a spreadsheet reads back unchanged.** Display follows the
 *    native grid's own rules for selects and invalid values; raw uses each descriptor's `formatPlain`.
 */
import { resolveField } from '../../schema/propertySchema';
import type { ExportColumn } from '../../export/serialize';
import type { PropertyDefinition, ResolvedField } from '../../schema/propertySchema';
import type { Matrix } from '../../selection/clipboard';
import type { CellValue, FieldContext, FieldOption, FieldOptions, FieldTypeId } from '../../types';
import { isFieldTypeId } from '../../types';
import type { ActiveTableSnapshot } from '../projection';
import { viewCellOf } from '../projection';
import type { FieldDefinition } from '../fields';
import { isInvalidCell } from '../values';
import { buildView } from '../../view/pipeline';
import type { RowView } from '../../query/evaluate';
import { fieldsMentioned } from '../../query/ast';
import type { TableView } from '../views';
import type { CellState } from '../rows';

export type NativeExportMode = 'display' | 'raw';

export interface NativeExportEnvironment {
	readonly now: () => number;
	readonly timezone: string;
	readonly locale: string;
}

export interface NativeExportResult {
	/** Header row followed by one row per table row, in manual order. Empty when no field is exportable. */
	readonly matrix: Matrix;
	readonly exportedFields: readonly string[];
	/** One entry per exported column, in matrix order: the typed view a spreadsheet writer needs. */
	readonly columns: readonly ExportColumn[];
	readonly omittedUnsupported: number;
	readonly omittedLinks: number;
	readonly rowCount: number;
}

interface NativeColumn {
	readonly id: string;
	readonly name: string;
	readonly type: FieldTypeId;
	readonly field: ResolvedField;
}

function optionsOf(field: FieldDefinition): FieldOptions {
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

function isStringList(value: CellValue): value is readonly string[] {
	return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

/** The text one stored cell exports as, under the mode. Mirrors the grid's display rules; see the header. */
export function nativeCellText(
	column: NativeColumn,
	stored: CellState | undefined,
	mode: NativeExportMode,
): string {
	if (stored === undefined || stored === null) {
		return '';
	}
	if (isInvalidCell(stored)) {
		// Kept visible in both modes: an invalid value is data the person must see, never a silent blank.
		return `Invalid value · ${JSON.stringify(stored.raw) ?? 'null'}`;
	}
	const value: CellValue = stored;
	const field = column.field;
	if (mode === 'raw') {
		return field.descriptor.formatPlain(value, field.context);
	}
	if (column.type === 'singleSelect' && typeof value === 'string') {
		return (
			field.options.options?.find((option) => option.id === value)?.name ??
			`Unknown option · ${value}`
		);
	}
	if (column.type === 'multiSelect' && isStringList(value)) {
		return value
			.map(
				(id) =>
					field.options.options?.find((option) => option.id === id)?.name ??
					`Unknown option · ${id}`,
			)
			.join(', ');
	}
	return field.descriptor.formatDisplay(value, field.context);
}

interface CollectedColumns {
	readonly columns: readonly NativeColumn[];
	readonly omittedUnsupported: number;
	readonly omittedLinks: number;
}

function collectColumns(
	snapshot: ActiveTableSnapshot,
	environment: NativeExportEnvironment,
): CollectedColumns {
	let omittedUnsupported = 0;
	let omittedLinks = 0;
	const columns: NativeColumn[] = [];
	for (const stored of snapshot.fields) {
		if (stored.kind !== 'field' || stored.id === null || stored.name === null) {
			omittedUnsupported += 1;
		} else if (stored.type === 'link') {
			omittedLinks += 1;
		} else if (isFieldTypeId(stored.type)) {
			columns.push(exportColumn(stored, stored.type, environment));
		} else {
			omittedUnsupported += 1;
		}
	}
	return { columns, omittedUnsupported, omittedLinks };
}

function resultOf(
	snapshot: ActiveTableSnapshot,
	columns: readonly NativeColumn[],
	rowIds: readonly string[],
	mode: NativeExportMode,
	omittedUnsupported: number,
	omittedLinks: number,
): NativeExportResult {
	const header = columns.map((column) => column.name);
	const body = rowIds.map((rowId) =>
		columns.map((column) =>
			nativeCellText(column, viewCellOf(snapshot, rowId, column.id), mode),
		),
	);
	return {
		matrix: columns.length === 0 ? [] : [header, ...body],
		exportedFields: header,
		columns: columns.map((column) => ({ name: column.name, type: column.type })),
		omittedUnsupported,
		omittedLinks,
		rowCount: rowIds.length,
	};
}

/** The table as a matrix, for the given mode and environment. */
export function nativeTableMatrix(
	snapshot: ActiveTableSnapshot,
	mode: NativeExportMode,
	environment: NativeExportEnvironment,
): NativeExportResult {
	const { columns, omittedUnsupported, omittedLinks } = collectColumns(snapshot, environment);
	return resultOf(
		snapshot,
		columns,
		snapshot.rows.map((row) => row.id),
		mode,
		omittedUnsupported,
		omittedLinks,
	);
}

export interface NativeViewExportResult extends NativeExportResult {
	readonly viewName: string;
	/** Problems the saved filter carries. The grid shows the same list. */
	readonly filterProblems: readonly string[];
	readonly sortCount: number;
	/** Exportable columns the saved view hides. They are left out of the file. */
	readonly hiddenColumns: number;
}

export type NativeViewExportOutcome =
	| { readonly ok: true; readonly result: NativeViewExportResult }
	| { readonly ok: false; readonly reason: string };

/** The grid's cell value for filtering: an empty or invalid cell is `null`. Mirrors `gridValue` in the grid. */
function filterValueOf(snapshot: ActiveTableSnapshot, rowId: string, fieldId: string): CellValue {
	const stored = viewCellOf(snapshot, rowId, fieldId);
	if (stored === undefined || stored === null || isInvalidCell(stored)) {
		return null;
	}
	return stored;
}

/** A select's filter value is its option name, not its ID. Mirrors `queryValueOf` in the grid. */
function filterCellValueOf(column: NativeColumn, value: CellValue): CellValue {
	const options = column.field.options.options ?? [];
	if (column.type === 'singleSelect' && typeof value === 'string') {
		return options.find((option) => option.id === value)?.name ?? value;
	}
	if (column.type === 'multiSelect' && isStringList(value)) {
		return value.map((id) => options.find((option) => option.id === id)?.name ?? id);
	}
	return value;
}

/**
 * A saved view as a matrix (R5 Part B item 2). It runs the same `buildView` the grid runs, with the view's own
 * filter, sorts, grouping, hidden fields and column order. Rows in collapsed groups are included, since a
 * collapsed group is a display state, not a filter. A view whose filter reads a field the export does not write
 * is refused with a reason, because the export would otherwise filter on values it does not show.
 */
export function nativeViewMatrix(
	snapshot: ActiveTableSnapshot,
	view: TableView,
	mode: NativeExportMode,
	environment: NativeExportEnvironment,
): NativeViewExportOutcome {
	const { columns, omittedUnsupported, omittedLinks } = collectColumns(snapshot, environment);
	const exportedIds = new Set(columns.map((column) => column.id));
	const blocked = fieldsMentioned(view.filterExpr).find((fieldId) => !exportedIds.has(fieldId));
	if (blocked !== undefined) {
		const name = snapshot.fieldById.get(blocked)?.name ?? blocked;
		return {
			ok: false,
			reason: `The filter of “${view.name}” uses “${name}”, which this export does not write. Export the whole table instead.`,
		};
	}
	const rowViews: RowView[] = snapshot.rows.map((row) => {
		const cells: Record<string, CellValue> = {};
		for (const column of columns) {
			cells[column.id] = filterCellValueOf(
				column,
				filterValueOf(snapshot, row.id, column.id),
			);
		}
		return { rowId: row.id, cells };
	});
	const built = buildView({
		fields: columns.map((column) => column.field),
		rows: rowViews,
		view: {
			sorts: view.sorts.map(({ fieldId, direction }) => ({ fieldId, direction })),
			...(view.groupBy === null ? {} : { groupBy: view.groupBy }),
			collapsedKeys: view.collapsedKeys,
			hiddenFieldIds: view.hiddenFieldIds,
			columnOrder: view.columnOrder,
		},
		queryAst: view.filterExpr,
	});
	// Grouped views list every matched row, collapsed or not: the file states the scope in the dialog.
	const matched =
		built.groups.length > 0 ? built.groups.flatMap((group) => group.rows) : built.rows;
	const visible = built.columnOrder
		.filter((fieldId) => !built.hiddenFieldIds.includes(fieldId))
		.flatMap((fieldId) => {
			const column = columns.find((candidate) => candidate.id === fieldId);
			return column === undefined ? [] : [column];
		});
	const base = resultOf(
		snapshot,
		visible,
		matched.map((row) => row.rowId),
		mode,
		omittedUnsupported,
		omittedLinks,
	);
	return {
		ok: true,
		result: {
			...base,
			viewName: view.name,
			filterProblems: view.filterProblems,
			sortCount: view.sorts.length,
			hiddenColumns: columns.length - visible.length,
		},
	};
}

function exportColumn(
	stored: FieldDefinition,
	type: FieldTypeId,
	environment: NativeExportEnvironment,
): NativeColumn {
	const fieldOptions = optionsOf(stored);
	const definition: PropertyDefinition = {
		id: stored.id,
		name: stored.name,
		source: 'database',
		fieldOptions,
	};
	const context: FieldContext = {
		now: environment.now,
		timezone: environment.timezone,
		locale: environment.locale,
		fieldOptions,
		columnName: stored.name,
	};
	return {
		id: stored.id,
		name: stored.name,
		type,
		field: resolveField(definition, context),
	};
}
