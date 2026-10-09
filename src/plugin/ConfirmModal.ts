/**
 * A two-button confirmation for destructive grid actions. It is the host's own `Modal`, so focus, Escape,
 * and screen-reader handling come from Obsidian. The promise resolves `true` only when the action button
 * is pressed; Cancel, Escape, or closing the dialog resolves `false`.
 */
import { Modal } from 'obsidian';
import type { App } from 'obsidian';

export function confirmAction(app: App, message: string, actionLabel: string): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		new ConfirmModal(app, message, actionLabel, resolve).open();
	});
}

class ConfirmModal extends Modal {
	private settled = false;

	constructor(
		app: App,
		private readonly message: string,
		private readonly actionLabel: string,
		private readonly resolve: (confirmed: boolean) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.contentEl.createEl('p', { text: this.message });
		const row = this.contentEl.createDiv({ cls: 'tablify-confirm-actions' });
		const cancel = row.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => {
			this.finish(false);
		});
		const action = row.createEl('button', { text: this.actionLabel, cls: 'mod-warning' });
		action.addEventListener('click', () => {
			this.finish(true);
		});
	}

	override onClose(): void {
		this.finish(false);
	}

	private finish(confirmed: boolean): void {
		if (this.settled) {
			return;
		}
		this.settled = true;
		this.resolve(confirmed);
		this.close();
	}
}
