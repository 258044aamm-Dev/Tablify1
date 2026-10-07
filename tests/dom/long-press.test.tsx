/**
 * Long-press: the touch path to the context menu, in two layers — the session's own rules, and the grid wearing it.
 *
 * The gesture is 40 lines (`src/grid/pointer/longPress.ts`), so the risk is not that it is hard to read: it is that
 * the *rules* are easy to state and easy to get subtly wrong, and that a bug in any one of them is invisible until
 * somebody is holding a phone. Each rule therefore has its own test, and the tests are named after the rule:
 *
 *  · a **mouse never long-presses** — a 500 ms hold with a mouse means "I am thinking", not "show me a menu";
 *  · a **move past the slop cancels** — the same 8 px the touch drag threshold uses (`TOUCH_DRAG_THRESHOLD_PX`), so
 *    a scroll and a long press cannot disagree about what "the finger moved" means. Exactly 8 px still counts: the
 *    rule is `> slop`, and a boundary nobody asserts is a boundary that drifts;
 *  · it **fires while the finger is still down** (`docs/04` §Touch: *"with visual feedback before opening"*) and
 *    `end()` reports whether it did, so a caller with a click-to-act path can swallow that release;
 *  · **every exit clears the feedback** — fire, move, cancel, lift. A press that leaked its timer would open a menu
 *    500 ms after an unrelated scroll, and a press that leaked its attribute would leave a cell painted forever.
 *
 * The second layer mounts the real `GridView` and does it with real events and real React, because the session
 * being correct says nothing about whether anybody calls it: this is where "a touch press on a cell opens the cell
 * menu 500 ms later, a header does not (it already opens on release), and a mouse press does not" is a fact about
 * the product rather than about a module. The menus are the `obsidian` double's (`openedMenus`), which is the same
 * `Menu` the grid builds in Obsidian.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GridView } from '../../src/grid/GridView';
import { createGridStore } from '../../src/grid/store/store';
import {
	LONG_PRESS_MS,
	LONG_PRESS_SLOP_PX,
	createLongPressSession,
} from '../../src/grid/pointer/longPress';
import { TOUCH_DRAG_THRESHOLD_PX } from '../../src/grid/pointer/dragSession';
import { resolveField } from '../../src/core/schema/propertySchema';
import { createFakeRowSource } from '../fakes/rowSource';
import { openedMenus, resetMenus } from '../mocks/obsidian';
import type { CellValue, FieldContext } from '../../src/core/types';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import type { GridStore } from '../../src/grid/store/types';
import type { LongPressSession } from '../../src/grid/pointer/longPress';

Object.assign(window, { IS_REACT_ACT_ENVIRONMENT: true });

/* ── the session, on its own ──────────────────────────────────────────────────────────────────────────── */

/** A clock the test owns: `advance()` runs whatever the session scheduled, exactly once. */
function makeClock(): {
	readonly setTimer: (callback: () => void, ms: number) => number;
	readonly clearTimer: (handle: number) => void;
	readonly advance: () => void;
	readonly pending: () => number;
	readonly delays: number[];
} {
	let next = 1;
	const timers = new Map<number, () => void>();
	const delays: number[] = [];
	return {
		delays,
		setTimer: (callback, ms) => {
			delays.push(ms);
			const handle = next;
			next += 1;
			timers.set(handle, callback);
			return handle;
		},
		clearTimer: (handle) => {
			timers.delete(handle);
		},
		advance: () => {
			for (const callback of [...timers.values()]) {
				timers.clear();
				callback();
			}
		},
		pending: () => timers.size,
	};
}

type TouchInit = {
	readonly pointerType?: string;
	readonly button?: number;
	readonly isPrimary?: boolean;
	readonly x?: number;
	readonly y?: number;
};

