/**
 * The conflict review: **side by side, one choice per field, and a primary action that cannot be pressed early.**
 *
 * `docs/01` §Sync UX asks for four things of this dialog — *"changed fields per row (local value vs remote value,
 * per-field choice), with bulk actions ('take all local', 'take all remote') and a visible count of what will be
 * written where"* — and `docs/08` §P8 adds the rule that makes it matter: *"per-field diff, never silent"*. So the
 * interesting parts of this file are the two that enforce it rather than the layout:
 *
 *   · **the primary action is disabled until every conflict has a choice**, with the reason on the button
 *     (`title`) *and* in the footer sentence, because a disabled control with no reason is its own bug;
 *   · **the count is computed from the book**, not from the plan: *"Will write 4 cells into 2 notes"* counts the
 *     choices that have been made, so the number moves as the person decides and is never a promise about an
 *     average case.
 *
 * ## What it does not show, and why
 *
 * The prompt asks for the *"base value when it differs"* as a third column. There is no base **value** to show:
 * `docs/03` §Sync state stores `sha256:…` per field per record — deliberately, so a link file never becomes a
 * second copy of the vault — and a hash cannot be rendered back into a value. What the hashes *can* answer is which
 * side moved, which is what each row states above its two values (`changed here`, `changed remotely`, or both).
 * That is the whole of the three-way information the design keeps, and inventing a plausible third value would be
 * worse than showing two.
 *
 * Like the export dialog, the file is in two halves: the pure functions first (`reviewRows`, `reviewLines`,
 * `reviewCanRun` — data in, data out, asserted in `tests/dom/conflict-review.test.tsx`), then a panel that turns
 * that data into elements, then a six-line `Modal`.
 */
import { Modal } from 'obsidian';
import type { App } from 'obsidian';

import { closeSurface, openSurface, openerOf } from '../../grid/a11y/focusContract';
import type { FocusSurface } from '../../grid/a11y/focusContract';
import { fieldKey } from '../../sync/diff';
import type { ConflictResolution, ResolutionBook } from '../../sync/diff';
import type { PlannedConflict } from '../../sync/pullPush';
import type { CellValue } from '../../core/types';

/** What the panel reads and writes: the conflicts, and the choices made so far. */
export type ConflictReviewSpec = {
	readonly conflicts: readonly PlannedConflict[];
	/** The choices already made, when the dialog is reopened. */
	readonly choices?: ResolutionBook | undefined;
};

/** One row of the body: two values, one field, and which side moved. */
export type ReviewRow = {
	readonly key: string;
	readonly recordId: string;
	readonly path: string;
	readonly label: string;
	readonly property: string;
	readonly local: CellValue;
	readonly remote: CellValue;
	readonly localText: string;
	readonly remoteText: string;
	/**
	 * The two values in their **raw** form, and only when that says something the display does not.
	 *
	 * The prompt's constraint (`a user choosing between two numbers needs both`): a date column displays `6 Oct 2026`
	 * while the vault holds `2026-10-06`, and a number column displays its formatted reading while the vault holds the
	 * bare number. Two rows that read the same but hold different bytes are exactly the case a person cannot decide
	 * from the display, so the raw line appears only when it differs — see {@link rawLine}.
	 */
	readonly raw: string | null;
	readonly movedLocally: boolean;
	readonly movedRemotely: boolean;
	readonly choice: 'local' | 'remote' | null;
};

/** A row's worth of fields: the dialog groups by note, because that is how a person thinks about them. */
export type ReviewGroup = {
	readonly recordId: string;
	readonly path: string;
	readonly label: string;
	readonly rows: readonly ReviewRow[];
};

/** The dialog's own state: the conflicts and the book. Nothing else is remembered between renders. */
export type ReviewState = {
	readonly conflicts: readonly PlannedConflict[];
	readonly choices: ResolutionBook;
};

/** The state a review opens with: whatever was already chosen, and nothing invented for the rest. */
export function reviewStateOf(spec: ConflictReviewSpec): ReviewState {
	return {
		conflicts: spec.conflicts,
		choices: spec.choices ?? new Map<string, ConflictResolution>(),
	};
}

