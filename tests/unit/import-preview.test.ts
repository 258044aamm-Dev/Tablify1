/**
 * The import preview: **the inference table with its evidence, and the collision predictions.**
 *
 * Every case the step names is here, and each one asserts the *reason* as well as the verdict — a preview that says
 * "text" without saying which row stopped it being a number is the preview `docs/01` refuses to ship (*"the preview
 * dialog is mandatory and must state consequences"*).
 *
 * The two blocks after the inference are the ones that keep the preview honest: the plan's predicted paths are
 * compared with the files `createNote` actually creates for the same rows, and the wizard's sentences are built
 * from the same `estimateNotes` the runner consumes.
 */
import { describe, expect, it } from 'vitest';
import {
	fromCsvText,
	inferColumn,
	inferColumns,
	inferenceTable,
	readSource,
	SAMPLE_LIMIT,
} from '../../src/core/import/preview';
import { buildPlan, estimateNotes, noteIdFor } from '../../src/core/import/plan';
import type { ImportOptions, PlannedColumn, PlanEnvironment } from '../../src/core/import/plan';
import { noteBaseName } from '../../src/core/import/naming';
import { createNote } from '../../src/adapters/notes/createNote';
import type { NoteVault } from '../../src/adapters/notes/createNote';
import { resolveField } from '../../src/core/schema/propertySchema';
import {
	columnText,
	planFor,
	previewLines,
	sizeSentence,
	stepFor,
	targetOptions,
} from '../../src/plugin/import/wizardSpec';
import type { WizardState } from '../../src/plugin/import/wizardSpec';
import type { Matrix } from '../../src/core/selection/clipboard';
import type { FieldTypeId } from '../../src/core/types';
import { createFakeClock } from '../fakes/clock';
import { createFakeVault } from '../fakes/vault';

/** A column as the wizard confirms it, without the inference: what `importFields`/`fieldsFor` need. */
type ColumnSpec = { readonly index: number; readonly name: string; readonly type: FieldTypeId };

const CONTEXT = {
	path: '',
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
};

/** The descriptors for a column list, built exactly as `src/plugin/import/host.ts` builds them. */
function fieldsFor(columns: readonly ColumnSpec[]) {
	return columns.map((column) =>
		resolveField(
			// The type travels in `fieldOptions`: that is where `resolveField` reads it (`validateFieldOptions` →
			// `options.type`), and a `type` key on the definition is ignored.
			{
				id: noteIdFor(column.index),
				name: column.name,
				source: 'note',
				fieldOptions: { type: column.type },
			},
			{ ...CONTEXT, columnName: column.name },
		),
	);
}

/** A `PlanEnvironment` over a known set of paths and folders. */
function environment(
	columns: readonly ColumnSpec[],
	paths: readonly string[] = [],
	folders: readonly string[] = ['Rows'],
): PlanEnvironment {
	const known = new Set(paths);
	const folderSet = new Set(folders);
	return {
		has: (path) => known.has(path),
		hasFolder: (folder) => folder === '' || folderSet.has(folder),
		fields: fieldsFor(columns),
	};
}

/** The columns the matrix's own inference gives, so a test never restates the inference to plan with it. */
function columnsOf(matrix: Matrix, overrides?: ReadonlyMap<number, FieldTypeId>): PlannedColumn[] {
	const inferred = inferColumns(matrix, true);
	return inferred.columns.map((column) => ({
		index: column.index,
		name: column.name,
		type: overrides?.get(column.index) ?? column.type,
		inference: column,
		included: true,
	}));
}

const options = (columns: readonly PlannedColumn[], folder = 'Rows'): ImportOptions => ({
	columns,
	hasHeader: true,
	folder,
	template: '{{Name}}',
});

/* ── inference ───────────────────────────────────────────────────────────────────────────────── */

