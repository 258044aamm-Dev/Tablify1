/**
 * The grid's presentation numbers, and the one rule that decides pinning.
 *
 * Two of these are worth arguing about, and both arguments are already settled in the docs:
 *
 *  - **`NARROW_PANE_PX = 600`** is `docs/08` §P21: pinning is a wide-pane affordance, never a mobile
 *    one. The trigger is the width of the **pane the view owns**, not the device and not the window —
 *    a 900 px desktop with a 420 px sidebar has a narrow pane and must not pin. That is why the value is
 *    measured on the grid area (see `usePinnedPrimary.ts`) and why no media query appears in the CSS.
 *  - **`defaultColumnWidth = 160`** is the width a column takes until the user drags it. `FieldState.width`
 *    is `null` in that state (the core's own words: "the grid decides"), so the decision lives here, once.
 *
 * The clamp matters more than it looks: a `.base` sidecar is a text file a user can edit and a plugin can
 * write, so a stored width of `3` or `90000` is reachable. Clamping on the way *in* means every consumer —
 * the header, the resize handle, the fill maths in step 22 — can trust the number it is handed.
 */
import type { RowDensity } from './store/window';

/** Below this many pixels of pane, nothing is pinned (`docs/08` §P21, `docs/04` §the viewport matrix). */
export const NARROW_PANE_PX = 600;

/** The width of a column nobody has resized. */
export const DEFAULT_COLUMN_WIDTH = 160;

/** The narrowest a column may be dragged: narrower than this and the header text is unreadable. */
export const COLUMN_MIN_WIDTH = 64;

/** The widest a column may be dragged, and the cap on a width that arrives from a sidecar. */
export const COLUMN_MAX_WIDTH = 900;

/**
 * The header band's height when the token cannot be read. `--tablify-header-h` is the real source (it is
 * in `tokens.css` where the contrast gate can see it); this is only the fallback for a DOM-less
 * measurement — a jsdom test, or the instant before the first paint.
 */
export const FALLBACK_HEADER_HEIGHT = 40;

/** Everything the renderer needs that is not data: how tall a row is, and whether pinning is even wanted. */
export type GridPresentation = {
	readonly density: RowDensity;
	/** Derived from `density` once, so no component indexes the height table itself. */
	readonly rowHeight: number;
	/** The user's *wish*. Whether it happens also depends on the pane: see `pinnedPrimary`. */
	readonly frozenPrimary: boolean;
	readonly defaultColumnWidth: number;
};

/**
 * The presentation with its defaults filled in. `density` wins over `rowHeight` when both arrive, because a
 * density name is what a `.base` file stores and two sources for one number is exactly the drift this
 * repository keeps finding.
 */
export function resolvePresentation(
	patch: Partial<GridPresentation> | undefined,
): GridPresentation {
	const rowHeights: Record<RowDensity, number> = { short: 32, medium: 40, tall: 64 };
	const density: RowDensity =
		patch?.density === 'short' || patch?.density === 'tall' ? patch.density : 'medium';
	const rowHeight =
		patch?.density === undefined && typeof patch?.rowHeight === 'number'
			? patch.rowHeight
			: rowHeights[density];
	return {
		density,
		rowHeight,
		frozenPrimary: patch?.frozenPrimary ?? true,
		defaultColumnWidth: patch?.defaultColumnWidth ?? DEFAULT_COLUMN_WIDTH,
	};
}

/**
 * The rule, in one line: the user asked for it **and** the pane is wide enough.
 *
 * It is a pure function of two numbers so the harness can assert the boundary at 599/600 px without
 * mounting anything, and so every consumer — the frozen lane, the corner, the View dialog's freeze row —
 * reads the same answer. "The freeze option is absent below the threshold" is implemented by asking this
 * function, not by hiding a control after the fact.
 */
export function pinnedPrimary(desired: boolean, paneWidth: number): boolean {
	return desired && paneWidth >= NARROW_PANE_PX;
}

/** A stored width, through the clamp, with the default for `null`/garbage. */
export function columnWidthOf(stored: number | null | undefined, fallback: number): number {
	if (stored === null || stored === undefined || !Number.isFinite(stored)) {
		return clampColumnWidth(fallback);
	}
	return clampColumnWidth(stored);
}

/** The clamp on its own: the resize drag in step 20 has a live number and must not round-trip through null. */
export function clampColumnWidth(width: number): number {
	return Math.min(COLUMN_MAX_WIDTH, Math.max(COLUMN_MIN_WIDTH, Math.round(width)));
}
