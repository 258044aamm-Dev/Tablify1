/**
 * The engine, end to end, against **the house transport fake and a fake local** — no network, no vault, no timers.
 *
 * The four acceptance cases the step names, plus the ones that protect a person's data:
 *
 * | Case | Assertion |
 * |---|---|
 * | a 12-note × 40-field pull | applies as **one** `apply` call — one undo step — and one undo restores every cell |
 * | a 12-record push | exactly **two** `PATCH` calls to the provider, of 10 and 2 (the client's own chunk size) |
 * | a partial push failure | local state stays consistent, and the report names the records that were refused |
 * | an external change during a pull | reported as `stale`, and the value the person typed is still there afterwards |
 *
 * Two more are here because they are the difference between a sync and a data-loss bug: a **truncated read** holds
 * everything back, and a **deletion** on either side updates no snapshot hash and writes nothing.
 */
import { describe, expect, it } from 'vitest';

import { createAirtableClient, DEFAULT_LIMITS } from '../../src/sync/airtable/client';
import { createFakeClock } from '../fakes/clock';
import { createFakeTransport } from '../fakes/transport';
import { createSyncLocal } from '../fakes/syncLocal';
import type { TransportResponse } from '../fakes/transport';
import { hashValue } from '../../src/sync/hash';
import {
	applyPull,
	applyPush,
	inverseOfPull,
	nextSnapshot,
	planSync,
	pullLabel,
	pushLabel,
	runSummary,
	runSync,
} from '../../src/sync/pullPush';
import type { PlanInput, SyncLocalPort } from '../../src/sync/pullPush';
import { resolveField } from '../../src/core/schema/propertySchema';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import type { CellValue, FieldTypeId } from '../../src/core/types';

const BASE = 'appTestBaseId';
const TABLE = 'tblTestTableId';
const TOKEN = 'patTESTTOKENnotarealtoken0001';

const CONTEXT = { path: 'Rows/Row 1.md', now: () => 0, timezone: 'UTC', locale: 'en-GB' };

/** A queued write answer: the provider echoes the records it accepted, which is what the client reads. */
function echoing(recordIds: readonly string[]): TransportResponse {
	return {
		status: 200,
		text: JSON.stringify({ records: recordIds.map((id) => ({ id, fields: {} })) }),
	};
}

/** A resolved field, built the way the grid builds one. */
function field(name: string, type: FieldTypeId = 'text'): ResolvedField {
	return resolveField(
		{ id: `note.${name}`, name, source: 'note', fieldOptions: { type } },
		{ ...CONTEXT, columnName: name, fieldOptions: { type } },
	);
}

/** 40 columns — the acceptance case's width — as `Field1`…`Field40`, `Field1` being text and the rest numbers. */
function fortyFields(): readonly ResolvedField[] {
	return Array.from({ length: 40 }, (_unused, index) =>
		field(`Field${String(index + 1)}`, index % 2 === 0 ? 'text' : 'number'),
	);
}

/**
 * A value its column can actually hold: `Field1`, `Field3`, … are text (so is any odd one), the rest are numbers —
 * the same rule {@link fortyFields} uses.
 *
 * The distinction is the point rather than a detail: a number column handed the string `"new"` produces a
 * `type-mismatch` verdict by design, so a fixture that ignored types silently halved the plan — which is exactly
 * what the first run of this test caught, and why the two rules are written next to each other here.
 */
function perType(fieldNumber: number, text: string, number: number): CellValue {
	return fieldNumber % 2 === 1 ? text : number;
}

/** 12 notes (`Rows/Note 01.md` …) each carrying `Field1`…`Field40`, with the given value for every field. */
function twelveNotes(
	value: (note: number, field: number) => CellValue,
): Record<string, Record<string, CellValue>> {
	const notes: Record<string, Record<string, CellValue>> = {};
	for (let note = 1; note <= 12; note += 1) {
		const cells: Record<string, CellValue> = {};
		for (let index = 1; index <= 40; index += 1) {
			cells[`Field${String(index)}`] = value(note, index);
		}
		notes[`Rows/Note ${String(note).padStart(2, '0')}.md`] = cells;
	}
	return notes;
}

