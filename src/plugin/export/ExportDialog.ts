/**
 * The export dialog: **five choices and one number, and the number is why it exists.**
 *
 * `docs/01` §Export is one line — *"Selection or whole view → TSV/XLSX to the clipboard or a downloaded file"* —
 * and this dialog is that line as a form: what (selection / whole view), which format (TSV / XLSX), where
 * (clipboard / file), and whether the values are the ones on screen or the ones in the notes. The count is stated
 * before the button, which is the same rule the import wizard and the paste dialog follow (`docs/01` §Import
 * semantics: *"the preview dialog is mandatory and must state consequences"*) — a person about to put 1,240 cells
 * into a file whose name they have not read yet deserves the number first.
 *
 * **The primary action is disabled until the counts are known**, and that is not decoration: with no rows selected,
 * *Selection* has nothing to say, and the honest answer is a disabled button plus a sentence rather than an export
 * of the empty string.
 *
 * The file, in two halves, exactly like `plugin/import/`: everything a person reads is built by the **pure**
 * functions at the top (`exportSummary`, `exportLines`, `exportCanRun`, `exportRequest` — all `ExportState` in, no
 * DOM out, asserted directly in `tests/unit/export.test.ts`), and the `Modal` below only turns that data into
 * elements and events. `tests/dom/export-dialog.test.tsx` drives the Modal's choices and the runner through
 * injected ports, which is what makes "cancelling writes nothing" a statement about the code and not about the
 * person's patience.
 */
import { Modal } from 'obsidian';
import type { App } from 'obsidian';

import { countExport } from '../../core/export/serialize';
import type { ExportCounts, ExportMode, ExportTable } from '../../core/export/serialize';
import { closeSurface, openSurface, openerOf } from '../../grid/a11y/focusContract';
import type { FocusSurface } from '../../grid/a11y/focusContract';
import { runExport } from './runExport';
import type {
	ExportDestination,
	ExportFormat,
	ExportPorts,
	ExportRequest,
	ExportScope,
	ExportSummary,
} from './runExport';

/** Every choice the dialog holds. One object, so the pure functions take one argument and the Modal owns one field. */
export type ExportState = {
	readonly scope: ExportScope;
	readonly format: ExportFormat;
	readonly destination: ExportDestination;
	readonly mode: ExportMode;
	/** The two tables, counted once when the dialog opens. See `ExportHost.tables`. */
	readonly counts: Readonly<Record<ExportScope, ExportCounts>>;
};

/** A line of the dialog's body. `kind` picks the element; nothing here is an element. */
export type ExportLine = {
	readonly kind: 'fact' | 'warning' | 'hint' | 'count';
	readonly text: string;
};

/** One clickable option: the label, the sentence under it, and whether it is the current choice. */
export type ExportOption = {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly picked: boolean;
};

/** A choice group: the question, and its answers. */
export type ExportGroup = {
	readonly id: 'scope' | 'format' | 'destination' | 'mode';
	readonly question: string;
	readonly options: readonly ExportOption[];
};

/** The three words each group's ids mean, in one place, because the Modal resolves a click back to a value. */
export const SCOPES: readonly {
	readonly id: ExportScope;
	readonly label: string;
	readonly description: string;
}[] = [
	{
		id: 'view',
		label: 'The whole view',
		description: 'Every row the filters and sorts leave visible, in that order.',
	},
	{
		id: 'selection',
		label: 'The selection',
		description: 'Only the cells you have selected right now.',
	},
];

export const FORMATS: readonly {
	readonly id: ExportFormat;
	readonly label: string;
	readonly description: string;
}[] = [
	{
		id: 'tsv',
		label: 'TSV',
		description: 'Tab-separated text — the shape every spreadsheet pastes back unchanged.',
	},
	{ id: 'xlsx', label: 'XLSX', description: 'An Excel workbook, with the types kept.' },
];

export const DESTINATIONS: readonly {
	readonly id: ExportDestination;
	readonly label: string;
	readonly description: string;
}[] = [
	{
		id: 'file',
		label: 'A file in the vault',
		description: 'Tablify exports/, named with the moment.',
	},
	{ id: 'clipboard', label: 'The clipboard', description: 'Both flavours, ready to paste.' },
];

export const MODES: readonly {
	readonly id: ExportMode;
	readonly label: string;
	readonly description: string;
}[] = [
	{
		id: 'display',
		label: 'As displayed',
		description: 'The values exactly as the grid shows them — what a person sees.',
	},
	{
		id: 'raw',
		label: 'Raw values',
		description: 'The text in the notes, unformatted — what a spreadsheet reads back.',
	},
];

/** The starting state: the whole view, displayed, to a file. TSV, because a file is the safe destination. */
export function defaultExportState(counts: ExportState['counts']): ExportState {
	return { scope: 'view', format: 'tsv', destination: 'file', mode: 'display', counts };
}

