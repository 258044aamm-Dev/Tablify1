/**
 * Linked-record invariants — R1 step 6.
 *
 * [ADR-0001](../docs/adr/ADR-0001-link-cardinality.md) is the contract this module enforces: one
 * side stores (the field that declares the link), the inverse is derived and never stored, the
 * stored order *is* the display order, and a broken reference is **reported and kept** — never
 * pruned, never repaired, never invented. The six questions of R1 step 6 are answered in the ADR;
 * what lives here is the one scan that answers them for a document. No other module re-implements
 * this scan.
 *
 * Everything this scan can see leaves a document that still describes itself honestly: the model
 * is complete, and only relation resolution is degraded. So every finding is a **warning**, and
 * the parser attaches findings as warnings (ADR-0001 §6). Refusing to *read* would hide intact
 * data behind one broken pointer; the place that refuses is the save path, where `docs/10`'s
 * posture applies ("refuse to save a corrupted reference graph without a visible error/report").
 *
 * Findings are deterministic: tables in document order, then fields in document order, then rows
 * in document order. `path` points into the document as written, so a repair screen can jump to
 * the exact cell, and every message names the table, field and id in the words a user would use.
 */
import type { TableField } from './fields';
import { isJsonArray } from './json';
import type { DatabaseDocument, DatabaseTable } from './schema';
import { isInvalidCell } from './values';

/** Every finding {@link validateLinks} can produce. */
export type LinkFindingCode =
	/** A link's `targetTableId` names no table of this document (or nothing at all). */
	| 'unknown-link-target-table'
	/** `inverseFieldId` names no field of the target table. */
	| 'missing-inverse-field'
	/** `inverseFieldId` names a field that exists but is not a link. */
	| 'inverse-not-a-link'
	/** The inverse field is a link, but it does not point back into the declaring table. */
	| 'inverse-target-mismatch'
	/** The inverse field exists but is not marked `generated: true`. */
	| 'inverse-not-generated'
	/** A generated field still carries stored values, which are never a source of truth. */
	| 'generated-inverse-with-cells'
	/** The stored shape contradicts the field's declared cardinality (`allowMultiple`). */
	| 'link-cardinality-mismatch'
	/** A stored id resolves to no row of the target table (missing row, or a row elsewhere). */
	| 'unresolved-link';

/** One problem with the link graph. The parser attaches these as load warnings. */
export interface LinkFinding {
	readonly code: LinkFindingCode;
	readonly message: string;
	readonly path: string;
}

/** A table plus everything the scan needs to resolve references into it. */
interface TableEntry {
	readonly table: DatabaseTable;
	readonly index: number;
	readonly rowIds: ReadonlySet<string>;
}

/** How a field is named in a message: its name when it has one, its type name otherwise. */
function nameOf(field: TableField): string {
	if (field.kind === 'field') {
		return field.name;
	}
	return field.name ?? field.typeName;
}

/** How a non-link field is described in a message. */
function describeKind(field: TableField): string {
	if (field.kind === 'field') {
		return `a "${field.type}" column`;
	}
	return `an unsupported "${field.typeName}" column`;
}

/** Join a count and its noun, singular or plural. */
function countOf(count: number, singular: string, plural: string): string {
	return count === 1 ? `1 ${singular}` : `${String(count)} ${plural}`;
}

/**
 * Validate the link graph of a document that already loaded.
 *
 * The scan never refuses anything: it returns every finding it can see, in document order, and the
 * caller decides what to show. See the module comment for why findings are warnings.
 */
