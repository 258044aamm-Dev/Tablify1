/**
 * The three-way diff: **what changed on each side since the last agreement, and what that means.**
 *
 * This is the file `docs/03` §Sync state is describing when it says: *"`local ≠ snapshot` means the vault changed;
 * `remote ≠ snapshot` means the remote side changed; both ⇒ a real conflict"*. Everything here follows from that one
 * sentence, plus the behaviour table in the section below it — reproduced here as the rule each verdict kind
 * implements, because the table is the specification and this file is where it stops being prose:
 *
 * | `docs/03` §Sync behaviour | Verdict | What happens |
 * |---|---|---|
 * | Only local changed | `local-only` | Pushed on the next push. |
 * | Only remote changed | `remote-only` | Offered on the next pull. |
 * | Both changed, different fields | (`local-only` + `remote-only` on different fields) | Merged per field, **no conflict promoted**. |
 * | Both changed, same field | `conflict` | Side by side; the person chooses per field. |
 * | Remote record missing | `remote-deleted` | Reported; the local note is **never** auto-deleted. |
 * | Local note missing | `local-deleted` | Reported; the remote record is **never** touched. |
 * | Field with no counterpart | (not a verdict — the caller's `skipped` list) | Skipped, reported once per sync. |
 * | The remote schema changed | `type-mismatch` when a value cannot be read | Reported; the mapping is never rewritten. |
 *
 * ## The four rules that make it safe
 *
 *  1. **A conflict can never resolve itself.** {@link planSync}'s output type has no default for a conflict, and
 *     {@link unresolvedConflicts} is what `applyPull` calls: a plan whose conflicts have no explicit choice applies
 *     **nothing**, rather than applying something a person did not choose. That is `docs/08` §P8 (*"per-field diff,
 *     never silent"*) enforced by control flow instead of by convention.
 *  2. **Deletions never propagate.** `local-deleted` and `remote-deleted` are `skip` + `report`, in both directions,
 *     because `docs/01` §Sync UX says a remote deletion is *"never silently deleted locally"* and the mirror case is
 *     worse: a note that moved or was renamed looks deleted, and deleting somebody's remote record on that evidence
 *     is data loss.
 *  3. **A first sync with no base is conservative.** With no snapshot hash there is no third column, so two
 *     different values cannot be attributed to either side — that is a `conflict` (ask), not a guess. Equal values,
 *     and a value only one side has, are still decided: those need no base.
 *  4. **Equal values cost nothing.** `both-same` is `skip` *and* `automatic`: it updates the snapshot and writes
 *     nothing, which is what keeps a provider's harmless re-formatting from opening a dialog.
 *
 * ## What is deliberately absent
 *
 * No I/O, no descriptors, no ops, no UI. Values arrive already canonicalised (the caller parsed remote values
 * through the column's descriptor — `values.ts`) and this file answers with verdicts. The only asynchronous thing
 * in it is `hashValue`, because `crypto.subtle` is.
 */
import { hashValue } from './hash';
import type { Snapshot } from './LinkStore';
import type { CellValue } from '../core/types';

/** The eight outcomes a field can have. The names are the behaviour table's, one row each. */
export type FieldVerdictKind =
	| 'unchanged'
	| 'local-only'
	| 'remote-only'
	| 'both-same'
	| 'conflict'
	| 'local-deleted'
	| 'remote-deleted'
	| 'type-mismatch';

/** What a verdict asks the caller to do. Only `write-local` and `write-remote` write anything. */
export type FieldOutcome = 'skip' | 'write-local' | 'write-remote' | 'ask';

/**
 * A conflict's resolution. **There is no `null` member and no default**, so a caller cannot express *"leave it
 * undecided"* here — an undecided conflict is the absence of an entry in the book, which
 * {@link unresolvedConflicts} reports by name.
 */
export type ConflictResolution = { readonly kind: 'local' } | { readonly kind: 'remote' };

/** What a person chose, keyed by {@link fieldKey}. Built from the review dialog's per-field choices. */
export type ResolutionBook = ReadonlyMap<string, ConflictResolution>;

