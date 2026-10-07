/**
 * The pane registry — R2 step 5's gate.
 *
 * The promise under test is the multi-pane one: whatever a workspace does with leaves, one path has
 * exactly one session and one writer. These tests drive the registry through the fake port, so
 * "two panes" is two handles, "a rename" is a vault event, and "the last pane closed" is a refcount
 * reaching zero — all without a host.
 */
import { describe, expect, it } from 'vitest';

import { createSessionRegistry } from '../../src/adapters/tablifyFile/registry';
import type { DatabaseHandle, SessionRegistry } from '../../src/adapters/tablifyFile/registry';
import type { FilePort } from '../../src/adapters/tablifyFile/port';
import { createIdFactory, parseDocument } from '../../src/core/database/index';
import { createFakeClock } from '../fakes/clock';
import type { Clock } from '../fakes/clock';
import { createFakePort } from '../fakes/tablifyFile';
import type { FakeVaultPort } from '../fakes/tablifyFile';

const PATH = 'Databases/Studio.tablify';
const OTHER_PATH = 'Databases/Archive.tablify';
const DEBOUNCE = 400;

function sampleText(name = 'Studio'): string {
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: 'db_' + 'z'.repeat(26),
		name,
		tables: [
			{
				id: 'tbl_' + 'a'.repeat(26),
				name: 'Shoots',
				fields: [{ id: 'fld_' + 'c'.repeat(26), name: 'Title', type: 'text' }],
				rows: [
					{ id: 'row_' + 'e'.repeat(26), cells: { ['fld_' + 'c'.repeat(26)]: 'First' } },
				],
				views: [],
			},
		],
	});
}

interface Rig {
	readonly port: FakeVaultPort;
	readonly clock: Clock;
	readonly registry: SessionRegistry;
}

function rig(initial: Record<string, string> = { [PATH]: sampleText() }): Rig {
	const port = createFakePort(initial);
	const clock = createFakeClock(1000);
	let counter = 0;
	const ids = createIdFactory({
		randomValues(length: number): Uint8Array {
			counter += 1;
			const bytes = new Uint8Array(length);
			for (let index = 0; index < length; index += 1) {
				bytes[index] = (counter * 31 + index) % 251;
			}
			return bytes;
		},
	});
	const registry = createSessionRegistry(port, { debounceMs: DEBOUNCE, scheduler: clock, ids });
	return { port, clock, registry };
}

function editTitle(handle: DatabaseHandle, value: string): boolean {
	const applied = handle.session.dispatch({
		kind: 'set-cell',
		tableId: 'tbl_' + 'a'.repeat(26),
		rowId: 'row_' + 'e'.repeat(26),
		fieldId: 'fld_' + 'c'.repeat(26),
		value,
	});
	return applied.ok;
}

describe('one path, one session', () => {
	it('hands two panes the same session and the same writer', async () => {
		const { registry, port } = rig();
		const first = await registry.open(PATH);
		const second = await registry.open(PATH);
		expect(first.ok && second.ok).toBe(true);
		if (!first.ok || !second.ok) {
			return;
		}
		expect(second.handle.session).toBe(first.handle.session);
		expect(second.handle.queue).toBe(first.handle.queue);
		expect(port.reads).toEqual([PATH]);
		expect(registry.openCount()).toBe(1);
	});

	it('makes a second open while the first is still reading wait for the same read', async () => {
		const { registry, port } = rig();
		const [first, second] = await Promise.all([registry.open(PATH), registry.open(PATH)]);
		expect(first.ok && second.ok).toBe(true);
		if (!first.ok || !second.ok) {
			return;
		}
		expect(second.handle.session).toBe(first.handle.session);
		expect(port.reads).toEqual([PATH]);
	});

	it('shows one pane the other pane’s edit without a second session', async () => {
		const { registry } = rig();
		const first = await registry.open(PATH);
		const second = await registry.open(PATH);
		if (!first.ok || !second.ok) {
			throw new Error('the rig must open');
		}
		expect(editTitle(first.handle, 'From pane one')).toBe(true);
		const fieldId = 'fld_' + 'c'.repeat(26);
		const rowId = 'row_' + 'e'.repeat(26);
		expect(second.handle.session.getDocument().tables[0]?.rows[0]?.cells.get(fieldId)).toBe(
			'From pane one',
		);
		expect(second.handle.session.getDocument().tables[0]?.rows[0]?.id).toBe(rowId);
	});

	it('follows a rename, so the new path finds the session that already exists', async () => {
		const { registry, port } = rig();
		const before = await registry.open(PATH);
		if (!before.ok) {
			throw new Error('the rig must open');
		}
		port.simulateRename(PATH, OTHER_PATH);
		expect(before.handle.session.path).toBe(OTHER_PATH);

		const after = await registry.open(OTHER_PATH);
		expect(after.ok).toBe(true);
		if (!after.ok) {
			return;
		}
		expect(after.handle.session).toBe(before.handle.session);
		expect(port.reads).toEqual([PATH]);
		expect(registry.openPaths()).toEqual([OTHER_PATH]);

		const stale = await registry.open(PATH);
		expect(stale.ok).toBe(false);
		if (!stale.ok) {
			expect(stale.failure).toEqual({ kind: 'missing' });
		}
	});
});