/** The rows, grouped by note, in the plan's order. */
export function reviewRows(state: ReviewState): readonly ReviewGroup[] {
	const groups = new Map<
		string,
		{ recordId: string; path: string; label: string; rows: ReviewRow[] }
	>();
	for (const conflict of state.conflicts) {
		const key = fieldKey(conflict.recordId, conflict.property);
		const group = groups.get(conflict.recordId) ?? {
			recordId: conflict.recordId,
			path: conflict.path,
			label: conflict.label,
			rows: [],
		};
		group.rows.push({
			key,
			recordId: conflict.recordId,
			path: conflict.path,
			label: conflict.label,
			property: conflict.property,
			local: conflict.local,
			remote: conflict.remote,
			localText: conflict.localText,
			remoteText: conflict.remoteText,
			raw: rawLine(conflict.local, conflict.remote, conflict.localText, conflict.remoteText),
			movedLocally: conflict.movedLocally,
			movedRemotely: conflict.movedRemotely,
			choice: state.choices.get(key)?.kind ?? null,
		});
		groups.set(conflict.recordId, group);
	}
	return [...groups.values()];
}

/**
 * A value as text, the way the vault holds it rather than the way the column renders it.
 *
 * Deliberately plain: `String(value)` for the scalars, a comma-joined list for a list (which is how YAML holds one),
 * and the two absences spelled out — because `null` versus `""` is a difference a person deciding a conflict needs,
 * and `"null"` versus `""` is not a difference anything else in this plugin prints.
 */
