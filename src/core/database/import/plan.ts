/**
 * The exact, pure plan for importing one source preview into a native database.
 *
 * The planner is deliberately separate from the legacy note-import plan and from any host/UI. It resolves the
 * selected destination, stable IDs, field/option mappings, conversions, row-key decisions, confirmations, and
 * the exact database operations the later apply step can consume. It never writes a file or creates a note.
 */
import { getField } from '../../fieldTypes';
import { splitLabelList } from '../../format/text';
import type { CellValue, FieldContext, FieldOptions, FieldTypeId, Parsed } from '../../types';
import { applyOperations } from '../operations';
import type { CellEdit, DatabaseOperation } from '../operations';
import { serializeDocument } from '../envelope';
import type { FieldDefinition, FieldSettings, SelectOption, TableField } from '../fields';
import { isIdOfKind } from '../ids';
import type { IdKind } from '../ids';
import type { CellState } from '../rows';
import type { DatabaseDocument, DatabaseTable, DocumentFieldTypeId } from '../schema';
import { isInvalidCell } from '../values';
import type { DatabaseImportDestination, ReplaceRowMatch } from './destination';
import type { DatabaseImportPreview } from './preview';

/** The formatting/time context used by the existing field descriptors. The clock is injected and sampled once. */
export type DatabaseImportPlanContext = Pick<FieldContext, 'now' | 'timezone' | 'locale'>;

/**
 * An explicit mapping for importing text into an existing link field.
 *
 * Keys are exact source-cell strings (not guessed labels). Values are stable row IDs in the declared target
 * table. A single link maps to one row ID; a multi-link maps to an ordered list of row IDs.
 */
export interface DatabaseImportLinkValueMapping {
	readonly sourceColumn: number;
	readonly fieldId: string;
	readonly targetTableId: string;
	readonly values: ReadonlyMap<string, string | readonly string[]>;
}

/** Optional measured thresholds; warnings are based on the projected document and plan work, not row count alone. */
export interface DatabaseImportPlanPolicy {
	/** Warn when the serialized document after this import is at least this many UTF-8 bytes. */
	readonly warnAtOrAboveDocumentBytes?: number;
	/** Warn when the plan's deterministic work-unit estimate is at least this value. */
	readonly warnAtOrAboveWorkUnits?: number;
}

/** Injected host facts and explicit link-value maps used while planning. */
export interface DatabaseImportPlanOptions {
	/** Stable ID factory supplied by the host/store; the core never reaches for random APIs. */
	readonly ids: (kind: IdKind) => string;
	readonly context: DatabaseImportPlanContext;
	readonly linkMappings?: readonly DatabaseImportLinkValueMapping[];
	readonly policy?: DatabaseImportPlanPolicy;
}

export type DatabaseImportPlanIssueCode =
	| 'invalid-preview'
	| 'no-included-columns'
	| 'invalid-destination-name'
	| 'table-not-found'
	| 'invalid-field-mapping'
	| 'duplicate-field-mapping'
	| 'field-not-found'
	| 'unsupported-field'
	| 'ambiguous-name-match'
	| 'field-name-collision'
	| 'read-only-field'
	| 'invalid-row-key'
	| 'row-key-not-mapped'
	| 'row-key-field-conflict'
	| 'duplicate-source-key'
	| 'duplicate-target-key'
	| 'duplicate-option-label'
	| 'link-mapping-invalid'
	| 'link-target-mismatch'
	| 'unmapped-link-value'
	| 'invalid-link-reference'
	| 'id-generation-failed'
	| 'invalid-clock'
	| 'operation-refused'
	| 'invalid-policy';

/** One blocking reason the exact plan could not be built safely. Source row numbers are matrix indexes. */
export interface DatabaseImportPlanIssue {
	readonly code: DatabaseImportPlanIssueCode;
	readonly message: string;
	readonly sourceRow?: number;
	readonly sourceColumn?: number;
	readonly fieldId?: string;
	readonly sourceRows?: readonly number[];
	readonly rowIds?: readonly string[];
}

/** One cell that will not be written because the target field cannot read its source text. */
export interface DatabaseImportSkippedValue {
	readonly sourceRow: number;
	readonly sourceColumn: number;
	readonly sourceText: string;
	readonly fieldId: string;
	readonly fieldName: string;
	readonly targetType: DocumentFieldTypeId;
	readonly reason: string;
}

/** A source column and its exact target, including the settings that the operations will leave in place. */
export interface PlannedDatabaseImportColumn {
	readonly sourceColumn: number;
	readonly sourceName: string;
	readonly inferredType: FieldTypeId;
	readonly sourceType: FieldTypeId;
	readonly included: boolean;
	readonly mapping: 'excluded' | 'new' | 'explicit' | 'suggested';
	readonly targetFieldId: string | null;
	readonly targetFieldName: string | null;
	readonly targetType: DocumentFieldTypeId | null;
	readonly settings: FieldSettings | null;
	/** Options created by this plan, in deterministic first-source-occurrence order. */
	readonly optionsAdded: readonly SelectOption[];
}

export type DatabaseImportRowKeyDecision =
	| { readonly kind: 'not-used'; readonly policy: 'preserve-source-duplicates' }
	| { readonly kind: 'empty'; readonly outcome: 'append' }
	| { readonly kind: 'unreadable'; readonly outcome: 'append'; readonly reason: string }
	| {
			readonly kind: 'not-found';
			readonly outcome: 'append';
			readonly value: string | number | boolean;
	  }
	| {
			readonly kind: 'matched';
			readonly rowId: string;
			readonly value: string | number | boolean;
	  };

/** The disposition of one source record, with every mapped cell conversion shown. */
export interface PlannedDatabaseImportRow {
	/** Zero-based row index in the original matrix, including the header when present. */
	readonly sourceRow: number;
	/** One-based record position among body rows. */
	readonly sourceRecord: number;
	readonly action: 'create' | 'append' | 'update';
	readonly rowId: string;
	readonly keyDecision: DatabaseImportRowKeyDecision;
	readonly cells: readonly PlannedDatabaseImportCell[];
}

/** A cell's exact source text, destination field, converted value, and whether it changes the target. */
export interface PlannedDatabaseImportCell {
	readonly sourceColumn: number;
	readonly fieldId: string;
	readonly fieldName: string;
	readonly targetType: DocumentFieldTypeId;
	readonly sourceText: string;
	readonly status: 'write' | 'clear' | 'empty' | 'unchanged' | 'skipped';
	readonly value?: CellState;
	readonly warning?: string;
}

/** Explicitly recorded duplicate handling. Rows without a key are never content-deduplicated. */
export type DatabaseImportDuplicateDecision =
	| { readonly kind: 'preserve-source-rows'; readonly rowCount: number }
	| {
			readonly kind: 'require-unique-mapped-key';
			readonly fieldId: string;
			readonly matchedRows: number;
			readonly appendedRows: number;
	  }
	| {
			readonly kind: 'multi-select-values-collapsed';
			readonly sourceRow: number;
			readonly sourceColumn: number;
			readonly duplicateCount: number;
	  };

/** An existing row the replace import does not match; it is always retained. */
export interface DatabaseImportUnmatchedExistingRow {
	readonly rowId: string;
	readonly reason: 'no-row-key' | 'empty-key' | 'unreadable-key' | 'key-not-in-import';
}

/** A removed field definition, including values that remain preserved in the row maps as orphaned cells. */
export interface DatabaseImportRemovedField {
	readonly fieldId: string;
	readonly name: string;
	readonly type: string;
	readonly storedCellCount: number;
	readonly valuesRemainPreserved: true;
}

/** A confirmation that the apply step must bind to this exact plan, not to a generic warning. */
export type DatabaseImportConfirmation =
	| {
			readonly kind: 'suggested-field-mappings';
			readonly mappings: readonly {
				readonly sourceColumn: number;
				readonly sourceName: string;
				readonly fieldId: string;
				readonly fieldName: string;
			}[];
	  }
	| {
			readonly kind: 'replace-values';
			readonly tableId: string;
			readonly updatedRowIds: readonly string[];
			readonly appendedRowIds: readonly string[];
			readonly clearedCells: readonly {
				readonly sourceRow: number;
				readonly fieldId: string;
			}[];
			readonly unmatchedExistingRowIds: readonly string[];
	  }
	| {
			readonly kind: 'accept-skipped-values';
			readonly skipped: readonly DatabaseImportSkippedValue[];
	  }
	| {
			readonly kind: 'add-select-options';
			readonly additions: readonly {
				readonly fieldId: string;
				readonly fieldName: string;
				readonly options: readonly SelectOption[];
			}[];
	  }
	| {
			readonly kind: 'remove-import-absent-fields';
			readonly fields: readonly DatabaseImportRemovedField[];
	  };

/** A measured-policy warning. No `.tabula` or file-count heuristic is used. */
export interface DatabaseImportPlanWarning {
	readonly code: 'document-size-threshold' | 'work-threshold';
	readonly actual: number;
	readonly threshold: number;
	readonly message: string;
}

/** Counts and byte sizes computed from the exact operation list and its in-memory result. */
export interface DatabaseImportPlanMetrics {
	readonly sourceRows: number;
	readonly includedColumns: number;
	readonly sourceCellsExamined: number;
	readonly targetRowsScanned: number;
	readonly rowsMatched: number;
	readonly rowsCreated: number;
	readonly rowsUpdated: number;
	readonly cellsWritten: number;
	readonly cellsCleared: number;
	readonly cellsSkipped: number;
	readonly fieldsCreated: number;
	readonly fieldsRemoved: number;
	readonly optionsCreated: number;
	readonly operationCount: number;
	readonly documentBytesBefore: number;
	readonly documentBytesAfter: number;
	readonly documentBytesDelta: number;
	/** `sourceCellsExamined + targetRowsScanned + operationCount`; deterministic, not wall-clock time. */
	readonly estimatedWorkUnits: number;
}