/** The record map for those twelve notes: `rec01`…`rec12`, in the same order. */
function twelveLinks(): Record<string, string> {
	const links: Record<string, string> = {};
	for (let note = 1; note <= 12; note += 1) {
		links[`Rows/Note ${String(note).padStart(2, '0')}.md`] =
			`rec${String(note).padStart(2, '0')}`;
	}
	return links;
}

/** The field map for the 40 columns: `Field1` → `fld01` … */
function fortyLinks(): Record<string, string> {
	const links: Record<string, string> = {};
	for (let index = 1; index <= 40; index += 1) {
		links[`Field${String(index)}`] = `fld${String(index).padStart(2, '0')}`;
	}
	return links;
}

/** The 40 columns as a `PlanInput['unmapped']` report would carry them: nothing is unmapped here. */
const NO_UNMAPPED: PlanInput['unmapped'] = [];

describe('a 40-field × 12-note pull', () => {
	it('applies as **one** undo step, and one undo restores every cell', async () => {
		const notes = twelveNotes((_note, index) => perType(index, 'old', 1));
		const local = createSyncLocal({ notes });
		const fields = fortyFields();
		const plan = await planSync({
			local,
			fields,
			fieldMap: fortyLinks(),
			recordMap: twelveLinks(),
			// Every note agreed on "old" for every field, so the remote's "new" is a clean remote-only change.
			snapshot: Object.fromEntries(
				await Promise.all(
					Object.entries(twelveLinks()).map(
						async ([, recordId]): Promise<[string, Record<string, string>]> => [
							recordId,
							Object.fromEntries(
								await Promise.all(
									Object.entries(fortyLinks()).map(
										async ([property, fieldId]): Promise<[string, string]> => [
											fieldId,
											await hashValue(
												perType(
													Number(property.replace('Field', '')),
													'old',
													1,
												),
											),
										],
									),
								),
							),
						],
					),
				),
			),
			records: Object.entries(twelveLinks()).map(([, recordId]) => ({
				id: recordId,
				fields: Object.fromEntries(
					Object.entries(fortyLinks()).map(([property, fieldId]) => [
						fieldId,
						perType(Number(property.replace('Field', '')), 'new', 2),
					]),
				),
			})),
			full: true,
			truncated: false,
			unmapped: NO_UNMAPPED,
		});

		expect(plan.counts.pullRecords).toBe(12);
		expect(plan.counts.pullFields).toBe(480);
		expect(plan.pull).toHaveLength(480);
		expect(plan.conflicts).toHaveLength(0);
		expect(pullLabel(plan.counts)).toBe('Pull 12 notes · 480 fields');

		const report = await applyPull({ plan, local, choices: new Map() });
		expect(report.ok).toBe(true);
		expect(report.written).toBe(480);
		expect(report.applied).toHaveLength(12);
		// **One** apply: 480 cells, one undo step, one write-queue batch.
		expect(local.applications).toHaveLength(1);
		expect(local.applications[0]?.label).toBe('Pull 12 notes · 480 fields');
		expect(local.notes['Rows/Note 01.md']?.Field1).toBe(perType(1, 'new', 2));
		expect(local.notes['Rows/Note 12.md']?.Field40).toBe(perType(40, 'new', 2));

		// The undo: the plan carries the `from` values, so reversing it needs nothing else.
		const undo = inverseOfPull(plan.pull, (property) => local.propertyIdOf(property));
		await local.apply({ label: 'Undo pull', ops: undo });
		expect(local.notes['Rows/Note 01.md']?.Field1).toBe(perType(1, 'old', 1));
		expect(local.notes['Rows/Note 12.md']?.Field40).toBe(perType(40, 'old', 1));
		expect(local.applications).toHaveLength(2);

		// And the snapshot after the pull agrees with both sides for every field.
		const snapshot = await nextSnapshot({
			diff: plan.diff,
			previous: {},
			choices: new Map(),
			pull: report,
			push: null,
		});
		expect(Object.keys(snapshot)).toHaveLength(12);
		expect(snapshot['rec01']?.['fld01']).toBe(await hashValue(perType(1, 'new', 2)));
		expect(snapshot['rec01']?.['fld40']).toBe(await hashValue(perType(40, 'new', 2)));
	});
});

