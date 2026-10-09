/**
 * The conflict review, driven: **the numbers come from the plan, and the primary action cannot be pressed early.**
 *
 * The two things this file exists to prove, in the step's own words:
 *
 *   · *"opening the dialog with conflicts and pressing the primary action must not be possible"* — so the panel is
 *     rendered into a **real jsdom element** (with Obsidian's DOM helpers installed by `tests/dom/support/dom.ts`,
 *     the pattern `export-dialog.test.tsx` set), the primary button is read back out of that DOM, and the assertion
 *     is on `disabled` plus the reason the panel attaches to it;
 *   · *"the dialog's counts match the plan"* — the conflicts are not fixtures that agree with themselves: they come
 *     from `planSync` over a fake local and a remote record set, the same function the shipping path calls, so
 *     `plan.counts.conflicts` and the dialog's total are two readings of one computation.
 *
 * The `Modal` itself cannot be built in a test (`Modal(app: App)`, and an `App` double would be a fiction), which is
 * why the panel is the class under test — exactly as the export dialog's panel is. The browser suite remains where
 * "it looks right" lives; nothing here replaces it.
 */
import { describe, expect, it } from 'vitest';

import {
	ConflictReviewPanel,
	bulkChoice,
	rawLine,
	rawText,
	reviewCanRun,
	reviewCounts,
	reviewLines,
	reviewRows,
	reviewStateOf,
} from '../../src/plugin/sync/ConflictReview';
import type { ConflictReviewHost, ReviewState } from '../../src/plugin/sync/ConflictReview';
import { planSync } from '../../src/sync/pullPush';
import type { PlanInput, SyncPlan } from '../../src/sync/pullPush';
import { hashValue } from '../../src/sync/hash';
import type { ResolutionBook } from '../../src/sync/diff';
import { resolveField } from '../../src/core/schema/propertySchema';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import type { FieldTypeId } from '../../src/core/types';
import { createSyncLocal } from '../fakes/syncLocal';
import { augment } from './support/dom';

const CONTEXT = { path: 'Rows/Alpha.md', now: () => 0, timezone: 'UTC', locale: 'en-GB' };

/** A resolved field, built the way the grid builds one. */
function field(name: string, type: FieldTypeId): ResolvedField {
	return resolveField(
		{ id: `note.${name}`, name, source: 'database', fieldOptions: { type } },
		{ ...CONTEXT, columnName: name, fieldOptions: { type } },
	);
}

/**
 * The fixture: two notes, three columns, and **two conflicts** — one on each note — so that "every conflict needs a
 * choice" is a statement about more than one row.
 *
 * | Field | Local | Last agreed | Remote | Verdict |
 * |---|---|---|---|---|
 * | `Alpha.Status` | `mine` | `old` | `theirs` | conflict (both moved) |
 * | `Alpha.Due` | `2026-10-06` | `2026-10-06` | `2026-10-06` | unchanged |
 * | `Beta.Due` | `2026-11-01` | `2026-09-01` | `2026-12-01` | conflict (both moved) |
 * | `Beta.Note` | `mine-only` | `was` | `mine-only` | both-same → resolved automatically, no dialog |
 */
const FIELDS: readonly ResolvedField[] = [
	field('Status', 'text'),
	field('Due', 'date'),
	field('Note', 'text'),
];

const FIELD_MAP: Record<string, string> = { Status: 'fldStatus', Due: 'fldDue', Note: 'fldNote' };
const RECORD_MAP: Record<string, string> = {
	'Rows/Alpha.md': 'recAlpha',
	'Rows/Beta.md': 'recBeta',
};
const UNMAPPED: PlanInput['unmapped'] = [];

const NOTES = {
	'Rows/Alpha.md': { Status: 'mine', Due: '2026-10-06', Note: 'alpha' },
	'Rows/Beta.md': { Status: 'shared', Due: '2026-11-01', Note: 'mine-only' },
} as const;

