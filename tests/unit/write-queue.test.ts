/**
 * The write queue, against the fake vault and the fake clock. No Obsidian, no real timers, no real disk.
 *
 * Every assertion here is one of the rules in `docs/02-architecture.md` §write queue, and each test says
 * which sentence it is checking. The fake vault is the instrument that makes it possible: it records one
 * `WriteRecord` per `processFrontMatter` call with before/after frontmatter, and it *throws* if anything
 * calls `vault.modify` — so "never modify a note to change one property" is proved rather than promised.
 */
import { describe, expect, it } from 'vitest';
import { createOverlay } from '../../src/adapters/optimistic';
import { applyResult, describeApplyResult, EMPTY_APPLY_RESULT } from '../../src/adapters/RowSource';
import { createWriteQueue, DEBOUNCE_MS } from '../../src/adapters/writeQueue';
import type { FrontmatterWriter, QueueWrite, WriteQueue } from '../../src/adapters/writeQueue';
import { createFakeClock } from '../fakes/clock';
import type { Clock } from '../fakes/clock';
import { createFakeVault } from '../fakes/vault';
import type { FakeVault } from '../fakes/vault';

/** The adapter that turns the queue's path-based writer into the vault's file-based one. */
function writerFor(vault: FakeVault): FrontmatterWriter {
	return {
		processFrontMatter: async (path, mutate) => {
			const file = vault.app.vault.getFileByPath(path);
			if (file === null) {
				throw new Error(`no note at "${path}"`);
			}
			await vault.app.fileManager.processFrontMatter(file, mutate);
		},
	};
}

type Harness = {
	readonly vault: FakeVault;
	readonly clock: Clock;
	readonly queue: WriteQueue;
};

function harness(
	options: { fail?: readonly string[]; debounceMs?: number; concurrency?: number } = {},
): Harness {
	const clock = createFakeClock();
	const vault = createFakeVault({ clock });
	const writer = writerFor(vault);
	const failing = new Set(options.fail ?? []);
	const queue = createWriteQueue({
		writer: {
			processFrontMatter: async (path, mutate) => {
				if (failing.has(path)) {
					throw new Error('the vault refused this write');
				}
				await writer.processFrontMatter(path, mutate);
			},
		},
		timers: clock,
		...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
		...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
	});
	return { vault, clock, queue };
}

/** Lets every microtask the queue chained settle. The clock is fake; promises are still promises. */
async function settleMicrotasks(): Promise<void> {
	for (let index = 0; index < 12; index += 1) {
		await Promise.resolve();
	}
}

const write = (
	filePath: string,
	propertyId: string,
	value: string | number | boolean | null,
): QueueWrite => ({
	filePath,
	propertyId,
	value,
});