/** A resolved destination; all table/field/row IDs and operations are fixed. */
export type PlannedDatabaseImportDestination =
	| { readonly kind: 'create'; readonly tableId: string; readonly tableName: string }
	| { readonly kind: 'append'; readonly tableId: string; readonly tableName: string }
	| {
			readonly kind: 'replace';
			readonly tableId: string;
			readonly tableName: string;
			readonly rowMatch:
				| 'append'
				| {
						readonly kind: 'field-id';
						readonly sourceColumn: number;
						readonly fieldId: string;
				  };
			readonly removeAbsentFields: boolean;
	  };

/** The complete, immutable-by-contract plan; `operations` is what the later apply step must consume. */
export interface DatabaseImportPlan {
	readonly planVersion: 1;
	/** Exact canonical input document used to build this plan, for the later stale-plan guard. */
	readonly baseDocumentJson: string;
	readonly databaseId: string;
	readonly source: {
		readonly sourceName: string;
		readonly flavour: DatabaseImportPreview['flavour'];
		readonly hasHeader: boolean;
		readonly width: number;
		readonly rowCount: number;
	};
	readonly destination: PlannedDatabaseImportDestination;
	readonly columns: readonly PlannedDatabaseImportColumn[];
	readonly rows: readonly PlannedDatabaseImportRow[];
	readonly skippedValues: readonly DatabaseImportSkippedValue[];
	readonly duplicatePolicy: 'preserve-source-rows' | 'unique-mapped-key';
	readonly duplicateDecisions: readonly DatabaseImportDuplicateDecision[];
	readonly unmatchedExistingRows: readonly DatabaseImportUnmatchedExistingRow[];
	readonly removedFields: readonly DatabaseImportRemovedField[];
	readonly confirmations: readonly DatabaseImportConfirmation[];
	readonly warnings: readonly DatabaseImportPlanWarning[];
	readonly operations: readonly DatabaseOperation[];
	readonly metrics: DatabaseImportPlanMetrics;
}

/** A failed plan has complete blocking reasons and contains no operations that can be applied. */
export type DatabaseImportPlanResult =
	| { readonly ok: true; readonly plan: DatabaseImportPlan }
	| { readonly ok: false; readonly issues: readonly DatabaseImportPlanIssue[] };

type MappingOrigin = 'new' | 'explicit' | 'suggested';

type WorkingColumn = {
	readonly preview: DatabaseImportPreview['columns'][number];
	readonly origin: MappingOrigin;
	readonly field: FieldDefinition;
	readonly originalField: FieldDefinition | null;
	finalSettings: FieldSettings;
	optionsAdded: SelectOption[];
};

type RawCell = {
	readonly sourceRow: number;
	readonly sourceRecord: number;
	readonly sourceColumn: number;
	readonly field: FieldDefinition;
	readonly sourceText: string;
	readonly value: CellState | undefined;
	readonly skipped: DatabaseImportSkippedValue | undefined;
	readonly warning: string | undefined;
};

type RawSourceRow = {
	readonly sourceRow: number;
	readonly sourceRecord: number;
	readonly cells: ReadonlyMap<number, RawCell>;
};

interface IndexedLinkMapping {
	readonly mapping: DatabaseImportLinkValueMapping;
	readonly targetTable: DatabaseTable;
	readonly targetRowIds: ReadonlySet<string>;
}

type LinkMappingByColumn = ReadonlyMap<number, IndexedLinkMapping>;

interface LinkMappingIndex {
	readonly byColumn: LinkMappingByColumn;
	readonly targetRowsScanned: number;
}

type ScalarKey = string | number | boolean;

/**
 * Build the exact native import plan without mutating `document` or invoking the legacy note-import path.
 *
 * Included columns not mapped to an existing field create new fields. Existing field types are authoritative:
 * their source text is converted by that type's existing `parsePlain` descriptor. New fields use the preview's
 * chosen type. Select labels become stable option IDs; links require an explicit exact-value-to-row-ID mapping.
 */
export function buildDatabaseImportPlan(
	document: DatabaseDocument,
	preview: DatabaseImportPreview,
	destination: DatabaseImportDestination,
	options: DatabaseImportPlanOptions,
): DatabaseImportPlanResult {
	const issues: DatabaseImportPlanIssue[] = [];
	const addIssue = (issue: DatabaseImportPlanIssue): void => {
		issues.push(issue);
	};

	if (!validPreview(preview)) {
		return {
			ok: false,
			issues: [
				{
					code: 'invalid-preview',
					message: 'The source preview dimensions or column indexes are inconsistent.',
				},
			],
		};
	}
	const includedPreviews = preview.columns.filter((column) => column.included);
	if (includedPreviews.length === 0) {
		return {
			ok: false,
			issues: [
				{
					code: 'no-included-columns',
					message: 'Include at least one source column before planning an import.',
				},
			],
		};
	}
	const policyIssue = validatePolicy(options.policy);
	if (policyIssue !== undefined) {
		return { ok: false, issues: [policyIssue] };
	}

	const sampledNow = sampleClock(options.context.now, addIssue);
	if (sampledNow === undefined) {
		return { ok: false, issues };
	}
	const importInstant = isoInstant(sampledNow, addIssue);
	if (importInstant === undefined) {
		return { ok: false, issues };
	}
	const context: DatabaseImportPlanContext = {
		now: () => sampledNow,
		timezone: options.context.timezone,
		locale: options.context.locale,
	};

	const baseDocumentJson = serializeDocument(document);
	const documentIds = collectDocumentIds(document);
	const usedIds = new Set(documentIds);
	const makeId = (kind: IdKind): string | undefined => {
		let id: string;
		try {
			id = options.ids(kind);
		} catch (error) {
			addIssue({
				code: 'id-generation-failed',
				message: `The injected ${kind} ID factory failed: ${errorMessage(error)}.`,
			});
			return undefined;
		}
		if (!isIdOfKind(kind, id)) {
			addIssue({
				code: 'id-generation-failed',
				message: `The injected ID factory returned an invalid ${kind} ID.`,
			});
			return undefined;
		}
		if (usedIds.has(id)) {
			addIssue({
				code: 'id-generation-failed',
				message: `The injected ID factory returned an ID that already exists in this database: ${id}.`,
			});
			return undefined;
		}
		usedIds.add(id);
		return id;
	};

	let targetTable: DatabaseTable | undefined;
	let targetTableId: string;
	let resolvedDestination: PlannedDatabaseImportDestination;
	if (destination.kind === 'create') {
		if (destination.tableName.trim() === '') {
			return {
				ok: false,
				issues: [
					{
						code: 'invalid-destination-name',
						message: 'A new table needs a non-empty name.',
					},
				],
			};
		}
		const tableId = makeId('table');
		if (tableId === undefined) {
			return { ok: false, issues };
		}
		targetTableId = tableId;
		resolvedDestination = { kind: 'create', tableId, tableName: destination.tableName };
	} else {
		targetTable = document.tables.find((table) => table.id === destination.tableId);
		if (targetTable === undefined) {
			return {
				ok: false,
				issues: [
					{
						code: 'table-not-found',
						message: `The selected table "${destination.tableId}" is not in this database.`,
					},
				],
			};
		}
		targetTableId = targetTable.id;
		resolvedDestination =
			destination.kind === 'append'
				? { kind: 'append', tableId: targetTable.id, tableName: targetTable.name }
				: {
						kind: 'replace',
						tableId: targetTable.id,
						tableName: targetTable.name,
						rowMatch:
							destination.rowMatch.kind === 'append'
								? 'append'
								: {
										kind: 'field-id',
										sourceColumn: destination.rowMatch.sourceColumn,
										fieldId: destination.rowMatch.fieldId,
									},
						removeAbsentFields: destination.removeAbsentFields,
					};
	}

	const mappingBySource = resolveFieldMappings(
		preview,
		targetTable,
		destination,
		options.context.locale,
		addIssue,
	);
	const workingColumns = resolveWorkingColumns(
		preview,
		includedPreviews,
		targetTable,
		mappingBySource,
		options.context.locale,
		makeId,
		addIssue,
	);
	if (issues.length > 0) {
		return { ok: false, issues };
	}

	const linkMappingIndex = indexLinkMappings(
		options.linkMappings ?? [],
		workingColumns,
		document,
		addIssue,
	);
	if (issues.length > 0) {
		return { ok: false, issues };
	}

	const linkMappings = linkMappingIndex.byColumn;
	const skippedValues: DatabaseImportSkippedValue[] = [];
	const duplicateDecisions: DatabaseImportDuplicateDecision[] = [];
	const rawRows = readSourceRows(
		preview,
		workingColumns,
		linkMappings,
		context,
		skippedValues,
		duplicateDecisions,
		addIssue,
	);
	addImportedSelectOptions(workingColumns, rawRows, makeId, options.context.locale, addIssue);
	if (issues.length > 0) {
		return { ok: false, issues };
	}
	const convertedRows = convertSelectValues(
		workingColumns,
		rawRows,
		options.context.locale,
		addIssue,
	);
	if (issues.length > 0) {
		return { ok: false, issues };
	}

	const rowMatch: ReplaceRowMatch =
		destination.kind === 'replace' ? destination.rowMatch : { kind: 'append' };
	const keyColumn =
		rowMatch.kind === 'field-id'
			? workingColumns.find((column) => column.preview.index === rowMatch.sourceColumn)
			: undefined;
	if (rowMatch.kind === 'field-id') {
		if (
			keyColumn === undefined ||
			keyColumn.field.id !== rowMatch.fieldId ||
			!isScalarRowKeyType(keyColumn.field.type)
		) {
			addIssue({
				code: 'invalid-row-key',
				message:
					'The replace key must be an included, mapped scalar field; multi-value, link, attachment, and read-only fields cannot identify rows.',
				sourceColumn: rowMatch.sourceColumn,
				fieldId: rowMatch.fieldId,
			});
		}
	}
	if (issues.length > 0) {
		return { ok: false, issues };
	}

	const existingRowsByKey =
		rowMatch.kind === 'field-id' && targetTable !== undefined && keyColumn !== undefined
			? indexExistingRowsByKey(targetTable, keyColumn.field.id)
			: new Map<string, readonly DatabaseTable['rows'][number][]>();
	const sourceRowsByKey =
		rowMatch.kind === 'field-id' && keyColumn !== undefined
			? indexSourceRowsByKey(convertedRows, keyColumn.preview.index, keyColumn.field.id)
			: new Map<
					string,
					{ readonly value: ScalarKey; readonly rows: readonly RawSourceRow[] }
				>();
	if (rowMatch.kind === 'field-id') {
		for (const [key, group] of sourceRowsByKey) {
			if (group.rows.length > 1) {
				addIssue({
					code: 'duplicate-source-key',
					message: `The mapped row key ${JSON.stringify(group.value)} occurs more than once in the source; no row is chosen arbitrarily.`,
					sourceColumn: rowMatch.sourceColumn,
					sourceRows: group.rows.map((row) => row.sourceRow),
				});
			}
			const existing = existingRowsByKey.get(key) ?? [];
			if (existing.length > 1) {
				addIssue({
					code: 'duplicate-target-key',
					message: `The mapped row key ${JSON.stringify(group.value)} identifies more than one existing row; no target row is chosen arbitrarily.`,
					fieldId: rowMatch.fieldId,
					sourceRows: group.rows.map((row) => row.sourceRow),
					rowIds: existing.map((row) => row.id),
				});
			}
		}
	}
	if (issues.length > 0) {
		return { ok: false, issues };
	}

	const rowsWithIds = assignRowIds(
		convertedRows,
		rowMatch,
		keyColumn,
		existingRowsByKey,
		destination.kind === 'create' ? 'create' : 'append',
		makeId,
		addIssue,
	);
	if (issues.length > 0) {
		return { ok: false, issues };
	}

	const unmatchedExistingRows =
		destination.kind !== 'replace' || targetTable === undefined
			? []
			: rowMatch.kind === 'field-id' && keyColumn !== undefined
				? listUnmatchedExistingRows(targetTable, keyColumn.field.id, rowsWithIds)
				: listUnmatchedExistingRowsWithoutKey(targetTable);
	const removedFields =
		destination.kind === 'replace' &&
		destination.removeAbsentFields &&
		targetTable !== undefined
			? fieldsToRemove(targetTable, workingColumns, addIssue)
			: [];
	if (issues.length > 0) {
		return { ok: false, issues };
	}

	const operations = buildOperations(
		document,
		targetTableId,
		destination,
		resolvedDestination,
		workingColumns,
		rowsWithIds,
		removedFields,
		importInstant,
	);
	const applied = applyOperations(document, operations);
	if (!applied.ok) {
		return {
			ok: false,
			issues: [
				{
					code: 'operation-refused',
					message: `The exact operation list is refused by the database core (${applied.code}): ${applied.message}`,
				},
			],
		};
	}

	const columns = plannedColumns(preview, workingColumns);
	const rows = plannedRows(rowsWithIds, workingColumns);
	const targetRowsScanned =
		linkMappingIndex.targetRowsScanned +
		(destination.kind === 'replace' && targetTable !== undefined ? targetTable.rows.length : 0);
	const metrics = measurePlan(
		preview,
		workingColumns,
		rows,
		targetRowsScanned,
		removedFields,
		operations,
		baseDocumentJson,
		serializeDocument(applied.document),
	);
	const confirmations = buildConfirmations(
		destination,
		resolvedDestination,
		workingColumns,
		rows,
		skippedValues,
		unmatchedExistingRows,
		removedFields,
	);
	const warnings = measurePolicy(options.policy, metrics);
	const finalDuplicateDecisions = buildDuplicateDecisions(
		duplicateDecisions,
		rowMatch,
		keyColumn,
		rows,
	);

	const plan: DatabaseImportPlan = {
		planVersion: 1,
		baseDocumentJson,
		databaseId: document.databaseId,
		source: {
			sourceName: preview.sourceName,
			flavour: preview.flavour,
			hasHeader: preview.hasHeader,
			width: preview.width,
			rowCount: preview.rowCount,
		},
		destination: resolvedDestination,
		columns,
		rows,
		skippedValues,
		duplicatePolicy:
			rowMatch.kind === 'field-id' ? 'unique-mapped-key' : 'preserve-source-rows',
		duplicateDecisions: finalDuplicateDecisions,
		unmatchedExistingRows,
		removedFields,
		confirmations,
		warnings,
		operations,
		metrics,
	};
	return { ok: true, plan };
}

