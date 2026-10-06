/**
 * The engine: **plan first, write second, and report exactly what happened.**
 *
 * `docs/02` §Sync gives the pipeline in one line — pull is *"records → per-field diff against local values → user
 * decision → ops"*, push is *"local values → batch endpoints in chunks of 10 with retry/backoff"* — and the whole
 * of this file is that sentence, with the plan as a first-class object rather than a side effect of applying:
 *
 * ```
 *   planSync()          →  what would change, where, and what needs a person
 *   applyPull()         →  the local half, as **one** undo step, with a stale check per cell
 *   applyPush()         →  the remote half, chunked by the client, per-record outcomes
 *   runSync()           →  the two together, plus the new snapshot and the link document
 * ```
 *
 * Four decisions are worth stating up front, because each one closes a way this could lose somebody's data:
 *
 *  1. **Nothing is written until the plan exists, and the plan is what the UI shows.** The panel's button reads
 *     *"Pull 12 notes · 40 fields"* because that count is already computed; if the number were computed while
 *     writing, the button would be estimating.
 *  2. **A conflict that has no choice blocks the whole pull.** `applyPull` calls `unresolvedConflicts` first and
 *     returns a report saying which fields are waiting — so *"opening the dialog and pressing the primary action"*
 *     is not merely discouraged, it is impossible (`docs/08` §P8).
 *  3. **Every local write is re-checked against the plan's own `from` hash.** A note edited between the plan and
 *     the apply is not overwritten: the cell is reported as `stale` and left exactly as the person typed it. That
 *     is the *"external change during a pull"* case, and it is a per-cell rule rather than a per-run one.
 *  4. **A partial remote read never authorises a push.** If the pull came back `truncated`, or if it was an
 *     incremental read (`since` set, so an absent record means *"unchanged or deleted"* rather than *"deleted"*),
 *     the plan says so: `remote-deleted` is only reported for a **full** read, and pushes are held back when the
 *     remote picture is incomplete, because pushing onto a partial picture is how an unnoticed remote edit gets
 *     overwritten.
 *
 * ## The one row `docs/03` §Sync behaviour does not describe
 *
 * A **new local note with no linked record**. The behaviour table has no row for it, the port has no `create`, and
 * `docs/01` §Sync UX says push never creates fields — so the engine does the only honest thing: it **skips and
 * reports** the row, naming it, and never invents a remote record. This is a documented gap filled conservatively
 * rather than a feature: if creating remote records is ever wanted, it is a new verb on the port and a new row in
 * the table, not a branch hidden in here.
 */
import { diffSync, resolvedConflicts, unresolvedConflicts } from './diff';
import { hashValue } from './hash';
import { localToRemote, remoteToLocal } from './values';
import { errorText, SyncFailure } from './SyncTarget';
import type {
	ConflictResolution,
	DiffFieldInput,
	DiffRecordInput,
	FieldVerdict,
	RecordVerdict,
	ResolutionBook,
	SyncDiff,
} from './diff';
import type { Snapshot } from './LinkStore';
import type { RemoteRecord, SyncTarget, UnmappedField } from './SyncTarget';
import type { ResolvedField } from '../core/schema/propertySchema';
import type { ApplyResult } from '../adapters/RowSource';
import type { CellValue, PropertyId } from '../core/types';
import type { Op } from '../core/ops/types';

/** One local row, as the engine needs it: an id, a label, and its values by **local property name**. */
export type SyncLocalRow = {
	readonly path: string;
	readonly label: string;
};

/**
 * What the engine needs of a local surface. Five methods, none of which mention a provider, Bases or Obsidian — the
 * live grid (`TablifyView`'s store) and the vault-backed host (`plugin/sync/local.ts`) both satisfy it, and the
 * tests use a fake.
 */
export type SyncLocalPort = {
	/** Every row the view holds, in view order. */
	rows(): Promise<readonly SyncLocalRow[]>;
	/** Whether the note is still there. A deleted note is `false`, not an error. */
	has(path: string): Promise<boolean>;
	/** One row's canonical values, keyed by local property name. Missing properties are simply absent. */
	values(path: string): Promise<Readonly<Record<string, CellValue>>>;
	/** The id an op must carry for a property name (`note.Status` in a Bases view). */
	propertyIdOf(property: string): PropertyId;
	/** One user action: ops applied, **one** undo step, one write-queue batch. */
	apply(action: { readonly label: string; readonly ops: readonly Op[] }): Promise<ApplyResult>;
};

/** One cell the pull will write. `from`/`to` are the values, so an undo needs nothing else. */
export type PlannedPull = {
	readonly path: string;
	readonly label: string;
	readonly recordId: string;
	readonly property: string;
	readonly remoteFieldId: string;
	readonly from: CellValue;
	readonly fromHash: string;
	readonly to: CellValue;
};

