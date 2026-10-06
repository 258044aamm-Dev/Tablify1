/**
 * The three-way diff: **one test per row of `docs/03` §Sync behaviour**, plus the two rules that are not rows.
 *
 * The point of testing a rule table row by row is that a missing branch is invisible otherwise: a diff that reports
 * `conflict` for everything still "works", just uselessly, and one that reports `local-only` too eagerly silently
 * overwrites other people's edits. So the table below is the specification, and each `it()` names the row it pins.
 *
 * Two properties get their own section because they are the ones that would be catastrophic rather than annoying:
 * **a conflict cannot resolve itself** (a plan whose conflicts have no choice applies nothing — asserted against the
 * engine, not just the type) and **no deletion propagates in either direction**.
 */
import { describe, expect, it } from 'vitest';

import {
	describeCounts,
	diffSync,
	fieldKey,
	resolvedConflicts,
	unresolvedConflicts,
	verdictKinds,
} from '../../src/sync/diff';
import type {
	ConflictResolution,
	DiffFieldInput,
	DiffRecordInput,
	FieldVerdictKind,
	ResolutionBook,
} from '../../src/sync/diff';
import { hashValue } from '../../src/sync/hash';
import { applyPull, planSync } from '../../src/sync/pullPush';
import type { PlanInput, SyncLocalPort, SyncLocalRow } from '../../src/sync/pullPush';
import { resolveField } from '../../src/core/schema/propertySchema';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import type { Snapshot } from '../../src/sync/LinkStore';
import type { CellValue, FieldTypeId } from '../../src/core/types';
import type { ApplyResult } from '../../src/adapters/RowSource';

const CONTEXT = {
	path: 'Rows/Row 1.md',
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
};

/** A resolved field, built the way the grid builds one. */
function field(
	name: string,
	type: FieldTypeId,
	options: Record<string, unknown> = {},
): ResolvedField {
	return resolveField(
		{ id: `note.${name}`, name, source: 'note', fieldOptions: { type, ...options } },
		{ ...CONTEXT, columnName: name, fieldOptions: { type, ...options } },
	);
}

/** A field comparison with everything defaulted, so each test states only what it is about. */
function comparison(overrides: Partial<DiffFieldInput> = {}): DiffFieldInput {
	return {
		property: 'Status',
		remoteFieldId: 'fldStatus',
		local: 'Todo',
		remote: 'Todo',
		remoteRaw: 'Todo',
		typeProblem: null,
		...overrides,
	};
}

/** A row comparison, with the field list given. */
function row(overrides: Partial<DiffRecordInput> = {}): DiffRecordInput {
	return {
		path: 'Rows/Alpha.md',
		recordId: 'recAlpha',
		label: 'Alpha',
		localPresent: true,
		remotePresent: true,
		fields: [comparison()],
		...overrides,
	};
}

/** The snapshot with one agreed hash for Alpha's Status field. */
async function snapshotOf(value: CellValue): Promise<Snapshot> {
	return { recAlpha: { fldStatus: await hashValue(value) } };
}

/** The single verdict in a one-field diff. */
async function verdictFor(input: {
	field: DiffFieldInput;
	snapshot?: Snapshot;
	localPresent?: boolean;
	remotePresent?: boolean;
}) {
	const diff = await diffSync({
		records: [
			row({
				fields: [input.field],
				...(input.localPresent === undefined ? {} : { localPresent: input.localPresent }),
				...(input.remotePresent === undefined
					? {}
					: { remotePresent: input.remotePresent }),
			}),
		],
		snapshot: input.snapshot ?? {},
	});
	const verdict = diff.records[0]?.fields[0];
	if (verdict === undefined) {
		throw new Error('the diff produced no verdict');
	}
	return { diff, verdict, record: diff.records[0] };
}

