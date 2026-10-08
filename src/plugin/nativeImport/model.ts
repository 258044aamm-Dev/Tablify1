/**
 * The native import wizard's **state and arithmetic**, as pure functions (Step 4 UI, R5).
 *
 * The modal is a loop over this module: every destination, every plan and every "can I apply this?" answer is
 * computed here from the same planner the runner consumes, so the screen cannot promise a different write from the
 * one that is applied. Nothing in this file touches the DOM, the vault, or a store.
 *
 * Choices are explicit. A source column is written to an existing field only when the person picks that field's
 * stable ID; otherwise it creates a new field. Names are never matched by guessing (`suggest-by-name` is not used),
 * so a name that already exists is refused by the planner with a reason the person can act on.
 */
import {
	buildDatabaseImportPlan,
	describeDatabaseImportPlan,
	previewDatabaseImport,
} from '../../core/database';
import type {
	DatabaseDocument,
	DatabaseImportDestination,
	DatabaseImportLinkValueMapping,
	DatabaseImportPlan,
	DatabaseImportPlanContext,
	DatabaseImportPlanIssue,
	DatabaseImportPreview,
	DatabaseImportPreviewResult,
	ExplicitImportField,
	ReplaceRowMatch,
} from '../../core/database';
import type { IdKind } from '../../core/database/ids';
import type { FieldDefinition } from '../../core/database/fields';
import type { DatabaseTable } from '../../core/database/schema';
import { INFERABLE_TYPES } from '../../core/import/preview';
import type { FieldTypeId } from '../../core/types';
import type { DatabaseImportApplyResult } from '../../adapters/tablifyFile';

export type ImportMode = 'create' | 'append' | 'replace';

/**
 * Link choices the person made: source column → exact source text → the row IDs it links to. A single link holds
 * one ID; a multi-link holds an ordered list. A value with no entry is unmapped, and the planner blocks on it.
 */
export type LinkChoices = ReadonlyMap<number, ReadonlyMap<string, readonly string[]>>;

/** Everything the person has chosen so far. Immutable: every change produces a new draft. */
export interface ImportDraft {
	readonly sourceName: string;
	readonly text: string;
	readonly hasHeader: boolean;
	readonly overrides: ReadonlyMap<number, FieldTypeId>;
	readonly excluded: ReadonlySet<number>;
	readonly mode: ImportMode;
	readonly newTableName: string;
	/** The table an append or replace writes to. `null` until the person picks one. */
	readonly tableId: string | null;
	/** Source column → existing field ID. A column absent from this map creates a new field. */
	readonly fieldTargets: ReadonlyMap<number, string>;
	/** For a replace: the source column whose values identify existing rows. `null` means append. */
	readonly keyColumn: number | null;
	/** Explicit row choices for link columns. Empty unless a link field is the target of a column. */
	readonly linkValues: LinkChoices;
}

/** One selectable target for a column, or the reason it cannot be a target in this build. */
export interface TargetFieldChoice {
	readonly fieldId: string;
	readonly name: string;
	readonly type: string;
	readonly selectable: boolean;
	readonly reason: string | null;
}

/** The planner context the host supplies: the same clock, timezone and locale the views use. */
export interface ImportPlanEnvironment {
	readonly createId: (kind: IdKind) => string;
	readonly now: () => number;
	readonly timezone: string;
	readonly locale: string;
}

export const IMPORT_TYPE_CHOICES: readonly FieldTypeId[] = INFERABLE_TYPES;

/** The name a new table is offered under: the file name without its extension. */
export function defaultTableName(sourceName: string): string {
	const dot = sourceName.lastIndexOf('.');
	const base = dot > 0 ? sourceName.slice(0, dot) : sourceName;
	return base.trim() === '' ? 'Imported table' : base.trim();
}

/** A fresh draft. Opens on the active table for append/replace, and on a new table otherwise. */
export function initialDraft(input: {
	readonly sourceName: string;
	readonly activeTableId: string | null;
}): ImportDraft {
	return {
		sourceName: input.sourceName,
		text: '',
		hasHeader: true,
		overrides: new Map(),
		excluded: new Set(),
		mode: 'create',
		newTableName: defaultTableName(input.sourceName),
		tableId: input.activeTableId,
		fieldTargets: new Map(),
		keyColumn: null,
		linkValues: new Map(),
	};
}

