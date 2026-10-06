/**
 * The measurement layer, and the reason it is the **only** place numbers come off the DOM.
 *
 * `docs/04` §The layout contract forbids every mechanism that lets a grid negotiate its own height —
 * percentage chains, `100vh`, a `ResizeObserver` writing a height custom property, `window.innerHeight` during
 * layout — so what is left has to be *read*, honestly and rarely. Three reads exist, and this file pins the
 * contract of each:
 *
 *  · `readPxToken`/`readHeaderHeight` — the header band's height comes from `tokens.css`, where the contrast
 *    gate and the CSS gate can see it, and never from a second hard-coded number in the renderer. A token
 *    that does not resolve falls back, it does not throw and it does not produce `NaN`.
 *  · `paneWidthOf` — **the padding box**, `clientWidth`. That is the width §P21 is about ("the trigger is pane
 *    width, not device"), and it is the box `.tablify-root` fills, so the pinning decision and the drawing
 *    agree by construction. A pane with no width answers 0, and 0 means *no answer yet*: the caller keeps the
 *    measurement it was handed rather than unpinning a wide pane on a frame that has not been laid out.
 *  · `rowBandHeightOf` — the band rows may draw in, floored at 0 so an unmeasured pane windows to one row
 *    instead of a negative viewport.
 *
 * jsdom has no layout: `clientWidth`/`clientHeight` are 0 unless a test defines them, and these tests define
 * them explicitly. That is deliberate — the properties are the interface, and stubbing the interface is what
 * keeps this a test of *our* contract rather than of jsdom's CSS engine. The browser-truth version of the same
 * numbers (the real Obsidian host, at 900 / 600 / 389 px) is step 21's harness, on purpose.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
	clampColumnWidth,
	columnWidthOf,
	DEFAULT_COLUMN_WIDTH,
	FALLBACK_HEADER_HEIGHT,
	COLUMN_MAX_WIDTH,
	COLUMN_MIN_WIDTH,
	NARROW_PANE_PX,
	pinnedPrimary,
	resolvePresentation,
} from '../../src/grid/layout';
import {
	paneWidthOf,
	readHeaderHeight,
	readPxToken,
	rowBandHeightOf,
} from '../../src/grid/measure';

/**
 * An element whose measured box the test decides: the properties `measure.ts` reads, and nothing else.
 *
 * It is `document.body` itself rather than a fresh div — not for convenience, but because the two alternatives
 * the lint rules leave are worse: `createElement` is banned in favour of Obsidian's `createDiv()` (which jsdom
 * does not have), and a `<style>` element may not be created by a DOM test at all. Defining the two measured
 * properties on the body is the same statement about the same interface, made once per test and removed again.
 */
function box(clientWidth: number, clientHeight = 0): HTMLElement {
	Object.defineProperty(document.body, 'clientWidth', { value: clientWidth, configurable: true });
	Object.defineProperty(document.body, 'clientHeight', {
		value: clientHeight,
		configurable: true,
	});
	return document.body;
}

afterEach(() => {
	// The body outlives the test file, so the stubs are removed with the same key they were defined with.
	Reflect.deleteProperty(document.body, 'clientWidth');
	Reflect.deleteProperty(document.body, 'clientHeight');
	document.body.removeAttribute('style');
});

