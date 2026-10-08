/**
 * Targeted relation reads and write checks — R3 step 5.
 *
 * `links.ts` owns the one document-wide scan: `validateLinks` indexes table/row identity once, then
 * visits every stored link cell once to report dangling references and declaration/cardinality
 * findings. This module does not repeat that scan. It answers questions about a *particular* write or
 * cell, and checks whether a schema edit would introduce a new relation problem. Parse findings stay
 * warnings, and malformed or dangling stored values remain readable and round-trip untouched.
 *
 * A link's stored owner is its declaring field. The inverse is derived, never written; an ordinary
 * write must point only at rows of the declared target; a multi-link's order is its value. Existing
 * findings are tolerated when a cell or field is edited without introducing a new problem, so
 * cleanup and undo can preserve unrelated damage in a document the user is repairing.
 */
import type { FieldDefinition, TableField } from './fields';
import type { CellState, TableRow } from './rows';
import type { DatabaseDocument, DatabaseTable } from './schema';
import { isInvalidCell } from './values';

/** One graph problem visible to an operation or a cell renderer. */
export type RelationFindingCode =
	| 'missing-target-table'
	| 'generated-field'
	| 'unreadable-value'
	| 'duplicate-reference'
	| 'cardinality-mismatch'
	| 'missing-row'
	| 'foreign-row';

/** A pure finding about a link declaration or one stored value. */
export interface RelationFinding {
	readonly code: RelationFindingCode;
	readonly message: string;
	/** The referenced row id, when this finding belongs to one edge. */
	readonly referenceId: string | null;
	/** Target-table identity, when membership in a configured table was checked. */
	readonly targetTableId?: string | null;
	/** Index inside a stored list, or `null` when the finding is not tied to one entry. */
	readonly at: number | null;
}

/** One stored id and how it resolves against its declared target. */
export interface LinkReferenceResolution {
	readonly id: string;
	readonly state: 'resolved' | 'missing-row' | 'foreign-row' | 'missing-target-table';
	readonly ownerTableId: string | null;
	readonly at: number | null;
}

/** A cell-level view of a link, suitable for a renderer's broken-reference state. */
export interface LinkCellInspection {
	readonly tableId: string;
	readonly rowId: string;
	readonly fieldId: string;
	readonly targetTableId: string | null;
	readonly state: 'empty' | 'resolved' | 'broken' | 'unreadable';
	readonly references: readonly LinkReferenceResolution[];
	readonly findings: readonly RelationFinding[];
}

/** The small index these targeted checks need; it indexes row identity but never scans cell values. */
interface RelationIndex {
	readonly tableById: ReadonlyMap<string, DatabaseTable>;
	readonly rowIdsByTable: ReadonlyMap<string, ReadonlySet<string>>;
	readonly rowsByTable: ReadonlyMap<string, ReadonlyMap<string, TableRow>>;
	readonly firstTableByRowId: ReadonlyMap<string, DatabaseTable>;
}

/** Index table and row identity once for a targeted relation check. */
function indexRelations(document: DatabaseDocument): RelationIndex {
	const tableById = new Map<string, DatabaseTable>();
	const rowIdsByTable = new Map<string, ReadonlySet<string>>();
	const rowsByTable = new Map<string, ReadonlyMap<string, TableRow>>();
	const firstTableByRowId = new Map<string, DatabaseTable>();
	for (const table of document.tables) {
		tableById.set(table.id, table);
		const rowIds = new Set<string>();
		const rows = new Map<string, TableRow>();
		for (const row of table.rows) {
			rowIds.add(row.id);
			rows.set(row.id, row);
			if (!firstTableByRowId.has(row.id)) {
				firstTableByRowId.set(row.id, table);
			}
		}
		rowIdsByTable.set(table.id, rowIds);
		rowsByTable.set(table.id, rows);
	}
	return { tableById, rowIdsByTable, rowsByTable, firstTableByRowId };
}

/** Resolve a link field's declared target, or `undefined` for a missing declaration/table. */
function targetOf(index: RelationIndex, field: TableField): DatabaseTable | undefined {
	if (field.kind !== 'field' || field.type !== 'link') {
		return undefined;
	}
	const targetId = field.settings.targetTableId;
	return targetId === undefined ? undefined : index.tableById.get(targetId);
}

/** The target-table problem for a link declaration, even when none of its rows has a value. */
function targetFinding(index: RelationIndex, field: FieldDefinition): RelationFinding | undefined {
	if (field.type !== 'link') {
		return undefined;
	}
	const targetId = field.settings.targetTableId;
	if (targetId === undefined) {
		return {
			code: 'missing-target-table',
			message: `"${field.name}" names no target table, so there is nowhere for a link to point.`,
			referenceId: null,
			targetTableId: null,
			at: null,
		};
	}
	if (index.tableById.has(targetId)) {
		return undefined;
	}
	return {
		code: 'missing-target-table',
		message: `"${field.name}" points at table "${targetId}", which this database does not have.`,
		referenceId: targetId,
		targetTableId: targetId,
		at: null,
	};
}

