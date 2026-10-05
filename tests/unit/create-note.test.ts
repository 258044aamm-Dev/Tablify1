/**
 * `createNote`: the five behaviours the step names — collisions, the empty template, a missing folder, the
 * manual fallback, and "the frontmatter the queue would have written" — against the fake vault.
 *
 * The vault is handed in as the narrow `NoteVault` port, so the folder question is answered by the test
 * rather than by a filesystem: the fake vault stores notes, and `hasFolder` is a set the test controls.
 */
import { describe, expect, it } from 'vitest';
import {
	createNote,
	expandTemplate,
	frontmatterBody,
	frontmatterFor,
	sanitizeFileName,
} from '../../src/adapters/notes/createNote';
import type { CreateNoteOptions, NoteVault } from '../../src/adapters/notes/createNote';
import { resolveField } from '../../src/core/schema/propertySchema';
import { createFakeClock } from '../fakes/clock';
import { createFakeVault } from '../fakes/vault';
import type { CellValue, FieldContext } from '../../src/core/types';

const CONTEXT: FieldContext = {
	path: '',
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
	columnName: '',
};

const NAME = resolveField({ id: 'note.Name', name: 'Name', source: 'note' }, CONTEXT);
const STATUS = resolveField({ id: 'note.Status', name: 'Status', source: 'note' }, CONTEXT);
const DONE = resolveField({ id: 'note.Done', name: 'Done', source: 'note' }, CONTEXT);
/** A column that cannot be written: creation must skip it, whatever the caller put in `values`. */
const MTIME = resolveField({ id: 'file.mtime', name: 'mtime', source: 'file' }, CONTEXT);

const FIELDS = [NAME, STATUS, DONE, MTIME];

function harness(folders: readonly string[] = ['Projects Rows']) {
	const vault = createFakeVault({ clock: createFakeClock() });
	const known = new Set(folders);
	const port: NoteVault = {
		has: (path) => vault.app.vault.getFileByPath(path) !== null,
		hasFolder: (folder) => known.has(folder),
		create: async (path, content) => {
			vault.createNote(path, content);
		},
	};
	return { vault, port, known };
}

function options(port: NoteVault, overrides?: Partial<CreateNoteOptions>): CreateNoteOptions {
	return {
		vault: port,
		folder: 'Projects Rows',
		template: '{{Name}}',
		values: { 'note.Name': 'Project plan' },
		fields: FIELDS,
		...overrides,
	};
}

describe('sanitizeFileName', () => {
	it('replaces what a filesystem would reject and collapses the result', () => {
		expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j');
		expect(sanitizeFileName('  spaced   out  ')).toBe('spaced out');
		expect(sanitizeFileName('trailing dots...')).toBe('trailing dots');
		expect(sanitizeFileName('...')).toBe('');
	});
});

describe('expandTemplate', () => {
	it('substitutes a column by name, leaves an unknown key alone, and knows {{n}}', () => {
		expect(expandTemplate('{{Name}} — {{Status}}', { Name: 'Plan', Status: 'Todo' }, 3)).toBe(
			'Plan — Todo',
		);
		expect(expandTemplate('{{Name}} {{Nope}}', { Name: 'Plan' }, 1)).toBe('Plan {{Nope}}');
		expect(expandTemplate('Row {{n}}', {}, 7)).toBe('Row 7');
		expect(expandTemplate('plain', {}, 1)).toBe('plain');
	});
});