/** `The whole view · 412 rows × 6 columns · 2,472 cells`. The count sentence, from the table itself. */
export function exportSummary(state: ExportState): string {
	const counts = state.counts[state.scope];
	const rows = counts.rows.toLocaleString('en-GB');
	const columns = counts.columns.toLocaleString('en-GB');
	const cells = counts.cells.toLocaleString('en-GB');
	const scope = state.scope === 'view' ? 'The whole view' : 'The selection';
	return `${scope} · ${rows} row(s) × ${columns} column(s) · ${cells} cell(s)`;
}

/**
 * Whether the chosen pair of answers can be honoured, and why not when it cannot.
 *
 * The one refusal that is not about counts: **XLSX to the clipboard**. A workbook is bytes, and the clipboard's
 * text flavour cannot carry it — so the option is disabled with its reason on it rather than accepted and failed.
 */
export function exportCanRun(state: ExportState): {
	readonly ok: boolean;
	readonly reason: string | null;
} {
	const counts = state.counts[state.scope];
	if (counts.rows === 0) {
		return {
			ok: false,
			reason:
				state.scope === 'selection'
					? 'Nothing is selected — drag over some cells, or export the whole view.'
					: 'The view is empty — there is nothing to export.',
		};
	}
	if (state.destination === 'clipboard' && state.format === 'xlsx') {
		return {
			ok: false,
			reason: 'An .xlsx is a file: the clipboard carries text. Choose the file destination, or TSV.',
		};
	}
	return { ok: true, reason: null };
}

/** The request the runner takes, from the state the dialog holds. No translation layer, no second shape. */
export function exportRequest(state: ExportState): ExportRequest {
	return {
		scope: state.scope,
		format: state.format,
		destination: state.destination,
		mode: state.mode,
	};
}

/** The choices, with the current ones picked — the Modal renders exactly this. */
export function exportGroups(state: ExportState): readonly ExportGroup[] {
	const group = (
		id: ExportGroup['id'],
		question: string,
		options: readonly {
			readonly id: string;
			readonly label: string;
			readonly description: string;
		}[],
		picked: string,
	): ExportGroup => ({
		id,
		question,
		options: options.map((option) => ({ ...option, picked: option.id === picked })),
	});
	return [
		group('scope', 'What to export', SCOPES, state.scope),
		group('format', 'Format', FORMATS, state.format),
		group('destination', 'Where', DESTINATIONS, state.destination),
		group('mode', 'Values', MODES, state.mode),
	];
}

/**
 * The body, as data: the count line first (it is the point), then the warnings and the hints.
 *
 * The warning about *raw vs displayed* is deliberately not a warning: it is a hint that names what each mode
 * produces, because neither is wrong and a warning would make one look wrong.
 */
export function exportLines(state: ExportState): readonly ExportLine[] {
	const counts = state.counts[state.scope];
	const lines: ExportLine[] = [
		{ kind: 'count', text: exportSummary(state) },
		{
			kind: 'hint',
			text:
				state.mode === 'display'
					? 'Displayed values carry the formatting you see — €1,200.00, 24 Sep 2025, 25 %.'
					: 'Raw values carry what the notes hold — 1200, 2025-09-24, 25.',
		},
	];
	if (state.format === 'xlsx') {
		lines.push({
			kind: 'hint',
			text: 'XLSX keeps a number a number, a date a date and a tick a tick, so a spreadsheet can sum and sort them.',
		});
	}
	if (counts.rows > 0 && state.scope === 'view') {
		lines.push({
			kind: 'fact',
			text: 'Rows are exported in the view’s own order, after its filters.',
		});
	}
	const refusal = exportCanRun(state);
	if (!refusal.ok && refusal.reason !== null) {
		lines.push({ kind: 'warning', text: refusal.reason });
	}
	return lines;
}

/** What the dialog needs: the two tables, the ports, and its voice. */
export type ExportHost = {
	/**
	 * Both tables, read **once** when the dialog opens: one store read per scope, and every count, matrix and typed
	 * cell after that works from these objects. A modal is a moment in time; a grid that kept changing under it
	 * would make the number on screen a lie while the person reads it.
	 */
	readonly tables: Readonly<Record<ExportScope, ExportTable>>;
	readonly ports: ExportPorts;
	/** Called once per export, with the runner's summary. */
	readonly onFinished?: ((summary: ExportSummary) => void) | undefined;
};

/** What the panel renders into, and how it closes: the two things a `DialogBody` carries. */
export type ExportUi = {
	readonly contentEl: HTMLElement;
	readonly close: () => void;
};

/**
 * The dialog's whole behaviour: **the state, the elements, and the one `run`.**
 *
 * It is a class rather than a spec function because this surface re-renders *itself*: choosing the selection changes
 * the count line, and choosing XLSX-to-the-clipboard disables the primary action — a spec built once at open time
 * could not say either. `render()` empties and rebuilds, so there is exactly one code path from state to screen.
 *
 * **Why the shipping `Modal` is a wrapper instead of this class.** Obsidian's `Modal` constructor takes an `App`
 * (`obsidian.d.ts`), and no test can build one: the app has dozens of members and a test double for it would be a
 * fiction with no resemblance to the thing. The alternative — and this is the house pattern, from
 * `src/grid/dialogs/base.ts`'s `GridModal` + `DialogSpec` to `paste-flow.test.tsx` — is to keep the *behaviour* in
 * a class that takes a real content element (which Obsidian provides in the app, and `tests/mocks/dom.ts` provides
 * in a test) and leave the `Modal` as glue that cannot be got wrong.
 */
