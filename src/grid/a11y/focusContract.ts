/**
 * The focus contract: **every surface the plugin opens gives focus back to whatever opened it — but only if
 * focus was actually lost.**
 *
 * That second clause is the whole design, and it is worth spelling out because the naive version (restore on
 * close, always) is a bug people blame on their keyboard rather than on the plugin. The sequence that exposes it
 * is ordinary: a cell menu is open, the user picks "Edit field…", a dialog opens on top, and the menu closes
 * behind it. If the menu's close handler restores focus to the cell it was opened from, it has just yanked the
 * keyboard out of the dialog the user is now typing in. So the rule is:
 *
 *   · focus is **inside the closing surface** (or gone to nowhere: `<body>`, `document.documentElement`) ⇒ the
 *     surface is what lost it, and the opener gets it back;
 *   · focus is **anywhere else** ⇒ somebody else owns the keyboard now (a nested surface, or a real click
 *     somewhere else). Leave it alone and answer `'kept'`.
 *
 * Surfaces come in four kinds ({@link SURFACE_KINDS}) and they do not all belong to us: three of them are
 * Obsidian's own `Menu`/`Modal`, which arrive with a focus trap, Escape and a restore of their own. The contract
 * is written so that is **harmless** — when the host has already put focus back, this module sees focus outside
 * the closing container and does nothing. One rule, two owners, no double focus restore to argue about.
 *
 * Escape is a per-surface binding, never a global listener (`src/grid/keyboard/handler.ts` states the rule for
 * the grid; it holds here too). Each surface receives Escape in its own scope and closes **itself**; a surface
 * closing can therefore never close the one on top of it. {@link ESCAPE_OWNER} records who owns the key for each
 * kind, and the tests hold the two lists together so a new surface cannot arrive without an answer.
 */

/** The surfaces this plugin opens. Three of the four are the host's own, which is why they get no code here. */
export type SurfaceKind = 'grid-popover' | 'menu' | 'dialog' | 'help';

/** A surface that has taken the keyboard, with the element it lives in and the element to give it back to. */
export type FocusSurface = {
	readonly kind: SurfaceKind;
	/** The surface's root element, or `null` when the host does not expose one. */
	readonly container: Element | null;
	/** What had focus when the surface opened. `null` when nothing did. */
	readonly opener: HTMLElement | null;
};

/** What closing a surface did with focus. Returned rather than assumed, so a test can assert the rule. */
export type CloseOutcome =
	/** Focus was lost with the surface and went back to the opener. */
	| 'restored'
	/** Focus was lost and the opener is no longer in the document: there is nowhere to put it. */
	| 'lost'
	/** Focus was never the surface's to give back: someone else has it. */
	| 'kept';

/** The document's active element, when it is an element a person can be typing into. */
export function openerOf(doc: Document): HTMLElement | null {
	const active = doc.activeElement;
	if (active === null || active === doc.body || active === doc.documentElement) {
		return null;
	}
	return isFocusable(active) ? active : null;
}

/**
 * Whether an element can be given focus: a property test rather than `instanceof`.
 *
 * The grid may not import `obsidian` (`tests/unit/boundaries.test.ts` and the lint config both insist), so the
 * host's cross-window-safe `instanceOf()` helper is not available here — and "has a `focus` method" is precisely
 * what this caller needs to know, which makes the property test the more honest of the two.
 */
function isFocusable(node: Element): node is HTMLElement {
	return 'focus' in node && typeof node['focus'] === 'function';
}

/** The open surfaces, innermost last. Kept so {@link topSurface} can answer "what is on top". */
const open: FocusSurface[] = [];

/** Records a surface as open. Call it **before** the surface takes focus. */
export function openSurface(
	kind: SurfaceKind,
	container: Element | null,
	opener: HTMLElement | null,
): FocusSurface {
	const surface: FocusSurface = { kind, container, opener };
	open.push(surface);
	return surface;
}

/**
 * Closes a surface and applies the rule in the header. Identity-based, so closing the same surface twice is a
 * no-op rather than a second focus restore.
 */
export function closeSurface(surface: FocusSurface): CloseOutcome {
	const at = open.indexOf(surface);
	if (at === -1) {
		return 'kept';
	}
	open.splice(at, 1);

	const doc = surface.container?.ownerDocument ?? surface.opener?.ownerDocument ?? null;
	if (doc === null) {
		return 'kept';
	}
	const active = doc.activeElement;
	const lostToNowhere = active === null || active === doc.body || active === doc.documentElement;
	if (!lostToNowhere && !holds(surface.container, active)) {
		return 'kept';
	}
	const opener = surface.opener;
	if (opener === null || !opener.isConnected) {
		return 'lost';
	}
	opener.focus({ preventScroll: true });
	return 'restored';
}

/**
 * Whether a container holds the focused element — "did this surface have the keyboard?".
 *
 * The `typeof` guard is not paranoia: a surface may be a host facility whose element is a *double* in a test
 * (`tests/mocks/obsidian.ts` builds modals out of plain objects with no DOM methods at all), and the same guard
 * pattern is used in `TablifyView` for an app member the double does not implement. A container that cannot
 * answer is treated as "not holding focus", which is the conservative answer: it can only ever skip a restore,
 * never steal focus from something newer.
 */
function holds(container: Element | null, node: Element | null): boolean {
	if (container === null || node === null) {
		return false;
	}
	if (typeof container.contains !== 'function') {
		return false;
	}
	return container.contains(node);
}

/** The surface on top, or `null`. Meaningful for Escape: only the top one closes. */
export function topSurface(): FocusSurface | null {
	return open.at(-1) ?? null;
}

/** Whether anything is open. The grid asks before it acts on a key that means something outside itself. */
export function hasOpenSurface(): boolean {
	return open.length > 0;
}

/** Everything a test needs to start from a clean sheet; the product never needs this. */
export function resetSurfaces(): void {
	open.splice(0, open.length);
}

/** Who owns `Escape` for each kind, and why. Data, so the report and the tests read the same answer. */
export type EscapeOwner = {
	readonly surface: SurfaceKind;
	/** The module (or host facility) that receives the key, with the file it lives in. */
	readonly owner: string;
	/** What one press does. */
	readonly effect: string;
};

export const ESCAPE_OWNER: readonly EscapeOwner[] = [
	{
		surface: 'grid-popover',
		owner: 'src/grid/editors/useEditorKeys.ts, which routes Escape through `editSession.escape()`',
		effect: 'Closes an open option list first; only the next press cancels the editor and returns focus.',
	},
	{
		surface: 'menu',
		owner: "Obsidian's own `Menu` (scoped key handler), opened by step 20",
		effect: 'Closes the menu; the opener keeps focus, which is the same rule this module applies.',
	},
	{
		surface: 'dialog',
		owner: "Obsidian's own `Modal` (scoped key handler), used by the conflict and import dialogs",
		effect: 'Closes the dialog and traps focus while it is open, so a lower surface never sees the key.',
	},
	{
		surface: 'help',
		owner: 'src/plugin/help/KeyboardHelpModal.ts (an Obsidian `Modal`)',
		effect: 'Closes the help surface and returns focus to whatever opened it.',
	},
];

/** The kinds, in one list, so `ESCAPE_OWNER` cannot quietly miss one. */
export const SURFACE_KINDS: readonly SurfaceKind[] = ['grid-popover', 'menu', 'dialog', 'help'];