describe('readPxToken', () => {
	/**
	 * The *parsing* half of the contract, with the declaration supplied through the one call the function makes.
	 *
	 * Two constraints meet here and neither can be argued away: a DOM test may not set a style inline
	 * (Obsidian's own guideline, enforced by the repo's lint gate), and jsdom resolves custom properties only
	 * from inline style — never from a stylesheet, which is where `--tablify-header-h` actually lives. So the
	 * value is supplied by replacing `getComputedStyle` for the duration of the test, which is the same move as
	 * the `clientWidth` stub above: the *interface* is what this function's contract is written against, and the
	 * interface is what the test supplies. Every branch of the real function runs — trim, parse, `isFinite`,
	 * fallback — with the values a real `tokens.css` would produce.
	 */
	it('parses a resolved token — units, whitespace and all — and falls back on anything else', () => {
		const real = window.getComputedStyle.bind(window);
		const supply = (value: string): void => {
			Object.defineProperty(window, 'getComputedStyle', {
				value: () => ({ getPropertyValue: () => value }),
				configurable: true,
				writable: true,
			});
		};

		try {
			supply('  52px  ');
			expect(readPxToken(document.body, '--tablify-header-h', FALLBACK_HEADER_HEIGHT)).toBe(
				52,
			);
			expect(readHeaderHeight(document.body)).toBe(52);

			supply('40px');
			expect(readHeaderHeight(document.body)).toBe(40);

			// A keyword, an empty answer and a function are all "no number here": the fallback, never NaN.
			for (const unusable of ['auto', '', 'calc(1px + 1px)']) {
				supply(unusable);
				expect(readHeaderHeight(document.body)).toBe(FALLBACK_HEADER_HEIGHT);
			}
		} finally {
			Object.defineProperty(window, 'getComputedStyle', {
				value: real,
				configurable: true,
				writable: true,
			});
		}
	});

	it('falls back — rather than throwing or returning NaN — when the token is absent', () => {
		expect(readHeaderHeight(document.body)).toBe(FALLBACK_HEADER_HEIGHT);
		expect(readPxToken(null, '--tablify-header-h', FALLBACK_HEADER_HEIGHT)).toBe(
			FALLBACK_HEADER_HEIGHT,
		);
		expect(readPxToken(document.body, '--tablify-not-a-token', FALLBACK_HEADER_HEIGHT)).toBe(
			FALLBACK_HEADER_HEIGHT,
		);
	});
});

describe('paneWidthOf', () => {
	it('is the padding box, which is the width §P21 is about', () => {
		expect(paneWidthOf(box(900))).toBe(900);
		expect(paneWidthOf(box(600))).toBe(600);
		expect(paneWidthOf(box(389))).toBe(389);
	});

	it('answers 0 — not a negative number and not an exception — for a pane with no box', () => {
		expect(paneWidthOf(null)).toBe(0);
		expect(paneWidthOf(box(0))).toBe(0);
	});
});

describe('rowBandHeightOf', () => {
	it('subtracts the header band the rows slide under, and floors at zero', () => {
		expect(rowBandHeightOf(box(900, 640), 40)).toBe(600);
		expect(rowBandHeightOf(box(900, 20), 40)).toBe(0);
		expect(rowBandHeightOf(null, 40)).toBe(0);
	});
});

describe('pinnedPrimary', () => {
	it('is the pane’s answer at 900 / 600 / 389 px, and the device is never asked', () => {
		expect(pinnedPrimary(true, 900)).toBe(true);
		expect(pinnedPrimary(true, NARROW_PANE_PX)).toBe(true);
		expect(pinnedPrimary(true, NARROW_PANE_PX - 1)).toBe(false);
		expect(pinnedPrimary(true, 389)).toBe(false);
	});

	it('never pins against the user’s wish, however wide the pane', () => {
		expect(pinnedPrimary(false, 3_000)).toBe(false);
	});
});

describe('column widths', () => {
	it('clamps what a `.base` sidecar carried from somewhere else', () => {
		expect(clampColumnWidth(160)).toBe(160);
		expect(clampColumnWidth(10)).toBe(COLUMN_MIN_WIDTH);
		expect(clampColumnWidth(4_000)).toBe(COLUMN_MAX_WIDTH);
	});

	it('uses the default for a column the user has never resized', () => {
		expect(columnWidthOf(null, DEFAULT_COLUMN_WIDTH)).toBe(DEFAULT_COLUMN_WIDTH);
		expect(columnWidthOf(undefined, DEFAULT_COLUMN_WIDTH)).toBe(DEFAULT_COLUMN_WIDTH);
		expect(columnWidthOf(Number.NaN, DEFAULT_COLUMN_WIDTH)).toBe(DEFAULT_COLUMN_WIDTH);
		expect(columnWidthOf(212, DEFAULT_COLUMN_WIDTH)).toBe(212);
	});
});

describe('resolvePresentation', () => {
	it('fills in the defaults and maps a density name to a row height', () => {
		expect(resolvePresentation(undefined)).toEqual({
			density: 'medium',
			rowHeight: 40,
			frozenPrimary: true,
			defaultColumnWidth: DEFAULT_COLUMN_WIDTH,
		});
		expect(resolvePresentation({ density: 'short' }).rowHeight).toBe(32);
		expect(resolvePresentation({ density: 'tall' }).rowHeight).toBe(64);
	});

	it('lets a density name win over a raw row height, because two sources for one number drift', () => {
		expect(resolvePresentation({ density: 'tall', rowHeight: 40 }).rowHeight).toBe(64);
		expect(resolvePresentation({ rowHeight: 44 }).rowHeight).toBe(44);
	});
});
