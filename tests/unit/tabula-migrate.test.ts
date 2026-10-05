/**
 * The migration: what the dry run reports, and what applying it actually does.
 *
 * Three layers, because a migration touches three of them and a bug in any one is invisible from the others:
 *
 *  1. **`dryRunMigration`** — pure data, no clock and no vault. Six of the seven fixtures are snapshotted,
 *     including the whole report for `v1-simple`, so the dialog's content is pinned field by field.
 *  2. **`migrateMutation`** — the ops. One `importBlock` per table, one `setFieldOptions` per column that
 *     carries options, one `setViewConfig` per view, in that order. `createNoteStore` (a fake from
 *     `tests/fakes/`) applies them the way the store will: notes through the **shipping** note writer, state
 *     through the **shipping** reducer.
 *  3. **`BasesSource`** — the view half. A migration is not a special path through the source: the rows
 *     belong to the store, and the source contributes the sidecar (`fieldOptions`, `tablifyViewConfig`).
 *
 * The one thing asserted at every layer is what must *not* change: the `.tabula` bytes, and any note that
 * already exists at a target path.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseTabulaFile } from '../../src/adapters/tabulaFile/parse';
import type { TabulaDoc, TabulaTable } from '../../src/adapters/tabulaFile/model';
import { dryRunMigration } from '../../src/core/migrate/dryRun';
import {
	fieldOptionsFor,
	resolveColumns,
	toFieldDescriptors,
} from '../../src/adapters/tabulaFile/model';
import { resolveField } from '../../src/core/schema/propertySchema';
import type { ResolvedField } from '../../src/core/schema/propertySchema';
import type { FieldContext } from '../../src/core/types';
import type { MigrationReport, MigrationTarget, TablePlan } from '../../src/core/migrate/dryRun';
import { migrateMutation, migrationLabel, migrationNotes } from '../../src/core/migrate/apply';
import { createHistory } from '../../src/core/ops/history';
import type { Before } from '../../src/core/ops/types';
import { createBasesSource } from '../../src/adapters/bases/BasesSource';
import type { BasesViewHost } from '../../src/adapters/bases/BasesSource';
import { sanitizeFileName } from '../../src/adapters/notes/createNote';
import type { FrontmatterWriter } from '../../src/adapters/writeQueue';
import { createFakeClock } from '../fakes/clock';
import { createFakeVault } from '../fakes/vault';
import { createNoteStore } from '../fakes/noteStore';

const DIRECTORY = new URL('../fixtures/tabula/', import.meta.url);

function textOf(name: string): string {
	return readFileSync(new URL(`${name}.tabula`, DIRECTORY), 'utf8');
}

/** The first table of a document, or a thrown error: a fixture without one is a broken test, not a case. */
function firstTable(doc: TabulaDoc): TabulaTable {
	const table = doc.tables[0];
	if (table === undefined) {
		throw new Error('the fixture has no tables');
	}
	return table;
}

function documentOf(name: string): TabulaDoc {
	const result = parseTabulaFile(textOf(name), `${name}.tabula`);
	if (!result.ok) {
		throw new Error(`fixture ${name}.tabula did not parse: ${result.error.message}`);
	}
	return result.doc;
}

/**
 * The target a real caller would pass: the base's path, one folder per table, and the file-name rule from
 * `docs/03` step 3 applied with the shipping sanitiser. De-duplication is the caller's job (the same job
 * `createNote` does when two rows want the same name), so it lives here rather than in the core.
 */
function targetFor(doc: TabulaDoc, options?: { readonly template?: string }): MigrationTarget {
	const taken = new Set<string>();
	return {
		basePath: `Bases/${doc.tables[0]?.name ?? 'Table'}.base`,
		folderFor: (table) => `Bases/${sanitizeFileName(table.name)}`,
		pathFor: (input) => {
			const base = sanitizeFileName(
				input.primaryValue === '' ? `Row ${String(input.ordinal)}` : input.primaryValue,
			);
			let candidate = base;
			for (let suffix = 2; taken.has(candidate.toLowerCase()); suffix += 1) {
				candidate = `${base} ${String(suffix)}`;
			}
			taken.add(candidate.toLowerCase());
			return `Bases/${sanitizeFileName(input.table.name)}/${candidate}.md`;
		},
		filenameTemplate: options?.template ?? '{{Name}}',
	};
}