export function rawText(value: CellValue): string {
	if (value === null || value === undefined) {
		return '(empty)';
	}
	// The union is `string | number | boolean | null | readonly string[]`, and `Array.isArray` would widen the last
	// member to `any[]` — so the scalars are checked by `typeof` and the list case is what remains.
	if (typeof value === 'string') {
		return value === '' ? '(empty)' : value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return value.length === 0 ? '(empty list)' : value.join(', ');
}

/**
 * The raw line for a row, or `null` when the display already says everything the raw values would.
 *
 * Both sides are compared, not each on its own: a row whose local display is shortened and whose remote is not still
 * needs the line, because the person is choosing between the two raw values.
 */
export function rawLine(
	local: CellValue,
	remote: CellValue,
	localText: string,
	remoteText: string,
): string | null {
	const localRaw = rawText(local);
	const remoteRaw = rawText(remote);
	if (localRaw === localText && remoteRaw === remoteText) {
		return null;
	}
	return `In the vault: ${localRaw}  ·  remote: ${remoteRaw}`;
}

/** The sentence the footer carries, and the button's `title`. */
export type ReviewRefusal = { readonly ok: boolean; readonly reason: string | null };

/**
 * Whether the primary action may run, and why not.
 *
 * Two conditions, and both are hard: every conflict needs a choice, and there has to be something to write. The
 * count is stated in the same breath, because *"what will be written where"* is the question this dialog exists to
 * answer — `docs/01` §Sync UX again.
 */
export function reviewCanRun(counts: ReviewCounts): ReviewRefusal {
	if (counts.total === 0) {
		return { ok: false, reason: 'There is nothing to review — the two sides already agree.' };
	}
	if (counts.waiting > 0) {
		return {
			ok: false,
			reason:
				counts.waiting === 1
					? 'One field still needs a choice — pick “Keep mine” or “Use remote” for it.'
					: `${String(counts.waiting)} fields still need a choice — pick one for each.`,
		};
	}
	return { ok: true, reason: null };
}

/** What the choices add up to. This is the dialog's number, and it is built from the book rather than the plan. */
export type ReviewCounts = {
	readonly total: number;
	readonly chosen: number;
	readonly waiting: number;
	readonly toLocal: number;
	readonly toRemote: number;
	/** Notes that will be written, on either side. */
	readonly notes: number;
};

export function reviewCounts(state: ReviewState): ReviewCounts {
	let chosen = 0;
	let toLocal = 0;
	let toRemote = 0;
	const notes = new Set<string>();
	for (const conflict of state.conflicts) {
		const choice = state.choices.get(fieldKey(conflict.recordId, conflict.property));
		if (choice === undefined) {
			continue;
		}
		chosen += 1;
		notes.add(conflict.path);
		if (choice.kind === 'local') {
			toRemote += 1;
		} else {
			toLocal += 1;
		}
	}
	return {
		total: state.conflicts.length,
		chosen,
		waiting: state.conflicts.length - chosen,
		toLocal,
		toRemote,
		notes: notes.size,
	};
}

/** One line of the body. `kind` picks the element; nothing here is an element. */
export type ReviewLine = { readonly kind: 'fact' | 'warning' | 'count'; readonly text: string };

/** The body's lines: the fact, the count, and the warning when choices are still missing. */
export function reviewLines(state: ReviewState): readonly ReviewLine[] {
	const counts = reviewCounts(state);
	const lines: ReviewLine[] = [
		{
			kind: 'fact',
			text: 'Both sides changed these fields since the last sync. Nothing is written for a field until you choose.',
		},
	];
	const parts: string[] = [];
	if (counts.toLocal > 0) {
		parts.push(`${String(counts.toLocal)} cell(s) into your notes`);
	}
	if (counts.toRemote > 0) {
		parts.push(`${String(counts.toRemote)} record field(s) in the remote table`);
	}
	lines.push({
		kind: 'count',
		text:
			parts.length === 0
				? `0 of ${String(counts.total)} field(s) decided — nothing will be written yet.`
				: `Will write ${parts.join(' and ')} across ${String(counts.notes)} note(s) · ${String(counts.waiting)} still to decide.`,
	});
	if (counts.waiting > 0) {
		lines.push({
			kind: 'warning',
			text: 'A conflict is never resolved for you: the primary action stays disabled until every field has a choice.',
		});
	}
	return lines;
}

/** The result of pressing the primary action: what the choices were, and how they were applied. */
export type ReviewOutcome = {
	readonly choices: ResolutionBook;
	readonly cancelled: boolean;
};

/** What the review needs of the caller: where the result goes. The engine is called by the caller, not here. */
export type ConflictReviewHost = {
	readonly spec: ConflictReviewSpec;
	/** Called when the person confirms. The choices are complete — that is what the disabled state guarantees. */
	readonly onConfirm: (choices: ResolutionBook) => Promise<string> | string;
	/** Called when the dialog closes without confirming. `cancelled` is what the test asserts on. */
	readonly onFinished?: ((outcome: ReviewOutcome) => void) | undefined;
};

/** Where the panel renders and how it closes. The same shape the export panel uses. */
export type ReviewUi = {
	readonly contentEl: HTMLElement;
	readonly close: () => void;
};

/** Both bulk actions, so the panel's two buttons and the tests' two calls are the same code path. */
export function bulkChoice(state: ReviewState, kind: 'local' | 'remote'): ReviewState {
	const choices = new Map(state.choices);
	for (const conflict of state.conflicts) {
		choices.set(fieldKey(conflict.recordId, conflict.property), { kind });
	}
	return { ...state, choices };
}

/**
 * The panel: renders the state, turns clicks into state, and calls `onConfirm` when the person is ready.
 *
 * It never writes anything itself. The engine call belongs to the host, because the panel's job is to collect a
 * decision and the decision's consequences are the engine's.
 */
export class ConflictReviewPanel {
	private readonly host: ConflictReviewHost;
	private readonly ui: ReviewUi;
	private state: ReviewState;
	private done = false;
	/** How many times the body has been rebuilt: a test reads this to prove a choice re-rendered rather than appended. */
	renders = 0;

	constructor(host: ConflictReviewHost, ui: ReviewUi) {
		this.host = host;
		this.ui = ui;
		this.state = reviewStateOf(host.spec);
		this.render();
	}

	snapshot(): ReviewState {
		return this.state;
	}

	/** One render: subtitle, groups of rows, footer. Everything a person reads is built here and nowhere else. */
	render(): void {
		const { contentEl } = this.ui;
		contentEl.empty();
		this.renders += 1;
		contentEl.createDiv({
			cls: 'tablify-dlg-sub',
			text: 'Per field, side by side. Your choice decides which value survives.',
		});
		const body = contentEl.createDiv({ cls: 'tablify-dlg-body' });
		for (const line of reviewLines(this.state)) {
			body.createDiv({
				cls: `tablify-dlg-${line.kind === 'count' ? 'count' : line.kind}`,
				text: line.text,
			});
		}
		const groups = reviewRows(this.state);
		if (groups.length === 0) {
			body.createDiv({
				cls: 'tablify-dlg-fact',
				text: 'Nothing to review: the two sides already agree.',
			});
		}
		for (const group of groups) {
			const box = body.createDiv({ cls: 'tablify-conflict-group' });
			box.createDiv({ cls: 'tablify-conflict-head', text: `${group.label} — ${group.path}` });
			for (const row of group.rows) {
				const line = box.createDiv({ cls: 'tablify-conflict-row' });
				const why =
					row.movedLocally && row.movedRemotely
						? 'changed on both sides'
						: row.movedLocally
							? 'changed here'
							: 'changed remotely';
				line.createDiv({ cls: 'tablify-conflict-prop', text: `${row.property} · ${why}` });
				if (row.raw !== null) {
					// The displayed pair is on the two buttons; this is what is actually stored, shown only when the two
					// disagree (`rawLine`).
					line.createDiv({ cls: 'tablify-conflict-raw', text: row.raw });
				}
				const pair = line.createDiv({ cls: 'tablify-conflict-pair' });
				for (const side of ['local', 'remote'] as const) {
					const isLocal = side === 'local';
					const button = pair.createEl('button', { cls: 'tablify-lg-choice' });
					button.type = 'button';
					if (row.choice === side) {
						button.addClass('is-picked');
					}
					button.setAttribute('aria-pressed', String(row.choice === side));
					button.setAttribute('data-side', side);
					button.createSpan({
						cls: 'tablify-dlg-choice-name',
						text: isLocal ? 'Keep mine' : 'Use remote',
					});
					button.createSpan({
						cls: 'tablify-dlg-choice-desc',
						text: isLocal ? row.localText : row.remoteText,
					});
					button.addEventListener('click', () => {
						this.choose(row.key, side);
					});
				}
			}
		}
		const foot = contentEl.createDiv({ cls: 'tablify-dlg-foot' });
		const bulk = foot.createDiv({ cls: 'tablify-lg-bulk' });
		for (const kind of ['local', 'remote'] as const) {
			const button = bulk.createEl('button', {
				cls: 'tablify-dlg-btn',
				text: kind === 'local' ? 'Take all mine' : 'Take all remote',
			});
			button.addEventListener('click', () => {
				this.state = bulkChoice(this.state, kind);
				this.render();
			});
		}
		const counts = reviewCounts(this.state);
		const refusal = reviewCanRun(counts);
		if (refusal.reason !== null) {
			foot.createDiv({ cls: 'tablify-live', text: refusal.reason });
		}
		const primary = foot.createEl('button', {
			cls: 'tablify-dlg-btn is-primary',
			text: 'Apply choices',
		});
		if (refusal.ok) {
			primary.addEventListener('click', () => {
				void this.confirm();
			});
		} else {
			// Disabled **and** explained: the sentence is in the footer for everyone, and the `title` carries it to a
			// pointer. `docs/04` §Accessibility: a disabled control with no reason is a bug of its own.
			primary.disabled = true;
			primary.setAttribute('title', refusal.reason ?? '');
		}
		foot.createEl('button', { cls: 'tablify-dlg-btn', text: 'Cancel' }).addEventListener(
			'click',
			() => {
				this.cancel();
			},
		);
	}

	/** One choice for one field. Choosing the same side twice is idempotent, as a toggle-free control should be. */
	choose(key: string, kind: 'local' | 'remote'): void {
		const choices = new Map(this.state.choices);
		choices.set(key, { kind });
		this.state = { ...this.state, choices };
		this.render();
	}

	/** The person is done. The host applies the choices; a sentence comes back for the footer. */
	async confirm(): Promise<void> {
		const refusal = reviewCanRun(reviewCounts(this.state));
		if (!refusal.ok) {
			return;
		}
		this.done = true;
		await this.host.onConfirm(this.state.choices);
		this.host.onFinished?.({ choices: this.state.choices, cancelled: false });
		this.ui.close();
	}

	/** Closing without confirming. The caller still hears about it, so "cancelling wrote nothing" is assertable. */
	cancel(): void {
		if (!this.done) {
			this.host.onFinished?.({ choices: this.state.choices, cancelled: true });
		}
		this.ui.close();
	}
}

/** The shipping surface: Obsidian's `Modal`, with the panel inside it. Six lines of glue, like `ExportDialog`. */
export class ConflictReviewDialog extends Modal {
	private readonly host: ConflictReviewHost;
	private readonly surface: FocusSurface;

	constructor(app: App, host: ConflictReviewHost) {
		super(app);
		this.host = host;
		this.surface = openSurface(
			'dialog',
			this.contentEl,
			typeof document === 'undefined' ? null : openerOf(document),
		);
	}

	onOpen(): void {
		this.titleEl.setText('Review changes');
		new ConflictReviewPanel(this.host, {
			contentEl: this.contentEl,
			close: () => {
				this.close();
			},
		});
	}

	onClose(): void {
		closeSurface(this.surface);
		this.contentEl.empty();
	}
}