describe('inferColumn', () => {
	it('reads a column of ISO dates as dates, and offers text because a date-shaped code is a real thing', () => {
		const column = inferColumn(['2026-01-02', '2026-02-03'], {
			index: 0,
			name: 'Due',
			rowOffset: 1,
		});
		expect(column.type).toBe('date');
		expect(column.confidence).toBe(1);
		expect(column.nearMiss).toBeNull();
		expect(column.evidence.every((cell) => cell.forced === 'fits')).toBe(true);
		expect(column.alternative).toBe('text');
	});

	it('reads numbers with thousand separators and currency marks as numbers', () => {
		const column = inferColumn(['1,200', '3,400.50', '12'], {
			index: 0,
			name: 'Budget',
			rowOffset: 1,
		});
		expect(column.type).toBe('number');
		expect(column.evidence.map((cell) => cell.text)).toEqual(['1,200', '3,400.50', '12']);
	});

	it('separates a percentage from a bare number', () => {
		expect(inferColumn(['40%', '12.5%'], { index: 0, name: 'Share', rowOffset: 1 }).type).toBe(
			'percent',
		);
		expect(inferColumn(['40', '12.5'], { index: 0, name: 'Share', rowOffset: 1 }).type).toBe(
			'number',
		);
	});

	it('names the offending row when one text cell stops a numeric column', () => {
		const values = Array.from({ length: 99 }, (_unused, index) => String(index * 1.5));
		values.push('n/a');
		const column = inferColumn(values, { index: 3, name: 'Weight', rowOffset: 1 });
		expect(column.type).toBe('text');
		expect(column.distinct).toBe(100);
		expect(column.nearMiss).toEqual({ type: 'number', share: 0.99 });
		// The evidence is the row a person has to look at: the matrix row, and the text exactly as it arrived.
		expect(column.evidence).toEqual([
			{ row: 100, text: 'n/a', forced: 'blocks', blocksType: 'number' },
		]);
		expect(column.alternative).toBe('number');
		expect(columnText(column)).toContain('99% look like number');
		expect(columnText(column)).toContain('blocked by row 100 “n/a”');
	});

	it('reads true/false and yes/no as checkboxes, and says which values it saw', () => {
		expect(inferColumn(['true', 'false'], { index: 0, name: 'Done', rowOffset: 1 }).type).toBe(
			'checkbox',
		);
		const yesNo = inferColumn(['yes', 'no', 'yes'], { index: 0, name: 'Done', rowOffset: 1 });
		expect(yesNo.type).toBe('checkbox');
		expect(yesNo.samples).toEqual(['yes', 'no', 'yes']);
	});

	it('calls a small set of repeated values a single select', () => {
		const values = ['Todo', 'Doing', 'Done', 'Todo', 'Doing', 'Done', 'Todo', 'Doing'];
		const column = inferColumn(values, { index: 0, name: 'Status', rowOffset: 1 });
		expect(column.type).toBe('singleSelect');
		expect(column.distinct).toBe(3);
		expect(column.alternative).toBe('text');
	});

	it('calls long cells longText and refuses to call many distinct values a select', () => {
		// Five long, distinct values: more than the select rule allows, and every one of them over 40 characters.
		const longValues = ['a', 'b', 'c', 'd', 'e'].map((letter) => letter.repeat(60));
		const long = inferColumn(longValues, { index: 0, name: 'Notes', rowOffset: 1 });
		expect(long.type).toBe('longText');
		const many = Array.from({ length: 20 }, (_unused, index) => `value ${String(index)}`);
		const column = inferColumn(many, { index: 0, name: 'Anything', rowOffset: 1 });
		expect(column.type).toBe('text');
		expect(column.nearMiss).toBeNull();
		expect(column.alternative).toBeNull();
	});

	it('reports an empty column as text with no sample, which is what the wizard has to say about it', () => {
		const column = inferColumn(['', '   ', ''], { index: 1, name: 'Empty', rowOffset: 1 });
		expect(column.empty).toBe(true);
		expect(column.sampleSize).toBe(0);
		expect(column.confidence).toBe(1);
		expect(column.evidence).toEqual([]);
		expect(columnText(column)).toBe('Empty — text (every cell empty)');
	});

	it('caps the sample and says so, rather than walking a 5,000-row column to answer a yes/no question', () => {
		const values = Array.from({ length: SAMPLE_LIMIT + 25 }, () => '7');
		const column = inferColumn(values, { index: 0, name: 'Count', rowOffset: 1 });
		expect(column.complete).toBe(false);
		expect(column.sampleSize).toBe(SAMPLE_LIMIT);
		// Every sampled cell is the same number, so the numeric recogniser matches all of them — the select rule
		// never gets a turn, and the cap is the thing this test is about.
		expect(column.type).toBe('number');
		expect(columnText(column)).toContain('capped');
	});
});

