/**
 * The keyboard model, as one table and one listener.
 *
 * `docs/01` §Core interaction model is the spec, `src/plugin/help/keyBindings.ts` is its human-readable twin,
 * and this file is the executable one: {@link resolveKey} is a pure function from a key event plus a little
 * context to **one intent**, and {@link attachGridKeyboard} is the only thing in the plugin that listens for a
 * key. Three rules decide the shape of both:
 *
 *  · **One `keydown` listener, on the grid root, in the capture phase.** Not per cell (a listener per cell is a
 *    listener per row per frame), not on `document` or `window` (a global key handler is a key handler that
 *    fires in someone else's note). Capture rather than bubble because the editor that owns the keyboard calls
 *    `stopPropagation` on its own keys — and the grid still has to *see* `Enter` and `Tab` to know that a commit
 *    is about to happen and where the selection should land afterwards (`docs/01`: *Enter — committing moves
 *    down one row*). Capture observes; the editor still gets first refusal, because nothing here calls
 *    `preventDefault` while an editor is open.
 *  · **The editor's state machine gets first refusal.** With an editor open this resolver answers `null` for
 *    everything except the two commit keys, which it only records. Escaping a popover, closing a list and
 *    cancelling a draft all belong to `editSession` (step 18) — the grid must not have a second opinion about
 *    what `Escape` means.
 *  · **`preventDefault` only where the action is handled.** The dispatcher returns whether it did anything; an
 *    unhandled intent lets the key through untouched. That is what keeps `Tab` at the last cell leaving the
 *    grid, `Cmd+C` copying *something* if the clipboard wiring is not there yet, and a browser-reserved key from
 *    being silently swallowed.
 *
 * Precedence is the order of the `switch`-like checks in {@link resolveKey} and is part of the contract: a
 * modified chord may never be read as a printable character, and `Space` may never be read as "start editing"
 * on a checkbox.
 */
import type { Edge } from '../../core/selection/range';

/** What a key handler needs to know about the grid, and nothing else. */
export type KeyContext = {
	/** An editor (or one of its popovers) owns the keyboard: the grid stands down. */
	readonly editing: boolean;
	/** The active cell is an editable checkbox: `Space` toggles it instead of starting an edit. */
	readonly checkbox: boolean;
	/**
	 * How many rows a page key jumps: the visible band divided by the row height, measured by the grid.
	 * `PageUp`/`PageDown` move the *active cell* a screen (the prototype's "Jump a screen"), not the scroller —
	 * the cell's own reveal then scrolls it into view, which is the same picture with one source of truth.
	 */
	readonly pageRows: number;
};

/** The event fields this module reads. A structural type, so a test can build one without a real event. */
export type KeyEventLike = {
	readonly key: string;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
	/** An IME composition in progress: never a shortcut, never a replacement character. */
	readonly isComposing?: boolean | undefined;
};

/**
 * One thing the grid can be asked to do.
 *
 * All but one of these ids are binding ids: the same strings as `KEY_BINDINGS` (`src/plugin/help`), which the
 * match test holds in step. **`commit-move` is the exception and it is not a binding**: it is what the grid sees
 * when a *commit key* is pressed inside an open editor — `Enter` (commit and move down) and `Tab`/`Shift+Tab`
 * (commit and move right/left). The editor commits; the grid moves the selection afterwards, which is the half
 * of the doc's rule (`docs/01`: *Enter — committing moves down one row*) that the editor has no business owning.
 */
export type GridIntent =
	| { readonly id: 'move'; readonly edge: Edge; readonly extend: boolean }
	| {
			readonly id: 'navigate-edges';
			readonly edge: Edge;
			readonly extend: boolean;
			/** Rows to move at once: 1 for the edge keys, a screenful for `PageUp`/`PageDown`. */
			readonly steps: number;
	  }
	| { readonly id: 'edit' }
	| { readonly id: 'commit-tab'; readonly direction: 'forward' | 'backward' }
	| { readonly id: 'commit-move'; readonly direction: 'down' | 'forward' | 'backward' }
	| { readonly id: 'type-to-replace'; readonly text: string }
	| { readonly id: 'toggle-checkbox' }
	| { readonly id: 'clipboard'; readonly verb: 'copy' | 'cut' | 'paste' }
	| { readonly id: 'undo-redo'; readonly verb: 'undo' | 'redo' }
	| { readonly id: 'select-all' }
	| { readonly id: 'bulk-edit' }
	| { readonly id: 'clear' }
	| { readonly id: 'fill'; readonly direction: 'down' | 'right' }
	| { readonly id: 'escape' }
	| { readonly id: 'help' };