/** One cell the push will write. `to` is already in the provider's own vocabulary (`values.ts`). */
export type PlannedPush = {
	readonly path: string;
	readonly label: string;
	readonly recordId: string;
	readonly property: string;
	readonly remoteFieldId: string;
	readonly from: CellValue;
	readonly to: unknown;
};

/** One conflict, with everything the review dialog needs to show it, display text included. */
export type PlannedConflict = {
	readonly recordId: string;
	readonly path: string;
	readonly label: string;
	readonly property: string;
	readonly remoteFieldId: string;
	readonly local: CellValue;
	readonly remote: CellValue;
	/** What the person sees: local and remote, in the column's own rendering. */
	readonly localText: string;
	readonly remoteText: string;
	/**
	 * Whether each side differs from the **last agreement**, derived from the stored hashes.
	 *
	 * There is no base *value* to show, and that is a property of the design rather than an omission: `docs/03`
	 * §Sync state stores `sha256:…` per field, not the agreed value, precisely so a link file cannot become a second
	 * copy of the vault. What the hashes can answer is which side moved — and on a conflict both did, which is what
	 * the dialog states above the two values instead of inventing a third one.
	 */
	readonly movedLocally: boolean;
	readonly movedRemotely: boolean;
};

/** Why something was left alone. One sentence per entry, and never a silent skip. */
export type SyncSkipReason =
	'no-counterpart' | 'no-record' | 'type-mismatch' | 'deleted' | 'unknown-remote';

export type PlannedSyncSkip = {
	readonly reason: SyncSkipReason;
	readonly path: string | null;
	readonly label: string | null;
	readonly property: string | null;
	readonly detail: string;
};

/** The plan's numbers. The panel prints these; the engine never recomputes them while writing. */
export type PlanCounts = {
	/** Rows the plan would touch, in either direction. */
	readonly rows: number;
	/** Cells written in total (`pullFields + pushFields`, plus the conflicts that resolve to a write). */
	readonly cells: number;
	readonly pullRecords: number;
	readonly pullFields: number;
	readonly pushRecords: number;
	readonly pushFields: number;
	readonly conflicts: number;
	readonly skipped: number;
	readonly missing: number;
};

export type SyncPlan = {
	readonly pull: readonly PlannedPull[];
	readonly push: readonly PlannedPush[];
	readonly conflicts: readonly PlannedConflict[];
	readonly skipped: readonly PlannedSyncSkip[];
	readonly counts: PlanCounts;
	readonly diff: SyncDiff;
	/** False when a person (or an incomplete remote read) has to act before anything may be written. */
	readonly ready: boolean;
	/** One sentence when `ready` is false. Never empty in that case. */
	readonly blocked: string | null;
};

/** What `applyPull` did. `stale` and `blocked` are the two refusals, and both carry names rather than counts. */
export type PullReport = {
	readonly ok: boolean;
	/** Paths whose cells now hold a remote value. */
	readonly applied: readonly string[];
	readonly written: number;
	/** Cells left alone because the local value changed since the plan was made. */
	readonly stale: readonly {
		readonly path: string;
		readonly property: string;
		readonly detail: string;
	}[];
	/** The conflicts still waiting for a choice; non-empty means nothing was written at all. */
	readonly blocked: readonly {
		readonly recordId: string | null;
		readonly path: string;
		readonly label: string;
		readonly property: string;
	}[];
	/** What the source itself refused or failed, passed through rather than summarised away. */
	readonly refused: number;
	readonly errors: readonly { readonly path: string; readonly message: string }[];
	readonly label: string;
};

/** What `applyPush` did. Per record, because *"which records failed"* is the question a person asks. */
export type PushReport = {
	readonly ok: boolean;
	readonly accepted: number;
	readonly failed: readonly { readonly recordId: string; readonly reason: string }[];
	/** `null` when nothing was sent: the link file must not stamp a push that did not happen. */
	readonly pushedAt: string | null;
	/** Cells this run sent, so the report can state the write shape. */
	readonly sent: readonly PlannedPush[];
	/**
	 * The records the provider **accepted** — not the ones that were sent.
	 *
	 * The distinction is the whole reason this field exists: the snapshot records what both sides now agree on, and
	 * a record the provider refused is not agreed on. Counting `sent` would make the next sync believe a value had
	 * landed and never try again, which is the quietest way this feature could lose data.
	 */
	readonly acceptedIds: readonly string[];
};

/** The whole of a sync run: what was planned, what was written where, and the snapshot to store. */
export type SyncReport = {
	readonly plan: SyncPlan;
	readonly pull: PullReport | null;
	readonly push: PushReport | null;
	readonly snapshot: Snapshot;
	/** One sentence for a Notice or the status bar. */
	readonly summary: string;
	readonly ok: boolean;
};

