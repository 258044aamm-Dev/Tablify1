/**
 * The sync substrate: the port's retry arithmetic, the value hashes, and the link file.
 *
 * These three files are what step 26's diff engine is built on, and each of them has a rule that a comment cannot
 * enforce — which is why they are tested here rather than left to the engine's tests to find:
 *
 *   · **`retryDelayFor` is the only place a delay is decided**, so the table's promises (no retry for `auth`, a cap,
 *     `Retry-After` winning over the policy) are asserted directly instead of through a fake HTTP exchange.
 *   · **`canonical` makes two equal values hash equally** — the whole three-way diff rests on that, and a hash that
 *     disagreed with itself would show a conflict on every sync. Objects are key-sorted, a key set to `undefined`
 *     is dropped, and a list keeps its order (a multiselect is ordered; sorting it would call two different lists
 *     equal).
 *   · **A link file is either read or refused, never recreated**: `docs/03` says deleting the folder loses only the
 *     linkage, which is exactly why a *corrupt* file must be reported — a silent fresh document would drop the field
 *     mapping the user cannot rebuild from memory. The forward-compatibility rule (unknown keys survive a round
 *     trip; a newer `version` refuses to load) is asserted in both directions.
 */
import { describe, expect, it } from 'vitest';
import {
	RETRY_POLICIES,
	SyncFailure,
	errorText,
	resolveFieldMap,
	retryDelayFor,
} from '../../src/sync/SyncTarget';
import type { SyncError } from '../../src/sync/SyncTarget';
import { canonical, hashFields, hashValue } from '../../src/sync/hash';
import {
	LINK_FOLDER,
	LINK_VERSION,
	createLinkStore,
	describeLink,
	linkKey,
	linkPath,
	newLinkDocument,
	parseLink,
	recordSnapshot,
	serialiseLink,
} from '../../src/sync/LinkStore';
import type { LinkDocument, LinkVault } from '../../src/sync/LinkStore';

