/**
 * The database session — one open `.tablify` file, one validated model, one revision, one history,
 * and one writer shared by every pane that opens the path.
 *
 * ADR-0012 makes this session the canonical database store: operations apply to its document, and its
 * single id-addressed history survives table navigation without storing document snapshots. The
 * write queue subscribes to accepted dirty transitions, so dispatch, undo, and redo all use the same
 * ADR-0005 revision-checked writer.
 *
 * ADR-0005 is the contract this module implements: every save states the revision it was computed
 * from, the session re-reads the file before writing, an unchanged file is written, and a changed
 * file produces a `conflict` *value* — never a silent overwrite, in either direction. A conflict is
 * resolved by an explicit choice (`reload()` adopts the disk; `keepAsCopy()` detaches the in-memory
 * document so it can be saved elsewhere), exactly as the ADR spells out.
 *
 * What this file is careful about:
 *
 *   - **It never parses on read-back.** The model is built once by R1's `parseAndMigrate` and then
 *     mutated only through the operation algebra (`applyOperations`); subscribers get the same object
 *     until it genuinely changes.
 *   - **It knows its own writes.** A vault event for this path is compared against the revision the
 *     session just wrote; our own write is not an "external change".
 *   - **It is host-free.** The port is `FilePort`; nothing here imports Obsidian, the DOM or React.
 *     The real adapter is `vaultPort.ts`, the tests use `tests/fakes/tablifyFile.ts`.
 *   - **It closes its ownership on `dispose()`** — the port subscription, history and listeners are
 *     released; the queue awaits or declines pending work before it disposes the shared session.
 */
import { applyOperations, parseAndMigrate, serializeDocument } from '../../core/database/index';
import type {
	DatabaseDocument,
	DatabaseOperation,
	LoadError,
	OperationRefusalCode,
} from '../../core/database/index';
import {
	clearDatabaseHistory,
	createDatabaseHistory,
	planDatabaseRedo,
	planDatabaseUndo,
	pushDatabaseHistory,
	summarizeDatabaseHistory,
} from '../../core/database/history';
import type {
	DatabaseHistoryPlan,
	DatabaseHistoryState,
	DatabaseHistorySummary,
} from '../../core/database/history';
import type { FilePort, FilePortEvent } from './port';
import { detectRevision } from './revision';

/** Where a session stands. `conflicted` and `detached` are the two states a save must not pass. */
export type SessionState = 'clean' | 'external' | 'dirty' | 'conflicted' | 'detached' | 'disposed';

/** What a subscriber is told. Every change carries the state the session is in *after* it. */
export type SessionChange =
	| { readonly kind: 'document'; readonly state: SessionState }
	| { readonly kind: 'external-change'; readonly revision: string; readonly state: SessionState }
	| { readonly kind: 'conflict'; readonly expected: string; readonly found: string }
	| { readonly kind: 'saved'; readonly revision: string }
	| { readonly kind: 'write-failed'; readonly message: string }
	| { readonly kind: 'deleted'; readonly state: SessionState }
	| { readonly kind: 'disposed' };

export type SessionListener = (change: SessionChange) => void;

/**
 * Why an operation was not applied. Session-level refusals (`conflicted`, `detached`, `disposed`)
 * sit beside the algebra's own, so a caller can branch on either without reading messages.
 */
export type DispatchRefusalCode =
	| OperationRefusalCode
	| 'conflicted'
	| 'detached'
	| 'disposed'
	| 'nothing-to-undo'
	| 'nothing-to-redo'
	| 'non-serializable-operation';

export type DispatchResult =
	| {
			readonly ok: true;
			readonly inverse: readonly DatabaseOperation[];
			readonly state: SessionState;
	  }
	| { readonly ok: false; readonly code: DispatchRefusalCode; readonly message: string };

/** A successful history action names its step and carries the exact inverse just applied. */
export type HistoryResult =
	| {
			readonly ok: true;
			readonly label: string;
			readonly inverse: readonly DatabaseOperation[];
			readonly state: SessionState;
	  }
	| { readonly ok: false; readonly code: DispatchRefusalCode; readonly message: string };