/** Build concise preview text solely from the immutable plan; callers must not recount source data independently. */
export function describeDatabaseImportPlan(plan: DatabaseImportPlan): string {
	const destination =
		plan.destination.kind === 'create'
			? `Create table “${plan.destination.tableName}”`
			: `${plan.destination.kind === 'replace' ? 'Replace values in' : 'Append to'} “${plan.destination.tableName}”`;
	const rowSummary = `${String(plan.metrics.sourceRows)} source rows, ${String(plan.metrics.rowsCreated)} new records, ${String(plan.metrics.rowsUpdated)} updated records`;
	const lines = [
		`Source: ${plan.source.sourceName} (${String(plan.source.rowCount)} rows × ${String(plan.source.width)} columns)`,
		`Destination: ${destination}`,
		`Records: ${rowSummary}`,
		`Columns: ${String(plan.metrics.includedColumns)} included, ${String(plan.columns.length - plan.metrics.includedColumns)} excluded`,
		`Cells: ${String(plan.metrics.cellsWritten)} written, ${String(plan.metrics.cellsCleared)} cleared, ${String(plan.metrics.cellsSkipped)} skipped`,
		`Schema: ${String(plan.metrics.fieldsCreated)} fields added, ${String(plan.metrics.optionsCreated)} select options added, ${String(plan.metrics.fieldsRemoved)} fields removed`,
		`Duplicates: ${plan.duplicatePolicy === 'unique-mapped-key' ? 'mapped row keys must be unique' : 'source rows are preserved; no content-based deduplication'}`,
		`Document: ${String(plan.metrics.documentBytesBefore)} → ${String(plan.metrics.documentBytesAfter)} UTF-8 bytes (${signed(plan.metrics.documentBytesDelta)})`,
		`Estimated work: ${String(plan.metrics.estimatedWorkUnits)} deterministic units`,
	];
	for (const column of plan.columns) {
		if (
			!column.included ||
			column.targetFieldId === null ||
			column.targetFieldName === null ||
			column.targetType === null
		) {
			continue;
		}
		lines.push(
			`Column ${String(column.sourceColumn + 1)} “${column.sourceName}” → “${column.targetFieldName}” (${column.sourceType} → ${column.targetType}; ${column.mapping})`,
		);
		for (const option of column.optionsAdded) {
			lines.push(`  Add option “${option.name}” (${option.id})`);
		}
	}
	for (const row of plan.rows) {
		if (row.keyDecision.kind === 'matched') {
			lines.push(
				`Source row ${String(row.sourceRow)} matches existing record ${row.keyDecision.rowId} by key ${JSON.stringify(row.keyDecision.value)}`,
			);
		} else if (row.keyDecision.kind === 'not-found') {
			lines.push(
				`Source row ${String(row.sourceRow)} has no matching record for key ${JSON.stringify(row.keyDecision.value)}; append as a new record`,
			);
		}
	}
	for (const unmatched of plan.unmatchedExistingRows) {
		lines.push(
			`Retain unmatched existing record ${unmatched.rowId} (${describeUnmatchedReason(unmatched.reason)})`,
		);
	}
	for (const skipped of plan.skippedValues) {
		lines.push(
			`Skip source row ${String(skipped.sourceRow)}, column ${String(skipped.sourceColumn + 1)} ${JSON.stringify(skipped.sourceText)}: ${skipped.reason}`,
		);
	}
	for (const removed of plan.removedFields) {
		lines.push(
			`Remove field “${removed.name}” (${removed.fieldId}); ${String(removed.storedCellCount)} stored cell value(s) remain preserved but unattached`,
		);
	}
	for (const warning of plan.warnings) {
		lines.push(`Warning: ${warning.message}`);
	}
	if (plan.confirmations.length > 0) {
		lines.push(`Explicit confirmations required: ${String(plan.confirmations.length)}`);
	}
	return lines.join('\n');
}

function validPreview(preview: DatabaseImportPreview): boolean {
	if (
		!Number.isInteger(preview.width) ||
		preview.width < 0 ||
		!Number.isInteger(preview.rowCount) ||
		preview.rowCount !== preview.body.length ||
		preview.columns.length !== preview.width ||
		preview.matrix.length !== preview.body.length + (preview.hasHeader ? 1 : 0)
	) {
		return false;
	}
	const seen = new Set<number>();
	for (const column of preview.columns) {
		if (
			!Number.isInteger(column.index) ||
			column.index < 0 ||
			column.index >= preview.width ||
			seen.has(column.index)
		) {
			return false;
		}
		seen.add(column.index);
	}
	return seen.size === preview.width;
}

function validatePolicy(
	policy: DatabaseImportPlanPolicy | undefined,
): DatabaseImportPlanIssue | undefined {
	for (const threshold of [policy?.warnAtOrAboveDocumentBytes, policy?.warnAtOrAboveWorkUnits]) {
		if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0)) {
			return {
				code: 'invalid-policy',
				message: 'Import warning thresholds must be finite, non-negative numbers.',
			};
		}
	}
	return undefined;
}

function sampleClock(
	now: () => number,
	addIssue: (issue: DatabaseImportPlanIssue) => void,
): number | undefined {
	try {
		const value = now();
		if (Number.isFinite(value)) {
			return value;
		}
	} catch (error) {
		addIssue({
			code: 'invalid-clock',
			message: `The injected clock failed: ${errorMessage(error)}.`,
		});
		return undefined;
	}
	addIssue({
		code: 'invalid-clock',
		message: 'The injected clock must return a finite timestamp.',
	});
	return undefined;
}