export function validateLinks(document: DatabaseDocument): readonly LinkFinding[] {
	const findings: LinkFinding[] = [];
	const byId = new Map<string, TableEntry>();
	/** Row id → the first table (document order) whose rows hold it, for "wrong table" messages. */
	const rowOwner = new Map<string, string>();

	document.tables.forEach((table, index) => {
		const rowIds = new Set<string>();
		for (const row of table.rows) {
			rowIds.add(row.id);
			if (!rowOwner.has(row.id)) {
				rowOwner.set(row.id, table.id);
			}
		}
		byId.set(table.id, { table, index, rowIds });
	});

	document.tables.forEach((table, tableIndex) => {
		for (const [fieldIndex, field] of table.fields.entries()) {
			if (field.kind !== 'field' || field.type !== 'link') {
				continue;
			}
			const fieldPath = `$.tables[${String(tableIndex)}].fields[${String(fieldIndex)}]`;
			const fieldName = field.name;
			const targetId = field.settings.targetTableId;
			if (targetId === undefined) {
				findings.push({
					code: 'unknown-link-target-table',
					message: `The link "${fieldName}" names no table to point into; the field is kept as it is.`,
					path: `${fieldPath}.targetTableId`,
				});
				continue;
			}
			const target = byId.get(targetId);
			if (target === undefined) {
				findings.push({
					code: 'unknown-link-target-table',
					message: `The link "${fieldName}" points into "${targetId}", and this document has no table with that id; the field and its stored values are kept as they are.`,
					path: `${fieldPath}.targetTableId`,
				});
				continue;
			}

			checkInverse(field, fieldName, fieldPath, table, target, byId, findings);

			if (field.settings.generated === true) {
				// The inverse side is derived, never stored. Any stored value is reported once for
				// the field — a repaired file needs the count and the first location, not a warning
				// per row — and the values themselves are not treated as references.
				let count = 0;
				let firstPath: string | null = null;
				table.rows.forEach((row, rowIndex) => {
					if (!row.cells.has(field.id)) {
						return;
					}
					count += 1;
					if (firstPath === null) {
						firstPath = `$.tables[${String(tableIndex)}].rows[${String(rowIndex)}].cells.${field.id}`;
					}
				});
				if (count > 0) {
					findings.push({
						code: 'generated-inverse-with-cells',
						message: `The link "${fieldName}" is generated — derived from its owning link and never stored — and ${countOf(count, 'row still carries a stored value', 'rows still carry stored values')} for it (first at ${firstPath ?? fieldPath}); the values are kept as they are.`,
						path: fieldPath,
					});
				}
				continue;
			}

			const multi = field.settings.allowMultiple === true;
			table.rows.forEach((row, rowIndex) => {
				const cell = row.cells.get(field.id);
				if (cell === undefined || isInvalidCell(cell)) {
					// An invalid value was already reported by the value layer; reporting it twice
					// would make the repair list say the same thing in two vocabularies.
					return;
				}
				const cellPath = `$.tables[${String(tableIndex)}].rows[${String(rowIndex)}].cells.${field.id}`;
				const list: readonly string[] | null = isJsonArray(cell) ? cell : null;
				if (multi && list === null) {
					findings.push({
						code: 'link-cardinality-mismatch',
						message: `The link "${fieldName}" is declared multi ("allowMultiple": true), and this cell stores a single id; the stored value is kept as it is.`,
						path: cellPath,
					});
				}
				if (!multi && list !== null) {
					findings.push({
						code: 'link-cardinality-mismatch',
						message: `The link "${fieldName}" is declared single, and this cell stores a list of ${String(list.length)} ids; the stored value is kept as it is.`,
						path: cellPath,
					});
				}
				const stored: readonly string[] = list ?? (typeof cell === 'string' ? [cell] : []);
				stored.forEach((reference, referenceIndex) => {
					if (target.rowIds.has(reference)) {
						return;
					}
					const at = list === null ? cellPath : `${cellPath}[${String(referenceIndex)}]`;
					const ownerId = rowOwner.get(reference);
					if (ownerId === undefined) {
						findings.push({
							code: 'unresolved-link',
							message: `The link "${fieldName}" points at "${reference}", and the table "${target.table.name}" has no row with that id; the value is kept as it is.`,
							path: at,
						});
						return;
					}
					const ownerName = byId.get(ownerId)?.table.name ?? ownerId;
					findings.push({
						code: 'unresolved-link',
						message: `The link "${fieldName}" points at "${reference}", which is a row of "${ownerName}" rather than of "${target.table.name}"; the value is kept as it is.`,
						path: at,
					});
				});
			});
		}
	});

	return findings;
}

