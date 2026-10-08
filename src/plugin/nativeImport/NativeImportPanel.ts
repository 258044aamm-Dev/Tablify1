/**
 * The native import wizard's panel: three steps, one exact plan, and a cancellable apply.
 *
 * It renders with standard DOM calls on a root element the caller supplies (the modal's content element in Obsidian,
 * a plain element in tests). It holds no document state of its own: every choice lives in the draft, and every write
 * goes through `applyDatabaseImportPlan` against the shared store. It is deliberately not the React grid, and it does
 * not touch the legacy note importer.
 *
 * The review step builds the plan once, on entry, from the document as it is then. Apply runs that plan; the runner
 * re-checks the document before it commits, so a change made meanwhile refuses the import instead of overwriting it.
 */
import type { DatabaseStore } from '../../adapters/tablifyFile';
import { applyDatabaseImportPlan } from '../../adapters/tablifyFile';
import type { DatabaseImportApplyResult } from '../../adapters/tablifyFile';
import type { DatabaseImportPlan, DatabaseImportPreview, DatabaseTable } from '../../core/database';
import type { FieldTypeId } from '../../core/types';
import {
	confirmationLines,
	defaultTableName,
	destinationOf,
	IMPORT_TYPE_CHOICES,
	includedColumnsOf,
	initialDraft,
	linkSourceValuesOf,
	linkTargetRowsOf,
	needsAcknowledgement,
	planOf,
	previewOf,
	progressLine,
	resultMessage,
	targetFieldsOf,
} from './model';
import type { ImportDraft, ImportMode, ImportPlanEnvironment } from './model';

export interface NativeImportPanelOptions {
	readonly store: DatabaseStore;
	readonly environment: ImportPlanEnvironment;
	/** The file the import came from, or a label for a paste. */
	readonly sourceName: string;
	/** Closes the surface that holds this panel. */
	readonly close: () => void;
	/** Receives the one-sentence outcome, for a live region or a Notice. */
	readonly announce: (message: string) => void;
}

export type ImportStep = 'source' | 'destination' | 'review' | 'done';

const STEP_ORDER: readonly ImportStep[] = ['source', 'destination', 'review'];
const STEP_TITLE: { readonly [step in ImportStep]: string } = {
	source: 'Step 1 of 3 — Source',
	destination: 'Step 2 of 3 — Destination',
	review: 'Step 3 of 3 — Review and apply',
	done: 'Import finished',
};

type ReviewState =
	| { readonly ok: true; readonly plan: DatabaseImportPlan; readonly summary: string }
	| { readonly ok: false; readonly reasons: readonly string[] };

interface RunState {
	readonly controller: AbortController;
	phase: string;
	/** Set once the runner reaches the commit point; cancel is no longer offered after this. */
	committed: boolean;
}

let nextPanelId = 0;

function el<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	return parent.createEl(tag, {
		...(className === undefined ? {} : { cls: className }),
		...(text === undefined ? {} : { text }),
	});
}

/** A label that wraps its control, so the control's accessible name is the label text. */
function labelled(parent: HTMLElement, text: string): HTMLLabelElement {
	const label = el(parent, 'label', 'tablify-native-import-label');
	label.appendChild(parent.ownerDocument.createTextNode(text));
	return label;
}

function selectWith(
	parent: HTMLElement,
	ariaLabel: string,
	options: readonly {
		readonly value: string;
		readonly label: string;
		readonly disabled?: boolean;
		readonly title?: string;
	}[],
	selected: string,
	onChange: (value: string) => void,
): HTMLSelectElement {
	const select = el(parent, 'select', 'tablify-native-select');
	select.setAttribute('aria-label', ariaLabel);
	for (const option of options) {
		const node = el(select, 'option', undefined, option.label);
		node.value = option.value;
		node.disabled = option.disabled === true;
		if (option.title !== undefined) {
			node.title = option.title;
		}
	}
	select.value = selected;
	select.addEventListener('change', () => {
		onChange(select.value);
	});
	return select;
}