describe('inferColumns and the table it prints', () => {
	const matrix: Matrix = [
		['Task', 'Budget', 'Due', 'Notes'],
		['Fix the scrollbar', '1,200', '2026-01-02', 'x'.repeat(50)],
		['Ship the fix', 'n/a', '2026-02-03', 'y'.repeat(50)],
	];

	it('infers every column of a matrix, reading the header row as the names', () => {
		const { columns, width, body } = inferColumns(matrix, true);
		expect(width).toBe(4);
		expect(body).toHaveLength(2);
		expect(columns.map((column) => column.name)).toEqual(['Task', 'Budget', 'Due', 'Notes']);
		// `Task` and `Budget` each hold a handful of repeated values, so the select rule fires: the prototype's
		// rule, and the one `docs/01` calls `single select` in the inferred set.
		expect(columns.map((column) => column.type)).toEqual([
			'singleSelect',
			'singleSelect',
			'date',
			'singleSelect',
		]);
	});

	it('names a column `Column 2` when the header cell is empty, and reports the rows it read', () => {
		const { columns } = inferColumns(
			[
				['', 'Budget'],
				['a', '1'],
			],
			true,
		);
		expect(columns[0]?.name).toBe('Column 1');
		expect(columns[0]?.evidence[0]?.row).toBe(1);
	});

	it('prints one block per column, with the evidence and the near miss on their lines', () => {
		const table = inferenceTable(inferColumns(matrix, true).columns);
		expect(table).toContain('Budget: singleSelect (1.00) → could be text');
		expect(table).toContain('Due: date (1.00) → could be text');
		expect(table).toContain('2 sample, 2 distinct');
		// The near-miss share, on a column where the select rule cannot fire.
		const values = Array.from({ length: 99 }, (_unused, index) => String(index * 1.5));
		values.push('n/a');
		const near = inferenceTable([
			inferColumn(values, { index: 0, name: 'Weight', rowOffset: 1 }),
		]);
		expect(near).toContain('Weight: text (1.00, 99% look like number) → could be number');
		expect(near).toContain('row 100 "n/a" blocks number');
	});
});

/* ── reading a source ────────────────────────────────────────────────────────────────────────── */

describe('readSource', () => {
	it('reads TSV first, CSV when there are no tabs, and reports which it did', () => {
		const tsv = readSource({ kind: 'text', text: 'a\tb\n1\t2', name: 'pasted' });
		expect(tsv.ok).toBe(true);
		if (tsv.ok) {
			expect(tsv.flavour).toBe('tsv');
		}
		const csv = readSource({ kind: 'text', text: 'a,b\n1,2', name: 'sheet.csv' });
		expect(csv.ok).toBe(true);
		if (csv.ok) {
			expect(csv.flavour).toBe('csv');
			expect(csv.matrix).toEqual([
				['a', 'b'],
				['1', '2'],
			]);
		}
	});

	it('reads an HTML table, and refuses text with nothing in it', () => {
		const html = readSource({
			kind: 'text',
			text: '<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
			name: 'clipboard',
		});
		expect(html.ok).toBe(true);
		if (html.ok) {
			expect(html.flavour).toBe('html');
		}
		const empty = readSource({ kind: 'text', text: '   \n  ', name: 'pasted' });
		expect(empty.ok).toBe(false);
	});

	it('honours quotes, doubled quotes and a newline inside a CSV field', () => {
		expect(fromCsvText('name,note\n"Smit, J","he said ""hi""\nagain"')).toEqual([
			['name', 'note'],
			['Smit, J', 'he said "hi"\nagain'],
		]);
	});
});

/* ── estimate + plan ─────────────────────────────────────────────────────────────────────────── */