describe('retry arithmetic', () => {
	const rateLimit: SyncError = { kind: 'rateLimit', message: 'slow down', status: 429 };

	it('has a policy per kind, and only the two transient kinds retry', () => {
		expect(Object.keys(RETRY_POLICIES).sort()).toEqual([
			'auth',
			'network',
			'rateLimit',
			'schema',
			'validation',
		]);
		expect(RETRY_POLICIES.auth.attempts).toBe(1);
		expect(RETRY_POLICIES.schema.attempts).toBe(1);
		expect(RETRY_POLICIES.validation.attempts).toBe(1);
		expect(RETRY_POLICIES.network.attempts).toBeGreaterThan(1);
		expect(RETRY_POLICIES.rateLimit.attempts).toBeGreaterThan(1);
		expect(RETRY_POLICIES.rateLimit.honourRetryAfter).toBe(true);
	});

	it('answers a delay for every attempt before the cap, and `null` at it — which is how a caller knows to stop', () => {
		// `attempts` counts total tries, so `network: 4` means three delays and then a fourth, final request. The
		// client's loop reads `null` as "do not retry" and surfaces the error instead of sleeping forever.
		const last = RETRY_POLICIES.network.attempts;
		expect(retryDelayFor({ kind: 'network', message: 'x' }, 1, () => 0.5)).not.toBeNull();
		expect(
			retryDelayFor({ kind: 'network', message: 'x' }, last - 1, () => 0.5),
		).not.toBeNull();
		expect(retryDelayFor({ kind: 'network', message: 'x' }, last, () => 0.5)).toBeNull();
		expect(retryDelayFor({ kind: 'network', message: 'x' }, last + 1, () => 0.5)).toBeNull();
		// A kind that never retries has no delay at all: `auth: 1` answers `null` on the first attempt.
		expect(retryDelayFor({ kind: 'auth', message: 'x' }, 1, () => 0.5)).toBeNull();
	});

	it('grows the delay per attempt and never exceeds the 30 s ceiling', () => {
		const at = (attempt: number): number =>
			retryDelayFor({ kind: 'network', message: 'x' }, attempt, () => 1) ?? -1;
		// Full jitter with `random() === 1` is the policy's own ceiling for that attempt: base × 2^(attempt-1).
		expect(at(1)).toBe(500);
		expect(at(2)).toBe(1000);
		expect(at(3)).toBe(2000);
		// The cap is applied before jitter, so no attempt can produce a longer wait than 30 s.
		expect(at(20)).toBeLessThanOrEqual(30_000);
	});

	it('jitter is per-attempt and bounded: `random()` decides inside `[0, ceiling]`', () => {
		expect(retryDelayFor({ kind: 'network', message: 'x' }, 1, () => 0)).toBe(0);
		expect(retryDelayFor({ kind: 'network', message: 'x' }, 1, () => 0.5)).toBe(250);
		expect(retryDelayFor({ kind: 'network', message: 'x' }, 1, () => 1)).toBe(500);
	});

	it('`Retry-After` wins over the policy, and is capped like everything else', () => {
		expect(retryDelayFor({ ...rateLimit, retryAfterMs: 2500 }, 1, () => 0)).toBe(2500);
		expect(retryDelayFor({ ...rateLimit, retryAfterMs: 600_000 }, 1, () => 0)).toBe(30_000);
	});

	it('`errorText` names the kind and the request, and carries no token', () => {
		const text = errorText({
			kind: 'auth',
			message: 'Invalid authentication token',
			request: { method: 'GET', url: 'https://api.airtable.com/v0/appX/tblY' },
			status: 401,
		});
		expect(text).toBe(
			'[auth] (GET https://api.airtable.com/v0/appX/tblY) Invalid authentication token',
		);
		expect(errorText({ kind: 'network', message: 'offline' })).toBe('[network] offline');
	});

	it('`SyncFailure` is a real `Error` that still carries the typed error', () => {
		const error: SyncError = { kind: 'schema', message: 'not records' };
		const failure = new SyncFailure(error);
		expect(failure).toBeInstanceOf(Error);
		expect(failure.name).toBe('SyncFailure');
		expect(failure.message).toBe('[schema] not records');
		expect(failure.sync).toBe(error);
	});
});

describe('the field mapping resolver', () => {
	const remote: readonly { readonly id: string; readonly name: string; readonly type: string }[] =
		[
			{ id: 'fldName', name: 'Name', type: 'singleLineText' },
			{ id: 'fldCost', name: 'Cost', type: 'number' },
		];

	it('matches a local property to a remote field by exact name, and reports both directions of "no counterpart"', () => {
		const result = resolveFieldMap(['Name', 'Owner'], remote, {});
		expect(result.map).toEqual({ Name: 'fldName' });
		expect(result.unmapped).toEqual([
			{ side: 'local', name: 'Owner' },
			{ side: 'remote', name: 'Cost' },
		]);
	});

	it('does **not** match a name that differs only in case: the pair is reported and the user maps it', () => {
		// Deliberate. A vault can hold both `name` and `Name` as properties, and silently folding them would
		// write one column's values into the other field. The link panel (step 26) is where a person resolves it,
		// and the report names both sides so the row is visible rather than swallowed.
		const result = resolveFieldMap(['name'], remote, {});
		expect(result.map).toEqual({});
		expect(result.unmapped.map((field) => `${field.side}:${field.name}`)).toEqual([
			'local:name',
			'remote:Name',
			'remote:Cost',
		]);
	});

	it('lets a stored id win while that remote field still exists, even when the name changed', () => {
		const result = resolveFieldMap(['Renamed'], remote, { Renamed: 'fldCost' });
		expect(result.map).toEqual({ Renamed: 'fldCost' });
		// `Cost` is mapped (to `Renamed`), so it is not reported as unclaimed; `fldName` now is.
		expect(result.unmapped).toEqual([{ side: 'remote', name: 'Name' }]);
	});

	it('drops a stored id whose remote field is gone and falls back to the name', () => {
		const result = resolveFieldMap(['Cost'], remote, { Cost: 'fldDeleted' });
		expect(result.map).toEqual({ Cost: 'fldCost' });
		expect(result.unmapped).toEqual([{ side: 'remote', name: 'Name' }]);
	});

	it('is stable: the same inputs produce the same mapping, whatever the order', () => {
		const first = resolveFieldMap(['Cost', 'Name'], remote, {});
		const second = resolveFieldMap(['Name', 'Cost'], remote, {});
		expect(first.map).toEqual(second.map);
		expect(first.map).toEqual({ Cost: 'fldCost', Name: 'fldName' });
	});
});