/** Read and infer the pasted or loaded text. An empty or unreadable source is a reason, not an exception. */
export function previewOf(draft: ImportDraft): DatabaseImportPreviewResult {
	return previewDatabaseImport(
		{ kind: 'text', text: draft.text, name: draft.sourceName },
		{ hasHeader: draft.hasHeader, overrides: draft.overrides, excluded: draft.excluded },
	);
}

/**
 * Targets an existing table offers a column. Read-only and link fields are shown with the reason they cannot take a
 * value. Unsupported fields are left out: they have no usable ID to map to, so there is nothing to offer.
 */
export function targetFieldsOf(
	table: DatabaseTable,
	tables: readonly DatabaseTable[] = [],
): readonly TargetFieldChoice[] {
	const choices: TargetFieldChoice[] = [];
	for (const field of table.fields) {
		if (field.kind !== 'field') {
			continue;
		}
		choices.push(fieldChoice(field, tables));
	}
	return choices;
}

function fieldChoice(field: FieldDefinition, tables: readonly DatabaseTable[]): TargetFieldChoice {
	const base = { fieldId: field.id, name: field.name, type: field.type };
	if (field.type === 'createdTime' || field.type === 'lastModifiedTime') {
		return {
			...base,
			selectable: false,
			reason: 'Read-only fields cannot receive imported values.',
		};
	}
	if (field.type === 'link') {
		if (field.settings.generated === true) {
			return {
				...base,
				selectable: false,
				reason: 'Generated inverse link fields cannot receive imported values.',
			};
		}
		const targetTableId = field.settings.targetTableId;
		if (
			typeof targetTableId === 'string' &&
			tables.some((table) => table.id === targetTableId)
		) {
			return { ...base, selectable: true, reason: null };
		}
		return {
			...base,
			selectable: false,
			reason: 'Link fields take row-ID mappings from the source values, and this one has no existing target table to map to.',
		};
	}
	return { ...base, selectable: true, reason: null };
}

/** The included, non-empty source columns, in source order. The only columns a destination can name. */
export function includedColumnsOf(
	preview: DatabaseImportPreview,
	draft: ImportDraft,
): readonly number[] {
	return preview.columns
		.filter((column) => column.included && column.name.trim() !== '')
		.map((column) => column.index);
}

/**
 * The destination the draft describes, or the one sentence that stops it being described. Validation here is only
 * what the choice itself needs (a table, a row key, a field for that key); the planner still checks everything else.
 */
export function destinationOf(
	draft: ImportDraft,
	preview: DatabaseImportPreview,
):
	| { readonly ok: true; readonly destination: DatabaseImportDestination }
	| { readonly ok: false; readonly reason: string } {
	if (draft.mode === 'create') {
		return { ok: true, destination: { kind: 'create', tableName: draft.newTableName } };
	}
	if (draft.tableId === null) {
		return { ok: false, reason: 'Choose the table to write to.' };
	}
	const included = new Set(includedColumnsOf(preview, draft));
	const fields: ExplicitImportField[] = [];
	for (const [sourceColumn, fieldId] of draft.fieldTargets) {
		if (included.has(sourceColumn)) {
			fields.push({ sourceColumn, fieldId });
		}
	}
	const fieldMapping = { kind: 'field-ids' as const, fields };
	if (draft.mode === 'append') {
		return { ok: true, destination: { kind: 'append', tableId: draft.tableId, fieldMapping } };
	}
	let rowMatch: ReplaceRowMatch = { kind: 'append' };
	if (draft.keyColumn !== null) {
		const keyField = draft.fieldTargets.get(draft.keyColumn);
		if (keyField === undefined || !included.has(draft.keyColumn)) {
			return {
				ok: false,
				reason: 'Choose which existing field identifies rows, and map its source column to that field. Without a key, rows are appended.',
			};
		}
		rowMatch = { kind: 'field-id', sourceColumn: draft.keyColumn, fieldId: keyField };
	}
	return {
		ok: true,
		destination: {
			kind: 'replace',
			tableId: draft.tableId,
			fieldMapping,
			rowMatch,
			removeAbsentFields: false,
		},
	};
}

