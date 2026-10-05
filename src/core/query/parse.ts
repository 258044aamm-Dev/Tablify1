/**
 * The query-string DSL: text in, AST plus character offsets out.
 *
 * Two dialects are read, because the product has two:
 *
 * 1. **The documented one** — `"Owner Name" = "Ann Lee"`, `Estimate >= 4`, `Due < 2026-01-01`,
 *    `Status != Done`, `Name ~ road`, `not (Status:empty)`, `A:1 or (B:2 and C:3)`. It is what the filter
 *    builder writes and what a person reads.
 * 2. **The legacy one**, from the old build's README: `status:Done`, `field:~value`, `field:>n`,
 *    `field:<n`, `field:!value`, `field:a,b`, `field:empty`, `empty(Field)`, `notEmpty(Field)`,
 *    juxtaposition for AND and `or` for union. Legacy filters must keep their old meaning, so every form
 *    there is accepted and mapped onto the canonical operator set — never onto a new node kind.
 *
 * Three rules make the parser total, which is the property the property test then attacks:
 *
 * - **It never throws.** Every failure is an entry in `errors` with a span, and the fragment it belongs to
 *   becomes an `unparsed` node, so the rest of the filter still parses and still works.
 * - **Every loop consumes at least one token**, and recursion is depth-capped, so no input can spin.
 * - **Ambiguity is resolved by the column.** `field:!x` means `isNot` on a select (that is what the legacy
 *   README says), `notContains` on a text-shaped column, and `not(is x)` elsewhere; anchors have no infix
 *   spelling, so they are written as the function forms the dialect already has for emptiness.
 */
import type { ResolvedField } from '../schema/propertySchema';
import type { FilterOpId } from '../types';
import { andOf, comparison, emptyOf, fieldByName, notOf, orOf, unparsedOf } from './ast';
import type { Expr, QueryContext } from './ast';

/** One thing that could not be read, and where it sits in the input. Offsets are UTF-16 code units. */
export type QueryError = {
	readonly message: string;
	readonly start: number;
	readonly end: number;
};

/** What `parseQueryString` answers: the expression (`null` when there is none) and what it could not read. */
export type ParseResult = {
	readonly ast: Expr | null;
	readonly errors: readonly QueryError[];
};

/**
 * How deep parentheses may nest. A cap is not a nicety: it is what makes "the parser is total" true for a
 * hand-typed string of ten thousand open brackets, and the message says so when it is reached.
 */
const MAX_DEPTH = 24;

/** Operators that take text, not a value: a substring search reads the raw operand as written. */
const TEXT_OPERATORS: readonly FilterOpId[] = ['contains', 'notContains', 'startsWith', 'endsWith'];

/** Function spellings, lower-cased. This is the only way to write an anchor in this grammar. */
const FUNCTIONS: readonly string[] = ['empty', 'notempty', 'startswith', 'endswith', 'contains'];

type TokenKind =
	'word' | 'quoted' | 'lparen' | 'rparen' | 'comma' | 'colon' | 'shorthand' | 'op' | 'bang';

type Token = {
	readonly kind: TokenKind;
	readonly text: string;
	readonly start: number;
	readonly end: number;
};

/** Characters that end a bare word. Everything else, including `:`, is part of one. */
const WORD_STOP = ' \t\n\r"(),:!~<>=';

/** Characters that end an operand typed in the colon shorthand. A colon is allowed *inside* one. */
const SHORTHAND_STOP = ' \t\n\r"(),';

/** Comparison operator spellings the DSL accepts, longest first so `>=` never lexes as `>`. */
const OPERATOR_SPELLINGS: readonly string[] = ['>=', '<=', '!=', '=', '>', '<', '~'];

/** The comparison operator a spelling maps to. */
const OPERATOR_IDS: Readonly<Record<string, FilterOpId>> = {
	'=': 'is',
	'!=': 'isNot',
	'>': 'gt',
	'>=': 'gte',
	'<': 'lt',
	'<=': 'lte',
	'~': 'contains',
};

