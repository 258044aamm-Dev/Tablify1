/**
 * AST → text. The filter builder and the query box are one system, so this is the other half of `parse.ts`:
 * whatever the builder produces must be readable by a person, and whatever a person types must survive a
 * round trip through the builder.
 *
 * **The round trip is exact for every AST the fixtures cover, and normalising in these seven ways.** Each
 * line is a decision, not an accident:
 *
 * 1. `Status = Done` and `Status:Done` are the same node, and the serialiser always writes the shorthand.
 * 2. `isNot` is written `Status != Done`, never `Status:!Done` — because `:!` is *type-resolved* in the
 *    legacy dialect (`isNot` on a select, `notContains` on text), so writing it would lose the meaning.
 * 3. `notContains` is written `Status:!~Done`, which is the only shorthand that can mean it on every type
 *    that declares it.
 * 4. `startsWith`/`endsWith` have no infix spelling in the documented grammar, so they are written as the
 *    function forms the dialect already uses for emptiness: `startsWith(Status, "Do")`.
 * 5. A comma list (`Tags:a,b`) parses into `or` of comparisons, so it serialises as `Tags:~a or Tags:~b`.
 * 6. `isEmpty`/`isNotEmpty` spelling: an AST that carries them as `cmp` nodes normalises to the `empty`
 *    node (`Status:empty`, `not (Status:empty)`), because that is the node the parser produces.
 * 7. An `unparsed` node is written back as its own text, so a filter that was half-typed survives a save
 *    and reload untouched, with its errors reporting again.
 * 8. **One shape is lossy on purpose.** An operand that is not a value any column can format (an object,
 *    which only a hand-edited sidecar produces) is written as its JSON text, quoted, so the query box shows
 *    something a person can repair. Reading it back offers that text to the column, which refuses it — so
 *    the round trip ends in an `unparsed` node plus an error rather than in silence. The object is gone
 *    either way; the difference is that the user is told.
 *
 * Lists of parts keep their order; `and([])`/`or([])` have no text at all and serialise to the empty
 * string, which parses back as "no filter" — documented because it is the one shape that does not survive.
 */
import type { ResolvedField } from '../schema/propertySchema';
import type { CellValue, FilterOpId } from '../types';
import { fieldById } from './ast';
import type { Expr, QueryContext } from './ast';

/** Operators whose operand is text rather than a value: see `readOperand` in `parse.ts`. */
const TEXT_OPERATORS: readonly FilterOpId[] = ['contains', 'notContains', 'startsWith', 'endsWith'];

/** Characters that would end a bare word or an operand: a name or value containing one gets quoted. */
const NEEDS_QUOTING = ' \t\n\r"(),:!~<>=';

/** One operator's infix spelling. The two anchors are absent on purpose: they use the function form. */
const INFIX: Readonly<Partial<Record<FilterOpId, string>>> = {
	is: ':',
	isNot: ' != ',
	contains: ':~',
	notContains: ':!~',
	gt: ':>',
	gte: ':>=',
	lt: ':<',
	lte: ':<=',
};

/** Wraps a name or a value in quotes when the grammar would otherwise read it as two things. */
function quotedIfNeeded(text: string): string {
	if (text === '' || [...text].some((char) => NEEDS_QUOTING.includes(char))) {
		return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
	}
	return text;
}

/** The text of one operand, whatever shape it arrived in. */
function operandText(field: ResolvedField | undefined, op: FilterOpId, operand: unknown): string {
	if (!TEXT_OPERATORS.includes(op) && field !== undefined && isCellValue(operand)) {
		const formatted = field.descriptor.formatPlain(operand, field.context);
		if (formatted !== '') {
			return quotedIfNeeded(formatted);
		}
	}
	return quotedIfNeeded(scalarText(operand));
}

