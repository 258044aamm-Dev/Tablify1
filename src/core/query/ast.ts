/**
 * The query AST: one closed union, plus the JSON shape a `.base` sidecar can carry.
 *
 * `docs/02-architecture.md` §Query sketched this layer with four node kinds. The step it was implemented
 * in requires six, and each addition has a job that the sketch could not express:
 *
 * - `empty` is its own kind rather than a `cmp` with a null operand, because emptiness is a property of
 *   *the cell*, not a value the user compares against, and the DSL has three spellings for it
 *   (`Status:empty`, `empty(Status)`, `Status is not empty`) that must all collapse to one node;
 * - `unparsed` keeps a fragment the parser could not read, so a typo is *reported* instead of silently
 *   deleting the rest of a filter. It never hides a row — see `evaluate()`.
 *
 * Two more decisions live here rather than in the parser:
 *
 * - **`and`/`or` are n-ary** (`parts`), not binary. A parser that produces `and(and(a, b), c)` makes every
 *   consumer flatten it; the constructors below flatten and collapse as they build, so an AST is already
 *   canonical and two spellings of the same filter are the same value.
 * - **The identity elements are the empty arrays**: `and([])` is true, `or([])` is false. There is no
 *   `true` node to invent, because `evaluate` can answer both without one.
 */
import type { ResolvedField } from '../schema/propertySchema';
import type { FilterOpId, PropertyId } from '../types';

/**
 * A filter expression. `parts` is never empty in practice (the constructors collapse), but an empty one
 * is still well-defined when it arrives from an untrusted file.
 */
export type Expr =
	| { readonly kind: 'and'; readonly parts: readonly Expr[] }
	| { readonly kind: 'or'; readonly parts: readonly Expr[] }
	| { readonly kind: 'not'; readonly part: Expr }
	| {
			readonly kind: 'cmp';
			readonly fieldId: PropertyId;
			readonly op: FilterOpId;
			readonly operand: unknown;
	  }
	| { readonly kind: 'empty'; readonly fieldId: PropertyId }
	| { readonly kind: 'unparsed'; readonly text: string };

/** Everything the query layer needs to resolve a column: the resolved fields of the view, in order. */
export type QueryContext = {
	readonly fields: readonly ResolvedField[];
};

/** A column by its id. */
export function fieldById(ctx: QueryContext, id: PropertyId): ResolvedField | undefined {
	return ctx.fields.find((field) => field.definition.id === id);
}

/**
 * A column by the name a person types in the DSL, case-insensitively — the same rule the old build used,
 * so `status:Done` still works after a column is renamed in case. The first match wins, which is why the
 * view's schema, not the DSL, decides a duplicate.
 */
export function fieldByName(ctx: QueryContext, name: string): ResolvedField | undefined {
	const wanted = name.trim().toLocaleLowerCase();
	return ctx.fields.find((field) => field.definition.name.toLocaleLowerCase() === wanted);
}

/** `and` of the given parts: flattens nested `and`s, keeps `unparsed` parts, collapses a single part. */
export function andOf(parts: readonly Expr[]): Expr {
	const flat: Expr[] = [];
	for (const part of parts) {
		if (part.kind === 'and') {
			flat.push(...part.parts);
		} else {
			flat.push(part);
		}
	}
	if (flat.length === 1) {
		const only = flat[0];
		if (only !== undefined) {
			return only;
		}
	}
	return { kind: 'and', parts: flat };
}

/** `or` of the given parts, flattened the same way. See {@link andOf}. */
export function orOf(parts: readonly Expr[]): Expr {
	const flat: Expr[] = [];
	for (const part of parts) {
		if (part.kind === 'or') {
			flat.push(...part.parts);
		} else {
			flat.push(part);
		}
	}
	if (flat.length === 1) {
		const only = flat[0];
		if (only !== undefined) {
			return only;
		}
	}
	return { kind: 'or', parts: flat };
}

/** Negation. `not(unparsed)` is kept as it is: it reports, and it still does not hide anything. */
export function notOf(part: Expr): Expr {
	return { kind: 'not', part };
}

/** A comparison. The operand is whatever the type's own reader produced (see `parse.ts`). */
export function comparison(fieldId: PropertyId, op: FilterOpId, operand: unknown): Expr {
	return { kind: 'cmp', fieldId, op, operand };
}

/** The emptiness node: "this cell has no value". */
export function emptyOf(fieldId: PropertyId): Expr {
	return { kind: 'empty', fieldId };
}

/** A fragment the parser could not read, kept verbatim so the UI can show the offending span. */
export function unparsedOf(text: string): Expr {
	return { kind: 'unparsed', text };
}

/**
 * The stored shape. It is versioned because it is written into the `.base` sidecar: a later build must be
 * able to tell an old document from a new one instead of guessing, and `decodeQueryDocument` refuses a
 * version it does not know rather than mis-reading it.
 */
export type QueryDocument = {
	readonly version: number;
	readonly expr: unknown;
};

/** The only version this build writes. Bump it when the union changes in a way older readers cannot read. */
export const QUERY_DOCUMENT_VERSION = 1;

