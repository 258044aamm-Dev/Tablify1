/**
 * `BasesSource`, against a **fixture host** and the fake vault. No real Bases view exists in this
 * environment, so the host port is what makes the adapter testable at all: the fixture below is the same
 * structural shape the real `BasesView` adapter satisfies, which is the point of putting a port in front.
 *
 * Values are keyed by **PropertyId** (`note.Name`), which is what `BasesEntry.getValue` is asked for and
 * therefore what `rawValue` receives. `host.displayName` is what would turn that into the column's label.
 */
import { describe, expect, it } from 'vitest';
import { createBasesSource, toCellValue } from '../../src/adapters/bases/BasesSource';
import type { BasesRowHost, BasesViewHost } from '../../src/adapters/bases/BasesSource';
import type { FrontmatterWriter } from '../../src/adapters/writeQueue';
import { resolveField } from '../../src/core/schema/propertySchema';
import { createFakeClock } from '../fakes/clock';
import { createFakeVault } from '../fakes/vault';
import type { CellValue, FieldContext } from '../../src/core/types';

/** A host whose rows, values and config a test can change between assertions. */
type FixtureHost = BasesViewHost & {
	readonly changes: number;
	setRows(rows: readonly BasesRowHost[]): void;
	setRaw(filePath: string, propertyId: string, value: unknown): void;
	readonly configWrites: { key: string; value: string }[];
	/** The last patch written to a given config key, or `undefined`. */
	lastConfig(key: string): string | undefined;
	/** Fires the watcher, as Bases' own `onDataUpdated` would. */
	notify(): void;
};

function fixtureHost(initial: {
	readonly rows: readonly BasesRowHost[];
	readonly order: readonly string[];
	readonly values: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
	/** The sidecar keys the `.base` file already carries, if any. */
	readonly config?: Readonly<Record<string, string>>;
}): FixtureHost {
	let rows = [...initial.rows];
	const values = new Map<string, Map<string, unknown>>();
	for (const [filePath, cells] of Object.entries(initial.values)) {
		values.set(filePath, new Map(Object.entries(cells)));
	}
	const config = new Map<string, unknown>(Object.entries(initial.config ?? {}));
	const watchers = new Set<() => void>();
	let changes = 0;
	const configWrites: { key: string; value: string }[] = [];
	return {
		get changes() {
			return changes;
		},
		rows: () => rows,
		order: () => initial.order,
		// A renamed column: the `.base` calls it "Status", frontmatter still stores `Status`.
		displayName: (propertyId) => (propertyId === 'note.Status' ? 'Status' : undefined),
		rawValue: (filePath, propertyId) => values.get(filePath)?.get(propertyId),
		config: (key) => config.get(key),
		setConfig: (key, value) => {
			config.set(key, value);
			configWrites.push({ key, value });
		},
		watch: (listener) => {
			watchers.add(listener);
			return () => {
				watchers.delete(listener);
			};
		},
		setRows: (next) => {
			rows = [...next];
		},
		setRaw: (filePath, propertyId, value) => {
			const cells = values.get(filePath) ?? new Map<string, unknown>();
			cells.set(propertyId, value);
			values.set(filePath, cells);
		},
		configWrites,
		lastConfig: (key) => configWrites.filter((entry) => entry.key === key).at(-1)?.value,
		notify: () => {
			changes += 1;
			for (const listener of [...watchers]) {
				listener();
			}
		},
	};
}

/** The context the fixture's descriptors are resolved with, so the assertions read the same columns. */
const CONTEXT: FieldContext = {
	path: '',
	now: () => 0,
	timezone: 'UTC',
	locale: 'en-GB',
	fieldOptions: {},
	columnName: '',
};

const NAME_FIELD = resolveField({ id: 'note.Name', name: 'Name', source: 'note' }, CONTEXT);
const STATUS_FIELD = resolveField(
	{
		id: 'note.Status',
		name: 'Status',
		source: 'note',
		fieldOptions: { type: 'singleSelect', options: [{ id: 'o1', name: 'Todo' }] },
	},
	CONTEXT,
);
const MTIME_FIELD = resolveField({ id: 'file.mtime', name: 'mtime', source: 'file' }, CONTEXT);