/**
 * The columns the migrated base will have, as the store resolves them: the same property names the dry run
 * reports, and the same `fieldOptions` the `setFieldOptions` ops carry. Without this the note writer would
 * fall back to text for every column and quietly stringify the boolean and the select.
 */
const CONTEXT: FieldContext = {
	path: '',
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
	columnName: '',
};

function fieldsFor(table: TabulaTable): readonly ResolvedField[] {
	const columns = resolveColumns(table);
	return toFieldDescriptors(table).map((mapping, index) => {
		const options = fieldOptionsFor(mapping);
		return resolveField(
			{
				id: `note.${columns[index]?.propertyName ?? mapping.field.name}`,
				name: columns[index]?.propertyName ?? mapping.field.name,
				source: 'note',
				...(options === null ? {} : { fieldOptions: options }),
			},
			CONTEXT,
		);
	});
}

/** The report's shape without the per-column prose, for fixtures whose point is a count or a destination. */
function summaryOf(plan: TablePlan): unknown {
	return {
		tableName: plan.tableName,
		rows: plan.rows,
		columns: plan.columns.map(
			(column) =>
				`${column.sourceName}:${column.from}->${column.to ?? '-'} (${column.destination})`,
		),
		orphans: plan.orphans.map((orphan) => `${orphan.fieldId}=${orphan.value}`),
		shapeProblems: plan.shapeProblems,
		primary: plan.primaryFieldName,
		missingPrimary: plan.missingPrimary,
		duplicateNames: plan.duplicateNames,
		notesToCreate: plan.notesToCreate,
		filenameSample: plan.filenameSample,
		view: {
			sorts: plan.view.sorts,
			groupBy: plan.view.groupBy,
			hiddenColumns: plan.view.hiddenColumns,
			conditions: plan.view.conditions.map(
				(condition) =>
					`${condition.fieldId} ${condition.operator} -> ${condition.canonical ?? 'dropped'}`,
			),
			dropped: plan.view.dropped,
		},
		warnings: plan.warnings.map((warning) => warning.code),
	};
}

function summary(report: MigrationReport): unknown {
	return {
		path: report.path,
		version: report.version,
		basePath: report.basePath,
		filenameTemplate: report.filenameTemplate,
		totals: report.totals,
		tables: report.tables.map((plan) => summaryOf(plan)),
	};
}

