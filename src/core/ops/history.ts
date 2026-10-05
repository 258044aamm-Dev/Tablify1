/**
 * The undo stack.
 *
 * It holds **commands**, not ops: one user action is one push, however many ops it produced. That is the
 * rule `docs/01` §Feature scope states in one line ("Undo/redo — all grid operations, including multi-note
 * writes, as one user-visible step"), and it is why a 400-cell paste, a column deletion and an import are
 * each exactly one Ctrl+Z. The stack owns no table state: `undo()` hands back the ops to run, and the store
 * replays them through the same write queue the edit went through (`docs/02` §Store).
 *
 * ## The coalescing decision
 *
 * The pack asks for a `shouldCoalesce` hook, and only "when the docs say so". They do not. The docs say:
 *
 *   - `docs/01` §Feature scope: "Undo/redo | All grid operations, including multi-note writes, **as one
 *     user-visible step**";
 *   - `docs/02` §Store: "a **`Command`** captures the ops it produced *and the previous values it
 *     overwrote*";
 *   - `prompts/step-18-cell-editors.md`: "Every editor: commits **once per finished edit** (no write on each
 *     keystroke)".
 *
 * So a cell edit is *already* one op pushed once, and a second push while typing would be a second user
 * action. There is nothing to merge, and merging keystrokes into one step would contradict "one user-visible
 * step" rather than implement it. The hook therefore exists — the store may pass a rule — and the default is
 * `NEVER_COALESCE`, which merges nothing. `history.test.ts` asserts both halves: two pushes stay two steps
 * by default, and a caller-supplied rule does merge them (including the before-image rule below).
 *
 * When a caller *does* merge, the **earlier** before-image wins for any cell both commands touch. That is the
 * whole reason before-images travel beside the ops instead of inside them: undo must restore the value from
 * before the first keystroke, not the value from before the last one.
 */
import type { CellValue } from '../types';
import type { Before, CoalesceRule, Op } from './types';
import { invertAll } from './inverse';

/**
 * How many steps the stack keeps. The only undo depth the project records is the prototype's, which caps at
 * 60 steps (`prototype/js/store.js` — `cap()`), and `docs/` names no number at all. 60 is carried over
 * rather than invented, and reported as a gap: it deserves a line in `docs/01` §undo.
 */
export const MAX_HISTORY_DEPTH = 60;

/** Merges nothing. The documented default; see the header. */
export const NEVER_COALESCE: CoalesceRule = () => false;

/** One user action: what it changed, and what those values were before. */
export type Command = {
	/** Wording for the undo menu item: "Paste 400 rows", "Rename column". */
	readonly label: string;
	readonly ops: readonly Op[];
	readonly befores: readonly Before[];
};

/** What a successful undo/redo hands back: the ops to run, and the wording for the toast. */
export type StepResult =
	| { readonly ok: true; readonly label: string; readonly ops: readonly Op[] }
	| { readonly ok: false; readonly reason: string };

/** The stack. `push` records, `undo`/`redo` hand back ops, and nothing here touches the table. */
export type History = {
	readonly push: (command: Command) => void;
	readonly undo: () => StepResult;
	readonly redo: () => StepResult;
	readonly canUndo: () => boolean;
	readonly canRedo: () => boolean;
	/** Steps currently undoable. Never more than the configured depth. */
	readonly depth: () => number;
	/** Steps currently redoable. */
	readonly redoDepth: () => number;
	readonly clear: () => void;
	/** The wording `undo()` would use, or `null`. Drives "Undo paste 400 rows" in the menu. */
	readonly undoLabel: () => string | null;
	readonly redoLabel: () => string | null;
};

/** The options the store passes. Both have documented defaults, so `createHistory()` is complete. */
export type HistoryOptions = {
	readonly depth?: number;
	readonly shouldCoalesce?: CoalesceRule;
};

/** A cell's identity as a map key. Also used to spot the two commands touching the same cell. */
function cellKey(filePath: string, fieldId: string): string {
	return `${filePath}\u0000${fieldId}`;
}

/** Every cell an op writes, paired with the value that was there before it. Empty for the other kinds. */
function beforeCells(
	op: Op,
	before: Before,
): readonly { readonly key: string; readonly value: CellValue }[] {
	if (before.kind === 'value' && op.kind === 'setCell') {
		return [{ key: cellKey(op.filePath, op.fieldId), value: before.value }];
	}
	if (before.kind === 'cells') {
		return before.writes.map((write) => ({
			key: cellKey(write.filePath, write.fieldId),
			value: write.value,
		}));
	}
	return [];
}

