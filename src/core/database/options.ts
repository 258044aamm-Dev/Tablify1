/**
 * Select-option membership — R1 step 6, second half: the other dangling id.
 *
 * A `singleSelect`/`multiSelect` cell stores an option **id**, and the option list lives on the
 * field. The value layer (`values.ts`) accepts a shaped id without judging membership — it cannot,
 * because the list is the field's — and keeps the value either way (ADR-0004 §2: "an optionId
 * string, even unknown"). This module is where that judgment happens: a stored option id the
 * field's own list does not contain is **reported and kept**, exactly like an unresolved link.
 * Deleting an option must never rewrite the cells that named it (the option may be restored by a
 * sync or a hand edit), and it must never look like nothing happened either.
 *
 * Deterministic like the link scan: tables in document order, fields in document order, rows in
 * document order, list elements in stored order. Findings are warnings; the parser attaches them.
 */
import type { SelectOption, TableField } from './fields';
import { isJsonArray } from './json';
import type { DatabaseDocument } from './schema';
import { isInvalidCell } from './values';

/** Every finding {@link validateOptions} can produce. */
export type OptionFindingCode = 'unknown-option';

/** One stored option id the field's own option list does not contain. */
export interface OptionFinding {
	readonly code: OptionFindingCode;
	readonly message: string;
	readonly path: string;
}

/** The ids a field declares, or `null` when the field is not a select. */
function declaredIds(field: TableField): ReadonlySet<string> | null {
	if (field.kind !== 'field' || (field.type !== 'singleSelect' && field.type !== 'multiSelect')) {
		return null;
	}
	const options: readonly SelectOption[] | undefined = field.settings.options;
	const ids = new Set<string>();
	for (const option of options ?? []) {
		ids.add(option.id);
	}
	return ids;
}

/**
 * Validate the option references of a document that already loaded. Never refuses; returns every
 * finding, in document order, for the caller to attach or show.
 */
export function validateOptions(document: DatabaseDocument): readonly OptionFinding[] {
	const findings: OptionFinding[] = [];
	document.tables.forEach((table, tableIndex) => {
		for (const field of table.fields) {
			if (field.kind !== 'field') {
				continue;
			}
			const ids = declaredIds(field);
			if (ids === null) {
				continue;
			}
			const fieldName = field.name;
			const fieldId = field.id;
			const report = (optionId: string, at: string): void => {
				findings.push({
					code: 'unknown-option',
					message: `The field "${fieldName}" stores the option "${optionId}", and the field's own option list does not contain that id; the value is kept as it is.`,
					path: at,
				});
			};
			table.rows.forEach((row, rowIndex) => {
				const cell = row.cells.get(fieldId);
				if (cell === undefined || isInvalidCell(cell)) {
					return;
				}
				const cellPath = `$.tables[${String(tableIndex)}].rows[${String(rowIndex)}].cells.${fieldId}`;
				if (typeof cell === 'string') {
					if (!ids.has(cell)) {
						report(cell, cellPath);
					}
					return;
				}
				if (isJsonArray(cell)) {
					cell.forEach((item, itemIndex) => {
						if (typeof item === 'string' && !ids.has(item)) {
							report(item, `${cellPath}[${String(itemIndex)}]`);
						}
					});
				}
			});
		}
	});
	return findings;
}