function button(
	parent: HTMLElement,
	label: string,
	onClick: () => void,
	options: { readonly disabled?: boolean; readonly primary?: boolean } = {},
): HTMLButtonElement {
	const node = el(
		parent,
		'button',
		`tablify-native-button${options.primary === true ? ' is-primary' : ''}`,
		label,
	);
	node.type = 'button';
	node.disabled = options.disabled === true;
	node.addEventListener('click', onClick);
	return node;
}

function isFieldType(value: string): value is FieldTypeId {
	return IMPORT_TYPE_CHOICES.some((choice) => choice === value);
}

function columnLabel(name: string, index: number): string {
	return name.trim() === '' ? `Column ${String(index + 1)}` : name;
}

export class NativeImportPanel {
	private readonly root: HTMLElement;
	private readonly options: NativeImportPanelOptions;
	private readonly panelId: number;
	private step: ImportStep = 'source';
	private draft: ImportDraft;
	private review: ReviewState | null = null;
	private acknowledged = false;
	private run: RunState | null = null;
	private result: DatabaseImportApplyResult | null = null;
	private status: HTMLElement | null = null;
	private cancelButton: HTMLButtonElement | null = null;
	private applyButton: HTMLButtonElement | null = null;
	private disposed = false;

	constructor(root: HTMLElement, options: NativeImportPanelOptions) {
		this.root = root;
		this.options = options;
		nextPanelId += 1;
		this.panelId = nextPanelId;
		this.draft = initialDraft({
			sourceName: options.sourceName,
			activeTableId: options.store.getSnapshot().activeTableId,
		});
		this.render();
	}

	/** The step currently shown. */
	currentStep(): ImportStep {
		return this.step;
	}

	/** The draft as the person has left it. */
	currentDraft(): ImportDraft {
		return this.draft;
	}

	/** The last apply result, or `null` before one finished. */
	lastResult(): DatabaseImportApplyResult | null {
		return this.result;
	}

	/** Stop an apply that has not committed yet. Called when the surface closes. */
	dispose(): void {
		this.disposed = true;
		if (this.run !== null && !this.run.committed) {
			this.run.controller.abort();
		}
	}

	private update(patch: Partial<ImportDraft>): void {
		this.draft = { ...this.draft, ...patch };
	}

	private go(step: ImportStep): void {
		this.step = step;
		if (step === 'review') {
			this.acknowledged = false;
			this.review = this.buildReview();
		}
		this.render();
	}

	private buildReview(): ReviewState {
		const document = this.options.store.getSnapshot().document;
		const outcome = planOf(document, this.draft, this.options.environment);
		return outcome.ok
			? { ok: true, plan: outcome.plan, summary: outcome.summary }
			: { ok: false, reasons: outcome.reasons };
	}

	/** The preview, when the source reads. Every step past the source is only reachable with one. */
	private okPreview(): DatabaseImportPreview | null {
		const preview = previewOf(this.draft);
		return preview.ok ? preview : null;
	}

	/** The one render. Steps are rebuilt from the draft; live status and buttons are updated in place. */
	private render(): void {
		if (this.disposed) {
			return;
		}
		this.root.replaceChildren();
		this.root.classList.add('tablify-native-import');
		el(this.root, 'div', 'tablify-dlg-sub', STEP_TITLE[this.step]);
		const body = el(this.root, 'div', 'tablify-native-import-body');
		this.status = null;
		this.cancelButton = null;
		this.applyButton = null;
		switch (this.step) {
			case 'source':
				this.renderSource(body);
				break;
			case 'destination':
				this.renderDestination(body);
				break;
			case 'review':
				this.renderReview(body);
				break;
			case 'done':
				this.renderDone(body);
				break;
		}
		this.renderFooter(this.root);
		this.refreshStatus();
	}

