/**
 * The runner: **a 412-row import that creates 412 notes without freezing Obsidian, and reports honestly when it
 * cannot finish.**
 *
 * Three requirements pull in different directions, and the compromise is written down here rather than discovered
 * later:
 *
 *   1. **Never freeze.** Creating a note is one `vault.create`, and 412 of them plus 412 frontmatter
 *      serialisations is real work on the same thread the grid draws on. So the runner works in chunks and yields
 *      to a **macrotask** between them ({@link CHUNK}).
 *   2. **Never write without a plan.** The input is an `ImportPlan` — the object the wizard showed. The runner
 *      does not read the matrix, does not infer, does not name anything: a second naming rule here is how a
 *      preview starts lying, and `tests/unit/import-run.test.ts` asserts the plan's own paths are the paths that
 *      exist afterwards.
 *   3. **Cancel and failure both report exactly what happened.** A cancelled run creates no more notes and returns
 *      the count it did create; a failed note is recorded per file and the run continues, because abandoning the
 *      200 rows after it would lose work one bad path should not destroy.
 *
 * Chunk size: **25 notes per macrotask** — measured reasoning, not taste. One note is a string build plus one
 * `vault.create`, on the order of 0.1–0.5 ms with a warm cache, so a chunk is a few milliseconds and a frame at
 * 60 fps is 16.7 ms. Twenty-five leaves room for the render the progress line causes. Why a **macrotask** and not
 * a microtask: `await` on an already-resolved promise yields to the microtask queue, which drains *before* the
 * browser paints, so a thousand-await loop still freezes the window. `setTimeout(r, 0)` is the boundary that lets
 * the render happen — and there is exactly one timer in this file, awaited inside the loop, because the ban is on
 * callback chains, not on yielding.
 *
 * **The one undo step.** `docs/03` §Import: *"note creation → single undo step that removes the created notes"*.
 * The run's created paths are its undo step (`ImportUndoStep`), and `undoImport` removes exactly those files
 * through the trash port — a note that is already gone is reported as missing rather than counted or thrown.
 * Nothing else is touched: a run that created 150 of 412 notes has an undo step holding those 150.
 */
import { frontmatterBody } from '../../adapters/notes/createNote';
import type { NoteVault } from '../../adapters/notes/createNote';
import type { ImportPlan, PlannedCollision, PlannedSkip } from '../../core/import/plan';
import type { YamlValue } from '../../core/types';

/** Notes created per macrotask. See the header for the arithmetic; the number is asserted in the tests. */
export const CHUNK = 25;

/** One note that could not be created, exactly as the summary reports it. */
export type ImportFailure = {
	readonly row: number;
	readonly path: string;
	readonly reason: string;
};

/** The undo step a run leaves behind: its label, and the files it created in creation order. */
export type ImportUndoStep = {
	readonly label: string;
	readonly paths: readonly string[];
};

/** What a run tells the caller. Shaped like `WriteResult`, so "what happened" has one vocabulary. */
export type ImportSummary = {
	/** Notes that exist because of this run, in creation order. */
	readonly created: readonly string[];
	readonly failures: readonly ImportFailure[];
	/** True when `shouldStop` asked to stop between chunks. */
	readonly cancelled: boolean;
	/** The plan's own skipped cells, so the summary is the whole truth and not only the file half. */
	readonly skipped: readonly PlannedSkip[];
	/** The plan's own collision predictions, whether or not they happened again at creation time. */
	readonly collisions: readonly PlannedCollision[];
	/** `created n of N` — the last thing the progress line said. */
	readonly progress: string;
	/** The one undo step: every path above, in order. */
	readonly undo: ImportUndoStep;
	/** `true` when nothing failed and the run was not cancelled. */
	readonly ok: boolean;
};

/** What the runner needs of a vault: the plan's names, written. */
export type ImportVault = NoteVault;