describe('creating a note', () => {
	it('appends " 2" when the name is taken, and reports the rename', async () => {
		const { vault, port } = harness();
		vault.seedNote('Projects Rows/Project plan.md', { Name: 'Project plan' });

		const first = await createNote(options(port));
		expect(first.result.ok).toBe(true);
		expect(first.attemptedPath).toBe('Projects Rows/Project plan.md');
		expect(first.collisions).toBe(1);
		expect(first.result.ok && first.result.file.path).toBe('Projects Rows/Project plan 2.md');
		expect(first.result.ok && first.result.file.renamed).toBe(true);
		expect(first.result.ok && first.result.via).toBe('direct');
		expect(vault.paths()).toContain('Projects Rows/Project plan 2.md');

		// And the next one is " 3", not a second " 2".
		const second = await createNote(options(port));
		expect(second.result.ok && second.result.file.path).toBe('Projects Rows/Project plan 3.md');
		expect(second.collisions).toBe(2);
	});

	it('writes the note with no collision suffix when the name is free', async () => {
		const { vault, port } = harness();
		const outcome = await createNote(options(port));
		expect(outcome.collisions).toBe(0);
		expect(outcome.result.ok && outcome.result.file.path).toBe('Projects Rows/Project plan.md');
		expect(outcome.result.ok && outcome.result.file.renamed).toBe(false);
		expect(vault.frontmatterOf('Projects Rows/Project plan.md')).toEqual({
			Name: 'Project plan',
		});
	});

	it('falls back to "Row n" for an empty template, and to the leading column otherwise', async () => {
		// An empty (or blank) template is `docs/03`'s documented fallback: nothing to expand.
		const empty = await createNote(options(harness().port, { template: '' }));
		expect(empty.result.ok && empty.result.file.path).toBe('Projects Rows/Row 1.md');
		const blank = await createNote(options(harness().port, { template: '   ' }));
		expect(blank.result.ok && blank.result.file.path).toBe('Projects Rows/Row 1.md');

		// A template whose only key has no value in this row gets one second chance: the leading column.
		const unfilled = await createNote(
			options(harness().port, { template: '{{Status}}', values: { 'note.Name': 'Plan' } }),
		);
		expect(unfilled.result.ok && unfilled.result.file.path).toBe('Projects Rows/Plan.md');

		// Nothing to fall back to at all → the ordinal.
		const bare = await createNote(
			options(harness().port, { template: '{{Status}}', values: {} }),
		);
		expect(bare.result.ok && bare.result.file.path).toBe('Projects Rows/Row 1.md');

		// `docs/03`'s fallback string is itself a template the user may set, so it expands like any other.
		const numbered = await createNote(
			options(harness().port, { template: 'Row {{n}}', ordinal: 12 }),
		);
		expect(numbered.result.ok && numbered.result.file.path).toBe('Projects Rows/Row 12.md');
		const bareOrdinal = await createNote(
			options(harness().port, { template: '{{n}}', ordinal: 12 }),
		);
		expect(bareOrdinal.result.ok && bareOrdinal.result.file.path).toBe('Projects Rows/12.md');

		// And the fallback name is an ordinary name: it takes the collision suffix like any other.
		const { port } = harness();
		await createNote(options(port, { template: '' }));
		const second = await createNote(options(port, { template: '' }));
		expect(second.result.ok && second.result.file.path).toBe('Projects Rows/Row 1 2.md');
		expect(second.collisions).toBe(1);
	});

	it('sanitises a template that expands to something a filesystem would reject', async () => {
		const { port } = harness();
		const outcome = await createNote(
			options(port, { template: '{{Name}}: notes', values: { 'note.Name': 'a/b' } }),
		);
		expect(outcome.result.ok && outcome.result.file.path).toBe('Projects Rows/a b notes.md');
	});

	it('fails clearly when the row folder does not exist, and creates nothing', async () => {
		const { vault, port } = harness(['Elsewhere']);
		const outcome = await createNote(options(port));
		expect(outcome.result.ok).toBe(false);
		expect(!outcome.result.ok && outcome.result.error.message).toContain('Projects Rows');
		expect(!outcome.result.ok && outcome.result.error.message).toContain('does not exist');
		expect(vault.paths()).toEqual([]);
	});

	it('uses the view menu path when one is given, and reports it', async () => {
		const { vault, port } = harness();
		const seen: Record<string, unknown>[] = [];
		const menu = {
			createFileForView: async (
				baseFileName: string | undefined,
				processor: (frontmatter: Record<string, unknown>) => void,
			) => {
				const frontmatter: Record<string, unknown> = {};
				processor(frontmatter);
				seen.push({ baseFileName, ...frontmatter });
			},
		};
		const outcome = await createNote(
			options(port, { menu, values: { 'note.Name': 'Plan', 'note.Status': 'Todo' } }),
		);
		expect(outcome.result.ok && outcome.result.via).toBe('menu');
		expect(seen).toEqual([{ baseFileName: undefined, Name: 'Plan', Status: 'Todo' }]);
		// The menu path lets Obsidian place the note, so this service created no file itself.
		expect(vault.paths()).toEqual([]);
	});

	it('uses the manual path when the caller forces it, even with a menu available', async () => {
		const { vault, port } = harness();
		let menuCalls = 0;
		const menu = {
			createFileForView: async () => {
				menuCalls += 1;
			},
		};
		const outcome = await createNote(options(port, { menu, forceDirect: true }));
		expect(outcome.result.ok && outcome.result.via).toBe('direct');
		expect(menuCalls).toBe(0);
		expect(vault.paths()).toEqual(['Projects Rows/Project plan.md']);
	});

	it('reports a failing menu path as a result instead of throwing', async () => {
		const { port } = harness();
		const menu = {
			createFileForView: async () => {
				throw new Error('the new note menu was dismissed');
			},
		};
		const outcome = await createNote(options(port, { menu }));
		expect(outcome.result.ok).toBe(false);
		expect(!outcome.result.ok && outcome.result.error.message).toContain('dismissed');
	});

	it('reports a failing vault write as a result instead of throwing', async () => {
		const { port } = harness();
		const failing: NoteVault = {
			...port,
			create: async () => {
				throw new Error('EACCES');
			},
		};
		const outcome = await createNote(options(failing));
		expect(outcome.result.ok).toBe(false);
		expect(!outcome.result.ok && outcome.result.error.message).toBe('EACCES');
	});
});

