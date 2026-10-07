/**
 * The pointer, end to end on a mounted grid — and the drag session's own contract underneath it.
 *
 * Two halves, because they answer two different questions:
 *
 *  · **The session** (`describe('the drag session')`) is where the four rules live: below the threshold nothing
 *    happens, a full drag calls `onEnd` **exactly once**, `Escape` cancels with no command, a lost capture or a
 *    `pointercancel` ends the drag *without* committing, and a second pointer is ignored. These are the assertions
 *    the step asks for by name.
 *  · **The gestures** (`describe('the gestures')`) put a real `GridView` on screen and drive each of the four
 *    drags through its own port: a resize previews into the DOM and writes once on release, a column reorder
 *    drops between two columns and does **nothing** when dropped where it started, a row reorder issues one
 *    command and **zero React renders per pointer move**, and a fill drag previews the target range and commits
 *    with one `setCells`.
 *
 * jsdom has no layout: every rect is 0 × 0 and `elementFromPoint` does not exist. So the *hit tests* are handed
 * in as callbacks here (the whole reason the helpers take them as ports), and the geometry-dependent parts of the
 * grid — where the drop indicator lands, how wide a column is in pixels — are asserted as *dispatch* and *DOM
 * class* facts rather than as pixels. The pixels are step 21's harness.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GridView } from '../../src/grid/GridView';
import { createGridStore } from '../../src/grid/store/store';
import { resolveField } from '../../src/core/schema/propertySchema';
import { createFakeRowSource } from '../fakes/rowSource';
import { openedMenus, resetMenus } from '../mocks/obsidian';
import { createDragSession } from '../../src/grid/pointer/dragSession';
import {
	beginColumnResize,
	autoFitWidth,
	clampColumnWidth,
	draggedWidth,
} from '../../src/grid/pointer/resizeColumn';
import {
	beginColumnReorder,
	columnDropIndex,
	dropSideOf,
} from '../../src/grid/pointer/reorderColumn';
import { beginRowReorder, rowDropIndex } from '../../src/grid/pointer/reorderRow';
import { beginFillDrag, fillPlan } from '../../src/grid/pointer/fillHandle';
import {
	beginScrollDrag,
	offsetForThumbDrag,
	offsetForTrackClick,
	thumbGeometry,
} from '../../src/grid/pointer/scrollBar';
import type { FieldContext, CellValue } from '../../src/core/types';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import type { GridStore } from '../../src/grid/store/types';
import type { CellRef } from '../../src/core/ops/types';
import type { Range } from '../../src/core/selection/range';

Object.assign(window, { IS_REACT_ACT_ENVIRONMENT: true });

const CONTEXT: FieldContext = {
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
	columnName: '',
};

const COLUMNS = [
	{ id: 'note.Name', name: 'Name', type: 'text', value: 'Row' },
	{ id: 'note.Count', name: 'Count', type: 'number', value: 1 },
	{ id: 'note.Done', name: 'Done', type: 'checkbox', value: false },
] as const;

const ROWS = ['Notes/001.md', 'Notes/002.md', 'Notes/003.md', 'Notes/004.md'];

function makeFixture(): { readonly store: GridStore } {
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
	return { store: createGridStore({ source: createFakeRowSource({ fields, rows }) }) };
}

/** A pointer event with the three fields every drag reads, plus the modifiers a test may want. */
function pointer(init: {
	readonly x: number;
	readonly y: number;
	readonly id?: number;
	readonly button?: number;
	readonly primary?: boolean;
}): PointerEvent {
	return new PointerEvent('pointerdown', {
		clientX: init.x,
		clientY: init.y,
		pointerId: init.id ?? 1,
		button: init.button ?? 0,
		isPrimary: init.primary ?? true,
		bubbles: true,
	});
}

/** A `pointermove`/`pointerup` on the same element, with the same pointer id. */
function move(id: number, x: number, y: number): PointerEvent {
	return new PointerEvent('pointermove', {
		clientX: x,
		clientY: y,
		pointerId: id,
		bubbles: true,
	});
}

function up(id: number, x: number, y: number): PointerEvent {
	return new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: id, bubbles: true });
}

/**
 * The element a drag is attached to — `document.body` itself.
 *
 * Deliberately not a fresh `div`: nothing in this file needs a new element, `document.body` is a real attach point
 * for pointer events and pointer capture, and the repo's own lint prefers Obsidian's DOM helpers over
 * `document.createElement` everywhere outside `spike/**`.
 */