/**
 * A `pointerdown` the way a phone sends one — built, not dispatched, so both layers can use it: the session tests
 * hand it to `begin` after a dispatch (`pressOn`), and the grid tests dispatch it themselves inside `act`.
 *
 * `PointerEvent` where the platform has it, and a plain `MouseEvent` where it does not — which is why the
 * session's `begin` takes the event and its trigger hands the event back typed as `MouseEvent`: the narrowest
 * type that carries a position is the one a test can always produce.
 *
 * The target is only set by a dispatch, which is why the session tests must dispatch before calling `begin`: an
 * event that was never dispatched has `target === null`, and the session — correctly — refuses to watch a press
 * that did not land on an element.
 */
function press(init: TouchInit = {}): PointerEvent {
	return new PointerEvent('pointerdown', {
		bubbles: true,
		cancelable: true,
		pointerType: init.pointerType ?? 'touch',
		button: init.button ?? 0,
		isPrimary: init.isPrimary ?? true,
		clientX: init.x ?? 100,
		clientY: init.y ?? 200,
	});
}

/** A press that has landed: dispatched on `target` (so `event.target` is it), then handed back to the caller. */
function pressOn(target: Element, init: TouchInit = {}): PointerEvent {
	const event = press(init);
	target.dispatchEvent(event);
	return event;
}

type Recorded = {
	readonly session: LongPressSession;
	readonly clock: ReturnType<typeof makeClock>;
	readonly triggers: { x: number; y: number; target: Element }[];
	readonly feedback: boolean[];
};

/** One session over a throwaway element, with every port recorded. */
function sessionWith(): Recorded {
	const clock = makeClock();
	const triggers: { x: number; y: number; target: Element }[] = [];
	const feedback: boolean[] = [];
	const session = createLongPressSession(
		{
			onPressChange: (pressed) => feedback.push(pressed),
			onTrigger: (trigger) =>
				triggers.push({ x: trigger.point.x, y: trigger.point.y, target: trigger.target }),
		},
		{ setTimer: clock.setTimer, clearTimer: clock.clearTimer },
	);
	return { session, clock, triggers, feedback };
}

function targetElement(): Element {
	const element = document.createElement('div');
	element.className = 'cell';
	document.body.append(element);
	return element;
}

afterEach(() => {
	document.body.replaceChildren();
	resetMenus();
	vi.useRealTimers();
});

