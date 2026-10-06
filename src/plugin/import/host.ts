/**
 * The wizard's edge: **the one file that knows Obsidian is a real thing.**
 *
 * `wizardSpec.ts` is arithmetic, `runImport.ts` is a loop over a plan, and both are testable without a vault. This
 * file is the seam where a plugin's `App` becomes the narrow ports those two need — `ImportVault` (has, hasFolder,
 * create), `TrashVault` (has, trash) and a `PlanEnvironment` (does a path exist, does a folder exist, what are the
 * column descriptors). Everything Obsidian-specific about importing lives here and nowhere else, which is what
 * lets `tests/unit/import-run.test.ts` run 412 notes through the fake vault in milliseconds.
 *
 * Two rules from the docs are implemented as code here rather than as comments:
 *
 *   · **Notes are trashed, never deleted** (`docs/01` §Editing's "undo must not be the most destructive button"):
 *     `FileManager.trashFile` respects the user's own "Deleted files" setting; `Vault.delete` does not.
 *   · **The row folder comes from the view's own configuration** (`docs/03` §Row creation), and a folder that does
 *     not exist is reported, never created: creating a folder is a vault change nobody asked for, and this file
 *     only writes what the plan says.
 */
import type { App } from 'obsidian';

import { resolveField } from '../../core/schema/propertySchema';
import type { ResolvedField } from '../../core/schema/propertySchema';
import { noteIdFor } from '../../core/import/plan';
import type { PlanEnvironment } from '../../core/import/plan';
import { createImportHistory } from './runImport';
import type { ImportHistory, ImportVault, TrashVault } from './runImport';
import type { WizardInput } from './wizardSpec';
import type { ColumnInference } from '../../core/import/preview';
import type { FieldContext, FieldTypeId } from '../../core/types';

/** What a column needs to become a field the plan can write to: its name, its type, and the vault's own facts. */
export type ImportColumn = {
	readonly index: number;
	readonly name: string;
	readonly type: FieldTypeId;
};

/** The settings the wizard reads. A subset of `plugin/settings/schema.ts`, named so the dependency is visible. */
export type ImportSettings = {
	readonly folder: string;
	readonly template: string;
	readonly timezone: string;
	readonly locale: string;
	readonly warnOnLargeImport: boolean;
	readonly largeImportThreshold: number;
};

/** Everything the caller (a view, a command, a test) hands the wizard to make it runnable. */
export type ImportHostDeps = {
	readonly app: App;
	readonly settings: ImportSettings;
	/** The columns the current view already has, by property id → display name. Empty when there is no view. */
	readonly existing: ReadonlyMap<string, string>;
	/** The columns the person confirmed (or the inference produced), before `PlanEnvironment` is built. */
	readonly columns: readonly ImportColumn[];
	readonly now?: (() => number) | undefined;
};

/** The ports a wizard needs, built from an `App`. */
export type ImportPorts = {
	readonly vault: ImportVault;
	readonly trash: TrashVault;
	readonly history: ImportHistory;
	readonly environment: PlanEnvironment;
};

/**
 * The columns as `ResolvedField`s — one per column, keyed `note.Import<index>` so a plan can name the target of
 * every cell without a second mapping.
 *
 * The descriptors come from `resolveField`, the same call the grid makes: a column's YAML, its plain-text form and
 * its parse rules are the registry's, and the wizard never formats a value itself.
 */
export function importFields(
	columns: readonly ImportColumn[],
	context: Omit<FieldContext, 'columnName' | 'fieldOptions'>,
): readonly ResolvedField[] {
	return columns.map((column) =>
		resolveField(
			// The type travels in `fieldOptions`, which is what `resolveField` reads (`validateFieldOptions` →
			// `options.type`). Passing it anywhere else is silently ignored and the column becomes text — the bug
			// this line exists to not have.
			{
				id: noteIdFor(column.index),
				name: column.name,
				source: 'note',
				fieldOptions: { type: column.type },
			},
			{ ...context, fieldOptions: {}, columnName: column.name },
		),
	);
}

/**
 * The `PlanEnvironment`: three questions the plan asks about the world, answered by the real vault.
 *
 * `hasFolder` answers `true` for `''` because the vault root always exists: a person who clears the folder field in
 * the preview step is asking for root-level notes, which is a real choice and not a missing folder.
 */
export function importEnvironment(
	app: App,
	columns: readonly ImportColumn[],
	context: Omit<FieldContext, 'columnName' | 'fieldOptions'>,
): PlanEnvironment {
	return {
		has: (path) => app.vault.getFileByPath(path) !== null,
		hasFolder: (path) =>
			path === '' ||
			// `Vault.getFolderByPath(path): TFolder | null` — obsidian.d.ts:7360.
			app.vault.getFolderByPath(path) !== null,
		fields: importFields(columns, context),
	};
}

/**
 * The whole edge, in one call: the ports, the history and the environment.
 *
 * It returns data rather than a wizard so a caller can build one wizard and reuse its history — the import undo
 * stack belongs to the session, not to the dialog (`docs/03` §Import: *"single undo step that removes the created
 * notes"*).
 */
export function createImportPorts(deps: ImportHostDeps): ImportPorts {
	const { app, settings } = deps;
	const vault: ImportVault = {
		has: (path) => app.vault.getFileByPath(path) !== null,
		hasFolder: (folder) => folder === '' || app.vault.getFolderByPath(folder) !== null,
		create: async (path, content) => {
			await app.vault.create(path, content);
		},
	};
	const trash: TrashVault = {
		has: (path) => app.vault.getFileByPath(path) !== null,
		trash: async (path) => {
			const file = app.vault.getFileByPath(path);
			if (file === null) {
				return;
			}
			// `FileManager.trashFile(file)` (obsidian.d.ts, @since 1.6.6) — the setting-aware way to remove a note.
			// No cast: `Vault.getFileByPath` already answers `TFile | null`, which is exactly what this takes.
			await app.fileManager.trashFile(file);
		},
	};
	const context = {
		path: '',
		now: deps.now ?? (() => Date.now()),
		timezone: settings.timezone,
		locale: settings.locale,
	};
	return {
		vault,
		trash,
		history: createImportHistory(trash),
		environment: importEnvironment(app, deps.columns, context),
	};
}

/** The wizard's own input, assembled from the settings, the view's columns and a decided source. */
export function wizardInput(
	settings: ImportSettings,
	existing: ReadonlyMap<string, string>,
	environment: PlanEnvironment,
	source: WizardInput['source'],
): WizardInput {
	return {
		source,
		largeImportThreshold: settings.largeImportThreshold,
		warnOnLargeImport: settings.warnOnLargeImport,
		template: settings.template,
		folder: settings.folder,
		existing,
		environment,
	};
}

/** The columns the wizard should start with: the inference's own answer, as `ImportColumn`s. */
export function columnsFromInference(columns: readonly ColumnInference[]): readonly ImportColumn[] {
	return columns.map((column) => ({ index: column.index, name: column.name, type: column.type }));
}
