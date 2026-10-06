/**
 * How a row becomes a note's **name** — one implementation, in core, because two callers must agree about it.
 *
 * The import preview predicts the filename of every row it is about to create (`estimateNotes`), and the run
 * creates those files. A preview that predicts with its own copy of the rule is a preview that eventually lies,
 * and the lie is the worst kind: *"Creates 412 notes"* followed by 412 files with different names. So the rule
 * lives here, once.
 *
 * **The two copies that still exist, and why they are not a second rule.** `createNote`
 * (`src/adapters/notes/createNote.ts`) keeps its own `sanitizeFileName`/`expandTemplate`/`baseNameFor`, because
 * step 23 was fenced to `src/core/import/**` and deleting them was outside that fence. They are *identical* — the
 * step's own test asserts the equivalence by running `createNote` against the fake vault and comparing the file it
 * created with {@link noteBaseName}'s prediction for the same row — so the preview cannot drift without a red
 * test. Removing the duplicates is a one-file follow-up recorded in PROGRESS.md.
 *
 * Nothing here touches a vault or the DOM: the collision *suffix* is resolved by the caller (it knows what exists),
 * the *base* name is this file's.
 */
import type { CellValue } from '../types';
import type { ResolvedField } from '../schema/propertySchema';

/** Characters a filename may not contain in any of the platforms Obsidian runs on. */
const ILLEGAL = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|', '#', '^', '[', ']']);

/**
 * Obsidian's own rule, restated: a note's name may not be empty and may not be only spaces. Illegal characters
 * become spaces, runs of whitespace collapse, and a trailing dot goes (Windows refuses those names).
 */
export function sanitizeFileName(name: string): string {
	const cleaned = [...name]
		.map((character) => (ILLEGAL.has(character) ? ' ' : character))
		.join('')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\.+$/, '');
	return cleaned;
}

/** `{{Name}}` → the cell's plain text; `{{n}}` → the ordinal. An unknown key is left as written. */
export function expandTemplate(
	template: string,
	values: Readonly<Record<string, string>>,
	ordinal: number,
): string {
	return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, key: string) => {
		if (key === 'n') {
			return String(ordinal);
		}
		return values[key] ?? whole;
	});
}

/** Everything {@link noteBaseName} needs. `createNote`'s options satisfy this structurally, with more besides. */
export type NoteNameInput = {
	/** The configured template: `{{Name}}`, `{{Name}} {{Status}}`, or a plain string. */
	readonly template: string;
	/** Canonical values, keyed by prefixed property id. */
	readonly values: Readonly<Record<string, CellValue>>;
	/** The columns, so `formatPlain` comes from the registry rather than from a second formatter. */
	readonly fields: readonly ResolvedField[];
	/** Where the leading value comes from in the filename: `note.Name` by default. */
	readonly primaryFieldId?: string | undefined;
	/** 1-based ordinal for `{{n}}`, when the caller knows one. */
	readonly ordinal?: number | undefined;
};

/**
 * The filename a new note gets, from the template and the row's own values.
 *
 * The rule, in the order `docs/03` §row creation states it (`template` → falls back to `Row {{n}}`):
 *
 *   1. the template, expanded (`{{Name}}` → the column's plain text, `{{n}}` → the ordinal);
 *   2. an **empty or blank template** is the documented fallback case: nothing to expand, so the name is
 *      `Row <n>`;
 *   3. a template that could not be filled — a placeholder key the row has no value for survives the
 *      expansion untouched — gets one second chance: the leading column's own value (`note.Name` by
 *      default), because a note named after its row is what the default template means;
 *   4. if that is empty too, `Row <n>`;
 *   5. whatever wins is sanitised, and an empty result (a template of only illegal characters) is `Row <n>`.
 */
export function noteBaseName(input: NoteNameInput): string {
	const values: Record<string, string> = {};
	for (const field of input.fields) {
		const value = input.values[field.definition.id];
		if (value === undefined || value === null) {
			continue;
		}
		const text = field.descriptor.formatPlain(value, field.context);
		values[field.definition.name] = text;
		values[field.definition.id] = text;
	}
	const ordinal = input.ordinal ?? 1;
	const rowName = `Row ${String(ordinal)}`;
	if (input.template.trim() === '') {
		return rowName;
	}
	const expanded = expandTemplate(input.template, values, ordinal);
	// An unchanged expansion means at least one placeholder had no value: `expandTemplate` leaves an unknown key
	// as written, which is what makes this check exact rather than a guess.
	const chosen = expanded === input.template ? leadingValue(input) : expanded;
	const sanitized = sanitizeFileName(chosen);
	return sanitized === '' ? rowName : sanitized;
}

/** The leading column's value as plain text: the second chance when a template cannot be filled. */
function leadingValue(input: NoteNameInput): string {
	const primary = input.primaryFieldId ?? 'note.Name';
	const value = input.values[primary];
	if (value === undefined || value === null) {
		return '';
	}
	const field = input.fields.find((candidate) => candidate.definition.id === primary);
	return field === undefined ? String(value) : field.descriptor.formatPlain(value, field.context);
}

/** Joins a folder and a filename without doubling or dropping the separator. `''` is the vault root. */
export function joinNotePath(folder: string, name: string): string {
	const trimmed = folder.replace(/^\/+|\/+$/g, '');
	return trimmed === '' ? `${name}.md` : `${trimmed}/${name}.md`;
}

/**
 * The path a row will get, and whether it needs a suffix — `has` answers "does this path exist", and
 * `taken` carries the names predicted **earlier in the same run**, which is the collision a per-file check
 * cannot see (two rows both titled `Fix the scrollbar` collide with each other, not only with the vault).
 *
 * This is the rule `createNote` applies when it actually creates the file: `name`, `name 2`, `name 3`…
 */
export function resolveCollision(
	baseName: string,
	folder: string,
	has: (path: string) => boolean,
	taken: Set<string>,
): { readonly name: string; readonly path: string; readonly suffix: number } {
	// The same ceiling as `createNote`'s own loop: past a thousand files named alike, something is wrong.
	for (let suffix = 0; suffix <= 999; suffix += 1) {
		const name = suffix === 0 ? baseName : `${baseName} ${String(suffix + 1)}`;
		const path = joinNotePath(folder, name);
		if (!has(path) && !taken.has(path)) {
			return { name, path, suffix };
		}
	}
	const name = `${baseName} 1001`;
	return { name, path: joinNotePath(folder, name), suffix: 1001 };
}
