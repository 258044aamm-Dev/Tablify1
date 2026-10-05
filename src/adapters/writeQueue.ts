/**
 * The write queue: the layer that makes editing a note-backed grid safe.
 *
 * `docs/02-architecture.md` §write queue is the specification, and every rule in it is implemented here:
 *
 * ```
 * writeQueue.enqueue(writes)
 *    ├─ coalesce per (file, property): last write wins within a tick
 *    ├─ batch by file: one processFrontMatter call per file per flush
 *    ├─ serialize per file: a promise chain keyed by path (never two writers per file)
 *    ├─ debounce 250 ms, hard flush on blur / view close / undo / import
 *    └─ on failure: drop the overlay for those ops, report (file, reason), keep UI truthful
 * ```
 *
 * Two constants the docs do **not** name, so they are decided here, stated, and recorded in PROGRESS.md:
 *
 * - `CONCURRENCY = 4` — the doc says files "may proceed in parallel, bounded by a documented concurrency
 *   limit" without giving the number. Four in-flight notes is chosen because each call is one note write and
 *   the vault's own writer is the bottleneck; more parallelism buys nothing and makes failure reporting
 *   harder to read.
 * - **No retry.** The retry/backoff the docs describe belongs to the remote-sync client (`docs/02`
 *   §sync), not to note writes. A failed note write is reported to the caller and its optimistic overlay
 *   value is dropped, so the grid shows what the file actually contains instead of pretending the write
 *   landed.
 * The queue is dependency-injected (`{ processFrontMatter }`) so it can be tested against the fake vault with
 * the fake clock and no Obsidian at all. It never calls `vault.modify`: a property change is always a
 * `processFrontMatter` callback that mutates the object it is handed, which is what preserves unknown keys.
 */
import type { CellValue, PropertyId } from '../core/types';
import type { ApplyError, RowId } from './RowSource';

/** One value to write. `null` means "remove this key"; see the note on clearing below. */
export type QueueWrite = {
	readonly filePath: RowId;
	readonly propertyId: PropertyId;
	readonly value: CellValue;
};

/** The injected write path: the only one this project is allowed to use. */
export type FrontmatterWriter = {
	processFrontMatter(
		path: string,
		mutate: (frontmatter: Record<string, unknown>) => void,
	): Promise<void>;
};

/** The two timing primitives the queue needs, so tests inject the fake clock. */
export type TimerPort = {
	setTimer(callback: () => void, ms: number): number;
	clearTimer(id: number): void;
};

/** Hooks the caller (the `RowSource`) uses to keep the optimistic overlay truthful. */
export type QueueHooks = {
	/** Every write of a batch landed. */
	onWritten?(writes: readonly QueueWrite[]): void;
	/** The batch failed: these writes must leave the overlay. */
	onFailed?(writes: readonly QueueWrite[], error: ApplyError): void;
};

export type WriteQueueOptions = {
	readonly writer: FrontmatterWriter;
	/** Defaults to the real timers; tests pass `tests/fakes/clock.ts`. */
	readonly timers?: TimerPort;
	/** Milliseconds before the first call for a file. The doc's value: 250. */
	readonly debounceMs?: number;
	/** How many files may be in flight at once. See the header: the docs name no number. */
	readonly concurrency?: number;
	readonly hooks?: QueueHooks;
};

/** What a flush produced. */
export type FlushResult = {
	readonly ok: boolean;
	/** Cells written since the last flush (a cell written twice in one batch counts once). */
	readonly written: number;
	/** Files the flush touched, in a stable order. */
	readonly files: readonly RowId[];
	readonly errors: readonly ApplyError[];
};

export type WriteQueue = {
	/** Queues writes. Coalesces per (file, property) and starts each file's debounce clock once. */
	enqueue(writes: readonly QueueWrite[]): void;
	/** Runs everything now, bypassing the debounce. Safe to call twice; resolves when the disk is current. */
	flush(): Promise<FlushResult>;
	/** Writes waiting for their debounce, plus files in flight. Zero means "on disk". */
	pending(): number;
	/** Drops every queued write without writing it. Used when a view closes mid-typing. */
	dispose(): void;
};

/** The doc's debounce, in milliseconds. */
export const DEBOUNCE_MS = 250;

/** The concurrency limit; see the header for why four. */
export const CONCURRENCY = 4;

/** Real timers by default. `setTimeout`/`clearTimeout` are DOM globals, and typed as numbers. */
const DEFAULT_TIMERS: TimerPort = {
	setTimer: (callback, ms) => window.setTimeout(callback, ms),
	clearTimer: (id) => {
		window.clearTimeout(id);
	},
};

/** Per-file state: what is waiting, the debounce timer, and the chain that serialises this file. */
type FileState = {
	pending: Map<PropertyId, QueueWrite>;
	timer: number | null;
	chain: Promise<void>;
};