/** A source span: what `QueryError` carries, and what an `unparsed` fragment is cut with. */
type Span = {
	readonly start: number;
	readonly end: number;
};

type Lexed = {
	readonly tokens: readonly Token[];
	readonly errors: readonly QueryError[];
};

/**
 * Splits the input. Offsets are kept on every token, because that is what the UI needs to underline the
 * offending span, and a fragment that fails becomes `text.slice(start, end)`.
 */
export function tokenize(text: string): Lexed {
	const tokens: Token[] = [];
	const errors: QueryError[] = [];
	let index = 0;
	// After a `:` or a `,` the next run of characters is an operand, where a colon is just a character —
	// which is what lets `Site:https://example.com` and `Tags:draft,urgent` lex as they should.
	let operandNext = false;

	while (index < text.length) {
		const char = text.charAt(index);
		if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
			index += 1;
			continue;
		}
		if (char === '(' || char === ')') {
			tokens.push({
				kind: char === '(' ? 'lparen' : 'rparen',
				text: char,
				start: index,
				end: index + 1,
			});
			index += 1;
			operandNext = false;
			continue;
		}
		if (char === ',' || char === ':') {
			tokens.push({
				kind: char === ',' ? 'comma' : 'colon',
				text: char,
				start: index,
				end: index + 1,
			});
			index += 1;
			operandNext = true;
			continue;
		}
		if (char === '"') {
			const scanned = scanQuoted(text, index);
			tokens.push(scanned.token);
			if (scanned.error !== undefined) {
				errors.push(scanned.error);
			}
			index = scanned.token.end;
			operandNext = false;
			continue;
		}
		if (!operandNext) {
			const spelling = OPERATOR_SPELLINGS.find((candidate) =>
				text.startsWith(candidate, index),
			);
			if (spelling !== undefined) {
				tokens.push({
					kind: 'op',
					text: spelling,
					start: index,
					end: index + spelling.length,
				});
				index += spelling.length;
				continue;
			}
			if (char === '!') {
				tokens.push({ kind: 'bang', text: '!', start: index, end: index + 1 });
				index += 1;
				continue;
			}
		}
		const stop = operandNext ? SHORTHAND_STOP : WORD_STOP;
		let end = index;
		while (end < text.length && !stop.includes(text.charAt(end))) {
			end += 1;
		}
		if (end === index) {
			// A character that stops both scanners (a stray `=` in operand position, say) still has to be
			// consumed: a token that consumed nothing would make the loops below non-terminating.
			end = index + 1;
		}
		let value = text.slice(index, end);
		// `Name:>"2026-01-01"`: an operator followed by a quoted operand is one shorthand, so the operator
		// and the value it applies to cannot be split by the quote.
		if (operandNext && end < text.length && text.charAt(end) === '"') {
			const scanned = scanQuoted(text, end);
			value += scanned.token.text;
			end = scanned.token.end;
			if (scanned.error !== undefined) {
				errors.push(scanned.error);
			}
		}
		tokens.push({
			kind: operandNext ? 'shorthand' : 'word',
			text: value,
			start: index,
			end,
		});
		index = end;
		operandNext = false;
	}

	return { tokens, errors };
}

/** One quoted string, with `\"` and `\\` escapes. An unterminated one runs to the end and reports itself. */
function scanQuoted(
	text: string,
	start: number,
): { readonly token: Token; readonly error?: QueryError } {
	let value = '';
	let index = start + 1;
	let closed = false;
	while (index < text.length) {
		const char = text.charAt(index);
		if (char === '\\' && index + 1 < text.length) {
			value += text.charAt(index + 1);
			index += 2;
			continue;
		}
		if (char === '"') {
			closed = true;
			index += 1;
			break;
		}
		value += char;
		index += 1;
	}
	const token: Token = { kind: 'quoted', text: value, start, end: index };
	if (closed) {
		return { token };
	}
	return {
		token,
		error: { message: 'this quoted name or value is never closed', start, end: index },
	};
}

