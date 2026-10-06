/**
 * The on-screen keyboard's arithmetic and its wiring: **the inset, the reveal, and the teardown.**
 *
 * `docs/04` §Keyboard and viewport names four forbidden techniques (percentage heights, a `ResizeObserver`
 * writing heights, `window.innerHeight` during layout, `height: 100%` chains) and one required shape: one CSS
 * variable from `visualViewport`, plus a reveal one frame after the inset settles. The forbidden four were
 * avoided by construction — this file cannot observe an absence, but it *can* pin the two numbers and the one
 * frame, which is what "the shape is right" means in practice.
 *
 * It lives under `tests/dom/**` because of this repository's boundary rule rather than because it needs a DOM:
 * `tests/unit/**` may import `core/` and `adapters/` only, and `src/grid/**` is a DOM-and-React surface. Nothing
 * here touches jsdom — the viewport, the host and the frame are all fakes — which is the point: the arithmetic is
 * testable without a browser, so it is tested without one.
 *
 * The case worth its own test is the one the historical bug produced: an 860 px host squeezed to 389 px with the
 * keyboard open left a **260 px** overlay (`harness/hosts.ts`, `phone-keyboard`). The inset is what makes the
 * grid's own content stop where the visible area stops, so "does the grid survive a squeezed host?" is, at this
 * layer, "is the number 260?".
 */
import { describe, expect, it } from 'vitest';

import {
	KEYBOARD_INSET_PROPERTY,
	createKeyboardInset,
	keyboardInsetOf,
} from '../../src/grid/keyboardInset';

/**
 * A viewport whose two numbers a test can move, as the browser's does.
 *
 * The type is written as a plain mutable shape rather than as `VisualViewportLike` plus an intersection: the real
 * interface declares `height` **readonly** (a browser only lets the platform set it), and a test that must move it
 * would otherwise need a type assertion — which this repository bans in tests too. A mutable object is still
 * assignable to the readonly port, so the production signature keeps its guarantee.
 */
type MutableViewport = {
	height: number;
	offsetTop: number;
	offsetLeft: number;
	addEventListener: (
		type: string,
		listener: () => void,
		options?: { readonly passive?: boolean },
	) => void;
	removeEventListener: (type: string, listener: () => void) => void;
	resize: () => void;
	emit: (type: 'resize' | 'scroll') => void;
	listeners: () => number;
};

