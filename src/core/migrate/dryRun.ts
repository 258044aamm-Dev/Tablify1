/**
 * The dry run: what a `.tabula` migration **would** do, as data.
 *
 * `docs/03-data-model-and-migration.md` §Migration: step 2 is "compute the target set" and step 3 is the
 * report the dialog shows. This module is exactly that report — no prose, no rendering, no vault — so the UI
 * can build a table from it, a test can assert on its shape, and the count a person reads is the count the
 * migration then produces (both come from the same numbers; `apply.ts` reads this report rather than
 * recomputing).
 *
 * Every loss is a field here. The report is the place a migration is allowed to be imperfect, as long as it
 * says so: a dropped column, a value whose option is gone, a filter this build cannot express, a legacy
 * view setting with no destination. Nothing is dropped quietly — `docs/03` §what is reported as dropped.
 */
import type { FilterOpId, PropertyId } from '../types';
import type { SortSpec } from '../view/pipeline';
import type { ViewPatch } from '../ops/types';
import type {
	FieldMapping,
	OrphanSelection,
	ResolvedColumn,
	TabulaDoc,
	TabulaTable,
	TabulaWarning,
} from '../../adapters/tabulaFile/model';
import {
	cellToPlain,
	orphanSelections,
	resolveColumns,
	toFieldDescriptors,
} from '../../adapters/tabulaFile/model';

/**
 * Where a migration is allowed to put things. The caller owns paths — sanitisation and collision suffixes
 * live in `adapters/notes/createNote.ts` and nowhere else — so the report states the *names* it wants and
 * `pathFor` turns one into a path when the ops are built.
 */
export type MigrationTarget = {
	/** `Projects.tabula` → `Projects.base`. */
	readonly basePath: string;
	/** One folder per table. `docs/03` §Migration step 2: `<base name>/<table name>/`. */
	readonly folderFor: (table: TabulaTable, index: number) => string;
	/** The intended path for one row's note. **The caller sanitises and de-duplicates here.** */
	readonly pathFor: (input: {
		readonly table: TabulaTable;
		readonly tableIndex: number;
		readonly rowId: string;
		readonly ordinal: number;
		readonly primaryValue: string;
	}) => string;
	/** The filename template, carried for display only; `{{Name}}` is what `createNote` knows. */
	readonly filenameTemplate?: string;
};

/**
 * Where one column ends up. Four destinations, because "what happens to this column" has four answers and a
 * booleans-only model would blur two of them:
 *
 *   - `kept`     — same type, values stored as they are;
 *   - `remapped` — kept as a column, but the type changed on the way in (an unknown legacy type becomes text)
 *                  or the values stop being stored (see `metadata`);
 *   - `metadata` — becomes a read-only `file.*` column: the column survives, the *values* are recomputed by
 *                  Obsidian (`docs/03` §field type mapping) and are therefore not copied;
 *   - `dropped`  — no column and no values; today that is `autoNumber` alone.
 */
export type ColumnDestination = 'kept' | 'remapped' | 'metadata' | 'dropped';

/** One column, as the report shows it. */
export type ColumnPlan = {
	readonly fieldId: string;
	readonly sourceName: string;
	/** The frontmatter key (or the `.base` column id) this column becomes. */
	readonly propertyName: string;
	/** The legacy type exactly as the file spelled it. */
	readonly from: string;
	/** This build's type id, or `null` when the column is dropped. */
	readonly to: string | null;
	readonly destination: ColumnDestination;
	/** Whether the values go into frontmatter at all (false for the file-metadata columns). */
	readonly stored: boolean;
	/** True when the file's type was not a legacy type at all. */
	readonly unknown: boolean;
	readonly renamed: boolean;
	readonly reserved: boolean;
	readonly note: string;
};

/** One legacy filter condition and what this build does with it. */
export type ConditionPlan = {
	readonly fieldId: string;
	readonly operator: string;
	/** The canonical operator it becomes, or `null` when there is no single one. */
	readonly canonical: FilterOpId | null;
	readonly reason: string;
};

/** How much of the legacy view survives, and where the rest went. */
export type ViewTranslation = {
	/** What `migrateMutation` will put in the `setViewConfig` op. */
	readonly applied: ViewPatch;
	readonly sorts: number;
	readonly groupBy: PropertyId | null;
	readonly hiddenColumns: number;
	readonly conditions: readonly ConditionPlan[];
	readonly dropped: readonly string[];
};