/** What one parsed operand turned out to be: a value the column's own reader produced, or a reason. */
type OperandRead =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly message: string };

/**
 * Reads an operand the way a typed cell would be read, with one exception: a text operator takes the raw
 * text. That exception is not a shortcut — it is the contract. `contains` on a multi-select column matches
 * a *label substring*, so handing it a parsed value would ask the wrong question; every other operator
 * compares whole values, so the column's own `parsePlain` is exactly the reader that decides what the user
 * meant (`2026-01-01`, `true`, `45m`, `25%`, `Doing`).
 */
function readOperand(field: ResolvedField, op: FilterOpId, text: string): OperandRead {
	if (TEXT_OPERATORS.includes(op)) {
		if (text === '') {
			return { ok: false, message: `the "${op}" operator needs something to look for` };
		}
		return { ok: true, value: text };
	}
	const read = field.descriptor.parsePlain(text, field.context);
	if (!read.ok) {
		return {
			ok: false,
			message: `"${text}" is not a value ${field.definition.name} can hold — ${read.error}`,
		};
	}
	return { ok: true, value: read.value };
}

/** The operator a bare value means on this column: a list column searches, everything else compares. */
function defaultOperator(field: ResolvedField): FilterOpId {
	const type = field.descriptor.id;
	return type === 'multiSelect' || type === 'attachment' ? 'contains' : 'is';
}

/** What the legacy `field:!value` means, which depends on the column — that is the README's table, kept. */
function negatedOperator(field: ResolvedField): FilterOpId | undefined {
	const declared = field.descriptor.filterOps;
	if (field.descriptor.id === 'singleSelect' && declared.includes('isNot')) {
		return 'isNot';
	}
	if (declared.includes('notContains')) {
		return 'notContains';
	}
	if (declared.includes('isNot')) {
		return 'isNot';
	}
	return undefined;
}

/** True when the operand text is the emptiness word, in either spelling. */
function isEmptinessWord(text: string): boolean {
	const lower = text.toLocaleLowerCase();
	return lower === 'empty' || lower === 'blank';
}

/**
 * The parser: recursive descent over the token list, where every failure path returns an `unparsed` node
 * (never `null` unless there is genuinely nothing left to read). That is what keeps a typo from taking the
 * rest of a filter down with it.
 */
class Parser {
	private readonly text: string;
	private readonly ctx: QueryContext;
	private readonly tokens: readonly Token[];
	private readonly errors: QueryError[];
	private index = 0;

	constructor(lexed: Lexed, text: string, ctx: QueryContext) {
		this.text = text;
		this.ctx = ctx;
		this.tokens = lexed.tokens;
		this.errors = [...lexed.errors];
	}

	/** Parses the whole input, then reports whatever is left over. */
	parse(): ParseResult {
		if (this.tokens.length === 0) {
			return { ast: null, errors: this.errors };
		}
		const ast = this.parseOr(0);
		const leftover = this.peek();
		if (leftover !== undefined) {
			const last = this.tokens[this.tokens.length - 1];
			const end = last === undefined ? leftover.end : last.end;
			this.fail(
				leftover.start,
				end,
				`"${this.text.slice(leftover.start, end)}" is not part of a filter`,
			);
			return {
				ast:
					ast === null
						? unparsedOf(this.text.slice(leftover.start, end))
						: andOf([ast, unparsedOf(this.text.slice(leftover.start, end))]),
				errors: this.errors,
			};
		}
		return { ast, errors: this.errors };
	}