/** A public target-table query, useful to callers that resolve a field before reading its cells. */
export function resolveLinkTarget(
	document: DatabaseDocument,
	field: TableField,
): DatabaseTable | undefined {
	return targetOf(indexRelations(document), field);
}

/** The missing-target finding for a field, or `undefined` when its target exists. */
export function linkTargetFinding(
	document: DatabaseDocument,
	field: FieldDefinition,
): RelationFinding | undefined {
	return targetFinding(indexRelations(document), field);
}

/**
 * Read the ids in a canonical link value, or `undefined` when the cell is absent, empty, or preserved
 * as invalid. This does not repair, normalize or reorder the stored value.
 */
function idsOf(value: CellState | undefined): readonly string[] | undefined {
	if (value === undefined || value === null || isInvalidCell(value)) {
		return undefined;
	}
	if (typeof value === 'string') {
		return [value];
	}
	if (Array.isArray(value)) {
		const ids: string[] = [];
		for (const entry of value) {
			if (typeof entry !== 'string') {
				return undefined;
			}
			ids.push(entry);
		}
		return ids;
	}
	return undefined;
}

/** A stable key for comparing whether a schema/value edit introduced a finding. */
function findingKey(finding: RelationFinding): string {
	return `${finding.code}\u0000${finding.targetTableId ?? ''}\u0000${finding.referenceId ?? ''}`;
}

/**
 * Findings for one stored value, using the same distinctions as `validateLinks`.
 *
 * This is a targeted check of one field value, not a document scan. The document-wide warning list
 * remains `validateLinks(document)` in `links.ts`.
 */
function valueFindings(
	index: RelationIndex,
	field: FieldDefinition,
	value: CellState | undefined,
): readonly RelationFinding[] {
	if (field.type !== 'link' || value === undefined || value === null) {
		return [];
	}
	const findings: RelationFinding[] = [];
	const targetProblem = targetFinding(index, field);
	if (targetProblem !== undefined) {
		findings.push(targetProblem);
	}
	if (field.settings.generated === true) {
		findings.push({
			code: 'generated-field',
			message: `"${field.name}" is a generated inverse and must not store cell values.`,
			referenceId: field.id,
			at: null,
		});
		return findings;
	}
	if (isInvalidCell(value)) {
		findings.push({
			code: 'unreadable-value',
			message: `The stored value in "${field.name}" is preserved but cannot be read as row references.`,
			referenceId: field.id,
			at: null,
		});
		return findings;
	}
	const ids = idsOf(value);
	if (ids === undefined) {
		findings.push({
			code: 'unreadable-value',
			message: `The value written to "${field.name}" cannot be read as row references.`,
			referenceId: field.id,
			at: null,
		});
		return findings;
	}
	const seen = new Set<string>();
	for (const [at, id] of ids.entries()) {
		if (seen.has(id)) {
			findings.push({
				code: 'duplicate-reference',
				message: `"${field.name}" names row "${id}" more than once; a link stores each row once.`,
				referenceId: id,
				at,
			});
		}
		seen.add(id);
	}
	const isList = Array.isArray(value);
	const multiple = field.settings.allowMultiple === true;
	if (isList !== multiple || (!multiple && ids.length > 1)) {
		findings.push({
			code: 'cardinality-mismatch',
			message: multiple
				? `"${field.name}" is multi, so its stored value must be an ordered list of row ids.`
				: `"${field.name}" holds one row, but its stored value names ${String(ids.length)} id(s) in a list.`,
			referenceId: null,
			at: null,
		});
	}
	const targetId = field.settings.targetTableId;
	const target = targetId === undefined ? undefined : index.tableById.get(targetId);
	const targetRows = targetId === undefined ? undefined : index.rowIdsByTable.get(targetId);
	if (target === undefined || targetRows === undefined) {
		for (const [at, id] of ids.entries()) {
			findings.push({
				code: 'missing-target-table',
				message: `Row "${id}" cannot resolve because "${field.name}" has no target table in this database.`,
				referenceId: id,
				targetTableId: targetId ?? null,
				at: typeof value === 'string' ? null : at,
			});
		}
		return findings;
	}
	for (const [at, id] of ids.entries()) {
		if (targetRows.has(id)) {
			continue;
		}
		const owner = index.firstTableByRowId.get(id);
		if (owner === undefined) {
			findings.push({
				code: 'missing-row',
				message: `Table "${target.name}" has no row "${id}"; the stored link is kept for repair.`,
				referenceId: id,
				targetTableId: target.id,
				at: typeof value === 'string' ? null : at,
			});
			continue;
		}
		findings.push({
			code: 'foreign-row',
			message: `Row "${id}" belongs to "${owner.name}", not the target table "${target.name}"; the stored link is kept for repair.`,
			referenceId: id,
			targetTableId: target.id,
			at: typeof value === 'string' ? null : at,
		});
	}
	return findings;
}

