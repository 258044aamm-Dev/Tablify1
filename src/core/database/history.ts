/**
 * Database-scoped, operation-based undo history (ADR-0012; R3 step 6).
 *
 * History stores one plain-data entry per user action: the operations that were accepted and the
 * exact inverses returned by `applyOperations`. It never stores a document snapshot or a callback.
 * The owning session applies a plan first and adopts its `next` state only after that application
 * succeeds, so a stale or refused undo/redo cannot consume an entry.
 */
import type { DatabaseOperation } from './operations';

/** Matches the existing grid's documented 60-step cap; history is never written to the document. */
export const MAX_DATABASE_HISTORY_DEPTH = 60;

/** One logical action, however many operations or cells it contains. */
export interface DatabaseHistoryEntry {
	readonly label: string;
	readonly operations: readonly DatabaseOperation[];
	readonly inverse: readonly DatabaseOperation[];
}

/** Pure history state owned by one open database session. */
export interface DatabaseHistoryState {
	readonly depthLimit: number;
	readonly undo: readonly DatabaseHistoryEntry[];
	readonly redo: readonly DatabaseHistoryEntry[];
}

/** A proposed stack transition. `next` is adopted only if applying `operations` succeeds. */
export interface DatabaseHistoryPlan {
	readonly direction: 'undo' | 'redo';
	readonly label: string;
	readonly operations: readonly DatabaseOperation[];
	readonly next: DatabaseHistoryState;
}

/** The caller can expose this summary without leaking mutable stack internals. */
export interface DatabaseHistorySummary {
	readonly canUndo: boolean;
	readonly canRedo: boolean;
	readonly undoLabel: string | null;
	readonly redoLabel: string | null;
	readonly depth: number;
	readonly redoDepth: number;
}

function freezeData<T>(value: T): T {
	if (Array.isArray(value)) {
		for (const entry of value) {
			freezeData(entry);
		}
		Object.freeze(value);
		return value;
	}
	if (value instanceof Map) {
		for (const [key, entry] of value) {
			freezeData(key);
			freezeData(entry);
		}
		// Object.freeze cannot disable Map#set. Entries are private to the history implementation and
		// all plans receive a clone, so freezing their contents is still useful and honest here.
		return value;
	}
	if (value !== null && typeof value === 'object') {
		for (const entry of Object.values(value)) {
			freezeData(entry);
		}
		return Object.freeze(value);
	}
	return value;
}

/** Reject host objects and executable values before they can become part of history state. */
function assertPlainData(value: unknown, seen: WeakSet<object>): void {
	if (
		value === null ||
		value === undefined ||
		typeof value === 'string' ||
		typeof value === 'boolean' ||
		(typeof value === 'number' && Number.isFinite(value))
	) {
		return;
	}
	if (typeof value !== 'object') {
		throw new TypeError('History operations must contain only serializable plain data.');
	}
	if (seen.has(value)) {
		throw new TypeError('History operations cannot contain circular references.');
	}
	seen.add(value);
	if (value instanceof Map) {
		for (const [key, entry] of value) {
			if (typeof key !== 'string') {
				throw new TypeError('History maps must use string keys.');
			}
			assertPlainData(entry, seen);
		}
		seen.delete(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			assertPlainData(entry, seen);
		}
		seen.delete(value);
		return;
	}
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('History cannot contain host objects, classes, or Date values.');
	}
	if (Object.getOwnPropertySymbols(value).length > 0) {
		throw new TypeError('History objects cannot contain symbol keys.');
	}
	for (const entry of Object.values(value)) {
		assertPlainData(entry, seen);
	}
	seen.delete(value);
}

function cloneEntry(entry: DatabaseHistoryEntry): DatabaseHistoryEntry {
	if (typeof entry.label !== 'string' || entry.label.trim().length === 0) {
		throw new TypeError('A history entry needs a non-empty label.');
	}
	assertPlainData(entry.operations, new WeakSet());
	assertPlainData(entry.inverse, new WeakSet());
	const clone = structuredClone({
		label: entry.label,
		operations: entry.operations,
		inverse: entry.inverse,
	});
	return freezeData(clone);
}

function stateOf(
	depthLimit: number,
	undo: readonly DatabaseHistoryEntry[],
	redo: readonly DatabaseHistoryEntry[],
): DatabaseHistoryState {
	return Object.freeze({
		depthLimit,
		undo: Object.freeze([...undo]),
		redo: Object.freeze([...redo]),
	});
}

/** Start one empty database history. A zero depth deliberately disables history. */
export function createDatabaseHistory(
	depthLimit = MAX_DATABASE_HISTORY_DEPTH,
): DatabaseHistoryState {
	if (!Number.isInteger(depthLimit) || depthLimit < 0) {
		throw new RangeError('History depth must be a non-negative integer.');
	}
	return stateOf(depthLimit, [], []);
}

/** Drop both stacks, keeping the configured depth. Used after an explicit reload or session close. */
export function clearDatabaseHistory(history: DatabaseHistoryState): DatabaseHistoryState {
	return stateOf(history.depthLimit, [], []);
}

/** Record one successful action and invalidate redo. Empty actions do not create a step. */
export function pushDatabaseHistory(
	history: DatabaseHistoryState,
	entry: DatabaseHistoryEntry,
): DatabaseHistoryState {
	if (entry.operations.length === 0) {
		return history;
	}
	const saved = cloneEntry(entry);
	if (history.depthLimit === 0) {
		return stateOf(history.depthLimit, [], []);
	}
	const undo = [...history.undo, saved].slice(-history.depthLimit);
	return stateOf(history.depthLimit, undo, []);
}

/** Plan an undo without changing history. Adopt `next` only after the operations apply successfully. */
export function planDatabaseUndo(history: DatabaseHistoryState): DatabaseHistoryPlan | null {
	const entry = history.undo[history.undo.length - 1];
	if (entry === undefined) {
		return null;
	}
	const operations = structuredClone(entry.inverse);
	const undo = history.undo.slice(0, -1);
	const redo = [...history.redo, entry].slice(-history.depthLimit);
	return {
		direction: 'undo',
		label: entry.label,
		operations,
		next: stateOf(history.depthLimit, undo, redo),
	};
}

/** Plan a redo without changing history. Adopt `next` only after the operations apply successfully. */
export function planDatabaseRedo(history: DatabaseHistoryState): DatabaseHistoryPlan | null {
	const entry = history.redo[history.redo.length - 1];
	if (entry === undefined) {
		return null;
	}
	const operations = structuredClone(entry.operations);
	const redo = history.redo.slice(0, -1);
	const undo = [...history.undo, entry].slice(-history.depthLimit);
	return {
		direction: 'redo',
		label: entry.label,
		operations,
		next: stateOf(history.depthLimit, undo, redo),
	};
}

/** A read-only summary for menus and stores. */
export function summarizeDatabaseHistory(history: DatabaseHistoryState): DatabaseHistorySummary {
	const undoLabel = history.undo[history.undo.length - 1]?.label ?? null;
	const redoLabel = history.redo[history.redo.length - 1]?.label ?? null;
	return {
		canUndo: undoLabel !== null,
		canRedo: redoLabel !== null,
		undoLabel,
		redoLabel,
		depth: history.undo.length,
		redoDepth: history.redo.length,
	};
}