describe('canonical form and hashes', () => {
	it('key order does not change a hash — an object is sorted', async () => {
		expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
		expect(await hashValue({ b: 1, a: 2 })).toBe(await hashValue({ a: 2, b: 1 }));
	});

	it('drops an object key set to `undefined` (a written key that is not a value) but keeps an explicit `null`', () => {
		expect(canonical({ a: 1, b: undefined })).toBe(canonical({ a: 1 }));
		expect(canonical({ a: null })).not.toBe(canonical({}));
	});

	it("keeps a list's order: two different orders are two different values", async () => {
		expect(await hashValue(['a', 'b'])).not.toBe(await hashValue(['b', 'a']));
		// A missing list member is a `null`, not a gap.
		expect(canonical([1, undefined, 2])).toBe(canonical([1, null, 2]));
	});

	it('distinguishes a number from its text, and normalises the ways a number can be written', () => {
		expect(canonical(1)).not.toBe(canonical('1'));
		expect(canonical(1)).toBe(canonical(1.0));
		expect(canonical(-0)).toBe(canonical(0));
	});

	it('answers `sha256:` plus 64 hex characters, and the same value hashes the same twice', async () => {
		const first = await hashValue('Kettle');
		expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(await hashValue('Kettle')).toBe(first);
		expect(await hashValue('Kettles')).not.toBe(first);
	});

	it('an empty field hashes as the hash of `null` — the same thing a cleared field means', async () => {
		const hashes = await hashFields({ Name: undefined, Cost: 12 }, ['Name', 'Cost']);
		expect(hashes.Name).toBe(await hashValue(null));
		expect(hashes.Cost).toBe(await hashValue(12));
		expect(Object.keys(hashes)).toEqual(['Name', 'Cost']);
	});
});

describe('the link key and path', () => {
	it('is stable for the same input and different for a different one', () => {
		expect(linkKey('Projects.base', 'Grid')).toBe(linkKey('Projects.base', 'Grid'));
		expect(linkKey('Projects.base', 'Grid')).not.toBe(linkKey('Projects.base', 'Grid 2'));
		expect(linkKey('Projects.base', 'Grid')).not.toBe(linkKey('Other.base', 'Grid'));
	});

	it('cannot be confused by the join: `a` + `b/c` is not `a/b` + `c`', () => {
		expect(linkKey('a', 'b/c')).not.toBe(linkKey('a/b', 'c'));
	});

	it('is 16 hex characters, inside the disposable dot-folder', () => {
		expect(linkKey('Projects.base', 'Grid')).toMatch(/^[0-9a-f]{16}$/);
		expect(linkPath('Projects.base', 'Grid')).toBe(
			`${LINK_FOLDER}/${linkKey('Projects.base', 'Grid')}.json`,
		);
		expect(LINK_FOLDER.startsWith('.')).toBe(true);
	});
});