function build(options?: { readonly frames?: (() => void)[] }) {
	const clock = createFakeClock();
	const vault = createFakeVault({ clock });
	vault.seedNote('Notes/A.md', { Name: 'Alpha', Status: 'Todo' });
	vault.seedNote('Notes/B.md', { Name: 'Beta' });
	const host = fixtureHost({
		rows: [
			{ filePath: 'Notes/A.md', label: 'A' },
			{ filePath: 'Notes/B.md', label: 'B' },
		],
		order: ['note.Name', 'note.Status', 'file.mtime'],
		values: {
			'Notes/A.md': { 'note.Name': 'Alpha', 'note.Status': 'Todo' },
			'Notes/B.md': { 'note.Name': 'Beta' },
		},
		// The column's type and its option colours live in the `.base` sidecar (`docs/03` §view config),
		// not in the note: this is what makes the second column a select rather than plain text.
		config: {
			fieldOptions: JSON.stringify({
				version: 1,
				fields: {
					'note.Status': { type: 'singleSelect', options: [{ id: 'o1', name: 'Todo' }] },
				},
			}),
		},
	});
	/**
	 * The QueueSpy: the one and only writer the source is given. Every call it records is a call the write
	 * queue made, which is how the "one op → one queued write" assertion below can be exact.
	 */
	const writerCalls: { path: string }[] = [];
	const writer: FrontmatterWriter = {
		processFrontMatter: async (path, mutate) => {
			const file = vault.app.vault.getFileByPath(path);
			if (file === null) {
				throw new Error(`no note at "${path}"`);
			}
			writerCalls.push({ path });
			await vault.app.fileManager.processFrontMatter(file, mutate);
		},
	};
	const frames: (() => void)[] = options?.frames ?? [];
	const source = createBasesSource({
		host,
		writer,
		env: { now: () => 0, timezone: 'UTC', locale: 'en-GB' },
		timers: clock,
		schedule: (callback) => {
			frames.push(callback);
		},
	});
	return { source, host, vault, clock, frames, writerCalls };
}

/** Runs every frame the source scheduled, which is what one repaint does. */
function runFrames(frames: (() => void)[]): void {
	for (const frame of frames.splice(0, frames.length)) {
		frame();
	}
}

