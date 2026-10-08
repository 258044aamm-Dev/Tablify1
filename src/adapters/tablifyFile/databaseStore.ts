/**
 * The native database store for R3/R4.
 *
 * Unlike the legacy `GridStore` (which remains attached to the note-backed view until R6), this
 * store never owns rows or fields. The shared `DatabaseSession` owns the sole canonical document and
 * database-scoped operation history; this store derives one active-table projection for one pane.
 * It is intentionally framework- and host-free, so the R4 renderer can subscribe without creating a
 * second writable copy or bypassing the revision-checked document queue.
 */
import type {
	ActiveTableSnapshot,
	DatabaseDocument,
	DatabaseHistorySummary,
	DatabaseOperation,
} from '../../core/database';
import { projectTable } from '../../core/database';
import type {
	DatabaseSession,
	DispatchRefusalCode,
	DispatchResult,
	FlushResult,
	HistoryResult,
	SessionChange,
	SessionState,
} from './session';
import type { WriteQueue } from './queue';

/** One stable, derived view of the canonical document for a particular pane and document revision. */
export interface DatabaseStoreSnapshot {
	/** Changes on every document, session-status, save-result, or active-table transition. */
	readonly revision: number;
	/** The exact object held by the session; this store never clones or writes it back. */
	readonly document: DatabaseDocument;
	/** The pane's transient selection, independent of saved document data. */
	readonly activeTableId: string | null;
	/** Derived from `document` and `activeTableId`; null only when the document has no tables. */
	readonly activeTable: ActiveTableSnapshot | null;
	readonly sessionState: SessionState;
	readonly history: DatabaseHistorySummary;
	/** The last save failure, retained until a later successful save or explicit reload. */
	readonly writeError: string | null;
}

export type TableSelectionResult =
	| { readonly ok: true; readonly changed: boolean }
	| { readonly ok: false; readonly code: 'no-such-table' | 'disposed'; readonly message: string };

export interface DatabaseStoreOptions {
	readonly session: DatabaseSession;
	readonly queue: WriteQueue;
	/** A restored workspace selection; missing or stale ids fall back to the first table. */
	readonly initialTableId?: string;
}

/** One pane's derived store. The session and queue may be shared by several of these. */
export interface DatabaseStore {
	/** Stable between changes; ready for `useSyncExternalStore` or a framework-free consumer. */
	getSnapshot(): DatabaseStoreSnapshot;
	subscribe(listener: () => void): () => void;
	/** Navigation only: never dispatches a document operation or schedules a write. */
	selectTable(tableId: string): TableSelectionResult;
	/** One operation or one logical batch; the session validates before publishing it. */
	dispatch(
		operation: DatabaseOperation | readonly DatabaseOperation[],
		label?: string,
	): DispatchResult;
	undo(): HistoryResult;
	redo(): HistoryResult;
	/** Flushes the same shared queue that automatic dispatch/undo/redo use. */
	flush(): Promise<FlushResult>;
	/** Releases only this pane's listener. The registry owns queue/session lifetime. */
	dispose(): void;
}

function hasTable(document: DatabaseDocument, tableId: string): boolean {
	return document.tables.some((table) => table.id === tableId);
}

function refusal(
	code: DispatchRefusalCode,
	message: string,
): { readonly ok: false; readonly code: DispatchRefusalCode; readonly message: string } {
	return { ok: false, code, message };
}

export function createDatabaseStore(options: DatabaseStoreOptions): DatabaseStore {
	const { session, queue } = options;
	let activeTableId: string | null = null;
	let revision = 0;
	let writeError: string | null = null;
	let disposed = false;
	const listeners = new Set<() => void>();
	let snapshot: DatabaseStoreSnapshot;

	const reconcileTable = (document: DatabaseDocument): void => {
		if (activeTableId !== null && !hasTable(document, activeTableId)) {
			activeTableId = document.tables[0]?.id ?? null;
		} else if (activeTableId === null && document.tables.length > 0) {
			activeTableId = document.tables[0]?.id ?? null;
		}
	};

	const buildSnapshot = (): DatabaseStoreSnapshot => {
		const document = session.getDocument();
		reconcileTable(document);
		return Object.freeze({
			revision,
			document,
			activeTableId,
			activeTable: activeTableId === null ? null : projectTable(document, activeTableId),
			sessionState: session.getState(),
			history: session.getHistorySummary(),
			writeError,
		});
	};

	const publish = (): void => {
		revision += 1;
		snapshot = buildSnapshot();
		for (const listener of [...listeners]) {
			listener();
		}
	};

	const onSessionChange = (change: SessionChange): void => {
		if (disposed) {
			return;
		}
		if (change.kind === 'write-failed') {
			writeError = change.message;
		} else if (
			change.kind === 'saved' ||
			(change.kind === 'document' && change.state === 'clean')
		) {
			writeError = null;
		}
		publish();
	};

	const restoredTableId = options.initialTableId;
	if (restoredTableId !== undefined && hasTable(session.getDocument(), restoredTableId)) {
		activeTableId = restoredTableId;
	} else {
		activeTableId = session.getDocument().tables[0]?.id ?? null;
	}
	snapshot = buildSnapshot();
	const unsubscribeSession = session.subscribe(onSessionChange);

	return {
		getSnapshot(): DatabaseStoreSnapshot {
			return snapshot;
		},

		subscribe(listener: () => void): () => void {
			if (disposed) {
				return () => undefined;
			}
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},

		selectTable(tableId: string): TableSelectionResult {
			if (disposed || session.getState() === 'disposed') {
				return { ok: false, code: 'disposed', message: 'This store is closed.' };
			}
			if (!hasTable(session.getDocument(), tableId)) {
				return {
					ok: false,
					code: 'no-such-table',
					message: 'That table no longer exists.',
				};
			}
			if (activeTableId === tableId) {
				return { ok: true, changed: false };
			}
			activeTableId = tableId;
			publish();
			return { ok: true, changed: true };
		},

		dispatch(
			operation: DatabaseOperation | readonly DatabaseOperation[],
			label?: string,
		): DispatchResult {
			if (disposed) {
				return refusal('disposed', 'This store is closed.');
			}
			return session.dispatch(operation, label);
		},

		undo(): HistoryResult {
			if (disposed) {
				return refusal('disposed', 'This store is closed.');
			}
			return session.undo();
		},

		redo(): HistoryResult {
			if (disposed) {
				return refusal('disposed', 'This store is closed.');
			}
			return session.redo();
		},

		flush(): Promise<FlushResult> {
			if (disposed) {
				return Promise.resolve({ ok: false, kind: 'disposed' });
			}
			return queue.flushNow();
		},

		dispose(): void {
			if (disposed) {
				return;
			}
			disposed = true;
			unsubscribeSession();
			listeners.clear();
		},
	};
}