function element(): HTMLElement {
	return document.body;
}

let roots: { unmount: () => void }[] = [];

beforeEach(() => {
	document.body.replaceChildren();
});

afterEach(() => {
	for (const root of roots) {
		act(() => {
			root.unmount();
		});
	}
	roots = [];
	document.body.replaceChildren();
});

describe('the drag session', () => {
	it('does nothing at all below the threshold, and reports a click', () => {
		const target = element();
		const seen: string[] = [];
		const session = createDragSession({
			element: target,
			threshold: 4,
			onStart: () => seen.push('start'),
			onMove: () => seen.push('move'),
			onEnd: (outcome) => seen.push(`end:${String(outcome.moved)}`),
		});
		expect(session.begin(pointer({ x: 10, y: 10 }))).toBe(true);
		target.dispatchEvent(move(1, 12, 11));
		expect(seen).toEqual([]);
		target.dispatchEvent(up(1, 12, 11));
		expect(seen).toEqual(['end:false']);
	});

	it('crosses the threshold once, on the move that crosses it', () => {
		const target = element();
		const seen: string[] = [];
		createDragSession({
			element: target,
			threshold: 4,
			onStart: () => seen.push('start'),
			onMove: (point) => seen.push(`move:${String(point.clientX)}`),
			onEnd: (outcome) => seen.push(`end:${String(outcome.moved)}`),
		}).begin(pointer({ x: 0, y: 0 }));
		target.dispatchEvent(move(1, 3, 0));
		expect(seen).toEqual([]);
		target.dispatchEvent(move(1, 4, 0));
		target.dispatchEvent(move(1, 20, 0));
		expect(seen).toEqual(['start', 'move:4', 'move:20']);
		target.dispatchEvent(up(1, 20, 0));
		expect(seen).toEqual(['start', 'move:4', 'move:20', 'end:true']);
	});

	it('ignores a second pointer, a right button and a non-primary pointer', () => {
		const target = element();
		const ends: string[] = [];
		const session = createDragSession({
			element: target,
			threshold: 4,
			onMove: () => undefined,
			onEnd: () => ends.push('ended'),
		});
		expect(session.begin(pointer({ x: 1, y: 1, button: 2 }))).toBe(false);
		expect(session.begin(pointer({ x: 1, y: 1, primary: false }))).toBe(false);
		expect(session.begin(pointer({ x: 1, y: 1 }))).toBe(true);
		// A second finger's moves are not this drag's moves, and its release is not this drag's release.
		target.dispatchEvent(move(99, 100, 100));
		target.dispatchEvent(up(99, 100, 100));
		expect(ends).toEqual([]);
		expect(session.active()).toBe(true);
		target.dispatchEvent(up(1, 100, 100));
		expect(ends).toEqual(['ended']);
		expect(session.active()).toBe(false);
	});

	it('cancels on Escape with no commit, and swallows the key', () => {
		const target = element();
		const ends: { moved: boolean; cancelled: boolean }[] = [];
		createDragSession({
			element: target,
			threshold: 4,
			onMove: () => undefined,
			onEnd: (outcome) => ends.push({ moved: outcome.moved, cancelled: outcome.cancelled }),
		}).begin(pointer({ x: 5, y: 5 }));
		target.dispatchEvent(move(1, 25, 5));

		// The key listener is on the document — a drag owns the pointer, not the keyboard (dragSession.ts §Escape).
		const escape = new KeyboardEvent('keydown', {
			key: 'Escape',
			bubbles: true,
			cancelable: true,
		});
		document.dispatchEvent(escape);
		expect(escape.defaultPrevented).toBe(true);
		expect(ends).toEqual([{ moved: true, cancelled: true }]);
	});

	it('ends once on a lost capture, and reports it as a cancel', () => {
		const target = element();
		const ends: { cancelled: boolean }[] = [];
		createDragSession({
			element: target,
			threshold: 4,
			onMove: () => undefined,
			onEnd: (outcome) => ends.push({ cancelled: outcome.cancelled }),
		}).begin(pointer({ x: 5, y: 5 }));
		target.dispatchEvent(
			new PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true }),
		);
		// A release that arrives afterwards must not produce a second `onEnd`.
		target.dispatchEvent(up(1, 5, 5));
		expect(ends).toEqual([{ cancelled: true }]);
	});

	it('ends once on a system pointercancel, and never commits', () => {
		const target = element();
		const ends: string[] = [];
		createDragSession({
			element: target,
			threshold: 4,
			onMove: () => undefined,
			onEnd: (outcome) => ends.push(outcome.cancelled ? 'cancelled' : 'ended'),
		}).begin(pointer({ x: 5, y: 5 }));
		target.dispatchEvent(move(1, 50, 50));
		target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }));
		expect(ends).toEqual(['cancelled']);
	});

	it('detaches everything when the drag ends', () => {
		const target = element();
		const ends: string[] = [];
		const session = createDragSession({
			element: target,
			threshold: 4,
			onMove: () => ends.push('move'),
			onEnd: () => ends.push('end'),
		});
		session.begin(pointer({ x: 5, y: 5 }));
		session.cancel();
		target.dispatchEvent(move(1, 90, 90));
		target.dispatchEvent(up(1, 90, 90));
		// One cancel, one end — and nothing after it.
		expect(ends).toEqual(['end']);
		expect(session.active()).toBe(false);
	});
});