export class ExportPanel {
	private readonly host: ExportHost;
	private readonly ui: ExportUi;
	private state: ExportState;
	/** How many times the body has been rebuilt. A test reads this to prove a choice re-rendered, not appended. */
	renders = 0;

	constructor(host: ExportHost, ui: ExportUi) {
		this.host = host;
		this.ui = ui;
		this.state = defaultExportState({
			selection: countExport(host.tables.selection),
			view: countExport(host.tables.view),
		});
		this.render();
	}

	/** The state, for a test or a future menu item that wants to open on a particular scope. */
	snapshot(): ExportState {
		return this.state;
	}

	/** One render: subtitle, body, footer. Everything a person reads is built here and nowhere else. */
	render(): void {
		const { contentEl } = this.ui;
		contentEl.empty();
		this.renders += 1;
		contentEl.createDiv({
			cls: 'tablify-dlg-sub',
			text: 'Choose what leaves the vault. Nothing is written to your notes.',
		});
		const body = contentEl.createDiv({ cls: 'tablify-dlg-body' });
		for (const line of exportLines(this.state)) {
			body.createDiv({
				cls: `tablify-dlg-${line.kind === 'count' ? 'count' : line.kind}`,
				text: line.text,
			});
		}
		for (const group of exportGroups(this.state)) {
			const box = body.createDiv({ cls: 'tablify-dlg-group' });
			box.createDiv({ cls: 'tablify-dlg-group-q', text: group.question });
			const choices = box.createDiv({ cls: 'tablify-dlg-choices' });
			for (const option of group.options) {
				const button = choices.createEl('button', { cls: 'tablify-dlg-choice' });
				button.type = 'button';
				if (option.picked) {
					button.addClass('is-picked');
				}
				button.setAttribute('aria-pressed', String(option.picked));
				button.createSpan({ cls: 'tablify-dlg-choice-name', text: option.label });
				button.createSpan({ cls: 'tablify-dlg-choice-desc', text: option.description });
				button.addEventListener('click', () => {
					this.choose(group.id, option.id);
				});
			}
		}
		const foot = contentEl.createDiv({ cls: 'tablify-dlg-foot' });
		const refusal = exportCanRun(this.state);
		if (refusal.reason !== null) {
			foot.createDiv({ cls: 'tablify-live', text: refusal.reason });
		}
		const primary = foot.createEl('button', {
			cls: 'tablify-dlg-btn is-primary',
			text: 'Export',
		});
		if (refusal.ok) {
			primary.addEventListener('click', () => {
				void this.run();
			});
		} else {
			// Disabled **and** explained: a `title` for the pointer, and the sentence is already in the footer for
			// everyone else. A disabled control with no reason is the accessibility bug this line exists to avoid.
			primary.disabled = true;
			primary.setAttribute('title', refusal.reason ?? '');
		}
		foot.createEl('button', { cls: 'tablify-dlg-btn', text: 'Cancel' }).addEventListener(
			'click',
			() => {
				this.ui.close();
			},
		);
	}

	/** One click, applied to the state. The four groups are the four fields; nothing else is clickable. */
	choose(group: ExportGroup['id'], id: string): void {
		if (group === 'scope' && (id === 'view' || id === 'selection')) {
			this.state = { ...this.state, scope: id };
		} else if (group === 'format' && (id === 'tsv' || id === 'xlsx')) {
			this.state = { ...this.state, format: id };
		} else if (group === 'destination' && (id === 'file' || id === 'clipboard')) {
			this.state = { ...this.state, destination: id };
		} else if (group === 'mode' && (id === 'display' || id === 'raw')) {
			this.state = { ...this.state, mode: id };
		} else {
			return;
		}
		this.render();
	}

	/** The run. It never throws — the summary is the answer — and the dialog closes whatever the outcome. */
	async run(): Promise<ExportSummary> {
		const summary = await runExport(
			exportRequest(this.state),
			this.host.tables[this.state.scope],
			this.host.ports,
		);
		this.host.onFinished?.(summary);
		this.ui.close();
		return summary;
	}
}

/**
 * The shipping surface: Obsidian's own `Modal`, with the panel inside it.
 *
 * Six lines of glue on purpose. The title, the focus surface (`docs/04` §Accessibility: the host owns the focus
 * trap; `focusContract` owns giving focus *back*), and the panel — which is where the dialog actually is.
 */
export class ExportDialog extends Modal {
	private readonly host: ExportHost;
	private readonly surface: FocusSurface;

	constructor(app: App, host: ExportHost) {
		super(app);
		this.host = host;
		this.surface = openSurface(
			'dialog',
			this.contentEl,
			typeof document === 'undefined' ? null : openerOf(document),
		);
	}

	onOpen(): void {
		this.titleEl.setText('Export');
		// The panel is the dialog; this class is the window. Nothing reads the panel back, so nothing holds it.
		new ExportPanel(this.host, {
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
