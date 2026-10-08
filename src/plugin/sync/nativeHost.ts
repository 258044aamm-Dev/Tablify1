/**
 * The plugin-side host for a **native table's** sync and first link (R5 Part C, Steps 2 and 6).
 *
 * It is the native counterpart of `host.ts`, and it is deliberately smaller. Everything with a side effect comes in
 * through {@link NativeSyncOptions}: the vault's text files, the token, and the factory that builds the remote target.
 * That keeps this module free of Obsidian and of the network, so the tests can prove the rules with fakes.
 *
 * ## The rules a run keeps
 *
 * - **Refuse, never guess.** No link file, a link with no remote table, a missing token, or a file this build cannot
 *   read each stop with one sentence. Nothing is fetched and nothing is written.
 * - **Save once, and only after success.** The link is written after the work returns. If it throws, the file on disk
 *   is exactly what it was.
 * - **Linking never rests on a partial read.** A truncated remote read refuses the link. Pairing rows against part of
 *   a table would invent a mapping for the rest.
 * - **The token never enters a file, a message or a return value.** It is read through `token()` at the moment of
 *   use and handed only to `targetFor`.
 */
import {
	nativeLinkPath,
	newNativeLink,
	parseNativeLink,
	serialiseNativeLink,
} from '../../sync/nativeLink';
import type { NativeLinkDocument } from '../../sync/nativeLink';
import { linkRowsByKey } from '../../sync/nativeLinking';
import type { LinkTarget } from '../../sync/LinkStore';
import type { DatabaseStore } from '../../adapters/tablifyFile/databaseStore';
import { createNativeSyncPort } from '../../sync/nativePort';
import { projectTable } from '../../core/database/projection';
import { invertRowMap } from '../../sync/nativeLinks';
import type { LinkBoundary } from '../../sync/nativeLinkField';
import type { NativeSyncPort, ExcludedField } from '../../sync/nativePort';
import { mappingFor, runNativeSync } from '../../sync/nativeRun';
import type { SyncDirection, SyncReport } from '../../sync/pullPush';
import { failureText } from '../../sync/pullPush';
import type { SyncTarget } from '../../sync/SyncTarget';
import type { ResolutionBook } from '../../sync/diff';
import { unresolvedConflicts } from '../../sync/diff';

/** The vault's text files, as this module needs them. Same shape as the legacy host's port. */
export type NativeFilePort = {
	readonly read: (path: string) => Promise<string | null>;
	readonly write: (path: string, text: string) => Promise<void>;
};

/** The clock, zone and locale the port formats with. Injected so a test is not at the mercy of the machine. */
export type NativeEnvironment = {
	readonly now: () => number;
	readonly timezone: string;
	readonly locale: string;
};