describe('the long-press session', () => {
	it('arms on a touch, not on a mouse, and fires once while the finger is still down', () => {
		const { session, clock, triggers, feedback } = sessionWith();
		const element = targetElement();

		// A mouse is not this gesture — the caller must leave the event alone, and nothing is scheduled.
		expect(session.begin(pressOn(element, { pointerType: 'mouse' }))).toBe(false);
		expect(session.pending()).toBe(false);
		expect(clock.delays).toEqual([]);
		clock.advance();
		expect(triggers).toEqual([]);

		// A finger is: the press arms, the feedback goes on, and the timer is the documented 500 ms.
		expect(session.begin(pressOn(element, { pointerType: 'touch', x: 12, y: 34 }))).toBe(true);
		expect(session.pending()).toBe(true);
		expect(feedback).toEqual([true]);
		expect(clock.delays).toEqual([LONG_PRESS_MS]);
		expect(LONG_PRESS_MS).toBe(500);

		// The hold counts **before** the lift: no `end()` in between, and the menu's anchor is the finger.
		clock.advance();
		expect(triggers).toEqual([{ x: 12, y: 34, target: element }]);

		// The lift reports that it already fired, so a click-to-act caller can swallow the release.
		expect(session.end()).toBe(true);
		expect(session.pending()).toBe(false);
		expect(feedback).toEqual([true, false]);
		// …and a lift with nothing fired says so, which is the other half of the same contract.
		expect(session.end()).toBe(false);
	});

	it('cancels on travel past the slop, keeping exactly 8 px', () => {
		const { session, clock, triggers, feedback } = sessionWith();
		const element = targetElement();
		expect(LONG_PRESS_SLOP_PX).toBe(8);
		// One number, two gestures: a press that starts a drag and a press that opens a menu must agree about what
		// "the finger moved" means, or one of them cancels what the other started.
		expect(LONG_PRESS_SLOP_PX).toBe(TOUCH_DRAG_THRESHOLD_PX);

		// At the boundary the press survives: the rule is `travel > slop`, not `>=`.
		session.begin(pressOn(element, { x: 0, y: 0 }));
		session.move({ x: LONG_PRESS_SLOP_PX, y: 0 });
		expect(session.pending()).toBe(true);
		clock.advance();
		expect(triggers).toHaveLength(1);
		session.end();

		// One pixel further and it is a scroll: the timer is gone, the feedback is off, and no menu ever opens —
		// not now, and not when the 500 ms would have elapsed.
		session.begin(pressOn(element, { x: 0, y: 0 }));
		expect(session.pending()).toBe(true);
		session.move({ x: LONG_PRESS_SLOP_PX + 1, y: 0 });
		expect(session.pending()).toBe(false);
		expect(clock.pending()).toBe(0);
		expect(feedback).toEqual([true, false, true, false]);
		clock.advance();
		expect(triggers).toHaveLength(1);
		expect(session.end()).toBe(false);
	});

	it('is one press at a time, and only the primary button of it', () => {
		const { session, clock, triggers } = sessionWith();
		const element = targetElement();

		// A right-click is not a long press: the context menu is already the answer to that press.
		expect(session.begin(pressOn(element, { button: 2 }))).toBe(false);
		// Nor is a secondary pointer of a multi-touch gesture — the first finger owns the press.
		expect(session.begin(pressOn(element, { isPrimary: false }))).toBe(false);
		expect(session.pending()).toBe(false);

		expect(session.begin(pressOn(element))).toBe(true);
		// A second finger while the first is resting: refused, and it does not disturb the press in progress.
		expect(session.begin(pressOn(element, { pointerType: 'pen' }))).toBe(false);
		expect(session.pending()).toBe(true);
		clock.advance();
		expect(triggers).toHaveLength(1);
		session.cancel();
	});

	it('forgets a press on cancel, and never fires after it', () => {
		const { session, clock, triggers, feedback } = sessionWith();
		const element = targetElement();
		session.begin(pressOn(element));
		// `pointercancel` is what the browser sends when it takes the gesture away (a scroll, a system swipe).
		session.cancel();
		expect(session.pending()).toBe(false);
		expect(clock.pending()).toBe(0);
		expect(feedback).toEqual([true, false]);
		clock.advance();
		expect(triggers).toEqual([]);
		expect(session.end()).toBe(false);
	});

	it('carries a pen like a finger, and refuses an element-less target', () => {
		const { session, clock, triggers } = sessionWith();
		const element = targetElement();
		expect(session.begin(pressOn(element, { pointerType: 'pen', x: 5, y: 6 }))).toBe(true);
		clock.advance();
		expect(triggers).toEqual([{ x: 5, y: 6, target: element }]);
		session.end();

		// `event.target` may be a text node (or nothing at all): a press on one is not a press on an element, and
		// the session says so rather than throwing when it later needs `closest()`. A text node is a real
		// `EventTarget`, so the event is dispatched on it and the platform hands back that target.
		const text = document.createTextNode('cell text');
		document.body.append(text);
		const onText = press();
		text.dispatchEvent(onText);
		expect(onText.target).toBe(text);
		expect(session.begin(onText)).toBe(false);
	});
});

/* ── the grid, wearing it ─────────────────────────────────────────────────────────────────────────────── */

const CONTEXT: FieldContext = {
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
	columnName: '',
};

const COLUMNS = [
	{ id: 'note.Name', name: 'Name', type: 'text', value: 'Row' },
	{ id: 'note.Status', name: 'Status', type: 'singleSelect', value: 'Todo' },
] as const;

const ROWS = ['Notes/001.md', 'Notes/002.md', 'Notes/003.md'];

function makeStore(): GridStore {
	const fields: ResolvedField[] = COLUMNS.map((column) =>
		resolveField(
			{
				id: column.id,
				name: column.name,
				source: 'note',
				fieldOptions: { type: column.type },
			},
			{ ...CONTEXT, columnName: column.name },
		),
	);
	const rows = ROWS.map((filePath) => {
		const cells: Record<string, CellValue> = {};
		for (const [at, column] of COLUMNS.entries()) {
			cells[fields[at]?.definition.id ?? column.id] = column.value;
		}
		return { filePath, cells };
	});
	return createGridStore({ source: createFakeRowSource({ fields, rows }) });
}

