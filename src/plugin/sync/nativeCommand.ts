/**
 * The command's side of the native sync: the real vault, token and request transport, and nothing else.
 *
 * `main.ts` loads this module only inside the command handler (`await import('./sync/nativeCommand')`), so startup
 * does not evaluate the sync code. Every decision lives in `nativeHost.ts`, which the tests exercise with fakes. This
 * file only wires the adapters, and it is the one place in the native sync path that imports Obsidian.
 */
import { requestUrl } from 'obsidian';
import type { App } from 'obsidian';

import type { DatabaseStore } from '../../adapters/tablifyFile/databaseStore';
import { createAirtableClient } from '../../sync/airtable/client';
import { createRequestUrlTransport } from '../../sync/airtable/transport';
import { readToken, secretHostOf } from '../settings/secrets';
import { syncActiveStore } from './nativeHost';
import type { NativeSyncOutcome } from './nativeHost';

/** Runs a pull and then a push for the table the store shows, and says the outcome in one sentence. */
export async function syncActiveNativeTable(input: {
	readonly app: App;
	readonly store: DatabaseStore;
	readonly notify: (message: string) => void;
}): Promise<NativeSyncOutcome> {
	const { app } = input;
	const outcome = await syncActiveStore(
		{
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
		},
		{ store: input.store, direction: 'both' },
	);
	input.notify(
		outcome.kind === 'ran' && outcome.excluded.length > 0
			? `${outcome.message} ${outcome.excluded.length} field(s) are not synced yet.`
			: outcome.message,
	);
	return outcome;
}