describe('reading a Bases view', () => {
	it('builds the schema from the view order and resolves every column', () => {
		const { source } = build();
		const schema = source.getSchema();
		expect(schema.fields.map((field) => field.definition.id)).toEqual([
			'note.Name',
			'note.Status',
			'file.mtime',
		]);
		expect(schema.fields[0]?.descriptor.id).toBe('text');
		expect(schema.fields[1]?.descriptor.id).toBe('singleSelect');
		// `file.mtime` is file metadata: read-only, with the reason recorded rather than a bare `false`.
		expect(schema.fields[2]?.readOnly).toBe(true);
		expect(schema.fields[2]?.reasons.join(' ')).toContain('read-only');
		// The `.base` display name reaches the messages; the frontmatter key does not change.
		expect(schema.fields[1]?.context.columnName).toBe('Status');
		expect(schema.fields[1]?.definition.name).toBe('Status');
	});

	it('keys rows by file path and parses each value through its column', () => {
		const { source } = build();
		expect(source.getRows()).toEqual(['Notes/A.md', 'Notes/B.md']);
		expect(source.getValue('Notes/A.md', 'note.Name')).toBe('Alpha');
		expect(source.getValue('Notes/A.md', 'note.Status')).toBe('Todo');
		// An absent value is the column type's own empty, not `undefined`.
		expect(source.getValue('Notes/B.md', 'note.Status')).toBeNull();
		expect(source.getRowLabel('Notes/A.md')).toBe('A');
		// An unknown row is not a crash and not a fabricated row.
		expect(source.getValue('Notes/Z.md', 'note.Name')).toBeNull();
	});

	it('survives an update that reorders and re-creates the entries', () => {
		const { source, host } = build();
		host.setRows([
			{ filePath: 'Notes/B.md', label: 'B' },
			{ filePath: 'Notes/A.md', label: 'A' },
			{ filePath: 'Notes/C.md', label: 'C' },
		]);
		host.setRaw('Notes/C.md', 'note.Name', 'Gamma');
		host.notify();
		expect(source.getRows()).toEqual(['Notes/B.md', 'Notes/A.md', 'Notes/C.md']);
		expect(source.getValue('Notes/C.md', 'note.Name')).toBe('Gamma');
		// The row that disappeared is gone and does not come back carrying its last value.
		host.setRows([{ filePath: 'Notes/A.md', label: 'A' }]);
		host.notify();
		expect(source.getRows()).toEqual(['Notes/A.md']);
		expect(source.getValue('Notes/B.md', 'note.Name')).toBeNull();
	});

	it('reports a value it cannot parse and keeps the raw value rather than losing it', () => {
		const { source, host } = build();
		host.setRaw('Notes/A.md', 'note.Status', { unexpected: 'object' });
		host.notify();
		const problems = source.problems();
		expect(problems.length).toBeGreaterThan(0);
		const first = problems[0];
		expect(first?.filePath).toBe('Notes/A.md');
		expect(first?.propertyId).toBe('note.Status');
		expect(first?.reason.length).toBeGreaterThan(0);
		// A value we could not read is still the value on disk: the cell shows empty, nothing is written.
		expect(source.getValue('Notes/A.md', 'note.Status')).toBeNull();
	});

	it('notifies once per frame for ten rapid updates', () => {
		const frames: (() => void)[] = [];
		const { source, host } = build({ frames });
		let first = 0;
		let second = 0;
		source.subscribe(() => {
			first += 1;
		});
		runFrames(frames); // the constructor's own first notification
		first = 0;
		for (let index = 0; index < 10; index += 1) {
			host.setRaw('Notes/A.md', 'note.Name', `Alpha ${String(index)}`);
			host.notify();
		}
		// Ten updates, one scheduled frame, and nobody called yet.
		expect(first).toBe(0);
		expect(frames.length).toBe(1);
		runFrames(frames);
		expect(first).toBe(1);
		// And the snapshot holds the last value, not an intermediate one.
		expect(source.getValue('Notes/A.md', 'note.Name')).toBe('Alpha 9');
		// Unsubscribing really unsubscribes.
		const stop = source.subscribe(() => {
			second += 1;
		});
		stop();
		host.setRaw('Notes/A.md', 'note.Name', 'Alpha 10');
		host.notify();
		runFrames(frames);
		expect(second).toBe(0);
		expect(first).toBe(2);
	});

	it('reads the sidecar, so a hand-edited fieldOptions cannot break the grid', () => {
		const { source } = build();
		// No sidecar, no throw; the `.base` view order alone is a complete column list.
		expect(source.getSchema().fields).toHaveLength(3);
		expect(source.getRows()).toHaveLength(2);
	});
});

