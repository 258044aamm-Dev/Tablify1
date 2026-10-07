/**
 * `estimateNotes` and `buildPlan` — **the truth before anything is written** (`docs/01` §Import semantics: *"the
 * preview dialog is mandatory and must state consequences"*, and `docs/03` §Import: *"matrix → property inference
 * → preview dialog → note creation → single undo step"*).
 *
 * The two functions are deliberately one pipeline: the plan is the estimate plus the frontmatter, so a wizard that
 * counts 412 rows and a runner that creates 412 files agree — the runner consumes the plan object the wizard
 * showed (`runImport` takes an `ImportPlan`, and `tests/unit/import-run.test.ts` asserts the run never re-derives
 * a name).
 *
 * `buildPlan` performs **nothing**: no vault, no host, no `async`. It answers with the ordered list of rows to
 * create, each with the filename it will get (collisions resolved against the vault *and* against the rows
 * earlier in the same run), the frontmatter it will carry, and — when a cell cannot be read as its column's type
 * — the reason it is skipped rather than silently emptied.
 */
import { joinNotePath, noteBaseName, resolveCollision } from './naming';
import type { Matrix } from '../selection/clipboard';
import type { ColumnInference } from './preview';
import type { ResolvedField } from '../schema/propertySchema';
import type { CellValue, FieldTypeId } from '../types';

/** One column as the person confirmed it in the wizard: the inference, with the overrides applied. */
export type PlannedColumn = {
	readonly index: number;
	readonly name: string;
	/** The confirmed type — `inference.type` unless the person chose another. */
	readonly type: FieldTypeId;
	/** How it was decided, for the report and the dialog's evidence line. */
	readonly inference: ColumnInference;
	/** False when the person unticked it: the column is skipped, and it is not a column at all. */
	readonly included: boolean;
};

/** Where a note's frontmatter **key** comes from: the column's confirmed name. `docs/03` §write rules 4. */
export type ImportOptions = {
	readonly columns: readonly PlannedColumn[];
	readonly hasHeader: boolean;
	/** Vault-relative; `''` is the root, and a missing folder is a refusal, not a fallback. */
	readonly folder: string;
	/** `rows.filenameTemplate` from the settings: `{{Name}}` by default. */
	readonly template: string;
	/** Where a row's leading value comes from: the first included column, by default. */
	readonly primaryFieldId?: string | undefined;
	/** How many rows to plan, when the caller previews a subset. Omitted means all of them. */
	readonly limit?: number | undefined;
};

/** One note the plan wants, exactly as the runner must create it. */
export type PlannedNote = {
	/** 1-based, in the order the plan lists them: `{{n}}` and `Row {{n}}` use it. */
	readonly ordinal: number;
	/** The row's index in the matrix (header included). */
	readonly row: number;
	/** The filename without its folder or `.md`. */
	readonly name: string;
	/** The full vault path. */
	readonly path: string;
	/** The path without the collision suffix — what the collision list reports. */
	readonly basePath: string;
	/** `0` when the name was free; `1` for ` 2`, and so on. */
	readonly suffix: number;
	/** Only the non-default values, keyed by the column's **name** (`docs/03` §write rules 4). */
	readonly frontmatter: Readonly<Record<string, CellValue>>;
	/** The canonical values, keyed by property id — what the row shows in the grid once it is loaded. */
	readonly values: Readonly<Record<string, CellValue>>;
};

/** A cell the plan could not read, with the reason the wizard shows. */
export type PlannedSkip = {
	readonly row: number;
	readonly reason: string;
};

/** A predicted collision: the name a row wanted, and the name it got instead. */
export type PlannedCollision = {
	readonly path: string;
	readonly became: string;
	/** `vault` when a file is already there; `same run` when an earlier row of this import claimed it. */
	readonly against: 'vault' | 'same run';
};