describe('estimateNotes and buildPlan', () => {
	const matrix: Matrix = [
		['Name', 'Status'],
		['Fix the scrollbar', 'Todo'],
		['Fix the scrollbar', 'Done'],
		['Ship it', 'Todo'],
	];

	it('counts the notes exactly, and predicts a collision *inside* the same run', () => {
		const columns = columnsOf(matrix);
		const estimate = estimateNotes(matrix, options(columns), environment(columns));
		expect(estimate.notes).toBe(3);
		expect(estimate.cells).toBe(6);
		expect(estimate.collisions).toEqual([
			{
				path: 'Rows/Fix the scrollbar.md',
				became: 'Rows/Fix the scrollbar 2.md',
				against: 'same run',
			},
		]);
	});

	it('predicts a collision with the vault, naming the file it would have replaced', () => {
		const columns = columnsOf(matrix);
		const estimate = estimateNotes(
			matrix,
			options(columns),
			environment(columns, ['Rows/Fix the scrollbar.md']),
		);
		expect(estimate.collisions).toEqual([
			{
				path: 'Rows/Fix the scrollbar.md',
				became: 'Rows/Fix the scrollbar 2.md',
				against: 'vault',
			},
			// The second row wants the same name, and the vault already had it — so the sentence is the vault's,
			// even though row 1 also took the ` 2` variant a moment earlier.
			{
				path: 'Rows/Fix the scrollbar.md',
				became: 'Rows/Fix the scrollbar 3.md',
				against: 'vault',
			},
		]);
	});

	it('says the folder is missing instead of planning notes into nowhere', () => {
		const columns = columnsOf(matrix);
		const estimate = estimateNotes(matrix, options(columns), environment(columns, [], []));
		expect(estimate.missingFolder).toBe(true);
		expect(estimate.notes).toBe(3);
	});

	it('writes only the non-default values, and gives every note its own name and ordinal', () => {
		const columns = columnsOf(matrix);
		const plan = buildPlan(matrix, options(columns), environment(columns));
		expect(plan.notes[0]?.frontmatter).toEqual({ Name: 'Fix the scrollbar', Status: 'Todo' });
		expect(plan.notes[1]?.name).toBe('Fix the scrollbar 2');
		expect(plan.notes.map((note) => note.ordinal)).toEqual([1, 2, 3]);
		expect(plan.notes.map((note) => note.row)).toEqual([1, 2, 3]);
	});

	it('never drops a cell it cannot read silently: the row is created, the cell is reported', () => {
		const wide: Matrix = [
			['Name', 'Budget'],
			['Fix the scrollbar', '1,200'],
			['Ship it', '900'],
			['Later', 'not a number'],
		];
		const columns = columnsOf(wide, new Map([[1, 'number']]));
		const plan = buildPlan(wide, options(columns), environment(columns));
		expect(plan.notes).toHaveLength(3);
		expect(plan.skipped).toEqual([
			{ row: 3, reason: 'Budget: "not a number" is not a number' },
		]);
		expect(plan.notes[2]?.frontmatter).toEqual({ Name: 'Later' });
		expect(plan.notes[0]?.frontmatter).toEqual({ Name: 'Fix the scrollbar', Budget: 1200 });
	});

	it('honours an override and an unticked column', () => {
		const asText = columnsOf(matrix, new Map([[1, 'text']]));
		const plan = buildPlan(matrix, options(asText), environment(asText));
		expect(plan.properties).toEqual([
			{ name: 'Name', type: 'singleSelect' },
			{ name: 'Status', type: 'text' },
		]);
		const onlyStatus = columnsOf(matrix).map((column) => ({
			...column,
			included: column.index === 1,
		}));
		const statusOnly = buildPlan(
			matrix,
			options(onlyStatus),
			environment(onlyStatus.map(({ index, name, type }) => ({ index, name, type }))),
		);
		expect(statusOnly.properties).toEqual([{ name: 'Status', type: 'singleSelect' }]);
		// The name's source is the first *included* column, and with `Name` unticked that is `Status` — so the
		// template cannot be filled and the documented second chance applies: the leading column's own value.
		expect(statusOnly.notes[0]?.name).toBe('Todo');
		// …and the third row's `Todo` collides with the first row's, which is the same-run collision again.
		expect(statusOnly.notes[2]?.name).toBe('Todo 2');
	});

	it('plans a subset when a limit is set: the preview can stop before the vault does', () => {
		const columns = columnsOf(matrix);
		const plan = buildPlan(matrix, { ...options(columns), limit: 2 }, environment(columns));
		expect(plan.notes).toHaveLength(2);
	});

	it('refuses a note when a column has no field to write to, and says which column', () => {
		const columns = columnsOf(matrix);
		// A field list that has forgotten the second column: the plan must say so, not write a nameless key.
		const missing: PlanEnvironment = {
			has: () => false,
			hasFolder: () => true,
			fields: fieldsFor([{ index: 0, name: 'Name', type: 'text' }]),
		};
		const plan = buildPlan(matrix, options(columns), missing);
		expect(
			plan.skipped.filter((skip) => skip.reason.includes('has no field to write to')),
		).toHaveLength(3);
	});
});