describe('a 12-record push', () => {
	it('is exactly two provider calls, of 10 and 2, through the real client over the transport fake', async () => {
		const clock = createFakeClock(1_700_000_000_000);
		const transport = createFakeTransport({ clock });
		const client = createAirtableClient({
			token: TOKEN,
			baseId: BASE,
			tableId: TABLE,
			transport: (request) => transport.request(request),
			now: () => clock.now(),
			sleep: (ms) => new Promise<void>((resolve) => clock.setTimer(resolve, ms)),
			random: () => 0,
		});
		// Every note has moved locally; the remote picture is the snapshot's, so all 12 notes push.
		const local = createSyncLocal({ notes: twelveNotes(() => 'new') });
		const ids = Array.from(
			{ length: 12 },
			(_unused, index) => `rec${String(index + 1).padStart(2, '0')}`,
		);
		// One answer per **chunk**, echoing what was sent: the provider returns the records it wrote, and the client
		// reads that echo as the per-record outcome.
		transport.queue(echoing(ids.slice(0, 10)));
		transport.queue(echoing(ids.slice(10)));
		const plan = await planSync({
			local,
			fields: [field('Field1'), field('Field2', 'number')],
			fieldMap: { Field1: 'fld01', Field2: 'fld02' },
			recordMap: twelveLinks(),
			snapshot: Object.fromEntries([
				...(await Promise.all(
					Array.from({ length: 12 }, async (_unused, index) => {
						const recordId = `rec${String(index + 1).padStart(2, '0')}`;
						return [
							recordId,
							{ fld01: await hashValue('old'), fld02: await hashValue(7) },
						] as const;
					}),
				)),
			]),
			records: [],
			// A full read that returned nothing: every linked record is gone remotely. That would be a deletion —
			// so this test uses the incremental path instead, where "not returned" means "unchanged".
			full: false,
			truncated: false,
			unmapped: NO_UNMAPPED,
		});
		expect(plan.counts.pushRecords).toBe(12);
		expect(plan.counts.pushFields).toBe(24);
		expect(pushLabel(plan.counts)).toBe('Push 12 notes · 24 fields');
		expect(plan.pull).toHaveLength(0);

		const report = await applyPush({
			plan,
			target: client,
			choices: new Map(),
			fields: [field('Field1'), field('Field2', 'number')],
		});
		expect(report.ok).toBe(true);
		expect(report.accepted).toBe(12);
		await Promise.resolve();
		// Two calls of 10 and 2 — the client's documented chunk size, not the engine's.
		expect(transport.calls).toHaveLength(2);
		const sizes = transport.calls.map((call) => {
			const body: unknown = JSON.parse(call.body ?? '{}');
			const records =
				typeof body === 'object' && body !== null && 'records' in body
					? body.records
					: undefined;
			return Array.isArray(records) ? records.length : 0;
		});
		expect(sizes).toEqual([10, 2]);
		expect(transport.pending()).toBe(0);
		expect(DEFAULT_LIMITS.chunkSize).toBe(10);
	});

	it('a partial failure leaves the local side untouched and reports per record', async () => {
		const clock = createFakeClock(0);
		const transport = createFakeTransport({ clock });
		const client = createAirtableClient({
			token: TOKEN,
			baseId: BASE,
			tableId: TABLE,
			transport: (request) => transport.request(request),
			now: () => clock.now(),
			sleep: (ms) => new Promise<void>((resolve) => clock.setTimer(resolve, ms)),
			random: () => 0,
		});
		// Only the refusal is queued: the provider refuses this record, and the client reports it per record.
		transport.queueStatus(422, {
			body: { error: { message: 'Field "Field1" cannot accept "new"' } },
		});
		const local = createSyncLocal({ notes: { 'Rows/Note 01.md': { Field1: 'new' } } });
		const plan = await planSync({
			local,
			fields: [field('Field1')],
			fieldMap: { Field1: 'fld01' },
			recordMap: { 'Rows/Note 01.md': 'rec01' },
			snapshot: { rec01: { fld01: await hashValue('old') } },
			records: [],
			full: false,
			truncated: false,
			unmapped: NO_UNMAPPED,
		});
		const report = await applyPush({
			plan,
			target: client,
			choices: new Map(),
			fields: [field('Field1')],
		});
		expect(report.ok).toBe(false);
		expect(report.accepted).toBe(0);
		expect(report.failed).toHaveLength(1);
		expect(report.failed[0]?.recordId).toBe('rec01');

		// The local side is exactly as it was — a push never writes locally, whatever the remote says.
		expect(local.notes['Rows/Note 01.md']?.Field1).toBe('new');
		expect(local.applications).toHaveLength(0);
		// And the snapshot does not claim agreement: the provider refused the write, so no hash is recorded for it
		// and the next run will try again. (`sent` lists the attempt; `acceptedIds` is what counts.)
		const snapshot = await nextSnapshot({
			diff: plan.diff,
			previous: {},
			choices: new Map(),
			pull: null,
			push: report,
		});
		expect(report.sent).toHaveLength(1);
		expect(report.acceptedIds).toEqual([]);
		expect(snapshot['rec01']?.['fld01'] ?? null).toBeNull();
	});
});

