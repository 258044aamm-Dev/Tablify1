/**
 * The database session — one open `.tablify` file, one validated model, one revision, one writer.
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
 *     mutated only through `applyCommand`; subscribers get the same object until it genuinely changes.
 *   - **It knows its own writes.** A vault event for this path is compared against the revision the
 *     session just wrote; our own write is not an "external change".
 *   - **It is host-free.** The port is `FilePort`; nothing here imports Obsidian, the DOM or React.
 *     The real adapter is `vaultPort.ts`, the tests use `tests/fakes/tablifyFile.ts`.
 *   - **It drops everything on `dispose()`** — the port subscription, the listeners, the in-flight
 *     flush — so closing a pane cannot leave a writer behind.
 */
import { applyCommand, parseAndMigrate, serializeDocument } from '../../core/database/index';
import type {
	CommandRefusalCode,
	DatabaseDocument,
	DocumentCommand,
	LoadError,
} from '../../core/database/index';
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
	| { readonly kind: 'deleted'; readonly state: SessionState }
	| { readonly kind: 'disposed' };

export type SessionListener = (change: SessionChange) => void;

/** Why a command was not applied. Session-level refusals are separate from the command algebra's. */
export type DispatchRefusalCode = CommandRefusalCode | 'conflicted' | 'detached' | 'disposed';

export type DispatchResult =
	| { readonly ok: true; readonly inverse: DocumentCommand; readonly state: SessionState }
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
	subscribe(listener: SessionListener): () => void;
	dispatch(command: DocumentCommand): DispatchResult;
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
	/** Bumped by every applied command; a write compares it to know if edits outran the bytes. */
	private documentVersion = 0;
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
		this.unsubscribePort();
		this.emit({ kind: 'disposed' });
		this.listeners.clear();
	}

	dispatch(command: DocumentCommand): DispatchResult {
		if (this.state === 'disposed') {
			return { ok: false, code: 'disposed', message: 'This session is closed.' };
		}
		if (this.state === 'detached') {
			return {
				ok: false,
				code: 'detached',
				message: 'This document was kept as a copy; it no longer writes to its file.',
			};
		}
		if (this.state === 'conflicted') {
			return {
				ok: false,
				code: 'conflicted',
				message: 'The file changed on disk; reload or keep a copy before editing further.',
			};
		}
		const result = applyCommand(this.document, command);
		if (!result.ok) {
			return { ok: false, code: result.code, message: result.message };
		}
		this.document = result.document;
		this.documentVersion += 1;
		this.state = 'dirty';
		this.emit({ kind: 'document', state: this.state });
		return { ok: true, inverse: result.inverse, state: this.state };
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
			return { ok: false, kind: 'write-failed', message: messageOf(error) };
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
			return { ok: false, kind: 'write-failed', message: messageOf(error) };
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