describe('refcounted lifetime', () => {
	it('keeps the document open until the last pane releases it, then saves and disposes', async () => {
		const { registry, port } = rig();
		const first = await registry.open(PATH);
		const second = await registry.open(PATH);
		if (!first.ok || !second.ok) {
			throw new Error('the rig must open');
		}
		expect(editTitle(first.handle, 'Edited in pane one')).toBe(true);

		const firstRelease = await first.handle.release();
		expect(firstRelease).toEqual({ ok: true, wrote: false });
		expect(port.writes).toEqual([]);
		expect(first.handle.session.getState()).toBe('dirty');
		expect(registry.openCount()).toBe(1);

		const secondRelease = await second.handle.release();
		expect(secondRelease).toEqual({ ok: true, wrote: true });
		expect(port.writes).toEqual([PATH]);
		expect(second.handle.session.getState()).toBe('disposed');
		expect(registry.openCount()).toBe(0);
		expect(port.listenerCount()).toBe(1);
	});

	it('ignores a second release, and drops the path so a later open starts fresh', async () => {
		const { registry, port } = rig();
		const handle = await registry.open(PATH);
		if (!handle.ok) {
			throw new Error('the rig must open');
		}
		expect(await handle.handle.release()).toEqual({ ok: true, wrote: false });
		expect(await handle.handle.release()).toEqual({ ok: true, wrote: false });
		expect(registry.openCount()).toBe(0);

		const reopened = await registry.open(PATH);
		expect(reopened.ok).toBe(true);
		if (!reopened.ok) {
			return;
		}
		expect(reopened.handle.session).not.toBe(handle.handle.session);
		expect(port.reads).toEqual([PATH, PATH]);
	});

	it('disposes a document whose read was still in flight when the registry was torn down', async () => {
		const { registry, port } = rig();
		const pending = registry.open(PATH);
		await registry.disposeAll();
		const late = await pending;
		expect(late.ok).toBe(false);
		if (!late.ok) {
			expect(late.failure).toEqual({ kind: 'disposed' });
		}
		expect(port.listenerCount()).toBe(0);
		expect(registry.openCount()).toBe(0);
	});
});

describe('failures are reported, never cached', () => {
	it('reports a missing file, and opens it once it exists', async () => {
		const { registry, port } = rig({});
		const missing = await registry.open(PATH);
		expect(missing.ok).toBe(false);
		if (!missing.ok) {
			expect(missing.failure).toEqual({ kind: 'missing' });
		}
		expect(registry.openCount()).toBe(0);

		port.files.set(PATH, sampleText());
		const found = await registry.open(PATH);
		expect(found.ok).toBe(true);
		if (found.ok) {
			expect(found.handle.session.getDocument().name).toBe('Studio');
		}
	});

	it('hands back unreadable text for repair, with the reason', async () => {
		const { registry, port } = rig({ [PATH]: '{"format":"tablify","version":1,' });
		const broken = await registry.open(PATH);
		expect(broken.ok).toBe(false);
		if (!broken.ok) {
			expect(broken.failure.kind).toBe('invalid');
			expect(broken.rawText).toBe('{"format":"tablify","version":1,');
		}
		expect(registry.openCount()).toBe(0);
		expect(port.writes).toEqual([]);
	});

	it('refuses a future document version by name', async () => {
		const { registry } = rig({ [PATH]: sampleText().replace('"version":1', '"version":9') });
		const future = await registry.open(PATH);
		expect(future.ok).toBe(false);
		if (!future.ok) {
			expect(future.failure.kind).toBe('unsupported-version');
		}
	});
});