describe('an incomplete remote picture writes nothing', () => {
	it('a truncated read holds the whole plan back, whatever the diff found', async () => {
		const local = createSyncLocal({ notes: twelvey() });
		const plan = await planSync({
			local,
			fields: [field('Field1')],
			fieldMap: { Field1: 'fld01' },
			recordMap: twelveLinks(),
			snapshot: { rec01: { fld01: await hashValue('old') } },
			records: [{ id: 'rec01', fields: { fld01: 'new' } }],
			full: false,
			truncated: true,
			unmapped: NO_UNMAPPED,
		});
		expect(plan.ready).toBe(false);
		expect(plan.blocked ?? '').toContain('page cap');
		// The pull itself is still offered — the plan's *content* is honest — but nothing may be written.
		expect(plan.pull).toHaveLength(1);
		const report = await applyPull({ plan, local, choices: new Map() });
		// The plan's own flag is what the run reads; `applyPull` on its own would still do as it was told, so the
		// guard is asserted where it lives (`runSync`, next test) rather than being implied by this one.
		expect(plan.ready).toBe(false);
		expect(report.written).toBe(1);
	});

	it('`runSync` refuses to write anything on a truncated read', async () => {
		const clock = createFakeClock(0);
		const transport = createFakeTransport({ clock });
		const client = createAirtableClient({
			token: TOKEN,
			baseId: BASE,
			tableId: TABLE,
			transport: (request) => transport.request(request),
			now: () => clock.now(),
			sleep: (ms) => new Promise<void>((resolve) => clock.setTimer(resolve, ms)),
			random: () => 0,
			limits: { maxPages: 1 },
		});
		// One page that claims another page exists: the cap is hit, and the read is incomplete.
		transport.queuePage([{ id: 'rec01', fields: { fld01: 'new' } }], 'more');
		const local = createSyncLocal({ notes: { 'Rows/Note 01.md': { Field1: 'old' } } });
		const report = await runSync({
			target: client,
			local,
			fields: [field('Field1')],
			fieldMap: { Field1: 'fld01' },
			recordMap: { 'Rows/Note 01.md': 'rec01' },
			snapshot: { rec01: { fld01: await hashValue('old') } },
			direction: 'both',
			since: null,
		});
		expect(report.plan.ready).toBe(false);
		expect(report.pull?.written ?? 0).toBe(0);
		expect(report.push).toBeNull();
		expect(local.notes['Rows/Note 01.md']?.Field1).toBe('old');
		expect(report.summary).toContain('Tablify:');
	});
});

describe('an external change during a pull', () => {
	it('is reported as `stale`, and the value the person typed survives', async () => {
		const local = createSyncLocal({
			notes: { 'Rows/Note 01.md': { Field1: 'same as agreed' } },
		});
		const plan = await planSync({
			local,
			fields: [field('Field1')],
			fieldMap: { Field1: 'fld01' },
			recordMap: { 'Rows/Note 01.md': 'rec01' },
			snapshot: { rec01: { fld01: await hashValue('same as agreed') } },
			records: [{ id: 'rec01', fields: { fld01: 'changed remotely' } }],
			full: true,
			truncated: false,
			unmapped: NO_UNMAPPED,
		});
		expect(plan.pull).toHaveLength(1);
		// The person types while the review is open.
		local.setValue('Rows/Note 01.md', 'Field1', 'typed while reviewing');

		const report = await applyPull({ plan, local, choices: new Map() });
		expect(report.written).toBe(0);
		expect(report.stale).toHaveLength(1);
		expect(local.applications).toHaveLength(0);
		expect(local.notes['Rows/Note 01.md']?.Field1).toBe('typed while reviewing');
	});
});

