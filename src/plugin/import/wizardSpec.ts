/**
 * The import wizard's **copy and arithmetic**, as pure functions — the part a test can read.
 *
 * `docs/01` §Import semantics fixes the shape of this dialog:
 *
 * ```
 * Import sheet.xlsx — 3 columns × 412 rows
 *   → Creates 412 notes in "Projects/Rows" using {{Name}}.md
 *   → Adds 3 properties: Name, Status, Owner
 *
 * [ Create 412 notes ]   [ Keep as .tabula file instead ]   [ Cancel ]
 * ```
 *
 * and adds the two rules that make it honest: *"Above a configurable threshold (default 250 rows) the dialog adds
 * an explicit warning and defaults the cursor to the `.tabula` option"*, and *"the wizard must never say 'about
 * 400 rows'"* (the step's own wording). So every number below comes from `estimateNotes`/`buildPlan` — the same
 * traversal the runner consumes — and nothing here is a rounded guess.
 *
 * **Why a spec module rather than a rendering method.** The repo already does this for every other dialog
 * (`bulkEditSpec`, `pasteBlockSpec`, `DialogSpec`): the copy and the counts are testable as data, and the Modal is
 * a loop over that data. A wizard whose sentences only exist inside `onOpen` is a wizard whose sentences can only
 * be asserted from a screenshot.
 */
import { buildPlan, estimateNotes } from '../../core/import/plan';
import { INFERABLE_TYPES } from '../../core/import/preview';
import type { ColumnInference, ImportSource, ReadSourceResult } from '../../core/import/preview';
import type {
	ImportOptions,
	ImportPlan,
	PlannedCollision,
	PlannedColumn,
	PlanEnvironment,
} from '../../core/import/plan';
import type { FieldTypeId } from '../../core/types';

/** The wizard's steps, in the order they are shown. */
export type WizardStepId = 'source' | 'preview' | 'target';

/** What a step offers the person, as data. `disabled` is a reason, not a flag with a hidden cause. */
export type WizardOption = {
	readonly id: string;
	readonly label: string;
	/** The line under the label: what choosing this does, in the product's voice. */
	readonly description: string;
	readonly picked: boolean;
	/** Present (with the reason) when the option cannot be used yet. */
	readonly disabledReason?: string | undefined;
};

/** One line of a step's body. `kind` decides how the modal renders it; the text is what the tests assert. */
export type WizardLine = {
	readonly kind: 'fact' | 'warning' | 'hint' | 'collision' | 'skipped' | 'column';
	readonly text: string;
	/** Set on a `column` line: the column's matrix index, for the override control. */
	readonly index?: number | undefined;
	/** Set on a `column` line: the type currently chosen for it. */
	readonly type?: FieldTypeId | undefined;
};

export type WizardAction = {
	readonly id: 'back' | 'continue' | 'create' | 'tabula' | 'cancel';
	readonly label: string;
	readonly primary: boolean;
	readonly disabledReason?: string | undefined;
};

export type WizardStep = {
	readonly id: WizardStepId;
	readonly title: string;
	readonly subtitle: string;
	readonly lines: readonly WizardLine[];
	readonly options: readonly WizardOption[];
	/** The footer's actions, left to right. The primary is always last (`docs/04` §dialogs). */
	readonly actions: readonly WizardAction[];
};

/** The three modes the target step offers. The ids are the prototype's own (`prototype/js/dialogs.js`). */
export type ImportModeId = 'append' | 'replace' | 'create';

const MODE_IDS: readonly string[] = ['append', 'replace', 'create'];

/** Narrows an option's own id to a mode. A validator rather than an assertion, so a typo is a refusal. */
export function isImportModeId(value: string): value is ImportModeId {
	return MODE_IDS.includes(value);
}

