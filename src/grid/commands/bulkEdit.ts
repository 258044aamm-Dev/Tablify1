/**
 * Bulk column editing: **one value, many cells, one undo step, bottom-up.**
 *
 * `docs/01` §Core interaction model names the gesture — *"Cmd/Ctrl+Enter — edit the column across the whole
 * selection, bottom-up"* — and `docs/07` §Tier 3 gives the reason the ordering is in the sentence at all: a
 * 400-cell edit has to undo as **one** step, and the direction is the doc's way of saying "the restore order is the
 * reverse of the write order".
 *
 * Two entry points, because the value arrives in two forms and only one of them is already canonical:
 *
 *   · {@link applyBulkEdit} takes a `CellValue` — what the cell editor produced through the column's own
 *     descriptor. Nothing is re-parsed: a value that has been through `parsePlain` must not be parsed twice.
 *   · {@link applyBulkEditDraft} takes the **text** a dialog collected, and parses it with the column's own
 *     descriptor — exactly what the dialog's own hint promises (*"The value is parsed by the column's own type"*).
 *     A draft is `string | null`; an empty draft is the type's "no value" (`valueOfEmptyDraft`), and an unreadable
 *     draft is a refusal with a sentence rather than a cell holding a string in a number column.
 *
 * `cellsOf` already returns the range's cells in **row-major top-to-bottom** order, so "bottom-up" is that list
 * reversed; the writes go into one `setCells` op either way, which is what makes the undo one step. The order is
 * still the doc's, and `tests/unit/bulk-edit.test.ts` asserts it, because a future write path that is *not* one op
 * (a queue that batches per file, say) must not silently turn it into a top-down restore.
 */
import { cellsOf } from '../../core/selection/range';
import { valueOfEmptyDraft } from '../editSession';
import { setCells } from '../store/commands';
import type { CommandResult } from '../store/commands';
import type { GridStore } from '../store/types';
import type { CellValue, PropertyId } from '../../core/types';
import type { CellWrite } from '../../core/ops/types';

/** What a bulk edit did, for the status bar and the live region: how many cells, in which column. */
export type BulkEditOutcome = {
	readonly ok: true;
	/** The label the undo step carries. */
	readonly label: string;
	readonly cells: number;
	/** The sentence the live region says: *"12 cells updated in the Status column"*. */
	readonly announcement: string;
};

/** The selection's cells, **bottom-up**, with one value. `null` when there is nothing to write. */
export function bulkEditWrites(store: GridStore, value: CellValue): readonly CellWrite[] | null {
	const snapshot = store.getSnapshot();
	const range = snapshot.selection;
	if (range === null) {
		return null;
	}
	const cells = cellsOf(range, snapshot.order);
	if (cells.length === 0) {
		return null;
	}
	// Bottom-up: the doc's order, so a restore that walks the list in reverse puts the top row back last and the
	// first row back first — the same order a person reads the column in.
	return cells.map((cell) => ({ ...cell, value })).reverse();
}

/** The column's display name, for a label and an announcement. Falls back to the id, never to "the column". */
export function columnNameOf(store: GridStore, fieldId: PropertyId): string {
	const field = store
		.getSnapshot()
		.fields.find((candidate) => candidate.definition.id === fieldId);
	return field?.definition.name ?? fieldId;
}

/** *"Set “Status” for 12 rows"* — the undo entry's own words, so the menu and the toast agree. */
export function bulkEditLabel(store: GridStore, cells: number, fieldId: PropertyId): string {
	return `Set “${columnNameOf(store, fieldId)}” for ${String(cells)} row${cells === 1 ? '' : 's'}`;
}

/** *"12 cells updated in the Status column"* — counts first, then the column, per `docs/04` §Accessibility. */
export function bulkEditAnnouncement(cells: number, columnName: string): string {
	return `${String(cells)} cell${cells === 1 ? '' : 's'} updated in the ${columnName} column`;
}

/**
 * Applies an already-canonical value to the whole selection. The editor's commit path: the value came from the
 * column's descriptor, so re-parsing it here would be a second interpretation of the same text.
 */
export function applyBulkEdit(
	store: GridStore,
	value: CellValue,
	fieldId?: PropertyId,
): CommandResult | BulkEditOutcome {
	const writes = bulkEditWrites(store, value);
	if (writes === null) {
		return { ok: false, reason: 'select the cells to edit first' };
	}
	const field = fieldId ?? store.getSnapshot().active?.fieldId ?? '';
	const label = bulkEditLabel(store, writes.length, field);
	const result = setCells(store, writes, label);
	if (!result.ok) {
		return result;
	}
	return {
		ok: true,
		label,
		cells: writes.length,
		announcement: bulkEditAnnouncement(writes.length, columnNameOf(store, field)),
	};
}

/**
 * Applies the text a dialog collected. `null` and `''` both mean "no value" — the same rule every editor follows
 * (`valueOfEmptyDraft`), and `parsePlain` answers with a tagged error rather than throwing, so an unreadable draft
 * comes back as a refusal the dialog can show.
 */
export function applyBulkEditDraft(
	store: GridStore,
	draft: string | null,
	fieldId: PropertyId,
): CommandResult | BulkEditOutcome {
	if (draft === null || draft === '') {
		return applyBulkEdit(store, valueOfEmptyDraft(), fieldId);
	}
	const field = store
		.getSnapshot()
		.fields.find((candidate) => candidate.definition.id === fieldId);
	if (field === undefined) {
		return { ok: false, reason: `the column “${String(fieldId)}” is not in this view` };
	}
	const parsed = field.descriptor.parsePlain(draft, field.context);
	if (!parsed.ok) {
		return { ok: false, reason: parsed.error };
	}
	return applyBulkEdit(store, parsed.value, fieldId);
}