describe('the pure half of each gesture', () => {
	it('clamps a dragged width to the floor and rounds it', () => {
		expect(draggedWidth(200, 40)).toBe(240);
		expect(draggedWidth(200, -195)).toBe(60);
		expect(clampColumnWidth(Number.NaN)).toBe(60);
	});

	it('auto-fits to the widest value, with the header counted and both ends clamped', () => {
		// A header alone: 8 px per character plus the header's own padding, floored at 90.
		expect(autoFitWidth('Id', [])).toBe(90);
		// 32 characters × 7.4 px plus 26 px of padding, rounded: 263.
		expect(autoFitWidth('Name', ['a very long value in this column'])).toBe(263);
		expect(autoFitWidth('Name', ['x'.repeat(200)])).toBe(520);
	});

	it('answers "before" or "after" from the box, and refuses a drop where the column already is', () => {
		expect(dropSideOf({ left: 100, width: 100 }, 120)).toBe('before');
		expect(dropSideOf({ left: 100, width: 100 }, 180)).toBe('after');
		const order = ['a', 'b', 'c', 'd'];
		expect(columnDropIndex(order, 'b', 'd', 'after')).toBe(4);
		// Dropping on yourself, just before yourself and just after yourself are all "nothing to do".
		expect(columnDropIndex(order, 'b', 'b', 'before')).toBeNull();
		expect(columnDropIndex(order, 'b', 'a', 'after')).toBeNull();
		expect(columnDropIndex(order, 'b', 'c', 'before')).toBeNull();
		expect(columnDropIndex(order, 'b', null, 'before')).toBeNull();
	});

	it('answers the same for a row, and treats "outside the lane" as no drop at all', () => {
		const order = ['r1', 'r2', 'r3'];
		expect(rowDropIndex(order, 'r1', 'r3', 'after')).toBe(3);
		expect(rowDropIndex(order, 'r3', 'r1', 'before')).toBe(0);
		expect(rowDropIndex(order, 'r2', 'r1', 'after')).toBeNull();
		expect(rowDropIndex(order, 'r2', null, 'before')).toBeNull();
	});

	it('maps a thumb drag onto the offset range, clamped at both ends', () => {
		const geometry = thumbGeometry({ trackLength: 200, viewLength: 100, contentLength: 600 });
		expect(geometry.maxOffset).toBe(500);
		expect(geometry.travel).toBe(200 - geometry.size);
		expect(offsetForThumbDrag({ startOffset: 0, delta: geometry.travel, geometry })).toBe(500);
		expect(offsetForThumbDrag({ startOffset: 200, delta: -10_000, geometry })).toBe(0);
		expect(offsetForThumbDrag({ startOffset: 0, delta: 10_000, geometry })).toBe(500);
		// Nothing to scroll: a full-length thumb with no travel, and offset 0 whatever the drag does.
		const fixed = thumbGeometry({ trackLength: 200, viewLength: 600, contentLength: 600 });
		expect(fixed.travel).toBe(0);
		expect(offsetForThumbDrag({ startOffset: 0, delta: 100, geometry: fixed })).toBe(0);
	});

	it('pages a track click towards the click, and refuses a click on the thumb', () => {
		expect(
			offsetForTrackClick({
				clientPos: 10,
				thumbStart: 50,
				thumbEnd: 90,
				offset: 200,
				maxOffset: 500,
				viewLength: 100,
			}),
		).toBe(100);
		expect(
			offsetForTrackClick({
				clientPos: 300,
				thumbStart: 50,
				thumbEnd: 90,
				offset: 200,
				maxOffset: 500,
				viewLength: 100,
			}),
		).toBe(300);
		expect(
			offsetForTrackClick({
				clientPos: 70,
				thumbStart: 50,
				thumbEnd: 90,
				offset: 200,
				maxOffset: 500,
				viewLength: 100,
			}),
		).toBeNull();
	});
});