/** Which halves of a run to perform. `pull` and `push` are the two buttons; `both` is the "sync now" path. */
export type SyncDirection = 'pull' | 'push' | 'both';

export type PlanInput = {
	readonly local: SyncLocalPort;
	/** The local columns, for reading a remote value and writing a local one. `definition.name` is the key. */
	readonly fields: readonly ResolvedField[];
	/** Local property name → remote field id, from the link file. */
	readonly fieldMap: Readonly<Record<string, string>>;
	/** Local note path → remote record id. A row absent from this map has no record (and is reported, not created). */
	readonly recordMap: Readonly<Record<string, string>>;
	/** The last agreed hashes from the link file. */
	readonly snapshot: Snapshot;
	/** What the pull returned: **only the records the provider considers modified**, or every record on a full read. */
	readonly records: readonly RemoteRecord[];
	/** True when the read was complete (no `since`), so an absent linked record really was deleted remotely. */
	readonly full: boolean;
	/** True when the read hit the client's page cap: the remote picture is incomplete, so pushes are held back. */
	readonly truncated: boolean;
	/** The remote fields with no local counterpart and the local properties with none — reported once per sync. */
	readonly unmapped: readonly UnmappedField[];
};

/**
 * The plan. Read-only in the strong sense: it performs no writes, holds no port it could write with, and its
 * output can be rendered by a dialog, compared in a test and thrown away without a side effect.
 */
export async function planSync(input: PlanInput): Promise<SyncPlan> {
	const byName = new Map(input.fields.map((field) => [field.definition.name, field]));
	const localRows = await input.local.rows();
	const remoteById = new Map(input.records.map((record) => [record.id, record]));

	const records: DiffRecordInput[] = [];
	const skipped: PlannedSyncSkip[] = [];

	for (const row of localRows) {
		const recordId = input.recordMap[row.path] ?? null;
		const values = await input.local.values(row.path);
		const localPresent = await input.local.has(row.path);
		if (recordId === null) {
			// The gap this file's header describes: a row with no linked record is reported, never created.
			skipped.push({
				reason: 'no-record',
				path: row.path,
				label: row.label,
				property: null,
				detail: `${row.label} has no linked record — Tablify never creates remote records (docs/01 §Sync UX).`,
			});
			continue;
		}
		const remote = remoteById.get(recordId);
		if (remote === undefined) {
			// Not in the pull's answer. On a **full** read that means the record is gone from the provider; on an
			// incremental read it means "unchanged", and the row is compared against the snapshot only.
			if (input.full) {
				records.push(
					recordInput({
						row,
						recordId,
						values,
						fields: input.fields,
						fieldMap: input.fieldMap,
						localPresent,
						remotePresent: false,
						remote: null,
					}),
				);
				continue;
			}
			records.push(
				deferredRecordInput({
					row,
					recordId,
					values,
					fields: input.fields,
					fieldMap: input.fieldMap,
					snapshot: input.snapshot,
					localPresent,
				}),
			);
			continue;
		}
		records.push(
			recordInput({
				row,
				recordId,
				values,
				fields: input.fields,
				fieldMap: input.fieldMap,
				localPresent,
				remotePresent: true,
				remote,
			}),
		);
	}

	// Local properties with no counterpart, and remote fields nobody maps: one entry each, per sync, not per row.
	for (const field of input.unmapped) {
		skipped.push({
			reason: 'no-counterpart',
			path: null,
			label: null,
			property: field.name,
			detail:
				field.side === 'local'
					? `“${field.name}” has no remote field — it is skipped (docs/08 §P9).`
					: `“${field.name}” has no local column — it is skipped.`,
		});
	}

	const diff = await diffSync({ records, snapshot: input.snapshot });
	const pull: PlannedPull[] = [];
	const push: PlannedPush[] = [];
	const conflicts: PlannedConflict[] = [];

	for (const record of diff.records) {
		for (const verdict of record.fields) {
			const field = byName.get(verdict.property);
			if (field === undefined || verdict.remoteFieldId === null) {
				continue;
			}
			if (record.recordId === null) {
				// Every row that reaches the diff has a record: a note with none was skipped above.
				continue;
			}
			if (verdict.outcome === 'write-local' && verdict.remote !== undefined) {
				pull.push({
					path: record.path,
					label: record.label,
					recordId: record.recordId,
					property: verdict.property,
					remoteFieldId: verdict.remoteFieldId,
					from: verdict.local,
					fromHash: verdict.localHash,
					to: verdict.remote,
				});
			}
			if (verdict.outcome === 'write-remote') {
				push.push({
					path: record.path,
					label: record.label,
					recordId: record.recordId,
					property: verdict.property,
					remoteFieldId: verdict.remoteFieldId,
					from: verdict.local,
					to: localToRemote(field, verdict.local),
				});
			}
			if (
				verdict.kind === 'conflict' &&
				verdict.remote !== undefined &&
				record.recordId !== null
			) {
				conflicts.push({
					recordId: record.recordId,
					path: record.path,
					label: record.label,
					property: verdict.property,
					remoteFieldId: verdict.remoteFieldId,
					local: verdict.local,
					remote: verdict.remote,
					localText: render(field, verdict.local),
					remoteText: render(field, verdict.remote),
					// A conflict is only reported when both sides moved (or when there is no agreement at all, in which
					// case neither can be attributed and both flags are honest at `true`).
					movedLocally:
						verdict.baseHash === null || verdict.localHash !== verdict.baseHash,
					movedRemotely:
						verdict.baseHash === null || verdict.remoteHash !== verdict.baseHash,
				});
			}
			if (verdict.kind === 'type-mismatch') {
				skipped.push({
					reason: 'type-mismatch',
					path: record.path,
					label: record.label,
					property: verdict.property,
					detail: `“${verdict.property}” could not be read from the remote value: ${verdict.problem}`,
				});
			}
		}
		if (record.kind === 'remote-missing') {
			skipped.push({
				reason: 'deleted',
				path: record.path,
				label: record.label,
				property: null,
				detail: `${record.label} was deleted in the remote table — the local note is left alone (docs/01 §Sync UX).`,
			});
		}
		if (record.kind === 'local-missing') {
			skipped.push({
				reason: 'deleted',
				path: record.path,
				label: record.label,
				property: null,
				detail: `${record.label} is no longer in the vault — the remote record is left untouched.`,
			});
		}
	}

	const rows = new Set<string>([
		...pull.map((write) => write.path),
		...push.map((write) => write.path),
		...conflicts.map((entry) => entry.path),
	]);
	const counts: PlanCounts = {
		rows: rows.size,
		cells: pull.length + push.length,
		pullRecords: new Set(pull.map((write) => write.recordId)).size,
		pullFields: pull.length,
		pushRecords: new Set(push.map((write) => write.recordId)).size,
		pushFields: push.length,
		conflicts: conflicts.length,
		skipped: skipped.length,
		missing: diff.missing.length,
	};

	const blocked = blockedReason({
		truncated: input.truncated,
		conflicts: conflicts.length,
		pushes: push.length,
	});
	return {
		pull,
		push,
		conflicts,
		skipped,
		counts,
		diff,
		ready: blocked === null,
		blocked,
	};
}

