/**
 * The five host fixtures — the harness's *simulation of Obsidian*, one named wrapper per viewport.
 *
 * `docs/04` §the viewport matrix fixes the sizes and says why each one exists. This file turns that table into
 * numbers a page can lay out, and every number here is a claim about the **host**, never about the plugin:
 *
 *   · **The host is a phone/window frame**, not a div with a size. It has a status bar and a title bar whose
 *     heights are subtracted from the pane, because "the root fills its host" only means something if the host
 *     is something a plugin would actually be mounted into.
 *   · **`pad` is padding on the mount point.** Obsidian leaves a few pixels of leaf padding around a view on
 *     desktop; the assertion is that `.tablify-root` fills that **padding box** exactly, so the fixture has to
 *     have one. A fixture with `pad: 0` would pass the assertion vacuously.
 *   · **`phone-keyboard` is the historical failure**: the app shell is compressed to **389 px**, one pixel
 *     narrower than the phone it is on. The keyboard is simulated the way the platform reports it — as an
 *     overlay at the bottom of the visual viewport *plus* the inset the view writes into
 *     `--tablify-keyboard-inset` from `visualViewport` (`docs/04` §Keyboard and viewport). The pane keeps its
 *     full height and the grid subtracts the inset; that is the mechanism under test, so simulating it by
 *     shrinking the pane would test nothing.
 *   · **The theme is a class on `body`**, which is where Obsidian puts `theme-dark` / `theme-light`. The stub
 *     theme stylesheet in `harness/obsidian-stub.css` declares the host variables under those exact selectors.
 *
 * `touch` is not decoration: the phone and tablet fixtures enable it, so `@media (pointer: coarse)` — the rule
 * that decides whether Obsidian's own tap-target sizing applies — matches the way it would on the device. A
 * desktop with a mouse must not get 44 px toolbar buttons because a *test* said "phone".
 */
export type HostId = 'desktop' | 'desktop-dark' | 'phone-closed' | 'phone-keyboard' | 'tablet';

/** One bar of the simulated chrome. `overlay` bars float above the pane (the on-screen keyboard). */
export type ChromeBar = {
	/** A class suffix, so the stub stylesheet owns every colour and radius the chrome has. */
	readonly kind: 'status' | 'title' | 'keyboard' | 'tab';
	/** Height in CSS px. */
	readonly h: number;
	/** What a person sees, so a screenshot can be read without the source. */
	readonly text: string;
	/** Drawn over the pane instead of above it. */
	readonly overlay?: boolean;
};

export type HostFixture = {
	readonly id: HostId;
	readonly label: string;
	/** The host's outer size: what the Playwright project's viewport is set to. */
	readonly width: number;
	readonly height: number;
	readonly theme: 'theme-dark' | 'theme-light';
	/** Coarse pointer emulation, i.e. `@media (pointer: coarse)` matches. */
	readonly touch: boolean;
	/** Padding on the mount point, in CSS px. */
	readonly pad: number;
	/**
	 * Border on the mount point, in CSS px. Not decoration: an absolutely positioned child fills its
	 * containing block's **padding box**, which is the border box *minus the borders* — so a fixture with no
	 * border would make `inset: 0` agree with the border box and the assertion would be about arithmetic
	 * nobody disputes. One hairline makes "fills the padding box" a claim with a wrong answer available.
	 */
	readonly border: number;
	readonly bars: readonly ChromeBar[];
	/** What the view would write into `--tablify-keyboard-inset`, in CSS px. */
	readonly inset: number;
	/** One line for the report and for `window.__harness.host`. */
	readonly notes: string;
};

const STATUS_BAR: ChromeBar = { kind: 'status', h: 28, text: '▮▮▮▮ 5G  ⌁ 82%' };
const PHONE_TITLE: ChromeBar = { kind: 'title', h: 36, text: 'Tasks — Tablify' };
const TABLET_TITLE: ChromeBar = { kind: 'tab', h: 44, text: 'Tasks — Tablify' };
const KEYBOARD: ChromeBar = {
	kind: 'keyboard',
	h: 260,
	text: 'q w e r t y u i o p · a s d f g h j k l · ⇧ z x c v b n m ⌫ · space · return',
	overlay: true,
};

/**
 * The matrix. `desktop` is the doc's 1440 × 900; the prompt's own viewport list also names a **1280 × 800**
 * desktop and a `desktop-dark` that shares the desktop frame — the doc's rule is that dark is *the same
 * screen, other theme*, so `desktop-dark` is the desktop frame with the dark class rather than a second size.
 */
export const HOSTS: Record<HostId, HostFixture> = {
	desktop: {
		id: 'desktop',
		label: 'Desktop — 1440 × 900',
		width: 1440,
		height: 900,
		theme: 'theme-light',
		touch: false,
		pad: 8,
		border: 1,
		bars: [],
		inset: 0,
		notes: 'The default theme; the frozen primary column is pinned at this pane width.',
	},
	'desktop-dark': {
		id: 'desktop-dark',
		label: 'Desktop, dark — 1440 × 900',
		width: 1440,
		height: 900,
		theme: 'theme-dark',
		touch: false,
		pad: 8,
		border: 1,
		bars: [],
		inset: 0,
		notes: 'The same screen in the dark palette: the identity colours must be legible, not inverted.  ',
	},
	'phone-closed': {
		id: 'phone-closed',
		label: 'Phone — 390 × 844, keyboard closed',
		width: 390,
		height: 844,
		theme: 'theme-light',
		touch: true,
		pad: 0,
		border: 1,
		bars: [STATUS_BAR, PHONE_TITLE],
		inset: 0,
		notes: 'Narrow pane: nothing is pinned, the gutter lives in the scrolling lane, targets are tap-sized.',
	},
	'phone-keyboard': {
		id: 'phone-keyboard',
		label: 'Phone — host squeezed to 389 px, keyboard open',
		width: 389,
		height: 844,
		theme: 'theme-light',
		touch: true,
		pad: 0,
		border: 1,
		bars: [STATUS_BAR, PHONE_TITLE, KEYBOARD],
		inset: KEYBOARD.h,
		notes: 'The historical failure: one pixel narrower, keyboard open, and the grid must not collapse.',
	},
	tablet: {
		id: 'tablet',
		label: 'Tablet — 834 × 1112',
		width: 834,
		height: 1112,
		theme: 'theme-light',
		touch: true,
		pad: 6,
		border: 1,
		bars: [TABLET_TITLE],
		inset: 0,
		notes: 'Wide enough to pin, still a touch device: pinning and tap targets must both hold.',
	},
};

/** The order the report lists them in: widest first, phone-keyboard last — the run order the doc uses. */
export const HOST_ORDER: readonly HostId[] = [
	'desktop',
	'desktop-dark',
	'phone-closed',
	'phone-keyboard',
	'tablet',
];

/** The pane the plugin is mounted into, in CSS px: what is left of the host after its chrome. */
export function paneSizeOf(host: HostFixture): { readonly width: number; readonly height: number } {
	const chrome = host.bars.reduce((sum, bar) => (bar.overlay === true ? sum : sum + bar.h), 0);
	return {
		width: host.width - host.border * 2,
		height: host.height - chrome - host.border * 2,
	};
}
