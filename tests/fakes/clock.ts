/**
 * A controllable clock. No real timer is ever installed, so a test that hangs on a debounce or a retry
 * backoff fails immediately instead of timing out, and a test that asserts on "at" gets an exact number.
 *
 * The two ways to move time forward are deliberately different:
 *   - `advance(ms)` moves the clock and then runs every timer that has come due, in due order;
 *   - `runTimers()` runs every pending timer without waiting, moving the clock to each timer's due time.
 */
export type TimerCallback = () => void;

export type Clock = {
	/** Milliseconds since the test started. Starts at 0, never moves on its own. */
	now(): number;
	/** Move time forward and run the timers that come due. */
	advance(ms: number): void;
	/** Run every pending timer, in due order, moving the clock to each due time. */
	runTimers(): void;
	/** Register a timer, mirroring `setTimeout`. Returns an id for `clearTimer`. */
	setTimer(callback: TimerCallback, ms: number): number;
	clearTimer(id: number): void;
	/** How many timers are still pending: a debounce test asserts 1, then 0. */
	pending(): number;
};

type PendingTimer = { id: number; due: number; callback: TimerCallback };

export function createFakeClock(start = 0): Clock {
	let current = start;
	let nextId = 1;
	let timers: PendingTimer[] = [];

	const runDue = (limit: number | undefined): void => {
		for (;;) {
			const due = timers
				.filter((timer) => limit === undefined || timer.due <= limit)
				.sort((a, b) => a.due - b.due)[0];
			if (due === undefined) {
				return;
			}
			timers = timers.filter((timer) => timer.id !== due.id);
			current = Math.max(current, due.due);
			due.callback();
		}
	};

	return {
		now: () => current,
		advance(ms) {
			current += ms;
			runDue(current);
		},
		runTimers() {
			runDue(undefined);
		},
		setTimer(callback, ms) {
			const id = nextId;
			nextId += 1;
			const safeMs = Math.max(0, ms);
			timers.push({ id, due: current + safeMs, callback });
			return id;
		},
		clearTimer(id) {
			timers = timers.filter((timer) => timer.id !== id);
		},
		pending: () => timers.length,
	};
}
