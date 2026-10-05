/**
 * The optimistic overlay: the values the user has typed but the disk has not confirmed yet.
 *
 * It holds **pending values only** — never a row's clone, never a file's document, never a whole row's
 * frontmatter. That is the property that makes an external change visible: if another pane edits `Owner`
 * while we have `Status` pending, the grid shows their `Owner` (we never masked it) and our `Status` (we
 * own it), and when our write lands the overlay entry goes away.
 *
 * Read paths consult the overlay first (`get` before the snapshot), which is the whole of the optimistic UI:
 * the store paints the typed value immediately, and the write queue either confirms it (`settle`) or drops
 * it (`drop`) and the grid falls back to what the file actually says.
 *
 * Subscriptions are notified once per change to the *set* of pending values, not once per cell: a 400-cell
 * paste notifies once, because that is one user action and one repaint.
 */
import type { CellValue, PropertyId } from '../core/types';
import type { RowId } from './RowSource';
import type { QueueWrite } from './writeQueue';

/** A pending value, and the moment it was typed (from the caller's clock, for ordering only). */
export type PendingValue = {
	readonly filePath: RowId;
	readonly propertyId: PropertyId;
	readonly value: CellValue;
};

export type Overlay = {
	/** Adds or replaces pending values. Returns how many entries changed. */
	set(writes: readonly QueueWrite[]): number;
	/** The pending value for a cell, or `undefined` when the cell is not pending. */
	get(filePath: RowId, propertyId: PropertyId): CellValue | undefined;
	/** True when anything at all is pending for this row — the grid uses it to mark the row "writing". */
	hasRow(filePath: RowId): boolean;
	/** Every pending value. Allocates: call it from a render, not a cell loop. */
	entries(): readonly PendingValue[];
	/** How many cells are pending. */
	size(): number;
	/** Removes cells the write queue confirmed. */
	settle(writes: readonly QueueWrite[]): void;
	/** Removes cells whose write failed, so the grid shows the file's real content again. */
	drop(writes: readonly QueueWrite[]): void;
	/** Removes everything. Called when a view closes or a query replaces the row set wholesale. */
	clear(): void;
	subscribe(listener: () => void): () => void;
};

/** The map key for a cell. `\u0000` cannot appear in a path or a property name, so it cannot collide. */
function keyOf(filePath: RowId, propertyId: PropertyId): string {
	return `${filePath}\u0000${propertyId}`;
}

export function createOverlay(): Overlay {
	const pending = new Map<string, PendingValue>();
	const listeners = new Set<() => void>();

	const notify = (): void => {
		for (const listener of [...listeners]) {
			listener();
		}
	};

	return {
		set(writes: readonly QueueWrite[]): number {
			let changed = 0;
			for (const write of writes) {
				const key = keyOf(write.filePath, write.propertyId);
				const next: PendingValue = {
					filePath: write.filePath,
					propertyId: write.propertyId,
					value: write.value,
				};
				pending.set(key, next);
				changed += 1;
			}
			if (changed > 0) {
				notify();
			}
			return changed;
		},

		get(filePath: RowId, propertyId: PropertyId): CellValue | undefined {
			return pending.get(keyOf(filePath, propertyId))?.value;
		},

		hasRow(filePath: RowId): boolean {
			for (const entry of pending.values()) {
				if (entry.filePath === filePath) {
					return true;
				}
			}
			return false;
		},

		entries(): readonly PendingValue[] {
			return [...pending.values()];
		},

		size(): number {
			return pending.size;
		},

		settle(writes: readonly QueueWrite[]): void {
			let changed = 0;
			for (const write of writes) {
				const key = keyOf(write.filePath, write.propertyId);
				const current = pending.get(key);
				// Only remove the entry the caller confirmed. A newer keystroke that replaced it while the
				// write was in flight must stay pending, or the grid would flicker back to the older value.
				if (current !== undefined && current.value === write.value) {
					pending.delete(key);
					changed += 1;
				}
			}
			if (changed > 0) {
				notify();
			}
		},

		drop(writes: readonly QueueWrite[]): void {
			let changed = 0;
			for (const write of writes) {
				if (pending.delete(keyOf(write.filePath, write.propertyId))) {
					changed += 1;
				}
			}
			if (changed > 0) {
				notify();
			}
		},

		clear(): void {
			if (pending.size === 0) {
				return;
			}
			pending.clear();
			notify();
		},

		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
