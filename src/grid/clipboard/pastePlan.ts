/**
 * A pasted block, turned into a decision — **pure**, so the three modes can be tested without a clipboard, a
 * dialog or a browser.
 *
 * ## The three modes, and where their names come from
 *
 * The names are the prototype's (`prototype/js/dialogs.js` §"paste block dialog"), because that dialog is the
 * only place in this repository where the three are written down; a prompt that paraphrased them is not a
 * source. They are:
 *
 * | id | name as shipped | what it does |
 * |---|---|---|
 * | `cells` | **Fill cells from the selection** | overwrites the rectangle starting at the active cell; rows past the end of the table are created |
 * | `append` | **Append as new rows** | every pasted row becomes a new row at the bottom of the table |
 * | `create` | **Create rows from the block** | maps columns by header name when the first row looks like headers |
 *
 * ## When the dialog is shown at all
 *
 * Two triggers, and both are in the docs: the prototype asks above **60 rows** ("this paste is large"), and
 * `docs/01` §Import semantics makes the note-creating case mandatory ("the preview dialog is mandatory and must
 * state consequences"). `import.clipboardPasteMode` decides the rest — `ask` always asks, `expand` grows the
 * table without asking, and `fill` never grows it.
 *
 * ## What a paste may not do
 *
 * It may not create a *partial* set of rows: the row-creation half is one call the caller makes with the whole
 * list, so a cancel before it is a plan that was never applied. It may not write to a read-only column: those
 * cells are counted in `skipped` and reported, never asked for.
 */
import { parsePayload, widthOf } from './matrix';
import { selectField } from '../store/selectors';
import type { GridState } from '../store/types';
import type { CellRef, CellWrite } from '../../core/ops/types';
import type { CellValue, PropertyId } from '../../core/types';
import type { Matrix, ReadPayload } from './matrix';
import type { RangeOrder } from '../../core/selection/range';

/** The three modes, as data. `desc` is the sentence the dialog shows, worded as the prototype words it. */
export type PasteModeId = 'cells' | 'append' | 'create';

export type PasteMode = {
	readonly id: PasteModeId;
	readonly name: string;
	readonly desc: string;
};

export const PASTE_MODES: readonly PasteMode[] = [
	{
		id: 'cells',
		name: 'Fill cells from the selection',
		desc: 'Overwrites the rectangle starting at the active cell; rows past the end are created.',
	},
	{
		id: 'append',
		name: 'Append as new rows',
		desc: 'Adds every pasted row at the bottom of the table.',
	},
	{
		id: 'create',
		name: 'Create rows from the block',
		desc: 'Maps columns by header name when the first row looks like headers.',
	},
];

/** The setting's three values, from `src/plugin/settings/schema.ts` (`import.clipboardPasteMode`). */
export type PasteSetting = 'expand' | 'fill' | 'ask';

/** Above this many pasted rows the block is "large" whatever the table looks like (the prototype's number). */
export const LARGE_PASTE_ROWS = 60;

/** One new row a paste asks for: the values it should be created with, keyed by column. */
export type NewRowValues = ReadonlyMap<PropertyId, CellValue>;

/** What a paste will do, in numbers, before it does any of it. */
export type PastePlan = {
	readonly mode: PasteModeId;
	/** Rows and columns in the block as it arrived. */
	readonly rows: number;
	readonly columns: number;
	/** Cells written into rows that already exist — one `setCells` op, whatever the count. */
	readonly writes: readonly CellWrite[];
	/** Rows the *view* must create (a row is a note); empty for a paste that fits. */
	readonly newRows: readonly NewRowValues[];
	/** Cells the block had that no column could take: past the last column, or a read-only column. */
	readonly skipped: number;
	/** Cells a `fill`-mode paste deliberately left on the clipboard. */
	readonly clipped: number;
	/** True when `cells` had to grow the table to fit the block. */
	readonly grows: boolean;
	/** Set when the block was larger than the row set, or larger than the "large paste" threshold. */
	readonly large: boolean;
	/** The header mapping `create` found, or `null` when it fell back to filling cells. */
	readonly mappedBy: readonly string[] | null;
};

/** Input for a plan: the block, the view, the anchor, and the settings that change the answer. */
export type PastePlanInput = {
	readonly matrix: Matrix;
	readonly state: GridState;
	readonly order: RangeOrder;
	/** The active cell — where `cells` starts, and which column `append` maps from. */
	readonly anchor: CellRef | null;
	/** The landing mode. Optional only so a caller can hold "everything except the mode" (the dialog's base). */
	readonly mode?: PasteModeId | undefined;
	readonly setting: PasteSetting;
	/** Rows above which a paste is called large in the dialog (`import.largeImportThreshold`). */
	readonly largeThreshold: number;
};