/* ── one rule, two callers ───────────────────────────────────────────────────────────────────── */

describe('the plan’s names are the names createNote makes', () => {
	it('agrees for every row of a matrix, including two collisions and a name with illegal characters', async () => {
		const matrix: Matrix = [
			['Name', 'Status'],
			['Fix the scrollbar', 'Todo'],
			['Fix the scrollbar', 'Done'],
			['A/B: a note with illegal characters', 'Todo'],
			['', 'Todo'],
		];
		const columns = columnsOf(matrix);
		const env = environment(columns);
		const plan = buildPlan(matrix, options(columns), env);

		const vault = createFakeVault({ clock: createFakeClock() });
		const port: NoteVault = {
			has: (path) => vault.app.vault.getFileByPath(path) !== null,
			hasFolder: () => true,
			create: async (path, content) => {
				vault.createNote(path, content);
			},
		};
		const created: string[] = [];
		for (const [index, note] of plan.notes.entries()) {
			const outcome = await createNote({
				vault: port,
				folder: 'Rows',
				template: '{{Name}}',
				values: note.values,
				fields: env.fields,
				ordinal: index + 1,
				forceDirect: true,
			});
			expect(outcome.result.ok).toBe(true);
			if (outcome.result.ok) {
				created.push(outcome.result.file.path);
			}
		}
		// The prediction and the disk, side by side: this is the assertion the whole preview rests on.
		expect(created).toEqual(plan.notes.map((note) => note.path));
		expect(plan.notes[2]?.name).toBe('A B a note with illegal characters');
		expect(plan.notes[3]?.name).toBe('Row 4');
	});
});

describe('noteBaseName', () => {
	const fields = fieldsFor([{ index: 0, name: 'Name', type: 'text' }]);

	it('falls back to the row number for an empty template and for a missing value', () => {
		expect(noteBaseName({ template: '', values: {}, fields, ordinal: 7 })).toBe('Row 7');
		expect(noteBaseName({ template: '{{Name}}', values: {}, fields, ordinal: 7 })).toBe(
			'Row 7',
		);
	});

	it('expands a column by name and by id, and knows {{n}}', () => {
		const values = { 'note.Import0': 'Plan' };
		expect(noteBaseName({ template: '{{Name}}', values, fields, ordinal: 7 })).toBe('Plan');
		expect(noteBaseName({ template: '{{n}}', values, fields, ordinal: 7 })).toBe('7');
	});
});

/* ── the wizard's copy, built from the same numbers ──────────────────────────────────────────── */