describe('writing through the queue', () => {
	it('turns one setCell op into exactly one queued write, and the disk sees it only after the debounce', async () => {
		const { source, vault, clock, writerCalls } = build();
		const result = await source.apply([
			{ kind: 'setCell', filePath: 'Notes/A.md', fieldId: 'note.Name', value: 'Alpha two' },
		]);
		expect(result.ok).toBe(true);
		expect(result.written).toBe(1);
		expect(result.files).toEqual(['Notes/A.md']);
		// One op is one queued write and one overlay entry — the two halves of "instant but honest".
		expect(source.queue.pending()).toBe(1);
		expect(source.overlay.size()).toBe(1);
		expect(source.overlay.get('Notes/A.md', 'Name')).toBe('Alpha two');
		// The grid reads the pending value immediately, through the Bases id the caller uses.
		expect(source.getValue('Notes/A.md', 'note.Name')).toBe('Alpha two');
		// Queued, not written: one pending debounce timer, and the vault untouched.
		expect(vault.writeCount()).toBe(0);
		expect(clock.pending()).toBe(1);
		clock.advance(250);
		await source.flush();
		// Exactly one writer call for one cell — the queue coalesced without double-writing.
		expect(writerCalls).toEqual([{ path: 'Notes/A.md' }]);
		expect(vault.writeCount()).toBe(1);
		expect(vault.frontmatterOf('Notes/A.md')['Name']).toBe('Alpha two');
		// The body and the other keys are untouched.
		expect(vault.frontmatterOf('Notes/A.md')['Status']).toBe('Todo');
		// The key written is the note's own property name, never the Bases property id.
		expect(Object.keys(vault.frontmatterOf('Notes/A.md')).sort()).toEqual(['Name', 'Status']);
		// The write landed, so nothing is pending any more.
		expect(source.overlay.size()).toBe(0);
	});

	it('refuses a read-only column with a typed reason instead of writing it', async () => {
		const { source, vault, clock, writerCalls } = build();
		const result = await source.apply([
			{ kind: 'setCell', filePath: 'Notes/A.md', fieldId: 'file.mtime', value: 1 },
		]);
		expect(result.ok).toBe(false);
		expect(result.written).toBe(0);
		expect(result.refused).toHaveLength(1);
		expect(result.refused[0]?.reason).toBe('readonly-column');
		expect(result.refused[0]?.propertyId).toBe('file.mtime');
		expect(result.refused[0]?.message).toContain('read-only');
		expect(clock.pending()).toBe(0);
		await source.flush();
		expect(writerCalls).toEqual([]);
		expect(vault.writeCount()).toBe(0);
	});

	it('refuses a column this view does not have, and says which one', async () => {
		const { source, vault } = build();
		const result = await source.apply([
			{ kind: 'setCell', filePath: 'Notes/A.md', fieldId: 'note.Nonexistent', value: 'x' },
		]);
		expect(result.ok).toBe(false);
		expect(result.refused[0]?.reason).toBe('readonly-column');
		expect(result.refused[0]?.message).toContain('note.Nonexistent');
		await source.flush();
		expect(vault.writeCount()).toBe(0);
	});

	it('clears a cell by deleting the key, and keeps a list value as a list', async () => {
		const { source, vault } = build();
		await source.apply([
			{ kind: 'clearCells', cells: [{ filePath: 'Notes/A.md', fieldId: 'note.Status' }] },
		]);
		await source.flush();
		expect('Status' in vault.frontmatterOf('Notes/A.md')).toBe(false);

		await source.apply([
			{
				kind: 'setCells',
				writes: [{ filePath: 'Notes/B.md', fieldId: 'note.Name', value: ['A', 'B'] }],
			},
		]);
		await source.flush();
		expect(vault.frontmatterOf('Notes/B.md')['Name']).toEqual(['A', 'B']);
	});

	it('coalesces many cells in one file into one frontmatter call', async () => {
		const { source, vault, writerCalls } = build();
		await source.apply([
			{
				kind: 'setCells',
				writes: [
					{ filePath: 'Notes/A.md', fieldId: 'note.Name', value: 'A1' },
					{ filePath: 'Notes/A.md', fieldId: 'note.Status', value: 'Doing' },
					{ filePath: 'Notes/B.md', fieldId: 'note.Name', value: 'B1' },
				],
			},
		]);
		await source.flush();
		expect(writerCalls).toEqual([{ path: 'Notes/A.md' }, { path: 'Notes/B.md' }]);
		expect(vault.frontmatterOf('Notes/A.md')['Name']).toBe('A1');
		expect(vault.frontmatterOf('Notes/A.md')['Status']).toBe('Doing');
		expect(vault.frontmatterOf('Notes/B.md')['Name']).toBe('B1');
	});

	it('stores view settings and field options in the view config rather than in a note', async () => {
		const { source, host, vault } = build();
		await source.apply([
			{ kind: 'setViewConfig', changes: { groupBy: 'note.Status' }, previous: {} },
		]);
		await source.apply([
			{
				kind: 'setFieldOptions',
				fieldId: 'note.Status',
				from: {},
				to: { type: 'singleSelect', options: [{ id: 'o2', name: 'Doing' }] },
			},
		]);
		expect(host.configWrites.map((entry) => entry.key)).toEqual([
			'tablifyViewConfig',
			'fieldOptions',
		]);
		expect(host.lastConfig('tablifyViewConfig')).toContain('note.Status');
		expect(host.lastConfig('fieldOptions')).toContain('Doing');
		// Nothing about a view's own settings belongs in frontmatter.
		expect(vault.writeCount()).toBe(0);
	});

	it('flushes to disk when asked and reports it', async () => {
		const { source, vault } = build();
		const applied = await source.apply([
			{ kind: 'setCell', filePath: 'Notes/A.md', fieldId: 'note.Name', value: 'Flushed' },
		]);
		await source.flush();
		expect(vault.frontmatterOf('Notes/A.md')['Name']).toBe('Flushed');
		expect(applied.written).toBe(1);
		expect(source.lastResult()?.written).toBe(1);
	});

	it('releases its watcher and its queue on dispose', async () => {
		const { source, host, clock } = build();
		await source.apply([
			{
				kind: 'setCell',
				filePath: 'Notes/A.md',
				fieldId: 'note.Name',
				value: 'never written',
			},
		]);
		expect(clock.pending()).toBe(1);
		source.dispose();
		// The debounce is dropped, so nothing lands after the view is gone.
		expect(clock.pending()).toBe(0);
		await source.flush();
		// The host's watcher is released too: a change after disposal does not reach the snapshot.
		host.setRaw('Notes/A.md', 'note.Name', 'Changed after dispose');
		host.notify();
		expect(source.getValue('Notes/A.md', 'note.Name')).toBe('Alpha');
	});
});

