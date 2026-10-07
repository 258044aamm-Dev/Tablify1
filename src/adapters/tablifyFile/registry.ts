/**
 * The pane registry — R2 step 5. One open file, one session, one writer, however many panes.
 *
 * Obsidian can show the same file in two leaves (split, popout, or a restored workspace). Two
 * independent stores for one file is the clobber the refactor exists to remove, so this module
 * makes the sharing structural: a caller asks for a **path** and gets a handle to the one session
 * that path has. Opening the same path twice returns the same session and the same write queue;
 * a second `open()` that arrives while the first is still reading waits for it instead of starting
 * a second read.
 *
 * Refcounted lifetime, because panes close one at a time:
 *
 *   - every successful `open()` adds a reference; `release()` is idempotent per handle;
 *   - the session is closed (flush first, by default) and disposed when the **last** handle is
 *     released — the pane that closes last is the one that saves;
 *   - a rename re-keys the registry, so the pane that reopens the new path still lands on the same
 *     session (the session itself follows the rename; this map only keeps the address current).
 *
 * `create()` is the other half of step 6's "create a new `.tablify` file, then open it": it refuses
 * to overwrite anything, writes a valid minimum document (`createEmptyDocument`, zero warnings), and
 * then goes through the same `open()` path so a created file is never a special case.
 *
 * The registry is host-free: it talks to the `FilePort`, so the unit tests drive it with the fake
 * port and the fake clock, and the Obsidian `Vault` adapter plugs in unchanged.
 */
import type { IdKind } from '../../core/database/index';
import { createEmptyDocument, createIdFactory, serializeDocument } from '../../core/database/index';
import type { FilePort } from './port';
import { createWriteQueue } from './queue';
import type { CloseResult, QueueScheduler, WriteQueue } from './queue';
import { openDatabase } from './session';
import type { DatabaseSession, OpenFailure } from './session';

/** Why a registry open or create did not produce a handle. */
export type RegistryFailure =
	| OpenFailure
	| { readonly kind: 'exists'; readonly path: string }
	| { readonly kind: 'create-failed'; readonly message: string }
	| { readonly kind: 'disposed' };

export type RegistryResult =
	| { readonly ok: true; readonly handle: DatabaseHandle }
	| { readonly ok: false; readonly failure: RegistryFailure; readonly rawText: string };

/** What a pane holds while it shows a document. Release it once, when the pane is closed. */
export interface DatabaseHandle {
	readonly session: DatabaseSession;
	readonly queue: WriteQueue;
	release(options?: { readonly flush?: boolean }): Promise<CloseResult>;
}

export interface SessionRegistryOptions {
	/** The document write queue's debounce window. */
	readonly debounceMs?: number;
	/** Injected timer, so tests use the fake clock. The plugin passes nothing. */
	readonly scheduler?: QueueScheduler;
	/** Injected id source for `create()`. The default uses `crypto.getRandomValues`. */
	readonly ids?: (kind: IdKind) => string;
}

export interface SessionRegistry {
	/** The one handle for this path's session, opening it on first use. */
	open(path: string): Promise<RegistryResult>;
	/** Write a new, valid database at a path that must not exist yet, then open it. */
	create(path: string, name: string): Promise<RegistryResult>;
	/** How many paths have a live session — 0 after the last release. */
	openCount(): number;
	/** The open paths, in first-open order. Diagnostics and tests. */
	openPaths(): readonly string[];
	/** Close and dispose everything. Called from the plugin's `onunload`. */
	disposeAll(): Promise<void>;
}

interface Slot {
	refs: number;
	/** Set when the last handle was released before the read finished: dispose when it lands. */
	abandoned: boolean;
	session: DatabaseSession | null;
	queue: WriteQueue | null;
	failure: RegistryFailure | null;
	rawText: string;
	reading: Promise<void> | null;
}

function newSlot(): Slot {
	return {
		refs: 0,
		abandoned: false,
		session: null,
		queue: null,
		failure: null,
		rawText: '',
		reading: null,
	};
}

/**
 * The crypto-backed default id source, read off `window` (the window the plugin runs in). Tests
 * always inject `ids`; this path is only taken inside Obsidian, where `window.crypto` is present,
 * and a host without it gets a refusal it can act on rather than a silently weak id.
 */
