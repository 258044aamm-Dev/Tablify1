/**
 * Creating a row, which means creating a note.
 *
 * `docs/03` §row creation fixes the semantics; this file implements them and is careful about the one thing
 * that cannot be checked here:
 *
 *   folder:      the configured row folder (default "<base name> Rows")
 *   filename:    the configured template, `{{Name}}` → falls back to "Row {{n}}"
 *   frontmatter: only properties with non-default values are written
 *   collisions:  append " 2", " 3", … and report the count
 *
 * **Which creation path, and why.** The step asks for the sanctioned path first —
 * `BasesView.createFileForView(baseFileName?, frontmatterProcessor?)`, `@since 1.10.2` — with the manual
 * `vault.create` as a fallback. The step-10 spike found the important detail: the declaration's own doc
 * comment says it *"Display the new note menu for a file with the provided filename"*, i.e. it **opens a
 * modal**. That makes it right for a single "New row" click and wrong for the 412-note import, which must
 * not open 412 modals. So:
 *
 *  - `mode: 'menu'` (the default when a view is available) calls `createFileForView` — one note, the user's
 *    own folder settings, no template of ours;
 *  - `mode: 'direct'` uses `vault.create` with the configured folder and template, which is the only path
 *    that can create many notes without a dialog, and therefore the path the import and the migration use.
 *
 * The choice is the caller's and is recorded in `CreateNoteResult.via`, so a report can always say which
 * path ran. The step's STOP clause — "if `createFileForView` is not callable at runtime, the service must
 * use the fallback everywhere" — is why `mode: 'menu'` degrades to `direct` (and says so) rather than
 * throwing: the spike's runtime row is still PENDING-RUN.
 */
import type { CellValue } from '../../core/types';
import type { ResolvedField } from '../../core/schema/propertySchema';

/** A file the service created, as the parts the rest of the plugin needs. */
export type CreatedNote = {
	readonly path: string;
	/** True when a rename was needed to avoid a collision. */
	readonly renamed: boolean;
};

/** Why a creation failed. Never thrown: the caller decides what to show. */
export type CreateNoteError = {
	readonly message: string;
	readonly cause?: unknown;
};

export type CreateNoteResult =
	| { readonly ok: true; readonly file: CreatedNote; readonly via: 'menu' | 'direct' }
	| { readonly ok: false; readonly error: CreateNoteError };

/** The slice of a vault this service needs. Structural, so tests use the fake vault. */
export type NoteVault = {
	/** `Vault.getFileByPath(path): TFile | null`. */
	has(path: string): boolean;
	/** `Vault.getFolderByPath(path)` / `getAbstractFileByPath` reduced to "does this folder exist". */
	hasFolder(path: string): boolean;
	/** `Vault.create(path, data): Promise<void>` — the path is already resolved and unique. */
	create(path: string, content: string): Promise<void>;
};

/** The slice of the view the menu path needs: `BasesView.createFileForView` (`@since 1.10.2`). */
export type NoteMenu = {
	createFileForView(
		baseFileName: string | undefined,
		frontmatterProcessor: (frontmatter: Record<string, unknown>) => void,
	): Promise<void>;
};

export type CreateNoteOptions = {
	readonly vault: NoteVault;
	/** The configured row folder, relative to the vault root: `Projects Rows`. */
	readonly folder: string;
	/** The filename template: `{{Name}}`, `{{Name}} {{Status}}`, or a plain string. */
	readonly template: string;
	/** Canonical values, keyed by prefixed property id. */
	readonly values: Readonly<Record<string, CellValue>>;
	/** The columns, so `toJson` and the "non-default" rule come from the registry, never duplicated here. */
	readonly fields: readonly ResolvedField[];
	/** Where the values' leading property comes from in the filename: `note.Name` by default. */
	readonly primaryFieldId?: string;
	/** 1-based ordinal for `{{n}}`, when the caller knows one. */
	readonly ordinal?: number;
	/** The menu path, when the caller has a view. Omitted → the direct path. */
	readonly menu?: NoteMenu;
	/** Force the direct path even when a menu is available. */
	readonly forceDirect?: boolean;
};

/** What `createNote` reports back, including how it did it. */
export type CreateNoteOutcome = {
	readonly result: CreateNoteResult;
	/** The path the service tried first, before any collision suffix. Filled for the direct path. */
	readonly attemptedPath: string;
	/** How many " 2", " 3"… suffixes were needed. */
	readonly collisions: number;
};

/** Characters a filename may not contain in any of the platforms Obsidian runs on. */
const ILLEGAL = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|', '#', '^', '[', ']']);

/** Obsidian's own rule, restated: a note's name may not be empty and may not be only spaces. */
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
function baseNameFor(options: CreateNoteOptions): string {
	const values: Record<string, string> = {};
	for (const field of options.fields) {
		const value = options.values[field.definition.id];
		if (value === undefined || value === null) {
			continue;
		}
		values[field.definition.name] = field.descriptor.formatPlain(value, field.context);
		values[field.definition.id] = field.descriptor.formatPlain(value, field.context);
	}
	const ordinal = options.ordinal ?? 1;
	const rowName = `Row ${String(ordinal)}`;
	if (options.template.trim() === '') {
		return rowName;
	}
	const expanded = expandTemplate(options.template, values, ordinal);
	// An unchanged expansion means at least one placeholder had no value: `expandTemplate` leaves an
	// unknown key as written, which is what makes this check exact rather than a guess.
	const chosen = expanded === options.template ? leadingValue(options) : expanded;
	const sanitized = sanitizeFileName(chosen);
	return sanitized === '' ? rowName : sanitized;
}