/** All findings for one stored value, also exported for pure validation and focused tests. */
export function relationFindings(
	document: DatabaseDocument,
	field: FieldDefinition,
	value: CellState | undefined,
): readonly RelationFinding[] {
	const index = indexRelations(document);
	const declaration = targetFinding(index, field);
	const stored = valueFindings(index, field, value);
	if (
		declaration !== undefined &&
		stored.some(
			(finding) =>
				finding.code === declaration.code &&
				finding.referenceId === declaration.referenceId,
		)
	) {
		return stored;
	}
	return declaration === undefined ? stored : [declaration, ...stored];
}

/** The first row-selection problem for `set-link`, whose public payload is always an ordered id list. */
export function checkLinkSelection(
	document: DatabaseDocument,
	field: FieldDefinition,
	rowIds: readonly string[],
): RelationFinding | undefined {
	const index = indexRelations(document);
	if (field.type !== 'link') {
		return undefined;
	}
	const targetProblem = targetFinding(index, field);
	if (targetProblem !== undefined) {
		return targetProblem;
	}
	if (field.settings.generated === true) {
		return {
			code: 'generated-field',
			message: `"${field.name}" is a generated inverse; set the link on its owning field instead.`,
			referenceId: field.id,
			at: null,
		};
	}
	const seen = new Set<string>();
	for (const [at, id] of rowIds.entries()) {
		if (seen.has(id)) {
			return {
				code: 'duplicate-reference',
				message: `"${field.name}" names row "${id}" more than once; a link stores each row once.`,
				referenceId: id,
				at,
			};
		}
		seen.add(id);
	}
	if (field.settings.allowMultiple !== true && rowIds.length > 1) {
		return {
			code: 'cardinality-mismatch',
			message: `"${field.name}" holds one row, but this selection names ${String(rowIds.length)}.`,
			referenceId: null,
			at: null,
		};
	}
	const targetId = field.settings.targetTableId;
	const target = targetId === undefined ? undefined : index.tableById.get(targetId);
	const targetRows = targetId === undefined ? undefined : index.rowIdsByTable.get(targetId);
	if (target === undefined || targetRows === undefined) {
		return targetProblem;
	}
	for (const [at, id] of rowIds.entries()) {
		if (targetRows.has(id)) {
			continue;
		}
		const owner = index.firstTableByRowId.get(id);
		return {
			code: owner === undefined ? 'missing-row' : 'foreign-row',
			message:
				owner === undefined
					? `Table "${target.name}" has no row "${id}".`
					: `Row "${id}" belongs to "${owner.name}", not the target table "${target.name}".`,
			referenceId: id,
			at,
		};
	}
	return undefined;
}

/**
 * The first *new* problem a direct link-cell write would introduce. Existing broken edges are allowed
 * to remain in place; this is important for repairing a loaded document and for delete/undo cleanup.
 */
export function checkLinkWrite(
	document: DatabaseDocument,
	field: FieldDefinition,
	value: CellState,
	previous: CellState | undefined,
): RelationFinding | undefined {
	if (field.type !== 'link' || value === null) {
		return undefined;
	}
	if (field.settings.generated === true) {
		return {
			code: 'generated-field',
			message: `"${field.name}" is a generated inverse and cannot be written.`,
			referenceId: field.id,
			at: null,
		};
	}
	const index = indexRelations(document);
	const nextFindings = valueFindings(index, field, value);
	if (isInvalidCell(value)) {
		return nextFindings[0];
	}
	const previousFindings = valueFindings(index, field, previous);
	const previousCounts = new Map<string, number>();
	for (const finding of previousFindings) {
		const key = findingKey(finding);
		previousCounts.set(key, (previousCounts.get(key) ?? 0) + 1);
	}
	for (const finding of nextFindings) {
		const key = findingKey(finding);
		const count = previousCounts.get(key) ?? 0;
		if (count > 0) {
			previousCounts.set(key, count - 1);
			continue;
		}
		return finding;
	}
	return undefined;
}

/**
 * Whether reconfiguring a field changes any existing row into a newly broken relation.
 *
 * The check compares the old and new declaration against each row under the same document revision.
 * Existing findings do not prevent unrelated repairs or metadata edits, but a new target, duplicate,
 * cardinality problem or generated-value conflict refuses before the document changes.
 */