	/** `and` binds tighter than `or`. */
	private parseOr(depth: number): Expr | null {
		const parts: Expr[] = [];
		const first = this.parseAnd(depth);
		if (first !== null) {
			parts.push(first);
		}
		while (this.isKeyword('or')) {
			const keyword = this.peek();
			this.index += 1;
			if (!this.startsAtom()) {
				// A dangling `or` is a typo worth reporting: the rest of the filter is still read.
				if (keyword !== undefined) {
					this.fail(keyword.start, keyword.end, 'this "or" has nothing after it');
				}
				break;
			}
			const part = this.parseAnd(depth);
			if (part !== null) {
				parts.push(part);
			}
		}
		return parts.length === 0 ? null : orOf(parts);
	}

	/** Juxtaposition means AND as well, because the legacy dialect relies on it. */
	private parseAnd(depth: number): Expr | null {
		const parts: Expr[] = [];
		const first = this.parseUnary(depth);
		if (first !== null) {
			parts.push(first);
		}
		for (;;) {
			if (this.isKeyword('and')) {
				const keyword = this.peek();
				this.index += 1;
				if (!this.startsAtom()) {
					if (keyword !== undefined) {
						this.fail(keyword.start, keyword.end, 'this "and" has nothing after it');
					}
					break;
				}
			} else if (!this.startsAtom()) {
				break;
			}
			const before = this.index;
			const part = this.parseUnary(depth);
			if (part !== null) {
				parts.push(part);
			}
			if (this.index === before) {
				// Nothing was consumed (a stray `)` in the middle, say): step over it once and stop, so the
				// loop cannot spin.
				this.index += 1;
				break;
			}
		}
		return parts.length === 0 ? null : andOf(parts);
	}

	private parseUnary(depth: number): Expr | null {
		const token = this.peek();
		if (token === undefined) {
			return null;
		}
		if (token.kind === 'lparen') {
			this.index += 1;
			const after = this.indexAfterMatchingParen();
			const closing = this.tokens[after - 1];
			const span: Span = {
				start: token.start,
				end: closing === undefined ? token.end : closing.end,
			};
			if (depth + 1 > MAX_DEPTH) {
				this.fail(
					span.start,
					span.end,
					`parentheses are nested more than ${String(MAX_DEPTH)} deep`,
				);
				this.index = after;
				return unparsedOf(this.text.slice(span.start, span.end));
			}
			const inner = this.parseOr(depth + 1);
			if (this.peek()?.kind === 'rparen') {
				this.index += 1;
			} else {
				this.fail(span.start, span.end, 'this group is never closed');
				this.index = after;
			}
			return inner ?? unparsedOf(this.text.slice(span.start, span.end));
		}
		if (this.isKeyword('not')) {
			this.index += 1;
			const inner = this.parseUnary(depth + 1);
			if (inner === null) {
				this.fail(token.start, token.end, '`not` needs something to negate');
				return unparsedOf(this.text.slice(token.start, token.end));
			}
			return notOf(inner);
		}
		if (token.kind === 'word' || token.kind === 'quoted') {
			return this.parseAtom();
		}
		return null;
	}

	/** `field:…`, `field op value`, `field is …`, or a function call. */
	private parseAtom(): Expr | null {
		const name = this.next();
		if (name === undefined) {
			return null;
		}
		const lower = name.text.toLocaleLowerCase();
		const isFunction = this.peek()?.kind === 'lparen' && FUNCTIONS.includes(lower);
		if (isFunction) {
			return this.parseFunction(fieldByName(this.ctx, name.text), name);
		}
		const field = fieldByName(this.ctx, name.text);
		if (field === undefined) {
			const span = this.spanToNextBoundary(name);
			this.fail(name.start, span, `there is no column named "${name.text}"`);
			this.consumeToBoundary(name);
			return unparsedOf(this.text.slice(name.start, span));
		}
		const colon = this.peek();
		if (colon?.kind === 'colon') {
			this.index += 1;
			return this.parseShorthand(field, colon);
		}
		const operator = this.peek();
		if (operator?.kind === 'op') {
			this.index += 1;
			return this.parseInfix(field, operator);
		}
		if (this.isKeyword('is')) {
			this.index += 1;
			return this.parseIs(field, name);
		}
		const span = this.spanToNextBoundary(name);
		this.fail(
			name.start,
			span,
			`"${field.definition.name}" needs an operator — try ${field.definition.name}:value or ${field.definition.name} = value`,
		);
		this.consumeToBoundary(name);
		return unparsedOf(this.text.slice(name.start, span));
	}

