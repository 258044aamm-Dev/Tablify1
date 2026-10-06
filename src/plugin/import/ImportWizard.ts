/**
 * The import wizard's Modal: **a thin renderer over `wizardSpec`'s data.**
 *
 * Everything a person reads is built by `stepFor` (`./wizardSpec.ts`), and everything that gets written is built by
 * `buildPlan` (`src/core/import/plan.ts`). This file owns exactly three things the spec cannot: the elements, the
 * input events, and the transitions between steps — which is the division `docs/02` §architecture keeps everywhere
 * else in the plugin (a `DialogSpec` plus a Modal, a pure `bulkEditSpec` plus its renderer).
 *
 * **Why an Obsidian `Modal`.** `docs/04` §Accessibility, quoted in `dialog/base.ts`: *"Real Obsidian `Modal` (focus
 * trap, Escape, focus restore for free)"* — the host already traps focus, binds Escape in its own scope and knows
 * how to put the surface back. The focus contract is still applied, because "for free" is the host's intention and
 * the contract is this plugin's guarantee.
 *
 * **What the progress line is.** `runImport` reports `created n of N` after every chunk, and this modal writes it
 * into the same element the button row lives in, then into the polite live region, so a screen reader hears the
 * same numbers the eye sees. Cancel is available *during* the run, and setting it stops the run at the next chunk
 * boundary: the modal then shows exactly what was created (the summary), never "cancelled" as if nothing happened.
 */
import { Modal } from 'obsidian';
import type { App } from 'obsidian';

import { closeSurface, openSurface, openerOf } from '../../grid/a11y/focusContract';
import type { FocusSurface } from '../../grid/a11y/focusContract';
import { inferColumns, readSource } from '../../core/import/preview';
import { planFor } from './wizardSpec';
import type { WizardInput, WizardLine, WizardState, WizardStep } from './wizardSpec';
import { isImportModeId, OVERRIDE_TYPES, stepFor } from './wizardSpec';
import { progressText, runImport } from './runImport';
import type { ImportHistory, ImportSummary, ImportVault } from './runImport';
import { isFieldTypeId } from '../../core/types';
import type { FieldTypeId } from '../../core/types';

/** What the wizard needs from the plugin: the vault it writes to, the history it leaves a step in, and its voice. */
export type ImportHost = {
	readonly vault: ImportVault;
	readonly history: ImportHistory;
	/** The vault-backed `PlanEnvironment`: does a path exist, does a folder exist, and the columns' descriptors. */
	readonly input: WizardInput;
	/** A message for the person: the live region, a Notice, or both. */
	readonly announce: (message: string) => void;
	/** Called once when a run finishes (or is cancelled), with the summary. */
	readonly onFinished?: ((summary: ImportSummary) => void) | undefined;
};

/** The wizard's own step order, so `next`/`back` are one array rather than two switches. */
const ORDER: readonly ('source' | 'preview' | 'target')[] = ['source', 'preview', 'target'];

export class ImportWizard extends Modal {
	private readonly host: ImportHost;
	private readonly surface: FocusSurface;
	private readonly state: Mutable<WizardState>;
	private step: (typeof ORDER)[number];
	/** Set by Cancel during a run; the runner reads it at the next chunk boundary. */
	private stopping = false;
	/** The running run's progress line, or `''` before it starts and after it ends. */
	private progress = '';

	constructor(app: App, host: ImportHost) {
		super(app);
		this.host = host;
		// Read and infer **once**, in the constructor: the source is a string or a matrix, and neither changes
		// while the wizard is open. Every later step is arithmetic over what this produced.
		const result = readSource(host.input.source);
		this.state = {
			wizard: host.input,
			result,
			hasHeader: true,
			columns: result.ok ? inferColumns(result.matrix, true).columns : [],
			overrides: new Map<number, FieldTypeId>(),
			excluded: new Set<number>(),
			folder: host.input.folder,
			template: host.input.template,
			mode: 'append',
			plan: null,
		};
		this.step = this.state.result.ok ? 'preview' : 'source';
		this.surface = openSurface(
			'dialog',
			this.contentEl,
			typeof document === 'undefined' ? null : openerOf(document),
		);
	}

	onOpen(): void {
		this.titleEl.setText('Import');
		this.render();
	}

	onClose(): void {
		closeSurface(this.surface);
		this.contentEl.empty();
	}

