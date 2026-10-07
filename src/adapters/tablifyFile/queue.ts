/**
 * The document write queue — R2 step 4. One file, one writer, one write per burst of work.
 *
 * The state machine, written down before the code (the guide asks for exactly this):
 *
 * ```text
 * command → session.dispatch (in memory, instant) → queue.request()
 *         → scheduled (one debounce timer for the whole burst)
 *         → flushing (session.flush: re-read, compare revision, write, acknowledge)
 *         → idle, or conflict / write-failed, or one more pass when commands arrived mid-write
 * ```
 *
 * The decisions this file fixes, each one a test:
 *
 *   - **A burst is one write.** Ten edits inside the debounce window produce one `session.flush`,
 *     one file write and one revision.
 *   - **A command during a write is never lost.** The write serializes the document *at write time*,
 *     and the queue runs one more pass when commands arrived while the write was in flight; the
 *     waiters of that pass are resolved with that pass's outcome, never with the earlier one.
 *   - **A failed write leaves the session dirty** and reports itself; a later `request()` retries
 *     with the accumulated commands intact.
 *   - **A conflict stops the queue.** The revision check lives in the session (ADR-0005); the queue
 *     surfaces the conflict to every waiting caller and writes nothing further until it is resolved.
 *   - **`close()` waits.** By default it flushes what is pending, then disposes; with `flush:false`
 *     the pending work is declined and the session is disposed unsaved — the caller asked for that.
 *
 * The timer is injected (`scheduler`), so the tests drive it with the repository's fake clock
 * instead of sleeping, and the plugin passes nothing and gets the browser's timer.
 */
import type { DatabaseSession, FlushResult } from './session';

/** The timer seam. `tests/fakes/clock.ts` satisfies it structurally; the default uses `window`. */
export interface QueueScheduler {
	readonly now: () => number;
	readonly setTimer: (callback: () => void, ms: number) => number;
	readonly clearTimer: (handle: number) => void;
}

export interface WriteQueueOptions {
	/** The maximum time a burst may sit unwritten. */
	readonly debounceMs?: number;
	readonly scheduler?: QueueScheduler;
}

/** What `close()` did, so a pane can say "saved" or "closed with unsaved changes". */
export type CloseResult =
	| { readonly ok: true; readonly wrote: boolean }
	| { readonly ok: false; readonly kind: 'conflict' | 'write-failed' };

export interface WriteQueue {
	/** Schedule a write for the current burst. Every caller in the burst gets the same outcome. */
	request(): Promise<FlushResult>;
	/** Write now, cancelling the debounce. Used by blur, close, explicit sync. */
	flushNow(): Promise<FlushResult>;
	/** True while a timer, a batch or a write is outstanding. */
	pending(): boolean;
	/** Flush if pending (by default), then dispose the session. */
	close(options?: { readonly flush?: boolean }): Promise<CloseResult>;
}

const DEFAULT_DEBOUNCE_MS = 400;

interface Waiter {
	resolve: (result: FlushResult) => void;
	promise: Promise<FlushResult>;
}

function waiter(): Waiter {
	let resolve!: (result: FlushResult) => void;
	const promise = new Promise<FlushResult>((settle) => {
		resolve = settle;
	});
	return { resolve, promise };
}

/** The browser's timer. Only reached when no scheduler is injected — the tests always inject one. */
function windowScheduler(): QueueScheduler {
	return {
		now: () => Date.now(),
		setTimer: (callback, ms) => window.setTimeout(callback, ms),
		clearTimer: (handle) => {
			window.clearTimeout(handle);
		},
	};
}

export function createWriteQueue(
	session: DatabaseSession,
	options: WriteQueueOptions = {},
): WriteQueue {
	const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	const scheduler = options.scheduler ?? windowScheduler();

	let timer: number | null = null;
	let waiters: Waiter[] = [];
	let running = false;
	let inflight: Promise<void> | null = null;
	/** Set when something changed while a write was in flight: run one more pass. */
	let more = false;
	let closed = false;

	const cancelTimer = (): void => {
		if (timer !== null) {
			scheduler.clearTimer(timer);
			timer = null;
		}
	};

	const settleAll = (result: FlushResult): void => {
		const pending = waiters;
		waiters = [];
		for (const pendingWaiter of pending) {
			pendingWaiter.resolve(result);
		}
	};

	/** A pass owns its own cleanup: `inflight` is cleared before the pass promise settles, so the */
	/** next `pump()` can never look at a stale handle. */
	const doPump = async (): Promise<void> => {
		running = true;
		try {
			let again = true;
			while (again) {
				more = false;
				const current = waiters;
				waiters = [];
				const result = await session.flush();
				for (const currentWaiter of current) {
					currentWaiter.resolve(result);
				}
				if (!result.ok) {
					// The next pass will not happen; nobody may be left waiting on it.
					settleAll(result);
					return;
				}
				again = more || waiters.length > 0 || session.getState() === 'dirty';
			}
		} finally {
			running = false;
			inflight = null;
		}
	};

	const pump = (): void => {
		if (inflight !== null) {
			// A pass is running; it will notice the new waiters and run again.
			return;
		}
		inflight = doPump();
	};

	/** Join the current burst (starting one if needed) but leave the timer alone. */
	const enqueue = (): Waiter => {
		const next = waiter();
		waiters.push(next);
		if (running) {
			more = true;
		}
		return next;
	};

	return {
		request(): Promise<FlushResult> {
			if (closed) {
				return Promise.resolve({ ok: false, kind: 'disposed' });
			}
			const next = enqueue();
			if (!running && timer === null) {
				timer = scheduler.setTimer(() => {
					timer = null;
					pump();
				}, debounceMs);
			}
			return next.promise;
		},
		flushNow(): Promise<FlushResult> {
			if (closed) {
				return Promise.resolve({ ok: false, kind: 'disposed' });
			}
			cancelTimer();
			const next = enqueue();
			pump();
			return next.promise;
		},
		pending(): boolean {
			return timer !== null || running || waiters.length > 0;
		},
		async close(closeOptions: { readonly flush?: boolean } = {}): Promise<CloseResult> {
			if (closed) {
				return { ok: true, wrote: false };
			}
			cancelTimer();
			if (inflight !== null) {
				await inflight;
			}
			let outcome: CloseResult = { ok: true, wrote: false };
			if (closeOptions.flush === false) {
				// Declined: whoever was waiting is told the work died with the session.
				settleAll({ ok: false, kind: 'disposed' });
			} else if (session.getState() === 'dirty') {
				const result = await session.flush();
				settleAll(result);
				if (result.ok) {
					outcome = { ok: true, wrote: result.wrote };
				} else if (result.kind === 'conflict') {
					outcome = { ok: false, kind: 'conflict' };
				} else if (result.kind === 'write-failed') {
					outcome = { ok: false, kind: 'write-failed' };
				}
			} else {
				settleAll({ ok: true, wrote: false, revision: session.getRevision() });
			}
			closed = true;
			session.dispose();
			return outcome;
		},
	};
}