/** The reason a plan is not ready, or `null`. One place, so the dialog and the engine cannot disagree. */
function blockedReason(input: {
	truncated: boolean;
	conflicts: number;
	pushes: number;
}): string | null {
	if (input.truncated) {
		return 'The remote read stopped at the page cap, so part of the table was not seen. Nothing is written until a complete read succeeds.';
	}
	if (input.conflicts > 0) {
		return `${String(input.conflicts)} field(s) changed on both sides — each one needs a choice before anything is written.`;
	}
	return null;
}

/** A field's value as the column renders it, for a dialog. The descriptor owns the wording; this only guards it. */
function render(field: ResolvedField, value: CellValue): string {
	const text = field.descriptor.formatDisplay(value, field.context);
	return text === '' ? '(empty)' : text;
}

/** A fully-observed record: the provider returned it, so every field has a remote value to compare against. */
function recordInput(input: {
	row: SyncLocalRow;
	recordId: string;
	values: Readonly<Record<string, CellValue>>;
	fields: readonly ResolvedField[];
	fieldMap: Readonly<Record<string, string>>;
	localPresent: boolean;
	remotePresent: boolean;
	remote: RemoteRecord | null;
}): DiffRecordInput {
	const fields: DiffFieldInput[] = [];
	for (const field of input.fields) {
		const property = field.definition.name;
		const remoteFieldId = input.fieldMap[property] ?? null;
		if (remoteFieldId === null) {
			continue;
		}
		const raw = input.remote === null ? undefined : input.remote.fields[remoteFieldId];
		const parsed = input.remote === null ? null : remoteToLocal(field, remoteFieldId, raw);
		fields.push({
			property,
			remoteFieldId,
			local: input.values[property] ?? null,
			remote: parsed !== null && parsed.ok ? parsed.value : undefined,
			remoteRaw: raw ?? null,
			typeProblem: parsed !== null && !parsed.ok ? parsed.problem.message : null,
		});
	}
	return {
		path: input.row.path,
		recordId: input.recordId,
		label: input.row.label,
		localPresent: input.localPresent,
		remotePresent: input.remotePresent,
		fields,
	};
}