export function checkLinkFieldChange(
	document: DatabaseDocument,
	table: DatabaseTable,
	previous: FieldDefinition,
	next: FieldDefinition,
): RelationFinding | undefined {
	if (next.type !== 'link') {
		return undefined;
	}
	const index = indexRelations(document);
	const previousFindings = new Map<string, number>();
	const nextFindings: RelationFinding[] = [];
	const oldDeclaration = targetFinding(index, previous);
	const newDeclaration = targetFinding(index, next);
	if (oldDeclaration !== undefined) {
		const key = findingKey(oldDeclaration);
		previousFindings.set(key, (previousFindings.get(key) ?? 0) + 1);
	}
	if (newDeclaration !== undefined) {
		nextFindings.push(newDeclaration);
	}
	for (const row of table.rows) {
		const stored = row.cells.get(previous.id);
		for (const finding of valueFindings(index, previous, stored)) {
			const key = findingKey(finding);
			previousFindings.set(key, (previousFindings.get(key) ?? 0) + 1);
		}
		nextFindings.push(...valueFindings(index, next, stored));
	}
	for (const finding of nextFindings) {
		const key = findingKey(finding);
		const count = previousFindings.get(key) ?? 0;
		if (count > 0) {
			previousFindings.set(key, count - 1);
			continue;
		}
		return finding;
	}
	return undefined;
}

/**
 * Inspect one stored link cell. A broken reference is reported, not repaired; the cell remains the
 * document's value and can be serialized or edited by an explicit user action.
 */
/** A reusable read-only relation view for one immutable document revision. */
export interface RelationInspector {
	inspectLinkCell(
		tableId: string,
		rowId: string,
		fieldId: string,
	): LinkCellInspection | undefined;
}

function inspectLinkCellFromIndex(
	index: RelationIndex,
	tableId: string,
	rowId: string,
	fieldId: string,
): LinkCellInspection | undefined {
	const table = index.tableById.get(tableId);
	const row = index.rowsByTable.get(tableId)?.get(rowId);
	const field = table?.fields.find((candidate) => candidate.id === fieldId);
	if (
		table === undefined ||
		row === undefined ||
		field === undefined ||
		field.kind !== 'field' ||
		field.type !== 'link'
	) {
		return undefined;
	}
	const value = row.cells.get(field.id);
	const declaration = targetFinding(index, field);
	const storedFindings = valueFindings(index, field, value);
	const findings =
		declaration === undefined ||
		storedFindings.some(
			(finding) =>
				finding.code === declaration.code &&
				finding.referenceId === declaration.referenceId,
		)
			? storedFindings
			: [declaration, ...storedFindings];
	const ids = idsOf(value);
	const target = targetOf(index, field);
	const references: LinkReferenceResolution[] = [];
	for (const [at, id] of (ids ?? []).entries()) {
		if (target === undefined) {
			references.push({ id, state: 'missing-target-table', ownerTableId: null, at });
			continue;
		}
		const targetRows = index.rowIdsByTable.get(target.id);
		if (targetRows?.has(id) === true) {
			references.push({ id, state: 'resolved', ownerTableId: target.id, at });
			continue;
		}
		const owner = index.firstTableByRowId.get(id);
		references.push({
			id,
			state: owner === undefined ? 'missing-row' : 'foreign-row',
			ownerTableId: owner?.id ?? null,
			at: typeof value === 'string' ? null : at,
		});
	}
	const state =
		value === undefined || value === null
			? findings.length > 0
				? 'broken'
				: 'empty'
			: isInvalidCell(value) || ids === undefined
				? 'unreadable'
				: findings.length > 0
					? 'broken'
					: ids.length === 0
						? 'empty'
						: 'resolved';
	return {
		tableId,
		rowId,
		fieldId,
		targetTableId: field.settings.targetTableId ?? null,
		state,
		references,
		findings,
	};
}

/** Build the read-only lookup once, then inspect many cells without re-indexing the whole document. */
export function createRelationInspector(document: DatabaseDocument): RelationInspector {
	const index = indexRelations(document);
	return {
		inspectLinkCell: (tableId, rowId, fieldId) =>
			inspectLinkCellFromIndex(index, tableId, rowId, fieldId),
	};
}

/**
 * Inspect one stored link cell. A broken reference is reported, not repaired; the cell remains the
 * document's value and can be serialized or edited by an explicit user action.
 */
export function inspectLinkCell(
	document: DatabaseDocument,
	tableId: string,
	rowId: string,
	fieldId: string,
): LinkCellInspection | undefined {
	return createRelationInspector(document).inspectLinkCell(tableId, rowId, fieldId);
}