/** A machine-readable spelling for a value that is not one the column can format (an untrusted operand). */
function scalarText(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (value === null || value === undefined) {
		return '';
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (isStringList(value)) {
		return value.join(',');
	}
	const encoded = JSON.stringify(value);
	return encoded === undefined ? '' : encoded;
}

/** The runtime shapes a canonical value may take. */
function isCellValue(value: unknown): value is CellValue {
	if (value === null) {
		return true;
	}
	const basic =
		typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
	return basic || isStringList(value);
}

function isStringList(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** The column's name as the DSL spells it: bare when it can be, quoted when it cannot. */
function nameOf(field: ResolvedField | undefined, id: string): string {
	return quotedIfNeeded(field === undefined ? id : field.definition.name);
}

/** The long spellings, used whenever the shorthand cannot carry the operand (it is quoted). */
const INFIX_LONG: Readonly<Partial<Record<FilterOpId, string>>> = {
	is: ' = ',
	isNot: ' != ',
	contains: ' ~ ',
	// `notContains` keeps its shorthand even for a quoted value: the lexer merges `!~` with the quote, so
	// this is still the one spelling that cannot be confused with `not (… contains …)`.
	notContains: ':!~',
	gt: ' > ',
	gte: ' >= ',
	lt: ' < ',
	lte: ' <= ',
};

/**
 * The `cmp` and `empty` nodes, in text.
 *
 * Two spellings per operator: the compact shorthand (`Status:Doing`) where the operand is a bare word, and
 * the infix form (`Status = "Ann Lee"`) where it is quoted. The infix form is not decoration — the
 * shorthand scanner stops at a quote when it already has an operator, so `Status:>"2026-01-01"` is *not*
 * readable text. Writing the form that reads back is the whole job of this module.
 */
function comparisonText(
	field: ResolvedField | undefined,
	id: string,
	op: FilterOpId,
	operand: unknown,
): string {
	const name = nameOf(field, id);
	if (op === 'isEmpty') {
		return `${name}:empty`;
	}
	if (op === 'isNotEmpty') {
		return `not (${name}:empty)`;
	}
	const text = operandText(field, op, operand);
	if (op === 'startsWith') {
		return `startsWith(${name}, ${text})`;
	}
	if (op === 'endsWith') {
		return `endsWith(${name}, ${text})`;
	}
	const quoted = text.startsWith('"');
	const chosen = quoted ? INFIX_LONG[op] : INFIX[op];
	if (chosen === undefined) {
		// An operator this build does not know: written as text so the reader sees what was stored.
		return `${name}:${scalarText(operand)}`;
	}
	return `${name}${chosen}${text}`;
}

/**
 * The query string for an expression. `null` and the empty identity nodes produce the empty string, which
 * the parser reads back as "no filter".
 */
export function toQueryString(expr: Expr | null, ctx: QueryContext): string {
	if (expr === null) {
		return '';
	}
	switch (expr.kind) {
		case 'and':
			return joinParts(expr.parts, ' and ', ctx, (part) => part.kind === 'or');
		case 'or':
			return joinParts(expr.parts, ' or ', ctx, () => false);
		case 'not': {
			const inner = toQueryString(expr.part, ctx);
			return inner === '' ? '' : `not (${inner})`;
		}
		case 'cmp':
			return comparisonText(
				fieldById(ctx, expr.fieldId),
				expr.fieldId,
				expr.op,
				expr.operand,
			);
		case 'empty':
			return `${nameOf(fieldById(ctx, expr.fieldId), expr.fieldId)}:empty`;
		case 'unparsed':
			return expr.text;
	}
}

/** Joins parts, bracketing the ones that would otherwise re-bind differently. */
function joinParts(
	parts: readonly Expr[],
	separator: string,
	ctx: QueryContext,
	needsBrackets: (part: Expr) => boolean,
): string {
	const rendered: string[] = [];
	for (const part of parts) {
		const text = toQueryString(part, ctx);
		if (text === '') {
			continue;
		}
		rendered.push(needsBrackets(part) ? `(${text})` : text);
	}
	return rendered.join(separator);
}
