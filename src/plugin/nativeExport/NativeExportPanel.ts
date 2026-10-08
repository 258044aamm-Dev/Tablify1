/**
 * The native CSV export panel (R5 Part B). Native DOM, no React, no grid.
 *
 * It exports the **active table of this pane's store**, whole, in manual order, and states that scope and every
 * omission in the panel before anything is written. The text comes from `nativeTableMatrix` and `toCsv`; the file
 * goes to `Tablify exports/` through the vault port the host supplies. The existing grid export and its runner are
 * not used or changed.
 */
import type { DatabaseStore } from '../../adapters/tablifyFile';
import { toCsv } from '../../core/export/csv';
import type { CsvNewline } from '../../core/export/csv';
import { nativeTableMatrix } from '../../core/database/export/nativeMatrix';
import type {
	NativeExportMode,
	NativeExportEnvironment,
} from '../../core/database/export/nativeMatrix';
import { projectTable } from '../../core/database/projection';
import { EXPORT_FOLDER, EXPORT_PREFIX, freePath, stamp } from '../export/runExport';

export interface NativeExportVault {
	readonly exists: (path: string) => boolean;
	readonly createFolder: (path: string) => Promise<void>;
	readonly create: (path: string, text: string) => Promise<void>;
}

export interface NativeExportPanelOptions {
	readonly store: DatabaseStore;
	readonly environment: NativeExportEnvironment;
	readonly vault: NativeExportVault;
	readonly now: () => Date;
	readonly close: () => void;
	readonly announce: (message: string) => void;
}

export type ExportOutcome =
	| { readonly kind: 'written'; readonly path: string; readonly rows: number }
	| { readonly kind: 'failed'; readonly message: string };