function isoInstant(
	milliseconds: number,
	addIssue: (issue: DatabaseImportPlanIssue) => void,
): string | undefined {
	try {
		return new Date(milliseconds).toISOString();
	} catch {
		addIssue({
			code: 'invalid-clock',
			message: 'The injected timestamp is outside the supported ISO date range.',
		});
		return undefined;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function collectDocumentIds(document: DatabaseDocument): Set<string> {
	const ids = new Set<string>([document.databaseId]);
	for (const table of document.tables) {
		ids.add(table.id);
		for (const field of table.fields) {
			if (field.id !== null) {
				ids.add(field.id);
			}
			if (field.kind === 'field') {
				for (const option of field.settings.options ?? []) {
					ids.add(option.id);
				}
			}
		}
		for (const row of table.rows) {
			ids.add(row.id);
		}
		for (const view of table.views) {
			ids.add(view.id);
		}
	}
	return ids;
}

type SourceFieldMapping = { readonly fieldId: string; readonly origin: 'explicit' | 'suggested' };

function resolveFieldMappings(
	preview: DatabaseImportPreview,
	table: DatabaseTable | undefined,
	destination: DatabaseImportDestination,
	locale: string,
	addIssue: (issue: DatabaseImportPlanIssue) => void,
): ReadonlyMap<number, SourceFieldMapping> {
	const mappings = new Map<number, SourceFieldMapping>();
	if (destination.kind === 'create' || table === undefined) {
		return mappings;
	}
	const mapping = destination.fieldMapping;
	if (mapping.kind === 'field-ids') {
		const targetById = new Map(
			table.fields.filter((field) => field.id !== null).map((field) => [field.id, field]),
		);
		const seenTargets = new Map<string, number>();
		for (const entry of mapping.fields) {
			if (
				!Number.isInteger(entry.sourceColumn) ||
				!preview.columns.some(
					(column) => column.index === entry.sourceColumn && column.included,
				)
			) {
				addIssue({
					code: 'invalid-field-mapping',
					message: `Source column ${String(entry.sourceColumn + 1)} is not an included column in this preview.`,
					sourceColumn: entry.sourceColumn,
					fieldId: entry.fieldId,
				});
				continue;
			}
			if (mappings.has(entry.sourceColumn)) {
				addIssue({
					code: 'duplicate-field-mapping',
					message: `Source column ${String(entry.sourceColumn + 1)} is mapped more than once.`,
					sourceColumn: entry.sourceColumn,
				});
				continue;
			}
			const target = targetById.get(entry.fieldId);
			if (target === undefined) {
				addIssue({
					code: 'field-not-found',
					message: `The selected field "${entry.fieldId}" is not in table "${table.name}".`,
					sourceColumn: entry.sourceColumn,
					fieldId: entry.fieldId,
				});
				continue;
			}
			const firstSource = seenTargets.get(entry.fieldId);
			if (firstSource !== undefined) {
				addIssue({
					code: 'duplicate-field-mapping',
					message: `Two source columns map to field "${entry.fieldId}".`,
					sourceColumn: entry.sourceColumn,
					fieldId: entry.fieldId,
				});
				continue;
			}
			seenTargets.set(entry.fieldId, entry.sourceColumn);
			mappings.set(entry.sourceColumn, { fieldId: entry.fieldId, origin: 'explicit' });
		}
	} else {
		const keyMapping =
			destination.kind === 'replace' && destination.rowMatch.kind === 'field-id'
				? destination.rowMatch
				: undefined;
		if (keyMapping !== undefined) {
			const sourceColumn = preview.columns.find(
				(column) => column.index === keyMapping.sourceColumn && column.included,
			);
			const targetField = table.fields.find((field) => field.id === keyMapping.fieldId);
			if (sourceColumn === undefined) {
				addIssue({
					code: 'invalid-row-key',
					message: 'The replace key column must be included in the source preview.',
					sourceColumn: keyMapping.sourceColumn,
					fieldId: keyMapping.fieldId,
				});
			} else if (targetField === undefined) {
				addIssue({
					code: 'field-not-found',
					message: `The replace key field "${keyMapping.fieldId}" is not in table "${table.name}".`,
					sourceColumn: keyMapping.sourceColumn,
					fieldId: keyMapping.fieldId,
				});
			} else {
				mappings.set(keyMapping.sourceColumn, {
					fieldId: keyMapping.fieldId,
					origin: 'explicit',
				});
			}
		}
		for (const column of preview.columns) {
			if (!column.included || mappings.has(column.index)) {
				continue;
			}
			const normalizedName = normalizeFieldName(column.name, locale);
			const candidates = table.fields.filter(
				(field) =>
					field.name !== null &&
					normalizeFieldName(field.name, locale) === normalizedName,
			);
			if (candidates.length > 1) {
				addIssue({
					code: 'ambiguous-name-match',
					message: `More than one existing field matches source column “${column.name}”; select a stable field ID explicitly.`,
					sourceColumn: column.index,
				});
				continue;
			}
			const candidate = candidates[0];
			if (candidate === undefined) {
				continue;
			}
			if (candidate.id === null || candidate.kind === 'unsupported') {
				addIssue({
					code: 'unsupported-field',
					message: `Source column “${column.name}” matches an unsupported field and cannot be mapped safely.`,
					sourceColumn: column.index,
				});
				continue;
			}
			mappings.set(column.index, { fieldId: candidate.id, origin: 'suggested' });
		}
	}

	if (destination.kind === 'replace' && destination.rowMatch.kind === 'field-id') {
		const existing = mappings.get(destination.rowMatch.sourceColumn);
		if (existing !== undefined && existing.fieldId !== destination.rowMatch.fieldId) {
			addIssue({
				code: 'row-key-field-conflict',
				message:
					'The row-key field must be the same stable field ID used by its source column mapping.',
				sourceColumn: destination.rowMatch.sourceColumn,
				fieldId: destination.rowMatch.fieldId,
			});
		}
		if (mapping.kind === 'field-ids' && existing === undefined) {
			addIssue({
				code: 'row-key-not-mapped',
				message:
					'The replace key source column must be explicitly mapped to the selected key field.',
				sourceColumn: destination.rowMatch.sourceColumn,
				fieldId: destination.rowMatch.fieldId,
			});
		}
	}
	return mappings;
}

function normalizeFieldName(name: string, locale: string): string {
	return foldLocaleCase(name.normalize('NFC').trim(), locale);
}

function foldLocaleCase(value: string, locale: string): string {
	try {
		return value.toLocaleLowerCase(locale);
	} catch {
		return value.toLowerCase();
	}
}

function isStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

function resolveWorkingColumns(
	preview: DatabaseImportPreview,
	includedPreviews: DatabaseImportPreview['columns'],
	table: DatabaseTable | undefined,
	mappings: ReadonlyMap<number, SourceFieldMapping>,
	locale: string,
	makeId: (kind: IdKind) => string | undefined,
	addIssue: (issue: DatabaseImportPlanIssue) => void,
): WorkingColumn[] {
	const existingById = new Map<string, TableField>();
	for (const field of table?.fields ?? []) {
		if (field.id !== null) {
			existingById.set(field.id, field);
		}
	}
	const result: WorkingColumn[] = [];
	const newNameOwners = new Map<string, number>();
	const mappedSourceByFieldId = new Map<string, number>();
	for (const previewColumn of includedPreviews) {
		const mapping = mappings.get(previewColumn.index);
		let field: FieldDefinition | undefined;
		let originalField: FieldDefinition | null = null;
		let origin: MappingOrigin;
		if (mapping !== undefined) {
			const found = existingById.get(mapping.fieldId);
			if (found === undefined) {
				addIssue({
					code: 'field-not-found',
					message: `The mapped field "${mapping.fieldId}" is not in the selected table.`,
					sourceColumn: previewColumn.index,
					fieldId: mapping.fieldId,
				});
				continue;
			}
			if (found.kind === 'unsupported') {
				addIssue({
					code: 'unsupported-field',
					message: `The mapped field "${mapping.fieldId}" has an unsupported type and cannot receive imported values.`,
					sourceColumn: previewColumn.index,
					fieldId: mapping.fieldId,
				});
				continue;
			}
			field = found;
			originalField = found;
			origin = mapping.origin;
		} else {
			const name = previewColumn.name.trim();
			if (name === '') {
				addIssue({
					code: 'invalid-preview',
					message: `Included source column ${String(previewColumn.index + 1)} has no usable field name.`,
					sourceColumn: previewColumn.index,
				});
				continue;
			}
			const nameKey = normalizeFieldName(name, locale);
			const firstNew = newNameOwners.get(nameKey);
			if (firstNew !== undefined) {
				addIssue({
					code: 'field-name-collision',
					message: `Included source columns ${String(firstNew + 1)} and ${String(previewColumn.index + 1)} would create fields with the same name.`,
					sourceColumn: previewColumn.index,
				});
				continue;
			}
			newNameOwners.set(nameKey, previewColumn.index);
			if (table !== undefined) {
				const collision = table.fields.find(
					(candidate) =>
						candidate.name !== null &&
						normalizeFieldName(candidate.name, locale) === nameKey,
				);
				if (collision !== undefined) {
					addIssue({
						code: 'field-name-collision',
						message: `The new field “${name}” duplicates an existing field name; map the source column to its stable field ID or choose another name.`,
						sourceColumn: previewColumn.index,
						...(collision.id === null ? {} : { fieldId: collision.id }),
					});
					continue;
				}
			}
			const fieldId = makeId('field');
			if (fieldId === undefined) {
				continue;
			}
			field = {
				kind: 'field',
				id: fieldId,
				name,
				type: previewColumn.type,
				settings: initialSettings(previewColumn.type),
				unknown: [],
			};
			origin = 'new';
		}
		if (origin !== 'new') {
			const previousSource = mappedSourceByFieldId.get(field.id);
			if (previousSource !== undefined) {
				addIssue({
					code: 'duplicate-field-mapping',
					message: `Source columns ${String(previousSource + 1)} and ${String(previewColumn.index + 1)} both map to field “${field.name}”.`,
					sourceColumn: previewColumn.index,
					fieldId: field.id,
				});
				continue;
			}
			mappedSourceByFieldId.set(field.id, previewColumn.index);
		}
		if (field.type === 'createdTime' || field.type === 'lastModifiedTime') {
			addIssue({
				code: 'read-only-field',
				message: `The read-only field “${field.name}” cannot receive imported cell values.`,
				sourceColumn: previewColumn.index,
				fieldId: field.id,
			});
			continue;
		}
		if (field.type === 'link' && field.settings.generated === true) {
			addIssue({
				code: 'read-only-field',
				message: `Generated inverse link field “${field.name}” cannot receive imported cell values.`,
				sourceColumn: previewColumn.index,
				fieldId: field.id,
			});
			continue;
		}
		result.push({
			preview: previewColumn,
			origin,
			field,
			originalField,
			finalSettings: field.settings,
			optionsAdded: [],
		});
	}
	return result;
}

function initialSettings(type: FieldTypeId): FieldSettings {
	return type === 'singleSelect' || type === 'multiSelect' ? { options: [] } : {};
}

function indexLinkMappings(
	mappings: readonly DatabaseImportLinkValueMapping[],
	columns: readonly WorkingColumn[],
	document: DatabaseDocument,
	addIssue: (issue: DatabaseImportPlanIssue) => void,
): LinkMappingIndex {
	const indexed = new Map<number, IndexedLinkMapping>();
	const targetRowsByTableId = new Map<string, ReadonlySet<string>>();
	let targetRowsScanned = 0;
	for (const mapping of mappings) {
		const column = columns.find(
			(candidate) => candidate.preview.index === mapping.sourceColumn,
		);
		if (
			column === undefined ||
			column.field.id !== mapping.fieldId ||
			column.field.type !== 'link'
		) {
			addIssue({
				code: 'link-mapping-invalid',
				message:
					'A link-value map must name an included source column that maps to the same existing link field.',
				sourceColumn: mapping.sourceColumn,
				fieldId: mapping.fieldId,
			});
			continue;
		}
		if (indexed.has(mapping.sourceColumn)) {
			addIssue({
				code: 'link-mapping-invalid',
				message: `Source column ${String(mapping.sourceColumn + 1)} has more than one link-value map.`,
				sourceColumn: mapping.sourceColumn,
				fieldId: mapping.fieldId,
			});
			continue;
		}
		if (column.field.settings.targetTableId !== mapping.targetTableId) {
			addIssue({
				code: 'link-target-mismatch',
				message: `The explicit link map targets “${mapping.targetTableId}”, but field “${column.field.name}” targets “${column.field.settings.targetTableId ?? 'no table'}”.`,
				sourceColumn: mapping.sourceColumn,
				fieldId: mapping.fieldId,
			});
			continue;
		}
		const targetTable = document.tables.find((table) => table.id === mapping.targetTableId);
		if (targetTable === undefined) {
			addIssue({
				code: 'link-target-mismatch',
				message: `The link target table “${mapping.targetTableId}” does not exist in this database.`,
				sourceColumn: mapping.sourceColumn,
				fieldId: mapping.fieldId,
			});
			continue;
		}
		let targetRowIds = targetRowsByTableId.get(targetTable.id);
		if (targetRowIds === undefined) {
			targetRowIds = new Set(targetTable.rows.map((row) => row.id));
			targetRowsByTableId.set(targetTable.id, targetRowIds);
			targetRowsScanned += targetTable.rows.length;
		}
		indexed.set(mapping.sourceColumn, { mapping, targetTable, targetRowIds });
	}
	return { byColumn: indexed, targetRowsScanned };
}

function readSourceRows(
	preview: DatabaseImportPreview,
	columns: readonly WorkingColumn[],
	linkMappings: LinkMappingByColumn,
	context: DatabaseImportPlanContext,
	skippedValues: DatabaseImportSkippedValue[],
	duplicateDecisions: DatabaseImportDuplicateDecision[],
	addIssue: (issue: DatabaseImportPlanIssue) => void,
): RawSourceRow[] {
	const rows: RawSourceRow[] = [];
	const rowOffset = preview.hasHeader ? 1 : 0;
	for (const [bodyIndex, line] of preview.body.entries()) {
		const sourceRow = bodyIndex + rowOffset;
		const cells = new Map<number, RawCell>();
		for (const column of columns) {
			const sourceText = line[column.preview.index] ?? '';
			if (column.field.type === 'link') {
				const linkMapping = linkMappings.get(column.preview.index);
				const conversion = convertLinkCell(
					column,
					sourceRow,
					bodyIndex + 1,
					sourceText,
					linkMapping,
					addIssue,
				);
				if (conversion.skipped !== undefined) {
					skippedValues.push(conversion.skipped);
				}
				cells.set(column.preview.index, conversion);
				continue;
			}
			const descriptor = getField(column.field.type);
			if (descriptor === undefined) {
				addIssue({
					code: 'read-only-field',
					message: `No writable field parser exists for “${column.field.type}”.`,
					sourceColumn: column.preview.index,
					sourceRow,
					fieldId: column.field.id,
				});
				continue;
			}
			const fieldContext = makeFieldContext(context, column.field, column.preview.name);
			let parsedValue: Parsed<CellValue>;
			try {
				parsedValue = descriptor.parsePlain(sourceText, fieldContext);
			} catch (error) {
				const skipped: DatabaseImportSkippedValue = {
					sourceRow,
					sourceColumn: column.preview.index,
					sourceText,
					fieldId: column.field.id,
					fieldName: column.field.name,
					targetType: column.field.type,
					reason: `the ${column.field.type} parser failed: ${errorMessage(error)}`,
				};
				skippedValues.push(skipped);
				cells.set(column.preview.index, {
					sourceRow,
					sourceRecord: bodyIndex + 1,
					sourceColumn: column.preview.index,
					field: column.field,
					sourceText,
					value: undefined,
					skipped,
					warning: undefined,
				});
				continue;
			}
			if (!parsedValue.ok) {
				const skipped: DatabaseImportSkippedValue = {
					sourceRow,
					sourceColumn: column.preview.index,
					sourceText,
					fieldId: column.field.id,
					fieldName: column.field.name,
					targetType: column.field.type,
					reason: parsedValue.error,
				};
				skippedValues.push(skipped);
				cells.set(column.preview.index, {
					sourceRow,
					sourceRecord: bodyIndex + 1,
					sourceColumn: column.preview.index,
					field: column.field,
					sourceText,
					value: undefined,
					skipped,
					warning: undefined,
				});
				continue;
			}
			let warning = parsedValue.warning;
			if (column.field.type === 'multiSelect' && Array.isArray(parsedValue.value)) {
				const tokens = splitLabelList(sourceText);
				const duplicateCount = Math.max(0, tokens.length - parsedValue.value.length);
				if (duplicateCount > 0) {
					duplicateDecisions.push({
						kind: 'multi-select-values-collapsed',
						sourceRow,
						sourceColumn: column.preview.index,
						duplicateCount,
					});
				}
			}
			if (
				warning !== undefined &&
				(column.field.type === 'singleSelect' || column.field.type === 'multiSelect')
			) {
				warning = `${warning}; this plan adds any new labels as stable field options`;
			}
			cells.set(column.preview.index, {
				sourceRow,
				sourceRecord: bodyIndex + 1,
				sourceColumn: column.preview.index,
				field: column.field,
				sourceText,
				value: parsedValue.value,
				skipped: undefined,
				warning,
			});
		}
		rows.push({ sourceRow, sourceRecord: bodyIndex + 1, cells });
	}
	return rows;
}

function makeFieldContext(
	context: DatabaseImportPlanContext,
	field: FieldDefinition,
	columnName: string,
): FieldContext {
	return {
		now: context.now,
		timezone: context.timezone,
		locale: context.locale,
		columnName,
		fieldOptions: descriptorOptions(field.settings),
	};
}

function descriptorOptions(settings: FieldSettings): FieldOptions {
	const options = settings.options?.map((option) =>
		option.color === null
			? { id: option.id, name: option.name }
			: { id: option.id, name: option.name, color: option.color },
	);
	return {
		...(settings.max === undefined ? {} : { max: settings.max }),
		...(settings.symbol === undefined ? {} : { symbol: settings.symbol }),
		...(settings.precision === undefined ? {} : { precision: settings.precision }),
		...(settings.unit === undefined ? {} : { unit: settings.unit }),
		...(options === undefined ? {} : { options }),
	};
}

function convertLinkCell(
	column: WorkingColumn,
	sourceRow: number,
	sourceRecord: number,
	sourceText: string,
	mapping: IndexedLinkMapping | undefined,
	addIssue: (issue: DatabaseImportPlanIssue) => void,
): RawCell {
	if (sourceText.trim() === '') {
		return {
			sourceRow,
			sourceRecord,
			sourceColumn: column.preview.index,
			field: column.field,
			sourceText,
			value: null,
			skipped: undefined,
			warning: undefined,
		};
	}
	if (mapping === undefined) {
		addIssue({
			code: 'unmapped-link-value',
			message: `Link value ${JSON.stringify(sourceText)} has no explicit row-ID mapping; labels are never guessed as relationships.`,
			sourceRow,
			sourceColumn: column.preview.index,
			fieldId: column.field.id,
		});
		return linkSkippedCell(
			column,
			sourceRow,
			sourceRecord,
			sourceText,
			'an explicit exact-value-to-row-ID mapping is required',
		);
	}
	const mapped = mapping.mapping.values.get(sourceText);
	if (mapped === undefined) {
		addIssue({
			code: 'unmapped-link-value',
			message: `Link value ${JSON.stringify(sourceText)} has no explicit row-ID mapping; labels are never guessed as relationships.`,
			sourceRow,
			sourceColumn: column.preview.index,
			fieldId: column.field.id,
		});
		return linkSkippedCell(
			column,
			sourceRow,
			sourceRecord,
			sourceText,
			'no explicit mapping exists for this exact source value',
		);
	}
	const target = mapping.targetTable;
	const multiple = column.field.settings.allowMultiple === true;
	if (!multiple) {
		if (typeof mapped !== 'string') {
			addIssue({
				code: 'invalid-link-reference',
				message: `Single link field “${column.field.name}” requires exactly one mapped row ID.`,
				sourceRow,
				sourceColumn: column.preview.index,
				fieldId: column.field.id,
			});
			return linkSkippedCell(
				column,
				sourceRow,
				sourceRecord,
				sourceText,
				'the mapping does not match single-link cardinality',
			);
		}
		if (!isIdOfKind('row', mapped) || !mapping.targetRowIds.has(mapped)) {
			addIssue({
				code: 'invalid-link-reference',
				message: `Mapped row ID “${mapped}” is not a row in target table “${target.name}”.`,
				sourceRow,
				sourceColumn: column.preview.index,
				fieldId: column.field.id,
			});
			return linkSkippedCell(
				column,
				sourceRow,
				sourceRecord,
				sourceText,
				'the mapped row ID does not exist in the declared target table',
			);
		}
		return {
			sourceRow,
			sourceRecord,
			sourceColumn: column.preview.index,
			field: column.field,
			sourceText,
			value: mapped,
			skipped: undefined,
			warning: undefined,
		};
	}
	if (!isStringArray(mapped)) {
		addIssue({
			code: 'invalid-link-reference',
			message: `Multi-link field “${column.field.name}” requires an ordered list of mapped row IDs.`,
			sourceRow,
			sourceColumn: column.preview.index,
			fieldId: column.field.id,
		});
		return linkSkippedCell(
			column,
			sourceRow,
			sourceRecord,
			sourceText,
			'the mapping does not match multi-link cardinality',
		);
	}
	const rowIds: string[] = [];
	const seen = new Set<string>();
	for (const rowId of mapped) {
		if (seen.has(rowId)) {
			addIssue({
				code: 'invalid-link-reference',
				message: `Multi-link field “${column.field.name}” maps the same row ID more than once.`,
				sourceRow,
				sourceColumn: column.preview.index,
				fieldId: column.field.id,
			});
			return linkSkippedCell(
				column,
				sourceRow,
				sourceRecord,
				sourceText,
				'the mapping contains a duplicate row ID',
			);
		}
		if (!isIdOfKind('row', rowId) || !mapping.targetRowIds.has(rowId)) {
			addIssue({
				code: 'invalid-link-reference',
				message: `Mapped row ID “${rowId}” is not a row in target table “${target.name}”.`,
				sourceRow,
				sourceColumn: column.preview.index,
				fieldId: column.field.id,
			});
			return linkSkippedCell(
				column,
				sourceRow,
				sourceRecord,
				sourceText,
				'a mapped row ID does not exist in the declared target table',
			);
		}
		seen.add(rowId);
		rowIds.push(rowId);
	}
	return {
		sourceRow,
		sourceRecord,
		sourceColumn: column.preview.index,
		field: column.field,
		sourceText,
		value: rowIds.length === 0 ? null : rowIds,
		skipped: undefined,
		warning:
			rowIds.length === 0
				? 'the explicit mapping resolves this source value to no linked rows'
				: undefined,
	};
}

function linkSkippedCell(
	column: WorkingColumn,
	sourceRow: number,
	sourceRecord: number,
	sourceText: string,
	reason: string,
): RawCell {
	const skipped: DatabaseImportSkippedValue = {
		sourceRow,
		sourceColumn: column.preview.index,
		sourceText,
		fieldId: column.field.id,
		fieldName: column.field.name,
		targetType: column.field.type,
		reason,
	};
	return {
		sourceRow,
		sourceRecord,
		sourceColumn: column.preview.index,
		field: column.field,
		sourceText,
		value: undefined,
		skipped,
		warning: undefined,
	};
}

function addImportedSelectOptions(
	columns: readonly WorkingColumn[],
	rows: readonly RawSourceRow[],
	makeId: (kind: IdKind) => string | undefined,
	locale: string,
	addIssue: (issue: DatabaseImportPlanIssue) => void,
): void {
	for (const column of columns) {
		if (column.field.type !== 'singleSelect' && column.field.type !== 'multiSelect') {
			continue;
		}
		const existingOptions = [...(column.finalSettings.options ?? [])];
		const firstByLabel = new Map<string, SelectOption>();
		const duplicates = new Set<string>();
		for (const option of existingOptions) {
			const key = foldLocaleCase(option.name, locale);
			if (firstByLabel.has(key)) {
				duplicates.add(option.name);
			} else {
				firstByLabel.set(key, option);
			}
		}
		for (const duplicate of duplicates) {
			addIssue({
				code: 'duplicate-option-label',
				message: `Field “${column.field.name}” already has ambiguous option labels matching “${duplicate}”.`,
				sourceColumn: column.preview.index,
				fieldId: column.field.id,
			});
		}
		const seenNew = new Set<string>();
		for (const row of rows) {
			const cell = row.cells.get(column.preview.index);
			if (cell === undefined || cell.value === undefined || cell.value === null) {
				continue;
			}
			const labels =
				column.field.type === 'singleSelect'
					? typeof cell.value === 'string'
						? [cell.value]
						: []
					: isStringArray(cell.value)
						? cell.value
						: [];
			for (const label of labels) {
				const key = foldLocaleCase(label, locale);
				if (firstByLabel.has(key) || seenNew.has(key)) {
					continue;
				}
				const id = makeId('option');
				if (id === undefined) {
					continue;
				}
				const option: SelectOption = { id, name: label, color: null, unknown: [] };
				firstByLabel.set(key, option);
				seenNew.add(key);
				column.optionsAdded.push(option);
				existingOptions.push(option);
			}
		}
		if (column.optionsAdded.length > 0 || column.field.settings.options === undefined) {
			column.finalSettings = { ...column.finalSettings, options: existingOptions };
		}
	}
}

function convertSelectValues(
	columns: readonly WorkingColumn[],
	rows: readonly RawSourceRow[],
	locale: string,
	addIssue: (issue: DatabaseImportPlanIssue) => void,
): RawSourceRow[] {
	const byColumn = new Map(columns.map((column) => [column.preview.index, column]));
	return rows.map((row) => {
		const cells = new Map<number, RawCell>();
		for (const [sourceColumn, cell] of row.cells) {
			const column = byColumn.get(sourceColumn);
			if (column === undefined || cell.value === undefined || cell.value === null) {
				cells.set(sourceColumn, cell);
				continue;
			}
			if (column.field.type !== 'singleSelect' && column.field.type !== 'multiSelect') {
				cells.set(sourceColumn, cell);
				continue;
			}
			const options = column.finalSettings.options ?? [];
			const optionByLabel = new Map(
				options.map((option) => [foldLocaleCase(option.name, locale), option.id]),
			);
			if (column.field.type === 'singleSelect') {
				if (typeof cell.value !== 'string') {
					addIssue({
						code: 'invalid-preview',
						message: `The single-select parser returned an unexpected value for “${column.field.name}”.`,
						sourceRow: cell.sourceRow,
						sourceColumn,
						fieldId: column.field.id,
					});
					cells.set(sourceColumn, { ...cell, value: undefined });
					continue;
				}
				const optionId = optionByLabel.get(foldLocaleCase(cell.value, locale));
				if (optionId === undefined) {
					addIssue({
						code: 'duplicate-option-label',
						message: `No stable option ID was planned for “${cell.value}”.`,
						sourceRow: cell.sourceRow,
						sourceColumn,
						fieldId: column.field.id,
					});
					cells.set(sourceColumn, { ...cell, value: undefined });
					continue;
				}
				cells.set(sourceColumn, { ...cell, value: optionId });
				continue;
			}
			if (!isStringArray(cell.value)) {
				addIssue({
					code: 'invalid-preview',
					message: `The multi-select parser returned an unexpected value for “${column.field.name}”.`,
					sourceRow: cell.sourceRow,
					sourceColumn,
					fieldId: column.field.id,
				});
				cells.set(sourceColumn, { ...cell, value: undefined });
				continue;
			}
			const optionIds: string[] = [];
			for (const label of cell.value) {
				const optionId = optionByLabel.get(foldLocaleCase(label, locale));
				if (optionId === undefined) {
					addIssue({
						code: 'duplicate-option-label',
						message: `No stable option ID was planned for “${label}”.`,
						sourceRow: cell.sourceRow,
						sourceColumn,
						fieldId: column.field.id,
					});
					continue;
				}
				optionIds.push(optionId);
			}
			cells.set(sourceColumn, { ...cell, value: optionIds.length === 0 ? null : optionIds });
		}
		return { ...row, cells };
	});
}

function isScalarRowKeyType(type: DocumentFieldTypeId): boolean {
	return (
		type !== 'link' &&
		type !== 'multiSelect' &&
		type !== 'attachment' &&
		type !== 'createdTime' &&
		type !== 'lastModifiedTime'
	);
}

function indexExistingRowsByKey(
	table: DatabaseTable,
	fieldId: string,
): Map<string, readonly DatabaseTable['rows'][number][]> {
	const rowsByKey = new Map<string, DatabaseTable['rows'][number][]>();
	for (const row of table.rows) {
		const value = row.cells.get(fieldId);
		const key = scalarKeyOf(value);
		if (key === undefined) {
			continue;
		}
		const token = keyToken(key);
		const rows = rowsByKey.get(token) ?? [];
		rows.push(row);
		rowsByKey.set(token, rows);
	}
	return rowsByKey;
}

function indexSourceRowsByKey(
	rows: readonly RawSourceRow[],
	sourceColumn: number,
	fieldId: string,
): Map<string, { readonly value: ScalarKey; readonly rows: readonly RawSourceRow[] }> {
	const groups = new Map<string, { readonly value: ScalarKey; readonly rows: RawSourceRow[] }>();
	for (const row of rows) {
		const cell = row.cells.get(sourceColumn);
		const key = scalarKeyOf(cell?.value);
		if (key === undefined || cell?.field.id !== fieldId) {
			continue;
		}
		const token = keyToken(key);
		const group = groups.get(token);
		if (group === undefined) {
			groups.set(token, { value: key, rows: [row] });
		} else {
			group.rows.push(row);
		}
	}
	return groups;
}

function isEmptyKeyValue(value: CellState | undefined): boolean {
	return value === null || (typeof value === 'string' && value.trim() === '');
}

function scalarKeyOf(value: CellState | undefined): ScalarKey | undefined {
	if (
		value === undefined ||
		isEmptyKeyValue(value) ||
		isInvalidCell(value) ||
		Array.isArray(value)
	) {
		return undefined;
	}
	return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
		? value
		: undefined;
}

function keyToken(value: ScalarKey): string {
	if (typeof value === 'string') {
		return `s:${String(value.length)}:${value}`;
	}
	return typeof value === 'number' ? `n:${String(value)}` : `b:${String(value)}`;
}

interface RowWithDisposition {
	readonly source: RawSourceRow;
	readonly action: 'create' | 'append' | 'update';
	readonly rowId: string;
	readonly existingRow: DatabaseTable['rows'][number] | null;
	readonly keyDecision: DatabaseImportRowKeyDecision;
}

function assignRowIds(
	rows: readonly RawSourceRow[],
	rowMatch:
		| { readonly kind: 'append' }
		| { readonly kind: 'field-id'; readonly sourceColumn: number; readonly fieldId: string },
	keyColumn: WorkingColumn | undefined,
	existingRowsByKey: ReadonlyMap<string, readonly DatabaseTable['rows'][number][]>,
	newRowAction: 'create' | 'append',
	makeId: (kind: IdKind) => string | undefined,
	addIssue: (issue: DatabaseImportPlanIssue) => void,
): RowWithDisposition[] {
	const assigned: RowWithDisposition[] = [];
	for (const source of rows) {
		if (rowMatch.kind === 'append' || keyColumn === undefined) {
			const rowId = makeId('row');
			if (rowId === undefined) {
				continue;
			}
			assigned.push({
				source,
				action: newRowAction,
				rowId,
				existingRow: null,
				keyDecision: { kind: 'not-used', policy: 'preserve-source-duplicates' },
			});
			continue;
		}
		const keyCell = source.cells.get(rowMatch.sourceColumn);
		const key = scalarKeyOf(keyCell?.value);
		if (keyCell === undefined || isEmptyKeyValue(keyCell.value)) {
			const rowId = makeId('row');
			if (rowId === undefined) {
				continue;
			}
			assigned.push({
				source,
				action: 'append',
				rowId,
				existingRow: null,
				keyDecision: { kind: 'empty', outcome: 'append' },
			});
			continue;
		}
		if (keyCell.value === undefined) {
			const rowId = makeId('row');
			if (rowId === undefined) {
				continue;
			}
			assigned.push({
				source,
				action: 'append',
				rowId,
				existingRow: null,
				keyDecision: {
					kind: 'unreadable',
					outcome: 'append',
					reason: keyCell.skipped?.reason ?? 'the mapped key cell could not be parsed',
				},
			});
			continue;
		}
		if (key === undefined) {
			const rowId = makeId('row');
			if (rowId === undefined) {
				continue;
			}
			assigned.push({
				source,
				action: 'append',
				rowId,
				existingRow: null,
				keyDecision: {
					kind: 'unreadable',
					outcome: 'append',
					reason: 'the mapped key value is not a readable scalar',
				},
			});
			continue;
		}
		const existing = existingRowsByKey.get(keyToken(key)) ?? [];
		if (existing.length > 1) {
			addIssue({
				code: 'duplicate-target-key',
				message: `The mapped key ${JSON.stringify(key)} matches more than one existing row.`,
				sourceRow: source.sourceRow,
				sourceColumn: rowMatch.sourceColumn,
				fieldId: rowMatch.fieldId,
				rowIds: existing.map((row) => row.id),
			});
			continue;
		}
		const match = existing[0];
		if (match !== undefined) {
			assigned.push({
				source,
				action: 'update',
				rowId: match.id,
				existingRow: match,
				keyDecision: { kind: 'matched', rowId: match.id, value: key },
			});
			continue;
		}
		const rowId = makeId('row');
		if (rowId === undefined) {
			continue;
		}
		assigned.push({
			source,
			action: 'append',
			rowId,
			existingRow: null,
			keyDecision: { kind: 'not-found', outcome: 'append', value: key },
		});
	}
	return assigned;
}

function listUnmatchedExistingRows(
	table: DatabaseTable,
	fieldId: string,
	plannedRows: readonly RowWithDisposition[],
): DatabaseImportUnmatchedExistingRow[] {
	const matched = new Set(
		plannedRows.filter((row) => row.action === 'update').map((row) => row.rowId),
	);
	const unmatched: DatabaseImportUnmatchedExistingRow[] = [];
	for (const row of table.rows) {
		if (matched.has(row.id)) {
			continue;
		}
		const stored = row.cells.get(fieldId);
		if (stored === undefined || isEmptyKeyValue(stored)) {
			unmatched.push({ rowId: row.id, reason: 'empty-key' });
		} else if (scalarKeyOf(stored) === undefined) {
			unmatched.push({ rowId: row.id, reason: 'unreadable-key' });
		} else {
			unmatched.push({ rowId: row.id, reason: 'key-not-in-import' });
		}
	}
	return unmatched;
}

function listUnmatchedExistingRowsWithoutKey(
	table: DatabaseTable,
): DatabaseImportUnmatchedExistingRow[] {
	return table.rows.map((row) => ({ rowId: row.id, reason: 'no-row-key' }));
}

function fieldsToRemove(
	table: DatabaseTable,
	columns: readonly WorkingColumn[],
	addIssue: (issue: DatabaseImportPlanIssue) => void,
): DatabaseImportRemovedField[] {
	const retainedIds = new Set(columns.map((column) => column.field.id));
	const removed: DatabaseImportRemovedField[] = [];
	for (const field of table.fields) {
		const fieldId = field.id;
		if (fieldId !== null && retainedIds.has(fieldId)) {
			continue;
		}
		if (fieldId === null) {
			const name = field.kind === 'unsupported' ? (field.name ?? field.typeName) : field.name;
			addIssue({
				code: 'unsupported-field',
				message: `Field “${name}” has no stable ID and cannot be removed by an exact plan.`,
			});
			continue;
		}
		const storedCellCount = table.rows.filter((row) => row.cells.has(fieldId)).length;
		removed.push({
			fieldId,
			name: field.kind === 'unsupported' ? (field.name ?? field.typeName) : field.name,
			type: field.kind === 'field' ? field.type : field.typeName,
			storedCellCount,
			valuesRemainPreserved: true,
		});
	}
	return removed;
}

function plannedColumns(
	preview: DatabaseImportPreview,
	columns: readonly WorkingColumn[],
): PlannedDatabaseImportColumn[] {
	const byIndex = new Map(columns.map((column) => [column.preview.index, column]));
	return preview.columns.map((previewColumn) => {
		const column = byIndex.get(previewColumn.index);
		if (!previewColumn.included || column === undefined) {
			return {
				sourceColumn: previewColumn.index,
				sourceName: previewColumn.name,
				inferredType: previewColumn.inference.type,
				sourceType: previewColumn.type,
				included: false,
				mapping: 'excluded',
				targetFieldId: null,
				targetFieldName: null,
				targetType: null,
				settings: null,
				optionsAdded: [],
			};
		}
		return {
			sourceColumn: previewColumn.index,
			sourceName: previewColumn.name,
			inferredType: previewColumn.inference.type,
			sourceType: previewColumn.type,
			included: true,
			mapping: column.origin,
			targetFieldId: column.field.id,
			targetFieldName: column.field.name,
			targetType: column.field.type,
			settings: column.finalSettings,
			optionsAdded: column.optionsAdded,
		};
	});
}

function plannedRows(
	plannedRows: readonly RowWithDisposition[],
	columns: readonly WorkingColumn[],
): PlannedDatabaseImportRow[] {
	return plannedRows.map((planned) => {
		const cells: PlannedDatabaseImportCell[] = [];
		for (const column of columns) {
			const raw = planned.source.cells.get(column.preview.index);
			if (raw === undefined) {
				continue;
			}
			if (raw.value === undefined) {
				cells.push({
					sourceColumn: raw.sourceColumn,
					fieldId: raw.field.id,
					fieldName: raw.field.name,
					targetType: raw.field.type,
					sourceText: raw.sourceText,
					status: 'skipped',
					...(raw.skipped === undefined ? {} : { warning: raw.skipped.reason }),
				});
				continue;
			}
			const value = raw.value;
			if (planned.action !== 'update' || planned.existingRow === null) {
				cells.push({
					sourceColumn: raw.sourceColumn,
					fieldId: raw.field.id,
					fieldName: raw.field.name,
					targetType: raw.field.type,
					sourceText: raw.sourceText,
					status: value === null ? 'empty' : 'write',
					value,
					...(raw.warning === undefined ? {} : { warning: raw.warning }),
				});
				continue;
			}
			const existing = planned.existingRow.cells.get(raw.field.id);
			if (value === null) {
				const shouldClear = existing !== undefined && existing !== null;
				cells.push({
					sourceColumn: raw.sourceColumn,
					fieldId: raw.field.id,
					fieldName: raw.field.name,
					targetType: raw.field.type,
					sourceText: raw.sourceText,
					status: shouldClear ? 'clear' : 'unchanged',
					value: null,
				});
				continue;
			}
			const unchanged = existing !== undefined && sameCell(existing, value);
			cells.push({
				sourceColumn: raw.sourceColumn,
				fieldId: raw.field.id,
				fieldName: raw.field.name,
				targetType: raw.field.type,
				sourceText: raw.sourceText,
				status: unchanged ? 'unchanged' : 'write',
				value,
				...(raw.warning === undefined ? {} : { warning: raw.warning }),
			});
		}
		return {
			sourceRow: planned.source.sourceRow,
			sourceRecord: planned.source.sourceRecord,
			action: planned.action,
			rowId: planned.rowId,
			keyDecision: planned.keyDecision,
			cells,
		};
	});
}

function sameCell(left: CellState, right: CellState): boolean {
	if (isInvalidCell(left) || isInvalidCell(right)) {
		return (
			isInvalidCell(left) &&
			isInvalidCell(right) &&
			JSON.stringify(left.raw) === JSON.stringify(right.raw)
		);
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => value === right[index])
		);
	}
	return left === right;
}