/** A vault with two methods, which is all the link store is allowed to need. */
function createLinkVault(initial: Readonly<Record<string, string>> = {}) {
	const files = new Map<string, string>(Object.entries(initial));
	const writes: string[] = [];
	const vault: LinkVault = {
		read: (path) => Promise.resolve(files.get(path) ?? null),
		write: (path, text) => {
			files.set(path, text);
			writes.push(path);
			return Promise.resolve();
		},
	};
	return { vault, files, writes };
}

const TARGET = { baseId: 'appX', baseName: 'Projects', tableId: 'tblY', tableName: 'Notes' };

describe('the link file', () => {
	it('a missing file is not an error: it answers with the document a first sync would write', async () => {
		const { vault } = createLinkVault();
		const store = createLinkStore(vault, { basePath: 'Projects.base', viewName: 'Grid' });
		const load = await store.load('Projects.base', 'Grid', TARGET);
		expect(load.ok).toBe(true);
		expect(load.ok ? load.existed : true).toBe(false);
		expect(load.ok ? load.document : null).toMatchObject({
			version: LINK_VERSION,
			basePath: 'Projects.base',
			viewName: 'Grid',
			airtable: TARGET,
			recordMap: {},
			fieldMap: {},
			snapshot: {},
			lastPulledAt: null,
			lastPushedAt: null,
		});
	});

	it('round-trips through the file: save then load answers the same document', async () => {
		const { vault } = createLinkVault();
		const store = createLinkStore(vault, { basePath: 'Projects.base', viewName: 'Grid' });
		const document: LinkDocument = {
			...newLinkDocument({ basePath: 'Projects.base', viewName: 'Grid', target: TARGET }),
			recordMap: { 'Notes/Kettle.md': 'recA' },
			fieldMap: { Name: 'fldName' },
			snapshot: { recA: { fldName: 'sha256:abc' } },
			lastPulledAt: '2026-10-06T09:00:00.000Z',
		};
		await store.save(document);
		const load = await store.load('Projects.base', 'Grid', TARGET);
		expect(load.ok ? load.document : null).toEqual(document);
		expect(load.ok ? load.existed : false).toBe(true);
	});

	it('keeps a key this build does not know, and writes it back verbatim', async () => {
		const store = createLinkStore(createLinkVault().vault, {
			basePath: 'Projects.base',
			viewName: 'Grid',
		});
		const path = store.path;
		const text = JSON.stringify({
			version: 1,
			basePath: 'Projects.base',
			viewName: 'Grid',
			airtable: TARGET,
			recordMap: {},
			fieldMap: {},
			snapshot: {},
			lastPulledAt: null,
			lastPushedAt: null,
			futureThing: { nested: [1, 2, 3] },
		});
		const parsed = parseLink(text, path);
		if (!parsed.ok) {
			throw new Error(`the link file should have parsed: ${parsed.reason}`);
		}
		expect(parsed.document.unknown).toEqual({ futureThing: { nested: [1, 2, 3] } });
		// The written form is checked as **text**, key by key in order: an unknown key survives, and it is written
		// after the keys this build owns, so a diff of the file shows what changed rather than what re-serialised.
		const written = serialiseLink(parsed.document);
		expect(written).toContain('"futureThing"');
		expect(written).toContain('"nested"');
		// `JSON.stringify(value, null, 2)` indents a top-level key with exactly two spaces — the check reads the file's
		// own text, so a serialiser that changed its indentation would fail here rather than silently reorder keys.
		const order = (written.match(/^ {2}"([^"]+)":/gm) ?? []).map((line) =>
			line.replace(/[^A-Za-z]/g, ''),
		);
		expect(order).toEqual([
			'version',
			'basePath',
			'viewName',
			'airtable',
			'recordMap',
			'fieldMap',
			'snapshot',
			'lastPulledAt',
			'lastPushedAt',
			'futureThing',
		]);
	});

	it('refuses a document written by a newer link format, naming both versions', () => {
		const parsed = parseLink(JSON.stringify({ version: 2, airtable: TARGET }), 'x.json');
		expect(parsed.ok).toBe(false);
		expect(parsed.ok ? '' : parsed.reason).toContain('newer version of Tablify');
		expect(parsed.ok ? '' : parsed.reason).toContain('link format 2');
	});

	it('refuses malformed JSON, a non-object, a missing version and a missing base — each with a sentence', () => {
		const cases: readonly (readonly [string, string])[] = [
			['{ not json', 'not valid JSON'],
			['[1,2,3]', 'does not hold an object'],
			['{ "airtable": {} }', 'no version number'],
			['{ "version": 1 }', 'no Airtable base and table'],
		];
		for (const [text, expected] of cases) {
			const parsed = parseLink(text, 'link.json');
			expect(parsed.ok).toBe(false);
			expect(parsed.ok ? '' : parsed.reason).toContain(expected);
		}
	});

	it('never silently re-creates a corrupt file: the store answers the parse failure', async () => {
		const store = createLinkStore(createLinkVault().vault, {
			basePath: 'Projects.base',
			viewName: 'Grid',
		});
		const broken = createLinkVault({ [store.path]: '{ "version": 1, "airtable": ' });
		const second = createLinkStore(broken.vault, {
			basePath: 'Projects.base',
			viewName: 'Grid',
		});
		const load = await second.load('Projects.base', 'Grid', TARGET);
		expect(load.ok).toBe(false);
		expect(broken.writes).toEqual([]);
	});

	it('reads a file where a list arrived instead of a map as an empty map rather than crashing', () => {
		const parsed = parseLink(
			JSON.stringify({
				version: 1,
				airtable: TARGET,
				recordMap: ['not', 'a', 'map'],
				snapshot: 'nope',
			}),
			'link.json',
		);
		expect(parsed.ok).toBe(true);
		expect(parsed.ok ? parsed.document.recordMap : null).toEqual({});
		expect(parsed.ok ? parsed.document.snapshot : null).toEqual({});
	});
});