/** Check the declarations of a link field's inverse, when it names one. */
function checkInverse(
	field: TableField,
	fieldName: string,
	fieldPath: string,
	table: DatabaseTable,
	target: TableEntry,
	byId: ReadonlyMap<string, TableEntry>,
	findings: LinkFinding[],
): void {
	if (field.kind !== 'field') {
		return;
	}
	const inverseId = field.settings.inverseFieldId;
	if (inverseId === undefined) {
		return;
	}
	const inverseIndex = target.table.fields.findIndex((candidate) => candidate.id === inverseId);
	if (inverseIndex === -1) {
		findings.push({
			code: 'missing-inverse-field',
			message: `The link "${fieldName}" declares "${inverseId}" as its inverse, and the table "${target.table.name}" has no field with that id; the declaration is kept as it is.`,
			path: `${fieldPath}.inverseFieldId`,
		});
		return;
	}
	const inverse = target.table.fields[inverseIndex];
	if (inverse === undefined) {
		return;
	}
	if (inverse.kind !== 'field' || inverse.type !== 'link') {
		findings.push({
			code: 'inverse-not-a-link',
			message: `The link "${fieldName}" declares "${nameOf(inverse)}" as its inverse, and that field on "${target.table.name}" is ${describeKind(inverse)} rather than a link; the declaration is kept as it is.`,
			path: `${fieldPath}.inverseFieldId`,
		});
		return;
	}
	const inversePath = `$.tables[${String(target.index)}].fields[${String(inverseIndex)}]`;
	const inverseTarget = inverse.settings.targetTableId;
	if (inverseTarget !== table.id) {
		const named =
			inverseTarget === undefined
				? 'no table'
				: `"${byId.get(inverseTarget)?.table.name ?? inverseTarget}"`;
		findings.push({
			code: 'inverse-target-mismatch',
			message: `The link "${fieldName}" declares "${inverse.name}" as its inverse, and the inverse should point back into "${table.name}", but it points into ${named} instead; the declaration is kept as it is.`,
			path: `${inversePath}.targetTableId`,
		});
	}
	if (inverse.settings.generated !== true) {
		findings.push({
			code: 'inverse-not-generated',
			message: `The link "${fieldName}" declares "${inverse.name}" as its inverse, and "${inverse.name}" is not marked "generated": true, so a writer could store values in a column that is meant to be derived; the declaration is kept as it is.`,
			path: `${inversePath}.generated`,
		});
	}
}

/** One table and field that point into a table, as the refusal names them (ADR-0002 §3). */
export interface ReferringField {
	readonly tableId: string;
	readonly tableName: string;
	readonly fieldId: string;
	readonly fieldName: string;
}

/**
 * Every link field of **another** table whose `targetTableId` is this table.
 *
 * This is the query ADR-0002 §3 refuses a table delete with, and it is deliberately about the
 * *declaration*, not about stored values: a link field that names this table blocks the delete
 * whether or not any cell currently resolves, because the field is what would be left pointing into
 * nothing. Findings and staleness are not consulted — a document with dangling ids must still refuse
 * to delete the table they dangle from.
 *
 * Results are in document order (tables, then fields), so a refusal's message is stable.
 */
export function validateLinksForTableDelete(
	document: DatabaseDocument,
	tableId: string,
): readonly ReferringField[] {
	const referring: ReferringField[] = [];
	for (const table of document.tables) {
		if (table.id === tableId) {
			continue;
		}
		for (const field of table.fields) {
			if (field.kind !== 'field' || field.type !== 'link') {
				continue;
			}
			if (field.settings.targetTableId !== tableId) {
				continue;
			}
			referring.push({
				tableId: table.id,
				tableName: table.name,
				fieldId: field.id,
				fieldName: field.name,
			});
		}
	}
	return referring;
}