function buildOperations(
	document: DatabaseDocument,
	tableId: string,
	destination: DatabaseImportDestination,
	resolvedDestination: PlannedDatabaseImportDestination,
	columns: readonly WorkingColumn[],
	plannedRows: readonly RowWithDisposition[],
	removedFields: readonly DatabaseImportRemovedField[],
	importInstant: string,
): DatabaseOperation[] {
	const operations: DatabaseOperation[] = [];
	if (destination.kind === 'create') {
		operations.push({ kind: 'create-table', tableId, name: destination.tableName });
	}
	for (const column of columns) {
		if (column.origin === 'new') {
			operations.push({
				kind: 'create-field',
				tableId,
				fieldId: column.field.id,
				name: column.field.name,
				type: column.field.type,
				settings: column.finalSettings,
			});
			continue;
		}
		if (column.optionsAdded.length > 0 && column.originalField !== null) {
			operations.push({
				kind: 'reconfigure-field',
				tableId,
				fieldId: column.field.id,
				settings: column.finalSettings,
			});
		}
	}
	const plannedCellRows = plannedRows.map((planned) => {
		const rowCells = columns
			.map((column) => planned.source.cells.get(column.preview.index))
			.filter((cell): cell is RawCell => cell !== undefined);
		return { planned, rowCells };
	});
	for (const { planned, rowCells } of plannedCellRows) {
		if (planned.action !== 'update') {
			const cells: CellEdit[] = rowCells
				.filter((cell) => cell.value !== undefined && cell.value !== null)
				.map((cell) => ({ fieldId: cell.field.id, value: cell.value ?? null }));
			operations.push({
				kind: 'create-record',
				tableId,
				rowId: planned.rowId,
				createdAt: importInstant,
				updatedAt: importInstant,
				...(cells.length === 0 ? {} : { cells }),
			});
			continue;
		}
		const currentTable = document.tables.find(
			(table) => table.id === resolvedDestination.tableId,
		);
		const existingRow = currentTable?.rows.find((row) => row.id === planned.rowId);
		const edits: CellEdit[] = [];
		for (const cell of rowCells) {
			if (cell.value === undefined) {
				continue;
			}
			const previous = existingRow?.cells.get(cell.field.id);
			if (cell.value === null) {
				if (previous !== undefined && previous !== null) {
					edits.push({ fieldId: cell.field.id, value: null });
				}
				continue;
			}
			if (previous === undefined || !sameCell(previous, cell.value)) {
				edits.push({ fieldId: cell.field.id, value: cell.value });
			}
		}
		if (edits.length > 0) {
			operations.push({
				kind: 'set-cells',
				tableId,
				rowId: planned.rowId,
				edits,
				updatedAt: importInstant,
			});
		}
	}
	if (destination.kind === 'replace' && destination.removeAbsentFields) {
		for (const field of removedFields) {
			operations.push({ kind: 'delete-field', tableId, fieldId: field.fieldId });
		}
	}
	return operations;
}