/** What the wizard is told by the caller: the settings, the current view's columns, and the world's answers. */
export type WizardInput = {
	readonly source: ImportSource;
	/** `import.largeImportThreshold` — 250 by default. */
	readonly largeImportThreshold: number;
	readonly warnOnLargeImport: boolean;
	/** `rows.filenameTemplate`: `{{Name}}` by default. */
	readonly template: string;
	/** The folder the *view* was configured with: the wizard's starting point, editable in the preview step. */
	readonly folder: string;
	/** The columns this Bases view already has, by property id → display name. `append` matches against these. */
	readonly existing: ReadonlyMap<string, string>;
	/** Does a path exist, does a folder exist, what are the columns. Filled by the host: the wizard has no vault. */
	readonly environment: PlanEnvironment;
};

/**
 * Everything the wizard knows between steps. One object, because the state *is* what the three step functions
 * read — a set of `useState` calls in a class would be the same data with three ways to get it wrong.
 */
export type WizardState = {
	readonly wizard: WizardInput;
	readonly result: ReadSourceResult;
	readonly hasHeader: boolean;
	/** The inference for every column, at the moment the preview step was entered. */
	readonly columns: readonly ColumnInference[];
	/** A person's per-column type override, by matrix index. Mutable: the wizard writes as the person chooses. */
	readonly overrides: Map<number, FieldTypeId>;
	/** Columns a person unticked. Mutable for the same reason. */
	readonly excluded: Set<number>;
	readonly folder: string;
	readonly template: string;
	readonly mode: ImportModeId;
	/** The plan the target step shows and the runner consumes. Built by {@link planFor}. */
	readonly plan: ImportPlan | null;
};

/** Where the `.tabula` alternative stands, and why — stated once, on the option itself. */
export const TABULA_REASON =
	'writing a .tabula file is not in this build: the format is read-only here, so this option cancels the import rather than pretending';

/**
 * One sentence naming the work: *"3 columns × 412 rows"*. The row count is `matrix.length` or `matrix.length - 1`
 * depending on the header switch, and the word "rows" means **notes** — the difference this dialog exists to make
 * unmissable.
 */
export function sizeSentence(result: ReadSourceResult, hasHeader: boolean): string {
	if (!result.ok) {
		return result.reason;
	}
	const rows = hasHeader ? Math.max(0, result.matrix.length - 1) : result.matrix.length;
	const columns = result.matrix.reduce((widest, row) => Math.max(widest, row.length), 0);
	return `${String(columns)} column${columns === 1 ? '' : 's'} × ${String(rows)} row${rows === 1 ? '' : 's'}`;
}

/** The columns the plan will actually write: included, and named. */
export function plannedColumns(state: {
	readonly columns: readonly ColumnInference[];
	readonly overrides: ReadonlyMap<number, FieldTypeId>;
	readonly excluded: ReadonlySet<number>;
}): readonly PlannedColumn[] {
	return state.columns.map((column) => ({
		index: column.index,
		name: column.name,
		type: state.overrides.get(column.index) ?? column.type,
		inference: column,
		included: !state.excluded.has(column.index),
	}));
}

/** The option set the plan is built from — the same columns the runner's plan will use, one object. */
export function planOptions(state: {
	readonly columns: readonly ColumnInference[];
	readonly overrides: ReadonlyMap<number, FieldTypeId>;
	readonly excluded: ReadonlySet<number>;
	readonly hasHeader: boolean;
	readonly folder: string;
	readonly template: string;
}): ImportOptions {
	return {
		columns: plannedColumns(state),
		hasHeader: state.hasHeader,
		folder: state.folder,
		template: state.template,
	};
}

/** Builds the plan for the state's confirmed columns. The Modal calls this once, on entering the target step. */
export function planFor(state: {
	readonly matrix: readonly (readonly string[])[];
	readonly hasHeader: boolean;
	readonly columns: readonly ColumnInference[];
	readonly overrides: ReadonlyMap<number, FieldTypeId>;
	readonly excluded: ReadonlySet<number>;
	readonly folder: string;
	readonly template: string;
	readonly environment: PlanEnvironment;
}): ImportPlan | null {
	if (state.matrix.length === 0) {
		return null;
	}
	return buildPlan(state.matrix, planOptions(state), state.environment);
}