describe('the dry run', () => {
	it('reports a v1 file column by column', () => {
		const report = dryRunMigration(documentOf('v1-simple'), targetFor(documentOf('v1-simple')));
		// The whole report, so the dialog's numbers, names and wording are all pinned at once.
		expect(summary(report)).toMatchSnapshot();
	});

	for (const name of [
		'v2-three-tables',
		'unknown-types',
		'orphan-options',
		'empty',
		'crlf-bom',
	]) {
		it(`reports ${name}.tabula`, () => {
			const doc = documentOf(name);
			expect(summary(dryRunMigration(doc, targetFor(doc)))).toMatchSnapshot();
		});
	}

	it('plans one note per row, in table order, with the names the caller’s rule produces', () => {
		const doc = documentOf('v2-three-tables');
		const report = dryRunMigration(doc, targetFor(doc));
		expect(report.totals.notesToCreate).toBe(6);
		expect(report.tables.map((plan) => plan.notesToCreate)).toEqual([3, 2, 1]);
		expect(report.tables[0]?.filenameSample).toEqual(['Widening', 'Resurfacing', 'Signage']);
		expect(report.totals.tables).toBe(3);
		expect(report.totals.rows).toBe(6);
	});

	it('translates the legacy operators onto the twelve canonical ones', () => {
		const legacy = [
			'equals',
			'contains',
			'before',
			'after',
			'isAnyOf',
			'isTrue',
			'gt',
			'isEmpty',
		];
		const conditions = legacy.map((operator) => ({
			fieldId: 'f_a',
			operator,
			value: operator === 'isTrue' ? true : 'x',
		}));
		const doc = parseTabulaFile(
			JSON.stringify({
				version: 1,
				fields: [
					{ id: 'f_a', name: 'A', type: 'text' },
					{ id: 'f_b', name: 'B', type: 'date' },
				],
				rows: [{ id: 'r_1', cells: { f_a: 'x' } }],
				view: { filters: { logic: 'and', conditions } },
			}),
			'Operators.tabula',
		);
		expect(doc.ok).toBe(true);
		if (!doc.ok) {
			return;
		}
		const plan = dryRunMigration(doc.doc, targetFor(doc.doc)).tables[0];
		expect(plan?.view.conditions.map((condition) => condition.canonical)).toEqual([
			'is',
			'contains',
			'lt',
			'gt',
			'contains',
			'is',
			'gt',
			'isEmpty',
		]);
		expect(plan?.view.conditions.every((condition) => condition.reason !== '')).toBe(true);
	});

	it('reports an operator it cannot translate instead of inventing one', () => {
		const doc = parseTabulaFile(
			JSON.stringify({
				version: 1,
				fields: [{ id: 'f_a', name: 'A', type: 'text' }],
				rows: [],
				view: {
					filters: {
						logic: 'and',
						conditions: [{ fieldId: 'f_a', operator: 'fuzzyMatches', value: 'x' }],
					},
				},
			}),
			'Unknown operator.tabula',
		);
		expect(doc.ok).toBe(true);
		if (!doc.ok) {
			return;
		}
		const plan = dryRunMigration(doc.doc, targetFor(doc.doc)).tables[0];
		const condition = plan?.view.conditions[0];
		expect(condition?.canonical).toBeNull();
		// The column and the wording both survive: a dropped filter has to be reviewable, not silent.
		expect(condition?.fieldId).toBe('note.A');
		expect(condition?.operator).toBe('fuzzyMatches');
		expect(plan?.view.dropped.some((entry) => entry.includes('fuzzyMatches'))).toBe(true);
	});

	it('lists the settings it cannot carry, in the user’s words', () => {
		const doc = documentOf('v1-simple');
		const plan = dryRunMigration(doc, targetFor(doc)).tables[0];
		const dropped = (plan?.view.dropped ?? []).join(' | ');
		expect(dropped).toContain('search');
		expect(dropped).toContain('column width');
		expect(dropped).toContain('query string');
		// The counter is only mentioned when a column used it, so the v1 fixture's numbers stay quiet.
		expect(dropped).not.toContain('auto-number');
		const mixed = dryRunMigration(
			documentOf('unknown-types'),
			targetFor(documentOf('unknown-types')),
		).tables[0];
		expect((mixed?.view.dropped ?? []).join(' | ')).toContain('auto-number');
		// Everything it *can* carry is in the patch the op will write.
		expect(plan?.view.sorts).toBe(1);
		expect(plan?.view.groupBy).toBe('note.Status');
		expect(plan?.view.hiddenColumns).toBe(1);
	});

	it('reports a duplicate primary name rather than silently renaming one of the rows', () => {
		const doc = parseTabulaFile(
			JSON.stringify({
				version: 1,
				fields: [{ id: 'f_a', name: 'A', type: 'text' }],
				rows: [
					{ id: 'r_1', cells: { f_a: 'Plan' } },
					{ id: 'r_2', cells: { f_a: 'plan' } },
					{ id: 'r_3', cells: { f_a: 'Other' } },
				],
			}),
			'Duplicates.tabula',
		);
		expect(doc.ok).toBe(true);
		if (!doc.ok) {
			return;
		}
		const report = dryRunMigration(doc.doc, targetFor(doc.doc));
		expect(report.tables[0]?.duplicateNames).toBe(1);
		// Both rows are still planned; the caller's rule makes the second path unique.
		expect(report.tables[0]?.notesToCreate).toBe(3);
		expect(report.tables[0]?.filenameSample).toEqual(['Plan', 'plan', 'Other']);
		const paths = migrationNotes(doc.doc, report, targetFor(doc.doc)).map((note) => note.path);
		expect(paths).toEqual([
			'Bases/table 1/Plan.md',
			'Bases/table 1/plan 2.md',
			'Bases/table 1/Other.md',
		]);
	});

	it('keeps a dropped column and its counter out of the plan but in the report', () => {
		const doc = documentOf('unknown-types');
		const plan = dryRunMigration(doc, targetFor(doc)).tables[0];
		expect(plan?.dropped.map((column) => column.sourceName)).toEqual(['Number']);
		expect(plan?.dropped[0]?.to).toBeNull();
		// The two types this build does not know are kept as text, and each one warned during the read.
		expect(plan?.remapped.map((column) => `${column.sourceName}:${column.to}`)).toEqual([
			'Lookup owner:text',
			'Rolled up:text',
		]);
		expect(plan?.metadata.map((column) => `${column.sourceName}:${column.to}`)).toEqual([
			'Created:createdTime',
			'Last modified:lastModifiedTime',
		]);
		// `stored` and the destination cannot disagree: only the two "kept" destinations put a value in
		// frontmatter, and a file-metadata or dropped column never does.
		expect(
			plan?.columns.every(
				(column) =>
					column.stored ===
					(column.destination === 'kept' || column.destination === 'remapped'),
			),
		).toBe(true);
		// Name, the two unknown types, the dropped autoNumber, then the two file-metadata columns.
		expect(plan?.columns.map((column) => column.destination)).toEqual([
			'kept',
			'remapped',
			'remapped',
			'dropped',
			'metadata',
			'metadata',
		]);
	});
});

