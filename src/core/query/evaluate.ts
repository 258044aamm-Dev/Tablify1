/**
 * The evaluator: one row, one expression, a boolean. No Obsidian, no DOM, no clock, no mutation.
 *
 * Three behaviours here are decisions the docs did not make for us, so each is stated where it is
 * implemented and repeated in PROGRESS.md:
 *
 * 1. **An `unparsed` fragment never hides a row.** It evaluates to `true`, exactly as the old build dropped
 *    an unreadable token instead of failing the whole filter. The fragment is still *reported* — the errors
 *    from `parseQueryString` are what the UI shows — so the fix is visible without the grid going blank.
 * 2. **A filter that names a column the view does not have is ignored** (true), not false: a saved `.base`
 *    filter that mentions a deleted column must not hide the whole table while the user re-adds it.
 * 3. **`not` is boolean negation, and `isNot` is not.** `not (Status = Done)` is true for a row whose
 *    status is empty; `Status != Done` is false there, because the column's own contract answers false for
 *    every value operator on an empty cell (step 07's shared suite, and the old build behaved the same way).
 *    The distinction is intentional: `not` negates the *question*, `isNot` is the type's own operator, and
 *    the legacy `field:!value` maps to the latter so migrated filters keep their old rows.
 *
 * The evaluator dispatches through `FieldDescriptor.matches` and never looks at `descriptor.id`: adding a
 * field type must not require touching the query layer.
 */
import type { ResolvedField } from '../schema/propertySchema';
import type { CellValue, FilterOpId, PropertyId } from '../types';
import { fieldById } from './ast';
import type { Expr, QueryContext } from './ast';

/**
 * A row as the grid sees it: an identity and canonical values.
 *
 * `filePath` is both the identity and the sort tiebreak (see `buildView`), because a note *is* a row. The
 * values are already canonical — producing them is the adapter's job (step 12), and the query layer never
 * parses a stored value, so filtering cannot disagree with what a cell shows.
 */
export interface RowView {
	/** Vault-relative path of the note: `Projects/Widening.md`. Unique within a view. */
	readonly filePath: string;
	/** Canonical values by column id. A missing id and an empty cell are the same thing to a filter. */
	readonly cells: Readonly<Record<PropertyId, CellValue>>;
}

/** A cell value, with a missing key normalised to `null` — "no value" has one representation. */
export function cellOf(row: RowView, fieldId: PropertyId): CellValue {
	return row.cells[fieldId] ?? null;
}

/** Evaluates an expression against one row. `null` means "no filter": every row passes. */
export function evaluate(expr: Expr | null, row: RowView, ctx: QueryContext): boolean {
	if (expr === null) {
		return true;
	}
	switch (expr.kind) {
		case 'and': {
			// `every` short-circuits, so a cheap first condition makes the rest free.
			return expr.parts.every((part) => evaluate(part, row, ctx));
		}
		case 'or':
			return expr.parts.some((part) => evaluate(part, row, ctx));
		case 'not':
			return !evaluate(expr.part, row, ctx);
		case 'cmp': {
			const field = fieldById(ctx, expr.fieldId);
			if (field === undefined) {
				return true;
			}
			return field.descriptor.matches(
				cellOf(row, expr.fieldId),
				expr.op,
				expr.operand,
				field.context,
			);
		}
		case 'empty': {
			const field = fieldById(ctx, expr.fieldId);
			if (field === undefined || !field.descriptor.filterOps.includes('isEmpty')) {
				return false;
			}
			return field.descriptor.matches(
				cellOf(row, expr.fieldId),
				'isEmpty',
				null,
				field.context,
			);
		}
		case 'unparsed':
			return true;
	}
}

/** One column's complaint about a stored filter: what the filter banner shows, once per column. */
export type OperandProblem = {
	readonly fieldId: PropertyId;
	readonly columnName: string;
	readonly message: string;
};