/** The preview step's body: the counts, the properties, the collisions and the threshold warning. */
export function previewLines(input: {
	readonly estimate: ReturnType<typeof estimateNotes>;
	readonly columns: readonly PlannedColumn[];
	readonly template: string;
	readonly folder: string;
	readonly largeImportThreshold: number;
	readonly warnOnLargeImport: boolean;
}): readonly WizardLine[] {
	const { estimate } = input;
	const notes = estimate.notes;
	const named = input.columns.filter((column) => column.included && column.name.trim() !== '');
	const lines: WizardLine[] = [
		{
			kind: 'fact',
			text: `Creates ${String(notes)} note${notes === 1 ? '' : 's'} in “${input.folder}” using ${input.template}.md`,
		},
	];
	if (estimate.missingFolder) {
		lines.push({
			kind: 'warning',
			text: `The folder “${input.folder}” does not exist. Every note would fail; create it first, or change the folder.`,
		});
	}
	lines.push({
		kind: 'fact',
		text: `Adds ${String(estimate.cells)} value${estimate.cells === 1 ? '' : 's'} across ${String(named.length)} propert${named.length === 1 ? 'y' : 'ies'}${named.length === 0 ? '' : `: ${named.map((column) => `${column.name} (${column.type})`).join(', ')}`}`,
	});
	if (input.warnOnLargeImport && notes > input.largeImportThreshold) {
		// `docs/01`: the warning is explicit. The escape hatch is not built (see TABULA_REASON), so the honest
		// version of that sentence says both things.
		lines.push({
			kind: 'warning',
			text: `${String(notes)} notes is above the ${String(input.largeImportThreshold)}-row warning level. Consider keeping this as a .tabula file instead — ${TABULA_REASON}.`,
		});
	}
	for (const collision of estimate.collisions) {
		lines.push({ kind: 'collision', text: collisionLine(collision) });
	}
	for (const skip of estimate.skipped.slice(0, 5)) {
		lines.push({ kind: 'skipped', text: `row ${String(skip.row)}: ${skip.reason}` });
	}
	if (estimate.skipped.length > 5) {
		lines.push({
			kind: 'skipped',
			text: `…and ${String(estimate.skipped.length - 5)} more row(s) with an unreadable cell`,
		});
	}
	return lines;
}

/** *`Notes/Budget 2.md` will be used — `Notes/Budget.md` already exists in the vault.* */
export function collisionLine(collision: PlannedCollision): string {
	const why =
		collision.against === 'vault'
			? 'already exists in the vault'
			: 'is claimed by an earlier row of this same import';
	return `“${collision.became}” will be used — “${collision.path}” ${why}`;
}

/** The preview step's per-column lines: name, inferred type, confidence and the evidence that forced it. */
export function columnLines(columns: readonly ColumnInference[]): readonly WizardLine[] {
	return columns.map((column) => ({
		kind: 'column' as const,
		index: column.index,
		type: column.type,
		text: columnText(column),
	}));
}

/**
 * *`Weight — text (61 sampled, 98% look like number) — blocked by row 61 “n/a” → could be number`* — the verdict,
 * the sample, the near miss and the row that decided it, which is what the step's own acceptance asks to be pasted.
 */
