/**
 * A native table as an export matrix (R5 Part B). Pure: it reads a projected table and the three context values
 * the field descriptors need, and returns text. No vault, no clock, no host.
 *
 * Scope and omissions are data, not prose, so the dialog can state them exactly:
 *
 *  - **Scope is the whole table in its manual order** (ADR-0003). A saved view's filters and sorts are not applied
 *    here yet; the dialog says so rather than pretending to export "the view".
 *  - **Unsupported and link fields are omitted and counted.** Link values are record IDs, and a readable
 *    representation needs the target table's labels; that is not built yet, so a link column is reported, not
 *    silently exported as IDs.
 *  - **`display` is what a cell shows, `raw` is text a spreadsheet reads back unchanged.** Display follows the
 *    native grid's own rules for selects and invalid values; raw uses each descriptor's `formatPlain`.
 */
import { resolveField } from '../../schema/propertySchema';
import type { PropertyDefinition, ResolvedField } from '../../schema/propertySchema';
import type { Matrix } from '../../selection/clipboard';
import type { CellValue, FieldContext, FieldOption, FieldOptions } from '../../types';
import { isFieldTypeId } from '../../types';
import type { ActiveTableSnapshot } from '../projection';
import { viewCellOf } from '../projection';
import type { FieldDefinition } from '../fields';
import { isInvalidCell } from '../values';
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
	readonly omittedUnsupported: number;
	readonly omittedLinks: number;
	readonly rowCount: number;
}

interface ExportColumn {
	readonly id: string;
	readonly name: string;
	readonly type: string;
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
	column: ExportColumn,
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

/** The table as a matrix, for the given mode and environment. */
export function nativeTableMatrix(
	snapshot: ActiveTableSnapshot,
	mode: NativeExportMode,
	environment: NativeExportEnvironment,
): NativeExportResult {
	let omittedUnsupported = 0;
	let omittedLinks = 0;
	const columns: ExportColumn[] = [];
	for (const stored of snapshot.fields) {
		if (stored.kind !== 'field' || stored.id === null || stored.name === null) {
			omittedUnsupported += 1;
		} else if (stored.type === 'link') {
			omittedLinks += 1;
		} else if (isFieldTypeId(stored.type)) {
			columns.push(exportColumn(stored, environment));
		} else {
			omittedUnsupported += 1;
		}
	}
	const header = columns.map((column) => column.name);
	const body = snapshot.rows.map((row) =>
		columns.map((column) =>
			nativeCellText(column, viewCellOf(snapshot, row.id, column.id), mode),
		),
	);
	return {
		matrix: columns.length === 0 ? [] : [header, ...body],
		exportedFields: header,
		omittedUnsupported,
		omittedLinks,
		rowCount: snapshot.rows.length,
	};
}

function exportColumn(stored: FieldDefinition, environment: NativeExportEnvironment): ExportColumn {
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
		type: stored.type,
		field: resolveField(definition, context),
	};
}