/**
 * Why a stored filter will not do what it says. `evaluate` answers a boolean and nothing else — it runs per
 * row and must not allocate — so the diagnosis is a separate walk of the AST that the UI can call once,
 * which is also what makes "one message per column" cheap to honour.
 *
 * This exists because an AST can arrive from a `.base` sidecar rather than from the parser (see
 * `decodeQueryDocument`): a hand-edited operand, an operator a column never declared, or an emptiness test
 * on a column that has no empty state are all reachable, and a filter that silently matches nothing is the
 * worst possible failure mode.
 */
export function operandProblems(expr: Expr | null, ctx: QueryContext): readonly OperandProblem[] {
	const problems = new Map<PropertyId, OperandProblem>();
	const report = (
		fieldId: PropertyId,
		field: ResolvedField | undefined,
		message: string,
	): void => {
		if (!problems.has(fieldId)) {
			problems.set(fieldId, {
				fieldId,
				columnName: field === undefined ? fieldId : field.definition.name,
				message,
			});
		}
	};

	const walk = (node: Expr): void => {
		switch (node.kind) {
			case 'and':
			case 'or':
				for (const part of node.parts) {
					walk(part);
				}
				return;
			case 'not':
				walk(node.part);
				return;
			case 'empty': {
				const field = fieldById(ctx, node.fieldId);
				if (field === undefined) {
					report(
						node.fieldId,
						field,
						'this filter names a column that is not in this view',
					);
					return;
				}
				if (!field.descriptor.filterOps.includes('isEmpty')) {
					report(node.fieldId, field, `${field.definition.name} has no empty state`);
				}
				return;
			}
			case 'cmp': {
				const field = fieldById(ctx, node.fieldId);
				if (field === undefined) {
					report(
						node.fieldId,
						field,
						'this filter names a column that is not in this view',
					);
					return;
				}
				if (!field.descriptor.filterOps.includes(node.op)) {
					report(
						node.fieldId,
						field,
						`${field.definition.name} cannot be filtered with "${node.op}"`,
					);
					return;
				}
				const reading = operandProblemFor(field, node.op, node.operand);
				if (reading !== undefined) {
					report(node.fieldId, field, reading);
				}
				return;
			}
			case 'unparsed':
				return;
		}
	};

	if (expr !== null) {
		walk(expr);
	}
	return [...problems.values()];
}

/** Why one operand cannot be read back, or `undefined` when it can. */
function operandProblemFor(
	field: ResolvedField,
	op: FilterOpId,
	operand: unknown,
): string | undefined {
	const textOperators: readonly FilterOpId[] = [
		'contains',
		'notContains',
		'startsWith',
		'endsWith',
	];
	if (textOperators.includes(op)) {
		return typeof operand === 'string'
			? undefined
			: 'this filter is looking for text that is not text';
	}
	if (operand === null || operand === undefined) {
		return 'this filter has no value to compare against';
	}
	if (!isCellValue(operand)) {
		return 'the stored value is not a value this column can hold';
	}
	try {
		const text = field.descriptor.formatPlain(operand, field.context);
		const read = field.descriptor.parsePlain(text, field.context);
		if (!read.ok) {
			return `the stored value "${text}" cannot be read back — ${read.error}`;
		}
	} catch (error) {
		// `formatPlain` takes the column's *own* value type, so a stored operand of the wrong shape (a
		// boolean in a number column, say) can make it unhappy. This function's whole job is to explain a
		// broken filter, so it must not be the thing that throws: the shape mismatch is the explanation.
		const reason = error instanceof Error ? error.message : 'the column refused it';
		return `the stored value cannot be read back — ${reason}`;
	}
	return undefined;
}

/** The runtime shapes a canonical value may take. */
function isCellValue(value: unknown): value is CellValue {
	if (value === null) {
		return true;
	}
	const basic =
		typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
	if (basic) {
		return true;
	}
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
