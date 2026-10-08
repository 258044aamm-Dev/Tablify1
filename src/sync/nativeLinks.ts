/**
 * Translation of a link cell between **local row IDs** and **remote record IDs**, as pure functions.
 *
 * A link cell holds the IDs of the rows it points to. The provider stores the IDs of the records it points to. The
 * two are related only by the target table's own link file (`rowMap`: local row → remote record), so a translation
 * is possible only when every target has an entry. The rule (R5 Part C, Step 5), applied by the caller:
 *
 *   · **Every target must translate, in both directions.** A target with no entry is *unresolved*. An unresolved
 *     target is never written as text and never dropped, because dropping one would turn a link into a smaller link
 *     and the provider would then clear the rest.
 *   · **Inverse mapping must be one-to-one.** Two local rows that point at one remote record make the inverse
 *     ambiguous, so the inverse is refused rather than guessed.
 *
 * Nothing here reads or writes a file, and nothing here knows a provider's name. The caller decides what an
 * unresolved target blocks.
 */

/** The result of translating one link cell: the translated IDs in cell order, or the targets that did not translate. */
export type LinkTranslation =
	| { readonly ok: true; readonly ids: readonly string[] }
	| { readonly ok: false; readonly unresolved: readonly string[] };

/** The inverse of a row map, or the reason it cannot be built. */
export type InverseRowMap =
	| { readonly ok: true; readonly byRecord: ReadonlyMap<string, string> }
	| { readonly ok: false; readonly recordId: string; readonly rows: readonly string[] };

/**
 * Local row IDs → remote record IDs, in the cell's own order. A row with no entry is unresolved. Duplicate targets are
 * kept, because the cell is the user's list, and a list is written as it stands.
 */
export function localLinksToRemote(
	rowIds: readonly string[],
	rowMap: Readonly<Record<string, string>>,
): LinkTranslation {
	const ids: string[] = [];
	const unresolved: string[] = [];
	for (const rowId of rowIds) {
		const recordId = Object.prototype.hasOwnProperty.call(rowMap, rowId)
			? rowMap[rowId]
			: undefined;
		if (recordId === undefined) {
			unresolved.push(rowId);
		} else {
			ids.push(recordId);
		}
	}
	return unresolved.length === 0 ? { ok: true, ids } : { ok: false, unresolved };
}

/**
 * The inverse of a row map. Refused when two rows share one record, because then a record's local row is not a single
 * row and a pull could not say which one to fill.
 */
export function invertRowMap(rowMap: Readonly<Record<string, string>>): InverseRowMap {
	const byRecord = new Map<string, string>();
	const owners = new Map<string, string[]>();
	for (const [rowId, recordId] of Object.entries(rowMap)) {
		const list = owners.get(recordId) ?? [];
		list.push(rowId);
		owners.set(recordId, list);
		byRecord.set(recordId, rowId);
	}
	for (const [recordId, rows] of owners) {
		if (rows.length > 1) {
			return { ok: false, recordId, rows };
		}
	}
	return { ok: true, byRecord };
}

/**
 * Remote record IDs → local row IDs, in the provider's order. A record with no local row is unresolved, and the caller
 * reports it. A pull never creates a local row, so an unresolved record is left out only by the caller's own rule.
 */
export function remoteLinksToLocal(
	recordIds: readonly string[],
	inverse: ReadonlyMap<string, string>,
): LinkTranslation {
	const ids: string[] = [];
	const unresolved: string[] = [];
	for (const recordId of recordIds) {
		const rowId = inverse.get(recordId);
		if (rowId === undefined) {
			unresolved.push(recordId);
		} else {
			ids.push(rowId);
		}
	}
	return unresolved.length === 0 ? { ok: true, ids } : { ok: false, unresolved };
}

/** One link cell that cannot be translated: which row, and which targets are unresolved. */
export type UnresolvedLink = { readonly rowId: string; readonly unresolved: readonly string[] };

/**
 * Every row whose link cell has at least one target with no entry in the row map. An empty result means the whole
 * field can be translated, and only then may the caller write it. The list is what a run refuses on, by name.
 */
export function unresolvedLinksOf(
	cells: readonly { readonly rowId: string; readonly targets: readonly string[] }[],
	rowMap: Readonly<Record<string, string>>,
): readonly UnresolvedLink[] {
	const out: UnresolvedLink[] = [];
	for (const cell of cells) {
		const translated = localLinksToRemote(cell.targets, rowMap);
		if (!translated.ok) {
			out.push({ rowId: cell.rowId, unresolved: translated.unresolved });
		}
	}
	return out;
}