export type ImportPlan = {
	readonly folder: string;
	readonly template: string;
	readonly notes: readonly PlannedNote[];
	readonly skipped: readonly PlannedSkip[];
	readonly collisions: readonly PlannedCollision[];
	/** True when the target folder does not exist: every note would fail, and the wizard says so first. */
	readonly missingFolder: boolean;
	/** The properties the import will write, in order, named as the person confirmed them. */
	readonly properties: readonly { readonly name: string; readonly type: FieldTypeId }[];
};

/** What the plan needs from the world: does this file exist, does this folder exist, what are the columns. */
export type PlanEnvironment = {
	/** `Vault.getFileByPath(path) !== null`, reduced to the one bit the plan needs. */
	readonly has: (path: string) => boolean;
	readonly hasFolder: (folder: string) => boolean;
	/**
	 * The descriptors for the confirmed columns, so `parsePlain`/`toJson` come from the registry. Not vaults, not
	 * `App` — the plan is a pure function of a matrix, some columns and these three answers.
	 */
	readonly fields: readonly ResolvedField[];
};

/**
 * The exact counts the dialog states: how many notes, and which filenames collide.
 *
 * It is `buildPlan` with the frontmatter thrown away, and it is implemented that way on purpose — one traversal,
 * one rule about names, so *"412 notes, 3 collisions"* and the run cannot disagree.
 */
export function estimateNotes(
	matrix: Matrix,
	options: ImportOptions,
	environment: PlanEnvironment,
): {
	readonly notes: number;
	/** Values that will be written, across every note. */
	readonly cells: number;
	readonly collisions: readonly PlannedCollision[];
	/** The cells no column could read: the wizard lists them before anything is written. */
	readonly skipped: readonly PlannedSkip[];
	readonly missingFolder: boolean;
} {
	const plan = buildPlan(matrix, options, environment);
	return {
		notes: plan.notes.length,
		cells: plan.notes.reduce((total, note) => total + Object.keys(note.values).length, 0),
		collisions: plan.collisions,
		skipped: plan.skipped,
		missingFolder: plan.missingFolder,
	};
}

/**
 * The whole plan, in creation order: **top to bottom**. The order is explicit because the *creation* order is what
 * `docs/03`'s undo rule rests on — one undo step removes every note the run made, and a chunked run that failed
 * halfway leaves exactly the first N.
 */