export type ImportRunOptions = {
	readonly plan: ImportPlan;
	readonly vault: ImportVault;
	/** Called once at 0 and after every chunk, with the running counts. */
	readonly onProgress?: ((created: number, total: number) => void) | undefined;
	/**
	 * A way to stop between chunks. A modal's Cancel button sets this; a test sets it after N notes. The runner
	 * checks it **only** between chunks, which is what makes a cancellation report exact counts.
	 */
	readonly shouldStop?: (() => boolean) | undefined;
	/** The yield the chunk boundary uses. Injectable so a test can run 412 notes without a real clock. */
	readonly yieldTo?: (() => Promise<void>) | undefined;
};

/**
 * The macrotask boundary. One `setTimeout` per chunk, never a chain of them: the loop is the control flow, and
 * this is the single place a timer appears.
 */
function macrotask(): Promise<void> {
	return new Promise((resolve) => {
		// `window` when there is one — Obsidian runs in Electron, a pop-out window has its own timer, and the grid
		// belongs to the window that hosts it — and the bare global otherwise, because the node test project has no
		// `window` at all and a macrotask there is the same idea.
		if (typeof window === 'undefined') {
			setTimeout(resolve, 0);
			return;
		}
		window.setTimeout(resolve, 0);
	});
}

/** `created 412 of 412`. One formatter, so the modal, the live region and the summary cannot disagree. */
export function progressText(created: number, total: number): string {
	return `created ${String(created)} of ${String(total)}`;
}

/**
 * Runs a plan. Resolves rather than rejects: a failure is data (the summary), and a caller that has to try/catch
 * around an import is a caller that will forget to.
 */
export async function runImport(options: ImportRunOptions): Promise<ImportSummary> {
	const { plan, vault } = options;
	const yieldTo = options.yieldTo ?? macrotask;
	const created: string[] = [];
	const failures: ImportFailure[] = [];
	let cancelled = false;
	const total = plan.notes.length;

	options.onProgress?.(0, total);

	for (const [index, note] of plan.notes.entries()) {
		if (index > 0 && index % CHUNK === 0) {
			await yieldTo();
			if (options.shouldStop?.() === true) {
				cancelled = true;
				break;
			}
		}
		const failure = await createOne(note.path, note.frontmatter, vault, plan.folder);
		if (failure === null) {
			created.push(note.path);
		} else {
			failures.push({ row: note.row, path: note.path, reason: failure });
		}
		if ((index + 1) % CHUNK === 0 || index === total - 1) {
			options.onProgress?.(created.length, total);
		}
	}

	const progress = progressText(created.length, total);
	options.onProgress?.(created.length, total);
	return {
		created,
		failures,
		cancelled,
		skipped: plan.skipped,
		collisions: plan.collisions,
		progress,
		undo: undoStepFor(created),
		ok: failures.length === 0 && !cancelled,
	};
}

/** The label the undo entry carries. One place, so the menu and the summary say the same words. */
function undoStepFor(paths: readonly string[]): ImportUndoStep {
	const count = paths.length;
	return {
		label: `Import ${String(count)} note${count === 1 ? '' : 's'}`,
		paths,
	};
}

/**
 * One note. The path is the plan's, **not** a name derived here: a second collision rule is how the preview and
 * the disk drift apart, and `note.path` already contains the suffix the wizard showed.
 *
 * Returns the reason on failure, `null` on success. The two refusals are the ones a run actually meets: the row
 * folder disappeared between the preview and the run, and a file appeared at the planned path meanwhile — both
 * per-file, neither fatal to the other 411.
 */