/** One table's plan. */
export type TablePlan = {
	readonly tableId: string;
	readonly tableName: string;
	/** The folder every note of this table is created in. */
	readonly folder: string;
	readonly rows: number;
	readonly columns: readonly ColumnPlan[];
	/** Columns kept under a different type: an unknown legacy type, kept as text. */
	readonly remapped: readonly ColumnPlan[];
	/** Columns that become read-only `file.*` columns; their stored values are not copied. */
	readonly metadata: readonly ColumnPlan[];
	/** Columns with no destination at all. */
	readonly dropped: readonly ColumnPlan[];
	/** Select values whose option is gone. Written as text; listed here so nothing disappears quietly. */
	readonly orphans: readonly OrphanSelection[];
	/** Values whose shape the destination column cannot hold (a number in a date column, say). */
	readonly shapeProblems: number;
	/** The column that names a note: the first stored column, or `null`. */
	readonly primaryFieldId: string | null;
	readonly primaryFieldName: string | null;
	/** Rows with no primary value; they are still notes, named `Row <n>`. */
	readonly missingPrimary: number;
	/** Rows whose primary value repeats another row's, so one of them takes a ` 2` suffix (case-insensitive). */
	readonly duplicateNames: number;
	/** Exactly how many notes this table creates: one per row. */
	readonly notesToCreate: number;
	/** The first three names, for the dialog's "these will be your notes" line. */
	readonly filenameSample: readonly string[];
	readonly view: ViewTranslation;
	readonly warnings: readonly TabulaWarning[];
	/** The legacy sync link, if the file had one. The mapping file keeps it alive across the migration. */
	readonly sync: TabulaTable['sync'];
};

export type MigrationReport = {
	readonly path: string;
	readonly version: 1 | 2;
	readonly basePath: string;
	readonly filenameTemplate: string;
	readonly tables: readonly TablePlan[];
	readonly totals: {
		readonly tables: number;
		readonly rows: number;
		readonly notesToCreate: number;
		readonly columns: number;
		readonly remappedColumns: number;
		readonly metadataColumns: number;
		readonly droppedColumns: number;
		readonly orphanValues: number;
		readonly warnings: number;
	};
	readonly warnings: readonly TabulaWarning[];
};

/** The legacy operator vocabulary, mapped onto the twelve canonical ones (`docs/08` §query). */
const OPERATOR_MAP: Readonly<Record<string, FilterOpId>> = {
	contains: 'contains',
	equals: 'is',
	is: 'is',
	isNot: 'isNot',
	isEmpty: 'isEmpty',
	isNotEmpty: 'isNotEmpty',
	gt: 'gt',
	lt: 'lt',
	before: 'lt',
	after: 'gt',
	isTrue: 'is',
	isFalse: 'is',
	isAnyOf: 'contains',
	containsAny: 'contains',
};

const ANALYSIS: Readonly<Record<string, string>> = {
	equals: 'legacy “equals” is this build’s “is”',
	is: 'same operator',
	isNot: 'same operator',
	contains: 'same operator',
	isEmpty: 'same operator',
	isNotEmpty: 'same operator',
	gt: 'same operator',
	lt: 'same operator',
	before: 'a date “before” is a “less than”',
	after: 'a date “after” is a “greater than”',
	isTrue: 'a checkbox “is true” is “is true”',
	isFalse: 'a checkbox “is false” is “is false”',
	isAnyOf: '“is any of” becomes a “contains” on the label',
	containsAny: '“contains any” becomes a “contains” on the label',
};

function conditionPlan(fieldId: string, operator: string): ConditionPlan {
	const canonical = OPERATOR_MAP[operator];
	if (canonical === undefined) {
		return {
			fieldId,
			operator,
			canonical: null,
			reason: `the operator “${operator}” has no single equivalent here; the condition is reported, not translated`,
		};
	}
	const reason = ANALYSIS[operator] ?? 'same operator';
	return { fieldId, operator, canonical, reason };
}

/** Field id → the Bases property id its column becomes, for one table. */
function propertyIdsByField(columns: readonly ResolvedColumn[]): ReadonlyMap<string, PropertyId> {
	const map = new Map<string, PropertyId>();
	for (const column of columns) {
		map.set(
			column.fieldId,
			column.destination === 'view'
				? `file.${metadataName(column.legacyType)}`
				: `note.${column.propertyName}`,
		);
	}
	return map;
}

/** `createdTime` → `ctime`, `lastModifiedTime` → `mtime`: the file properties Obsidian already has. */
function metadataName(legacyType: string): string {
	return legacyType === 'createdTime' ? 'ctime' : 'mtime';
}