describe('applying the migration', () => {
	it('creates one note per row, with the values the columns promised', () => {
		const doc = documentOf('v1-simple');
		const target = targetFor(doc);
		const report = dryRunMigration(doc, target);
		const clock = createFakeClock();
		const vault = createFakeVault({ clock });
		const store = createNoteStore({
			vault,
			fields: fieldsFor(firstTable(doc)),
		});
		store.apply(migrateMutation(doc, report, target));
		expect(vault.paths()).toEqual([
			'Bases/Content calendar/Quarterly report.md',
			'Bases/Content calendar/Launch notes.md',
			'Bases/Content calendar/Ideas backlog.md',
		]);
		// The select option's **label**, not its id: a note stores what a person typed.
		expect(vault.frontmatterOf('Bases/Content calendar/Launch notes.md')).toEqual({
			Title: 'Launch notes',
			Status: 'Drafting',
			Words: 900,
			Due: '2024-11-20',
			Done: false,
		});
	});

	it('leaves a note that already exists at a target path exactly as it was', () => {
		const doc = documentOf('v1-simple');
		const target = targetFor(doc);
		const report = dryRunMigration(doc, target);
		const clock = createFakeClock();
		const vault = createFakeVault({ clock });
		vault.seedNote('Bases/Content calendar/Launch notes.md', { Title: 'Mine, not the file’s' });
		const store = createNoteStore({ vault, fields: [] });
		store.apply(migrateMutation(doc, report, target));
		expect(store.created()).toEqual([
			'Bases/Content calendar/Quarterly report.md',
			'Bases/Content calendar/Ideas backlog.md',
		]);
		expect(vault.frontmatterOf('Bases/Content calendar/Launch notes.md')).toEqual({
			Title: 'Mine, not the file’s',
		});
	});

	it('is one command, so one undo takes every note back', () => {
		const doc = documentOf('v1-simple');
		const target = targetFor(doc);
		const report = dryRunMigration(doc, target);
		const ops = migrateMutation(doc, report, target);
		expect(ops.map((op) => op.kind)).toEqual([
			'importBlock',
			'setFieldOptions',
			'setViewConfig',
		]);

		const clock = createFakeClock();
		const vault = createFakeVault({ clock });
		const store = createNoteStore({ vault, fields: [] });
		const history = createHistory();
		// The store pushes the whole mutation as one command; `{kind:'none'}` is the honest before-image for a
		// note that did not exist, and it is what the reducer's own inventory of ops declares.
		const befores: Before[] = ops.map(() => ({ kind: 'none' }));
		history.push({ label: migrationLabel(report), ops, befores });
		expect(history.depth()).toBe(1);
		expect(history.undoLabel()).toBe('Migrate 3 notes from 1 table');

		store.apply(ops);
		expect(vault.paths()).toHaveLength(3);
		const undone = history.undo();
		expect(undone.ok).toBe(true);
		if (!undone.ok) {
			return;
		}
		store.apply(undone.ops);
		expect(store.removed()).toEqual([
			'Bases/Content calendar/Quarterly report.md',
			'Bases/Content calendar/Launch notes.md',
			'Bases/Content calendar/Ideas backlog.md',
		]);
		expect(vault.paths()).toEqual([]);
		expect(history.depth()).toBe(0);
		// One redo puts them back: the inverse of an import is a delete, and the inverse of that is the import.
		const redone = history.redo();
		expect(redone.ok).toBe(true);
		if (redone.ok) {
			store.apply(redone.ops);
			expect(vault.paths()).toHaveLength(3);
		}
	});

	it('never touches the file it migrates from', () => {
		const before = textOf('v2-three-tables');
		const doc = documentOf('v2-three-tables');
		const target = targetFor(doc);
		const report = dryRunMigration(doc, target);
		const clock = createFakeClock();
		const vault = createFakeVault({ clock });
		const store = createNoteStore({ vault, fields: [] });
		store.apply(migrateMutation(doc, report, target));
		// Not one path in the mutation names a `.tabula` file, and the vault has none to begin with.
		expect(vault.paths().every((path) => path.endsWith('.md'))).toBe(true);
		expect(vault.paths().some((path) => path.includes('.tabula'))).toBe(false);
		expect(textOf('v2-three-tables')).toBe(before);
		expect(readFileSync(new URL('v2-three-tables.tabula', DIRECTORY), 'utf8')).toBe(before);
	});

	it('keeps an orphaned option value as the text it was', () => {
		const doc = documentOf('orphan-options');
		const target = targetFor(doc);
		const report = dryRunMigration(doc, target);
		expect(report.totals.orphanValues).toBe(2);
		const notes = migrationNotes(doc, report, target);
		expect(notes[0]?.cells).toEqual({
			'note.Name': 'Keeps a deleted option',
			'note.Status': 'o_archived',
			'note.Tags': ['ship', 'o_urgent'],
		});
	});

	it('writes the migration through the view source as one sidecar patch per table', async () => {
		const doc = documentOf('v1-simple');
		const target = targetFor(doc);
		const report = dryRunMigration(doc, target);
		const clock = createFakeClock();
		const vault = createFakeVault({ clock });
		const configWrites: { key: string; value: string }[] = [];
		const host: BasesViewHost = {
			rows: () => [],
			order: () => ['note.Title', 'note.Status'],
			displayName: () => undefined,
			rawValue: () => undefined,
			config: () => undefined,
			setConfig: (key, value) => {
				configWrites.push({ key, value });
			},
			watch: () => () => undefined,
		};
		const writer: FrontmatterWriter = {
			processFrontMatter: async (path, mutate) => {
				const file = vault.app.vault.getFileByPath(path);
				if (file === null) {
					throw new Error(`no note at "${path}"`);
				}
				await vault.app.fileManager.processFrontMatter(file, mutate);
			},
		};
		const source = createBasesSource({
			host,
			writer,
			env: { now: () => 0, timezone: 'UTC', locale: 'en-GB' },
			timers: clock,
			schedule: () => undefined,
		});

		// The rows are the store's business (above); what the source must contribute is the sidecar, and it
		// must not claim to have written a cell it never wrote.
		const result = await source.apply(migrateMutation(doc, report, target));
		expect(result.refused).toEqual([]);
		expect(result.written).toBe(0);
		await source.flush();
		// One ops batch, and the source's own order: the column's options are described before the view that
		// reads them, so a store applying this batch in order cannot show a select before it exists.
		expect(configWrites.map((entry) => entry.key)).toEqual([
			'fieldOptions',
			'tablifyViewConfig',
		]);
		expect(configWrites[0]?.value).toContain('"note.Status"');
		expect(configWrites[0]?.value).toContain('Drafting');
		expect(configWrites[1]?.value).toContain('"note.Status"');
		source.dispose();
	});
});