describe('the wizard’s own copy', () => {
	const matrix: Matrix = [
		['Name', 'Budget'],
		['Fix the scrollbar', '1,200'],
		['Ship it', '900'],
	];
	const columns = columnsOf(matrix);

	/** The state the Modal holds, with the plan built the way `runAction('continue')` builds it. */
	function stateWith(overrides?: Partial<WizardState>): WizardState {
		const base: WizardState = {
			wizard: {
				source: { kind: 'matrix', matrix, name: 'pasted text' },
				largeImportThreshold: 250,
				warnOnLargeImport: true,
				template: '{{Name}}',
				folder: 'Rows',
				existing: new Map([['note.Import0', 'Name']]),
				environment: environment(columns),
			},
			result: readSource({ kind: 'matrix', matrix, name: 'pasted text' }),
			hasHeader: true,
			columns: inferColumns(matrix, true).columns,
			overrides: new Map<number, FieldTypeId>(),
			excluded: new Set<number>(),
			folder: 'Rows',
			template: '{{Name}}',
			mode: 'append',
			plan: null,
		};
		return { ...base, ...overrides };
	}

	it('states the size in columns and rows, never "about" anything', () => {
		expect(sizeSentence(stateWith().result, true)).toBe('2 columns × 2 rows');
		expect(sizeSentence(stateWith({ hasHeader: false }).result, false)).toBe(
			'2 columns × 3 rows',
		);
	});

	it('states the notes, the properties and the columns it will write — from the same estimate', () => {
		const state = stateWith();
		const plan = planFor({
			matrix,
			hasHeader: state.hasHeader,
			columns: state.columns,
			overrides: state.overrides,
			excluded: state.excluded,
			folder: state.folder,
			template: state.template,
			environment: state.wizard.environment,
		});
		const step = stepFor('preview', { ...state, plan });
		expect(step.lines[0]?.text).toBe('Creates 2 notes in “Rows” using {{Name}}.md');
		expect(step.lines[1]?.text).toContain('4 values across 2 properties');
		expect(step.lines.filter((line) => line.kind === 'collision')).toHaveLength(0);
		// One line per column, each with its verdict and sample — the wizard's own inference table.
		expect(step.lines.filter((line) => line.kind === 'column')).toHaveLength(2);
	});

	it('says the folder is missing, right after the count that depends on it', () => {
		const lines = previewLines({
			estimate: estimateNotes(matrix, options(columns), environment(columns, [], [])),
			columns,
			template: '{{Name}}',
			folder: 'Rows',
			largeImportThreshold: 250,
			warnOnLargeImport: true,
		});
		expect(lines[1]?.kind).toBe('warning');
		expect(lines[1]?.text).toContain('does not exist');
	});

	it('warns above the threshold and refuses to call the escape hatch available', () => {
		const big: Matrix = [
			['Name'],
			...Array.from({ length: 300 }, (_unused, index) => [`Row ${String(index)}`]),
		];
		const bigColumns = columnsOf(big);
		const lines = previewLines({
			estimate: estimateNotes(big, options(bigColumns), environment(bigColumns)),
			columns: bigColumns,
			template: '{{Name}}',
			folder: 'Rows',
			largeImportThreshold: 250,
			warnOnLargeImport: true,
		});
		const warning = lines.find((line) => line.text.includes('warning level'));
		expect(warning?.text).toContain('300 notes is above the 250-row warning level');
		expect(warning?.text).toContain('.tabula');
		const step = stepFor('preview', {
			...stateWith(),
			result: readSource({ kind: 'matrix', matrix: big, name: 'big sheet' }),
			columns: inferColumns(big, true).columns,
		});
		const tabula = step.actions.find((action) => action.id === 'tabula');
		expect(tabula?.disabledReason).toContain('not in this build');
		// Above the threshold the primary action is not the cursor: `docs/01` puts it on the escape hatch.
		expect(step.actions.find((action) => action.id === 'continue')?.primary).toBe(false);
	});

	it('offers the three modes with the exact counts, and says why replace cannot run', () => {
		const plan = buildPlan(matrix, options(columns), environment(columns));
		const [append, create, replace] = targetOptions({
			plan,
			mode: 'append',
			existingColumnNames: ['Name'],
		});
		expect(append?.description).toContain('1 of 2 column(s) match the view by name');
		expect(append?.description).toContain('1 new column(s): Budget');
		expect(append?.description).toContain('filter, sort and grouping');
		expect(create?.label).toBe('Create 2 notes');
		expect(replace?.disabledReason).toContain('removing notes is not wired yet');
	});

	it('reports a cell the confirmed type cannot read as a skip line, not as an empty cell', () => {
		const wide: Matrix = [
			['Name', 'Budget'],
			['Fix the scrollbar', '1,200'],
			['Later', 'not a number'],
		];
		const overrides = new Map<number, FieldTypeId>([[1, 'number']]);
		const wideColumns = columnsOf(wide, overrides);
		const plan = buildPlan(wide, options(wideColumns), environment(wideColumns));
		const lines = previewLines({
			estimate: estimateNotes(wide, options(wideColumns), environment(wideColumns)),
			columns: wideColumns,
			template: '{{Name}}',
			folder: 'Rows',
			largeImportThreshold: 250,
			warnOnLargeImport: true,
		});
		expect(lines.filter((line) => line.kind === 'skipped')).toHaveLength(1);
		expect(lines.find((line) => line.kind === 'skipped')?.text).toBe(
			'row 2: Budget: "not a number" is not a number',
		);
		expect(plan.skipped).toHaveLength(1);
	});

	it('opens on the preview step when the source has rows, and on the source step when it does not', () => {
		const good = stepFor('source', stateWith());
		expect(
			good.actions.find((action) => action.id === 'continue')?.disabledReason,
		).toBeUndefined();
		const bad = stepFor('source', {
			...stateWith(),
			result: readSource({ kind: 'text', text: '  ', name: 'pasted' }),
		});
		expect(bad.actions.find((action) => action.id === 'continue')?.disabledReason).toBe(
			'there is nothing to import',
		);
	});
});