/** Whether the block fits the view from the anchor: nothing to create, nothing clipped. */
export function fits(matrix: Matrix, order: RangeOrder, anchor: CellRef | null): boolean {
	if (anchor === null) {
		return false;
	}
	const rowIndex = order.rows.indexOf(anchor.filePath);
	const columnIndex = order.fields.indexOf(anchor.fieldId);
	if (rowIndex === -1 || columnIndex === -1) {
		return false;
	}
	return (
		rowIndex + matrix.length <= order.rows.length &&
		columnIndex + widthOf(matrix) <= order.fields.length
	);
}

/**
 * The column a block's column `index` lands in. Without a header mapping it is the column `index` places to the
 * right of the anchor; with one, it is the column whose *name* the header cell names — which is the whole point
 * of `create`, and why an unmatched header is counted as skipped rather than shifted into the next column.
 */
function targetColumn(
	order: RangeOrder,
	anchorColumn: number,
	headerNames: readonly string[] | null,
	index: number,
	fields: readonly { readonly id: PropertyId; readonly name: string }[],
): PropertyId | undefined {
	if (headerNames === null) {
		return order.fields[anchorColumn + index];
	}
	const wanted = (headerNames[index] ?? '').trim().toLowerCase();
	return fields.find((field) => field.name.trim().toLowerCase() === wanted)?.id;
}

/**
 * Plans a paste. Nothing here writes: the answer is a list of writes plus a list of rows to create, and the
 * caller applies it — or does not, because a cancelled dialog is a plan that was never applied.
 */
export function planPaste(input: PastePlanInput): PastePlan {
	const { matrix, state, order, anchor, setting, largeThreshold } = input;
	// The default is `cells`: the only mode that means anything without someone choosing (`append` and `create`
	// are the two answers the dialog exists to offer).
	const mode: PasteModeId = input.mode ?? 'cells';
	const rows = matrix.length;
	const columns = widthOf(matrix);
	const fields = state.fields.map((field) => ({
		id: field.definition.id,
		name: field.definition.name,
	}));
	const names = fields.map((field) => field.name.trim().toLowerCase());
	const headerRow = matrix[0] ?? [];
	const createByHeader =
		mode === 'create' &&
		matrix.length > 1 &&
		headerRow.filter((cell) => names.includes(cell.trim().toLowerCase())).length >= 2;
	// `create` without a header line behaves as `cells`: the prototype's own fallback, and the only reading
	// under which the mode is never a no-op.
	const effective: PasteModeId = mode === 'create' && !createByHeader ? 'cells' : mode;
	const headerNames: readonly string[] | null = createByHeader
		? headerRow.map((cell) => cell.trim().toLowerCase())
		: null;
	const body: Matrix = createByHeader ? matrix.slice(1) : matrix;

	/** Text → canonical value, through the column's own descriptor. A column that refuses is counted. */
	const parseInto = (
		fieldId: PropertyId,
		text: string,
	): { readonly ok: boolean; readonly value: CellValue } => {
		const field = selectField(state, fieldId);
		if (field === undefined || field.readOnly || !field.descriptor.editable) {
			return { ok: false, value: null };
		}
		const parsed = field.descriptor.parsePlain(text, field.context);
		return { ok: parsed.ok, value: parsed.ok ? parsed.value : null };
	};

	/** One line of the block as a row's worth of canonical values, counting whatever no column could take. */
	const valuesOf = (line: readonly string[], counts: { skipped: number }): NewRowValues => {
		const values = new Map<PropertyId, CellValue>();
		line.forEach((text, index) => {
			const fieldId = targetColumn(order, anchorColumn, headerNames, index, fields);
			if (fieldId === undefined) {
				counts.skipped += 1;
				return;
			}
			const parsed = parseInto(fieldId, text);
			if (!parsed.ok) {
				counts.skipped += 1;
				return;
			}
			if (parsed.value !== null) {
				values.set(fieldId, parsed.value);
			}
		});
		return values;
	};

	const writes: CellWrite[] = [];
	const newRows: NewRowValues[] = [];
	const counts = { skipped: 0 };
	let clipped = 0;
	let grows = false;

	const anchorRow = anchor === null ? 0 : Math.max(0, order.rows.indexOf(anchor.filePath));
	const anchorColumn = anchor === null ? 0 : Math.max(0, order.fields.indexOf(anchor.fieldId));

	if (effective === 'append') {
		// Every block row becomes a new row. The values travel to the *view* — it creates the note with its
		// frontmatter (`docs/03` §Row creation) — so `writes` stays empty in this mode: there is nothing to
		// write into a row that does not exist yet.
		for (const line of body) {
			newRows.push(valuesOf(line, counts));
		}
	} else {
		const grow = setting !== 'fill';
		body.forEach((line, rowOffset) => {
			const existing = order.rows[anchorRow + rowOffset];
			if (existing === undefined) {
				if (!grow) {
					clipped += line.length;
					return;
				}
				grows = true;
				newRows.push(valuesOf(line, counts));
				return;
			}
			line.forEach((text, index) => {
				const fieldId = targetColumn(order, anchorColumn, headerNames, index, fields);
				if (fieldId === undefined) {
					counts.skipped += 1;
					return;
				}
				const parsed = parseInto(fieldId, text);
				if (!parsed.ok) {
					counts.skipped += 1;
					return;
				}
				writes.push({ filePath: existing, fieldId, value: parsed.value });
			});
		});
	}

	return {
		mode: effective,
		rows,
		columns,
		writes,
		newRows,
		skipped: counts.skipped,
		clipped,
		grows,
		large: rows > LARGE_PASTE_ROWS || rows > largeThreshold || !fits(matrix, order, anchor),
		mappedBy: headerNames,
	};
}