describe('create', () => {
	it('writes a valid minimum document and opens it', async () => {
		const { registry, port } = rig({});
		const created = await registry.create(PATH, 'New database');
		expect(created.ok).toBe(true);
		if (!created.ok) {
			return;
		}
		const text = port.files.get(PATH) ?? '';
		const parsed = parseDocument(text);
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.warnings).toEqual([]);
			expect(parsed.document.name).toBe('New database');
			expect(parsed.document.tables.length).toBe(1);
			expect(parsed.document.tables[0]?.fields.length).toBe(1);
			expect(parsed.document.tables[0]?.rows.length).toBe(1);
		}
		expect(created.handle.session.getDocument().name).toBe('New database');
		expect(registry.openPaths()).toEqual([PATH]);
	});

	it('refuses to overwrite a file that is already there', async () => {
		const { registry, port } = rig();
		const refused = await registry.create(PATH, 'Clobber');
		expect(refused.ok).toBe(false);
		if (!refused.ok) {
			expect(refused.failure).toEqual({ kind: 'exists', path: PATH });
		}
		expect(port.files.get(PATH)).toBe(sampleText());
		expect(port.writes).toEqual([]);
	});

	it('reports a host that refuses the create', async () => {
		const fake = createFakePort({});
		const refusing: FilePort = {
			read: (path) => fake.read(path),
			exists: () => Promise.resolve(false),
			create: () => Promise.reject(new Error('The vault said no.')),
			write: (path, text) => fake.write(path, text),
			subscribe: (listener) => fake.subscribe(listener),
		};
		const registry = createSessionRegistry(refusing, {
			debounceMs: DEBOUNCE,
			scheduler: createFakeClock(0),
			ids: createIdFactory({
				randomValues: (length: number) => new Uint8Array(length).fill(7),
			}),
		});
		const failed = await registry.create(PATH, 'Nope');
		expect(failed.ok).toBe(false);
		if (!failed.ok) {
			expect(failed.failure.kind).toBe('create-failed');
		}
	});
});

describe('the multi-pane exit criterion', () => {
	it('writes one burst from two panes once, and the file has both edits', async () => {
		const { registry, port, clock } = rig();
		const first = await registry.open(PATH);
		const second = await registry.open(PATH);
		if (!first.ok || !second.ok) {
			throw new Error('the rig must open');
		}
		// A command naming a field that is not in the table is refused, whoever sends it.
		expect(
			second.handle.session.dispatch({
				kind: 'set-cell',
				tableId: 'tbl_' + 'a'.repeat(26),
				rowId: 'row_' + 'e'.repeat(26),
				fieldId: 'fld_' + 'b'.repeat(26),
				value: 'ignored',
			}).ok,
		).toBe(false);

		expect(editTitle(first.handle, 'Pane one')).toBe(true);
		const firstWrite = first.handle.queue.request();
		expect(editTitle(second.handle, 'Pane two')).toBe(true);
		const secondWrite = second.handle.queue.request();
		clock.advance(DEBOUNCE);
		const [firstResult, secondResult] = await Promise.all([firstWrite, secondWrite]);
		expect(firstResult).toEqual(secondResult);
		expect(port.writes).toEqual([PATH]);

		const text = port.files.get(PATH) ?? '';
		expect(text.includes('Pane two')).toBe(true);
		expect(first.handle.session.getState()).toBe('clean');
	});

	it('disposes every open document on unload, flushing what was pending', async () => {
		const { registry, port } = rig({
			[PATH]: sampleText(),
			[OTHER_PATH]: sampleText('Archive'),
		});
		const studio = await registry.open(PATH);
		const archive = await registry.open(OTHER_PATH);
		if (!studio.ok || !archive.ok) {
			throw new Error('the rig must open');
		}
		expect(editTitle(studio.handle, 'Unsaved')).toBe(true);
		expect(editTitle(archive.handle, 'Also unsaved')).toBe(true);
		await registry.disposeAll();
		expect(port.writes).toEqual([PATH, OTHER_PATH]);
		expect(studio.handle.session.getState()).toBe('disposed');
		expect(archive.handle.session.getState()).toBe('disposed');
		expect(registry.openCount()).toBe(0);
		expect(port.listenerCount()).toBe(0);

		const refused = await registry.open(PATH);
		expect(refused.ok).toBe(false);
		if (!refused.ok) {
			expect(refused.failure).toEqual({ kind: 'disposed' });
		}
	});
});