describe('the frontmatter a new note gets', () => {
	it('writes the node values that differ from the column default, and skips read-only columns', () => {
		const values: Record<string, CellValue> = {
			'note.Name': 'Plan',
			'note.Status': 'Todo',
			'note.Done': false,
			'file.mtime': 123,
		};
		const frontmatter = frontmatterFor({
			vault: harness().port,
			folder: 'Projects Rows',
			template: '{{Name}}',
			values,
			fields: FIELDS,
		});
		// The boolean column's default is `null`, not `false`, so an explicit `false` **is** a value the row
		// carries and it is written; `mtime` is not writable and is skipped whatever the caller passes.
		expect(frontmatter).toEqual({ Name: 'Plan', Status: 'Todo', Done: false });
	});

	it('produces no frontmatter block at all when every value is empty or default', () => {
		const frontmatter = frontmatterFor({
			vault: harness().port,
			folder: 'Projects Rows',
			template: 'Row {{n}}',
			values: {},
			fields: FIELDS,
		});
		expect(frontmatter).toEqual({});
		expect(frontmatterBody(frontmatter)).toBe('');
	});

	it('quotes only the scalars that would change meaning as plain YAML', () => {
		const body = frontmatterBody({
			Plain: 'value',
			Number: 3,
			Flag: true,
			Empty: '',
			Spaced: ' padded ',
			Colon: 'a: b',
			Leading: '- like a list',
			Hash: '#comment',
			List: ['a', 'b'],
		});
		expect(body).toBe(
			[
				'---',
				'Plain: value',
				'Number: 3',
				'Flag: true',
				'Empty: ""',
				'Spaced: " padded "',
				'Colon: "a: b"',
				'Leading: "- like a list"',
				'Hash: "#comment"',
				'List: [a, b]',
				'---',
				'',
			].join('\n'),
		);
	});
});