let roots: { unmount: () => void }[] = [];

function mount(store: GridStore): HTMLElement {
	const root = createRoot(document.body);
	roots.push(root);
	act(() => {
		root.render(
			createElement(GridView, {
				store,
				presentation: { density: 'medium' },
				initialPaneWidth: 389,
			}),
		);
	});
	return document.body;
}

function element(selector: string): HTMLElement {
	const found = document.body.querySelector<HTMLElement>(selector);
	if (found === null) {
		throw new Error(`no element for ${selector}`);
	}
	return found;
}

/** Dispatches an event inside `act`, so React has finished before the assertion reads the DOM. */
function send(target: Element, event: Event): void {
	act(() => {
		target.dispatchEvent(event);
	});
}

/** Lets the 500 ms the gesture is waiting for elapse — on the faked clock, and inside `act`. */
function hold(): void {
	act(() => {
		vi.advanceTimersByTime(LONG_PRESS_MS);
	});
}

describe('the grid’s long press', () => {
	afterEach(() => {
		for (const root of roots) {
			act(() => {
				root.unmount();
			});
		}
		roots = [];
	});

	it('opens the cell menu 500 ms into a touch press, with the feedback on for the whole hold', () => {
		// Only `setTimeout` is faked: React's scheduler, `Date` and `requestAnimationFrame` stay real, so the grid
		// mounts and renders exactly as it does in every other test in this folder.
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const store = makeStore();
		mount(store);
		const cell = element('.cell[data-field="note.Name"]');

		send(cell, press({ x: 30, y: 40 }));
		// The feedback is an attribute, not a render: the cell is painted and no menu exists yet.
		expect(cell.getAttribute('data-touch-press')).toBe('on');
		expect(openedMenus).toHaveLength(0);

		hold();
		const menu = openedMenus.at(-1);
		expect(openedMenus).toHaveLength(1);
		// The cell menu's inventory, from `menus/cellMenu.ts`, reached the real `Menu`.
		expect(menu?.items.map((item) => item.title)).toContain('Clear cells');
		expect(cell.getAttribute('data-touch-press')).toBe('on');

		// The finger lifts: the feedback goes, the menu stays (it is the browser's to close), and the timer is gone.
		send(cell, new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
		expect(cell.hasAttribute('data-touch-press')).toBe(false);
		hold();
		expect(openedMenus).toHaveLength(1);
	});

	it('ignores a mouse press, however long it is held', () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const store = makeStore();
		mount(store);
		const cell = element('.cell[data-field="note.Name"]');

		send(cell, press({ pointerType: 'mouse' }));
		expect(cell.hasAttribute('data-touch-press')).toBe(false);
		hold();
		expect(openedMenus).toHaveLength(0);
	});

	it('treats a finger that travels as a scroll: no menu, and the paint is gone', () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const store = makeStore();
		mount(store);
		const cell = element('.cell[data-field="note.Name"]');

		send(cell, press({ x: 10, y: 10 }));
		expect(cell.getAttribute('data-touch-press')).toBe('on');
		send(
			cell,
			new PointerEvent('pointermove', {
				bubbles: true,
				pointerType: 'touch',
				clientX: 10 + LONG_PRESS_SLOP_PX + 6,
				clientY: 10,
			}),
		);
		expect(cell.hasAttribute('data-touch-press')).toBe(false);
		hold();
		expect(openedMenus).toHaveLength(0);
	});

	it('does not arm on a header, which has its own touch path: the menu opens on release', () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const store = makeStore();
		mount(store);
		const header = element('.hcell[data-field="note.Name"]');

		send(header, press({ x: 60, y: 4 }));
		expect(header.hasAttribute('data-touch-press')).toBe(false);
		hold();
		// Deliberately nothing at 500 ms: a header press that does not move opens its menu **on release**, so arming
		// a long press here as well would open the same menu twice — once at the threshold and again on lift.
		expect(openedMenus).toHaveLength(0);
	});
});
