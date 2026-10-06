/**
 * "What is under the pointer?" — the four questions a drag asks, answered from the DOM.
 *
 * Every drag in this folder takes its geometry as a **callback** (`columnAt`, `rowAt`, `cellAt`) rather than
 * reaching for the document itself. That is what makes them testable without a browser *and* what makes this file
 * possible to swap: the helpers here are the product's implementation (`elementFromPoint` against real elements),
 * and a test passes a two-line function instead. The helpers are still pure functions of `(document, x, y)`, so
 * they carry their own weight in review.
 *
 * `elementFromPoint` is the honest way to hit-test a grid. A rect-arithmetic version would have to know the
 * gutter's width, the frozen lane's split, each column's width, the header band, the scroll offsets and the
 * windowing's transform — six things that are *already* decided by the browser's layout, and a second copy of
 * them is a second source of truth for "which row is under my finger". The cost is one DOM hit-test per pointer
 * move, which is what the platform's own drag-and-drop does.
 *
 * `offsetsOf` is the exception, and it exists for the resize preview: a live *width* is written to every element
 * that draws the column (`[data-field]` headers and `[data-cell$="::id"]` cells), and those elements are found by
 * selector rather than by hit-testing. Prefix matching on a cell's key is exact here because the field id is the
 * suffix — the same `filePath::fieldId` key `Cell` and the editors agree on.
 */
import type { CellRef } from '../../core/ops/types';
import type { PropertyId } from '../../core/types';
import type { RowId } from '../../core/ops/types';

/** The element under a point, or `null` where the platform has no hit-testing (jsdom: no layout, no points). */
function elementAt(doc: Document, x: number, y: number): Element | null {
	if (typeof doc.elementFromPoint !== 'function') {
		return null;
	}
	return doc.elementFromPoint(x, y);
}

/** A cell's key (`filePath::fieldId`) split into its two parts, or `null` when it is not a cell key. */
export function splitCellKey(key: string): CellRef | null {
	const at = key.lastIndexOf('::');
	if (at <= 0) {
		return null;
	}
	const filePath = key.slice(0, at);
	const fieldId = key.slice(at + 2);
	return filePath === '' || fieldId === '' ? null : { filePath, fieldId };
}

/** The cell under the pointer. Rows are windowed and the frozen lane is a sibling layer, so this is a hit test. */
export function cellAtPoint(doc: Document, x: number, y: number): CellRef | null {
	const node = elementAt(doc, x, y)?.closest('[data-cell]');
	const key = node?.getAttribute('data-cell');
	return key === null || key === undefined ? null : splitCellKey(key);
}

/** The column header under the pointer, with its own box (the drop side is computed from the box). */
export function columnAtPoint(
	doc: Document,
	x: number,
	y: number,
): { fieldId: PropertyId; box: { left: number; width: number } } | null {
	const node = elementAt(doc, x, y)?.closest('[data-field]');
	const fieldId = node?.getAttribute('data-field');
	if (node === null || node === undefined || fieldId === null || fieldId === undefined) {
		return null;
	}
	const rect = node.getBoundingClientRect();
	return { fieldId, box: { left: rect.left, width: rect.width } };
}

/**
 * The row under the pointer and which half of it. `data-row` is on the row element itself and the gutter's cells
 * are inside it, so a drop on the row number, on a cell, or on the row's own padding all answer the same row —
 * the audit's "the gutter is a drop target too" finding, made structural rather than special-cased.
 */
export function rowAtPoint(
	doc: Document,
	x: number,
	y: number,
): { filePath: RowId; half: 'before' | 'after' } | null {
	const node = elementAt(doc, x, y)?.closest('[data-row]');
	const filePath = node?.getAttribute('data-row');
	if (node === null || node === undefined || filePath === null || filePath === undefined) {
		return null;
	}
	const rect = node.getBoundingClientRect();
	return { filePath, half: y < rect.top + rect.height / 2 ? 'before' : 'after' };
}

/** Every element that draws a column's width: its header cells and its value cells. */
export function offsetsOf(doc: Document, fieldId: PropertyId): readonly HTMLElement[] {
	const headers = doc.querySelectorAll<HTMLElement>(`[data-field="${selectableValue(fieldId)}"]`);
	const cells = doc.querySelectorAll<HTMLElement>(
		`[data-cell$="${selectableValue(`::${fieldId}`)}"]`,
	);
	// `Array.from`, not spread: this project's `lib` has no DOM iterable, and a spread of a `NodeList` is a
	// runtime feature the harness would pass while `tsc` refuses it.
	return [...Array.from(headers), ...Array.from(cells)];
}

/**
 * A property id used inside an attribute selector. Ids are `note.Status`, `file.name` and bare names, none of
 * which needs escaping — but a `"` or `\\` in a hand-written property name would break the selector and throw
 * inside a pointer move, so the two characters that can do that are replaced. Quoting the value is the caller's
 * job (`[data-field="…"]`), which is why only quote and backslash are handled here.
 */
function selectableValue(value: string): string {
	return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}