function droppedSettings(table: TabulaTable): readonly string[] {
	const dropped: string[] = [];
	if (table.view.search !== '') {
		dropped.push('search (per-session in Bases, so it is not carried)');
	}
	if (Object.keys(table.view.columnWidths).length > 0) {
		dropped.push(
			`${String(Object.keys(table.view.columnWidths).length)} column width(s) (view sidecar)`,
		);
	}
	if (table.view.rowHeight !== 'medium') {
		dropped.push(`row height “${table.view.rowHeight}” (view sidecar)`);
	}
	if (table.view.frozenPrimary) {
		dropped.push('pinned primary column (view sidecar)');
	}
	if (table.view.query !== '') {
		dropped.push(`query string “${table.view.query}” (folded into the filter translation)`);
	}
	// The counter is only worth reporting when a column actually used it: a `.tabula` file carries
	// `autoNumberNext` even when it has no autoNumber column, and "discarded" would then be noise.
	if (
		table.autoNumberNext !== null &&
		table.fields.some((field) => field.legacyType === 'autoNumber')
	) {
		dropped.push('auto-number counter (discarded with the autoNumber column)');
	}
	return dropped;
}

function planTable(
	table: TabulaTable,
	index: number,
	target: MigrationTarget,
	warnings: readonly TabulaWarning[],
): TablePlan {
	const mappings = toFieldDescriptors(table);
	const columns = resolveColumns(table);
	const byField = propertyIdsByField(columns);
	const planOf = (mapping: FieldMapping, position: number): ColumnPlan => {
		const column = columns[position];
		return {
			fieldId: mapping.field.id,
			sourceName: mapping.field.name,
			propertyName: column?.propertyName ?? propertyNameFallback(mapping, position),
			from: mapping.field.legacyType,
			to: mapping.target,
			destination: destinationOf(mapping),
			stored: mapping.stored,
			unknown: mapping.field.unknown,
			renamed: column?.renamed ?? false,
			reserved: column?.reserved ?? false,
			note: mapping.note,
		};
	};
	const plans = mappings.map((mapping, position) => planOf(mapping, position));
	const remapped = plans.filter((plan) => plan.destination === 'remapped');
	const metadata = plans.filter((plan) => plan.destination === 'metadata');
	const dropped = plans.filter((plan) => plan.destination === 'dropped');

	const primaryIndex = columns.findIndex((column) => column.destination === 'property');
	const primaryColumn = primaryIndex < 0 ? undefined : columns[primaryIndex];
	const primaryMapping = primaryIndex < 0 ? undefined : mappings[primaryIndex];
	const primaryFieldId = primaryMapping === undefined ? null : primaryMapping.field.id;
	const primaryName = primaryColumn === undefined ? null : primaryColumn.propertyName;

	let missingPrimary = 0;
	let shapeProblems = 0;
	const seenNames = new Map<string, number>();
	const names: string[] = [];
	for (const row of table.rows) {
		let primaryValue = '';
		if (primaryMapping !== undefined) {
			primaryValue = cellToPlain(
				primaryMapping.field,
				row.cells[primaryMapping.field.id],
			).trim();
		}
		if (primaryValue === '') {
			missingPrimary += 1;
		} else {
			const key = primaryValue.toLowerCase();
			seenNames.set(key, (seenNames.get(key) ?? 0) + 1);
		}
		names.push(primaryValue);
		for (const mapping of mappings) {
			if (mapping.target === null || !mapping.stored) {
				continue;
			}
			const value = row.cells[mapping.field.id];
			if (!shapeFits(mapping, value)) {
				shapeProblems += 1;
			}
		}
	}
	const duplicateNames = [...seenNames.values()].filter((count) => count > 1).length;

	const sorts: SortSpec[] = [];
	for (const sort of table.view.sorts) {
		const fieldId = byField.get(sort.fieldId);
		if (fieldId === undefined) {
			continue;
		}
		sorts.push({ fieldId, direction: sort.direction === 'desc' ? 'desc' : 'asc' });
	}
	const groupByField = table.view.groupBy === null ? undefined : byField.get(table.view.groupBy);
	const hiddenFieldIds = table.view.hiddenFieldIds
		.map((id) => byField.get(id))
		.filter((id): id is PropertyId => id !== undefined);
	const columnOrder = columns
		.filter((column) => column.destination !== 'dropped')
		.map((column) => byField.get(column.fieldId))
		.filter((id): id is PropertyId => id !== undefined);
	const conditionPlans = table.view.filters.conditions.map((condition) =>
		conditionPlan(byField.get(condition.fieldId) ?? condition.fieldId, condition.operator),
	);
	// A filter with no canonical operator is not applied, so it belongs in the same list as every other
	// setting that does not survive — a person reads one list of losses, not two.
	const droppedLines: readonly string[] = [
		...droppedSettings(table),
		...conditionPlans
			.filter((condition) => condition.canonical === null)
			.map(
				(condition) =>
					`filter “${condition.operator}” on “${condition.fieldId}” (${condition.reason})`,
			),
	];
	const applied: ViewPatch = {
		...(sorts.length === 0 ? {} : { sorts }),
		...(groupByField === undefined ? {} : { groupBy: groupByField }),
		...(hiddenFieldIds.length === 0 ? {} : { hiddenFieldIds }),
		...(columnOrder.length === 0 ? {} : { columnOrder }),
	};

	return {
		tableId: table.id,
		tableName: table.name,
		folder: target.folderFor(table, index),
		rows: table.rows.length,
		columns: plans,
		remapped,
		metadata,
		dropped,
		orphans: orphanSelections(table),
		shapeProblems,
		primaryFieldId,
		primaryFieldName: primaryName,
		missingPrimary,
		duplicateNames,
		notesToCreate: table.rows.length,
		filenameSample: names.filter((name) => name !== '').slice(0, 3),
		view: {
			applied,
			sorts: sorts.length,
			groupBy: groupByField ?? null,
			hiddenColumns: hiddenFieldIds.length,
			conditions: conditionPlans,
			dropped: droppedLines,
		},
		warnings,
		sync: table.sync,
	};
}

