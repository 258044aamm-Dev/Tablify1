/**
 * The edit session: the **one** place that knows which cell is being edited.
 *
 * React renders the editor; this module decides whether there is one, what it holds, and what happens when the
 * user finishes. It is deliberately free of React and of the DOM so the interesting half — the transitions —
 * can be tested by calling functions rather than by firing events at components.
 *
 * ```
 *          open(ref, initial)                    commit()  ── parsed ok ──▶ idle (+ focus back to the grid)
 *   idle ───────────────────────▶ editing ───────┴─────────  parsed bad ─▶ editing (error shown, draft kept)
 *     ▲                             │  ▲                    command failed ─▶ editing (error shown, draft kept)
 *     └──── cancel() / escape() ────┘  └── update(draft)
 * ```
 *
 * **Nothing is written per keystroke.** `update()` only replaces the draft; a write happens in `commit()`, once
 * per finished edit, through the `commit` function this session was built with — which is
 * `commands.setCell` in the product and a stub in a test. That is the same rule the store enforces from the
 * other side (one queued batch per action), expressed where the editor can be held to it.
 *
 * **Why the session owns the draft rather than the component.** Two reasons, and both are load-bearing:
 * a commit that fails must leave the *value intact* while the user fixes it (the component would have thrown
 * the draft away on the re-render), and `open()` on a second cell must not lose the first one's work — it
 * commits it, because the grid's own navigation already means "leaving a cell commits it" (`docs/01` §Core
 * interaction model: *Enter — edit the cell; committing moves down one row*; *Tab — commit and move right*).
 *
 * **Parsing lives on the injected `parse`.** A `.cell` holds text; frontmatter holds canonical values
 * (`docs/03` §Field type → frontmatter mapping). Turning one into the other is the field descriptor's job
 * (`field.definition.parse`), and the session asks whoever built it — the grid — rather than reaching into the
 * store's table itself. A parse that fails is not a write: it is an `error` on the state, and the editor stays
 * open. "`12 apples` in a number cell" must never silently become `12`.
 */
import type { CellRef } from '../core/ops/types';

/** What the session is doing. `committing` exists so a slow/failed write is visible for what it is. */
export type EditStatus = 'idle' | 'editing' | 'committing';

/** The session's state: a value, not a store — a listener always sees the whole picture. */
export type EditState = {
	readonly status: EditStatus;
	readonly ref: CellRef | null;
	/** The text in the editor. Never parsed in place: this is what the user typed. */
	readonly draft: string;
	/** Set when a parse or a write failed; cleared by the next edit. Shown inline, never in a dialog. */
	readonly error: string | null;
	/** A parse warning that did not stop the commit ("this value will be stored as text"). */
	readonly warning: string | null;
	/** A nested layer is open (a select's option list). `escape()` closes it before it cancels the editor. */
	readonly listOpen: boolean;
};

/** The answer to a commit attempt. A failure is data, not an exception. */
export type CommitResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** What an `Escape` press did — so the component knows whether to also stop the event. */
export type EscapeOutcome = 'none' | 'closedList' | 'cancelled';

export type EditSessionOptions = {
	/** Writes a canonical value. In the product this is `commands.setCell`; a test passes a stub. */
	readonly commit: (ref: CellRef, value: unknown) => CommitResult;
	/**
	 * Turns the draft into a canonical value. In the product this is the column's own
	 * `field.definition.parse`. `undefined` means "the editor already produced a value" — the filesystem path a
	 * checkbox or a select takes, where there is no text to parse.
	 */
	readonly parse?:
		((ref: CellRef, draft: string) => CommitResult & { readonly value?: unknown }) | undefined;
	/** Told the session changed cell or stopped. `TablifyView`/`GridView` hand this to `store.setEditing`. */
	readonly onActiveChange?: ((ref: CellRef | null) => void) | undefined;
	/** Focus returns here after a commit or a cancel: the grid, on the cell that was being edited. */
	readonly onFinish?: ((ref: CellRef | null) => void) | undefined;
};