/** Result of building the exact plan for the current draft. A failure carries every blocking reason. */
export type ImportPlanOutcome =
	| { readonly ok: true; readonly plan: DatabaseImportPlan; readonly summary: string }
	| {
			readonly ok: false;
			readonly reasons: readonly string[];
			readonly issues: readonly DatabaseImportPlanIssue[];
	  };

/** One readable line per planner issue. The code is kept out of the sentence; the planner's own message is used. */
export function reasonLines(issues: readonly DatabaseImportPlanIssue[]): readonly string[] {
	return issues.map((issue) => issue.message);
}

/**
 * Build the exact plan for the draft against the document the session currently holds. This is what the review step
 * shows and what the runner applies; the runner re-checks the document before it commits.
 */
export function planOf(
	document: DatabaseDocument,
	draft: ImportDraft,
	environment: ImportPlanEnvironment,
): ImportPlanOutcome {
	const preview = previewOf(draft);
	if (!preview.ok) {
		return { ok: false, reasons: [preview.reason], issues: [] };
	}
	const choice = destinationOf(draft, preview);
	if (!choice.ok) {
		return { ok: false, reasons: [choice.reason], issues: [] };
	}
	const context: DatabaseImportPlanContext = {
		now: environment.now,
		timezone: environment.timezone,
		locale: environment.locale,
	};
	const destinationTable =
		draft.mode === 'create' || draft.tableId === null
			? undefined
			: document.tables.find((table) => table.id === draft.tableId);
	const result = buildDatabaseImportPlan(document, preview, choice.destination, {
		ids: environment.createId,
		context,
		linkMappings: linkMappingsOf(draft, preview, destinationTable),
	});
	if (!result.ok) {
		return { ok: false, reasons: reasonLines(result.issues), issues: result.issues };
	}
	return { ok: true, plan: result.plan, summary: describeDatabaseImportPlan(result.plan) };
}

/**
 * Whether the person must acknowledge the plan before Apply is enabled. Any planner confirmation (replacing values,
 * accepting skipped values, adopting suggested mappings) requires it, so no write needing consent can run on a
 * default.
 */
export function needsAcknowledgement(plan: DatabaseImportPlan): boolean {
	return plan.confirmations.length > 0;
}

/** What the person is told a plan will do, in sentences the review step can show line by line. */
export function confirmationLines(plan: DatabaseImportPlan): readonly string[] {
	const lines: string[] = [];
	for (const confirmation of plan.confirmations) {
		if (confirmation.kind === 'replace-values') {
			lines.push(
				`Replaces values in ${String(confirmation.updatedRowIds.length)} existing record(s); ${String(confirmation.unmatchedExistingRowIds.length)} existing record(s) are kept unchanged. Undo restores them.`,
			);
		} else if (confirmation.kind === 'accept-skipped-values') {
			lines.push(
				`${String(confirmation.skipped.length)} value(s) cannot be converted to their field type and will be left empty.`,
			);
		} else if (confirmation.kind === 'add-select-options') {
			lines.push('Adds select options to existing fields.');
		} else if (confirmation.kind === 'suggested-field-mappings') {
			lines.push('Matches columns to existing fields by name.');
		}
	}
	return lines;
}

/** The phases the apply runner reports, as one line each. Counts are shown only when they are exact. */
export function progressLine(phase: string, totalRecords: number): string {
	switch (phase) {
		case 'checking':
			return 'Checking that the database has not changed…';
		case 'ready-to-apply':
			return `Ready to apply ${String(totalRecords)} record(s). Cancel is still available.`;
		case 'saving':
			return 'Applying: one undoable change, then saving the file…';
		case 'saved':
			return 'Saved.';
		default:
			return '';
	}
}