async function createOne(
	path: string,
	frontmatter: Readonly<Record<string, YamlValue>>,
	vault: ImportVault,
	folder: string,
): Promise<string | null> {
	if (!vault.hasFolder(folder)) {
		return `the row folder “${folder}” does not exist — create it, or change the row folder in Tablify's settings`;
	}
	if (vault.has(path)) {
		return `“${path}” appeared while the import was running`;
	}
	try {
		await vault.create(path, frontmatterBody(frontmatter));
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

/* ── undo: the other half of "single undo step" ───────────────────────────────────────────────── */

/** What removing notes needs of a vault. `trash` is `FileManager.trashFile` — never `Vault.delete`. */
export type TrashVault = {
	has(path: string): boolean;
	trash(path: string): Promise<void>;
};

/** One undo's account: what came out, and what was already gone. */
export type ImportUndoReport = {
	readonly removed: readonly string[];
	readonly missing: readonly string[];
	readonly failed: readonly { readonly path: string; readonly reason: string }[];
	/** One sentence for a Notice or the live region: *"Removed 412 notes"*. */
	readonly message: string;
};

/**
 * Removes exactly the notes a run created, in reverse creation order (the order a person would undo a stack).
 *
 * `docs/01` §Editing says a failed write must never look like a success; the same rule for an undo means a file
 * that was already deleted is **reported**, and a file that could not be trashed is named with its reason rather
 * than left silently behind. Files are trashed, not deleted: an undo of an import landing in the system trash is
 * recoverable, and "Undo" should never be the most destructive button in the product.
 */
export async function undoImport(
	step: ImportUndoStep,
	vault: TrashVault,
): Promise<ImportUndoReport> {
	const removed: string[] = [];
	const missing: string[] = [];
	const failed: { path: string; reason: string }[] = [];
	for (const path of [...step.paths].reverse()) {
		if (!vault.has(path)) {
			missing.push(path);
			continue;
		}
		try {
			await vault.trash(path);
			removed.push(path);
		} catch (error) {
			failed.push({ path, reason: error instanceof Error ? error.message : String(error) });
		}
	}
	return {
		removed,
		missing,
		failed,
		message: undoMessage(removed.length, missing.length, failed.length),
	};
}

/** *"Removed 410 of 412 notes · 2 were already gone"*. Counts first, so the sentence is true at a glance. */
export function undoMessage(removed: number, missing: number, failed: number): string {
	const note = (count: number): string => `${String(count)} note${count === 1 ? '' : 's'}`;
	const parts: string[] = [];
	if (removed > 0) {
		parts.push(`Removed ${note(removed)}`);
	}
	if (missing > 0) {
		parts.push(`${note(missing)} already gone`);
	}
	if (failed > 0) {
		parts.push(`${note(failed)} could not be removed`);
	}
	return parts.length === 0 ? 'Nothing to remove' : parts.join(' · ');
}

/**
 * The import's own undo stack. It is deliberately **not** the grid store's history: the store's ops describe cells
 * and rows inside a view, and an import's effect is a set of files on disk that the view has not read yet. One
 * entry per run, newest first, bounded so a long session cannot hold a thousand paths forever.
 */
export type ImportHistory = {
	/** Records a run's undo step. A run that created nothing is not a step: there is nothing to undo. */
	record(step: ImportUndoStep): void;
	/** The newest entry, or `null`. */
	peek(): ImportUndoStep | null;
	/** Undoes the newest entry through {@link undoImport}, and pops it whatever the outcome. */
	undo(): Promise<ImportUndoReport | null>;
	readonly size: number;
	clear(): void;
};

/** How many runs' worth of paths to keep. Twenty imports of 412 notes is 8,240 strings: a few hundred KB. */
export const IMPORT_HISTORY_DEPTH = 20;

export function createImportHistory(
	vault: TrashVault,
	options?: { readonly depth?: number },
): ImportHistory {
	const depth = options?.depth ?? IMPORT_HISTORY_DEPTH;
	const stack: ImportUndoStep[] = [];
	return {
		record(step) {
			if (step.paths.length === 0) {
				return;
			}
			stack.push(step);
			while (stack.length > depth) {
				stack.shift();
			}
		},
		peek() {
			return stack[stack.length - 1] ?? null;
		},
		async undo() {
			const step = stack.pop();
			if (step === undefined) {
				return null;
			}
			return undoImport(step, vault);
		},
		get size() {
			return stack.length;
		},
		clear() {
			stack.length = 0;
		},
	};
}