	/** `Status:value`, and the whole legacy shorthand family including the comma list. */
	private parseShorthand(field: ResolvedField, colon: Token): Expr {
		const operand = this.next();
		if (operand === undefined || !this.isOperand(operand)) {
			this.fail(colon.start, colon.end, `"${field.definition.name}:" has nothing after it`);
			return unparsedOf(this.text.slice(colon.start, colon.end));
		}

		const nodes: Expr[] = [];
		let current: Token | undefined = operand;
		for (;;) {
			const decoded = this.decodeShorthand(field, current);
			if (decoded !== undefined) {
				nodes.push(decoded);
			}
			if (this.peek()?.kind !== 'comma') {
				break;
			}
			this.index += 1;
			const following = this.peek();
			if (following === undefined || following.kind === 'rparen') {
				break;
			}
			current = this.next();
			if (current === undefined) {
				break;
			}
		}
		if (nodes.length === 0) {
			// Every item failed; the reasons are already in `errors`. This fragment reports itself.
			return unparsedOf(this.text.slice(colon.start, operand.end));
		}
		return orOf(nodes);
	}

	/** One shorthand operand: optional `!`, optional operator, then the value. */
	private decodeShorthand(field: ResolvedField, token: Token): Expr | undefined {
		let text = token.text;
		let offset = token.start;
		let negated = false;
		if (text.startsWith('!')) {
			negated = true;
			text = text.slice(1);
			offset += 1;
		}
		const spelling = ['>=', '<=', '!=', '>', '<', '=', '~'].find((candidate) =>
			text.startsWith(candidate),
		);
		let operator: FilterOpId | undefined;
		if (spelling !== undefined) {
			operator = OPERATOR_IDS[spelling];
			text = text.slice(spelling.length);
			offset += spelling.length;
		}
		const span: Span = { start: offset, end: token.end };
		if (text === '') {
			this.fail(span.start, span.end, `"${token.text}" is missing its value`);
			return undefined;
		}
		if (isEmptinessWord(text)) {
			if (operator !== undefined) {
				this.fail(span.start, span.end, `"${token.text}" is not a value`);
				return undefined;
			}
			return this.buildEmpty(field, negated, token);
		}
		if (operator === undefined && negated) {
			const legacy = negatedOperator(field);
			const resolved = legacy ?? 'contains';
			const node = this.buildComparison(field, resolved, text, span.start, span.end);
			if (node === undefined) {
				return undefined;
			}
			return legacy === undefined ? notOf(node) : node;
		}
		if (operator === 'contains' && negated) {
			const target: FilterOpId = field.descriptor.filterOps.includes('notContains')
				? 'notContains'
				: 'contains';
			const node = this.buildComparison(field, target, text, span.start, span.end);
			if (node === undefined) {
				return undefined;
			}
			return target === 'contains' ? notOf(node) : node;
		}
		const resolved = operator ?? defaultOperator(field);
		const node = this.buildComparison(field, resolved, text, span.start, span.end);
		if (node === undefined) {
			return undefined;
		}
		return negated ? notOf(node) : node;
	}

	/** `field = value`, `field >= 4`, `field ~ road`. */
	private parseInfix(field: ResolvedField, operator: Token): Expr {
		const id = OPERATOR_IDS[operator.text];
		if (id === undefined) {
			this.fail(
				operator.start,
				operator.end,
				`"${operator.text}" is not an operator this build reads`,
			);
			return unparsedOf(operator.text);
		}
		const operand = this.peek();
		if (operand === undefined || !this.isOperand(operand)) {
			this.fail(operator.start, operator.end, `"${operator.text}" needs a value after it`);
			return unparsedOf(operator.text);
		}
		this.index += 1;
		const node = this.buildComparison(field, id, operand.text, operand.start, operand.end);
		return node ?? unparsedOf(operand.text);
	}