export function columnText(column: ColumnInference): string {
	if (column.empty) {
		return `${column.name} — ${column.type} (every cell empty)`;
	}
	const parts: string[] = [
		column.name,
		`${column.type} (${String(column.sampleSize)} sampled${column.complete ? '' : ', capped'})`,
	];
	if (column.nearMiss !== null) {
		parts.push(
			`${(column.nearMiss.share * 100).toFixed(0)}% look like ${column.nearMiss.type}`,
		);
	}
	const evidence = column.evidence
		.filter((cell) => cell.forced === 'blocks')
		.slice(0, 2)
		.map((cell) => `row ${String(cell.row)} “${cell.text}”`);
	if (evidence.length > 0) {
		parts.push(`— blocked by ${evidence.join(', ')}`);
	}
	if (column.alternative !== null) {
		parts.push(`→ could be ${column.alternative}`);
	}
	return parts.join(' ');
}

/**
 * The target step: the three modes with the exact counts.
 *
 * **The `append` placement question** (the step's own STOP clause). Two readings exist:
 *
 *   (A) *No placement at all.* The import writes notes into the row folder and touches no view state; whether a
 *       note is in this view is the view's **filter**'s answer, and where it sits is its **sort and grouping**.
 *   (B) *Land at the bottom of the current view.* That needs an order marker written into every imported note,
 *       which `docs/03` §Row creation rules out in as many words: *"A marker property is deliberately **not**
 *       written: the view's filter (typically `file.inFolder(...)`) defines membership."*
 *
 * (A) is what this build does, and it is what the description below tells the person, because the doc settles the
 * question rather than leaving it open. (B) would contradict that sentence, so it is reported rather than built —
 * see PROGRESS.md.
 */
export function targetOptions(input: {
	readonly plan: ImportPlan;
	readonly mode: ImportModeId;
	readonly existingColumnNames: readonly string[];
}): readonly WizardOption[] {
	const { plan } = input;
	const notes = plan.notes.length;
	const matched = plan.properties.filter((property) =>
		input.existingColumnNames.includes(property.name),
	);
	const fresh = plan.properties.filter(
		(property) => !input.existingColumnNames.includes(property.name),
	);
	const newProperties =
		fresh.length === 0
			? 'no new columns'
			: `${String(fresh.length)} new column(s): ${fresh.map((property) => property.name).join(', ')}`;
	return [
		{
			id: 'append',
			label: 'Append to the current view',
			description: `${String(matched.length)} of ${String(plan.properties.length)} column(s) match the view by name; ${newProperties}. Rows appear wherever the view's filter, sort and grouping put them.`,
			picked: input.mode === 'append',
		},
		{
			id: 'create',
			label: `Create ${String(notes)} note${notes === 1 ? '' : 's'}`,
			description: 'Every column becomes a property, whether or not this view has it.',
			picked: input.mode === 'create',
		},
		{
			id: 'replace',
			label: 'Replace the view’s contents',
			description:
				'Would delete every existing row first — a destructive, multi-file operation that needs its own review step, which this build does not have.',
			picked: input.mode === 'replace',
			disabledReason:
				'removing notes is not wired yet: the grid refuses to delete rows until that review step exists (src/adapters/bases/BasesSource.ts)',
		},
	];
}

/** The target step's body: the counts a person reads immediately before pressing the button. */
export function targetLines(plan: ImportPlan): readonly WizardLine[] {
	const lines: WizardLine[] = [
		{
			kind: 'fact',
			text: `${String(plan.notes.length)} note(s) will be created in “${plan.folder}”.`,
		},
		{
			kind: 'fact',
			text:
				plan.properties.length === 0
					? 'No properties will be written.'
					: `Properties: ${plan.properties.map((property) => `${property.name} (${property.type})`).join(', ')}.`,
		},
	];
	if (plan.skipped.length > 0) {
		lines.push({
			kind: 'skipped',
			text: `${String(plan.skipped.length)} cell(s) cannot be read as their column's type and will be left empty.`,
		});
	}
	lines.push({
		kind: 'hint',
		text: 'Undo removes exactly the notes this import creates, in one step.',
	});
	return lines;
}

/** Which types a person may switch a column to. The order is the registry's, exported for the override control. */
export const OVERRIDE_TYPES: readonly FieldTypeId[] = INFERABLE_TYPES;

