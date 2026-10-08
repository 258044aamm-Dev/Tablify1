/**
 * The command's side of the native sync and first link: the real vault, token, request transport and dialog. Nothing
 * else.
 *
 * `main.ts` loads this module only inside the command handler (`await import('./sync/nativeCommand')`), so startup
 * does not evaluate the sync code. Every decision lives in `nativeHost.ts`, which the tests exercise with fakes. This
 * file only wires the adapters and shows the one dialog, and it is the one place in the native sync path that imports
 * Obsidian.
 */
import { Modal, requestUrl } from 'obsidian';
import type { App } from 'obsidian';

import type { DatabaseStore } from '../../adapters/tablifyFile/databaseStore';
import { createAirtableClient } from '../../sync/airtable/client';
import { createRequestUrlTransport } from '../../sync/airtable/transport';
import { readToken, secretHostOf } from '../settings/secrets';
import { linkActiveStore, syncActiveStore } from './nativeHost';
import type { NativeSyncOptions, NativeSyncOutcome } from './nativeHost';

/** The adapters a native sync or link needs, built from the app. */
function optionsFor(app: App): NativeSyncOptions {
	return {
		environment: {
			now: () => Date.now(),
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			locale: navigator.language,
		},
		files: {
			// `DataAdapter.read` rejects on a missing file; the link store wants `null` (never linked is not an error).
			read: async (path) => {
				try {
					return await app.vault.adapter.read(path);
				} catch {
					return null;
				}
			},
			write: async (path, text) => {
				// The adapter does not create a missing parent; `.tablify/links` is created once, then written.
				const parent = path.slice(0, path.lastIndexOf('/'));
				if (parent !== '' && !(await app.vault.adapter.exists(parent))) {
					await app.vault.adapter.mkdir(parent);
				}
				await app.vault.adapter.write(path, text);
			},
		},
		token: () => {
			try {
				return readToken(secretHostOf(app));
			} catch {
				return null;
			}
		},
		targetFor: (target, token) =>
			createAirtableClient({
				token,
				baseId: target.baseId,
				tableId: target.tableId,
				// Obsidian's own network path, with `throw: false` so a 429's status and `Retry-After` survive as data.
				transport: createRequestUrlTransport((request) => requestUrl(request)),
			}),
	};
}

export type NativeLinkValues = {
	readonly baseId: string;
	readonly tableId: string;
	readonly keyFieldName: string;
};

/** A small form for the link: the two identifiers and the key field's name. Submitting closes it. */
class LinkTableDialog extends Modal {
	private readonly onSubmit: (values: NativeLinkValues) => void;

	constructor(app: App, onSubmit: (values: NativeLinkValues) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Link this table' });
		contentEl.createEl('p', {
			text: 'Enter the base and table identifiers from the table’s address. Choose the text field whose values match each row to one remote record. Nothing is created on either side.',
		});
		const baseInput = labelled(contentEl, 'Base identifier', 'app…');
		const tableInput = labelled(contentEl, 'Table identifier', 'tbl…');
		const keyInput = labelled(contentEl, 'Key field name', 'Name');
		const submit = contentEl.createEl('button', { text: 'Link table' });
		submit.addEventListener('click', () => {
			const values: NativeLinkValues = {
				baseId: baseInput.value.trim(),
				tableId: tableInput.value.trim(),
				keyFieldName: keyInput.value.trim(),
			};
			this.close();
			this.onSubmit(values);
		});
	}
}

function labelled(parent: HTMLElement, label: string, placeholder: string): HTMLInputElement {
	const row = parent.createDiv();
	row.createEl('label', { text: label });
	return row.createEl('input', { type: 'text', placeholder });
}

/**
 * Runs a pull and push for the table the store shows. If the table has no link yet, it opens the link dialog instead
 * of failing: linking is the first thing a person needs, and it is their choice of identifiers that creates it.
 */
export async function syncActiveNativeTable(input: {
	readonly app: App;
	readonly store: DatabaseStore;
	readonly notify: (message: string) => void;
}): Promise<NativeSyncOutcome> {
	const options = optionsFor(input.app);
	const outcome = await syncActiveStore(options, { store: input.store, direction: 'both' });
	if (outcome.kind === 'refused' && outcome.reason === 'unlinked') {
		new LinkTableDialog(input.app, (values) => {
			void linkActiveNativeTable({
				app: input.app,
				store: input.store,
				values,
				notify: input.notify,
			});
		}).open();
		return outcome;
	}
	input.notify(
		outcome.kind === 'ran' && outcome.excluded.length > 0
			? `${outcome.message} ${String(outcome.excluded.length)} field(s) are not synced yet.`
			: outcome.message,
	);
	return outcome;
}

/** Creates the link from the dialog's values, then says what was paired. It runs no sync. */
export async function linkActiveNativeTable(input: {
	readonly app: App;
	readonly store: DatabaseStore;
	readonly values: NativeLinkValues;
	readonly notify: (message: string) => void;
}): Promise<void> {
	const outcome = await linkActiveStore(optionsFor(input.app), {
		store: input.store,
		keyFieldName: input.values.keyFieldName,
		target: { baseId: input.values.baseId, tableId: input.values.tableId },
	});
	input.notify(outcome.message);
}