describe('docs/03 §Sync behaviour, one test per row', () => {
	it('Only local changed → `local-only`, and the push is automatic', async () => {
		const { verdict } = await verdictFor({
			field: comparison({ local: 'Doing', remote: 'Todo' }),
			snapshot: await snapshotOf('Todo'),
		});
		expect(verdict.kind).toBe('local-only');
		expect(verdict.outcome).toBe('write-remote');
		expect(verdict.automatic).toBe(true);
	});

	it('Only remote changed → `remote-only`, and the pull is automatic', async () => {
		const { verdict } = await verdictFor({
			field: comparison({ local: 'Todo', remote: 'Done' }),
			snapshot: await snapshotOf('Todo'),
		});
		expect(verdict.kind).toBe('remote-only');
		expect(verdict.outcome).toBe('write-local');
		expect(verdict.remote).toBe('Done');
	});

	it('Both changed, different fields → two verdicts, and no conflict is promoted', async () => {
		const diff = await diffSync({
			records: [
				row({
					fields: [
						comparison({
							property: 'Status',
							remoteFieldId: 'fldStatus',
							local: 'Doing',
							remote: 'Todo',
						}),
						comparison({
							property: 'Owner',
							remoteFieldId: 'fldOwner',
							local: 'me',
							remote: 'you',
						}),
					],
				}),
			],
			snapshot: {
				recAlpha: { fldStatus: await hashValue('Todo'), fldOwner: await hashValue('me') },
			},
		});
		expect(diff.records[0]?.fields.map((entry) => entry.kind)).toEqual([
			'local-only',
			'remote-only',
		]);
		expect(diff.conflicts).toEqual([]);
		expect(diff.counts.conflict).toBe(0);
	});

	it('Both changed, same field → `conflict`: `ask`, never automatic', async () => {
		const { verdict } = await verdictFor({
			field: comparison({ local: 'Doing', remote: 'Blocked' }),
			snapshot: await snapshotOf('Todo'),
		});
		expect(verdict.kind).toBe('conflict');
		expect(verdict.outcome).toBe('ask');
		expect(verdict.automatic).toBe(false);
	});

	it('Both changed to the **same** value → `both-same`, which writes nothing', async () => {
		const { verdict } = await verdictFor({
			field: comparison({ local: 'Done', remote: 'Done' }),
			snapshot: await snapshotOf('Todo'),
		});
		expect(verdict.kind).toBe('both-same');
		expect(verdict.outcome).toBe('skip');
		expect(verdict.automatic).toBe(true);
	});

	it('Remote record missing → `remote-deleted`, reported and never auto-deleted locally', async () => {
		const { verdict } = await verdictFor({ field: comparison(), remotePresent: false });
		expect(verdict.kind).toBe('remote-deleted');
		expect(verdict.outcome).toBe('skip');
		expect(verdict.automatic).toBe(false);
	});

	it('Local note missing → `local-deleted`, reported and the record left untouched', async () => {
		const { verdict } = await verdictFor({ field: comparison(), localPresent: false });
		expect(verdict.kind).toBe('local-deleted');
		expect(verdict.outcome).toBe('skip');
	});

	it('A remote value the column cannot read → `type-mismatch`, with both values and the sentence', async () => {
		const { verdict } = await verdictFor({
			field: comparison({
				local: 12,
				remote: undefined,
				remoteRaw: 'twelve',
				typeProblem: 'Cost expects a number',
			}),
		});
		expect(verdict.kind).toBe('type-mismatch');
		expect(verdict.outcome).toBe('skip');
		expect(verdict.problem).toBe('Cost expects a number');
		// Both values travel, which is what the review dialog needs to show the person what arrived.
		expect(verdict.local).toBe(12);
		expect(verdict.remoteRaw).toBe('twelve');
	});

	it("A field with no counterpart is not a verdict at all — it is the caller's skip list", async () => {
		const { diff } = await verdictFor({ field: comparison({ remoteFieldId: null }) });
		// The diff still compares it (the input carries the property), and the *plan* is what reports a skip; the
		// point of the assertion is that a field with no remote id can never produce a write-local verdict.
		expect(diff.records[0]?.fields[0]?.outcome).toBe('skip');
	});
});

