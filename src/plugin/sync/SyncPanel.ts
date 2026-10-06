/**
 * The sync panel: **link state, the field mapping, and the two buttons that say what they will do.**
 *
 * `docs/01` §Sync UX: *"Default is **manual**"* — the two actions are explicit buttons, never a background job — with
 * one base+table per view (`docs/08` §P7) and a link that lives in `.tablify/links/`. `docs/01` §Export for the other half of a
 * panel: the action's own count belongs **on** the action, so nobody presses a button that moves 480 cells without
 * having been told it was 480.
 *
 * Four things this panel states, in this order, because each one is a question a person actually has:
 *
 *   1. **what this view is linked to** (`describeLink`'s sentence), or that it is not linked and what linking
 *      would need;
 *   2. **the field mapping** — every local property against the remote field it writes, with the two unmatched
 *      lists called out (`docs/08` §P9: *"Local properties with no remote counterpart are skipped and reported"*);
 *   3. **the plan's numbers on the two buttons** — `Pull 12 notes · 480 fields` — computed before either runs;
 *   4. **where the link file is**, by path, because *"deleting this folder is safe: it only loses sync linkage"* is
 *      a sentence a person can only act on if they can find the folder.
 *
 * The panel collects presses and renders state; the **host** owns the engine, the token and the client. That split
 * is what makes this file testable with a fake host and no network, and it is why nothing here imports
 * the provider client under `src/sync/`.
 */
import { Modal } from 'obsidian';
import type { App } from 'obsidian';

import { closeSurface, openSurface, openerOf } from '../../grid/a11y/focusContract';
import type { FocusSurface } from '../../grid/a11y/focusContract';
import { pullLabel, pushLabel } from '../../sync/pullPush';
import type { PlanCounts } from '../../sync/pullPush';
import type { UnmappedField } from '../../sync/SyncTarget';
import type { LinkDocument } from '../../sync/LinkStore';

/** One row of the mapping table: a local property, the remote field it writes, and what is missing. */
export type MappingRow = {
	readonly property: string;
	readonly remoteField: string | null;
	readonly note: string;
};

/** What the panel renders. All of it is data; the host computes it. */
export type SyncPanelState = {
	/** The link sentence from `describeLink`, or `null` when the view has no link file yet. */
	readonly link: string | null;
	/** The link file's path, so a person can find (or delete) it. */
	readonly linkPath: string;
	/** The mapping, one row per local property and one per unmatched remote field. */
	readonly mapping: readonly MappingRow[];
	/** The plan's counts, or `null` before a plan has been computed (a view with no link). */
	readonly counts: PlanCounts | null;
	/** Why the plan is not ready — a truncated read, or conflicts waiting — or `null`. */
	readonly blocked: string | null;
	/** How many fields need a choice. Drives whether the review dialog is offered at all. */
	readonly conflicts: number;
	/** True while the panel has no link: the two actions are unavailable and the panel says what to do instead. */
	readonly unlinked: boolean;
	/** True when a token is stored. Never the token itself: the panel is not a place a secret can be read from. */
	readonly hasToken: boolean;
	/** The last run's sentence, when there has been one. */
	readonly lastRun: string | null;
};

/** What the panel calls. `pull` and `push` run the engine; `review` opens the conflict dialog. */
export type SyncPanelHost = {
	readonly name: string;
	/** Called once when the panel opens, and again after every run. Answers the state to render. */
	readonly refresh: () => Promise<SyncPanelState>;
	/** Runs a pull. Resolves with a sentence for the panel and a flag for whether a review is needed. */
	readonly pull: () => Promise<{ readonly message: string; readonly needsReview: boolean }>;
	readonly push: () => Promise<{ readonly message: string; readonly needsReview: boolean }>;
	/** Opens the review dialog. Only offered when there is something to review. */
	readonly review: () => void;
	/** Writes a token, then re-reads the state. The panel never sees the value again. */
	readonly setToken: (token: string) => Promise<string>;
};

export type SyncUi = {
	readonly contentEl: HTMLElement;
	readonly close: () => void;
};