	private renderSource(body: HTMLElement): void {
		const area = el(
			labelled(body, 'Paste a table (TSV, CSV, or HTML), or choose a file'),
			'textarea',
			'tablify-native-import-text',
		);
		area.value = this.draft.text;
		area.rows = 6;
		area.setAttribute('aria-label', 'Table text to import');
		area.addEventListener('change', () => {
			this.update({ text: area.value });
			this.render();
		});

		const file = el(body, 'input', 'tablify-native-import-file');
		file.type = 'file';
		file.accept = '.tsv,.csv,.txt,.html';
		file.setAttribute('aria-label', 'Choose a text file to import');
		file.addEventListener('change', () => {
			const chosen = file.files?.[0];
			if (chosen === undefined) {
				return;
			}
			void chosen.text().then((text) => {
				this.update({
					text,
					sourceName: chosen.name,
					newTableName: defaultTableName(chosen.name),
				});
				this.render();
			});
		});

		const header = el(
			labelled(body, 'The first row is a header'),
			'input',
			'tablify-native-import-header',
		);
		header.type = 'checkbox';
		header.checked = this.draft.hasHeader;
		header.addEventListener('change', () => {
			this.update({ hasHeader: header.checked });
			this.render();
		});

		this.renderPreview(body);
	}

	private renderPreview(body: HTMLElement): void {
		if (this.draft.text.trim() === '') {
			el(body, 'div', 'tablify-dlg-hint', 'Nothing to preview yet.');
			return;
		}
		const preview = previewOf(this.draft);
		if (!preview.ok) {
			el(
				body,
				'div',
				'tablify-dlg-warning',
				`This source cannot be imported: ${preview.reason}`,
			);
			return;
		}
		el(
			body,
			'div',
			'tablify-dlg-fact',
			`${preview.sourceName}: ${String(preview.width)} column(s) × ${String(preview.rowCount)} row(s)`,
		);
		const list = el(body, 'div', 'tablify-native-import-columns');
		for (const column of preview.columns) {
			this.renderColumnRow(list, column);
		}
	}

	private renderColumnRow(
		list: HTMLElement,
		column: DatabaseImportPreview['columns'][number],
	): void {
		const row = el(list, 'div', 'tablify-dlg-row');
		const include = el(row, 'input', 'tablify-native-import-include');
		include.type = 'checkbox';
		include.checked = column.included;
		include.setAttribute(
			'aria-label',
			`Include column ${columnLabel(column.name, column.index)}`,
		);
		include.addEventListener('change', () => {
			const excluded = new Set(this.draft.excluded);
			if (include.checked) {
				excluded.delete(column.index);
			} else {
				excluded.add(column.index);
			}
			this.update({ excluded });
			this.render();
		});
		el(row, 'span', 'tablify-dlg-row-label', columnLabel(column.name, column.index));
		el(row, 'span', 'tablify-dlg-hint', `detected ${column.inference.type}`);
		selectWith(
			row,
			`Type for ${columnLabel(column.name, column.index)}`,
			IMPORT_TYPE_CHOICES.map((type) => ({ value: type, label: type })),
			column.type,
			(value) => {
				if (isFieldType(value)) {
					const overrides = new Map(this.draft.overrides);
					overrides.set(column.index, value);
					this.update({ overrides });
					this.render();
				}
			},
		);
	}

	private renderDestination(body: HTMLElement): void {
		const snapshot = this.options.store.getSnapshot();
		const modes: readonly {
			readonly id: ImportMode;
			readonly label: string;
			readonly help: string;
		}[] = [
			{ id: 'create', label: 'Create a new table', help: 'Adds the rows to a new table.' },
			{
				id: 'append',
				label: 'Append to a table',
				help: 'Adds the rows to an existing table. Existing rows are not changed.',
			},
			{
				id: 'replace',
				label: 'Replace values in a table',
				help: 'Updates the existing rows that match on a key field you choose. Other existing rows are kept.',
			},
		];
		const group = el(body, 'div', 'tablify-native-import-modes');
		group.setAttribute('role', 'radiogroup');
		group.setAttribute('aria-label', 'Destination');
		for (const mode of modes) {
			const label = labelled(group, mode.label);
			const radio = el(label, 'input');
			radio.type = 'radio';
			radio.name = `tablify-import-mode-${String(this.panelId)}`;
			radio.value = mode.id;
			radio.checked = this.draft.mode === mode.id;
			radio.addEventListener('change', () => {
				if (radio.checked) {
					this.update({ mode: mode.id });
					this.render();
				}
			});
			el(group, 'div', 'tablify-dlg-hint', mode.help);
		}

		if (this.draft.mode === 'create') {
			const name = el(
				labelled(body, 'New table name'),
				'input',
				'tablify-native-import-name',
			);
			name.type = 'text';
			name.value = this.draft.newTableName;
			name.addEventListener('change', () => {
				this.update({ newTableName: name.value });
				this.render();
			});
			return;
		}

		const tables = snapshot.document.tables;
		if (tables.length === 0) {
			el(
				body,
				'div',
				'tablify-dlg-warning',
				'This database has no tables yet. Create a new table instead.',
			);
			return;
		}
		selectWith(
			labelled(body, 'Table'),
			'Table to write to',
			[
				{ value: '', label: 'Choose a table…' },
				...tables.map((table) => ({ value: table.id, label: table.name })),
			],
			this.draft.tableId ?? '',
			(value) => {
				this.update({
					tableId: value === '' ? null : value,
					fieldTargets: new Map(),
					keyColumn: null,
					linkValues: new Map(),
				});
				this.render();
			},
		);

		const table = tables.find((candidate) => candidate.id === this.draft.tableId);
		if (table === undefined) {
			el(body, 'div', 'tablify-dlg-hint', 'Choose a table to see its fields.');
			return;
		}
		this.renderFieldMapping(body, table);
	}

