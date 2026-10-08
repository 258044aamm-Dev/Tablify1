/**
 * The command's side of the native sync and first link: the real vault, token, request transport and the modal that
 * mounts the sync panel. Nothing else.
 *
 * `main.ts` loads this module only inside the command handler (`await import('./sync/nativeCommand')`), so startup
 * does not evaluate the sync code. Every decision lives in `nativeHost.ts`, which the tests exercise with fakes. This
 * file only wires the adapters and shows the one dialog, and it is the one place in the native sync path that imports
 * Obsidian.
 */
import { Modal, Notice, requestUrl } from 'obsidian';
import type { App } from 'obsidian';

import type { DatabaseStore } from '../../adapters/tablifyFile/databaseStore';
import { createAirtableClient } from '../../sync/airtable/client';
import { createRequestUrlTransport } from '../../sync/airtable/transport';
import { readToken, secretHostOf } from '../settings/secrets';
import { ConflictReviewDialog } from './ConflictReview';
import { linkActiveStore, nativeStatusOf, syncActiveStore } from './nativeHost';
import type { NativeSyncOptions, NativeSyncOutcome } from './nativeHost';
import { NativeSyncPanel } from './NativeSyncPanel';
import type { NativeLinkValues } from './NativeSyncPanel';

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

/** The panel in a modal. The modal only mounts the panel and closes it; every decision lives in the panel and host. */
class NativeSyncModal extends Modal {
	private readonly input: NativeSyncModalInput;
	private panel: NativeSyncPanel<NativeSyncOutcome> | null = null;

	constructor(input: NativeSyncModalInput) {
		super(input.app);
		this.input = input;
	}

	onOpen(): void {
		const { app, store } = this.input;
		const options = optionsFor(app);
		this.panel = new NativeSyncPanel<NativeSyncOutcome>(this.contentEl, {
			status: () => nativeStatusOf(options, store),
			sync: async (direction) => syncActiveStore(options, { store, direction }),
			link: async (values: NativeLinkValues) => {
				const outcome = await linkActiveStore(options, {
					store,
					keyFieldName: values.keyFieldName,
					target: { baseId: values.baseId, tableId: values.tableId },
				});
				return outcome.message;
			},
			onReview: (outcome: NativeSyncOutcome) => {
				// Only a completed run carries a plan; a refused run never asks for a review.
				if (outcome.kind !== 'ran') {
					return;
				}
				new ConflictReviewDialog(app, {
					spec: { conflicts: outcome.report.plan.conflicts },
					onConfirm: async (choices) => {
						const applied = await syncActiveStore(options, {
							store,
							direction: 'both',
							choices,
						});
						new Notice(`Tablify: ${applied.message}`);
						return applied.message;
					},
				}).open();
			},
			announce: (message) => {
				new Notice(`Tablify: ${message}`);
			},
		});
	}

	onClose(): void {
		this.panel?.dispose();
		this.panel = null;
		this.contentEl.empty();
	}
}

export type NativeSyncModalInput = {
	readonly app: App;
	readonly store: DatabaseStore;
};

/** Opens the native sync panel for the table the store shows. Nothing runs until the person presses a button in it. */
export function openNativeSyncPanel(input: NativeSyncModalInput): void {
	new NativeSyncModal(input).open();
}