/** What one field's comparison needs. Local and remote values are already canonical; nothing here parses. */
export type DiffFieldInput = {
	/** The local property name — the key in the link file's `fieldMap`. */
	readonly property: string;
	/** The remote field id, or `null` when this column has no counterpart (a `skipped` entry, not a verdict). */
	readonly remoteFieldId: string | null;
	readonly local: CellValue;
	/** The remote value in local canonical form, or `undefined` when it could not be parsed. */
	readonly remote: CellValue | undefined;
	/** The provider's own value, verbatim — what the review dialog shows beside the local one. */
	readonly remoteRaw: unknown;
	/** The sentence explaining why `remote` is `undefined`, when it is. */
	readonly typeProblem: string | null;
	/**
	 * True when the provider **did not return** this record on an incremental read.
	 *
	 * `LAST_MODIFIED_TIME()` only answers with records that changed, so an absent linked record is *unchanged
	 * remotely* — which is information, not a gap: the remote value equals the last agreed one, so only the local
	 * side can have moved. The row is then compared against the snapshot alone and the possible verdicts collapse to
	 * `unchanged` or `local-only`. `remote` is still filled in for display, and it is the **local** value, because
	 * that is what the remote side holds.
	 */
	readonly remoteUnchanged?: boolean;
};

/** One row's comparison. `localPresent`/`remotePresent` are what make a deletion a deletion rather than an empty. */
export type DiffRecordInput = {
	/** The local note path: the row and the `recordMap` key. */
	readonly path: string;
	/** The linked remote record id, or `null` when this note was never linked. */
	readonly recordId: string | null;
	/** Human-facing label for the review dialog and the report. */
	readonly label: string;
	readonly localPresent: boolean;
	readonly remotePresent: boolean;
	readonly fields: readonly DiffFieldInput[];
};

/** A remote record, as the diff needs it: its id and whether the provider still returns it. */
export type DiffRemoteInput = {
	readonly recordId: string;
	readonly present: boolean;
};

export type DiffInput = {
	readonly records: readonly DiffRecordInput[];
	/** The snapshot from the link file: record id → remote field id → the last agreed hash. */
	readonly snapshot: Snapshot;
	/**
	 * The remote field ids that carry a stored hash, so the base column can be read. Missing ⇒ *"never agreed"*,
	 * which rule 3 above treats conservatively.
	 */
};

/** One field's verdict, with everything a report or a dialog needs to phrase it. */
export type FieldVerdict = {
	readonly kind: FieldVerdictKind;
	readonly property: string;
	readonly remoteFieldId: string | null;
	/** Canonical local value; `null` when the cell is empty. */
	readonly local: CellValue;
	/** The provider's verbatim value, for the "what arrived" column. */
	readonly remoteRaw: unknown;
	/** Canonical remote value when it parsed; `undefined` when it did not (see `type-mismatch`). */
	readonly remote: CellValue | undefined;
	/** The value both sides agree on, for `both-same` and `unchanged`; `null` otherwise. */
	readonly agreed: CellValue;
	/** The sentence from `values.ts` when the remote value could not be read; empty otherwise. */
	readonly problem: string;
	/** What to do about it without asking. `ask` is the only value that requires a person. */
	readonly outcome: FieldOutcome;
	/** True when this verdict needs no decision — the reason the review dialog stays empty on a clean sync. */
	readonly automatic: boolean;
	/** The stored base hash, when there was one. A report can show it; nothing decides from it after this. */
	readonly baseHash: string | null;
	readonly localHash: string;
	readonly remoteHash: string;
};

/** One row's verdicts, plus the counts a plan needs. */
export type RecordVerdict = {
	readonly path: string;
	readonly recordId: string | null;
	readonly label: string;
	/** `matched` when both sides are there; the other two are the deleted-record cases. */
	readonly kind: 'matched' | 'local-missing' | 'remote-missing';
	readonly fields: readonly FieldVerdict[];
	/** The verdicts that write **locally** (pull), write **remotely** (push), and need a choice. */
	readonly pull: readonly FieldVerdict[];
	readonly push: readonly FieldVerdict[];
	readonly conflicts: readonly FieldVerdict[];
	readonly skipped: readonly FieldVerdict[];
};

/** Everything the diff found, in one object: rows, the report's totals, and the conflicts by key. */
export type SyncDiff = {
	readonly records: readonly RecordVerdict[];
	/** Verdicts by kind, across every row — the numbers the panel prints. */
	readonly counts: Readonly<Record<FieldVerdictKind, number>>;
	/** Every conflict in the diff, in row order then field order: what the review dialog lists. */
	readonly conflicts: readonly { readonly record: RecordVerdict; readonly field: FieldVerdict }[];
	/** Rows whose note or record is missing on one side, for the report's "left alone" line. */
	readonly missing: readonly RecordVerdict[];
};