export function buildPlan(
	matrix: Matrix,
	options: ImportOptions,
	environment: PlanEnvironment,
): ImportPlan {
	const included = options.columns.filter((column) => column.included);
	// The header row is not read here: the column **names** arrive on `options.columns`, already the names a person
	// confirmed in the preview. Copying the header again would be a second source for the same string.
	const body = options.hasHeader ? matrix.slice(1) : matrix;
	const rows = options.limit === undefined ? body : body.slice(0, options.limit);
	const folder = normaliseFolder(options.folder);
	const primaryFieldId = options.primaryFieldId ?? firstNoteId(included);
	const taken = new Set<string>();
	const collisions: PlannedCollision[] = [];
	const notes: PlannedNote[] = [];
	const skipped: PlannedSkip[] = [];

	rows.forEach((line, at) => {
		const rowNumber = at + (options.hasHeader ? 1 : 0);
		const values: Record<string, CellValue> = {};
		const frontmatter: Record<string, CellValue> = {};
		let parsed = 0;
		for (const column of included) {
			const text = (line[column.index] ?? '').trim();
			if (text === '') {
				continue;
			}
			const field = environment.fields.find(
				(candidate) => candidate.definition.id === noteIdFor(column.index),
			);
			if (field === undefined) {
				skipped.push({
					row: rowNumber,
					reason: `column ${String(column.index + 1)} (“${column.name}”) has no field to write to`,
				});
				continue;
			}
			const value = parseAs(field, text);
			if (value === null) {
				// A cell the confirmed type cannot read is a *skip*, not a silent empty: the preview names the row,
				// and the row still becomes a note with its other columns — the other half of "never partial".
				skipped.push({
					row: rowNumber,
					reason: `${column.name}: ${JSON.stringify(text)} is not a ${column.type}`,
				});
				continue;
			}
			values[field.definition.id] = value;
			parsed += 1;
			if (value !== field.descriptor.defaultValue && !field.readOnly) {
				frontmatter[field.definition.name] = field.descriptor.toJson(value, field.context);
			}
		}
		if (parsed === 0 && included.length > 0) {
			skipped.push({ row: rowNumber, reason: 'every included column was empty' });
		}

		const baseName = noteBaseName({
			template: options.template,
			values,
			fields: environment.fields,
			ordinal: notes.length + 1,
			...(primaryFieldId === undefined ? {} : { primaryFieldId }),
		});
		// The name the row *wanted*, and the name it gets. `resolveCollision` knows both the vault and the rows
		// earlier in this same run — the collision a per-file check cannot see (two rows both titled
		// `Fix the scrollbar`).
		const wanted = joinNotePath(folder, baseName);
		const resolved = resolveCollision(baseName, folder, environment.has, taken);
		taken.add(resolved.path);
		if (resolved.suffix > 0) {
			collisions.push({
				path: wanted,
				became: resolved.path,
				// The wanted path is either already in the vault (the fix is: rename that note, or import into a
				// different folder) or free-but-claimed by an earlier row of this same import (the fix is: change
				// the row's own value). The two are different sentences, so the wizard can say which.
				against: environment.has(wanted) ? 'vault' : 'same run',
			});
		}
		notes.push({
			ordinal: notes.length + 1,
			row: rowNumber,
			name: resolved.name,
			path: resolved.path,
			basePath: wanted,
			suffix: resolved.suffix,
			frontmatter,
			values,
		});
	});

	// A column with a blank name cannot be written: a frontmatter key must exist, and the wizard's own copy says
	// so on the column row rather than letting the note acquire a key called "".
	for (const column of included) {
		if (column.name.trim() === '') {
			skipped.push({
				row: options.hasHeader ? 0 : -1,
				reason: `column ${String(column.index + 1)} needs a name before its values can be written`,
			});
		}
	}

	return {
		folder,
		template: options.template,
		notes,
		skipped,
		collisions,
		missingFolder: !environment.hasFolder(folder),
		properties: included
			.filter((column) => column.name.trim() !== '')
			.map((column) => ({ name: column.name.trim(), type: column.type })),
	};
}

/** The property id a matrix column writes to. Derived from the column's **index**, never from its name. */
export function noteIdFor(index: number): string {
	return `note.Import${String(index)}`;
}

/** `Projects/Rows/` and `/Projects/Rows` are the same folder as `Projects/Rows` — one spelling, once. */
export function normaliseFolder(folder: string): string {
	return folder.replace(/^\/+|\/+$/g, '');
}

/** The first included column's id: the default source of a note's name. */
function firstNoteId(columns: readonly PlannedColumn[]): string | undefined {
	const first = columns.find((column) => column.included);
	return first === undefined ? undefined : noteIdFor(first.index);
}

/**
 * One cell of text as the confirmed type's canonical value — through the **registry**, so the reader and the
 * writer of a value are the same piece of code the rest of the plugin uses (`parsePlain`). The descriptor's own
 * context comes from the field list the caller built, so a date is read in the vault's timezone and a currency in
 * its own precision: nothing here guesses.
 */
function parseAs(field: ResolvedField, text: string): CellValue | null {
	const parsed = field.descriptor.parsePlain(text, field.context);
	return parsed.ok ? parsed.value : null;
}

/** The header row as the wizard's column names: `Column <n>` where the header cell is empty. */
export function columnNames(matrix: Matrix, hasHeader: boolean, width: number): string[] {
	const header = hasHeader ? (matrix[0] ?? []) : [];
	return Array.from({ length: width }, (_unused, index) => {
		const text = hasHeader ? (header[index] ?? '').trim() : '';
		return text === '' ? `Column ${String(index + 1)}` : text;
	});
}