function fakeViewport(input: {
	height: number;
	offsetTop?: number;
	offsetLeft?: number;
}): MutableViewport {
	const listeners = new Map<string, (() => void)[]>();
	const viewport = {
		height: input.height,
		offsetTop: input.offsetTop ?? 0,
		offsetLeft: input.offsetLeft ?? 0,
		addEventListener: (type: string, listener: () => void): void => {
			listeners.set(type, [...(listeners.get(type) ?? []), listener]);
		},
		removeEventListener: (type: string, listener: () => void): void => {
			listeners.set(
				type,
				(listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
			);
		},
		resize: (): void => {
			for (const listener of listeners.get('resize') ?? []) {
				listener();
			}
		},
		emit: (type: 'resize' | 'scroll'): void => {
			for (const listener of listeners.get(type) ?? []) {
				listener();
			}
		},
		listeners: (): number =>
			[...listeners.values()].reduce((total, list) => total + list.length, 0),
	};
	return viewport;
}

/** The host element's `style`, reduced to the one method the writer calls. */
function fakeHost(): {
	readonly values: Map<string, string>;
	setProperty: (name: string, value: string) => void;
} {
	const values = new Map<string, string>();
	return {
		values,
		setProperty: (name: string, value: string): void => {
			values.set(name, value);
		},
	};
}

describe('keyboardInsetOf', () => {
	it('is the window minus the visible viewport, and the pan is part of the answer', () => {
		// 844 px of window, 584 px of visible area: an iOS-level keyboard.
		expect(
			keyboardInsetOf({ windowHeight: 844, viewportHeight: 584, viewportOffsetTop: 0 }),
		).toBe(260);
		// The same keyboard with the page panned down 40 px covers 40 px less than that.
		expect(
			keyboardInsetOf({ windowHeight: 844, viewportHeight: 584, viewportOffsetTop: 40 }),
		).toBe(220);
	});

	it('never goes negative, because a browser mid-animation reports a viewport taller than the window', () => {
		expect(
			keyboardInsetOf({ windowHeight: 844, viewportHeight: 860, viewportOffsetTop: 0 }),
		).toBe(0);
		expect(
			keyboardInsetOf({ windowHeight: 844, viewportHeight: 584, viewportOffsetTop: 400 }),
		).toBe(0);
	});

	it('is a whole number of pixels', () => {
		// A fraction of a pixel in a padding is a sub-pixel wobble in every lane below it.
		expect(
			keyboardInsetOf({ windowHeight: 844.4, viewportHeight: 583.6, viewportOffsetTop: 0 }),
		).toBe(261);
	});
});

describe('the wiring', () => {
	it('writes one token on the host, and only that token', () => {
		const host = fakeHost();
		const viewport = fakeViewport({ height: 584 });
		const frames: (() => void)[] = [];
		const inbox = createKeyboardInset({
			host,
			window: { innerHeight: 844 },
			viewport,
			reveal: () => undefined,
			frame: (callback) => {
				frames.push(callback);
			},
		});
		inbox.start();
		expect(host.values.size).toBe(1);
		expect(host.values.get(KEYBOARD_INSET_PROPERTY)).toBe('260px');

		// The keyboard closes: the token goes to zero and no other property is ever touched.
		viewport.height = 844;
		viewport.resize();
		expect(host.values.get(KEYBOARD_INSET_PROPERTY)).toBe('0px');
		expect([...host.values.keys()]).toEqual([KEYBOARD_INSET_PROPERTY]);
	});

	it('reveals one frame later, once per settle, and clears the token on stop', () => {
		const host = fakeHost();
		const viewport = fakeViewport({ height: 584 });
		const frames: (() => void)[] = [];
		let reveals = 0;
		const inbox = createKeyboardInset({
			host,
			window: { innerHeight: 844 },
			viewport,
			reveal: () => {
				reveals += 1;
			},
			frame: (callback) => {
				frames.push(callback);
			},
		});
		inbox.start();
		// Nothing has been revealed yet: the reveal waits for the frame the doc asks for.
		expect(reveals).toBe(0);
		expect(frames).toHaveLength(1);
		frames[0]?.();
		expect(reveals).toBe(1);

		// Every later change settles the same way — one frame each, never a queue of them.
		viewport.height = 600;
		viewport.emit('scroll');
		expect(host.values.get(KEYBOARD_INSET_PROPERTY)).toBe('244px');
		expect(frames).toHaveLength(2);
		for (const frame of frames) {
			frame();
		}
		// Three in total: the first settle, and the two events this test emitted.
		expect(reveals).toBe(3);

		inbox.stop();
		expect(host.values.get(KEYBOARD_INSET_PROPERTY)).toBe('0px');
		expect(viewport.listeners()).toBe(0);
		// A stopped writer ignores the events the browser may still deliver.
		viewport.resize();
		expect(host.values.get(KEYBOARD_INSET_PROPERTY)).toBe('0px');
		expect(frames).toHaveLength(2);
	});

	it('does nothing at all when the platform has no visualViewport', () => {
		const host = fakeHost();
		const inbox = createKeyboardInset({
			host,
			window: { innerHeight: 844 },
			viewport: null,
			reveal: () => undefined,
			frame: () => undefined,
		});
		expect(inbox.start()).toBeUndefined();
		// Zero, not `NaN`: a missing viewport is "no keyboard", which is the desktop case.
		expect(host.values.get(KEYBOARD_INSET_PROPERTY)).toBe('0px');
		expect(inbox.sync()).toBe(0);
	});
});
