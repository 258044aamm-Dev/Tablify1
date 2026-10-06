/**
 * The clipboard's **flow**: read → plan → (ask) → apply. React-free, host-free and dialog-free, so the three
 * paste modes can be exercised end to end without a browser, a modal or a permission prompt.
 *
 * The pieces around it each own one thing — `host.ts` talks to the browser, `matrix.ts` converts, `pastePlan.ts`
 * decides, `PasteBlockDialog.ts` asks — and this file is the order they happen in:
 *
 * ```
 *   payload ──readAndPlan──▶ plan ──needsDialog?──▶ ask ──▶ apply(plan)
 *                              └───────────────────────────▶ apply(plan)
 * ```
 *
 * Two properties are load-bearing and are asserted rather than commented:
 *
 *   · **A plan that is not applied writes nothing.** `applyPlan` takes a plan; there is no path from a payload
 *     to a write that skips the plan.
 *   · **Row creation happens once, for the whole list.** `createRows` is called with every row the plan wants,
 *     so a cancel means no notes, and a failure means the notes that were created are reported by name rather
 *     than half-written into a table nobody can reconcile.
 */
import { setCells } from '../store/commands';
import { pasteLabel } from './pastePlan';
import type { GridStore } from '../store/types';
import type { NewRowValues, PastePlan } from './pastePlan';
import type { RowId } from '../../core/ops/types';

/** What the view must be able to do for a paste to create rows: make notes, and say which rows they became. */
export type CreateRows = (rows: readonly NewRowValues[]) => Promise<readonly RowId[]>;

/** The answer to "apply this plan": what happened, in the terms the live region speaks. */
export type PasteOutcome = {
	readonly written: number;
	readonly created: number;
	readonly failure: string | null;
};

/**
 * Applies a plan. The writes go through the store's own `setCells` — **one** op, one undo step, one queued
 * batch, whatever the size — and the rows are created by the view *before* them, because a write into a row
 * that does not exist yet is a write into nothing.
 *
 * When the plan wants rows and no `createRows` was handed in, the writes still happen and the absence is
 * reported: the grid can fill what exists, and the person is told what could not be created rather than being
 * shown a paste that silently did two thirds of its job.
 */
export async function applyPlan(
	store: GridStore,
	plan: PastePlan,
	options: {
		readonly createRows?: CreateRows | undefined;
		readonly onCreated?: ((paths: readonly RowId[]) => void) | undefined;
	},
): Promise<PasteOutcome> {
	let created = 0;
	let failure: string | null = null;
	if (plan.newRows.length > 0) {
		if (options.createRows === undefined) {
			failure =
				plan.writes.length > 0
					? 'This view cannot create notes, so the rows past the end of the table were not created.'
					: 'This view cannot create notes, so nothing was pasted.';
		} else {
			try {
				const paths = await options.createRows(plan.newRows);
				created = paths.length;
				options.onCreated?.(paths);
				if (paths.length < plan.newRows.length) {
					failure = `${String(plan.newRows.length - paths.length)} row(s) could not be created.`;
				}
			} catch (error) {
				// A failed note creation is data, not an exception: the paste reports it and keeps whatever did
				// land, because half a paste that says so is better than a rollback nobody asked for.
				failure = error instanceof Error ? error.message : 'creating the notes failed';
			}
		}
	}
	const written = plan.writes.length > 0 ? setCells(store, plan.writes, pasteLabel(plan)) : null;
	if (written !== null && !written.ok) {
		failure = written.reason;
	}
	return {
		written: written !== null && written.ok ? plan.writes.length : 0,
		created,
		failure,
	};
}

/** The sentence the live region carries after a paste. Counts first, news second. */
export function pasteSentence(outcome: PasteOutcome): string {
	const parts: string[] = [];
	if (outcome.written > 0) {
		parts.push(`${outcome.written.toLocaleString('en-GB')} cell(s) pasted`);
	}
	if (outcome.created > 0) {
		parts.push(`${outcome.created.toLocaleString('en-GB')} note(s) created`);
	}
	if (parts.length === 0) {
		parts.push(outcome.failure === null ? 'Nothing was pasted' : 'Nothing was pasted');
	}
	if (outcome.failure !== null) {
		parts.push(outcome.failure);
	}
	return parts.join(' · ');
}
