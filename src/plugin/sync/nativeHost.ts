/**
 * The plugin-side host for a **native table's** sync (R5 Part C, Step 6).
 *
 * It is the native counterpart of `host.ts`, and it is deliberately smaller. Everything with a side effect comes in
 * through {@link NativeSyncOptions}: the vault's text files, the token, and the factory that builds the remote target.
 * That keeps this module free of Obsidian and of the network, so the tests can prove the rules with fakes.
 *
 * ## The rules a run keeps
 *
 * - **Refuse, never guess.** No link file, a link with no remote table, a missing token, or a file this build cannot
 *   read each stop the run with one sentence. Nothing is fetched and nothing is written.
 * - **Save once, and only after success.** The link is written after the run returns. If the run throws, the file
 *   on disk is exactly what it was, so a half-finished run cannot claim agreement it never reached.
 * - **The token never enters a file, a message or a return value.** It is read through `token()` at the moment of the
 *   run and handed only to `targetFor`.
 */
import { nativeLinkPath, parseNativeLink, serialiseNativeLink } from '../../sync/nativeLink';
import type { LinkTarget } from '../../sync/LinkStore';
import type { NativeSyncPort, ExcludedField } from '../../sync/nativePort';
import { runNativeSync } from '../../sync/nativeRun';
import type { SyncDirection, SyncReport } from '../../sync/pullPush';
import { failureText } from '../../sync/pullPush';
import type { SyncTarget } from '../../sync/SyncTarget';
import type { ResolutionBook } from '../../sync/diff';

/** The vault's text files, as this module needs them. Same shape as the legacy host's port. */
export type NativeFilePort = {
	readonly read: (path: string) => Promise<string | null>;
	readonly write: (path: string, text: string) => Promise<void>;
};

export type NativeSyncOptions = {
	readonly files: NativeFilePort;
	/** The stored token, or `null`. Read at the moment of the run, never cached here. */
	readonly token: () => string | null;
	/** Builds the remote target for one link and one token. Injected: the real one wraps Obsidian's request transport. */
	readonly targetFor: (target: LinkTarget, token: string) => SyncTarget;
	readonly now?: (() => string) | undefined;
};

export type NativeSyncInput = {
	readonly databaseId: string;
	readonly tableId: string;
	readonly port: NativeSyncPort;
	readonly direction: SyncDirection;
	readonly choices?: ResolutionBook | undefined;
};

export type NativeSyncOutcome =
	| { readonly kind: 'refused'; readonly message: string }
	| {
			readonly kind: 'ran';
			readonly message: string;
			readonly needsReview: boolean;
			readonly excluded: readonly ExcludedField[];
			readonly report: SyncReport;
	  };

/** One sync run for one native table. Returns what happened in a sentence, and never throws. */
export async function syncNativeTable(
	options: NativeSyncOptions,
	input: NativeSyncInput,
): Promise<NativeSyncOutcome> {
	const path = nativeLinkPath(input.databaseId, input.tableId);
	const text = await options.files.read(path);
	if (text === null) {
		return refused('This table is not linked to a remote table yet.');
	}
	const loaded = parseNativeLink(text, path);
	if (!loaded.ok) {
		return refused(loaded.reason);
	}
	const document = loaded.document;
	if (document.databaseId !== input.databaseId || document.tableId !== input.tableId) {
		return refused(`${path} belongs to another table. It was not changed.`);
	}
	if (document.target.baseId === '') {
		return refused('This table is not linked to a remote table yet.');
	}
	const token = options.token();
	if (token === null) {
		return refused('Add an Airtable token in Settings › Tablify › Sync first.');
	}

	let result: Awaited<ReturnType<typeof runNativeSync>>;
	try {
		result = await runNativeSync({
			target: options.targetFor(document.target, token),
			port: input.port,
			document,
			direction: input.direction,
			...(input.choices === undefined ? {} : { choices: input.choices }),
			...(options.now === undefined ? {} : { now: options.now }),
		});
	} catch (error) {
		return refused(failureText(error));
	}

	await options.files.write(path, serialiseNativeLink(result.document));
	return {
		kind: 'ran',
		message: result.report.summary,
		needsReview: result.report.plan.conflicts.length > 0,
		excluded: result.excluded,
		report: result.report,
	};
}

function refused(message: string): NativeSyncOutcome {
	return { kind: 'refused', message };
}