/** One mapping's destination, in the report's four-way vocabulary. */
function destinationOf(mapping: FieldMapping): ColumnDestination {
	if (mapping.target === null) {
		return 'dropped';
	}
	if (!mapping.stored) {
		return 'metadata';
	}
	return mapping.field.unknown || mapping.target !== mapping.field.legacyType
		? 'remapped'
		: 'kept';
}

/** The column's name when `resolveColumns` had nothing to say — only reachable for a malformed field list. */
function propertyNameFallback(mapping: FieldMapping, position: number): string {
	const name = mapping.field.name.replace(/\s+/g, ' ').trim();
	return name === '' ? `Column ${String(position + 1)}` : name;
}

/** Can the destination column hold this value as it stands? Shapes, not types: a number in a text column is fine. */
function shapeFits(mapping: FieldMapping, value: unknown): boolean {
	if (value === undefined || value === null) {
		return true;
	}
	switch (mapping.target) {
		case 'number':
		case 'currency':
		case 'percent':
		case 'rating':
		case 'duration':
			return typeof value === 'number';
		case 'checkbox':
			return typeof value === 'boolean';
		case 'date':
		case 'datetime':
			return typeof value === 'string';
		case 'singleSelect':
		case 'multiSelect':
			return typeof value === 'string' || Array.isArray(value);
		case 'attachment':
			return typeof value === 'string' || Array.isArray(value);
		default:
			return true;
	}
}

/**
 * The report. Pure: same doc, same report, no clock and no vault.
 *
 * `warnings` are the doc's own (an unknown type, a missing id); the per-table ones are filtered from the
 * same list by the field ids the table mentions, so a warning about table 3 does not appear under table 1.
 */
export function dryRunMigration(doc: TabulaDoc, target: MigrationTarget): MigrationReport {
	const tables = doc.tables.map((table, index) => {
		// A warning about this table, or about the document as a whole (no index). Nothing else: a report
		// that shows table 3's unknown type under table 1 is worse than no report.
		const scoped = doc.warnings.filter(
			(warning) => warning.tableIndex === undefined || warning.tableIndex === index,
		);
		return planTable(table, index, target, scoped);
	});
	const totals = {
		tables: tables.length,
		rows: tables.reduce((sum, table) => sum + table.rows, 0),
		notesToCreate: tables.reduce((sum, table) => sum + table.notesToCreate, 0),
		columns: tables.reduce((sum, table) => sum + table.columns.length, 0),
		remappedColumns: tables.reduce((sum, table) => sum + table.remapped.length, 0),
		metadataColumns: tables.reduce((sum, table) => sum + table.metadata.length, 0),
		droppedColumns: tables.reduce((sum, table) => sum + table.dropped.length, 0),
		orphanValues: tables.reduce((sum, table) => sum + table.orphans.length, 0),
		warnings: doc.warnings.length,
	};
	return {
		path: doc.path,
		version: doc.version,
		basePath: target.basePath,
		filenameTemplate: target.filenameTemplate ?? '{{Name}}',
		tables,
		totals,
		warnings: doc.warnings,
	};
}

/**
 * The column order the `.base` writer will need: every surviving column, as a Bases property id, in file
 * order. `docs/03` §migration step 2 — one view per table, and the columns keep the order they were in.
 */
export function baseColumnOrder(plan: TablePlan): readonly PropertyId[] {
	return plan.columns
		.filter((column) => column.to !== null)
		.map((column) =>
			column.stored ? `note.${column.propertyName}` : `file.${metadataName(column.from)}`,
		);
}