	/** `field is value`, `field is not value`, `field is empty`, `field is not empty`. */
	private parseIs(field: ResolvedField, name: Token): Expr {
		let negated = false;
		if (this.isKeyword('not')) {
			negated = true;
			this.index += 1;
		}
		const operand = this.peek();
		if (operand === undefined || !this.isOperand(operand)) {
			this.fail(
				name.start,
				name.end,
				`"${field.definition.name} is" needs a value or "empty"`,
			);
			return unparsedOf(this.text.slice(name.start, name.end));
		}
		this.index += 1;
		if (isEmptinessWord(operand.text)) {
			return this.buildEmpty(field, negated, operand);
		}
		const node = this.buildComparison(
			field,
			negated ? 'isNot' : 'is',
			operand.text,
			operand.start,
			operand.end,
		);
		return node ?? unparsedOf(operand.text);
	}

	/** `empty(Field)`, `notEmpty(Field)`, `startsWith(Field, "text")`, `endsWith(Field, "text")`. */
	private parseFunction(field: ResolvedField | undefined, name: Token): Expr {
		this.index += 1; // the `(`
		const first = this.next();
		const lower = name.text.toLocaleLowerCase();
		if (first === undefined || (first.kind !== 'word' && first.kind !== 'quoted')) {
			this.fail(name.start, name.end, `${name.text}(…) needs a column name`);
			this.closeCall();
			return unparsedOf(this.text.slice(name.start, name.end));
		}
		const target = field ?? fieldByName(this.ctx, first.text);
		if (lower === 'empty' || lower === 'notempty') {
			this.closeCall();
			if (target === undefined) {
				this.fail(first.start, first.end, `there is no column named "${first.text}"`);
				return unparsedOf(this.text.slice(name.start, first.end));
			}
			return this.buildEmpty(target, lower === 'notempty', first);
		}
		const separator = this.peek();
		if (separator?.kind !== 'comma') {
			this.closeCall();
			if (target === undefined) {
				this.fail(first.start, first.end, `there is no column named "${first.text}"`);
			} else {
				this.fail(name.start, first.end, `${name.text}(…) needs a comma and a value`);
			}
			return unparsedOf(this.text.slice(name.start, first.end));
		}
		this.index += 1;
		const operand = this.next();
		if (operand === undefined || !this.isOperand(operand)) {
			this.closeCall();
			this.fail(name.start, first.end, `${name.text}(…) needs a value after the comma`);
			return unparsedOf(this.text.slice(name.start, first.end));
		}
		this.closeCall();
		if (target === undefined) {
			this.fail(first.start, first.end, `there is no column named "${first.text}"`);
			return unparsedOf(this.text.slice(name.start, operand.end));
		}
		const op: FilterOpId =
			lower === 'startswith' ? 'startsWith' : lower === 'endswith' ? 'endsWith' : 'contains';
		const node = this.buildComparison(target, op, operand.text, operand.start, operand.end);
		return node ?? unparsedOf(this.text.slice(name.start, operand.end));
	}

	/** The `)` of a function call, consumed when it is there. */
	private closeCall(): void {
		if (this.peek()?.kind === 'rparen') {
			this.index += 1;
			return;
		}
		this.failAtCurrent('this call is never closed');
	}

	/** Builds a `cmp`, reading the operand — or records why it cannot, and answers `undefined`. */
	private buildComparison(
		field: ResolvedField,
		op: FilterOpId,
		text: string,
		start: number,
		end: number,
	): Expr | undefined {
		if (!field.descriptor.filterOps.includes(op)) {
			this.fail(start, end, `"${field.definition.name}" cannot be filtered with "${op}"`);
			return undefined;
		}
		const read = readOperand(field, op, text);
		if (!read.ok) {
			this.fail(start, end, read.message);
			return undefined;
		}
		return comparison(field.definition.id, op, read.value);
	}

