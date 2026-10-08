/**
 * The first row-to-record mapping for a native table (R5 Part C, Step 2: `rowId → remoteRecordId`).
 *
 * The sync engine never creates a remote record, and it reports a local row that has no record rather than inventing
 * one. So something must establish which local row *is* which remote record before the first sync. The spec does not
 * say how, so this is the decision, recorded in the R5 plan:
 *
 * - The user names one **key field**. A row and a record are linked only when the key value is the same on both sides
 *   **and** that value appears exactly once on each side.
 * - Everything else is left unlinked and reported with a reason: no key, no match, or ambiguous. Nothing is guessed,
 *   and nothing is created on either side.
 * - Comparison is exact after trimming the ends and collapsing runs of whitespace. Case is significant, so `Ada` and
 *   `ada` do not link. A looser match is a guess, and a wrong link would later receive writes.
 *
 * Pure: no network, no file access. The caller supplies the key values it read.
 */

export type LinkRow = { readonly rowId: string; readonly key: string | null };
export type LinkRecord = { readonly recordId: string; readonly key: string | null };

export type UnlinkedReason = 'no-key' | 'no-match' | 'ambiguous';

export type LinkPlan = {
	/** Local row ID → remote record ID, for the pairs that are unambiguous on both sides. */
	readonly rowMap: Readonly<Record<string, string>>;
	readonly unlinkedRows: readonly { readonly rowId: string; readonly reason: UnlinkedReason }[];
	readonly unlinkedRecords: readonly {
		readonly recordId: string;
		readonly reason: UnlinkedReason;
	}[];
};

/** The comparison form of a key: trimmed, with internal whitespace collapsed. `null` when nothing is left. */
export function normaliseKey(value: string | null): string | null {
	if (value === null) {
		return null;
	}
	const collapsed = value.trim().replace(/\s+/g, ' ');
	return collapsed === '' ? null : collapsed;
}

/** Links rows to records by one key, and reports every row and record it could not pair. */
export function linkRowsByKey(rows: readonly LinkRow[], records: readonly LinkRecord[]): LinkPlan {
	const rowCount = countKeys(rows.map((row) => normaliseKey(row.key)));
	const recordCount = countKeys(records.map((record) => normaliseKey(record.key)));

	const recordByKey = new Map<string, string>();
	for (const record of records) {
		const key = normaliseKey(record.key);
		if (key !== null && recordCount.get(key) === 1) {
			recordByKey.set(key, record.recordId);
		}
	}

	const rowMap: Record<string, string> = {};
	const linkedRecords = new Set<string>();
	const unlinkedRows: { rowId: string; reason: UnlinkedReason }[] = [];
	for (const row of rows) {
		const key = normaliseKey(row.key);
		if (key === null) {
			unlinkedRows.push({ rowId: row.rowId, reason: 'no-key' });
			continue;
		}
		if ((rowCount.get(key) ?? 0) > 1) {
			unlinkedRows.push({ rowId: row.rowId, reason: 'ambiguous' });
			continue;
		}
		const recordId = recordByKey.get(key);
		if (recordId === undefined) {
			unlinkedRows.push({
				rowId: row.rowId,
				reason: (recordCount.get(key) ?? 0) > 1 ? 'ambiguous' : 'no-match',
			});
			continue;
		}
		rowMap[row.rowId] = recordId;
		linkedRecords.add(recordId);
	}

	const unlinkedRecords: { recordId: string; reason: UnlinkedReason }[] = [];
	for (const record of records) {
		if (linkedRecords.has(record.recordId)) {
			continue;
		}
		const key = normaliseKey(record.key);
		if (key === null) {
			unlinkedRecords.push({ recordId: record.recordId, reason: 'no-key' });
		} else if ((recordCount.get(key) ?? 0) > 1) {
			unlinkedRecords.push({ recordId: record.recordId, reason: 'ambiguous' });
		} else {
			unlinkedRecords.push({
				recordId: record.recordId,
				reason: (rowCount.get(key) ?? 0) > 0 ? 'ambiguous' : 'no-match',
			});
		}
	}
	return { rowMap, unlinkedRows, unlinkedRecords };
}

function countKeys(keys: readonly (string | null)[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const key of keys) {
		if (key !== null) {
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	return counts;
}