export type FlushResult =
	| { readonly ok: true; readonly wrote: boolean; readonly revision: string }
	| {
			readonly ok: false;
			readonly kind: 'conflict';
			readonly expected: string;
			readonly found: string;
			/** The disk text at the moment the conflict was detected, for the "keep as copy" path. */
			readonly diskText: string;
	  }
	| { readonly ok: false; readonly kind: 'write-failed'; readonly message: string }
	| { readonly ok: false; readonly kind: 'detached' }
	| { readonly ok: false; readonly kind: 'disposed' };

/** A document that could not be opened. The raw text is handed back, never dropped. */
export type OpenFailure =
	| { readonly kind: 'missing' }
	| { readonly kind: 'invalid'; readonly errors: readonly LoadError[] }
	| { readonly kind: 'unsupported-version'; readonly errors: readonly LoadError[] };

export type OpenResult =
	| { readonly ok: true; readonly session: DatabaseSession }
	| { readonly ok: false; readonly failure: OpenFailure; readonly rawText: string };

/** The session a caller holds. One per open database; the pane registry shares it (step 5). */
export interface DatabaseSession {
	readonly path: string;
	getDocument(): DatabaseDocument;
	getRevision(): string;
	getState(): SessionState;
	/** The one database-scoped history shared by every pane holding this session. */
	getHistorySummary(): DatabaseHistorySummary;
	subscribe(listener: SessionListener): () => void;
	/** Apply one operation, or one logical batch, and record at most one history step (R3 step 6). */
	dispatch(
		operation: DatabaseOperation | readonly DatabaseOperation[],
		label?: string,
	): DispatchResult;
	/** Undo/redo apply through the same validated operation algebra; a refusal preserves the stack. */
	undo(): HistoryResult;
	redo(): HistoryResult;
	flush(): Promise<FlushResult>;
	/** Adopt the file on disk, discarding in-memory edits. Called only on an explicit choice. */
	reload(): Promise<OpenResult>;
	/** Serialize the in-memory document and stop writing to this path (ADR-0005 choice b). */
	keepAsCopy(): { readonly text: string; readonly suggestedPath: string };
	/** Follow a rename: the path changes, the identity does not. */
	retarget(path: string): void;
	dispose(): void;
}

/** Classify a refusal so a view can say the right thing without inspecting error codes. */
function classify(errors: readonly LoadError[]): OpenFailure {
	if (errors.some((error) => error.code === 'unsupported-version')) {
		return { kind: 'unsupported-version', errors };
	}
	return { kind: 'invalid', errors };
}

class Session implements DatabaseSession {
	/** The file this session writes to. A rename retargets it; identity is untouched. */
	path: string;
	private readonly port: FilePort;
	private document: DatabaseDocument;
	private revision: string;
	private state: SessionState = 'clean';
	private readonly listeners = new Set<SessionListener>();
	private unsubscribePort: () => void;
	private conflicted: { expected: string; found: string; diskText: string } | null = null;
	private writing = false;
	private lastWriteRevision: string | null = null;
	/** Bumped by every accepted document transition; a write detects edits that outran its bytes. */
	private documentVersion = 0;
	/** One database-scoped stack, shared by every pane using this session. */
	private history: DatabaseHistoryState = createDatabaseHistory();
	private inFlight: Promise<FlushResult> | null = null;
	private disposed = false;

	constructor(port: FilePort, path: string, document: DatabaseDocument, revision: string) {
		this.port = port;
		this.path = path;
		this.document = document;
		this.revision = revision;
		this.unsubscribePort = port.subscribe((event) => {
			this.onPortEvent(event);
		});
	}

	getDocument(): DatabaseDocument {
		return this.document;
	}
	getRevision(): string {
		return this.revision;
	}
	getState(): SessionState {
		return this.state;
	}
	getHistorySummary(): DatabaseHistorySummary {
		return summarizeDatabaseHistory(this.history);
	}
	subscribe(listener: SessionListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	retarget(path: string): void {
		this.path = path;
	}
	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.state = 'disposed';
		this.history = clearDatabaseHistory(this.history);
		this.unsubscribePort();
		this.emit({ kind: 'disposed' });
		this.listeners.clear();
	}