/** Every id {@link resolveKey} can answer with. The keyboard half of `KEY_BINDINGS`, plus `commit-move`. */
export type IntentId = GridIntent['id'];

/** A modifier a person holds. `Mod` is `Cmd` on a Mac and `Ctrl` everywhere else — one name for both. */
function isMod(event: KeyEventLike): boolean {
	return event.ctrlKey || event.metaKey;
}

/** A printable character: one code point, no chord, and not the space that a control key produces. */
function isPrintable(event: KeyEventLike): boolean {
	if (event.ctrlKey || event.metaKey || event.altKey) {
		return false;
	}
	if (event.isComposing === true) {
		return false;
	}
	// `event.key` is one character for a character key and a name for every other key ("Enter" is five), which
	// is exactly the distinction the doc's "any printable key" needs. `Space` is one character too and is
	// deliberately included: on a checkbox it is handled above, everywhere else a space is text.
	return [...event.key].length === 1;
}

/** The arrows, with `Shift` extending the range rather than moving it (`docs/01`). */
function arrowEdge(key: string): Edge | null {
	switch (key) {
		case 'ArrowUp':
			return 'up';
		case 'ArrowDown':
			return 'down';
		case 'ArrowLeft':
			return 'left';
		case 'ArrowRight':
			return 'right';
		default:
			return null;
	}
}

/**
 * The resolver: one key event in, at most one intent out.
 *
 * Exported on its own — the listener below is four lines around it — because this is the function a test can
 * drive through every row of the doc's table without a DOM, a store or a browser.
 */
export function resolveKey(event: KeyEventLike, context: KeyContext): GridIntent | null {
	// The editor owns the keyboard. The commit keys are still *read* here — the grid has to know where the
	// selection lands when the edit ends — but nothing is handled: the editor's own handler commits or cancels,
	// and this function's answer is only used to record the follow-up move.
	if (context.editing) {
		switch (event.key) {
			case 'Enter':
				return { id: 'commit-move', direction: 'down' };
			case 'Tab':
				return { id: 'commit-move', direction: event.shiftKey ? 'backward' : 'forward' };
			default:
				return null;
		}
	}

	// An IME composition is text being composed, never a shortcut: `Enter` that confirms a candidate must not
	// also open the editor.
	if (event.isComposing === true) {
		return null;
	}

	const mod = isMod(event);
	const arrow = arrowEdge(event.key);

	// ── chords, before anything unmodified: `Cmd+A` must never read as the letter A, and no chord is text ──
	if (mod && !event.altKey) {
		switch (event.key) {
			case 'a':
			case 'A':
				return event.shiftKey ? null : { id: 'select-all' };
			case 'c':
			case 'C':
				return { id: 'clipboard', verb: 'copy' };
			case 'x':
			case 'X':
				return { id: 'clipboard', verb: 'cut' };
			case 'v':
			case 'V':
				return { id: 'clipboard', verb: 'paste' };
			case 'z':
			case 'Z':
				return { id: 'undo-redo', verb: event.shiftKey ? 'redo' : 'undo' };
			case 'y':
			case 'Y':
				// Both spellings of redo: the Mac's `Shift+Cmd+Z` and the `Ctrl+Y` every Windows application has.
				return { id: 'undo-redo', verb: 'redo' };
			case 'Enter':
				return { id: 'bulk-edit' };
			case 'd':
			case 'D':
				return event.shiftKey ? null : { id: 'fill', direction: 'down' };
			case 'Home':
				return {
					id: 'navigate-edges',
					edge: 'tableStart',
					extend: event.shiftKey,
					steps: 1,
				};
			case 'End':
				return { id: 'navigate-edges', edge: 'tableEnd', extend: event.shiftKey, steps: 1 };
			default:
				break;
		}
	}
	// `Ctrl+R` is the fourth fill binding and the least reliable one: the browser and Obsidian both claim it
	// (Chrome reloads; Obsidian's own "Reload app without saving" is `Ctrl+R`). It is answered here so a platform
	// where the key does reach the grid behaves as documented, and `Alt+R` — which no browser wants — is the
	// binding the help table leads with. Named in the report, not hidden in a comment.
	if (event.ctrlKey && !event.altKey && event.key === 'r') {
		return { id: 'fill', direction: 'right' };
	}
	if (event.altKey && !mod) {
		switch (event.key) {
			case 'd':
			case 'D':
				return { id: 'fill', direction: 'down' };
			case 'r':
			case 'R':
				return { id: 'fill', direction: 'right' };
			default:
				break;
		}
	}

	// ── the help key. Before the printable fallback, or `?` would start an edit instead of opening the help. ──
	if (event.key === 'F1' || event.key === '?') {
		return { id: 'help' };
	}

	// ── movement: the arrows move, the edge keys jump ────────────────────────────────────────────────────────
	if (arrow !== null) {
		return { id: 'move', edge: arrow, extend: event.shiftKey };
	}
	switch (event.key) {
		case 'PageUp':
			return {
				id: 'navigate-edges',
				edge: 'up',
				extend: event.shiftKey,
				steps: Math.max(1, context.pageRows),
			};
		case 'PageDown':
			return {
				id: 'navigate-edges',
				edge: 'down',
				extend: event.shiftKey,
				steps: Math.max(1, context.pageRows),
			};
		case 'Home':
			return { id: 'navigate-edges', edge: 'rowStart', extend: event.shiftKey, steps: 1 };
		case 'End':
			return { id: 'navigate-edges', edge: 'rowEnd', extend: event.shiftKey, steps: 1 };
		default:
			break;
	}

	// ── editing ─────────────────────────────────────────────────────────────────────────────────────────────
	switch (event.key) {
		case 'Enter':
			return { id: 'edit' };
		case 'F2':
			// The spreadsheet convention for "edit this cell", kept because hands that know Excel reach for it.
			return { id: 'edit' };
		case 'Tab':
			return { id: 'commit-tab', direction: event.shiftKey ? 'backward' : 'forward' };
		case 'Escape':
			return { id: 'escape' };
		case 'Delete':
		case 'Backspace':
			return { id: 'clear' };
		case ' ':
			return context.checkbox
				? { id: 'toggle-checkbox' }
				: { id: 'type-to-replace', text: ' ' };
		default:
			break;
	}

	if (isPrintable(event)) {
		return { id: 'type-to-replace', text: event.key };
	}
	return null;
}