	/** Builds an emptiness node, or reports that this column has no empty state. */
	private buildEmpty(field: ResolvedField, negated: boolean, token: Token): Expr {
		if (!field.descriptor.filterOps.includes('isEmpty')) {
			this.fail(token.start, token.end, `"${field.definition.name}" has no empty state`);
			return unparsedOf(token.text);
		}
		const node = emptyOf(field.definition.id);
		return negated ? notOf(node) : node;
	}

	private isOperand(token: Token): boolean {
		return token.kind === 'word' || token.kind === 'quoted' || token.kind === 'shorthand';
	}

	private peek(): Token | undefined {
		return this.tokens[this.index];
	}

	private next(): Token | undefined {
		const token = this.tokens[this.index];
		if (token !== undefined) {
			this.index += 1;
		}
		return token;
	}

	private isKeyword(word: string): boolean {
		const token = this.peek();
		return token?.kind === 'word' && token.text.toLocaleLowerCase() === word;
	}

	/** True when the next token can start a comparison: a word, a quoted name or an opening bracket. */
	private startsAtom(): boolean {
		const token = this.peek();
		if (token === undefined) {
			return false;
		}
		if (token.kind === 'lparen' || token.kind === 'quoted') {
			return true;
		}
		if (token.kind === 'word') {
			const lower = token.text.toLocaleLowerCase();
			return lower !== 'or' && lower !== 'and';
		}
		return false;
	}

	/**
	 * The span a failed fragment covers: from `from` to just before the next `or`, `and`, `)` or the end.
	 * Used for the `unparsed` node's text, so what the UI underlines is exactly what could not be read.
	 */
	private spanToNextBoundary(from: Token): number {
		let end = from.end;
		for (let index = this.index; index < this.tokens.length; index += 1) {
			const token = this.tokens[index];
			if (token === undefined || token.kind === 'rparen') {
				break;
			}
			if (token.kind === 'word') {
				const lower = token.text.toLocaleLowerCase();
				if (lower === 'or' || lower === 'and') {
					break;
				}
			}
			end = token.end;
		}
		return end;
	}

	/** Moves the cursor past the tokens a failed fragment covered, so parsing can resume. */
	private consumeToBoundary(from: Token): void {
		const limit = this.spanToNextBoundary(from);
		while (this.index < this.tokens.length) {
			const token = this.tokens[this.index];
			if (token === undefined || token.end > limit) {
				return;
			}
			this.index += 1;
		}
	}

	/** The index just after the `)` that closes the group the cursor is inside. */
	private indexAfterMatchingParen(): number {
		let depth = 1;
		for (let index = this.index; index < this.tokens.length; index += 1) {
			const token = this.tokens[index];
			if (token === undefined) {
				break;
			}
			if (token.kind === 'lparen') {
				depth += 1;
			}
			if (token.kind === 'rparen') {
				depth -= 1;
				if (depth === 0) {
					return index + 1;
				}
			}
		}
		return this.tokens.length;
	}

	private failAtCurrent(message: string): void {
		const token = this.peek();
		if (token === undefined) {
			this.fail(this.text.length, this.text.length, message);
			return;
		}
		this.fail(token.start, token.end, message);
	}

	private fail(start: number, end: number, message: string): void {
		this.errors.push({ message, start, end: Math.max(end, start) });
	}
}

/**
 * Parses a filter as a person typed it. Never throws; a fragment it cannot read becomes an `unparsed` node
 * that never hides a row (see `evaluate.ts`), and `errors` carries the spans to underline.
 */
export function parseQueryString(text: string, ctx: QueryContext): ParseResult {
	const lexed = tokenize(text);
	const parser = new Parser(lexed, text, ctx);
	return parser.parse();
}