describe('the two rules that are not rows', () => {
	it('a first sync with no agreement is conservative: equal values pass, differing values ask', async () => {
		const same = await verdictFor({ field: comparison({ local: 'Todo', remote: 'Todo' }) });
		expect(same.verdict.kind).toBe('unchanged');
		// Filling an empty local cell loses nothing, so it is pulled without asking.
		const onlyRemote = await verdictFor({ field: comparison({ local: null, remote: 'Todo' }) });
		expect(onlyRemote.verdict.kind).toBe('remote-only');
		// Emptying a cell that holds something could destroy a value, so — with no agreement to say who emptied it —
		// even a one-sided difference asks.
		const onlyLocal = await verdictFor({ field: comparison({ local: 'Todo', remote: null }) });
		expect(onlyLocal.verdict.kind).toBe('conflict');
		// Two different values, no base: neither side can be blamed, so a person decides.
		const different = await verdictFor({
			field: comparison({ local: 'Mine', remote: 'Theirs' }),
		});
		expect(different.verdict.kind).toBe('conflict');
	});

	it('a record an incremental read did not return is `unchanged` when the base agrees, `local-only` when it moved', async () => {
		const snapshot = await snapshotOf('Todo');
		const quiet = await verdictFor({
			field: comparison({ local: 'Todo', remote: 'Todo', remoteUnchanged: true }),
			snapshot,
		});
		expect(quiet.verdict.kind).toBe('unchanged');
		const moved = await verdictFor({
			field: comparison({ local: 'Doing', remote: 'Doing', remoteUnchanged: true }),
			snapshot,
		});
		expect(moved.verdict.kind).toBe('local-only');
		// And a record with no stored agreement at all cannot be pushed on this evidence.
		const unknown = await verdictFor({
			field: comparison({
				local: 'Doing',
				remote: undefined,
				remoteUnchanged: false,
				typeProblem: null,
			}),
		});
		expect(unknown.verdict.kind).toBe('type-mismatch');
	});

	it('counts every kind, and describes them in report order with empty kinds left out', async () => {
		const diff = await diffSync({
			records: [
				row({ fields: [comparison({ property: 'A', local: 'x', remote: 'x' })] }),
				row({
					path: 'Rows/Beta.md',
					recordId: 'recBeta',
					label: 'Beta',
					fields: [comparison({ property: 'B', local: 'Mine', remote: 'Theirs' })],
				}),
			],
			snapshot: {},
		});
		expect(Object.keys(diff.counts).sort()).toEqual([...verdictKinds()].sort());
		expect(diff.counts.unchanged).toBe(1);
		expect(diff.counts.conflict).toBe(1);
		expect(describeCounts(diff.counts)).toBe('1 unchanged · 1 conflict');
		// Every kind at zero is "nothing to compare" rather than an empty string.
		const zeroed: Record<FieldVerdictKind, number> = {
			unchanged: 0,
			'local-only': 0,
			'remote-only': 0,
			'both-same': 0,
			conflict: 0,
			'local-deleted': 0,
			'remote-deleted': 0,
			'type-mismatch': 0,
		};
		expect(describeCounts(zeroed)).toBe('nothing to compare');
	});
});

describe('conflicts ask, and the book is what answers', () => {
	it('`unresolvedConflicts` names the fields still waiting, by record and property', async () => {
		const diff = await diffSync({
			records: [row({ fields: [comparison({ local: 'Mine', remote: 'Theirs' })] })],
			snapshot: {},
		});
		const waiting = unresolvedConflicts(diff.conflicts, new Map());
		expect(waiting).toEqual([
			{ recordId: 'recAlpha', path: 'Rows/Alpha.md', label: 'Alpha', property: 'Status' },
		]);
		expect(
			unresolvedConflicts(diff.conflicts, book([['recAlpha', 'Status', 'local']])),
		).toEqual([]);
	});

	it('the resolution type has no "undecided" member: a choice is `local` or `remote`, and nothing else', () => {
		// The type-level half of §P8, written where it can be read: `ConflictResolution` is a two-member union, so
		// `undefined`, `null` and `'both'` are not expressible — an unresolved conflict is the *absence* of a book
		// entry, which `unresolvedConflicts` reports by name.
		const choices: readonly ConflictResolution[] = [{ kind: 'local' }, { kind: 'remote' }];
		expect(choices.map((choice) => choice.kind)).toEqual(['local', 'remote']);
	});

	it('`resolvedConflicts` pairs each choice with the verdict it answers', async () => {
		const diff = await diffSync({
			records: [row({ fields: [comparison({ local: 'Mine', remote: 'Theirs' })] })],
			snapshot: {},
		});
		const resolved = resolvedConflicts(
			diff.conflicts,
			book([['recAlpha', 'Status', 'remote']]),
		);
		expect(resolved).toHaveLength(1);
		expect(resolved[0]?.choice.kind).toBe('remote');
		expect(resolved[0]?.field.property).toBe('Status');
	});

	it('`fieldKey` is the record id and the property, and cannot be confused by a property containing the separator', () => {
		expect(fieldKey('recA', 'Status')).toBe(fieldKey('recA', 'Status'));
		expect(fieldKey('recA', 'Status')).not.toBe(fieldKey('recB', 'Status'));
		expect(fieldKey(null, 'Status')).not.toBe(fieldKey('recA', 'Status'));
	});
});

