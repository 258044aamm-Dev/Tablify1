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
import { toTsv } from '../../core/selection/clipboard';
import { toXlsxData } from '../../core/export/serialize';
import type { ExportColumn, XlsxRow } from '../../core/export/serialize';
import type { XlsxResult } from '../export/xlsx';
import { nativeTableMatrix, nativeViewMatrix } from '../../core/database/export/nativeMatrix';
import type { TableView } from '../../core/database/views';
import type {
	NativeExportMode,
	NativeExportEnvironment,
} from '../../core/database/export/nativeMatrix';
import { projectTable } from '../../core/database/projection';
import { EXPORT_FOLDER, EXPORT_PREFIX, freePath, stamp } from '../export/runExport';

export interface NativeExportVault {
	readonly exists: (path: string) => boolean;
	readonly createFolder: (path: string) => Promise<void>;
	/** Text for CSV and TSV, bytes for XLSX: the two shapes a vault writes. */
	readonly create: (path: string, data: string | ArrayBuffer) => Promise<void>;
}

export interface NativeExportPanelOptions {
	readonly store: DatabaseStore;
	readonly environment: NativeExportEnvironment;
	readonly vault: NativeExportVault;
	readonly now: () => Date;
	readonly close: () => void;
	readonly announce: (message: string) => void;
	/** The saved view the pane shows when the dialog opens, or `null`. Used by the current-view scope. */
	readonly viewId?: string | null;
	/** Injected by the tests; the real writer is the dynamic import in `../export/xlsx`, so the workbook code loads only on export. */
	readonly writeXlsx?:
		((rows: readonly XlsxRow[], name: string) => Promise<XlsxResult>) | undefined;
}

export type ExportOutcome =
	| { readonly kind: 'written'; readonly path: string; readonly rows: number }
	| { readonly kind: 'failed'; readonly message: string };

/** The file formats this panel writes. CSV and TSV only; XLSX from native tables is a later step. */
export type NativeExportFormat = 'csv' | 'tsv' | 'xlsx';

/** Which rows and columns the file carries: the current saved view, or the whole table. */
export type NativeExportScope = 'table' | 'view';

interface PanelPlan {
	readonly tableName: string;
	readonly scope: NativeExportScope;
	readonly viewName: string | null;
	readonly rowCount: number;
	readonly exportedCount: number;
	readonly hiddenColumns: number;
	readonly sortCount: number;
	readonly grouped: boolean;
	readonly filterProblems: readonly string[];
	readonly omittedLinks: number;
	readonly omittedUnsupported: number;
	readonly blockedReason: string | null;
	readonly matrix: readonly (readonly string[])[];
	readonly columns: readonly ExportColumn[];
	readonly exportable: boolean;
}