/**
 * A record the incremental read did not return: **unchanged remotely**, by the definition of the cursor it was
 * read with.
 *
 * `LAST_MODIFIED_TIME() > since` answers with the records that changed, so absence means the remote side still
 * holds the last agreed value. That is a fact the diff can use — {@link DiffFieldInput.remoteUnchanged} — and it
 * collapses this row's possible verdicts to `unchanged` and `local-only`, which is what makes a push safe without
 * reading the whole table. The one case it cannot serve is a row with **no stored agreement** (a link file whose
 * snapshot was lost, or a record mapped by hand): there the remote value is genuinely unknown, and the row is
 * reported through `type-mismatch`'s sentence rather than pushed on a guess.
 */
function deferredRecordInput(input: {
	row: SyncLocalRow;
	recordId: string;
	values: Readonly<Record<string, CellValue>>;
	fields: readonly ResolvedField[];
	fieldMap: Readonly<Record<string, string>>;
	snapshot: Snapshot;
	localPresent: boolean;
}): DiffRecordInput {
	const fields: DiffFieldInput[] = [];
	for (const field of input.fields) {
		const property = field.definition.name;
		const remoteFieldId = input.fieldMap[property] ?? null;
		if (remoteFieldId === null) {
			continue;
		}
		const local = input.values[property] ?? null;
		const baseHash = input.snapshot[input.recordId]?.[remoteFieldId] ?? null;
		fields.push({
			property,
			remoteFieldId,
			local,
			remote: baseHash === null ? undefined : local,
			remoteRaw: null,
			typeProblem: null,
			remoteUnchanged: baseHash !== null,
		});
	}
	return {
		path: input.row.path,
		recordId: input.recordId,
		label: input.row.label,
		localPresent: input.localPresent,
		// Present: the record exists. The provider simply had nothing to report about it.
		remotePresent: true,
		fields,
	};
}

/**
 * The pull's local half: **one** undo step, or nothing at all.
 *
 * Order of business, all of it before the first write:
 *   1. refuse if any conflict is unresolved — the report names the fields, and no `apply` is called;
 *   2. re-read every affected row and drop the writes whose `from` hash no longer matches (rule 3 in the header);
 *   3. build `setCells` ops — one per cell, wrapped in **one** `dispatch` so a 40-field pull is one undo step.
 *
 * A conflict resolved to `remote` is pulled; resolved to `local` it becomes a push (`applyPush` reads the book the
 * same way), so no choice is ever silently both or neither.
 */
export async function applyPull(input: {
	readonly plan: SyncPlan;
	readonly local: SyncLocalPort;
	readonly choices: ResolutionBook;
	readonly label?: string | undefined;
}): Promise<PullReport> {
	const blocked = unresolvedConflicts(input.plan.diff.conflicts, input.choices);
	const resolved = resolvedConflicts(input.plan.diff.conflicts, input.choices);
	const writes: PlannedPull[] = [...input.plan.pull];
	for (const entry of resolved) {
		if (
			entry.choice.kind === 'remote' &&
			entry.record.recordId !== null &&
			entry.field.remote !== undefined
		) {
			writes.push({
				path: entry.record.path,
				label: entry.record.label,
				recordId: entry.record.recordId,
				property: entry.field.property,
				remoteFieldId: entry.field.remoteFieldId ?? '',
				from: entry.field.local,
				fromHash: entry.field.localHash,
				to: entry.field.remote,
			});
		}
	}
	// The label describes the writes about to be attempted — the plan's own, plus the conflicts resolved to
	// `remote` — so the undo step's name matches the cells it will actually hold.
	const label = input.label ?? labelFor(writes);
	if (blocked.length > 0) {
		return {
			ok: false,
			applied: [],
			written: 0,
			stale: [],
			blocked,
			refused: 0,
			errors: [],
			label,
		};
	}
	if (writes.length === 0) {
		return {
			ok: true,
			applied: [],
			written: 0,
			stale: [],
			blocked: [],
			refused: 0,
			errors: [],
			label,
		};
	}

	// Rule 3: the plan's `from` hash is the promise that nobody typed into this cell while the plan was on screen.
	const current = new Map<string, Readonly<Record<string, CellValue>>>();
	const stale: { path: string; property: string; detail: string }[] = [];
	const fresh: PlannedPull[] = [];
	for (const write of writes) {
		let values = current.get(write.path);
		if (values === undefined) {
			values = await input.local.values(write.path);
			current.set(write.path, values);
		}
		const now = values[write.property] ?? null;
		const nowHash = await hashValue(now);
		// Strict by design: if the bytes changed, the person's edit wins and the remote value is not written. A
		// tolerant comparison (rendering, say) would overwrite an edit that happened to look the same.
		if (nowHash !== write.fromHash) {
			stale.push({
				path: write.path,
				property: write.property,
				detail: `${write.label} › ${write.property} changed in the vault while the pull was being reviewed, so the remote value was not written.`,
			});
			continue;
		}
		fresh.push(write);
	}

	if (fresh.length === 0) {
		return {
			ok: true,
			applied: [],
			written: 0,
			stale,
			blocked: [],
			refused: 0,
			errors: [],
			label,
		};
	}

	const ops: Op[] = [
		{
			kind: 'setCells',
			writes: fresh.map((write) => ({
				filePath: write.path,
				fieldId: input.local.propertyIdOf(write.property),
				value: write.to,
			})),
		},
	];
	const result = await input.local.apply({ label, ops });
	return {
		ok: result.ok,
		applied: [...new Set(fresh.map((write) => write.path))],
		written: result.written,
		stale,
		blocked: [],
		refused: result.refused.length,
		errors: result.errors.map((error) => ({ path: error.path, message: error.message })),
		label,
	};
}

