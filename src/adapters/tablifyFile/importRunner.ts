/**
 * Transactional apply for a native database import plan.
 *
 * The planner owns every conversion and operation. This runner never reads the source again or derives a second
 * plan: it verifies the document revision, dispatches the exact operation list as one session history entry, and
 * flushes the shared database queue once. There is no chunking, so cancellation is accepted only before dispatch;
 * after that point the result is all applied or not applied, never a misleading partial count.
 */
import { serializeDocument } from '../../core/database';
import type { DatabaseImportPlan } from '../../core/database';
import type { DatabaseStore } from './databaseStore';
import type { FlushResult } from './session';

export type DatabaseImportRunPhase = 'checking' | 'ready-to-apply' | 'saving' | 'saved';

/** Observable state for a native progress surface. Counts are records, not guessed chunks. */
export interface DatabaseImportRunProgress {
	readonly phase: DatabaseImportRunPhase;
	readonly recordsApplied: number;
	readonly totalRecords: number;
	readonly operationCount: number;
}

export interface DatabaseImportRunnerOptions {
	/** Abort is honored only before the one atomic dispatch. Once dispatched, the result is awaited and reported. */
	readonly signal?: AbortSignal;
	/** A progress observer. Observer errors are ignored so they cannot interrupt a database transaction. */
	readonly onProgress?: (progress: DatabaseImportRunProgress) => void;
	/** Yield before the commit point so a UI can paint its busy state and honor cancellation before any writes. */
	readonly yieldTo?: () => Promise<void>;
	/** One history label for the entire import. */
	readonly historyLabel?: string;
}

export type DatabaseImportApplyResult =
	| {
			readonly kind: 'cancelled';
			readonly committedRecords: 0;
			readonly message: string;
	  }
	| {
			readonly kind: 'stale-plan';
			readonly committedRecords: 0;
			readonly message: string;
	  }
	| {
			readonly kind: 'refused';
			readonly committedRecords: 0;
			readonly code: string;
			readonly message: string;
	  }
	| {
			readonly kind: 'no-op';
			readonly committedRecords: 0;
			readonly operationCount: 0;
	  }
	| {
			readonly kind: 'applied-unsaved';
			/** Accepted in the in-memory session as one undoable transaction. */
			readonly appliedRecords: number;
			/** Zero means the repository has not acknowledged the document write. */
			readonly committedRecords: 0;
			readonly operationCount: number;
			readonly failure: ImportSaveFailure;
	  }
	| {
			readonly kind: 'saved';
			readonly appliedRecords: number;
			readonly committedRecords: number;
			readonly operationCount: number;
			readonly wrote: boolean;
			readonly revision: string;
	  };

export type ImportSaveFailure =
	| { readonly kind: 'conflict'; readonly expected: string; readonly found: string }
	| { readonly kind: 'write-failed'; readonly message: string }
	| { readonly kind: 'detached' }
	| { readonly kind: 'disposed' };

function taskYield(): Promise<void> {
	if (typeof window === 'undefined') {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		window.setTimeout(resolve, 0);
	});
}

function notify(
	observer: DatabaseImportRunnerOptions['onProgress'],
	progress: DatabaseImportRunProgress,
): void {
	try {
		observer?.(progress);
	} catch {
		// Observability must never change whether the single database transaction is applied or saved.
	}
}

function cancellationRequested(signal: AbortSignal | undefined): boolean {
	return signal?.aborted === true;
}

function saveFailure(result: Exclude<FlushResult, { readonly ok: true }>): ImportSaveFailure {
	switch (result.kind) {
		case 'conflict':
			return { kind: 'conflict', expected: result.expected, found: result.found };
		case 'write-failed':
			return { kind: 'write-failed', message: result.message };
		case 'detached':
			return { kind: 'detached' };
		case 'disposed':
			return { kind: 'disposed' };
	}
}