/** What the listener needs: the context *right now*, and a way to run an intent. */
export type GridKeyboardOptions = {
	readonly context: () => KeyContext;
	/**
	 * Runs one intent and answers whether it was handled. `false` leaves the key alone — this is the single
	 * place the "`preventDefault` only where the action is handled" rule is enforced, so no handler can forget it.
	 */
	readonly dispatch: (intent: GridIntent) => boolean;
	/**
	 * Told about a commit key while an editor is open (`Enter`, `Tab`, `Shift+Tab`), so the grid can move the
	 * selection once the editor has finished. Called *before* the editor sees the key; the follow-up happens in
	 * the session's `onFinish`.
	 */
	readonly onCommitKey?: ((intent: GridIntent) => void) | undefined;
};

/** The cell the arrows and everything else act on is the *active* cell; the handler never guesses one. */
export type GridKeyboardAttachment = {
	/** Detaches the listener. One listener in, one out — the view's `dispose` calls this. */
	readonly detach: () => void;
};

/**
 * Attaches the one `keydown` listener to the grid root and returns its detach.
 *
 * The phase is `true` (capture) for the reason in the file header: the grid must see `Tab` and `Enter` *before*
 * an open editor consumes them, or the selection would never move after a commit. Everything the grid decides
 * to handle, it handles by `preventDefault`; everything else — including every key pressed while an editor is
 * open — passes through untouched.
 */
export function attachGridKeyboard(
	root: HTMLElement,
	options: GridKeyboardOptions,
): GridKeyboardAttachment {
	const onKeyDown = (event: KeyboardEvent): void => {
		const intent = resolveKey(event, options.context());
		if (intent === null) {
			return;
		}
		// The commit keys are the one intent that is *observed* rather than handled: an editor is open, its own
		// handler will commit or cancel, and only the follow-up move belongs to the grid.
		if (options.context().editing && isCommitKey(intent)) {
			options.onCommitKey?.(intent);
			return;
		}
		if (!options.dispatch(intent)) {
			return;
		}
		// Handled: take the key completely. `preventDefault` stops the browser's own meaning (the arrow that
		// scrolls, the space that pages), and `stopPropagation` stops a *newly mounted* surface from seeing the
		// very keystroke that opened it — `Enter` on a cell mounts an editor whose autofocused input would
		// otherwise receive the same event and commit the empty edit it had just been opened with. That is a real
		// bug found by `tests/dom/keyboard.test.tsx`, not a theoretical one.
		event.preventDefault();
		event.stopPropagation();
	};
	root.addEventListener('keydown', onKeyDown, true);
	return {
		detach: (): void => {
			root.removeEventListener('keydown', onKeyDown, true);
		},
	};
}

/** The keys whose meaning survives an open editor: they end the edit, and the grid decides where focus lands. */
export function isCommitKey(intent: GridIntent): boolean {
	return intent.id === 'commit-move';
}