function defaultIds(): (kind: IdKind) => string {
	const host = typeof window === 'undefined' ? null : window.crypto;
	const factory = createIdFactory({
		randomValues(length: number): Uint8Array {
			if (host === null) {
				throw new Error(
					'this host has no window.crypto; pass `ids` when creating the registry',
				);
			}
			const bytes = new Uint8Array(length);
			host.getRandomValues(bytes);
			return bytes;
		},
	});
	return factory;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createSessionRegistry(
	port: FilePort,
	options: SessionRegistryOptions = {},
): SessionRegistry {
	const ids = options.ids ?? defaultIds();
	const slots = new Map<string, Slot>();
	let stopped = false;

	/** Follow renames so a pane that reopens the new path lands on the session that already exists. */
	const unsubscribe = port.subscribe((event) => {
		if (event.kind !== 'renamed') {
			return;
		}
		const slot = slots.get(event.previousPath);
		if (slot === undefined) {
			return;
		}
		slots.delete(event.previousPath);
		slots.set(event.path, slot);
	});

	const read = (slot: Slot, path: string): Promise<void> => {
		slot.reading ??= (async () => {
			const opened = await openDatabase(port, path);
			if (!opened.ok) {
				slot.failure = opened.failure;
				slot.rawText = opened.rawText;
				return;
			}
			if (slot.abandoned) {
				// Nobody is holding it any more; do not leave a subscriber behind.
				opened.session.dispose();
				return;
			}
			slot.session = opened.session;
			slot.queue = createWriteQueue(opened.session, {
				...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
				...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
			});
		})();
		return slot.reading;
	};

	const handleFor = (
		slot: Slot,
		path: string,
		session: DatabaseSession,
		queue: WriteQueue,
	): DatabaseHandle => {
		let released = false;
		return {
			session,
			queue,
			async release(releaseOptions: { readonly flush?: boolean } = {}): Promise<CloseResult> {
				if (released) {
					return { ok: true, wrote: false };
				}
				released = true;
				slot.refs -= 1;
				if (slot.refs > 0) {
					return { ok: true, wrote: false };
				}
				slots.delete(path);
				const closed = await queue.close(releaseOptions);
				return closed;
			},
		};
	};

	const opened = (slot: Slot, path: string): RegistryResult => {
		const { session, queue } = slot;
		if (session === null || queue === null) {
			// Unreachable while `reading` resolved without a failure; refused rather than assumed.
			return { ok: false, failure: { kind: 'disposed' }, rawText: '' };
		}
		return { ok: true, handle: handleFor(slot, path, session, queue) };
	};

	const open = async (path: string): Promise<RegistryResult> => {
		if (stopped) {
			return { ok: false, failure: { kind: 'disposed' }, rawText: '' };
		}
		let slot = slots.get(path);
		if (slot === undefined) {
			slot = newSlot();
			slots.set(path, slot);
		}
		slot.refs += 1;
		await read(slot, path);
		if (slot.failure !== null) {
			// A failed read is not cached: fix the file, ask again, and the next attempt re-reads.
			slot.refs -= 1;
			if (slot.refs === 0) {
				slots.delete(path);
			}
			return { ok: false, failure: slot.failure, rawText: slot.rawText };
		}
		return opened(slot, path);
	};

	return {
		open,
		async create(path: string, name: string): Promise<RegistryResult> {
			if (stopped) {
				return { ok: false, failure: { kind: 'disposed' }, rawText: '' };
			}
			if (slots.has(path) || (await port.exists(path))) {
				return { ok: false, failure: { kind: 'exists', path }, rawText: '' };
			}
			const document = createEmptyDocument({ name, ids });
			try {
				await port.create(path, serializeDocument(document));
			} catch (error) {
				return {
					ok: false,
					failure: { kind: 'create-failed', message: messageOf(error) },
					rawText: '',
				};
			}
			return open(path);
		},
		openCount(): number {
			return slots.size;
		},
		openPaths(): readonly string[] {
			return [...slots.keys()];
		},
		async disposeAll(): Promise<void> {
			stopped = true;
			unsubscribe();
			const closing = [...slots.entries()].map(async ([path, slot]) => {
				slots.delete(path);
				if (slot.session !== null && slot.queue !== null) {
					await slot.queue.close();
				} else {
					slot.abandoned = true;
				}
			});
			await Promise.all(closing);
		},
	};
}