/** Characters a file name cannot carry on the platforms Obsidian runs on. */
function safeStem(name: string): string {
	const cleaned = name
		.replace(/[\\/:*?"<>|#^[\]]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return cleaned === '' ? 'Table' : cleaned;
}

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

export class NativeExportPanel {
	private readonly root: HTMLElement;
	private readonly options: NativeExportPanelOptions;
	private mode: NativeExportMode = 'display';
	private newline: CsvNewline = 'crlf';
	private outcome: ExportOutcome | null = null;
	private busy = false;
	private disposed = false;

	constructor(root: HTMLElement, options: NativeExportPanelOptions) {
		this.root = root;
		this.options = options;
		this.render();
	}

	/** The last outcome, or `null` before an export was attempted. */
	lastOutcome(): ExportOutcome | null {
		return this.outcome;
	}

	/** The scope and omissions the panel states right now, as the same sentences the person reads. */
	scopeLines(): readonly string[] {
		const plan = this.plan();
		if (plan === null) {
			return ['No table is open.'];
		}
		const lines = [
			`Whole table “${plan.tableName}”, in manual order: ${String(plan.rowCount)} row(s), ${String(plan.exportedCount)} field(s).`,
		];
		if (plan.omittedLinks > 0) {
			lines.push(
				`${String(plan.omittedLinks)} link field(s) are left out: linked records are not exported as IDs yet.`,
			);
		}
		if (plan.omittedUnsupported > 0) {
			lines.push(
				`${String(plan.omittedUnsupported)} field(s) of a type this build does not support are left out.`,
			);
		}
		lines.push('Saved view filters and sorts are not applied: the whole table is exported.');
		return lines;
	}

	/** Write the CSV for the scope above. One file, one attempt, and a visible outcome either way. */
	async exportNow(): Promise<void> {
		const plan = this.plan();
		if (this.busy || this.disposed || plan === null || !plan.exportable) {
			return;
		}
		this.busy = true;
		this.render();
		try {
			if (!this.options.vault.exists(EXPORT_FOLDER)) {
				await this.options.vault.createFolder(EXPORT_FOLDER);
			}
			const base = `${EXPORT_PREFIX} ${safeStem(plan.tableName)} ${stamp(this.options.now())}`;
			const target = freePath(base, 'csv', (path) => this.options.vault.exists(path));
			await this.options.vault.create(
				target.path,
				toCsv(plan.matrix, { newline: this.newline }),
			);
			this.outcome = { kind: 'written', path: target.path, rows: plan.rowCount };
			this.options.announce(`Exported ${String(plan.rowCount)} row(s) to ${target.path}.`);
		} catch (error: unknown) {
			const message =
				error instanceof Error ? error.message : 'the file could not be written';
			this.outcome = { kind: 'failed', message };
			this.options.announce(`Export failed: ${message}`);
		} finally {
			this.busy = false;
			this.render();
		}
	}

	dispose(): void {
		this.disposed = true;
	}

	private plan(): {
		readonly tableName: string;
		readonly rowCount: number;
		readonly exportedCount: number;
		readonly omittedLinks: number;
		readonly omittedUnsupported: number;
		readonly matrix: readonly (readonly string[])[];
		readonly exportable: boolean;
	} | null {
		const document = this.options.store.getSnapshot().document;
		const activeId = this.options.store.getSnapshot().activeTableId;
		if (activeId === null) {
			return null;
		}
		const snapshot = projectTable(document, activeId);
		if (snapshot === null) {
			return null;
		}
		const result = nativeTableMatrix(snapshot, this.mode, this.options.environment);
		return {
			tableName: snapshot.table.name,
			rowCount: result.rowCount,
			exportedCount: result.exportedFields.length,
			omittedLinks: result.omittedLinks,
			omittedUnsupported: result.omittedUnsupported,
			matrix: result.matrix,
			exportable: result.matrix.length > 0,
		};
	}

	private render(): void {
		if (this.disposed) {
			return;
		}
		this.root.replaceChildren();
		this.root.addClass('tablify-native-export');
		el(this.root, 'div', 'tablify-dlg-sub', 'Export table as CSV');
		const body = el(this.root, 'div', 'tablify-native-import-body');

		for (const line of this.scopeLines()) {
			el(body, 'div', 'tablify-dlg-fact', line);
		}

		const modes = el(body, 'div', 'tablify-native-import-modes');
		modes.setAttribute('role', 'radiogroup');
		modes.setAttribute('aria-label', 'Cell text');
		const choices: readonly {
			readonly id: NativeExportMode;
			readonly label: string;
			readonly help: string;
		}[] = [
			{
				id: 'display',
				label: 'As displayed',
				help: 'Text as the cell shows it, such as 1,200.00 or €5.',
			},
			{
				id: 'raw',
				label: 'Raw values',
				help: 'Plain values a spreadsheet reads back unchanged.',
			},
		];
		for (const choice of choices) {
			const label = el(modes, 'label', 'tablify-native-import-label');
			const radio = el(label, 'input');
			radio.type = 'radio';
			radio.name = 'tablify-export-mode';
			radio.value = choice.id;
			radio.checked = this.mode === choice.id;
			radio.addEventListener('change', () => {
				if (radio.checked) {
					this.mode = choice.id;
					this.render();
				}
			});
			label.appendChild(this.root.ownerDocument.createTextNode(choice.label));
			el(modes, 'div', 'tablify-dlg-hint', choice.help);
		}

		const newlineLabel = el(body, 'label', 'tablify-native-import-label', 'Line endings');
		const newline = el(newlineLabel, 'select', 'tablify-native-select');
		newline.setAttribute('aria-label', 'Line endings');
		for (const [value, text] of [
			['crlf', 'Windows (CRLF), the RFC 4180 default'],
			['lf', 'Unix (LF)'],
		] as const) {
			const option = el(newline, 'option', undefined, text);
			option.value = value;
		}
		newline.value = this.newline;
		newline.addEventListener('change', () => {
			this.newline = newline.value === 'lf' ? 'lf' : 'crlf';
		});

		if (this.outcome !== null) {
			const line =
				this.outcome.kind === 'written'
					? `Exported ${String(this.outcome.rows)} row(s) to ${this.outcome.path}.`
					: `Export failed: ${this.outcome.message}`;
			const status = el(body, 'div', 'tablify-live', line);
			status.setAttribute('role', 'status');
		}

		const foot = el(this.root, 'div', 'tablify-dlg-foot');
		const close = el(foot, 'button', 'tablify-native-button', 'Close');
		close.type = 'button';
		close.addEventListener('click', () => {
			this.options.close();
		});
		const plan = this.plan();
		const exportButton = el(
			foot,
			'button',
			'tablify-native-button is-primary',
			this.busy ? 'Exporting…' : 'Export CSV',
		);
		exportButton.type = 'button';
		exportButton.disabled = this.busy || plan === null || !plan.exportable;
		exportButton.addEventListener('click', () => {
			void this.exportNow();
		});
	}
}