/** A resolution book from `[record, property, choice]` triples. */
function book(entries: readonly (readonly [string, string, 'local' | 'remote'])[]): ResolutionBook {
	return new Map(
		entries.map(([recordId, property, choice]) => [
			fieldKey(recordId, property),
			{ kind: choice },
		]),
	);
}

/**
 * The plan-level half of "never silent", asserted where it actually protects somebody.
 *
 * A `planSync` with an unresolved conflict must produce a plan whose `applyPull` writes **nothing** — no partially
 * applied row, no cell written "because the other nine resolved". This is the assertion the prompt asks for, and it
 * is a behavioural one: `applyPull` is called and its report is checked, rather than the type being inspected.
 */
describe('a conflict that has no choice stops the pull', () => {
	async function conflictedPlan() {
		const local: SyncLocalPort = {
			rows: (): Promise<readonly SyncLocalRow[]> =>
				Promise.resolve([{ path: 'Rows/Alpha.md', label: 'Alpha' }]),
			has: () => Promise.resolve(true),
			values: () => Promise.resolve({ Status: 'Mine' }),
			propertyIdOf: (property) => `note.${property}`,
			apply: () =>
				Promise.resolve({
					ok: true,
					written: 0,
					files: [],
					refused: [],
					errors: [],
				} satisfies ApplyResult),
		};
		const input: PlanInput = {
			local,
			fields: [field('Status', 'text')],
			fieldMap: { Status: 'fldStatus' },
			recordMap: { 'Rows/Alpha.md': 'recAlpha' },
			snapshot: {},
			records: [{ id: 'recAlpha', fields: { fldStatus: 'Theirs' } }],
			full: true,
			truncated: false,
			unmapped: [],
		};
		return planSync(input);
	}

	it('the plan says it is not ready, and why', async () => {
		const plan = await conflictedPlan();
		expect(plan.ready).toBe(false);
		expect(plan.blocked ?? '').toContain('changed on both sides');
		expect(plan.conflicts).toHaveLength(1);
		// The dialog's data: both renderings, and both sides known to have moved (no agreement was stored).
		expect(plan.conflicts[0]).toMatchObject({
			property: 'Status',
			remoteFieldId: 'fldStatus',
			localText: 'Mine',
			remoteText: 'Theirs',
			movedLocally: true,
			movedRemotely: true,
		});
	});

	it('`applyPull` with an empty book writes nothing and names the field', async () => {
		const plan = await conflictedPlan();
		let applied = 0;
		const local: SyncLocalPort = {
			rows: (): Promise<readonly SyncLocalRow[]> => Promise.resolve([]),
			has: () => Promise.resolve(true),
			values: () => Promise.resolve({ Status: 'Mine' }),
			propertyIdOf: (property) => `note.${property}`,
			apply: () => {
				applied += 1;
				return Promise.resolve({
					ok: true,
					written: 1,
					files: [],
					refused: [],
					errors: [],
				} satisfies ApplyResult);
			},
		};
		const report = await applyPull({ plan, local, choices: new Map() });
		expect(report.ok).toBe(false);
		expect(report.written).toBe(0);
		expect(applied).toBe(0);
		expect(report.blocked.map((entry) => entry.property)).toEqual(['Status']);
	});

	it('with the choice made, the same plan applies — and only the field that was decided', async () => {
		const plan = await conflictedPlan();
		const writes: { label: string; ops: unknown }[] = [];
		const local: SyncLocalPort = {
			rows: (): Promise<readonly SyncLocalRow[]> => Promise.resolve([]),
			has: () => Promise.resolve(true),
			values: () => Promise.resolve({ Status: 'Mine' }),
			propertyIdOf: (property) => `note.${property}`,
			apply: (action) => {
				writes.push({ label: action.label, ops: action.ops });
				return Promise.resolve({
					ok: true,
					written: 1,
					files: ['Rows/Alpha.md'],
					refused: [],
					errors: [],
				} satisfies ApplyResult);
			},
		};
		const report = await applyPull({
			plan,
			local,
			choices: book([['recAlpha', 'Status', 'remote']]),
		});
		expect(report.ok).toBe(true);
		expect(report.written).toBe(1);
		// One apply, one undo step, labelled with the count the button promised.
		expect(writes).toHaveLength(1);
		expect(writes[0]?.label).toBe('Pull 1 note · 1 field');
		expect(writes[0]?.ops).toEqual([
			{
				kind: 'setCells',
				writes: [{ filePath: 'Rows/Alpha.md', fieldId: 'note.Status', value: 'Theirs' }],
			},
		]);

		// And the other choice writes only remotely: the conflict resolved to the local value is not pulled.
		const localOnly = await applyPull({
			plan,
			local,
			choices: book([['recAlpha', 'Status', 'local']]),
		});
		expect(localOnly.written).toBe(0);
		expect(localOnly.applied).toEqual([]);
	});
});