describe('deletions, both ways', () => {
	it('a record missing from a **full** read is reported, never deleted locally', async () => {
		const local = createSyncLocal({ notes: { 'Rows/Note 01.md': { Field1: 'old' } } });
		const base = await planSync({
			local,
			fields: [field('Field1')],
			fieldMap: { Field1: 'fld01' },
			recordMap: { 'Rows/Note 01.md': 'rec01' },
			snapshot: { rec01: { fld01: await hashValue('old') } },
			records: [],
			full: true,
			truncated: false,
			unmapped: NO_UNMAPPED,
		});
		expect(base.diff.counts['remote-deleted']).toBe(1);
		expect(base.skipped.map((skip) => skip.detail).join(' ')).toContain(
			'deleted in the remote table',
		);
		expect(base.pull).toHaveLength(0);
		expect(base.push).toHaveLength(0);
		expect(local.applications).toHaveLength(0);

		// The snapshot keeps the old hash: the disagreement is still there, so nothing claims it was settled.
		const snapshot = await nextSnapshot({
			diff: base.diff,
			previous: { rec01: { fld01: 'sha256:kept' } },
			choices: new Map(),
			pull: null,
			push: null,
		});
		expect(snapshot['rec01']?.['fld01']).toBe('sha256:kept');
	});

	it('a record missing from an **incremental** read is unchanged, not deleted', async () => {
		const local = createSyncLocal({ notes: { 'Rows/Note 01.md': { Field1: 'old' } } });
		const plan = await planSync({
			local,
			fields: [field('Field1')],
			fieldMap: { Field1: 'fld01' },
			recordMap: { 'Rows/Note 01.md': 'rec01' },
			snapshot: { rec01: { fld01: await hashValue('old') } },
			records: [],
			full: false,
			truncated: false,
			unmapped: NO_UNMAPPED,
		});
		expect(plan.diff.counts['remote-deleted']).toBe(0);
		expect(plan.diff.counts.unchanged).toBe(1);
		expect(plan.skipped).toHaveLength(0);
	});

	it('a note deleted in the vault is reported and the remote record is left alone', async () => {
		const local = createSyncLocal({ notes: { 'Rows/Note 01.md': { Field1: 'old' } } });
		local.remove('Rows/Note 01.md');
		// The row is still in the view (the view can hold a path whose file is gone for a frame), so the diff sees it.
		const localWithStaleRow: SyncLocalPort = {
			...local,
			rows: () => Promise.resolve([{ path: 'Rows/Note 01.md', label: 'Note 01' }]),
		};
		const plan = await planSync({
			local: localWithStaleRow,
			fields: [field('Field1')],
			fieldMap: { Field1: 'fld01' },
			recordMap: { 'Rows/Note 01.md': 'rec01' },
			snapshot: { rec01: { fld01: await hashValue('old') } },
			records: [{ id: 'rec01', fields: { fld01: 'new' } }],
			full: true,
			truncated: false,
			unmapped: NO_UNMAPPED,
		});
		expect(plan.diff.counts['local-deleted']).toBe(1);
		expect(plan.pull).toHaveLength(0);
		expect(plan.skipped.map((skip) => skip.detail).join(' ')).toContain(
			'no longer in the vault',
		);
	});
});

describe('a row with no record at all', () => {
	it('is skipped and reported — never created remotely (the documented gap)', async () => {
		const local = createSyncLocal({
			notes: { 'Rows/Fresh.md': { Field1: 'draft' } },
			labels: { 'Rows/Fresh.md': 'Fresh' },
		});
		const plan = await planSync({
			local,
			fields: [field('Field1')],
			fieldMap: { Field1: 'fld01' },
			recordMap: {},
			snapshot: {},
			records: [],
			full: true,
			truncated: false,
			unmapped: [{ side: 'local', name: 'Notes' }],
		});
		expect(plan.pull).toHaveLength(0);
		expect(plan.push).toHaveLength(0);
		const reasons = plan.skipped.map((skip) => skip.reason);
		expect(reasons).toEqual(['no-record', 'no-counterpart']);
		expect(plan.skipped[0]?.detail).toContain('never creates remote records');
		expect(plan.skipped[1]?.detail).toContain('has no remote field');
	});
});

