/**
 * Obsidian host for the native CSV export. The modal mounts {@link NativeExportPanel} and maps its vault port onto
 * `app.vault`; the export itself is decided by the panel and the core matrix.
 */
import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import type { DatabaseStore } from '../../adapters/tablifyFile';
import type { NativeExportEnvironment } from '../../core/database/export/nativeMatrix';
import { NativeExportPanel } from './NativeExportPanel';

export interface NativeExportModalOptions {
	readonly store: DatabaseStore;
	readonly environment: NativeExportEnvironment;
}

export class NativeExportModal extends Modal {
	private readonly modalOptions: NativeExportModalOptions;
	private panel: NativeExportPanel | null = null;

	constructor(app: App, options: NativeExportModalOptions) {
		super(app);
		this.modalOptions = options;
	}

	onOpen(): void {
		this.setTitle('Export table');
		const vault = this.app.vault;
		this.panel = new NativeExportPanel(this.contentEl, {
			store: this.modalOptions.store,
			environment: this.modalOptions.environment,
			vault: {
				exists: (path) => vault.getAbstractFileByPath(path) !== null,
				createFolder: async (path) => {
					await vault.createFolder(path);
				},
				create: async (path, data) => {
					// Text goes through `create`, bytes through `createBinary`: the vault API has one call for each.
					if (typeof data === 'string') {
						await vault.create(path, data);
					} else {
						await vault.createBinary(path, data);
					}
				},
			},
			now: () => new Date(),
			close: () => {
				this.close();
			},
			announce: (message) => {
				new Notice(message);
			},
		});
	}

	onClose(): void {
		this.panel?.dispose();
		this.panel = null;
		this.contentEl.empty();
	}
}
