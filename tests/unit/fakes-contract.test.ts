/**
 * The fakes are test substrate, so they get the same treatment as product code: behaviours that the
 * adapters will depend on are asserted here rather than assumed, because a fake that lies is worse than
 * no fake at all.
 *
 * The four frontmatter behaviours asserted below are the ones that bite in production. Obsidian's
 * `processFrontMatter` hands the callback a mutable object and writes the whole block back, so a callback
 * that forgets a key deletes it, a callback that throws writes nothing, and every write re-serialises the
 * block — comments and hand-formatted YAML do not survive.
 */
import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../fakes/clock';
import {
	createFakeTransport,
	TransportNetworkError,
	TransportTimeoutError,
} from '../fakes/transport';
import { createFakeVault } from '../fakes/vault';

const NOTE = 'Projects/Widening.md';

function setup(): {
	clock: ReturnType<typeof createFakeClock>;
	vault: ReturnType<typeof createFakeVault>;
} {
	const clock = createFakeClock();
	return { clock, vault: createFakeVault({ clock }) };
}

/** The file a note path resolves to, or a failure — a test that seeds a note must be able to find it. */
function fileAt(vault: ReturnType<typeof createFakeVault>, path: string) {
	const file = vault.app.vault.getFileByPath(path);
	if (file === null) {
		throw new Error(`the fake vault has no note at "${path}"`);
	}
	return file;
}

describe('fake vault: the four frontmatter behaviours', () => {
	it('(a) replaces the block wholesale, so hand-formatted YAML does not survive a write', async () => {
		const { vault } = setup();
		// A hand-written block: a trailing comment and a block-style list. Real Obsidian parses this with a
		// YAML parser; the fake only understands flat `key: value` lines, which is itself the point of this
		// test — whatever the old text looked like, the block is regenerated from the object afterwards.
		vault.createNote(NOTE, '---\ntitle: x  # keep me\ntags:\n  - one\n---\nBody text.\n');
		await vault.app.fileManager.processFrontMatter(fileAt(vault, NOTE), (fm) => {
			fm.title = 'y';
		});
		expect(vault.raw(NOTE)).toBe('---\ntitle: "y"\n---\nBody text.\n');
		expect(vault.raw(NOTE)).not.toContain('# keep me');
		expect(Object.keys(vault.frontmatterOf(NOTE))).toEqual(['title']);
	});

	it('(b) keeps keys the callback does not touch', async () => {
		const { vault } = setup();
		vault.seedNote(NOTE, { title: 'x', status: 'todo', owner: 'me' });
		const file = fileAt(vault, NOTE);
		await vault.app.fileManager.processFrontMatter(file, (fm) => {
			fm.status = 'done';
		});
		expect(vault.frontmatterOf(NOTE)).toEqual({ title: 'x', status: 'done', owner: 'me' });
	});

	it('(c) removes a key on delete, so it is absent rather than undefined', async () => {
		const { vault } = setup();
		vault.seedNote(NOTE, { title: 'x', status: 'todo' });
		const file = fileAt(vault, NOTE);
		await vault.app.fileManager.processFrontMatter(file, (fm) => {
			delete fm.status;
		});
		const after = vault.frontmatterOf(NOTE);
		expect('status' in after).toBe(false);
		expect(after).toEqual({ title: 'x' });
		// The distinction matters: `undefined` is not a YAML value, so a key set to undefined would be
		// written as `status:` and read back as null by a real vault.
		expect(vault.raw(NOTE)).not.toContain('status');
	});

	it('(d) writes nothing when the callback throws', async () => {
		const { vault } = setup();
		vault.seedNote(NOTE, { title: 'x', status: 'todo' });
		const before = vault.raw(NOTE);
		const file = fileAt(vault, NOTE);
		await expect(
			vault.app.fileManager.processFrontMatter(file, (fm) => {
				fm.status = 'done';
				throw new Error('callback failed half way');
			}),
		).rejects.toThrow('callback failed half way');
		expect(vault.raw(NOTE)).toBe(before);
		expect(vault.writeCount()).toBe(0);
	});
});