function buildConfirmations(
	destination: DatabaseImportDestination,
	resolvedDestination: PlannedDatabaseImportDestination,
	columns: readonly WorkingColumn[],
	rows: readonly PlannedDatabaseImportRow[],
	skippedValues: readonly DatabaseImportSkippedValue[],
	unmatchedExistingRows: readonly DatabaseImportUnmatchedExistingRow[],
	removedFields: readonly DatabaseImportRemovedField[],
): DatabaseImportConfirmation[] {
	const confirmations: DatabaseImportConfirmation[] = [];
	const suggestions = columns
		.filter((column) => column.origin === 'suggested')
		.map((column) => ({
			sourceColumn: column.preview.index,
			sourceName: column.preview.name,
			fieldId: column.field.id,
			fieldName: column.field.name,
		}));
	if (suggestions.length > 0) {
		confirmations.push({ kind: 'suggested-field-mappings', mappings: suggestions });
	}
	if (destination.kind === 'replace') {
		confirmations.push({
			kind: 'replace-values',
			tableId: resolvedDestination.tableId,
			updatedRowIds: rows.filter((row) => row.action === 'update').map((row) => row.rowId),
			appendedRowIds: rows.filter((row) => row.action !== 'update').map((row) => row.rowId),
			clearedCells: rows.flatMap((row) =>
				row.cells
					.filter((cell) => cell.status === 'clear')
					.map((cell) => ({ sourceRow: row.sourceRow, fieldId: cell.fieldId })),
			),
			unmatchedExistingRowIds: unmatchedExistingRows.map((row) => row.rowId),
		});
	}
	if (skippedValues.length > 0) {
		confirmations.push({ kind: 'accept-skipped-values', skipped: skippedValues });
	}
	const optionAdditions = columns
		.filter((column) => column.optionsAdded.length > 0)
		.map((column) => ({
			fieldId: column.field.id,
			fieldName: column.field.name,
			options: column.optionsAdded,
		}));
	if (
		optionAdditions.length > 0 &&
		columns.some((column) => column.originalField !== null && column.optionsAdded.length > 0)
	) {
		confirmations.push({ kind: 'add-select-options', additions: optionAdditions });
	}
	if (removedFields.length > 0) {
		confirmations.push({ kind: 'remove-import-absent-fields', fields: removedFields });
	}
	return confirmations;
}