/**
 * The push's remote half: resolutions first, then one `push` call per record-shaped batch, chunked by the client.
 *
 * The conflict book is read the other way round — a conflict resolved to `local` is written remotely — and a
 * record whose fields all resolved to `remote` simply produces no change, so a push never sends a value the person
 * did not choose.
 */
export async function applyPush(input: {
	readonly plan: SyncPlan;
	readonly target: SyncTarget;
	readonly choices: ResolutionBook;
	readonly fields: readonly ResolvedField[];
}): Promise<PushReport> {
	const byName = new Map(input.fields.map((field) => [field.definition.name, field]));
	const changes: PlannedPush[] = [...input.plan.push];
	for (const entry of resolvedConflicts(input.plan.diff.conflicts, input.choices)) {
		if (entry.choice.kind !== 'local' || entry.record.recordId === null) {
			continue;
		}
		const field = byName.get(entry.field.property);
		if (field === undefined) {
			continue;
		}
		changes.push({
			path: entry.record.path,
			label: entry.record.label,
			recordId: entry.record.recordId,
			property: entry.field.property,
			remoteFieldId: entry.field.remoteFieldId ?? '',
			from: entry.field.local,
			to: localToRemote(field, entry.field.local),
		});
	}
	if (changes.length === 0) {
		return { ok: true, accepted: 0, failed: [], pushedAt: null, sent: [], acceptedIds: [] };
	}

	// Grouped per record: the provider's own write verb takes a record id and a field map, and the client chunks
	// the list at 10 (its documented cap), so the engine's unit is the record and the client's is the chunk.
	const byRecord = new Map<string, { recordId: string; fields: Record<string, unknown> }>();
	for (const change of changes) {
		const existing = byRecord.get(change.recordId) ?? { recordId: change.recordId, fields: {} };
		existing.fields[change.remoteFieldId] = change.to;
		byRecord.set(change.recordId, existing);
	}
	const result = await input.target.push([...byRecord.values()]);
	return {
		ok: result.pushed.every((record) => record.ok),
		accepted: result.accepted,
		failed: result.pushed
			.filter((record) => !record.ok)
			.map((record) => ({
				recordId: record.recordId,
				reason: record.ok ? '' : record.reason,
			})),
		pushedAt: result.pushedAt,
		sent: changes,
		acceptedIds: result.pushed.filter((record) => record.ok).map((record) => record.recordId),
	};
}

/**
 * The undo step's label, counted from the **writes about to be applied**.
 *
 * A conflict resolved to `remote` adds a write the plan's own `pullFields` does not include, and an undo step that
 * undercounts is exactly the kind of quiet lie this project's rules are about. Both numbers come from the same list,
 * so the label cannot disagree with what is written.
 */
function labelFor(writes: readonly PlannedPull[]): string {
	return pullLabel({
		...EMPTY_COUNTS,
		pullRecords: new Set(writes.map((write) => write.recordId)).size,
		pullFields: writes.length,
	});
}

/** A counts object with everything at zero, for the two label builders. */
const EMPTY_COUNTS: PlanCounts = {
	rows: 0,
	cells: 0,
	pullRecords: 0,
	pullFields: 0,
	pushRecords: 0,
	pushFields: 0,
	conflicts: 0,
	skipped: 0,
	missing: 0,
};

/** `Pull 12 notes · 40 fields` — the words on the button, built from the plan that the press will run. */
export function pullLabel(counts: PlanCounts): string {
	return `Pull ${String(counts.pullRecords)} ${counts.pullRecords === 1 ? 'note' : 'notes'} · ${String(counts.pullFields)} ${counts.pullFields === 1 ? 'field' : 'fields'}`;
}

/** `Push 3 notes · 7 fields`. The push half of the same promise. */
export function pushLabel(counts: PlanCounts): string {
	return `Push ${String(counts.pushRecords)} ${counts.pushRecords === 1 ? 'note' : 'notes'} · ${String(counts.pushFields)} ${counts.pushFields === 1 ? 'field' : 'fields'}`;
}