/** The state machine, as a function: state in, step out. The Modal only renders what this returns. */
export function stepFor(step: WizardStepId, state: WizardState): WizardStep {
	switch (step) {
		case 'source':
			return sourceStep(state);
		case 'preview':
			return previewStep(state);
		case 'target':
			return targetStep(state);
	}
}

function sourceStep(state: WizardState): WizardStep {
	const { result, wizard } = state;
	const lines: WizardLine[] = [];
	if (result.ok) {
		lines.push({
			kind: 'fact',
			text: `Detected ${sizeSentence(result, state.hasHeader)} in ${wizard.source.name}.`,
		});
	} else {
		lines.push({ kind: 'warning', text: result.reason });
	}
	lines.push({
		kind: 'hint',
		text: 'Rows become notes. Each row is one note in the vault; nothing is written until the last step is confirmed.',
	});
	return {
		id: 'source',
		title: 'Import',
		subtitle: result.ok
			? `${wizard.source.name} — ${sizeSentence(result, state.hasHeader)}`
			: 'Pick a source.',
		lines,
		options: [],
		actions: [
			{ id: 'cancel', label: 'Cancel', primary: false },
			{
				id: 'continue',
				label: 'Continue ›',
				primary: true,
				...(result.ok ? {} : { disabledReason: result.reason }),
			},
		],
	};
}

function previewStep(state: WizardState): WizardStep {
	const { wizard, result } = state;
	if (!result.ok) {
		return sourceStep(state);
	}
	const columns = state.columns.map((column) => ({
		...column,
		type: state.overrides.get(column.index) ?? column.type,
	}));
	const options = planOptions(state);
	const estimate = estimateNotes(result.matrix, options, wizard.environment);
	const lines: WizardLine[] = [
		...previewLines({
			estimate,
			columns: options.columns,
			template: state.template,
			folder: state.folder,
			largeImportThreshold: wizard.largeImportThreshold,
			warnOnLargeImport: wizard.warnOnLargeImport,
		}),
		...columnLines(columns),
	];
	const tooMany = wizard.warnOnLargeImport && estimate.notes > wizard.largeImportThreshold;
	return {
		id: 'preview',
		title: 'Import',
		subtitle: `${sizeSentence(result, state.hasHeader)} detected in ${wizard.source.name}`,
		lines,
		options: [],
		actions: [
			{ id: 'back', label: '‹ Back', primary: false },
			{
				id: 'tabula',
				label: 'Keep as .tabula file instead',
				primary: false,
				disabledReason: TABULA_REASON,
			},
			{
				id: 'continue',
				label: 'Continue ›',
				// `docs/01`: above the threshold the cursor defaults to the escape hatch, which is the non-primary
				// action here — that is the same instruction with the escape hatch unbuilt.
				primary: !tooMany,
				...(estimate.notes === 0
					? {
							disabledReason:
								'there is nothing to create: every row is empty or excluded',
						}
					: {}),
			},
		],
	};
}

function targetStep(state: WizardState): WizardStep {
	const plan = state.plan;
	if (plan === null) {
		return previewStep(state);
	}
	const notes = plan.notes.length;
	return {
		id: 'target',
		title: 'Import',
		subtitle: `Creates ${String(notes)} note${notes === 1 ? '' : 's'} in “${plan.folder}” using ${plan.template}.md`,
		lines: targetLines(plan),
		options: targetOptions({
			plan,
			mode: state.mode,
			existingColumnNames: [...state.wizard.existing.values()],
		}),
		actions: [
			{ id: 'back', label: '‹ Back', primary: false },
			{ id: 'cancel', label: 'Cancel', primary: false },
			{
				id: 'create',
				label: `Create ${String(notes)} note${notes === 1 ? '' : 's'}`,
				primary: true,
				...(notes === 0 ? { disabledReason: 'there is nothing to create' } : {}),
			},
		],
	};
}