/**
 * Whether the plan needs a dialog before it runs. Three ways to need one, and none of them is "maybe":
 *
 *   · the setting says `ask` — the person asked to be asked, every time;
 *   · the block is large — more than `LARGE_PASTE_ROWS`, above the import threshold, or bigger than the table
 *     from the anchor (the prototype asks above 60 rows; the dialog is the same one);
 *   · the plan will **create notes**. `docs/01` §Import semantics makes the preview mandatory for a
 *     note-creating operation, and a paste that appends rows is exactly that. This is the clause that makes
 *     "never create notes without the confirmation dialog" true even with `expand` set.
 */
export function needsDialog(plan: PastePlan, setting: PasteSetting): boolean {
	if (setting === 'ask') {
		return true;
	}
	if (plan.large) {
		return true;
	}
	return plan.newRows.length > 0;
}

/** The sentence the dialog's subtitle and the live region both use. One wording, two readers. */
export function describePlan(plan: PastePlan): string {
	const parts = [`${String(plan.rows)} × ${String(plan.columns)} block`];
	if (plan.writes.length > 0) {
		parts.push(`${String(plan.writes.length)} cell(s) updated`);
	}
	if (plan.newRows.length > 0) {
		parts.push(`${String(plan.newRows.length)} note(s) created`);
	}
	if (plan.mappedBy !== null) {
		parts.push('columns matched by header name');
	}
	if (plan.skipped > 0) {
		parts.push(`${String(plan.skipped)} cell(s) outside the table, ignored`);
	}
	if (plan.clipped > 0) {
		parts.push(`${String(plan.clipped)} cell(s) left on the clipboard`);
	}
	return parts.join(' · ');
}

/**
 * The label one undo step gets. Read by the undo menu and by the toolbar's Redo tooltip, so it says what
 * happened, not just "Paste".
 *
 * **Counted, not bracketed.** `Paste 4 cell(s)` was the first spelling and it is the one thing in the undo
 * history that read differently from everything else: `Clear 4 cells`, `Fill down 12 cells` and `Edit cell` come
 * from the commands layer's own `plural()`, and a paste is in that same list of steps. A one-cell paste says
 * `Paste 1 cell`, which is also the case a `(s)` hides.
 */
export function pasteLabel(plan: PastePlan): string {
	if (plan.mode === 'append') {
		return count(
			plan.newRows.length,
			'Append 1 row',
			`Append ${String(plan.newRows.length)} rows`,
		);
	}
	if (plan.mappedBy !== null) {
		return count(
			plan.newRows.length,
			'Paste 1 row by header',
			`Paste ${String(plan.newRows.length)} rows by header`,
		);
	}
	return count(plan.writes.length, 'Paste 1 cell', `Paste ${String(plan.writes.length)} cells`);
}

/** `count === 1 ? one : many`, so a label that names one thing does not read "1 cells". */
function count(value: number, one: string, many: string): string {
	return value === 1 ? one : many;
}

/** The clipboard payload read *and* planned in one call, so the two can never disagree about the matrix. */
export function readAndPlan(
	input: Omit<PastePlanInput, 'matrix'> & {
		readonly payload: { readonly html: string; readonly text: string };
	},
): { readonly read: ReadPayload; readonly plan: PastePlan } {
	const read = parsePayload(input.payload);
	return { read, plan: planPaste({ ...input, matrix: read.matrix }) };
}

/*
 * **The type table of "empty", which clearing does not need.** An earlier pass of this step had a helper here
 * that asked each column what it stores for nothing; it was removed because the answer is *the same for all
 * sixteen types*, and a table with one row is a table that invites a second. Measured on the frozen registry:
 *
 *     text longText number checkbox date datetime url email phone singleSelect multiSelect rating
 *     currency percent duration attachment        — `toJson(null) === null` and `parsePlain('') === null`
 *
 * So clearing writes a canonical `null` and the write queue deletes the key — `docs/03` §write rules 3,
 * *"Clearing deletes the key rather than writing `\"\"`/`null`"*, and it is the deletion, not a value, that a
 * cleared cell keeps. The invariant is asserted over `allFields()` in `tests/unit/clear-table.test.ts`, so a new
 * type that *does* require a representation on clear fails a test instead of quietly writing `''`.
 */