	private renderFieldMapping(body: HTMLElement, table: DatabaseTable): void {
		const preview = this.okPreview();
		if (preview === null) {
			el(
				body,
				'div',
				'tablify-dlg-warning',
				'Go back and fix the source before choosing fields.',
			);
			return;
		}
		el(body, 'div', 'tablify-dlg-sub', 'Where each column goes');
		el(
			body,
			'div',
			'tablify-dlg-hint',
			'Each column becomes a new field unless you pick an existing one. Names are never matched for you.',
		);
		const allTables = this.options.store.getSnapshot().document.tables;
		const targets = targetFieldsOf(table, allTables);
		const included = includedColumnsOf(preview, this.draft);
		for (const index of included) {
			const column = preview.columns.find((candidate) => candidate.index === index);
			if (column === undefined) {
				continue;
			}
			const name = columnLabel(column.name, index);
			selectWith(
				labelled(body, name),
				`Field for ${name}`,
				[
					{ value: '', label: `New field “${name}”` },
					...targets.map((target) => ({
						value: target.fieldId,
						label: target.selectable
							? `${target.name} (${target.type})`
							: `${target.name} — not available`,
						disabled: !target.selectable,
						title: target.reason ?? undefined,
					})),
				],
				this.draft.fieldTargets.get(index) ?? '',
				(value) => {
					const fieldTargets = new Map(this.draft.fieldTargets);
					if (value === '') {
						fieldTargets.delete(index);
					} else {
						fieldTargets.set(index, value);
					}
					const keyColumn =
						value === '' && this.draft.keyColumn === index
							? null
							: this.draft.keyColumn;
					// A choice for a column is only meaningful for the field it was made for.
					const linkValues = new Map(this.draft.linkValues);
					linkValues.delete(index);
					this.update({ fieldTargets, keyColumn, linkValues });
					this.render();
				},
			);
		}

		this.renderLinkValues(body, preview, table, allTables, included);

		if (this.draft.mode === 'replace') {
			const keyOptions = included.filter((index) => this.draft.fieldTargets.has(index));
			selectWith(
				labelled(body, 'Key field: the existing field that identifies a row'),
				'Key field',
				[
					{ value: '', label: 'No key — append every row' },
					...keyOptions.map((index) => ({
						value: String(index),
						label: columnLabel(
							preview.columns.find((column) => column.index === index)?.name ?? '',
							index,
						),
					})),
				],
				this.draft.keyColumn === null ? '' : String(this.draft.keyColumn),
				(value) => {
					this.update({ keyColumn: value === '' ? null : Number(value) });
					this.render();
				},
			);
			el(
				body,
				'div',
				'tablify-dlg-hint',
				'Rows match only on the key field. Existing rows that no source row matches are kept. Without a key, rows are appended.',
			);
		}
	}

