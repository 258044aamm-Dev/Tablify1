/**
 * The paste dialog: **how a big block lands**, with the counts on screen before anything is written.
 *
 * `docs/01` §Import semantics is the rule this dialog exists to obey — *"the preview dialog is mandatory and
 * must state consequences"* — and the three ways of landing a block are the prototype's (`PASTE_MODES`). The
 * dialog does not invent a fourth: it shows all three, each with **its own numbers** ("N cells updated",
 * "N notes created"), because the choice is exactly a choice between those numbers.
 *
 * Two things are deliberate:
 *
 *   · **The notes are counted, not implied.** A paste that appends rows creates *files*, and a file is not
 *     something an undo takes back. The dialog says how many, in the product's own voice, before the button.
 *   · **The large-import warning repeats the escape hatch.** `docs/01` §Import semantics: above the threshold the
 *     dialog adds an explicit warning and defaults the cursor to the `.tabula` option. The grid cannot create a
 *     `.tabula` file itself (that is the view's, and step 24's export path), so it says so and does not pretend
 *     otherwise: the warning names the alternative, and Cancel is a real choice.
 *
 * The primary button runs the **currently chosen** mode — the first one by default, so the common case is one
 * click — and every choice is a real `<button>` with `aria-pressed`, so a keyboard reaches them the same way.
 */
import { PASTE_MODES, describePlan, planPaste } from '../clipboard/pastePlan';
import type { App } from 'obsidian';
import type { DialogSpec } from './base';
import type { PasteModeId, PastePlan, PastePlanInput, PasteSetting } from '../clipboard/pastePlan';

export type PasteBlockInput = {
	readonly app: App | null;
	/** Everything the three plans need except the mode: the block, the view, the anchor, the settings. */
	readonly base: Omit<PastePlanInput, 'mode'>;
	readonly setting: PasteSetting;
	readonly warnOnLargeImport: boolean;
	readonly largeImportThreshold: number;
	/** Called with the chosen mode when the person confirms. Never called on Cancel. */
	readonly onChoose: (mode: PasteModeId) => void;
};

/** The three plans, computed once, so the numbers in the dialog are the numbers the paste will produce. */
export function plansByMode(base: Omit<PastePlanInput, 'mode'>): readonly {
	readonly id: PasteModeId;
	readonly plan: PastePlan;
}[] {
	return PASTE_MODES.map((mode) => ({
		id: mode.id,
		plan: planPaste({ ...base, mode: mode.id }),
	}));
}

/** One line under a choice: what *this* mode would do, in counts. */
export function choiceCounts(plan: PastePlan): string {
	const parts: string[] = [];
	if (plan.writes.length > 0) {
		parts.push(`${plan.writes.length.toLocaleString('en-GB')} cell(s) updated`);
	}
	if (plan.newRows.length > 0) {
		parts.push(`${plan.newRows.length.toLocaleString('en-GB')} note(s) created`);
	}
	if (plan.writes.length === 0 && plan.newRows.length === 0) {
		parts.push('nothing to write');
	}
	if (plan.skipped > 0) {
		parts.push(`${plan.skipped.toLocaleString('en-GB')} outside the table, ignored`);
	}
	if (plan.clipped > 0) {
		parts.push(`${plan.clipped.toLocaleString('en-GB')} left on the clipboard`);
	}
	if (plan.mappedBy !== null) {
		parts.push('matched by header name');
	}
	return parts.join(' · ');
}

/** The sentence the warning adds above the threshold. One wording, used by the test and the dialog. */
export function largeWarning(rows: number, threshold: number): string {
	return `${rows.toLocaleString('en-GB')} rows is above the large-import threshold (${threshold.toLocaleString('en-GB')}). This will create ${rows.toLocaleString('en-GB')} notes — one file each.`;
}

export function pasteBlockSpec(input: PasteBlockInput): DialogSpec {
	const { base, setting, warnOnLargeImport, largeImportThreshold, onChoose } = input;
	const plans = plansByMode(base);
	const first = plans[0];
	const rows = base.matrix.length;
	const columns = base.matrix.reduce((widest, row) => Math.max(widest, row.length), 0);
	let chosen: PasteModeId = first === undefined ? 'cells' : first.id;

	const warn =
		warnOnLargeImport &&
		(base.matrix.length > largeImportThreshold || base.matrix.length > 60) &&
		base.setting !== 'fill';

	return {
		kind: 'dialog',
		title: `Paste ${rows.toLocaleString('en-GB')} × ${columns.toLocaleString('en-GB')} block`,
		subtitle: 'Choose how it lands. The numbers are what will change.',
		body: ({ contentEl }) => {
			if (warn) {
				const warning = contentEl.createDiv({ cls: 'tablify-dlg-warning' });
				warning.createSpan({
					cls: 'tablify-dlg-warning-text',
					text: largeWarning(rows, largeImportThreshold),
				});
			}
			const list = contentEl.createDiv({ cls: 'tablify-dlg-choices' });
			const buttons = new Map<PasteModeId, HTMLButtonElement>();
			for (const mode of PASTE_MODES) {
				const found = plans.find((candidate) => candidate.id === mode.id);
				const plan = found === undefined ? null : found.plan;
				const button = list.createEl('button', { cls: 'tablify-dlg-choice' });
				button.type = 'button';
				button.createSpan({ cls: 'tablify-dlg-choice-name', text: mode.name });
				button.createSpan({ cls: 'tablify-dlg-choice-desc', text: mode.desc });
				if (plan !== null) {
					button.createSpan({
						cls: 'tablify-dlg-choice-counts',
						text: choiceCounts(plan),
					});
				}
				button.setAttribute('aria-pressed', String(mode.id === chosen));
				if (mode.id === chosen) {
					button.addClass('is-chosen');
				}
				button.addEventListener('click', () => {
					chosen = mode.id;
					for (const [id, other] of buttons) {
						const picked = id === chosen;
						other.setAttribute('aria-pressed', String(picked));
						other.toggleClass('is-chosen', picked);
					}
				});
				buttons.set(mode.id, button);
			}
			// The block itself, first four rows: enough to recognise what was copied and short enough to read.
			const preview = contentEl.createDiv({ cls: 'tablify-dlg-preview' });
			for (const row of base.matrix.slice(0, 4)) {
				preview.createDiv({
					cls: 'tablify-dlg-preview-row',
					text: row.slice(0, 6).join(' | '),
				});
			}
			if (base.matrix.length > 4) {
				preview.createDiv({
					cls: 'tablify-dlg-preview-row is-more',
					text: `… ${(base.matrix.length - 4).toLocaleString('en-GB')} more row(s)`,
				});
			}
			contentEl.createDiv({
				cls: 'tablify-dlg-hint',
				text:
					setting === 'fill'
						? 'Set to fill the selection only: rows past the end of the table stay on the clipboard.'
						: 'Rows past the end of the table become notes in the folder from your settings.',
			});
		},
		primary: {
			label: 'Paste',
			run: () => {
				onChoose(chosen);
			},
		},
		secondary: { label: 'Cancel', run: () => undefined },
	};
}

/** The wording a test (and the live region) reads back after a plan is applied. */
export function appliedSentence(plan: PastePlan): string {
	return describePlan(plan);
}