export type EditSession = {
	readonly get: () => EditState;
	readonly subscribe: (listener: () => void) => () => void;
	/** Begins editing. An open session is committed first — see the header. */
	readonly open: (ref: CellRef, initial: string) => CommitResult;
	/** Replaces the draft. No write, no parse, no notification to the store. */
	readonly update: (draft: string) => void;
	/** Finishes the edit. `value` writes as-is (a select's option, a checkbox's boolean); omitted ⇒ parse. */
	readonly commit: (value?: unknown) => CommitResult;
	/** Abandons the draft. The store is never told: nothing was written, so nothing needs restoring. */
	readonly cancel: () => void;
	/** Opens/closes the nested layer (a select's list). */
	readonly setListOpen: (open: boolean) => void;
	/** One `Escape`: closes the list if there is one, otherwise cancels. */
	readonly escape: () => EscapeOutcome;
};

const IDLE: EditState = {
	status: 'idle',
	ref: null,
	draft: '',
	error: null,
	warning: null,
	listOpen: false,
};

export function createEditSession(options: EditSessionOptions): EditSession {
	let state: EditState = IDLE;
	const listeners = new Set<() => void>();

	function set(next: EditState): void {
		state = next;
		for (const listener of [...listeners]) {
			listener();
		}
	}

	/** The cell whose editor is open, as the store's mirror should know it. */
	function announce(ref: CellRef | null): void {
		options.onActiveChange?.(ref);
	}

	function finish(): void {
		const ref = state.ref;
		set(IDLE);
		announce(null);
		options.onFinish?.(ref);
	}

	function write(value: unknown): CommitResult {
		const ref = state.ref;
		if (ref === null) {
			return { ok: false, reason: 'no cell is being edited' };
		}
		const result = options.commit(ref, value);
		if (!result.ok) {
			// The draft stays exactly as it was: the cell is still open, the value is intact, and the reason is
			// on screen. A failed write that closed the editor would be the "silent data loss" failure mode.
			set({ ...state, status: 'editing', error: result.reason });
			return result;
		}
		finish();
		return result;
	}

	return {
		get: () => state,

		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},

		open(ref: CellRef, initial: string): CommitResult {
			if (state.status !== 'idle') {
				const finished = this.commit();
				if (!finished.ok) {
					// The first editor stays open with its error: losing what the user typed to honour a click
					// somewhere else would be the wrong trade.
					return finished;
				}
			}
			set({ ...IDLE, status: 'editing', ref, draft: initial });
			announce(ref);
			return { ok: true };
		},

		update(draft: string): void {
			if (state.status !== 'editing') {
				return;
			}
			set({ ...state, draft, error: null });
		},

		commit(value?: unknown): CommitResult {
			if (state.status !== 'editing') {
				return { ok: false, reason: 'no cell is being edited' };
			}
			if (value !== undefined) {
				return write(value);
			}
			const parse = options.parse;
			if (parse === undefined) {
				return write(state.draft);
			}
			const parsed = parse(
				state.ref === null ? { filePath: '', fieldId: '' } : state.ref,
				state.draft,
			);
			if (!parsed.ok) {
				set({ ...state, error: parsed.reason });
				return parsed;
			}
			if (parsed.value === undefined) {
				// A parser that answers `ok` with no value means "the draft *is* the value" — only reachable when
				// a caller wires a parse function of its own; the product's parsers always carry a value.
				return write(state.draft);
			}
			return write(parsed.value);
		},

		cancel(): void {
			if (state.status === 'idle') {
				return;
			}
			// Nothing was written, so "restoring the previous value" is not an action: the store never stopped
			// holding it. The cell is done, and focus goes back where it came from.
			finish();
		},

		setListOpen(open: boolean): void {
			if (state.status !== 'editing') {
				return;
			}
			set({ ...state, listOpen: open });
		},

		escape(): EscapeOutcome {
			if (state.status === 'idle') {
				return 'none';
			}
			if (state.listOpen) {
				set({ ...state, listOpen: false });
				return 'closedList';
			}
			finish();
			return 'cancelled';
		},
	};
}

/**
 * The value an empty draft means: **no value**, which the write path turns into a deleted key
 * (`docs/03` §Frontmatter write rules, rule 3: *clearing deletes the key rather than writing `""`/`null`*).
 * Every editor and the session's tests share this one answer so "I deleted the text" cannot mean two things.
 */
export function valueOfEmptyDraft(): null {
	return null;
}