describe('coalescing and batching', () => {
	it('turns twelve writes to one file in a tick into exactly one processFrontMatter call', async () => {
		const { vault, clock, queue } = harness();
		vault.seedNote('Notes/A.md', { Name: 'Alpha' });
		for (let index = 0; index < 12; index += 1) {
			queue.enqueue([write('Notes/A.md', `P${String(index)}`, `v${String(index)}`)]);
		}
		expect(queue.pending()).toBe(12);
		clock.advance(DEBOUNCE_MS);
		await settleMicrotasks();
		expect(vault.writes).toHaveLength(1);
		expect(queue.pending()).toBe(0);
	});

	it('keeps the last value for the same property written twice in a tick', async () => {
		const { vault, clock, queue } = harness();
		vault.seedNote('Notes/A.md', { Status: 'Todo' });
		queue.enqueue([write('Notes/A.md', 'Status', 'Doing')]);
		queue.enqueue([write('Notes/A.md', 'Status', 'Done')]);
		clock.advance(DEBOUNCE_MS);
		await settleMicrotasks();
		expect(vault.writes).toHaveLength(1);
		expect(vault.frontmatterOf('Notes/A.md')['Status']).toBe('Done');
	});

	it('gives each file its own call, and waits the debounce before the first one', async () => {
		const { vault, clock, queue } = harness();
		vault.seedNote('Notes/A.md', {});
		vault.seedNote('Notes/B.md', {});
		queue.enqueue([write('Notes/A.md', 'Name', 'A'), write('Notes/B.md', 'Name', 'B')]);
		clock.advance(DEBOUNCE_MS - 1);
		await settleMicrotasks();
		expect(vault.writes).toHaveLength(0);
		clock.advance(1);
		await settleMicrotasks();
		expect(vault.writes.map((record) => record.path).sort()).toEqual([
			'Notes/A.md',
			'Notes/B.md',
		]);
	});

	it('serialises a file: two batches to one note never overlap, and both land in order', async () => {
		const { vault, clock, queue } = harness();
		vault.seedNote('Notes/A.md', {});
		queue.enqueue([write('Notes/A.md', 'Name', 'first')]);
		clock.advance(DEBOUNCE_MS);
		await settleMicrotasks();
		queue.enqueue([write('Notes/A.md', 'Name', 'second')]);
		clock.advance(DEBOUNCE_MS);
		await settleMicrotasks();
		expect(vault.writes).toHaveLength(2);
		expect(vault.writes[0]?.after['Name']).toBe('first');
		expect(vault.writes[1]?.after['Name']).toBe('second');
	});

	it('interleaves two writers to one file without losing either intention', async () => {
		const { vault, clock, queue } = harness();
		vault.seedNote('Notes/A.md', {});
		// Writer one and writer two, alternating, all inside one debounce window.
		queue.enqueue([write('Notes/A.md', 'FromOne', '1')]);
		queue.enqueue([write('Notes/A.md', 'FromTwo', 'a')]);
		queue.enqueue([write('Notes/A.md', 'FromOne', '2')]);
		queue.enqueue([write('Notes/A.md', 'FromTwo', 'b')]);
		clock.advance(DEBOUNCE_MS);
		await settleMicrotasks();
		expect(vault.writes).toHaveLength(1);
		expect(vault.frontmatterOf('Notes/A.md')).toEqual({ FromOne: '2', FromTwo: 'b' });
	});
});

describe('what a write leaves alone', () => {
	it('preserves unknown keys and the body byte for byte, changing only the property it owns', async () => {
		const { vault, clock, queue } = harness();
		vault.seedNote(
			'Notes/A.md',
			{ Name: 'Alpha', custom: { nested: true }, tags: ['x'] },
			'Body text\n',
		);
		const before = vault.raw('Notes/A.md');
		queue.enqueue([write('Notes/A.md', 'Name', 'Beta')]);
		clock.advance(DEBOUNCE_MS);
		await settleMicrotasks();
		const after = vault.raw('Notes/A.md');
		expect(after).not.toBe(before);
		expect(after.split('\n').filter((line) => !line.startsWith('Name:'))).toEqual(
			before.split('\n').filter((line) => !line.startsWith('Name:')),
		);
		expect(vault.frontmatterOf('Notes/A.md')['custom']).toEqual({ nested: true });
		expect(vault.frontmatterOf('Notes/A.md')['tags']).toEqual(['x']);
	});

	it('clears a value by deleting the key, never by writing "" or null', async () => {
		const { vault, clock, queue } = harness();
		vault.seedNote('Notes/A.md', { Name: 'Alpha', Keep: 'yes' });
		queue.enqueue([write('Notes/A.md', 'Name', null)]);
		clock.advance(DEBOUNCE_MS);
		await settleMicrotasks();
		const frontmatter = vault.frontmatterOf('Notes/A.md');
		expect('Name' in frontmatter).toBe(false);
		expect(frontmatter['Keep']).toBe('yes');
		expect(vault.raw('Notes/A.md')).not.toContain('Name:');
	});

	it('never calls vault.modify — the fake throws if it happens, and only processFrontMatter appears', async () => {
		const { vault, clock, queue } = harness();
		vault.seedNote('Notes/A.md', {});
		queue.enqueue([write('Notes/A.md', 'Name', 'Alpha')]);
		clock.advance(DEBOUNCE_MS);
		await settleMicrotasks();
		expect(vault.writes).toHaveLength(1);
		expect(Object.keys(vault.writes[0] ?? {})).toEqual(['path', 'before', 'after', 'at']);
	});
});