/** The stable key a conflict is resolved by: one record and one property. Exported so a dialog and a plan agree. */
export function fieldKey(recordId: string | null, property: string): string {
	return `${recordId ?? ''}\u0000${property}`;
}

/** Every kind, so `counts` always has all eight keys (a report must not print `undefined`). */
const KINDS: readonly FieldVerdictKind[] = [
	'unchanged',
	'local-only',
	'remote-only',
	'both-same',
	'conflict',
	'local-deleted',
	'remote-deleted',
	'type-mismatch',
];

/**
 * One field's verdict.
 *
 * Split out from the row walk because this is the rule table, and a rule table is easier to trust when each branch
 * is one line. Every branch that writes something is marked `automatic`; the two failures (`conflict`,
 * `type-mismatch`) and the two deletions never are.
 */
function verdictOf(input: {
	field: DiffFieldInput;
	baseHash: string | null;
	localHash: string;
	remoteHash: string;
	localPresent: boolean;
	remotePresent: boolean;
}): FieldVerdict {
	const { field, baseHash, localHash, remoteHash } = input;
	const shared = {
		property: field.property,
		remoteFieldId: field.remoteFieldId,
		local: field.local,
		remoteRaw: field.remoteRaw,
		remote: field.remote,
		baseHash,
		localHash,
		remoteHash,
	};
	const verdict = (kind: FieldVerdictKind, agreed: CellValue, problem = ''): FieldVerdict => {
		const outcome: FieldOutcome =
			kind === 'local-only'
				? 'write-remote'
				: kind === 'remote-only'
					? 'write-local'
					: kind === 'conflict'
						? 'ask'
						: 'skip';
		return {
			...shared,
			kind,
			agreed,
			problem,
			outcome,
			automatic:
				outcome !== 'ask' &&
				kind !== 'local-deleted' &&
				kind !== 'remote-deleted' &&
				kind !== 'type-mismatch',
		};
	};

	// Rule 2: deletions are reported, never propagated — in either direction, whatever the hashes say.
	if (!input.localPresent) {
		return verdict('local-deleted', field.local);
	}
	if (!input.remotePresent) {
		return verdict('remote-deleted', field.local);
	}
	// A value the column cannot read is not an edit: it is a schema problem, and the mapping is not rewritten.
	if (field.remote === undefined) {
		return verdict(
			'type-mismatch',
			field.local,
			field.typeProblem ?? 'the remote value could not be read',
		);
	}
	// The provider returned nothing about this record, so the remote side is the agreement: only the vault moved.
	if (field.remoteUnchanged === true) {
		return baseHash === null
			? verdict(
					'type-mismatch',
					field.local,
					'the record was not returned by this read and no agreement is stored',
				)
			: verdict(localHash === baseHash ? 'unchanged' : 'local-only', field.local);
	}

	if (localHash === remoteHash) {
		// Rule 4: equal values cost nothing. `both-same` needs a base to mean anything — *"both sides moved to the
		// same value"* — so with no stored agreement this is simply `unchanged`: nothing happened at all.
		return verdict(
			baseHash === localHash || baseHash === null ? 'unchanged' : 'both-same',
			field.local,
		);
	}
	if (baseHash === null) {
		// Rule 3, refined, because the two directions are not equally safe. Without an agreement:
		//   · **filling an empty local cell** loses nothing — the remote value is the only information there is,
		//     and an empty cell is not somebody's work — so it is pulled;
		//   · **emptying a cell that holds something** (whichever side) could destroy a value a person typed, and
		//     nothing in the link file says who removed it, so it asks.
		if (field.local === null && (field.remote ?? null) !== null) {
			return verdict('remote-only', field.remote === undefined ? null : field.remote);
		}
		return verdict('conflict', field.local);
	}
	if (localHash === baseHash) {
		// `field.remote` is defined on every path that reaches here: the two guards above send an unreadable or
		// unknown remote value to their own verdicts first.
		return verdict('remote-only', field.remote === undefined ? field.local : field.remote);
	}
	if (remoteHash === baseHash) {
		return verdict('local-only', field.local);
	}
	return verdict('conflict', field.local);
}

/** The snapshot hash for one record and field, or `null` when this record/field was never agreed. */
function baseHashFor(
	snapshot: Snapshot,
	recordId: string | null,
	remoteFieldId: string | null,
): string | null {
	if (recordId === null || remoteFieldId === null) {
		return null;
	}
	return snapshot[recordId]?.[remoteFieldId] ?? null;
}