/**
 * One sentence per apply outcome. Each one says what changed and what did not, so a cancelled or failed import never
 * reads like a success. The unsaved case says the change is still undoable: it is applied in memory.
 */
export function resultMessage(result: DatabaseImportApplyResult): string {
	switch (result.kind) {
		case 'saved':
			return `Imported ${String(result.appliedRecords)} record(s). It is one undo step, and the file is saved.`;
		case 'applied-unsaved': {
			const reason =
				result.failure.kind === 'conflict'
					? 'the file changed on disk'
					: result.failure.kind === 'write-failed'
						? result.failure.message
						: result.failure.kind === 'detached'
							? 'this pane no longer writes to the file'
							: 'the database was closed';
			return `Imported ${String(result.appliedRecords)} record(s) in this window, but the file could not be saved: ${reason}. Undo reverts the import; nothing else was changed.`;
		}
		case 'cancelled':
			return 'Import cancelled. Nothing was changed.';
		case 'stale-plan':
			return `Nothing was imported. ${result.message}`;
		case 'refused':
			return `Nothing was imported: ${result.message}`;
		case 'no-op':
			return 'There was nothing to import.';
	}
}

/** A row of a link target table, labelled by its first field's text, or by its ID when that field has no text. */
export interface LinkTargetRow {
	readonly rowId: string;
	readonly label: string;
}

/** The rows a link field can point at, or `null` when the target table does not exist in this database. */
export function linkTargetRowsOf(
	tables: readonly DatabaseTable[],
	targetTableId: string,
): readonly LinkTargetRow[] | null {
	const target = tables.find((table) => table.id === targetTableId);
	if (target === undefined) {
		return null;
	}
	const labelField = target.fields.find((field) => field.kind === 'field' && field.id !== null);
	return target.rows.map((row) => {
		const text =
			labelField === undefined || labelField.kind !== 'field' || labelField.id === null
				? undefined
				: row.cells.get(labelField.id);
		const label = typeof text === 'string' && text.trim() !== '' ? text : row.id;
		return { rowId: row.id, label };
	});
}

/** The distinct, non-blank source values of one column, in first-seen order: exactly what the planner will look up. */
export function linkSourceValuesOf(
	preview: DatabaseImportPreview,
	sourceColumn: number,
): readonly string[] {
	const seen = new Set<string>();
	const values: string[] = [];
	for (const line of preview.body) {
		const text = line[sourceColumn] ?? '';
		if (text.trim() !== '' && !seen.has(text)) {
			seen.add(text);
			values.push(text);
		}
	}
	return values;
}

/**
 * The planner's link maps for the draft's choices. Only included columns whose target is an existing link field
 * produce a map. A single link takes its one chosen ID; a multi-link takes the ordered list.
 */
export function linkMappingsOf(
	draft: ImportDraft,
	preview: DatabaseImportPreview,
	destination: DatabaseTable | undefined,
): readonly DatabaseImportLinkValueMapping[] {
	if (destination === undefined) {
		return [];
	}
	const included = new Set(includedColumnsOf(preview, draft));
	const mappings: DatabaseImportLinkValueMapping[] = [];
	for (const [sourceColumn, fieldId] of draft.fieldTargets) {
		const choices = draft.linkValues.get(sourceColumn);
		if (!included.has(sourceColumn) || choices === undefined || choices.size === 0) {
			continue;
		}
		const field = destination.fields.find(
			(candidate) => candidate.kind === 'field' && candidate.id === fieldId,
		);
		if (field === undefined || field.kind !== 'field' || field.type !== 'link') {
			continue;
		}
		const targetTableId = field.settings.targetTableId;
		if (typeof targetTableId !== 'string') {
			continue;
		}
		const multiple = field.settings.allowMultiple === true;
		const values = new Map<string, string | readonly string[]>();
		for (const [text, ids] of choices) {
			if (multiple) {
				values.set(text, ids);
			} else if (ids.length === 1 && ids[0] !== undefined) {
				values.set(text, ids[0]);
			}
		}
		mappings.push({ sourceColumn, fieldId, targetTableId, values });
	}
	return mappings;
}