	dispatch(
		operation: DatabaseOperation | readonly DatabaseOperation[],
		label = 'Edit database',
	): DispatchResult {
		const refused = this.mutationRefusal();
		if (refused !== null) {
			return refused;
		}
		const batch = Array.isArray(operation) ? operation : [operation];
		if (batch.length === 0) {
			return { ok: true, inverse: [], state: this.state };
		}
		const result = applyOperations(this.document, batch);
		if (!result.ok) {
			return { ok: false, code: result.code, message: result.message };
		}
		let nextHistory: DatabaseHistoryState;
		try {
			nextHistory = pushDatabaseHistory(this.history, {
				label,
				operations: batch,
				inverse: result.inverses,
			});
		} catch (error) {
			return {
				ok: false,
				code: 'non-serializable-operation',
				message: messageOf(error),
			};
		}
		this.document = result.document;
		this.history = nextHistory;
		this.documentVersion += 1;
		this.state = 'dirty';
		this.emit({ kind: 'document', state: this.state });
		return { ok: true, inverse: result.inverses, state: this.state };
	}

	undo(): HistoryResult {
		return this.applyHistoryPlan(planDatabaseUndo(this.history), 'undo');
	}

	redo(): HistoryResult {
		return this.applyHistoryPlan(planDatabaseRedo(this.history), 'redo');
	}

	private mutationRefusal(): {
		readonly ok: false;
		readonly code: DispatchRefusalCode;
		readonly message: string;
	} | null {
		switch (this.state) {
			case 'disposed':
				return { ok: false, code: 'disposed', message: 'This session is closed.' };
			case 'detached':
				return {
					ok: false,
					code: 'detached',
					message: 'This document was kept as a copy; it no longer writes to its file.',
				};
			case 'conflicted':
				return {
					ok: false,
					code: 'conflicted',
					message:
						'The file changed on disk; reload or keep a copy before editing further.',
				};
			default:
				return null;
		}
	}

	private applyHistoryPlan(
		plan: DatabaseHistoryPlan | null,
		direction: 'undo' | 'redo',
	): HistoryResult {
		const refused = this.mutationRefusal();
		if (refused !== null) {
			return refused;
		}
		if (plan === null) {
			return direction === 'undo'
				? { ok: false, code: 'nothing-to-undo', message: 'There is nothing to undo.' }
				: { ok: false, code: 'nothing-to-redo', message: 'There is nothing to redo.' };
		}
		const result = applyOperations(this.document, plan.operations);
		if (!result.ok) {
			// Do not consume a step if its inverse/forward operations no longer resolve.
			return { ok: false, code: result.code, message: result.message };
		}
		this.document = result.document;
		this.history = plan.next;
		if (plan.operations.length > 0) {
			this.documentVersion += 1;
			this.state = 'dirty';
			this.emit({ kind: 'document', state: this.state });
		}
		return {
			ok: true,
			label: plan.label,
			inverse: result.inverses,
			state: this.state,
		};
	}

	flush(): Promise<FlushResult> {
		if (this.disposed) {
			return Promise.resolve({ ok: false, kind: 'disposed' });
		}
		if (this.state === 'detached') {
			return Promise.resolve({ ok: false, kind: 'detached' });
		}
		if (this.state === 'conflicted' && this.conflicted !== null) {
			const { expected, found, diskText } = this.conflicted;
			return Promise.resolve({ ok: false, kind: 'conflict', expected, found, diskText });
		}
		if (this.state !== 'dirty') {
			return Promise.resolve({ ok: true, wrote: false, revision: this.revision });
		}
		// One writer at a time: a second flush while one is in flight waits for it, then runs.
		this.inFlight ??= this.runFlush().finally(() => {
			this.inFlight = null;
		});
		return this.inFlight;
	}

	private async runFlush(): Promise<FlushResult> {
		let onDisk: string;
		try {
			onDisk = await this.port.read(this.path);
		} catch (error) {
			const message = messageOf(error);
			this.emit({ kind: 'write-failed', message });
			return { ok: false, kind: 'write-failed', message };
		}
		const found = detectRevision(onDisk);
		if (found !== this.revision) {
			this.conflicted = { expected: this.revision, found, diskText: onDisk };
			this.state = 'conflicted';
			this.emit({ kind: 'conflict', expected: this.revision, found });
			return {
				ok: false,
				kind: 'conflict',
				expected: this.revision,
				found,
				diskText: onDisk,
			};
		}
		const text = serializeDocument(this.document);
		const revision = detectRevision(text);
		const versionAtWrite = this.documentVersion;
		this.writing = true;
		try {
			await this.port.write(this.path, text);
		} catch (error) {
			const message = messageOf(error);
			this.emit({ kind: 'write-failed', message });
			return { ok: false, kind: 'write-failed', message };
		} finally {
			this.writing = false;
		}
		this.revision = revision;
		this.lastWriteRevision = revision;
		// Commands that landed while the bytes were in flight are still unsaved — unless the document
		// they produced serializes to exactly what was written, which is the same thing as saved.
		const converged =
			this.documentVersion === versionAtWrite ||
			detectRevision(serializeDocument(this.document)) === revision;
		this.state = converged ? 'clean' : 'dirty';
		this.emit({ kind: 'saved', revision });
		if (this.state === 'dirty') {
			this.emit({ kind: 'document', state: this.state });
		}
		return { ok: true, wrote: true, revision };
	}

