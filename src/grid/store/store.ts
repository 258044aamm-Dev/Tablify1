/**
 * Read helpers over a grid state: one cell's value and whether that value is still optimistic.
 *
 * The store that once produced this state (`createGridStore`) and its `RowSource` port were removed in
 * R6 Slice 2b. The native grid reads `core/database` directly. These two helpers are kept because the
 * native clipboard matrix and the selectors still call them.
 */
import { cellOf } from '../../core/ops/apply';
import type { RowId } from '../../core/ops/types';
import type { CellValue, PropertyId } from '../../core/types';
import type { GridState } from './types';

/**
 * Reads one cell: the optimistic value if there is one, otherwise the table's. The overlay comes first
 * because a value the user just typed is the value they expect to see, whatever the file currently says.
 */
export function cellAt(state: GridState, filePath: RowId, propertyId: PropertyId): CellValue {
	const pending = state.overlay.get(filePath, propertyId);
	if (pending !== undefined) {
		return pending;
	}
	for (const row of state.table.rows) {
		if (row.filePath === filePath) {
			return cellOf(row, propertyId);
		}
	}
	return null;
}

/** True when the cell's value on screen is optimistic. */
export function isPending(state: GridState, filePath: RowId, propertyId: PropertyId): boolean {
	return state.overlay.get(filePath, propertyId) !== undefined;
}