describe("the snapshot and the link's description", () => {
	it("replaces a record's hashes rather than merging them: a stale hash is how a conflict lasts forever", async () => {
		// The caller passes the **remote field ids** it agreed on (`fieldMap`'s values), so the snapshot is keyed by
		// field id; a hash for a field this pull did not cover is dropped rather than kept as a false agreement.
		const before = { recA: { fldName: 'sha256:old', fldGone: 'sha256:old' } };
		const after = await recordSnapshot(before, 'recA', { fldName: 'Kettle' }, ['fldName']);
		expect(Object.keys(after.recA ?? {}).sort()).toEqual(['fldName']);
		expect(after.recA?.fldName).toBe(await hashValue('Kettle'));
		// Other records are untouched.
		const two = await recordSnapshot(after, 'recB', { fldName: 'Pot' }, ['fldName']);
		expect(Object.keys(two).sort()).toEqual(['recA', 'recB']);
	});

	it('describes the link with both directions of unmatched fields, and never a bare count', () => {
		const document = newLinkDocument({
			basePath: 'Projects.base',
			viewName: 'Grid',
			target: TARGET,
		});
		const sentence = describeLink(document, [
			{ side: 'local', name: 'Owner' },
			{ side: 'remote', name: 'Status' },
			{ side: 'remote', name: 'Notes' },
		]);
		expect(sentence).toContain('Projects › Notes');
		expect(sentence).toContain('1 column(s) with no Airtable field: Owner');
		expect(sentence).toContain('2 Airtable field(s) with no column: Status, Notes');
	});

	it('falls back to ids when the names are unknown, and says nothing extra when everything matches', () => {
		const bare = newLinkDocument({
			basePath: 'b',
			viewName: 'v',
			target: { baseId: 'appX', baseName: '', tableId: 'tblY', tableName: '' },
		});
		expect(describeLink(bare, [])).toBe('Linked to appX › tblY');
	});
});