describe('`runSync` end to end', () => {
	it('pulls, pushes, and summarises — in that order, on one plan', async () => {
		const clock = createFakeClock(0);
		const transport = createFakeTransport({ clock });
		const client = createAirtableClient({
			token: TOKEN,
			baseId: BASE,
			tableId: TABLE,
			transport: (request) => transport.request(request),
			now: () => clock.now(),
			sleep: (ms) => new Promise<void>((resolve) => clock.setTimer(resolve, ms)),
			random: () => 0,
		});
		const local = createSyncLocal({
			notes: {
				'Rows/Note 01.md': { Field1: 'old' },
				'Rows/Note 02.md': { Field1: 'mine' },
			},
		});
		const snapshot = {
			rec01: { fld01: await hashValue('old') },
			rec02: { fld01: await hashValue('agreed') },
		};
		// The read returns Note 01 (changed remotely) and Note 03 (new to the view, not linked here).
		transport.queuePage([
			{ id: 'rec01', fields: { fld01: 'new' } },
			{ id: 'rec02', fields: { fld01: 'agreed' } },
		]);
		// Note 02's local value moved, so it pushes; the provider accepts it.
		transport.queue({
			status: 200,
			text: JSON.stringify({ records: [{ id: 'rec02', fields: {} }] }),
		});

		const report = await runSync({
			target: client,
			local,
			fields: [field('Field1')],
			fieldMap: { Field1: 'fld01' },
			recordMap: { 'Rows/Note 01.md': 'rec01', 'Rows/Note 02.md': 'rec02' },
			snapshot,
			direction: 'both',
			since: null,
		});

		expect(report.ok).toBe(true);
		expect(report.pull?.written).toBe(1);
		expect(report.pull?.applied).toEqual(['Rows/Note 01.md']);
		expect(report.push?.accepted).toBe(1);
		expect(local.notes['Rows/Note 01.md']?.Field1).toBe('new');
		expect(local.applications.map((application) => application.label)).toEqual([
			'Pull 1 note · 1 field',
		]);
		expect(report.summary).toBe(
			'Tablify: pulled 1 cell(s) into 1 note(s) · pushed 1 record(s).',
		);
		// Both sides now agree on both records, so both hashes moved to what they agree on.
		expect(report.snapshot['rec01']?.['fld01']).toBe(await hashValue('new'));
		expect(report.snapshot['rec02']?.['fld01']).toBe(await hashValue('mine'));
	});
});

describe('the summary sentence', () => {
	it('names what happened, and says "already in sync" when nothing did', async () => {
		const local = createSyncLocal();
		const plan = await planSync({
			local,
			fields: [field('Field1')],
			fieldMap: { Field1: 'fld01' },
			recordMap: {},
			snapshot: {},
			records: [],
			full: true,
			truncated: false,
			unmapped: NO_UNMAPPED,
		});
		expect(
			runSummary({ plan, pull: null, push: null, pulledAt: '2026-10-06T00:00:00.000Z' }),
		).toBe('Tablify: already in sync.');
	});
});

/** A twelve-note local for the truncation test: one field, and every note linked. */
function twelvey(): Record<string, Record<string, CellValue>> {
	return {
		'Rows/Note 01.md': { Field1: 'old' },
		'Rows/Note 02.md': { Field1: 'old' },
		'Rows/Note 03.md': { Field1: 'old' },
		'Rows/Note 04.md': { Field1: 'old' },
		'Rows/Note 05.md': { Field1: 'old' },
		'Rows/Note 06.md': { Field1: 'old' },
		'Rows/Note 07.md': { Field1: 'old' },
		'Rows/Note 08.md': { Field1: 'old' },
		'Rows/Note 09.md': { Field1: 'old' },
		'Rows/Note 10.md': { Field1: 'old' },
		'Rows/Note 11.md': { Field1: 'old' },
		'Rows/Note 12.md': { Field1: 'old' },
	};
}