/** The value each cell held before the *first* command in the run that touched it. */
function firstSeen(ops: readonly Op[], befores: readonly Before[]): Map<string, CellValue> {
	const seen = new Map<string, CellValue>();
	for (let index = 0; index < ops.length; index += 1) {
		const op = ops[index];
		const before = befores[index];
		if (op === undefined || before === undefined) {
			continue;
		}
		for (const cell of beforeCells(op, before)) {
			if (!seen.has(cell.key)) {
				seen.set(cell.key, cell.value);
			}
		}
	}
	return seen;
}

/** Rebuilds each op's before-image from the first-seen map. Only cell writes carry one. */
function rebuildBefores(
	ops: readonly Op[],
	befores: readonly Before[],
	seen: Map<string, CellValue>,
): readonly Before[] {
	return ops.map((op, index) => {
		const before = befores[index];
		if (op.kind === 'setCell') {
			return { kind: 'value', value: seen.get(cellKey(op.filePath, op.fieldId)) ?? null };
		}
		if (op.kind === 'setCells' || op.kind === 'clearCells') {
			const cells = op.kind === 'setCells' ? op.writes : op.cells;
			return {
				kind: 'cells',
				writes: cells.map((cell) => ({
					filePath: cell.filePath,
					fieldId: cell.fieldId,
					value: seen.get(cellKey(cell.filePath, cell.fieldId)) ?? null,
				})),
			};
		}
		return before ?? { kind: 'none' };
	});
}

/** Creates a history stack. One per open view, like the store it serves. */
export function createHistory(options: HistoryOptions = {}): History {
	const limit = options.depth ?? MAX_HISTORY_DEPTH;
	const shouldCoalesce = options.shouldCoalesce ?? NEVER_COALESCE;
	let undoStack: Command[] = [];
	let redoStack: Command[] = [];

	const trim = (): void => {
		while (undoStack.length > limit) {
			undoStack.shift();
		}
	};

	return {
		push(command: Command): void {
			const previous = undoStack[undoStack.length - 1];
			// A new action invalidates the redo branch, whether or not it coalesces.
			redoStack = [];
			if (previous !== undefined && shouldCoalesce(previous.ops, command.ops)) {
				const ops = [...previous.ops, ...command.ops];
				const befores = [...previous.befores, ...command.befores];
				const merged: Command = {
					// The first wording wins: the step describes the action it began with.
					label: previous.label,
					ops,
					befores: rebuildBefores(ops, befores, firstSeen(ops, befores)),
				};
				undoStack[undoStack.length - 1] = merged;
				trim();
				return;
			}
			undoStack.push(command);
			trim();
		},

		undo(): StepResult {
			const entry = undoStack[undoStack.length - 1];
			if (entry === undefined) {
				return { ok: false, reason: 'there is nothing to undo' };
			}
			const inverted = invertAll(entry.ops, entry.befores);
			if (!inverted.ok) {
				// The step stays on the stack: an undo that cannot be built must not be consumed.
				return { ok: false, reason: inverted.reason };
			}
			undoStack = undoStack.slice(0, -1);
			redoStack.push(entry);
			return { ok: true, label: entry.label, ops: inverted.ops };
		},

		redo(): StepResult {
			const entry = redoStack[redoStack.length - 1];
			if (entry === undefined) {
				return { ok: false, reason: 'there is nothing to redo' };
			}
			redoStack = redoStack.slice(0, -1);
			undoStack.push(entry);
			trim();
			return { ok: true, label: entry.label, ops: entry.ops };
		},

		canUndo(): boolean {
			return undoStack.length > 0;
		},

		canRedo(): boolean {
			return redoStack.length > 0;
		},

		depth(): number {
			return undoStack.length;
		},

		redoDepth(): number {
			return redoStack.length;
		},

		clear(): void {
			undoStack = [];
			redoStack = [];
		},

		undoLabel(): string | null {
			const entry = undoStack[undoStack.length - 1];
			return entry === undefined ? null : entry.label;
		},

		redoLabel(): string | null {
			const entry = redoStack[redoStack.length - 1];
			return entry === undefined ? null : entry.label;
		},
	};
}