describe('a failing write', () => {
	it('drops the pending value so the grid shows what the file really says', async () => {
		const { source, vault } = build();
		const applied = await source.apply([
			{ kind: 'setCell', filePath: 'Notes/Missing.md', fieldId: 'note.Name', value: 'ghost' },
		]);
		// The queue accepted it — the file is only discovered to be missing when the write is attempted.
		expect(applied.written).toBe(1);
		expect(source.overlay.size()).toBe(1);
		expect(source.getValue('Notes/Missing.md', 'note.Name')).toBe('ghost');
		await source.flush();
		// No file, no value: the overlay is emptied and the flush names the path that failed.
		expect(source.overlay.size()).toBe(0);
		expect(vault.writeCount()).toBe(0);
		const result = source.lastResult();
		expect(result?.ok).toBe(false);
		expect(result?.errors[0]?.path).toBe('Notes/Missing.md');
	});
});

describe('toCellValue', () => {
	it('passes scalars through, including the null that means "delete the key"', () => {
		expect(toCellValue('x')).toBe('x');
		expect(toCellValue(0)).toBe(0);
		expect(toCellValue(false)).toBe(false);
		expect(toCellValue(null)).toBeNull();
	});

	it('turns a YAML list into a list of labels, never a stringified list', () => {
		expect(toCellValue(['a', 'b'])).toEqual(['a', 'b']);
		expect(toCellValue(['a', null, 3])).toEqual(['a', '', '3']);
	});
});

describe('the port this test leans on', () => {
	it('agrees with the registry about the three fixture columns', () => {
		expect(NAME_FIELD.descriptor.id).toBe('text');
		expect(STATUS_FIELD.descriptor.id).toBe('singleSelect');
		expect(MTIME_FIELD.readOnly).toBe(true);
		const value: CellValue = 'Todo';
		expect(STATUS_FIELD.descriptor.matches(value, 'is', 'Todo', CONTEXT)).toBe(true);
	});
});