/** The document to store for an expression (`null` means "no filter"). */
export function encodeQueryDocument(expr: Expr | null): QueryDocument {
	return { version: QUERY_DOCUMENT_VERSION, expr: expr === null ? null : encodeExpr(expr) };
}

/** A plain-JSON copy: nothing in the AST is a class, a Map or a function, so this is a structural copy. */
function encodeExpr(expr: Expr): unknown {
	switch (expr.kind) {
		case 'and':
		case 'or':
			return { kind: expr.kind, parts: expr.parts.map((part) => encodeExpr(part)) };
		case 'not':
			return { kind: 'not', part: encodeExpr(expr.part) };
		case 'cmp':
			return {
				kind: 'cmp',
				fieldId: expr.fieldId,
				op: expr.op,
				operand: expr.operand,
			};
		case 'empty':
			return { kind: 'empty', fieldId: expr.fieldId };
		case 'unparsed':
			return { kind: 'unparsed', text: expr.text };
	}
}

/** What `decodeQueryDocument` answers: the expression it could read, and what it had to drop. */
export type DecodedQuery = {
	readonly expr: Expr | null;
	readonly problems: readonly string[];
};

/**
 * Reads an untrusted document. Total by construction: this runs against hand-editable YAML, so every
 * failure is a returned problem, never a throw. An unknown node kind is dropped from its parent and named
 * in `problems`; a node that cannot be a filter at all is dropped in favour of the rest.
 */
export function decodeQueryDocument(raw: unknown): DecodedQuery {
	if (raw === null || raw === undefined) {
		return { expr: null, problems: [] };
	}
	if (!isRecord(raw)) {
		return { expr: null, problems: ['the stored query is not an object'] };
	}
	const version = raw['version'];
	if (typeof version !== 'number') {
		return { expr: null, problems: ['the stored query has no version'] };
	}
	if (version !== QUERY_DOCUMENT_VERSION) {
		return {
			expr: null,
			problems: [
				`the stored query is version ${String(version)}; this build writes ${String(QUERY_DOCUMENT_VERSION)}`,
			],
		};
	}
	const exprValue = raw['expr'];
	if (exprValue === null || exprValue === undefined) {
		// A document with no expression is a view with no filter — not a broken node. Every other shape is
		// handed to `decodeNode`, which explains itself.
		return { expr: null, problems: [] };
	}
	const problems: string[] = [];
	const expr = decodeNode(exprValue, problems, 'query');
	return { expr, problems };
}

/** A JSON object, as opposed to an array, a scalar or nothing. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const OPERATORS: readonly FilterOpId[] = [
	'is',
	'isNot',
	'contains',
	'notContains',
	'startsWith',
	'endsWith',
	'isEmpty',
	'isNotEmpty',
	'gt',
	'gte',
	'lt',
	'lte',
];

/** Narrows an untrusted string to a known operator, so a hand-edited `op` cannot reach a descriptor. */
export function isFilterOpId(value: unknown): value is FilterOpId {
	return typeof value === 'string' && OPERATORS.some((op) => op === value);
}

function decodeNode(raw: unknown, problems: string[], path: string): Expr | null {
	if (!isRecord(raw)) {
		problems.push(`${path} is not an object`);
		return null;
	}
	const kind = raw['kind'];
	if (kind === 'and' || kind === 'or') {
		const parts = raw['parts'];
		if (!Array.isArray(parts)) {
			problems.push(`${path} has no parts list`);
			return null;
		}
		const decoded: Expr[] = [];
		parts.forEach((part, index) => {
			const child = decodeNode(part, problems, `${path}.parts[${String(index)}]`);
			if (child !== null) {
				decoded.push(child);
			}
		});
		return kind === 'and' ? andOf(decoded) : orOf(decoded);
	}
	if (kind === 'not') {
		const part = decodeNode(raw['part'], problems, `${path}.part`);
		return part === null ? null : notOf(part);
	}
	if (kind === 'cmp') {
		const fieldId = raw['fieldId'];
		const op = raw['op'];
		if (typeof fieldId !== 'string') {
			problems.push(`${path} has no field id`);
			return null;
		}
		if (!isFilterOpId(op)) {
			problems.push(`${path} has an unknown operator`);
			return null;
		}
		return comparison(fieldId, op, raw['operand']);
	}
	if (kind === 'empty') {
		const fieldId = raw['fieldId'];
		if (typeof fieldId !== 'string') {
			problems.push(`${path} has no field id`);
			return null;
		}
		return emptyOf(fieldId);
	}
	if (kind === 'unparsed') {
		const text = raw['text'];
		return unparsedOf(typeof text === 'string' ? text : '');
	}
	problems.push(`${path} has an unknown kind`);
	return null;
}

/** The columns a filter names, in the order they first appear: what the "one message per column" UI wants. */
export function fieldsMentioned(expr: Expr | null): readonly PropertyId[] {
	const seen = new Set<PropertyId>();
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
			case 'cmp':
			case 'empty':
				seen.add(node.fieldId);
				return;
			case 'unparsed':
				return;
		}
	};
	if (expr !== null) {
		walk(expr);
	}
	return [...seen];
}
