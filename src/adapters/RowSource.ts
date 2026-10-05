/**
 * The `RowSource` port: what the grid knows about where rows live.
 *
 * `docs/02-architecture.md` §the port gives the shape, and it is implemented here exactly — with three
 * naming decisions worth stating, because the prompt and the doc disagree slightly and the doc wins:
 *
 *  - the doc's flag is `writable`; the step prompt calls it `readonly`. Both exist: `writable` is the doc's
 *    name, and `readonly` is derived from it so a caller written against either spelling compiles.
 *  - the doc's `getSchema(): PropertySchema` is kept as the method name, and `PropertySchema` is defined
 *    here as the resolved column list the rest of the core already speaks (`ResolvedField[]`), because a
 *    second column type would be a second source of truth.
 *  - the doc's `apply(ops): Promise<ApplyResult>` is kept. `ApplyResult` reports partial success, which is
 *    the doc's requirement 2 ("all-or-nothing per file … partial success is reported, never hidden").
 *
 * This file imports nothing: no `obsidian`, no DOM, no React. The fixture source in the layout harness, the
 * fake vault in the tests and the real Bases adapter all satisfy the same structural type, and that is the
 * whole point of a port.
 */
import type { ResolvedField } from '../core/schema/propertySchema';
import type { Op } from '../core/ops/types';
import type { CellValue, PropertyId } from '../core/types';

/** A row id. A `TFile` path in `BasesSource`; a row id inside a `.tabula` file. */
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

/** The port. Two implementations exist and only one is ever primary. */
export interface RowSource {
	readonly kind: 'bases' | 'tabula-file';
	/** Per the doc. */
	readonly writable: boolean;
	/** The prompt's spelling of the same flag; `true` when a cell can be edited at all. */
	readonly readonly: boolean;
	/** Whether the source can add rows (a new note, a new row in a file). */
	readonly canCreateRows: boolean;
	/** Whether the source can remove rows. */
	readonly canDeleteRows: boolean;

	/** Column set, order, types and read-only flags. Cheap: called on every render pass. */
	getSchema(): PropertySchema;

	/** Rows in view order (already filtered/sorted/grouped by Bases or by `core/view`). */
	getRows(): readonly RowId[];

	/** Canonical value in core form. Must be O(1) and allocation-light: it runs for thousands of cells. */
	getValue(row: RowId, propertyId: PropertyId): CellValue;

	/** Human-facing label for a row: titles, conflict review, migration reports. */
	getRowLabel(row: RowId): string;

	/** The single mutation entry point. Applies atomically per file and reports per-file results. */
	apply(ops: readonly Op[]): Promise<ApplyResult>;

	/** Fires when the row set, a value, or the schema changed for any reason, including externally. */
	subscribe(listener: () => void): () => void;

	/** Resolves when every queued write has hit disk. Called on blur, view close and undo. */
	flush(): Promise<void>;
}

/** An empty result, for the paths that have nothing to report. */
export const EMPTY_APPLY_RESULT: ApplyResult = {
	ok: true,
	written: 0,
	files: [],
	refused: [],
	errors: [],
};

/** Builds an `ApplyResult` from its parts, so `ok` is computed in exactly one place. */
export function applyResult(parts: {
	readonly written: number;
	readonly files: readonly RowId[];
	readonly refused: readonly Refusal[];
	readonly errors: readonly ApplyError[];
}): ApplyResult {
	return {
		ok: parts.errors.length === 0 && parts.refused.length === 0,
		written: parts.written,
		files: parts.files,
		refused: parts.refused,
		errors: parts.errors,
	};
}

/** One line describing a result, for a status bar or a Notice. Used by the placeholder view. */
export function describeApplyResult(result: ApplyResult): string {
	const parts: string[] = [
		`${String(result.written)} cell(s) in ${String(result.files.length)} file(s)`,
	];
	if (result.refused.length > 0) {
		parts.push(`${String(result.refused.length)} refused`);
	}
	if (result.errors.length > 0) {
		parts.push(`${String(result.errors.length)} failed`);
	}
	return parts.join(', ');
}