export type NativeSyncOptions = {
	readonly environment: NativeEnvironment;
	readonly files: NativeFilePort;
	/** The stored token, or `null`. Read at the moment of use, never cached here. */
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

/**
 * Why a sync was refused. `unlinked` is the one a caller can act on (open the link dialog); everything else is
 * something the person has to fix first.
 */
export type RefusalReason = 'unlinked' | 'other';

export type NativeSyncOutcome =
	| { readonly kind: 'refused'; readonly reason: RefusalReason; readonly message: string }
	| {
			readonly kind: 'ran';
			readonly message: string;
			readonly needsReview: boolean;
			readonly excluded: readonly ExcludedField[];
			readonly report: SyncReport;
	  };

const UNLINKED = 'This table is not linked to a remote table yet.';
const NO_TOKEN = 'Add an Airtable token in Settings › Tablify › Sync first.';

/** One sync run for one native table. Returns what happened in a sentence, and never throws. */
export async function syncNativeTable(
	options: NativeSyncOptions,
	input: NativeSyncInput,
): Promise<NativeSyncOutcome> {
	const path = nativeLinkPath(input.databaseId, input.tableId);
	const text = await options.files.read(path);
	if (text === null) {
		return refused('unlinked', UNLINKED);
	}
	const loaded = parseNativeLink(text, path);
	if (!loaded.ok) {
		return refused('other', loaded.reason);
	}
	const document = loaded.document;
	if (document.databaseId !== input.databaseId || document.tableId !== input.tableId) {
		return refused('other', `${path} belongs to another table. It was not changed.`);
	}
	if (document.target.baseId === '') {
		return refused('unlinked', UNLINKED);
	}
	const token = options.token();
	if (token === null) {
		return refused('other', NO_TOKEN);
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
		return refused('other', failureText(error));
	}

	await options.files.write(path, serialiseNativeLink(result.document));
	return {
		kind: 'ran',
		message: result.report.summary,
		needsReview:
			unresolvedConflicts(result.report.plan.diff.conflicts, input.choices ?? new Map())
				.length > 0,
		excluded: result.excluded,
		report: result.report,
	};
}

/**
 * The sync for the table a store is showing. The port is built from the store here, so the caller never names a
 * table: the active one is the only one a person can see and mean.
 */
/**
 * The link fields of one table that may sync this run, each with its boundary: the target table's link file, filtered
 * to rows that still exist. A link field with no usable boundary (no target link file, a damaged file, or two rows
 * on one record) is left out, so it stays excluded, exactly as it was before linked sync existed.
 */
export async function linkFieldsFor(
	read: (path: string) => Promise<string | null>,
	store: DatabaseStore,
	databaseId: string,
	tableId: string,
): Promise<Map<string, LinkBoundary>> {
	const out = new Map<string, LinkBoundary>();
	const document = store.getSnapshot().document;
	const table = projectTable(document, tableId);
	if (table === null) {
		return out;
	}
	for (const field of table.fields) {
		if (field.kind !== 'field' || field.id === null || field.type !== 'link') {
			continue;
		}
		const target = field.settings['targetTableId'];
		if (typeof target !== 'string') {
			continue;
		}
		const path = nativeLinkPath(databaseId, target);
		const text = await read(path);
		if (text === null) {
			continue;
		}
		const loaded = parseNativeLink(text, path);
		const live = projectTable(document, target);
		if (!loaded.ok || live === null) {
			continue;
		}
		const liveIds = new Set(live.rows.map((row) => row.id));
		const rowToRecord: Record<string, string> = {};
		for (const [rowId, recordId] of Object.entries(loaded.document.rowMap)) {
			if (liveIds.has(rowId)) {
				rowToRecord[rowId] = recordId;
			}
		}
		const inverse = invertRowMap(rowToRecord);
		if (!inverse.ok) {
			continue;
		}
		out.set(field.id, {
			remoteTableId: loaded.document.target.tableId,
			rowToRecord,
			recordToRow: inverse.byRecord,
		});
	}
	return out;
}

export async function syncActiveStore(
	options: NativeSyncOptions,
	input: {
		readonly store: DatabaseStore;
		readonly direction: SyncDirection;
		readonly choices?: ResolutionBook | undefined;
	},
): Promise<NativeSyncOutcome> {
	const snapshot = input.store.getSnapshot();
	const tableId = snapshot.activeTableId;
	if (tableId === null) {
		return refused('other', 'Select a table first.');
	}
	const databaseId = snapshot.document.databaseId;
	const linkFields = await linkFieldsFor(
		(path) => options.files.read(path),
		input.store,
		databaseId,
		tableId,
	);
	const port = createNativeSyncPort({
		store: input.store,
		tableId,
		environment: options.environment,
		linkFields,
	});
	return syncNativeTable(options, {
		databaseId,
		tableId,
		port,
		direction: input.direction,
		...(input.choices === undefined ? {} : { choices: input.choices }),
	});
}

export type LinkSetupInput = {
	readonly store: DatabaseStore;
	/** The local text field whose values pair rows with records. Matched by display name, as the mapping is. */
	readonly keyFieldName: string;
	readonly target: { readonly baseId: string; readonly tableId: string };
};

export type LinkSetupOutcome =
	| { readonly kind: 'refused'; readonly message: string }
	| { readonly kind: 'linked'; readonly message: string; readonly document: NativeLinkDocument };

/**
 * Creates the link for the active table: the remote table's field mapping, and the first row-to-record pairs by one
 * key. It saves the link and runs no sync, so the first real sync is a separate, visible step.
 *
 * Nothing is created on either side. Rows and records that cannot be paired are reported in the message.
 */
export async function linkActiveStore(
	options: NativeSyncOptions,
	input: LinkSetupInput,
): Promise<LinkSetupOutcome> {
	const snapshot = input.store.getSnapshot();
	const tableId = snapshot.activeTableId;
	if (tableId === null) {
		return { kind: 'refused', message: 'Select a table first.' };
	}
	const databaseId = snapshot.document.databaseId;
	const path = nativeLinkPath(databaseId, tableId);
	if ((await options.files.read(path)) !== null) {
		return {
			kind: 'refused',
			message: `${path} already links this table. Delete it to link the table afresh.`,
		};
	}
	if (input.target.baseId.trim() === '' || input.target.tableId.trim() === '') {
		return {
			kind: 'refused',
			message: 'Enter both the base identifier and the table identifier.',
		};
	}
	const token = options.token();
	if (token === null) {
		return { kind: 'refused', message: NO_TOKEN };
	}

	const port = createNativeSyncPort({
		store: input.store,
		tableId,
		environment: options.environment,
	});
	const keyFields = port
		.syncFields()
		.filter((field) => port.columnNameOf(field.definition.name) === input.keyFieldName);
	if (keyFields.length !== 1) {
		return {
			kind: 'refused',
			message: `The key must name exactly one field that syncs, “${input.keyFieldName}” matches ${String(keyFields.length)}.`,
		};
	}
	const keyFieldId = keyFields[0]?.definition.name ?? '';

	try {
		const target = options.targetFor(
			{
				baseId: input.target.baseId.trim(),
				baseName: '',
				tableId: input.target.tableId.trim(),
				tableName: '',
			},
			token,
		);
		const description = await target.describe();
		const remoteKeys = description.fields.filter((field) => field.name === input.keyFieldName);
		if (remoteKeys.length !== 1) {
			return {
				kind: 'refused',
				message: `The remote table needs exactly one field named “${input.keyFieldName}”, and it has ${String(remoteKeys.length)}.`,
			};
		}
		const remoteKeyId = remoteKeys[0]?.id ?? '';

		const read = await target.pull(null);
		if (read.truncated) {
			return {
				kind: 'refused',
				message: 'The remote read was incomplete, so nothing was linked. Try again.',
			};
		}

		const draft = newNativeLink({
			databaseId,
			tableId,
			target: {
				baseId: input.target.baseId.trim(),
				baseName: description.baseName,
				tableId: input.target.tableId.trim(),
				tableName: description.tableName,
			},
		});
		const mapping = await mappingFor(target, port, draft);

		const localRows: { rowId: string; key: string | null }[] = [];
		for (const row of await port.rows()) {
			const values = await port.values(row.path);
			const key = values[keyFieldId];
			localRows.push({ rowId: row.path, key: typeof key === 'string' ? key : null });
		}
		const records = read.records.map((record) => {
			const key = record.fields[remoteKeyId];
			return { recordId: record.id, key: typeof key === 'string' ? key : null };
		});
		const plan = linkRowsByKey(localRows, records);

		const document: NativeLinkDocument = {
			...draft,
			fieldMap: mapping.fieldMap,
			rowMap: plan.rowMap,
		};
		await options.files.write(path, serialiseNativeLink(document));
		const linked = Object.keys(plan.rowMap).length;
		return {
			kind: 'linked',
			message:
				`Linked ${String(linked)} row(s). ${String(plan.unlinkedRows.length)} row(s) and ` +
				`${String(plan.unlinkedRecords.length)} record(s) could not be paired, and nothing was created. ` +
				'Run the sync to compare values.',
			document,
		};
	} catch (error) {
		return { kind: 'refused', message: failureText(error) };
	}
}

function refused(reason: RefusalReason, message: string): NativeSyncOutcome {
	return { kind: 'refused', reason, message };
}
