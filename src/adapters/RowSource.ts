/**
 * The shared result and row-id types for writes.
 *
 * Before R6 Slice 2b this file also held the `RowSource` port, which had two implementations (`bases` and
 * `tabula-file`), both removed. What remains is what the native sync, the optimistic overlay and the write
 * queue still use: the row id, and the refusal, error and apply-result shapes. The file
 * keeps its name for now; renaming it is a follow-up.
 *
 * This file imports nothing that touches the vault, the DOM or React.
 */
import type { ResolvedField } from '../core/schema/propertySchema';
import type { PropertyId } from '../core/types';

/** A row id: the native `row_…` id of a row in a `.tablify` database. */
export type RowId = string;

/** The column list, in render order. */
export type PropertySchema = {
	readonly fields: readonly ResolvedField[];
};

/** Why a write was refused rather than attempted. Typed, so the UI can phrase it. */
export type Refusal = {
	readonly filePath: RowId;
	readonly propertyId: PropertyId;
	/** `readonly-column` when the column cannot be written; `not-writable` when the source cannot write. */
	readonly reason: 'readonly-column' | 'not-writable';
	/** One sentence for the user, e.g. "Created time is read-only". */
	readonly message: string;
};

/** A per-file failure. The file is named, the cause travels, and nothing is thrown at the caller. */
export type ApplyError = {
	readonly path: RowId;
	readonly propertyId?: PropertyId;
	readonly message: string;
	readonly cause?: unknown;
};

/** What `apply` reports back: what landed, what was refused, what failed. Never a bare boolean. */
export type ApplyResult = {
	readonly ok: boolean;
	/** Cells that reached the queue (or the in-memory document). */
	readonly written: number;
	/** Files touched, in the order they were first seen. */
	readonly files: readonly RowId[];
	readonly refused: readonly Refusal[];
	readonly errors: readonly ApplyError[];
};