	async reload(): Promise<OpenResult> {
		if (this.state === 'disposed') {
			return { ok: false, failure: { kind: 'missing' }, rawText: '' };
		}
		let text: string;
		try {
			text = await this.port.read(this.path);
		} catch {
			return { ok: false, failure: { kind: 'missing' }, rawText: '' };
		}
		const loaded = parseAndMigrate(text);
		if (!loaded.ok) {
			// The in-memory document is not replaced by something unreadable.
			return { ok: false, failure: classify(loaded.errors), rawText: text };
		}
		this.document = loaded.document;
		this.revision = detectRevision(text);
		this.conflicted = null;
		this.history = clearDatabaseHistory(this.history);
		this.documentVersion += 1;
		this.state = 'clean';
		this.emit({ kind: 'document', state: this.state });
		return { ok: true, session: this };
	}

	keepAsCopy(): { readonly text: string; readonly suggestedPath: string } {
		const text = serializeDocument(this.document);
		this.state = 'detached';
		this.conflicted = null;
		this.emit({ kind: 'document', state: this.state });
		const dot = this.path.lastIndexOf('.');
		const suggestedPath =
			dot === -1
				? `${this.path} (copy)`
				: `${this.path.slice(0, dot)} (copy)${this.path.slice(dot)}`;
		return { text, suggestedPath };
	}

	private emit(change: SessionChange): void {
		for (const listener of this.listeners) {
			listener(change);
		}
	}

	private onPortEvent(event: FilePortEvent): void {
		if (this.disposed) {
			return;
		}
		if (event.kind === 'renamed' && event.previousPath === this.path) {
			this.retarget(event.path);
			this.emit({ kind: 'external-change', revision: this.revision, state: this.state });
			return;
		}
		if (event.path !== this.path) {
			return;
		}
		if (event.kind === 'deleted') {
			this.emit({ kind: 'deleted', state: this.state });
			return;
		}
		if (event.kind !== 'changed' && event.kind !== 'created') {
			return;
		}
		// Our own write, observed from the inside: the flush records the revision it wrote.
		if (this.writing) {
			return;
		}
		void this.port
			.read(this.path)
			.then((text) => {
				if (this.disposed) {
					return;
				}
				const revision = detectRevision(text);
				if (
					revision === this.lastWriteRevision ||
					revision === this.revision ||
					this.state === 'conflicted' ||
					this.state === 'detached'
				) {
					return;
				}
				if (this.state === 'dirty') {
					this.conflicted = { expected: this.revision, found: revision, diskText: text };
					this.state = 'conflicted';
					this.emit({ kind: 'conflict', expected: this.revision, found: revision });
					return;
				}
				this.state = 'external';
				this.emit({ kind: 'external-change', revision, state: this.state });
			})
			.catch(() => {
				this.emit({ kind: 'external-change', revision: '', state: this.state });
			});
	}
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Open a `.tablify` file: read it, parse and migrate it (R1), and hand back a session — or a typed
 * failure with the raw text, so the view can show a read-only panel instead of a blank grid.
 */
export async function openDatabase(port: FilePort, path: string): Promise<OpenResult> {
	let text: string;
	try {
		text = await port.read(path);
	} catch {
		return { ok: false, failure: { kind: 'missing' }, rawText: '' };
	}
	const loaded = parseAndMigrate(text);
	if (!loaded.ok) {
		return { ok: false, failure: classify(loaded.errors), rawText: text };
	}
	const session = new Session(port, path, loaded.document, detectRevision(text));
	return { ok: true, session };
}