describe('fake vault: the recording and the helpers', () => {
	it('records path, before, after and the clock reading for every write', async () => {
		const { clock, vault } = setup();
		vault.seedNote(NOTE, { title: 'x' });
		const file = fileAt(vault, NOTE);
		clock.advance(250);
		await vault.app.fileManager.processFrontMatter(file, (fm) => {
			fm.title = 'y';
		});
		expect(vault.writes).toEqual([
			{ path: NOTE, before: { title: 'x' }, after: { title: 'y' }, at: 250 },
		]);
		// The log holds copies, not references: a later write must not rewrite history.
		await vault.app.fileManager.processFrontMatter(file, (fm) => {
			fm.title = 'z';
		});
		expect(vault.writes.map((write) => write.after)).toEqual([{ title: 'y' }, { title: 'z' }]);
		expect(vault.writeCount(NOTE)).toBe(2);
		expect(vault.writeCount('somewhere/else.md')).toBe(0);
	});

	it('refuses vault.modify, because property writes belong to the queue', async () => {
		const { vault } = setup();
		vault.seedNote(NOTE, { title: 'x' });
		const file = fileAt(vault, NOTE);
		await expect(vault.app.vault.modify(file, 'anything')).rejects.toThrow(
			'Property writes must go through fileManager.processFrontMatter()',
		);
		expect(vault.raw(NOTE)).toBe('---\ntitle: "x"\n---\n');
	});

	it('refuses to create a note that already exists, like Obsidian does', async () => {
		const { vault } = setup();
		vault.seedNote(NOTE, { title: 'x' });
		await expect(vault.app.vault.create(NOTE, '---\n---\n')).rejects.toThrow('already exists');
		expect(vault.paths()).toEqual([NOTE]);
	});

	it('resolves a link the way Obsidian does: exact path, then basename, ambiguity by depth then name', () => {
		const { vault } = setup();
		vault.seedNote('Projects/Widening.md', {});
		vault.seedNote('Archive/Projects/Widening.md', {});
		vault.seedNote('Ideas.md', {});
		expect(vault.resolvePath('Projects/Widening')).toBe('Projects/Widening.md');
		expect(vault.resolvePath('./Ideas')).toBe('Ideas.md');
		expect(vault.resolvePath('ideas')).toBe('Ideas.md');
		// Ambiguous: the shallowest match wins, so the answer is deterministic rather than map order.
		expect(vault.resolvePath('Widening')).toBe('Projects/Widening.md');
		expect(vault.resolvePath('Nothing')).toBeUndefined();
	});

	it('serves cached metadata, falling back to the note frontmatter when a test sets nothing', () => {
		const { vault } = setup();
		vault.seedNote(NOTE, { title: 'x' });
		const file = fileAt(vault, NOTE);
		expect(vault.app.metadataCache.getFileCache(file)).toEqual({ frontmatter: { title: 'x' } });
		vault.setFileCache(NOTE, { frontmatter: { title: 'cached' } });
		expect(vault.app.metadataCache.getFileCache(file)).toEqual({
			frontmatter: { title: 'cached' },
		});
	});
});

describe('fake clock: time moves only when a test says so', () => {
	it('starts at zero and never advances on its own', () => {
		const clock = createFakeClock();
		expect(clock.now()).toBe(0);
		for (let tick = 0; tick < 1000; tick += 1) {
			// Deliberately busy: no timer is installed, so real elapsed time cannot leak into the value.
		}
		expect(clock.now()).toBe(0);
		expect(clock.pending()).toBe(0);
	});

	it('runs timers that come due, in due order, and leaves the rest pending', () => {
		const clock = createFakeClock();
		const order: string[] = [];
		clock.setTimer(() => order.push('b@100'), 100);
		clock.setTimer(() => order.push('a@50'), 50);
		clock.setTimer(() => order.push('c@500'), 500);
		expect(clock.pending()).toBe(3);
		clock.advance(100);
		expect(order).toEqual(['a@50', 'b@100']);
		expect(clock.now()).toBe(100);
		expect(clock.pending()).toBe(1);
		clock.advance(400);
		expect(order).toEqual(['a@50', 'b@100', 'c@500']);
		expect(clock.pending()).toBe(0);
	});

	it('runTimers fires everything pending and moves the clock to each due time', () => {
		const clock = createFakeClock();
		const order: string[] = [];
		clock.setTimer(() => order.push('first'), 10);
		clock.setTimer(() => order.push('second'), 25_000);
		clock.runTimers();
		expect(order).toEqual(['first', 'second']);
		expect(clock.now()).toBe(25_000);
	});

	it('cancels a timer without running it', () => {
		const clock = createFakeClock();
		let ran = false;
		const id = clock.setTimer(() => {
			ran = true;
		}, 5);
		clock.clearTimer(id);
		clock.advance(1000);
		expect(ran).toBe(false);
		expect(clock.pending()).toBe(0);
	});
});

describe('fake transport: nothing reaches the network', () => {
	it('throws when a request has no queued response', async () => {
		const { clock } = setup();
		const transport = createFakeTransport({ clock });
		await expect(
			transport.request({ url: 'https://api.example.test/v0/base' }),
		).rejects.toThrow('no queued response');
		// The call is not recorded either: it never happened.
		expect(transport.calls).toEqual([]);
	});

	it('records method, headers, body and the clock reading, and returns the queued response', async () => {
		const { clock } = setup();
		const transport = createFakeTransport({ clock });
		transport.queueStatus(429, {
			headers: { 'retry-after': '30' },
			body: { error: 'rate limited' },
		});
		clock.advance(1000);
		const response = await transport.request({
			url: 'https://api.example.test/v0/app/tbl/Table',
			method: 'PATCH',
			headers: { authorization: 'Bearer test' },
			body: '{"fields":{}}',
		});
		expect(response.status).toBe(429);
		expect(response.headers).toEqual({ 'retry-after': '30' });
		expect(transport.calls).toEqual([
			{
				url: 'https://api.example.test/v0/app/tbl/Table',
				method: 'PATCH',
				headers: { authorization: 'Bearer test' },
				body: '{"fields":{}}',
				at: 1000,
				outcome: 'response',
			},
		]);
		expect(transport.pending()).toBe(0);
	});

	it('simulates a timeout and a network error deterministically, with no clock movement', async () => {
		const { clock } = setup();
		const transport = createFakeTransport({ clock });
		transport.queueTimeout();
		transport.queueNetworkError();
		await expect(
			transport.request({ url: 'https://api.example.test/a' }),
		).rejects.toBeInstanceOf(TransportTimeoutError);
		await expect(
			transport.request({ url: 'https://api.example.test/b' }),
		).rejects.toBeInstanceOf(TransportNetworkError);
		expect(clock.now()).toBe(0);
		expect(transport.calls.map((call) => call.outcome)).toEqual(['timeout', 'network-error']);
	});
});