/** The lines above the mapping: what the link is, and where its file lives. */
export function panelLines(
	state: SyncPanelState,
): readonly { readonly kind: 'fact' | 'warning' | 'hint'; readonly text: string }[] {
	const lines: { kind: 'fact' | 'warning' | 'hint'; text: string }[] = [];
	if (state.unlinked) {
		lines.push({
			kind: 'warning',
			text: 'This view is not linked yet. Add an Airtable token in Settings › Tablify › Sync, then link this view to one base and one table.',
		});
	} else {
		lines.push({ kind: 'fact', text: state.link ?? 'Linked.' });
		lines.push({
			kind: 'hint',
			text: `Link file: ${state.linkPath} — deleting it only loses the link, never your notes.`,
		});
	}
	if (!state.hasToken) {
		lines.push({
			kind: 'warning',
			text: 'No Airtable token is stored. It lives in Obsidian’s secret storage, never in your vault.',
		});
	}
	if (state.blocked !== null) {
		lines.push({ kind: 'warning', text: state.blocked });
	}
	if (state.lastRun !== null) {
		lines.push({ kind: 'fact', text: state.lastRun });
	}
	return lines;
}

/** The mapping table's rows, from the link document and the resolver's report. */
export function mappingRows(
	document: LinkDocument | null,
	unmapped: readonly UnmappedField[],
): readonly MappingRow[] {
	if (document === null) {
		return [];
	}
	const byFieldId = new Map<string, string>();
	for (const [property, fieldId] of Object.entries(document.fieldMap)) {
		byFieldId.set(fieldId, property);
	}
	const rows: MappingRow[] = [];
	for (const [property, fieldId] of Object.entries(document.fieldMap)) {
		rows.push({ property, remoteField: fieldId, note: 'mapped' });
	}
	for (const field of unmapped) {
		if (field.side === 'local') {
			rows.push({
				property: field.name,
				remoteField: null,
				note: 'no remote field — skipped, never created (docs/08 §P9)',
			});
			continue;
		}
		// A remote field with no local column: report it against the property it *would* map to, which is nothing.
		rows.push({
			property: byFieldId.get(field.name) ?? '—',
			remoteField: field.name,
			note: 'no local column — skipped',
		});
	}
	return rows;
}

/** The two action labels, or a disabled pair when the view is not linked. */
export function actionLabels(state: SyncPanelState): {
	readonly pull: string;
	readonly push: string;
} {
	if (state.counts === null) {
		return { pull: 'Pull', push: 'Push' };
	}
	return { pull: pullLabel(state.counts), push: pushLabel(state.counts) };
}

/** Whether an action can run: it needs a link, a token, and a plan that is not blocked. */
export function actionRefusal(state: SyncPanelState): string | null {
	if (state.unlinked) {
		return 'This view is not linked to a table yet.';
	}
	if (!state.hasToken) {
		return 'Add an Airtable token in Settings › Tablify › Sync first.';
	}
	if (state.blocked !== null) {
		return state.blocked;
	}
	return null;
}

/**
 * The panel itself. Render, press, re-render — and every press goes to the host, which owns the engine.
 *
 * The four controls are deliberately plain buttons: the keyboard story for this surface is Obsidian's own modal
 * focus trap (`openSurface`), and a custom control would have to re-earn what that already gives.
 */
export class SyncPanel {
	private readonly host: SyncPanelHost;
	private readonly ui: SyncUi;
	private state: SyncPanelState;
	private busy = false;
	renders = 0;

	constructor(host: SyncPanelHost, ui: SyncUi, initial: SyncPanelState) {
		this.host = host;
		this.ui = ui;
		this.state = initial;
		this.render();
	}

	snapshot(): SyncPanelState {
		return this.state;
	}

	/** Re-reads the host's state and re-renders. Called on open and after every run. */
	async refresh(): Promise<void> {
		this.state = await this.host.refresh();
		this.render();
	}