function blockedPlan(tableName: string, viewName: string, reason: string): PanelPlan {
	return {
		tableName,
		scope: 'view',
		viewName,
		rowCount: 0,
		exportedCount: 0,
		hiddenColumns: 0,
		sortCount: 0,
		grouped: false,
		filterProblems: [],
		omittedLinks: 0,
		omittedUnsupported: 0,
		blockedReason: reason,
		matrix: [],
		columns: [],
		exportable: false,
	};
}

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
	private format: NativeExportFormat = 'csv';
	/** The scope the person picked; `null` means the default: the current view when one is selected. */
	private scopeChoice: NativeExportScope | null = null;
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
		if (plan.blockedReason !== null) {
			return [plan.blockedReason];
		}
		const lines: string[] = [];
		if (plan.scope === 'view') {
			const order = plan.sortCount > 0 ? 'in its sort order' : 'in manual order';
			const collapsed = plan.grouped ? ', including rows in collapsed groups' : '';
			lines.push(
				`Saved view “${plan.viewName ?? ''}”: ${String(plan.rowCount)} row(s) matching its filter, ${order}${collapsed}, ${String(plan.exportedCount)} field(s). ${String(plan.hiddenColumns)} hidden field(s) are left out.`,
			);
			for (const problem of plan.filterProblems) {
				lines.push(`Filter problem in the view: ${problem}`);
			}
		} else {
			lines.push(
				`Whole table “${plan.tableName}”, in manual order: ${String(plan.rowCount)} row(s), ${String(plan.exportedCount)} field(s).`,
			);
		}
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
		if (plan.scope === 'table') {
			lines.push(
				'Saved view filters and sorts are not applied: the whole table is exported.',
			);
		}
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
			const target = freePath(base, this.format, (path) => this.options.vault.exists(path));
			if (this.format === 'xlsx') {
				// The same typed-cell writer the existing export uses: a number column is numbers, and text that
				// does not parse stays text. The workbook bytes go to the vault, never to a download.
				const write =
					this.options.writeXlsx ?? (await import('../export/xlsx')).writeXlsxSheet;
				const workbook = await write(toXlsxData(plan.matrix, plan.columns), target.name);
				await this.options.vault.create(target.path, workbook.bytes);
			} else {
				// TSV is the clipboard's own writer, so a file and a copy of the same table cannot disagree.
				const text =
					this.format === 'tsv'
						? toTsv(plan.matrix)
						: toCsv(plan.matrix, { newline: this.newline });
				await this.options.vault.create(target.path, text);
			}
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

	private effectiveScope(): NativeExportScope {
		const snapshot = this.options.store.getSnapshot();
		const hasView =
			snapshot.activeTableId !== null &&
			this.options.viewId !== undefined &&
			this.options.viewId !== null &&
			this.viewOf(snapshot.activeTableId, this.options.viewId) !== null;
		return this.scopeChoice ?? (hasView ? 'view' : 'table');
	}

	private viewOf(tableId: string, viewId: string): TableView | null {
		const document = this.options.store.getSnapshot().document;
		const table = projectTable(document, tableId);
		return table?.viewById.get(viewId) ?? null;
	}

	private plan(): PanelPlan | null {
		const document = this.options.store.getSnapshot().document;
		const activeId = this.options.store.getSnapshot().activeTableId;
		if (activeId === null) {
			return null;
		}
		const snapshot = projectTable(document, activeId);
		if (snapshot === null) {
			return null;
		}
		const scope = this.effectiveScope();
		const viewId = this.options.viewId ?? null;
		const view = scope === 'view' && viewId !== null ? this.viewOf(activeId, viewId) : null;
		if (scope === 'view' && view !== null) {
			const outcome = nativeViewMatrix(snapshot, view, this.mode, this.options.environment);
			if (!outcome.ok) {
				return blockedPlan(snapshot.table.name, view.name, outcome.reason);
			}
			const { result } = outcome;
			return {
				tableName: snapshot.table.name,
				scope: 'view',
				viewName: result.viewName,
				rowCount: result.rowCount,
				exportedCount: result.exportedFields.length,
				hiddenColumns: result.hiddenColumns,
				sortCount: result.sortCount,
				grouped: view.groupBy !== null,
				filterProblems: result.filterProblems,
				omittedLinks: result.omittedLinks,
				omittedUnsupported: result.omittedUnsupported,
				blockedReason: null,
				matrix: result.matrix,
				columns: result.columns,
				exportable: result.matrix.length > 0,
			};
		}
		const result = nativeTableMatrix(snapshot, this.mode, this.options.environment);
		return {
			tableName: snapshot.table.name,
			scope: 'table',
			viewName: null,
			rowCount: result.rowCount,
			exportedCount: result.exportedFields.length,
			hiddenColumns: 0,
			sortCount: 0,
			grouped: false,
			filterProblems: [],
			omittedLinks: result.omittedLinks,
			omittedUnsupported: result.omittedUnsupported,
			blockedReason: null,
			matrix: result.matrix,
			columns: result.columns,
			exportable: result.matrix.length > 0,
		};
	}

	private render(): void {
		if (this.disposed) {
			return;
		}
		this.root.replaceChildren();
		this.root.addClass('tablify-native-export');
		el(this.root, 'div', 'tablify-dlg-sub', 'Export table');
		const body = el(this.root, 'div', 'tablify-native-import-body');

		for (const line of this.scopeLines()) {
			el(body, 'div', 'tablify-dlg-fact', line);
		}

		const scopes = el(body, 'div', 'tablify-native-import-modes');
		scopes.setAttribute('role', 'radiogroup');
		scopes.setAttribute('aria-label', 'Rows and columns');
		const viewId = this.options.viewId ?? null;
		const snapshot = this.options.store.getSnapshot();
		const selectedView =
			snapshot.activeTableId !== null && viewId !== null
				? this.viewOf(snapshot.activeTableId, viewId)
				: null;
		const scopeChoices: readonly {
			readonly id: NativeExportScope;
			readonly label: string;
			readonly help: string;
			readonly disabled: boolean;
		}[] = [
			{
				id: 'view',
				label:
					selectedView === null
						? 'Current view (none selected)'
						: `Current view “${selectedView.name}”`,
				help: 'Only the rows its filter matches, in its sort order, without its hidden fields.',
				disabled: selectedView === null,
			},
			{
				id: 'table',
				label: 'Whole table',
				help: 'Every row in manual order, and every field.',
				disabled: false,
			},
		];
		for (const choice of scopeChoices) {
			const label = el(scopes, 'label', 'tablify-native-import-label');
			const radio = el(label, 'input');
			radio.type = 'radio';
			radio.name = 'tablify-export-scope';
			radio.value = choice.id;
			radio.disabled = choice.disabled;
			radio.checked = this.effectiveScope() === choice.id && !choice.disabled;
			radio.addEventListener('change', () => {
				if (radio.checked) {
					this.scopeChoice = choice.id;
					this.render();
				}
			});
			label.appendChild(this.root.ownerDocument.createTextNode(choice.label));
			el(scopes, 'div', 'tablify-dlg-hint', choice.help);
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

		const formats = el(body, 'div', 'tablify-native-import-modes');
		formats.setAttribute('role', 'radiogroup');
		formats.setAttribute('aria-label', 'File format');
		const formatChoices: readonly {
			readonly id: NativeExportFormat;
			readonly label: string;
			readonly help: string;
		}[] = [
			{ id: 'csv', label: 'CSV file', help: 'Comma-separated, quoted per RFC 4180.' },
			{
				id: 'tsv',
				label: 'TSV file',
				help: 'Tab-separated, the same text the clipboard copies.',
			},
			{
				id: 'xlsx',
				label: 'Excel workbook (XLSX)',
				help: 'One sheet. Number and date columns are typed; text that does not parse stays text.',
			},
		];
		for (const choice of formatChoices) {
			const label = el(formats, 'label', 'tablify-native-import-label');
			const radio = el(label, 'input');
			radio.type = 'radio';
			radio.name = 'tablify-export-format';
			radio.value = choice.id;
			radio.checked = this.format === choice.id;
			radio.addEventListener('change', () => {
				if (radio.checked) {
					this.format = choice.id;
					this.render();
				}
			});
			label.appendChild(this.root.ownerDocument.createTextNode(choice.label));
			el(formats, 'div', 'tablify-dlg-hint', choice.help);
		}

		if (this.format === 'csv') {
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
		}

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
			this.busy ? 'Exporting…' : `Export ${this.format.toUpperCase()}`,
		);
		exportButton.type = 'button';
		exportButton.disabled = this.busy || plan === null || !plan.exportable;
		exportButton.addEventListener('click', () => {
			void this.exportNow();
		});
	}
}