/**
 * The whole diff: every row, every field, in one pass.
 *
 * Asynchronous because hashing is (`crypto.subtle`), and hashing is how the three-way comparison stays cheap:
 * one digest per value per sync rather than a stored copy of every agreed value.
 */
export async function diffSync(input: DiffInput): Promise<SyncDiff> {
	const counts: Record<FieldVerdictKind, number> = {
		unchanged: 0,
		'local-only': 0,
		'remote-only': 0,
		'both-same': 0,
		conflict: 0,
		'local-deleted': 0,
		'remote-deleted': 0,
		'type-mismatch': 0,
	};
	const records: RecordVerdict[] = [];
	const conflicts: { record: RecordVerdict; field: FieldVerdict }[] = [];
	const missing: RecordVerdict[] = [];

	for (const record of input.records) {
		const fields: FieldVerdict[] = [];
		for (const field of record.fields) {
			const baseHash = baseHashFor(input.snapshot, record.recordId, field.remoteFieldId);
			const localHash = await hashValue(field.local ?? null);
			const remoteHash =
				field.remote === undefined ? '' : await hashValue(field.remote ?? null);
			const verdict = verdictOf({
				field,
				baseHash,
				localHash,
				remoteHash,
				localPresent: record.localPresent,
				remotePresent: record.remotePresent,
			});
			fields.push(verdict);
			counts[verdict.kind] += 1;
		}
		const kind: RecordVerdict['kind'] = !record.localPresent
			? 'local-missing'
			: !record.remotePresent
				? 'remote-missing'
				: 'matched';
		const row: RecordVerdict = {
			path: record.path,
			recordId: record.recordId,
			label: record.label,
			kind,
			fields,
			pull: fields.filter((field) => field.outcome === 'write-local'),
			push: fields.filter((field) => field.outcome === 'write-remote'),
			conflicts: fields.filter((field) => field.kind === 'conflict'),
			skipped: fields.filter(
				(field) => field.outcome === 'skip' && field.kind !== 'unchanged',
			),
		};
		records.push(row);
		for (const field of row.conflicts) {
			conflicts.push({ record: row, field });
		}
		if (kind !== 'matched') {
			missing.push(row);
		}
	}

	return { records, counts, conflicts, missing };
}

/**
 * What a plan cannot write until somebody chooses: one entry per unresolved conflict, by record and property.
 *
 * The dialog renders this list; `applyPull` refuses on it. Returning the *names* rather than a boolean is what
 * lets the refusal say which fields are waiting — a count is not a reason.
 */
export function unresolvedConflicts(
	conflicts: readonly { readonly record: RecordVerdict; readonly field: FieldVerdict }[],
	choices: ResolutionBook,
): readonly {
	readonly recordId: string | null;
	readonly path: string;
	readonly label: string;
	readonly property: string;
}[] {
	const waiting: { recordId: string | null; path: string; label: string; property: string }[] =
		[];
	for (const { record, field } of conflicts) {
		if (!choices.has(fieldKey(record.recordId, field.property))) {
			waiting.push({
				recordId: record.recordId,
				path: record.path,
				label: record.label,
				property: field.property,
			});
		}
	}
	return waiting;
}

/** The verdicts a book *does* resolve, so the dialog's "what will be written" count is computed from the book. */
export function resolvedConflicts(
	conflicts: readonly { readonly record: RecordVerdict; readonly field: FieldVerdict }[],
	choices: ResolutionBook,
): readonly {
	readonly record: RecordVerdict;
	readonly field: FieldVerdict;
	readonly choice: ConflictResolution;
}[] {
	const resolved: { record: RecordVerdict; field: FieldVerdict; choice: ConflictResolution }[] =
		[];
	for (const entry of conflicts) {
		const choice = choices.get(fieldKey(entry.record.recordId, entry.field.property));
		if (choice !== undefined) {
			resolved.push({ ...entry, choice });
		}
	}
	return resolved;
}

/** The eight kinds, in report order. Exported so a UI can iterate them without repeating the list. */
export function verdictKinds(): readonly FieldVerdictKind[] {
	return KINDS;
}

/** One line for a report: `3 unchanged · 2 remote-only · 1 conflict`. Empty kinds are left out. */
export function describeCounts(counts: Readonly<Record<FieldVerdictKind, number>>): string {
	const parts: string[] = [];
	for (const kind of KINDS) {
		const count = counts[kind];
		if (count > 0) {
			parts.push(`${String(count)} ${kind}`);
		}
	}
	return parts.length === 0 ? 'nothing to compare' : parts.join(' · ');
}