	/**
	 * For each included column whose target is a link field, one picker per distinct source value. A value with no
	 * chosen row stays unmapped, and the review blocks on it, naming the value.
	 */
	private renderLinkValues(
		body: HTMLElement,
		preview: DatabaseImportPreview,
		table: DatabaseTable,
		tables: readonly DatabaseTable[],
		included: readonly number[],
	): void {
		for (const index of included) {
			const fieldId = this.draft.fieldTargets.get(index);
			const field = table.fields.find(
				(candidate) => candidate.kind === 'field' && candidate.id === fieldId,
			);
			if (field === undefined || field.kind !== 'field' || field.type !== 'link') {
				continue;
			}
			const targetTableId = field.settings.targetTableId;
			const rows =
				typeof targetTableId === 'string' ? linkTargetRowsOf(tables, targetTableId) : null;
			if (rows === null) {
				continue;
			}
			const column = preview.columns.find((candidate) => candidate.index === index);
			const name = columnLabel(column?.name ?? '', index);
			el(body, 'div', 'tablify-dlg-sub', `Link values for ${name}`);
			el(
				body,
				'div',
				'tablify-dlg-hint',
				field.settings.allowMultiple === true
					? 'Pick every row each value links to. A value with no row blocks the import; leaving the column out is the way to skip it.'
					: 'Pick the one row each value links to. A value with no row blocks the import.',
			);
			const values = linkSourceValuesOf(preview, index);
			if (values.length === 0) {
				el(body, 'div', 'tablify-dlg-hint', 'This column has no values to map.');
				continue;
			}
			if (rows.length === 0) {
				el(
					body,
					'div',
					'tablify-dlg-warning',
					'The target table has no rows to link to yet.',
				);
			}
			const choices = this.draft.linkValues.get(index);
			for (const value of values) {
				const chosen = choices?.get(value) ?? [];
				const rowOptions = rows.map((row) => ({ value: row.rowId, label: row.label }));
				if (field.settings.allowMultiple === true) {
					const label = labelled(body, `${JSON.stringify(value)} links to`);
					const select = el(label, 'select', 'tablify-native-select');
					select.multiple = true;
					select.setAttribute('aria-label', `Rows for ${JSON.stringify(value)}`);
					for (const option of rowOptions) {
						const item = el(select, 'option', undefined, option.label);
						item.value = option.value;
						item.selected = chosen.includes(option.value);
					}
					select.addEventListener('change', () => {
						const ids = Array.from(select.selectedOptions, (option) => option.value);
						this.setLinkChoice(index, value, ids);
					});
				} else {
					selectWith(
						labelled(body, `${JSON.stringify(value)} links to`),
						`Row for ${JSON.stringify(value)}`,
						[{ value: '', label: 'Choose a row…' }, ...rowOptions],
						chosen[0] ?? '',
						(choice) => {
							this.setLinkChoice(index, value, choice === '' ? [] : [choice]);
						},
					);
				}
			}
		}
	}

	private setLinkChoice(index: number, value: string, ids: readonly string[]): void {
		const linkValues = new Map(this.draft.linkValues);
		const forColumn = new Map(linkValues.get(index) ?? []);
		if (ids.length === 0) {
			forColumn.delete(value);
		} else {
			forColumn.set(value, ids);
		}
		if (forColumn.size === 0) {
			linkValues.delete(index);
		} else {
			linkValues.set(index, forColumn);
		}
		this.update({ linkValues });
		this.render();
	}

	private renderReview(body: HTMLElement): void {
		if (this.review === null) {
			this.review = this.buildReview();
		}
		const review = this.review;
		if (!review.ok) {
			el(body, 'div', 'tablify-dlg-sub', 'This import cannot be applied yet:');
			const list = el(body, 'ul', 'tablify-native-import-reasons');
			for (const reason of review.reasons) {
				el(list, 'li', 'tablify-dlg-warning', reason);
			}
			el(body, 'div', 'tablify-dlg-hint', 'Go back and change the choice that causes this.');
			return;
		}
		for (const line of review.summary.split('\n')) {
			el(body, 'div', 'tablify-dlg-fact', line);
		}
		for (const warning of review.plan.warnings) {
			el(body, 'div', 'tablify-dlg-warning', warning.message);
		}
		for (const line of confirmationLines(review.plan)) {
			el(body, 'div', 'tablify-dlg-warning', line);
		}
		if (needsAcknowledgement(review.plan)) {
			const check = el(labelled(body, 'I have reviewed these changes'), 'input');
			check.type = 'checkbox';
			check.checked = this.acknowledged;
			check.addEventListener('change', () => {
				this.acknowledged = check.checked;
				this.refreshStatus();
			});
		}
		this.status = el(body, 'div', 'tablify-live');
		this.status.setAttribute('role', 'status');
		this.status.setAttribute('aria-live', 'polite');
	}

