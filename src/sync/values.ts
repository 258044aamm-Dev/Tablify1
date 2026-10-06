/**
 * The bridge between **one column's canonical value and the provider's own vocabulary**.
 *
 * Sync compares and writes values that live on two sides of a boundary: a note's frontmatter (canonical
 * `CellValue`) and a remote record's `fields` object (whatever the provider stores — a string, a number, a bare
 * boolean, a list of option names). Comparing those two directly would produce a conflict on every sync, because
 * `2026-03-01` and `2026-03-01T00:00:00.000Z` are the same date written two ways, and `1200` and `"1200"` are the
 * same cost written two ways.
 *
 * So **both directions go through the column's own descriptor**:
 *
 *   · **remote → local** is `descriptor.parse(raw, ctx)`, the same call the `.tabula` reader and a spreadsheet
 *     paste use. A value the column cannot accept is not a conflict and not a crash: it is
 *     {@link RemoteValueProblem}, a sentence, which `diff.ts` reports as a `type-mismatch` and the review dialog
 *     shows with both values so a person can see what arrived.
 *   · **local → remote** starts from `descriptor.toYaml` — *"canonical value → what actually gets written to
 *     frontmatter"*, which is exactly the same question one provider further out — and then keeps the provider's
 *     own shapes for the four kinds it stores natively (number, boolean, list of text, text). Anything with a
 *     richer YAML shape (a nested object, an `undefined`) is sent as plain text, because a provider that stores
 *     scalar fields cannot hold structure and inventing a stringification silently would be worse than the rule.
 *
 * Nothing here decides policy: no field is skipped, no value is coerced, and the client's `typecast: false` means
 * the provider will not coerce either. If a value cannot cross the boundary, that is reported.
 */
import type { ResolvedField } from '../core/schema/propertySchema';
import type { CellValue } from '../core/types';

/** A remote value the column could not accept: one sentence, plus the raw value that arrived. */
export type RemoteValueProblem = {
	/** The remote field id, so a report can name the field rather than the column. */
	readonly fieldId: string;
	/** What the provider sent, verbatim, for the review dialog's "remote" cell. */
	readonly raw: unknown;
	/** One sentence, from the descriptor's own failure. Never a stack trace. */
	readonly message: string;
};

/** The result of reading a remote value with a local column's descriptor. */
export type RemoteValue =
	| { readonly ok: true; readonly value: CellValue }
	| { readonly ok: false; readonly problem: RemoteValueProblem };

/**
 * A remote `fields` entry, read as the local column's canonical value.
 *
 * An absent key and an explicit `null` are the same thing — *"a missing key and an empty cell are the same thing
 * everywhere in the core"* (`core/ops/types.ts`) — so both answer the descriptor's own empty value by parsing
 * `null`, which is what a cleared cell is.
 */
export function remoteToLocal(field: ResolvedField, fieldId: string, raw: unknown): RemoteValue {
	const parsed = field.descriptor.parse(raw === undefined ? null : raw, field.context);
	if (parsed.ok) {
		return { ok: true, value: parsed.value };
	}
	return { ok: false, problem: { fieldId, raw, message: parsed.error } };
}

/** Which provider shapes a value may take. Four are native; the rest go as text. */
function isRemoteScalar(value: unknown): boolean {
	return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string';
}

/** A list of text — the provider's shape for a multi-select or any list-valued field. */
function isRemoteList(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((member) => typeof member === 'string');
}

/**
 * A local canonical value in the form the provider stores.
 *
 * The order matters: `toYaml` first (so a currency's number and a checkbox's boolean arrive as the numbers and
 * booleans they are), then a check that the result is something the provider can hold, then — and only then —
 * plain text. `formatPlain` is the descriptor's own *"the text a spreadsheet reads back unchanged"*, which is the
 * same promise a remote text field needs.
 */
export function localToRemote(field: ResolvedField, value: CellValue): unknown {
	const yaml = field.descriptor.toYaml(value, field.context);
	if (yaml === null || isRemoteScalar(yaml) || isRemoteList(yaml)) {
		return yaml;
	}
	return field.descriptor.formatPlain(value, field.context);
}