/** The inverse writes for an applied pull — the "undo this pull" affordance, as data rather than as a closure. */
export function inverseOfPull(
	writes: readonly PlannedPull[],
	propertyIdOf: (property: string) => PropertyId,
): readonly Op[] {
	if (writes.length === 0) {
		return [];
	}
	return [
		{
			kind: 'setCells',
			writes: writes.map((write) => ({
				filePath: write.path,
				fieldId: propertyIdOf(write.property),
				value: write.from,
			})),
		},
	];
}

/**
 * The snapshot after a run: **the hash of every value both sides now agree on**, and nothing else.
 *
 * The rule matters more than the code. A field that was `unchanged` or `both-same`, a field pulled, and a field
 * that was **accepted** by the provider all end the run with both sides holding the same value — those agree. A
 * conflict resolved to one side agrees too, once the write that implements it succeeded; a write the provider
 * refused does not, and keeps the previous hash so the next run tries again. The four that do **not** agree — a conflict still
 * waiting, a type-mismatch, and the two deletion cases — keep the previous hash, because writing a new one would
 * tell the next sync that a disagreement had been settled when it had not.
 */
export async function nextSnapshot(input: {
	readonly diff: SyncDiff;
	readonly previous: Snapshot;
	readonly choices: ResolutionBook;
	readonly pull: PullReport | null;
	readonly push: PushReport | null;
}): Promise<Snapshot> {
	const next: Record<string, Record<string, string>> = {};
	for (const [recordId, fields] of Object.entries(input.previous)) {
		next[recordId] = { ...fields };
	}
	const applied = new Set((input.pull?.applied ?? []).map((path) => path));
	// Accepted, not sent: see `PushReport.acceptedIds`.
	const pushed = new Set(input.push?.acceptedIds ?? []);
	const resolved = resolvedConflicts(input.diff.conflicts, input.choices);

	for (const record of input.diff.records) {
		if (record.recordId === null || record.kind !== 'matched') {
			continue;
		}
		const entry = next[record.recordId] ?? {};
		for (const field of record.fields) {
			if (field.remoteFieldId === null) {
				continue;
			}
			const agreed = agreedHashFor({ field, record, applied, pushed, resolved });
			if (agreed !== null) {
				entry[field.remoteFieldId] = agreed;
			}
		}
		next[record.recordId] = entry;
	}
	return next;
}

/** The hash to store for one field after a run, or `null` to keep what is there. */
function agreedHashFor(input: {
	field: FieldVerdict;
	record: RecordVerdict;
	applied: ReadonlySet<string>;
	pushed: ReadonlySet<string>;
	resolved: readonly {
		readonly record: RecordVerdict;
		readonly field: FieldVerdict;
		readonly choice: ConflictResolution;
	}[];
}): string | null {
	const { field, record } = input;
	if (field.kind === 'unchanged' || field.kind === 'both-same') {
		return field.localHash;
	}
	if (field.kind === 'local-only') {
		// Pushed this run, or still to be pushed: either way the hash of the value that will be on both sides.
		return input.pushed.has(record.recordId ?? '') ? field.localHash : null;
	}
	if (field.kind === 'remote-only') {
		return input.applied.has(record.path) ? field.remoteHash : null;
	}
	if (field.kind === 'conflict') {
		const choice = input.resolved.find(
			(entry) => entry.record === record && entry.field === field,
		);
		if (choice === undefined || choice.choice === undefined) {
			return null;
		}
		if (choice.choice.kind === 'remote') {
			return input.applied.has(record.path) ? field.remoteHash : null;
		}
		return input.pushed.has(record.recordId ?? '') ? field.localHash : null;
	}
	// A deletion or a type-mismatch: the disagreement is still there, so the old hash stays.
	return null;
}

export type RunInput = {
	readonly target: SyncTarget;
	readonly local: SyncLocalPort;
	readonly fields: readonly ResolvedField[];
	readonly fieldMap: Readonly<Record<string, string>>;
	readonly recordMap: Readonly<Record<string, string>>;
	readonly snapshot: Snapshot;
	readonly direction: SyncDirection;
	readonly choices?: ResolutionBook | undefined;
	/** The cursor to pull with: `lastPulledAt` from the link file, or `null` for a full read. */
	readonly since?: string | null | undefined;
	readonly unmapped?: readonly UnmappedField[] | undefined;
	/** The label for the pull's undo step. Defaults to the plan's own count. */
	readonly label?: string | undefined;
};

/**
 * Pull and push in one run, in that order, on one plan.
 *
 * The order is not arbitrary: a pull first means the remote values that arrive are what the push decision is then
 * made against, so a person who presses "Sync now" never has a field written remotely on information from before
 * somebody else's edit. A push-only run pulls nothing and decides from the snapshot, which is correct because a
 * record absent from an incremental read is unchanged.
 */