function buildDuplicateDecisions(
	cellDecisions: readonly DatabaseImportDuplicateDecision[],
	rowMatch:
		| { readonly kind: 'append' }
		| { readonly kind: 'field-id'; readonly sourceColumn: number; readonly fieldId: string },
	keyColumn: WorkingColumn | undefined,
	rows: readonly PlannedDatabaseImportRow[],
): DatabaseImportDuplicateDecision[] {
	const decisions = [...cellDecisions];
	if (rowMatch.kind === 'field-id' && keyColumn !== undefined) {
		decisions.push({
			kind: 'require-unique-mapped-key',
			fieldId: keyColumn.field.id,
			matchedRows: rows.filter((row) => row.keyDecision.kind === 'matched').length,
			appendedRows: rows.filter((row) => row.keyDecision.kind !== 'matched').length,
		});
	} else {
		decisions.push({ kind: 'preserve-source-rows', rowCount: rows.length });
	}
	return decisions;
}

function measurePlan(
	preview: DatabaseImportPreview,
	columns: readonly WorkingColumn[],
	rows: readonly PlannedDatabaseImportRow[],
	targetRowsScanned: number,
	removedFields: readonly DatabaseImportRemovedField[],
	operations: readonly DatabaseOperation[],
	beforeJson: string,
	afterJson: string,
): DatabaseImportPlanMetrics {
	const rowsMatched = rows.filter((row) => row.keyDecision.kind === 'matched').length;
	const rowsUpdated = rows.filter(
		(row) =>
			row.action === 'update' &&
			row.cells.some((cell) => cell.status === 'write' || cell.status === 'clear'),
	).length;
	const rowsCreated = rows.filter((row) => row.action !== 'update').length;
	const allCells = rows.flatMap((row) => row.cells);
	const sourceCellsExamined = preview.rowCount * columns.length;
	const documentBytesBefore = utf8Length(beforeJson);
	const documentBytesAfter = utf8Length(afterJson);
	const operationCount = operations.length;
	return {
		sourceRows: preview.rowCount,
		includedColumns: columns.length,
		sourceCellsExamined,
		targetRowsScanned,
		rowsMatched,
		rowsCreated,
		rowsUpdated,
		cellsWritten: allCells.filter((cell) => cell.status === 'write').length,
		cellsCleared: allCells.filter((cell) => cell.status === 'clear').length,
		cellsSkipped: allCells.filter((cell) => cell.status === 'skipped').length,
		fieldsCreated: columns.filter((column) => column.origin === 'new').length,
		fieldsRemoved: removedFields.length,
		optionsCreated: columns.reduce((total, column) => total + column.optionsAdded.length, 0),
		operationCount,
		documentBytesBefore,
		documentBytesAfter,
		documentBytesDelta: documentBytesAfter - documentBytesBefore,
		estimatedWorkUnits: sourceCellsExamined + targetRowsScanned + operationCount,
	};
}