	private renderDone(body: HTMLElement): void {
		const line = el(
			body,
			'div',
			'tablify-live',
			this.result === null ? 'No import was run.' : resultMessage(this.result),
		);
		line.setAttribute('role', 'status');
	}

	private renderFooter(root: HTMLElement): void {
		const foot = el(root, 'div', 'tablify-dlg-foot');
		if (this.step === 'done') {
			button(foot, 'Done', () => this.options.close(), { primary: true });
			return;
		}
		if (this.run !== null) {
			this.cancelButton = button(foot, 'Cancel import', () => {
				this.cancelRun();
			});
			return;
		}
		button(foot, 'Close', () => this.options.close());
		const index = STEP_ORDER.indexOf(this.step);
		if (index > 0) {
			button(foot, 'Back', () => {
				this.go(STEP_ORDER[index - 1] ?? 'source');
			});
		}
		if (this.step === 'source') {
			const preview = this.okPreview();
			const usable = preview !== null && includedColumnsOf(preview, this.draft).length > 0;
			button(foot, 'Next', () => this.go('destination'), {
				disabled: !usable,
				primary: true,
			});
			return;
		}
		if (this.step === 'destination') {
			const preview = this.okPreview();
			const usable = preview !== null && destinationOf(this.draft, preview).ok;
			button(foot, 'Review', () => this.go('review'), { disabled: !usable, primary: true });
			return;
		}
		this.applyButton = button(
			foot,
			'Apply import',
			() => {
				void this.apply();
			},
			{ primary: true },
		);
	}

	private async apply(): Promise<void> {
		const review = this.review;
		if (review === null || !review.ok || this.run !== null) {
			return;
		}
		const run: RunState = {
			controller: new AbortController(),
			phase: 'checking',
			committed: false,
		};
		this.run = run;
		this.render();
		const result = await applyDatabaseImportPlan(this.options.store, review.plan, {
			signal: run.controller.signal,
			onProgress: (progress) => {
				run.phase = progress.phase;
				if (progress.phase === 'saving') {
					run.committed = true;
				}
				this.refreshStatus();
			},
		});
		this.run = null;
		this.result = result;
		this.step = 'done';
		this.options.announce(resultMessage(result));
		this.render();
	}

	private cancelRun(): void {
		if (this.run === null || this.run.committed) {
			return;
		}
		this.run.controller.abort();
		this.refreshStatus();
	}

	/**
	 * Update the live line and buttons in place, so focus and typing survive. The live line shows the apply progress,
	 * or the acknowledgement that Apply still needs.
	 */
	private refreshStatus(): void {
		const review = this.review;
		if (this.status !== null) {
			this.status.textContent = this.statusText(review);
		}
		if (this.applyButton !== null) {
			const acknowledged =
				review !== null &&
				review.ok &&
				(!needsAcknowledgement(review.plan) || this.acknowledged);
			this.applyButton.disabled = !acknowledged || this.run !== null;
		}
		if (this.cancelButton !== null && this.run !== null) {
			this.cancelButton.disabled = this.run.committed;
		}
	}

	private statusText(review: ReviewState | null): string {
		const run = this.run;
		if (run !== null) {
			if (run.controller.signal.aborted && !run.committed) {
				return 'Cancelling…';
			}
			const rows =
				review !== null && review.ok
					? review.plan.metrics.rowsCreated + review.plan.metrics.rowsUpdated
					: 0;
			return progressLine(run.phase, rows);
		}
		if (
			review !== null &&
			review.ok &&
			needsAcknowledgement(review.plan) &&
			!this.acknowledged
		) {
			return 'Confirm the changes above to enable Apply.';
		}
		return '';
	}
}