function staleReason(store: DatabaseStore, plan: DatabaseImportPlan): string | undefined {
	const snapshot = store.getSnapshot();
	if (snapshot.sessionState === 'external') {
		return 'The file changed on disk. Reload it and review the import plan again before applying.';
	}
	if (snapshot.sessionState === 'conflicted') {
		return 'The database is conflicted. Resolve the conflict and review the import plan again before applying.';
	}
	if (snapshot.sessionState === 'detached' || snapshot.sessionState === 'disposed') {
		return 'This database session is no longer writable.';
	}
	if (snapshot.document.databaseId !== plan.databaseId) {
		return 'The plan belongs to a different database. Build a fresh import plan.';
	}
	try {
		if (serializeDocument(snapshot.document) !== plan.baseDocumentJson) {
			return 'The database changed after this plan was built. Review a fresh import preview before applying.';
		}
	} catch {
		return 'The current database could not be safely compared with this import plan.';
	}
	return undefined;
}

/**
 * Apply the plan's exact native operations as one history entry and request one immediate repository flush.
 *
 * A stale or externally changed document is refused before dispatch. The session applies the whole operation
 * list atomically; its operation algebra leaves the input unchanged on refusal. Cancellation is checked before
 * that commit point and therefore reports zero committed records. Once dispatch succeeds, cancellation is no
 * longer accepted: the runner waits for the repository result and distinguishes an applied-but-unsaved document
 * from a saved one.
 */
export async function applyDatabaseImportPlan(
	store: DatabaseStore,
	plan: DatabaseImportPlan,
	options: DatabaseImportRunnerOptions = {},
): Promise<DatabaseImportApplyResult> {
	const totalRecords = plan.metrics.rowsCreated + plan.metrics.rowsUpdated;
	const operationCount = plan.operations.length;
	const emit = (phase: DatabaseImportRunPhase, recordsApplied = 0): void => {
		notify(options.onProgress, {
			phase,
			recordsApplied,
			totalRecords,
			operationCount,
		});
	};

	emit('checking');
	if (cancellationRequested(options.signal)) {
		return {
			kind: 'cancelled',
			committedRecords: 0,
			message: 'Import cancelled before any database operations were applied.',
		};
	}
	let stale = staleReason(store, plan);
	if (stale !== undefined) {
		return { kind: 'stale-plan', committedRecords: 0, message: stale };
	}
	if (operationCount === 0) {
		return { kind: 'no-op', committedRecords: 0, operationCount: 0 };
	}

	emit('ready-to-apply');
	await (options.yieldTo ?? taskYield)();
	if (cancellationRequested(options.signal)) {
		return {
			kind: 'cancelled',
			committedRecords: 0,
			message: 'Import cancelled before any database operations were applied.',
		};
	}
	stale = staleReason(store, plan);
	if (stale !== undefined) {
		return { kind: 'stale-plan', committedRecords: 0, message: stale };
	}

	const dispatched = store.dispatch(
		plan.operations,
		options.historyLabel ?? `Import ${plan.source.sourceName}`,
	);
	if (!dispatched.ok) {
		return {
			kind: 'refused',
			committedRecords: 0,
			code: dispatched.code,
			message: dispatched.message,
		};
	}

	emit('saving', totalRecords);
	let flushed: FlushResult;
	try {
		flushed = await store.flush();
	} catch (error) {
		return {
			kind: 'applied-unsaved',
			appliedRecords: totalRecords,
			committedRecords: 0,
			operationCount,
			failure: {
				kind: 'write-failed',
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
	if (!flushed.ok) {
		return {
			kind: 'applied-unsaved',
			appliedRecords: totalRecords,
			committedRecords: 0,
			operationCount,
			failure: saveFailure(flushed),
		};
	}

	emit('saved', totalRecords);
	return {
		kind: 'saved',
		appliedRecords: totalRecords,
		committedRecords: totalRecords,
		operationCount,
		wrote: flushed.wrote,
		revision: flushed.revision,
	};
}