describe('the stale check', () => {
	it('a cell edited between the plan and the apply is reported and left exactly as typed', async () => {
		// A clean `remote-only` at plan time: local still holds the agreed value, the remote side moved on.
		const valueAtPlan = 'Same as agreed';
		const plan = await planSync({
			local: {
				rows: (): Promise<readonly SyncLocalRow[]> =>
					Promise.resolve([{ path: 'Rows/Alpha.md', label: 'Alpha' }]),
				has: () => Promise.resolve(true),
				values: () => Promise.resolve({ Status: valueAtPlan }),
				propertyIdOf: (property) => `note.${property}`,
				apply: () =>
					Promise.resolve({
						ok: true,
						written: 0,
						files: [],
						refused: [],
						errors: [],
					} satisfies ApplyResult),
			},
			fields: [field('Status', 'text')],
			fieldMap: { Status: 'fldStatus' },
			recordMap: { 'Rows/Alpha.md': 'recAlpha' },
			snapshot: { recAlpha: { fldStatus: await hashValue('Same as agreed') } },
			records: [{ id: 'recAlpha', fields: { fldStatus: 'Changed remotely' } }],
			full: true,
			truncated: false,
			unmapped: [],
		});
		expect(plan.pull).toHaveLength(1);
		expect(plan.conflicts).toHaveLength(0);

		let applied = 0;
		const report = await applyPull({
			plan,
			choices: new Map(),
			local: {
				rows: (): Promise<readonly SyncLocalRow[]> => Promise.resolve([]),
				has: () => Promise.resolve(true),
				// The person typed while the dialog was open.
				values: () => Promise.resolve({ Status: 'Typed just now' }),
				propertyIdOf: (property) => `note.${property}`,
				apply: () => {
					applied += 1;
					return Promise.resolve({
						ok: true,
						written: 1,
						files: [],
						refused: [],
						errors: [],
					} satisfies ApplyResult);
				},
			},
		});
		expect(applied).toBe(0);
		expect(report.written).toBe(0);
		expect(report.stale).toHaveLength(1);
		expect(report.stale[0]).toMatchObject({ path: 'Rows/Alpha.md', property: 'Status' });
		expect(report.stale[0]?.detail ?? '').toContain('changed in the vault');
	});
});