describe('failure', () => {
	it('reports the file that failed and still lands the others', async () => {
		const { vault, clock, queue } = harness({ fail: ['Notes/Bad.md'] });
		vault.seedNote('Notes/Bad.md', {});
		vault.seedNote('Notes/Good.md', {});
		queue.enqueue([write('Notes/Bad.md', 'Name', 'x'), write('Notes/Good.md', 'Name', 'y')]);
		clock.advance(DEBOUNCE_MS);
		await settleMicrotasks();
		const result = await queue.flush();
		expect(result.ok).toBe(false);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.path).toBe('Notes/Bad.md');
		expect(result.errors[0]?.message).toContain('refused');
		expect(vault.frontmatterOf('Notes/Good.md')['Name']).toBe('y');
		expect(vault.writeCount('Notes/Bad.md')).toBe(0);
	});

	it('tells the caller which writes failed, so the overlay can drop exactly those', async () => {
		const clock = createFakeClock();
		const vault = createFakeVault({ clock });
		const overlay = createOverlay();
		const dropped: QueueWrite[][] = [];
		const queue = createWriteQueue({
			writer: writerFor(vault),
			timers: clock,
			hooks: {
				onWritten: (writes) => {
					overlay.settle(writes);
				},
				onFailed: (writes) => {
					dropped.push([...writes]);
					overlay.drop(writes);
				},
			},
		});
		vault.seedNote('Notes/A.md', { Name: 'Alpha' });
		overlay.set([write('Notes/A.md', 'Name', 'Beta')]);
		expect(overlay.size()).toBe(1);
		queue.dispose();
		// A fresh queue over the same overlay, with a writer that refuses.
		const failing = createWriteQueue({
			writer: {
				processFrontMatter: () => Promise.reject(new Error('disk full')),
			},
			timers: clock,
			hooks: {
				onFailed: (writes) => {
					dropped.push([...writes]);
					overlay.drop(writes);
				},
			},
		});
		failing.enqueue([write('Notes/A.md', 'Name', 'Beta')]);
		clock.advance(DEBOUNCE_MS);
		await settleMicrotasks();
		expect(dropped).toHaveLength(1);
		expect(overlay.size()).toBe(0);
		expect(overlay.get('Notes/A.md', 'Name')).toBeUndefined();
	});
});

describe('flush', () => {
	it('bypasses the debounce and resolves only after the last write has landed', async () => {
		const { vault, clock, queue } = harness();
		vault.seedNote('Notes/A.md', {});
		queue.enqueue([write('Notes/A.md', 'Name', 'Alpha')]);
		expect(vault.writes).toHaveLength(0);
		const result = await queue.flush();
		expect(result.ok).toBe(true);
		expect(result.written).toBe(1);
		expect(result.files).toEqual(['Notes/A.md']);
		expect(vault.writes).toHaveLength(1);
		expect(queue.pending()).toBe(0);
		expect(clock.pending()).toBe(0);
	});

	it('is idempotent: a second flush writes nothing and reports nothing', async () => {
		const { vault, clock, queue } = harness();
		vault.seedNote('Notes/A.md', {});
		queue.enqueue([write('Notes/A.md', 'Name', 'Alpha')]);
		const first = await queue.flush();
		const second = await queue.flush();
		expect(first.written).toBe(1);
		expect(second.written).toBe(0);
		expect(second.errors).toEqual([]);
		expect(vault.writes).toHaveLength(1);
		clock.advance(500);
		await settleMicrotasks();
		expect(vault.writes).toHaveLength(1);
	});

	it('resolves immediately when there is nothing to write', async () => {
		const { queue } = harness();
		const result = await queue.flush();
		expect(result).toEqual({ ok: true, written: 0, files: [], errors: [] });
	});

	it('does not report the same failure twice', async () => {
		const { vault, clock, queue } = harness({ fail: ['Notes/Bad.md'] });
		vault.seedNote('Notes/Bad.md', {});
		queue.enqueue([write('Notes/Bad.md', 'Name', 'x')]);
		const first = await queue.flush();
		const second = await queue.flush();
		expect(first.errors).toHaveLength(1);
		expect(second.errors).toEqual([]);
		clock.advance(DEBOUNCE_MS);
		await settleMicrotasks();
	});

	it('holds the concurrency limit while writing many files at once', async () => {
		const clock = createFakeClock();
		const vault = createFakeVault({ clock });
		let inFlight = 0;
		let peak = 0;
		const queue = createWriteQueue({
			writer: {
				processFrontMatter: async (path, mutate) => {
					inFlight += 1;
					peak = Math.max(peak, inFlight);
					await Promise.resolve();
					await Promise.resolve();
					inFlight -= 1;
					const file = vault.app.vault.getFileByPath(path);
					if (file !== null) {
						await vault.app.fileManager.processFrontMatter(file, mutate);
					}
				},
			},
			timers: clock,
			concurrency: 2,
		});
		for (let index = 0; index < 6; index += 1) {
			vault.seedNote(`Notes/${String(index)}.md`, {});
			queue.enqueue([write(`Notes/${String(index)}.md`, 'Name', `n${String(index)}`)]);
		}
		const result = await queue.flush();
		expect(result.written).toBe(6);
		expect(peak).toBeLessThanOrEqual(2);
		expect(vault.writes).toHaveLength(6);
	});
});