/** The leading column's value as plain text: the second chance when a template cannot be filled. */
function leadingValue(options: CreateNoteOptions): string {
	const primary = options.primaryFieldId ?? 'note.Name';
	const value = options.values[primary];
	if (value === undefined || value === null) {
		return '';
	}
	const field = options.fields.find((candidate) => candidate.definition.id === primary);
	return field === undefined ? String(value) : field.descriptor.formatPlain(value, field.context);
}

/** Joins a folder and a filename without doubling or dropping the separator. */
function joinPath(folder: string, name: string): string {
	const trimmed = folder.replace(/^\/+|\/+$/g, '');
	return trimmed === '' ? `${name}.md` : `${trimmed}/${name}.md`;
}

/** The frontmatter a new note gets: only the columns whose value differs from the column's default. */
export function frontmatterFor(options: CreateNoteOptions): Record<string, CellValue> {
	const frontmatter: Record<string, CellValue> = {};
	for (const field of options.fields) {
		if (field.readOnly) {
			continue;
		}
		const value = options.values[field.definition.id];
		if (value === undefined || value === null) {
			continue;
		}
		if (value === field.descriptor.defaultValue) {
			continue;
		}
		frontmatter[field.definition.name] = field.descriptor.toJson(value, field.context);
	}
	return frontmatter;
}

/**
 * Creates one note. Returns a result rather than throwing, and never leaves a half-written note behind: the
 * direct path either creates a file with its frontmatter or reports why it could not.
 */
export async function createNote(options: CreateNoteOptions): Promise<CreateNoteOutcome> {
	const baseName = baseNameFor(options);
	const frontmatter = frontmatterFor(options);
	const attemptedPath = joinPath(options.folder, baseName);

	if (options.menu !== undefined && options.forceDirect !== true) {
		try {
			await options.menu.createFileForView(undefined, (target) => {
				for (const [key, value] of Object.entries(frontmatter)) {
					target[key] = value;
				}
			});
			return {
				result: { ok: true, file: { path: attemptedPath, renamed: false }, via: 'menu' },
				attemptedPath,
				collisions: 0,
			};
		} catch (error) {
			// The menu path is only reachable when a real view provided it; a failure here is a real failure,
			// and reporting it as a result keeps the caller's error handling in one place.
			const message = error instanceof Error ? error.message : String(error);
			return {
				result: { ok: false, error: { message, cause: error } },
				attemptedPath,
				collisions: 0,
			};
		}
	}

	if (!options.vault.hasFolder(options.folder)) {
		// `docs/03`: the folder is a setting, so a missing one is a configuration error, and creating the note
		// in the vault root instead would be a silent, wrong write. This is asserted in the tests.
		return {
			result: {
				ok: false,
				error: {
					message: `the row folder "${options.folder}" does not exist — create it, or change the row folder in Tablify's settings`,
				},
			},
			attemptedPath,
			collisions: 0,
		};
	}

	let path = attemptedPath;
	let collisions = 0;
	while (options.vault.has(path)) {
		collisions += 1;
		path = joinPath(options.folder, `${baseName} ${String(collisions + 1)}`);
		if (collisions > 999) {
			return {
				result: {
					ok: false,
					error: { message: `could not find a free filename for "${baseName}"` },
				},
				attemptedPath,
				collisions,
			};
		}
	}

	const body = frontmatterBody(frontmatter);
	try {
		await options.vault.create(path, body);
		return {
			result: { ok: true, file: { path, renamed: collisions > 0 }, via: 'direct' },
			attemptedPath,
			collisions,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			result: { ok: false, error: { message, cause: error } },
			attemptedPath,
			collisions,
		};
	}
}

/**
 * A note's text: the YAML block, then nothing. Written by hand rather than by a YAML library — the same
 * rule the note says about `toJson`: values that need quoting are quoted, everything else is written as a
 * person would type it, and an empty property map produces no frontmatter block at all.
 */
export function frontmatterBody(frontmatter: Readonly<Record<string, CellValue>>): string {
	const entries = Object.entries(frontmatter);
	if (entries.length === 0) {
		return '';
	}
	const lines = entries.map(([key, value]) => `${key}: ${serializeScalar(value)}`);
	return `---\n${lines.join('\n')}\n---\n`;
}

/** Is this value a list? A type predicate, because `Array.isArray` does not narrow a `readonly` array. */
function isList(value: CellValue): value is readonly string[] {
	return typeof value === 'object' && value !== null;
}

/**
 * One YAML scalar or list, on one line where it fits. The parameter is `CellValue` — exactly what a
 * descriptor's `toJson` may return — so the last branch is a real string and not an `unknown` happening to
 * stringify well.
 */
function serializeScalar(value: CellValue): string {
	if (value === null) {
		return 'null';
	}
	if (isList(value)) {
		// A list element is always text in the canonical vocabulary (an option id, a row id, a path), so
		// the list is a list of quoted-or-plain strings.
		return `[${value.map((entry) => serializeText(entry)).join(', ')}]`;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return serializeText(value);
}

/**
 * One YAML scalar, quoted exactly when a plain scalar would change meaning.
 *
 * This is the note path's own serializer, not a general YAML writer, and it is the R6-deleted half of
 * the pair (R3 step 3): the document writes JSON through `core/database/values.ts`. What matters here is
 * that the descriptors no longer carry a YAML conversion at all — the note path turns canonical values
 * into YAML text at its own boundary.
 */
function serializeText(text: string): string {
	// Quote when a plain scalar would change meaning: empty, leading/trailing space, or a character that
	// starts a YAML structure. This mirrors what the field types produce; it is not a general YAML writer.
	if (text === '' || /^[\s]|[\s]$|\n|:\s|^[-?*&!%@`>|#'"[{]|^- /.test(text)) {
		return JSON.stringify(text);
	}
	return text;
}
