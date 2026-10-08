/**
 * Obsidian host for the native import wizard. The modal only mounts {@link NativeImportPanel} into its content element
 * and turns its one outcome sentence into a Notice; every decision lives in the panel and the pure model.
 */
import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import type { NativeImportPanelOptions } from './NativeImportPanel';
import { NativeImportPanel } from './NativeImportPanel';

export type NativeImportModalOptions = Omit<NativeImportPanelOptions, 'close' | 'announce'>;

export class NativeImportModal extends Modal {
	private readonly modalOptions: NativeImportModalOptions;
	private panel: NativeImportPanel | null = null;

	constructor(app: App, options: NativeImportModalOptions) {
		super(app);
		this.modalOptions = options;
	}

	onOpen(): void {
		this.setTitle('Import rows');
		this.panel = new NativeImportPanel(this.contentEl, {
			...this.modalOptions,
			close: () => {
				this.close();
			},
			announce: (message) => {
				new Notice(message);
			},
		});
	}

	onClose(): void {
		// Closing mid-apply aborts an apply that has not committed; after the commit point the panel ignores it.
		this.panel?.dispose();
		this.panel = null;
		this.contentEl.empty();
	}
}