describe('the gestures, on a mounted grid', () => {
	it('resizes a column with a live preview and exactly one command', () => {
		const target = element();
		const previews: number[] = [];
		const commits: { id: string; width: number }[] = [];
		const session = beginColumnResize({
			element: target,
			fieldId: 'note.Name',
			startWidth: 200,
			event: pointer({ x: 100, y: 20 }),
			onPreview: (_id, width) => previews.push(width),
			onCommit: (id, width) => commits.push({ id, width }),
			onCancel: () => commits.push({ id: 'cancel', width: 0 }),
		});
		expect(session).not.toBeNull();
		target.dispatchEvent(move(1, 140, 20));
		expect(previews).toEqual([240]);
		expect(commits).toEqual([]);
		target.dispatchEvent(up(1, 150, 20));
		expect(commits).toEqual([{ id: 'note.Name', width: 250 }]);
	});

	it('writes nothing when a resize is cancelled mid-drag', () => {
		const target = element();
		const seen: string[] = [];
		beginColumnResize({
			element: target,
			fieldId: 'note.Name',
			startWidth: 200,
			event: pointer({ x: 100, y: 20 }),
			onPreview: () => seen.push('preview'),
			onCommit: () => seen.push('commit'),
			onCancel: () => seen.push('cancel'),
		});
		target.dispatchEvent(move(1, 260, 20));
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(seen).toEqual(['preview', 'cancel']);
	});

	it('writes nothing when a resize is a click', () => {
		const target = element();
		const seen: string[] = [];
		beginColumnResize({
			element: target,
			fieldId: 'note.Name',
			startWidth: 200,
			event: pointer({ x: 100, y: 20 }),
			onPreview: () => seen.push('preview'),
			onCommit: () => seen.push('commit'),
			onCancel: () => seen.push('cancel'),
		});
		target.dispatchEvent(up(1, 102, 20));
		expect(seen).toEqual(['cancel']);
	});

	it('reorders a column once, and opens the header menu for a click that never moved', () => {
		const first = element();
		const commits: { id: string; to: number }[] = [];
		const clicks: number[] = [];
		beginColumnReorder({
			element: first,
			fieldId: 'note.Count',
			event: pointer({ x: 200, y: 20 }),
			order: ['note.Name', 'note.Count', 'note.Done'],
			// A box whose centre the drop point is past, so the drop means "after this column".
			columnAt: () => ({ fieldId: 'note.Done', box: { left: 200, width: 100 } }),
			onIndicator: () => undefined,
			onCommit: (id, to) => commits.push({ id, to }),
			onClick: () => clicks.push(1),
		});
		first.dispatchEvent(move(1, 300, 20));
		first.dispatchEvent(up(1, 300, 20));
		expect(commits).toEqual([{ id: 'note.Count', to: 3 }]);

		const second = element();
		beginColumnReorder({
			element: second,
			fieldId: 'note.Count',
			event: pointer({ x: 200, y: 20 }),
			order: ['note.Name', 'note.Count'],
			columnAt: () => null,
			onIndicator: () => undefined,
			onCommit: () => commits.push({ id: 'no', to: -1 }),
			onClick: () => clicks.push(1),
		});
		second.dispatchEvent(up(1, 201, 20));
		expect(clicks).toEqual([1]);
		expect(commits).toHaveLength(1);
	});

	it('reorders a row once, and treats a drop in the same place as nothing', () => {
		const target = element();
		const commits: { path: string; to: number }[] = [];
		beginRowReorder({
			element: target,
			filePath: 'Notes/002.md',
			event: pointer({ x: 10, y: 40 }),
			order: ROWS,
			rowAt: () => ({ filePath: 'Notes/004.md', half: 'after' }),
			onIndicator: () => undefined,
			onCommit: (path, to) => commits.push({ path, to }),
		});
		target.dispatchEvent(move(1, 10, 100));
		target.dispatchEvent(up(1, 10, 100));
		expect(commits).toEqual([{ path: 'Notes/002.md', to: 4 }]);

		const same = element();
		beginRowReorder({
			element: same,
			filePath: 'Notes/002.md',
			event: pointer({ x: 10, y: 40 }),
			order: ROWS,
			// Dropping just below itself: the insertion point it already occupies.
			rowAt: () => ({ filePath: 'Notes/002.md', half: 'after' }),
			onIndicator: () => undefined,
			onCommit: (path, to) => commits.push({ path, to }),
		});
		same.dispatchEvent(move(1, 10, 80));
		same.dispatchEvent(up(1, 10, 80));
		expect(commits).toHaveLength(1);
	});

	it('plans a fill as a copy of the source row, and commits one setCells on release', () => {
		const target = element();
		const commits: number[] = [];
		const previews: number[] = [];
		const selection: Range = {
			anchor: { filePath: ROWS[0] ?? '', fieldId: 'note.Name' },
			focus: { filePath: ROWS[0] ?? '', fieldId: 'note.Name' },
		};
		const order = { rows: ROWS, fields: ['note.Name', 'note.Count'] };
		beginFillDrag({
			element: target,
			event: pointer({ x: 100, y: 40 }),
			selection,
			order,
			cellAt: () => ({ filePath: ROWS[2] ?? '', fieldId: 'note.Name' }),
			valueOf: () => 'Row',
			onPreview: (writes) => previews.push(writes?.length ?? 0),
			onCommit: (plan) => commits.push(plan.writes.length),
		});
		target.dispatchEvent(move(1, 100, 120));
		target.dispatchEvent(up(1, 100, 120));
		// Two previewed writes, then the clear on release: `null` is "stop painting".
		expect(previews).toEqual([2, 0]);
		expect(commits).toEqual([2]);
	});

	it('fills right when the drag goes further right than down', () => {
		const order = { rows: ROWS, fields: ['note.Name', 'note.Count', 'note.Done'] };
		const selection: Range = {
			anchor: { filePath: ROWS[0] ?? '', fieldId: 'note.Name' },
			focus: { filePath: ROWS[1] ?? '', fieldId: 'note.Name' },
		};
		const plan = fillPlan({
			selection,
			order,
			over: { filePath: ROWS[1] ?? '', fieldId: 'note.Count' },
			valueOf: (filePath) => filePath,
		});
		expect(plan?.direction).toBe('right');
		// Two rows × one extra column: the left column copied across.
		expect(plan?.writes.map((write) => write.fieldId)).toEqual(['note.Count', 'note.Count']);
		expect(plan?.writes.map((write) => write.value)).toEqual([ROWS[0], ROWS[1]]);
	});

	it('refuses a fill that points back into the selection', () => {
		const order = { rows: ROWS, fields: ['note.Name', 'note.Count'] };
		const selection: Range = {
			anchor: { filePath: ROWS[0] ?? '', fieldId: 'note.Name' },
			focus: { filePath: ROWS[2] ?? '', fieldId: 'note.Count' },
		};
		expect(
			fillPlan({
				selection,
				order,
				over: { filePath: ROWS[1] ?? '', fieldId: 'note.Name' },
				valueOf: () => null,
			}),
		).toBeNull();
	});

	it('scrolls the scroller from a thumb drag, and never commits anything to the store', () => {
		const target = element();
		const offsets: number[] = [];
		beginScrollDrag({
			element: target,
			event: pointer({ x: 0, y: 0 }),
			axis: 'y',
			geometry: { size: 40, travel: 160, maxOffset: 400 },
			startOffset: 100,
			onScroll: (offset) => offsets.push(offset),
		});
		target.dispatchEvent(move(1, 0, 80));
		target.dispatchEvent(move(1, 0, 160));
		target.dispatchEvent(up(1, 0, 160));
		expect(offsets).toEqual([300, 500 - 100]);
	});

	it('mounts, drags a row handle, and re-renders zero times while the pointer moves', () => {
		const fixture = { ...makeFixture() };
		const store = fixture.store;
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

		// The handle exists on every row — the gutter's drag grip (step 20).
		const handle = document.body.querySelector<HTMLElement>('[data-row-drag]');
		expect(handle).not.toBeNull();

		const before = store.getSnapshot().revision;
		const moves = vi.fn();
		const target = handle ?? element();
		const session = createDragSession({
			element: target,
			threshold: 4,
			onMove: moves,
			onEnd: () => undefined,
		});
		session.begin(pointer({ x: 10, y: 40 }));
		act(() => {
			target.dispatchEvent(move(1, 10, 60));
			target.dispatchEvent(move(1, 10, 80));
		});
		expect(moves).toHaveBeenCalledTimes(2);
		// Two pointer moves, no store revision: a drag previews, it does not dispatch.
		expect(store.getSnapshot().revision).toBe(before);
	});

	it('mounts the fill handle only while something is selected, and places it by measurement', () => {
		const { store } = makeFixture();
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
		const handle = document.body.querySelector<HTMLElement>('.tablify-fill');
		expect(handle).not.toBeNull();
		// Nothing is selected yet: the handle is hidden rather than absent, so the element's identity is stable.
		expect(handle?.classList.contains('is-hidden')).toBe(true);

		act(() => {
			store.select({
				anchor: { filePath: ROWS[0] ?? '', fieldId: 'note.Name' },
				focus: { filePath: ROWS[0] ?? '', fieldId: 'note.Name' },
			});
		});
		expect(handle?.classList.contains('is-hidden')).toBe(false);

		// `Ctrl+A`-shaped selection: still visible, still one element.
		act(() => {
			store.select({
				anchor: { filePath: ROWS[0] ?? '', fieldId: 'note.Name' },
				focus: { filePath: ROWS[1] ?? '', fieldId: 'note.Count' },
			});
		});
		expect(document.body.querySelectorAll('.tablify-fill')).toHaveLength(1);
	});

	it('routes a right-click on a header, a cell and the gutter to three different menus', () => {
		resetMenus();
		const { store } = makeFixture();
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

		const header = document.body.querySelector<HTMLElement>('.hcell[data-field]');
		const cell = document.body.querySelector<HTMLElement>('[data-cell]');
		const row = document.body.querySelector<HTMLElement>('[data-row]');
		expect(header).not.toBeNull();
		expect(cell).not.toBeNull();
		expect(row).not.toBeNull();

		for (const target of [header, cell, row]) {
			act(() => {
				target?.dispatchEvent(
					new MouseEvent('contextmenu', { clientX: 12, clientY: 34, bubbles: true }),
				);
			});
		}
		expect(openedMenus).toHaveLength(3);
		// Three different menus: 15 header items, 12 cell items, 5 gutter items — the inventory is `menus.test.tsx`'s.
		expect(openedMenus.map((menu) => menu.items.length)).toEqual([15, 12, 5]);
		expect(openedMenus.every((menu) => menu.shownAt !== null)).toBe(true);
	});

	it('opens the header menu from a header press that never moved', () => {
		resetMenus();
		const { store } = makeFixture();
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
		const header = document.body.querySelector<HTMLElement>('.hcell[data-field]');
		act(() => {
			header?.dispatchEvent(pointer({ x: 30, y: 12 }));
			header?.dispatchEvent(up(1, 30, 12));
		});
		// A press that never crossed the 5 px threshold is a *click on the header*: the header menu, as the
		// prototype's `onHeaderClick` does.
		expect(openedMenus).toHaveLength(1);
	});

	it('is not affected by a drag on a cell: the cell still selects', () => {
		const { store } = makeFixture();
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
		const cell = document.body.querySelector<HTMLElement>(
			'[data-cell="Notes/002.md::note.Count"]',
		);
		expect(cell).not.toBeNull();
		act(() => {
			cell?.dispatchEvent(
				new PointerEvent('pointerdown', {
					clientX: 5,
					clientY: 5,
					pointerId: 1,
					bubbles: true,
				}),
			);
		});
		expect(store.getSnapshot().active).toEqual({
			filePath: 'Notes/002.md',
			fieldId: 'note.Count',
		} satisfies CellRef);
	});
});
