/**
 * The native sync panel: one table's link state, what syncs and what does not, and the sync actions (R5 Part C).
 *
 * DOM only, with no Obsidian import, so the DOM tests mount it directly. The panel decides nothing itself: it asks the
 * host for the status, runs the sync or the link it is given, and shows the one sentence that comes back. A run that
 * needs a review is handed to `onReview`, so the modal that owns the panel opens the existing review dialog.
 *
 * A second action cannot start while one is running, so a double click cannot run two syncs over the same link file.
 */
import type { NativeSyncStatus } from './nativeHost';

export type NativeSyncDirection = 'pull' | 'push' | 'both';

/** What the panel needs from a run: a sentence, and whether a review must follow. The host's outcome has both. */
export type NativePanelOutcome = {
	readonly message: string;
	readonly needsReview?: boolean | undefined;
};

export type NativeLinkValues = {
	readonly baseId: string;
	readonly tableId: string;
	readonly keyFieldName: string;
};

export type NativeSyncPanelOptions<O extends NativePanelOutcome> = {
	readonly status: () => Promise<NativeSyncStatus | null>;
	readonly sync: (direction: NativeSyncDirection) => Promise<O>;
	/** Creates the link and returns the one sentence to show. Runs no sync. */
	readonly link: (values: NativeLinkValues) => Promise<string>;
	readonly onReview: (outcome: O) => void;
	readonly announce: (message: string) => void;
};

function clear(element: HTMLElement): void {
	while (element.firstChild !== null) {
		element.removeChild(element.firstChild);
	}
}

export class NativeSyncPanel<O extends NativePanelOutcome> {
	private readonly root: HTMLElement;
	private readonly options: NativeSyncPanelOptions<O>;
	private busy = false;
	private disposed = false;
	private readonly buttons: HTMLButtonElement[] = [];
	private messageEl: HTMLElement | null = null;
	/** The last sentence shown. A redraw keeps it, so the outcome of an action survives the refresh after it. */
	private lastMessage = '';

	constructor(root: HTMLElement, options: NativeSyncPanelOptions<O>) {
		this.root = root;
		this.options = options;
		void this.refresh();
	}

	/** Reads the status again and redraws. Safe to call at any time; a disposed panel draws nothing. */
	async refresh(): Promise<void> {
		const status = await this.options.status();
		if (this.disposed) {
			return;
		}
		this.render(status);
	}

	dispose(): void {
		this.disposed = true;
		clear(this.root);
	}

	/** Whether an action is running. Exposed so a test can wait for a run to finish. */
	isBusy(): boolean {
		return this.busy;
	}

	private render(status: NativeSyncStatus | null): void {
		clear(this.root);
		this.buttons.length = 0;
		this.root.createEl('h2', { text: 'Sync this table' });
		if (status === null) {
			this.root.createEl('p', { text: 'Select a table first.' });
			return;
		}
		this.root.createEl('p', { text: `Table: ${status.tableName}` });
		if (status.problem !== null) {
			this.root.createEl('p', { cls: 'tablify-native-sync-problem', text: status.problem });
		}
		if (status.linked) {
			this.renderLinked(status);
		} else {
			this.renderUnlinked();
		}
		this.renderFields(status);
		this.messageEl = this.root.createEl('p', {
			cls: 'tablify-native-sync-message',
			text: this.lastMessage,
		});
		this.messageEl.setAttribute('role', 'status');
		this.messageEl.setAttribute('aria-live', 'polite');
		this.setBusyState();
	}

	private renderLinked(status: NativeSyncStatus): void {
		this.root.createEl('p', {
			text: `Linked to the remote table “${status.remoteTableName ?? 'unnamed'}”.`,
		});
		this.root.createEl('p', { text: `Last pulled: ${status.lastPulledAt ?? 'never'}` });
		this.root.createEl('p', { text: `Last pushed: ${status.lastPushedAt ?? 'never'}` });
		const row = this.root.createDiv({ cls: 'tablify-native-sync-actions' });
		this.action(row, 'Pull', 'pull');
		this.action(row, 'Push', 'push');
		this.action(row, 'Pull and push', 'both');
		if (!status.hasToken) {
			this.root.createEl('p', {
				cls: 'tablify-native-sync-problem',
				text: 'Add the access token in the plugin settings first.',
			});
		}
	}

	private renderUnlinked(): void {
		this.root.createEl('p', {
			text: 'This table is not linked to a remote table yet. Enter the remote base and table identifiers, and the name of the text field whose values match each row. Nothing is created on either side.',
		});
		const baseInput = this.field('Base identifier', 'app…');
		const tableInput = this.field('Table identifier', 'tbl…');
		const keyInput = this.field('Key field name', 'Name');
		const submit = this.root.createEl('button', { text: 'Link table' });
		this.buttons.push(submit);
		submit.addEventListener('click', () => {
			const values = {
				baseId: baseInput.value.trim(),
				tableId: tableInput.value.trim(),
				keyFieldName: keyInput.value.trim(),
			};
			void this.linkNow(values);
		});
	}

	private renderFields(status: NativeSyncStatus): void {
		this.root.createEl('p', {
			text:
				status.synced.length === 0
					? 'No fields sync yet.'
					: `Fields that sync: ${status.synced.join(', ')}.`,
		});
		if (status.excluded.length > 0) {
			const list = this.root.createEl('ul');
			for (const field of status.excluded) {
				list.createEl('li', { text: `${field.name}: ${field.reason}` });
			}
		}
	}

	private field(label: string, placeholder: string): HTMLInputElement {
		const row = this.root.createDiv();
		row.createEl('label', { text: label });
		return row.createEl('input', { type: 'text', placeholder });
	}

	private action(parent: HTMLElement, label: string, direction: NativeSyncDirection): void {
		const button = parent.createEl('button', { text: label });
		this.buttons.push(button);
		button.addEventListener('click', () => {
			void this.runNow(direction);
		});
	}

	private setBusyState(): void {
		for (const button of this.buttons) {
			button.disabled = this.busy;
		}
	}

	private show(message: string): void {
		this.lastMessage = message;
		if (this.messageEl !== null) {
			this.messageEl.textContent = message;
		}
		this.options.announce(message);
	}

	private async runNow(direction: NativeSyncDirection): Promise<void> {
		if (this.busy) {
			return;
		}
		this.busy = true;
		this.setBusyState();
		try {
			const outcome = await this.options.sync(direction);
			this.show(outcome.message);
			if (outcome.needsReview === true) {
				this.options.onReview(outcome);
			}
		} finally {
			this.busy = false;
		}
		await this.refresh();
	}

	private async linkNow(values: NativeLinkValues): Promise<void> {
		if (this.busy) {
			return;
		}
		if (values.baseId === '' || values.tableId === '' || values.keyFieldName === '') {
			this.show('Enter the base identifier, the table identifier and the key field name.');
			return;
		}
		this.busy = true;
		this.setBusyState();
		try {
			this.show(await this.options.link(values));
		} finally {
			this.busy = false;
		}
		await this.refresh();
	}
}