	/** One render of the current step. The body is emptied first: `Modal` clears `contentEl` itself on close. */
	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		const spec = stepFor(this.step, this.state);
		contentEl.createDiv({ cls: 'tablify-dlg-sub', text: spec.subtitle });
		const body = contentEl.createDiv({ cls: 'tablify-dlg-body' });
		for (const line of spec.lines) {
			this.renderLine(body, line);
		}
		if (spec.options.length > 0) {
			const box = body.createDiv({ cls: 'tablify-dlg-choices' });
			for (const option of spec.options) {
				const button = box.createEl('button', { cls: 'tablify-dlg-choice' });
				if (option.picked) {
					button.addClass('is-picked');
				}
				button.createSpan({ cls: 'tablify-dlg-choice-name', text: option.label });
				button.createSpan({ cls: 'tablify-dlg-choice-desc', text: option.description });
				if (option.disabledReason !== undefined) {
					button.setAttribute('disabled', 'true');
					button.setAttribute('title', option.disabledReason);
				} else {
					button.addEventListener('click', () => {
						if (isImportModeId(option.id)) {
							this.state.mode = option.id;
							this.render();
						}
					});
				}
			}
		}
		const foot = contentEl.createDiv({ cls: 'tablify-dlg-foot' });
		if (this.progress !== '') {
			foot.createDiv({ cls: 'tablify-live', text: this.progress });
		}
		for (const action of spec.actions) {
			const button = foot.createEl('button', { cls: 'tablify-dlg-btn', text: action.label });
			if (action.primary) {
				button.addClass('is-primary');
			}
			if (action.disabledReason !== undefined) {
				button.setAttribute('disabled', 'true');
				button.setAttribute('title', action.disabledReason);
				continue;
			}
			button.addEventListener('click', () => {
				this.runAction(action.id);
			});
		}
	}

	/** A line, by kind. The only place an element is chosen from the spec's vocabulary. */
	private renderLine(body: HTMLElement, line: WizardLine): void {
		if (line.kind === 'column') {
			const row = body.createDiv({ cls: 'tablify-dlg-row' });
			row.createSpan({ cls: 'tablify-dlg-row-label', text: line.text });
			const select = row.createEl('select', { cls: 'tablify-dlg-select dropdown' });
			const index = line.index ?? 0;
			for (const type of OVERRIDE_TYPES) {
				const option = select.createEl('option', { text: type });
				option.value = type;
				if (type === line.type) {
					option.selected = true;
				}
			}
			select.addEventListener('change', () => {
				// The options are the registry's own type ids, but the value comes back as a string: validate rather
				// than assert, so a registry change cannot smuggle an unknown id into the plan.
				if (isFieldTypeId(select.value)) {
					this.state.overrides.set(index, select.value);
					this.render();
				}
			});
			return;
		}
		const cls =
			line.kind === 'warning'
				? 'tablify-dlg-warn'
				: line.kind === 'hint'
					? 'tablify-dlg-hint'
					: line.kind === 'collision'
						? 'tablify-dlg-collision'
						: line.kind === 'skipped'
							? 'tablify-dlg-skipped'
							: 'tablify-dlg-fact';
		body.createDiv({ cls, text: line.text });
	}

	/**
	 * One footer action. `continue` is the only transition that changes the *data*: entering the target step builds
	 * the plan, once, and from then on the target step and the run read the same object.
	 */
	private runAction(id: WizardStep['actions'][number]['id']): void {
		switch (id) {
			case 'back': {
				this.step = ORDER[Math.max(0, ORDER.indexOf(this.step) - 1)] ?? 'source';
				this.render();
				return;
			}
			case 'continue': {
				if (this.step === 'preview') {
					this.state.plan = planFor({
						matrix: this.state.result.ok ? this.state.result.matrix : [],
						hasHeader: this.state.hasHeader,
						columns: this.state.columns,
						overrides: this.state.overrides,
						excluded: this.state.excluded,
						folder: this.state.folder,
						template: this.state.template,
						environment: this.state.wizard.environment,
					});
				}
				this.step =
					ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(this.step) + 1)] ?? 'target';
				this.render();
				return;
			}
			case 'tabula': {
				// The escape hatch is not built (see `TABULA_REASON`): refusing in one sentence beats a button that
				// appears to write a file and does not.
				this.host.announce(
					'Keeping a sheet as a .tabula file is not built yet — no file was written.',
				);
				this.close();
				return;
			}
			case 'create': {
				void this.create();
				return;
			}
			case 'cancel': {
				// During a run, Cancel stops it at the next chunk boundary. Before a run, it closes the wizard.
				if (this.progress !== '') {
					this.stopping = true;
					this.host.announce('Stopping after the notes already in progress…');
					return;
				}
				this.close();
			}
		}
	}

	/** The run itself: build the plan's notes, report after every chunk, hand the summary back. */
	private async create(): Promise<void> {
		const plan = this.state.plan;
		if (plan === null) {
			return;
		}
		const total = plan.notes.length;
		this.progress = progressText(0, total);
		this.render();
		const summary = await runImport({
			plan,
			vault: this.host.vault,
			onProgress: (created) => {
				this.progress = progressText(created, total);
				this.host.announce(this.progress);
			},
			shouldStop: () => this.stopping,
		});
		this.host.history.record(summary.undo);
		this.progress = summary.progress;
		const parts = [summary.progress];
		if (summary.failures.length > 0) {
			parts.push(`${String(summary.failures.length)} failed`);
		}
		if (summary.cancelled) {
			parts.push('stopped early');
		}
		this.host.announce(parts.join(' · '));
		this.host.onFinished?.(summary);
		this.render();
	}
}

/** `readonly` fields, mutable during the wizard's own lifetime. One alias so the state type stays honest. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