/** The remote side, as the provider would answer it. */
const RECORDS = [
	{ id: 'recAlpha', fields: { fldStatus: 'theirs', fldDue: '2026-10-06', fldNote: 'alpha' } },
	// `fldNote` carries the same value the local side holds: both sides moved, to the same place — `both-same`,
	// which resolves without a dialog by design (`docs/03` §Sync behaviour). It is here so the plan is *not* only
	// conflicts: a dialog that is only ever handed conflicts never proves the automatic cases stay out of it.
	{ id: 'recBeta', fields: { fldStatus: 'shared', fldDue: '2026-12-01', fldNote: 'mine-only' } },
];

/** The plan, built the way `host.ts` builds it. One helper, so every test below reads the same plan. */
async function buildPlan(): Promise<SyncPlan> {
	const local = createSyncLocal({ notes: NOTES, prefix: 'note.' });
	const [statusOld, dueOld, betaDueOld, noteOld] = await Promise.all([
		hashValue('old'),
		hashValue('2026-10-06'),
		hashValue('2026-09-01'),
		hashValue('was'),
	]);
	return planSync({
		local,
		fields: FIELDS,
		fieldMap: FIELD_MAP,
		recordMap: RECORD_MAP,
		snapshot: {
			recAlpha: { fldStatus: statusOld, fldDue: dueOld },
			recBeta: { fldStatus: statusOld, fldDue: betaDueOld, fldNote: noteOld },
		},
		records: RECORDS,
		full: true,
		truncated: false,
		unmapped: UNMAPPED,
	});
}

/** A host that records what the panel asked of it. The engine is *not* called here — that is `pull-push`'s subject. */
function fakeHost(conflicts: SyncPlan['conflicts'], choices?: ResolutionBook) {
	const record = {
		confirmed: [] as ResolutionBook[],
		finished: [] as { readonly cancelled: boolean }[],
		rendered: 0,
		closes: 0,
	};
	const host: ConflictReviewHost = {
		spec: { conflicts, ...(choices === undefined ? {} : { choices }) },
		onConfirm: (book) => {
			record.confirmed.push(book);
			return 'Tablify: applied 2 choices.';
		},
		onFinished: (outcome) => {
			record.finished.push({ cancelled: outcome.cancelled });
		},
	};
	const ui = {
		contentEl: augment(document.createElement('div')),
		close: () => {
			record.closes += 1;
		},
	};
	return { host, ui, record, panel: new ConflictReviewPanel(host, ui) };
}

/**
 * Every element under a selector.
 *
 * `Array.from`, not a spread: this project's `lib` is ES2018, where a `NodeList` has no iterator in the types — and
 * a tag-name check rather than `instanceof`, which the house lint rule bans because an element from another window
 * fails it.
 */
function nodes(root: ParentNode, selector: string): Element[] {
	return Array.from(root.querySelectorAll(selector));
}

/** The buttons among them: the panel's controls, which is what a click is aimed at. */
function buttons(root: ParentNode, selector: string): HTMLButtonElement[] {
	return Array.from(root.querySelectorAll(selector)).filter(
		(el): el is HTMLButtonElement => el.tagName === 'BUTTON',
	);
}

function primaryOf(root: ParentNode): HTMLButtonElement {
	const found = buttons(root, '.tablify-dlg-btn.is-primary');
	expect(found).toHaveLength(1);
	const first = found[0];
	if (first === undefined) {
		throw new Error('the panel rendered no primary action');
	}
	return first;
}

function textOf(root: ParentNode, selector: string): string {
	return root.querySelector(selector)?.textContent ?? '';
}

