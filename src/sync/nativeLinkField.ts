/**
 * A link field's **descriptor at the sync boundary** (R5 Part C, Step 5 — wiring).
 *
 * The engine converts every value through the column's descriptor: `parse` for remote → local, `toJson` for local →
 * remote (see `values.ts`). A link cell holds local row IDs and the provider holds record IDs, so a link field needs a
 * descriptor that translates between them, using the target table's link file. This module builds that descriptor,
 * and nothing else. It is wired into the port only when a {@link LinkBoundary} exists for the field.
 *
 * ## Rules
 *
 * - **Only live, mapped rows translate.** The boundary is built from rows that still exist in the target table, so a
 *   deleted row is never sent or accepted.
 * - **Absent and empty mean no value.** A missing or empty remote list is `null`, and an empty local list is `null`
 *   too, so an empty field does not show up as a change on every sync.
 * - **A pull that cannot translate is a problem, not a value.** `parse` fails with one sentence, which the engine
 *   reports as a mismatch. Nothing is written for that record.
 * - **A push that cannot translate throws.** The run checks for this before it writes anything (see `nativeRun`), so
 *   a throw here means that check was bypassed. A throw is safer than writing text or an empty list.
 */
import { parseFailed, parsed } from '../core/types';
import type { CellValue, FieldContext, FieldDescriptor, Parsed } from '../core/types';

/** How one link field translates for this run. Built from the target table's link file, live rows only. */
export type LinkBoundary = {
	/** The remote table this link field points to. Checked against the remote field's own `linkedTableId`. */
	readonly remoteTableId: string;
	/** Local row ID → remote record ID, for rows that still exist. */
	readonly rowToRecord: Readonly<Record<string, string>>;
	/** Remote record ID → local row ID. One-to-one, because the inverse of a row map is refused when it is not. */
	readonly recordToRow: ReadonlyMap<string, string>;
};

/** True when a value is absent or empty, which both mean "no value" at this boundary. */
function isEmptyLink(value: unknown): boolean {
	return value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

/**
 * The descriptor for one link field: the base text descriptor's behaviour for everything except the two conversions,
 * which map row IDs and record IDs through `boundary`.
 */
export function linkDescriptorOf(base: FieldDescriptor, boundary: LinkBoundary): FieldDescriptor {
	return {
		...base,
		parse(raw: unknown, _context: FieldContext): Parsed<CellValue> {
			if (isEmptyLink(raw)) {
				return parsed(null);
			}
			if (!Array.isArray(raw) || !raw.every((item) => typeof item === 'string')) {
				return parseFailed('The remote link is not a list of record IDs.', raw);
			}
			const rowIds: string[] = [];
			for (const recordId of raw) {
				const rowId = boundary.recordToRow.get(recordId);
				if (rowId === undefined) {
					return parseFailed(
						`A linked record has no row in this database (${recordId}).`,
						raw,
					);
				}
				rowIds.push(rowId);
			}
			return parsed(rowIds);
		},
		toJson(value: CellValue, _context: FieldContext): CellValue {
			if (isEmptyLink(value)) {
				return null;
			}
			if (!Array.isArray(value)) {
				throw new Error('A link value must be a list of rows.');
			}
			const recordIds: string[] = [];
			for (const rowId of value) {
				const recordId =
					typeof rowId === 'string' &&
					Object.prototype.hasOwnProperty.call(boundary.rowToRecord, rowId)
						? boundary.rowToRecord[rowId]
						: undefined;
				if (recordId === undefined) {
					throw new Error(
						'A linked row is not linked to a remote record, so it cannot be written.',
					);
				}
				recordIds.push(recordId);
			}
			return recordIds;
		},
	};
}