export async function runSync(input: RunInput): Promise<SyncReport> {
	const direction = input.direction;
	const wantsPush = direction === 'push' || direction === 'both';
	const wantsPull = direction === 'pull' || direction === 'both';

	let records: readonly RemoteRecord[] = [];
	let full = false;
	let truncated = false;
	let pulledAt = new Date(0).toISOString();
	if (wantsPull) {
		const since = input.since ?? null;
		const pull = await input.target.pull(since);
		records = pull.records;
		pulledAt = pull.pulledAt;
		full = since === null;
		truncated = pull.truncated;
	} else {
		// Push-only: nothing is read, and the remote picture is by definition the snapshot's. A record absent from
		// an incremental read is unchanged, and this run does not claim to know more than that.
		full = false;
	}

	const plan = await planSync({
		local: input.local,
		fields: input.fields,
		fieldMap: input.fieldMap,
		recordMap: input.recordMap,
		snapshot: input.snapshot,
		records,
		full,
		truncated,
		unmapped: input.unmapped ?? [],
	});
	const choices = input.choices ?? new Map<string, ConflictResolution>();

	// The plan's own verdict comes first: a truncated read means part of the table was never seen, so *nothing*
	// is written — not the pulls that look safe, and certainly not a push. This is the guard the plan's `ready`
	// flag exists for, and it is here rather than in the panel because a panel is not a safety property.
	const holdsEverything = plan.blocked === null;
	let pullReport: PullReport | null = null;
	if (wantsPull && holdsEverything) {
		pullReport = await applyPull({ plan, local: input.local, choices, label: input.label });
	}
	// A push runs only on a plan that was not held back and, when a pull ran, one that was not blocked by an
	// unresolved conflict — pushing half of a decision a person has not made is exactly what §P8 forbids.
	let pushReport: PushReport | null = null;
	if (wantsPush) {
		const pullBlocked = (pullReport?.blocked.length ?? 0) > 0;
		if (holdsEverything && !pullBlocked) {
			pushReport = await applyPush({
				plan,
				target: input.target,
				choices,
				fields: input.fields,
			});
		}
	}

	const snapshot = await nextSnapshot({
		diff: plan.diff,
		previous: input.snapshot,
		choices,
		pull: pullReport,
		push: pushReport,
	});
	const ok =
		(pullReport === null || (pullReport.ok && pullReport.errors.length === 0)) &&
		(pushReport === null || pushReport.ok);
	return {
		plan,
		pull: pullReport,
		push: pushReport,
		snapshot,
		ok,
		summary: runSummary({ plan, pull: pullReport, push: pushReport, pulledAt }),
	};
}

/** One sentence for a Notice: what was read, what was written where, and what was left alone. */
export function runSummary(input: {
	readonly plan: SyncPlan;
	readonly pull: PullReport | null;
	readonly push: PushReport | null;
	readonly pulledAt: string;
}): string {
	const parts: string[] = [];
	if (input.pull !== null) {
		parts.push(
			input.pull.written === 0
				? 'nothing to pull'
				: `pulled ${String(input.pull.written)} cell(s) into ${String(input.pull.applied.length)} note(s)`,
		);
	}
	if (input.push !== null) {
		parts.push(
			input.push.accepted === 0
				? 'nothing to push'
				: `pushed ${String(input.push.accepted)} record(s)`,
		);
	}
	if (input.pull !== null && input.pull.stale.length > 0) {
		parts.push(`${String(input.pull.stale.length)} cell(s) left alone (edited meanwhile)`);
	}
	if (input.plan.counts.conflicts > 0) {
		parts.push(`${String(input.plan.counts.conflicts)} conflict(s) waiting for a choice`);
	}
	if (input.plan.counts.skipped > 0) {
		parts.push(`${String(input.plan.counts.skipped)} item(s) skipped`);
	}
	if (input.pull !== null && input.pull.errors.length > 0) {
		parts.push(`${String(input.pull.errors.length)} failed`);
	}
	if (input.push !== null && input.push.failed.length > 0) {
		parts.push(`${String(input.push.failed.length)} record(s) refused remotely`);
	}
	if (parts.length === 0) {
		parts.push(
			input.plan.blocked === null
				? 'already in sync'
				: 'nothing written — the plan is not ready',
		);
	}
	if (input.plan.blocked !== null) {
		parts.push(input.plan.blocked);
	}
	return `Tablify: ${parts.join(' · ')}.`;
}

/**
 * The sentence a failed run shows, for a `Notice` or the badge.
 *
 * A `SyncFailure` (the port's own rejection type) already carries the typed error and a redacted message; anything
 * else that is an `Error` is quoted; anything else is answered with a fixed sentence, because a thrown string or
 * `undefined` must not become the user-facing text of a failed sync.
 */
export function failureText(error: unknown): string {
	if (error instanceof SyncFailure) {
		return errorText(error.sync);
	}
	if (error instanceof Error && error.message !== '') {
		return error.message;
	}
	return 'the sync could not be completed';
}