describe('the conflict review', () => {
	it('shows one row per planned conflict — the counts are the plan’s, not a fixture’s', async () => {
		const plan = await buildPlan();
		// The fixture is only trustworthy if the plan really is the shape the table in the header claims.
		expect(plan.conflicts.map((conflict) => `${conflict.label}.${conflict.property}`)).toEqual([
			'Alpha.Status',
			'Beta.Due',
		]);
		expect(plan.counts.conflicts).toBe(2);
		expect(plan.conflicts).toHaveLength(2);

		const state = reviewStateOf({ conflicts: plan.conflicts });
		expect(reviewCounts(state).total).toBe(plan.counts.conflicts);
		expect(reviewCounts(state).waiting).toBe(plan.counts.conflicts);
		// The two conflicts are on two notes, and the local-only field never enters the dialog.
		expect(reviewRows(state)).toHaveLength(2);
		expect(reviewCounts(state).notes).toBe(0);
	});

	it('cannot be confirmed until every conflict has a choice, and says why', async () => {
		const plan = await buildPlan();
		const { ui, record, panel } = fakeHost(plan.conflicts);
		const primary = primaryOf(ui.contentEl);

		expect(primary.disabled).toBe(true);
		expect(primary.getAttribute('title')).toContain('2 fields still need a choice');
		expect(textOf(ui.contentEl, '.tablify-live')).toContain('2 fields still need a choice');
		// Pressing it is not merely refused by a guard: nothing is attached to it, and a click changes nothing.
		primary.click();
		expect(record.confirmed).toHaveLength(0);

		const rows = reviewRows(panel.snapshot());
		const first = rows[0]?.rows[0];
		if (first === undefined) {
			throw new Error('the panel rendered no rows');
		}
		panel.choose(first.key, 'remote');

		expect(panel.snapshot().choices.size).toBe(1);
		expect(primaryOf(ui.contentEl).disabled).toBe(true);
		// The singular sentence, spelled out: a "1 fields" reads like a machine wrote it.
		expect(primaryOf(ui.contentEl).getAttribute('title')).toBe(
			'One field still needs a choice — pick “Keep mine” or “Use remote” for it.',
		);
		// A choice re-renders rather than appends: the body is rebuilt, never grown.
		expect(panel.renders).toBe(2);
		expect(buttons(ui.contentEl, '.tablify-dlg-btn.is-primary')).toHaveLength(1);
	});

	it('records a choice per field, with the two values side by side', async () => {
		const plan = await buildPlan();
		const { ui, panel } = fakeHost(plan.conflicts);
		const rows = nodes(ui.contentEl, '.tablify-conflict-row');
		expect(rows).toHaveLength(2);

		const first = rows[0];
		if (first === undefined) {
			throw new Error('no first row');
		}
		const localSide = buttons(first, '[data-side="local"]')[0];
		const remoteSide = buttons(first, '[data-side="remote"]')[0];
		if (localSide === undefined || remoteSide === undefined) {
			throw new Error('a row without both sides');
		}
		// Side by side, with the values themselves: this is what "per-field diff, never silent" looks like.
		expect(localSide.textContent).toContain('mine');
		expect(remoteSide.textContent).toContain('theirs');
		expect(first.textContent).toContain('Status · changed on both sides');
		// The note is the group's heading rather than repeated per row: one conflict per field, grouped by note.
		expect(textOf(ui.contentEl, '.tablify-conflict-head')).toContain('Alpha');
		expect(nodes(ui.contentEl, '.tablify-conflict-head')).toHaveLength(2);
		expect(localSide.getAttribute('aria-pressed')).toBe('false');

		expect(panel.snapshot().choices.size).toBe(0);
		remoteSide.click();
		expect(panel.snapshot().choices.size).toBe(1);
		const chosen = reviewRows(panel.snapshot())[0]?.rows[0];
		expect(chosen?.choice).toBe('remote');
		const pressed = nodes(ui.contentEl, '.tablify-conflict-row')[0];
		expect(pressed?.querySelector('[data-side="remote"]')?.getAttribute('aria-pressed')).toBe(
			'true',
		);
	});

	it('shows the raw values when they differ from what the column displays', async () => {
		const plan = await buildPlan();
		const state = reviewStateOf({ conflicts: plan.conflicts });
		const due = reviewRows(state)
			.flatMap((group) => group.rows)
			.find((row) => row.property === 'Due');
		if (due === undefined) {
			throw new Error('the fixture lost its date conflict');
		}
		// A date column displays `1 Nov 2026` and holds `2026-11-01`: the raw line is what a person needs to decide.
		expect(due.localText).not.toBe(due.local);
		expect(due.raw).toContain('2026-11-01');
		expect(due.raw).toContain('2026-12-01');

		const { ui } = fakeHost(plan.conflicts);
		expect(textOf(ui.contentEl, '.tablify-conflict-raw')).toContain('2026-11-01');
		// The rule behind it, stated directly: equal strings mean no third line.
		expect(rawLine('same', 'same', 'same', 'same')).toBeNull();
		expect(rawText(null)).toBe('(empty)');
		expect(rawText(['a', 'b'])).toBe('a, b');
	});

	it('take-all fills the book, enables the primary action and reports what will be written where', async () => {
		const plan = await buildPlan();
		const { ui, record, panel } = fakeHost(plan.conflicts);
		const bulk = buttons(ui.contentEl, '.tablify-lg-bulk .tablify-dlg-btn');
		expect(bulk).toHaveLength(2);
		const takeAllMine = bulk[0];
		if (takeAllMine === undefined) {
			throw new Error('no take-all-mine button');
		}
		takeAllMine.click();

		const counts = reviewCounts(panel.snapshot());
		expect(counts).toEqual({
			total: 2,
			chosen: 2,
			waiting: 0,
			toLocal: 0,
			toRemote: 2,
			notes: 2,
		});
		expect(reviewCanRun(counts)).toEqual({ ok: true, reason: null });
		expect(reviewLines(panel.snapshot()).map((line) => line.text)).toContain(
			'Will write 2 record field(s) in the remote table across 2 note(s) · 0 still to decide.',
		);

		const primary = primaryOf(ui.contentEl);
		expect(primary.disabled).toBe(false);
		// The reason is gone from both places it lived, because there is nothing left to refuse.
		expect(primary.getAttribute('title')).toBeNull();
		expect(textOf(ui.contentEl, '.tablify-live')).toBe('');

		// The other bulk action is the same code path, backwards.
		const takeAllRemote = bulk[1];
		takeAllRemote?.click();
		expect(reviewCounts(panel.snapshot())).toEqual({
			total: 2,
			chosen: 2,
			waiting: 0,
			toLocal: 2,
			toRemote: 0,
			notes: 2,
		});

		primary.click();
		await Promise.resolve();
		expect(record.confirmed).toHaveLength(1);
		const book = record.confirmed[0];
		expect(book?.size).toBe(2);
		expect([...(book?.values() ?? [])].map((resolution) => resolution.kind)).toEqual([
			'remote',
			'remote',
		]);
		expect(record.finished).toEqual([{ cancelled: false }]);
		expect(record.closes).toBe(1);
		// Re-rendering on every choice is what keeps the counts honest; the panel never accumulates rows. Three
		// renders: the open, and one per bulk action — confirming closes rather than drawing again.
		expect(panel.renders).toBe(3);
	});

	it('cancelling reaches the host and writes nothing', async () => {
		const plan = await buildPlan();
		const { ui, record } = fakeHost(plan.conflicts);
		const cancel = buttons(ui.contentEl, '.tablify-dlg-foot .tablify-dlg-btn').find(
			(button) => button.textContent === 'Cancel',
		);
		if (cancel === undefined) {
			throw new Error('no cancel button');
		}
		cancel.click();
		expect(record.confirmed).toHaveLength(0);
		expect(record.finished).toEqual([{ cancelled: true }]);
		expect(record.closes).toBe(1);
	});

	it('bulkChoice is a pure state change: it neither renders nor writes', async () => {
		const plan = await buildPlan();
		const state: ReviewState = reviewStateOf({ conflicts: plan.conflicts });
		const after = bulkChoice(state, 'local');
		expect(state.choices.size).toBe(0);
		expect(after.choices.size).toBe(2);
		// The direction that is easy to get backwards, stated once: keeping your own value means **writing it to
		// the remote table**. So "take all mine" produces remote writes, not local ones.
		expect(reviewCounts(after).toRemote).toBe(2);
		expect(reviewCounts(after).toLocal).toBe(0);
		// Idempotent: taking all mine twice is the same book, not a doubled one.
		expect([...bulkChoice(after, 'local').choices]).toEqual([...after.choices]);
	});

	it('says there is nothing to review rather than rendering an empty body', async () => {
		const { ui } = fakeHost([]);
		expect(textOf(ui.contentEl, '.tablify-dlg-body')).toContain('Nothing to review');
		expect(reviewCanRun(reviewCounts(reviewStateOf({ conflicts: [] })))).toEqual({
			ok: false,
			reason: 'There is nothing to review — the two sides already agree.',
		});
	});
});