	render(): void {
		const { contentEl } = this.ui;
		contentEl.empty();
		this.renders += 1;
		contentEl.createDiv({
			cls: 'tablify-dlg-sub',
			text: `One base and one table per view (docs/08 §P7). Sync is manual: nothing leaves or arrives until you press a button.`,
		});
		const body = contentEl.createDiv({ cls: 'tablify-dlg-body' });
		for (const line of panelLines(this.state)) {
			body.createDiv({ cls: `tablify-dlg-${line.kind}`, text: line.text });
		}
		const table = body.createDiv({ cls: 'tablify-sync-map' });
		for (const row of this.state.mapping) {
			const line = table.createDiv({ cls: 'tablify-sync-map-row' });
			line.createSpan({ cls: 'tablify-sync-map-local', text: row.property });
			line.createSpan({ cls: 'tablify-sync-map-remote', text: row.remoteField ?? '—' });
			line.createSpan({ cls: 'tablify-sync-map-note', text: row.note });
		}
		// The token field: write-only from the panel's side. `setToken` is the only thing that sees the value.
		const tokenRow = body.createDiv({ cls: 'tablify-lg-field' });
		tokenRow.createDiv({ cls: 'tablify-dlg-group-q', text: 'Airtable token' });
		const input = tokenRow.createEl('input', { cls: 'tablify-lg-input' });
		input.type = 'password';
		input.setAttribute(
			'placeholder',
			this.state.hasToken ? 'Stored — paste a new one to replace it' : 'pat…',
		);
		tokenRow
			.createEl('button', { cls: 'tablify-dlg-btn', text: 'Store token' })
			.addEventListener('click', () => {
				void this.storeToken(input);
			});

		const foot = contentEl.createDiv({ cls: 'tablify-dlg-foot' });
		const refusal = actionRefusal(this.state);
		if (refusal !== null) {
			foot.createDiv({ cls: 'tablify-live', text: refusal });
		}
		if (this.state.conflicts > 0 && !this.state.unlinked) {
			foot.createEl('button', {
				cls: 'tablify-dlg-btn',
				text: 'Review changes…',
			}).addEventListener('click', () => {
				this.host.review();
			});
		}
		const labels = actionLabels(this.state);
		for (const action of ['pull', 'push'] as const) {
			const button = foot.createEl('button', {
				cls: action === 'pull' ? 'tablify-dlg-btn is-primary' : 'tablify-dlg-btn',
				text: labels[action],
			});
			if (refusal !== null || this.busy) {
				button.disabled = true;
				button.setAttribute('title', refusal ?? 'A sync is already running.');
				continue;
			}
			button.addEventListener('click', () => {
				void this.run(action);
			});
		}
		foot.createEl('button', { cls: 'tablify-dlg-btn', text: 'Close' }).addEventListener(
			'click',
			() => {
				this.ui.close();
			},
		);
	}

	/** Runs one action through the host, then re-reads the state. A failure is a sentence, never a throw. */
	async run(action: 'pull' | 'push'): Promise<string> {
		if (this.busy) {
			return 'a sync is already running';
		}
		this.busy = true;
		let message = '';
		try {
			const result = await this.host[action]();
			message = result.message;
			if (result.needsReview) {
				this.host.review();
			}
		} catch (error) {
			message = error instanceof Error ? error.message : 'the sync could not be completed';
		} finally {
			this.busy = false;
		}
		this.state = { ...(await this.host.refresh()), lastRun: message };
		this.render();
		return message;
	}

	/** Stores a token and clears the field. The value never touches the panel's state. */
	async storeToken(input: HTMLInputElement): Promise<string> {
		const message = await this.host.setToken(input.value);
		input.value = '';
		this.state = { ...this.state, lastRun: message };
		await this.refresh();
		return message;
	}
}

/** The shipping surface: Obsidian's `Modal`, with the panel inside it. */
export class SyncDialog extends Modal {
	private readonly host: SyncPanelHost;
	private readonly initial: SyncPanelState;
	private readonly surface: FocusSurface;

	constructor(app: App, host: SyncPanelHost, initial: SyncPanelState) {
		super(app);
		this.host = host;
		this.initial = initial;
		this.surface = openSurface(
			'dialog',
			this.contentEl,
			typeof document === 'undefined' ? null : openerOf(document),
		);
	}

	onOpen(): void {
		this.titleEl.setText(`Sync — ${this.host.name}`);
		new SyncPanel(
			this.host,
			{
				contentEl: this.contentEl,
				close: () => {
					this.close();
				},
			},
			this.initial,
		);
	}

	onClose(): void {
		closeSurface(this.surface);
		this.contentEl.empty();
	}
}