/**
 * The callback the writer receives. Values are YAML scalars by the time they arrive — the caller applied the
 * column's `toYaml`. `null` **deletes** the key rather than writing `null` or `""` (`docs/03` §write rules 3,
 * "clearing deletes the key"), and every other key of the object is left exactly as it was found.
 */
function mutateWith(writes: readonly QueueWrite[]) {
	return (frontmatter: Record<string, unknown>): void => {
		for (const write of writes) {
			if (write.value === null) {
				delete frontmatter[write.propertyId];
			} else {
				frontmatter[write.propertyId] = write.value;
			}
		}
	};
}

/** The queue. One instance per view: its per-file chains are view-scoped. */
export function createWriteQueue(options: WriteQueueOptions): WriteQueue {
	const timers = options.timers ?? DEFAULT_TIMERS;
	const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
	const limit = Math.max(1, options.concurrency ?? CONCURRENCY);
	const files = new Map<RowId, FileState>();

	/** Files started but not finished. `flush` waits for this to reach zero. */
	let outstanding = 0;
	/** Cells written since the last flush drained the counter. */
	let writtenSince = 0;
	/** Failures since the last flush drained the list. */
	let failures: ApplyError[] = [];
	/** Everyone waiting for the queue to go idle. */
	let idleWaiters: (() => void)[] = [];
	/** Files touched since the last flush, for the report. */
	const touchedSince = new Set<RowId>();
	/** The concurrency gate. */
	let active = 0;
	const gate: (() => void)[] = [];
	let disposed = false;

	const stateFor = (path: RowId): FileState => {
		const existing = files.get(path);
		if (existing !== undefined) {
			return existing;
		}
		const fresh: FileState = { pending: new Map(), timer: null, chain: Promise.resolve() };
		files.set(path, fresh);
		return fresh;
	};

	const queued = (): number => {
		let count = 0;
		for (const state of files.values()) {
			count += state.pending.size;
		}
		return count;
	};

	const releaseIdle = (): void => {
		if (outstanding === 0 && queued() === 0) {
			for (const resolve of idleWaiters.splice(0, idleWaiters.length)) {
				resolve();
			}
		}
	};

	const acquire = async (): Promise<void> => {
		if (active < limit) {
			active += 1;
			return;
		}
		await new Promise<void>((resolve) => {
			gate.push(resolve);
		});
	};

	const release = (): void => {
		active -= 1;
		const next = gate.shift();
		if (next !== undefined) {
			active += 1;
			next();
		}
	};

	/** Starts one file's batch: one `processFrontMatter` call carrying every pending property. */
	const startFile = (path: RowId, state: FileState): void => {
		if (state.timer !== null) {
			timers.clearTimer(state.timer);
			state.timer = null;
		}
		const writes = [...state.pending.values()];
		state.pending.clear();
		if (writes.length === 0) {
			return;
		}
		outstanding += 1;
		state.chain = state.chain.then(async () => {
			await acquire();
			try {
				await options.writer.processFrontMatter(path, mutateWith(writes));
				options.hooks?.onWritten?.(writes);
				writtenSince += writes.length;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const failure: ApplyError = { path, message, cause: error };
				failures.push(failure);
				options.hooks?.onFailed?.(writes, failure);
			} finally {
				release();
				outstanding -= 1;
				releaseIdle();
			}
		});
	};

	return {
		enqueue(writes: readonly QueueWrite[]): void {
			if (disposed || writes.length === 0) {
				return;
			}
			const touched = new Set<RowId>();
			for (const write of writes) {
				touchedSince.add(write.filePath);
				// Coalescing: same file + same property in one tick keeps only the last value.
				stateFor(write.filePath).pending.set(write.propertyId, write);
				touched.add(write.filePath);
			}
			for (const path of touched) {
				const state = stateFor(path);
				if (state.timer === null) {
					state.timer = timers.setTimer(() => {
						state.timer = null;
						startFile(path, state);
					}, debounceMs);
				}
			}
		},

		async flush(): Promise<FlushResult> {
			// Bypass every debounce, in a stable order so a test can read the write log deterministically.
			for (const path of [...files.keys()].sort()) {
				startFile(path, stateFor(path));
			}
			while (outstanding > 0 || queued() > 0) {
				await new Promise<void>((resolve) => {
					idleWaiters.push(resolve);
				});
			}
			// Drained, not sliced: a second flush reports only what happened after the first one.
			const errors = failures.splice(0, failures.length);
			const written = writtenSince;
			writtenSince = 0;
			const touched = [...touchedSince].sort();
			touchedSince.clear();
			return { ok: errors.length === 0, written, files: touched, errors };
		},

		pending(): number {
			return queued() + outstanding;
		},

		dispose(): void {
			disposed = true;
			for (const state of files.values()) {
				if (state.timer !== null) {
					timers.clearTimer(state.timer);
					state.timer = null;
				}
				state.pending.clear();
			}
			files.clear();
			releaseIdle();
		},
	};
}