function utf8Length(text: string): number {
	return new TextEncoder().encode(text).length;
}

function measurePolicy(
	policy: DatabaseImportPlanPolicy | undefined,
	metrics: DatabaseImportPlanMetrics,
): DatabaseImportPlanWarning[] {
	const warnings: DatabaseImportPlanWarning[] = [];
	const documentThreshold = policy?.warnAtOrAboveDocumentBytes;
	if (documentThreshold !== undefined && metrics.documentBytesAfter >= documentThreshold) {
		warnings.push({
			code: 'document-size-threshold',
			actual: metrics.documentBytesAfter,
			threshold: documentThreshold,
			message: `The projected native document is ${String(metrics.documentBytesAfter)} bytes, at or above the configured ${String(documentThreshold)}-byte warning threshold.`,
		});
	}
	const workThreshold = policy?.warnAtOrAboveWorkUnits;
	if (workThreshold !== undefined && metrics.estimatedWorkUnits >= workThreshold) {
		warnings.push({
			code: 'work-threshold',
			actual: metrics.estimatedWorkUnits,
			threshold: workThreshold,
			message: `The plan estimates ${String(metrics.estimatedWorkUnits)} deterministic work units, at or above the configured ${String(workThreshold)}-unit warning threshold.`,
		});
	}
	return warnings;
}

function describeUnmatchedReason(reason: DatabaseImportUnmatchedExistingRow['reason']): string {
	switch (reason) {
		case 'no-row-key':
			return 'no row key was selected';
		case 'empty-key':
			return 'the existing row has no key';
		case 'unreadable-key':
			return 'the existing row key is unreadable';
		case 'key-not-in-import':
			return 'the key is not in the source';
	}
}

function signed(value: number): string {
	return value > 0 ? `+${String(value)} bytes` : value < 0 ? `${String(value)} bytes` : '0 bytes';
}