describe('the overlay', () => {
	it('holds pending values only, and never masks a row it does not own', () => {
		const overlay = createOverlay();
		overlay.set([write('Notes/A.md', 'Status', 'Doing')]);
		expect(overlay.get('Notes/A.md', 'Status')).toBe('Doing');
		expect(overlay.get('Notes/A.md', 'Owner')).toBeUndefined();
		expect(overlay.hasRow('Notes/A.md')).toBe(true);
		expect(overlay.hasRow('Notes/B.md')).toBe(false);
		expect(overlay.size()).toBe(1);
		expect(overlay.entries()).toEqual([
			{ filePath: 'Notes/A.md', propertyId: 'Status', value: 'Doing' },
		]);
	});

	it('notifies once per change to the set, not once per cell', () => {
		const overlay = createOverlay();
		let calls = 0;
		const stop = overlay.subscribe(() => {
			calls += 1;
		});
		overlay.set([write('Notes/A.md', 'Name', 'a'), write('Notes/A.md', 'Status', 'b')]);
		expect(calls).toBe(1);
		overlay.settle([write('Notes/A.md', 'Name', 'a')]);
		expect(calls).toBe(2);
		overlay.clear();
		expect(calls).toBe(3);
		overlay.clear();
		expect(calls).toBe(3);
		stop();
		overlay.set([write('Notes/B.md', 'Name', 'c')]);
		expect(calls).toBe(3);
	});

	it('settles only the value it confirmed, so a newer keystroke stays pending', () => {
		const overlay = createOverlay();
		overlay.set([write('Notes/A.md', 'Name', 'Alpha')]);
		// The write for 'Alpha' lands, but the user has already typed 'Alpha two'.
		overlay.set([write('Notes/A.md', 'Name', 'Alpha two')]);
		overlay.settle([write('Notes/A.md', 'Name', 'Alpha')]);
		expect(overlay.get('Notes/A.md', 'Name')).toBe('Alpha two');
		overlay.settle([write('Notes/A.md', 'Name', 'Alpha two')]);
		expect(overlay.get('Notes/A.md', 'Name')).toBeUndefined();
	});
});

describe('the port’s result shape', () => {
	it('computes ok from its parts, and says what happened in one line', () => {
		expect(applyResult({ written: 3, files: ['a.md'], refused: [], errors: [] })).toEqual({
			ok: true,
			written: 3,
			files: ['a.md'],
			refused: [],
			errors: [],
		});
		const withRefusal = applyResult({
			written: 1,
			files: ['a.md'],
			refused: [
				{
					filePath: 'a.md',
					propertyId: 'file.mtime',
					reason: 'readonly-column',
					message: 'Last modified time is read-only',
				},
			],
			errors: [],
		});
		expect(withRefusal.ok).toBe(false);
		expect(describeApplyResult(withRefusal)).toBe('1 cell(s) in 1 file(s), 1 refused');
		expect(describeApplyResult(EMPTY_APPLY_RESULT)).toBe('0 cell(s) in 0 file(s)');
	});
});
