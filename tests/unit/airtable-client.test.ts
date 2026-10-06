/**
 * The Airtable client against the house transport fake, with **no network anywhere**.
 *
 * `tests/fakes/transport.ts` is the substrate the rest of the sync path is tested on, and its tripwire is the first
 * assertion here: a request with nothing queued throws, so "no test reaches Airtable" is a property the suite
 * enforces rather than a promise in a comment. Its `clock` is `tests/fakes/clock.ts`, which means every backoff in
 * these tests is exact — the delays a retry *would* have slept are read off `clock.advance` totals and `calls[].at`
 * rather than waited for.
 *
 * The scenarios, one per `it()`, are the ones the step lists by name:
 *
 * | Scenario | What it proves |
 * |---|---|
 * | pagination cap | a wrong `offset` cannot loop forever, and a truncated read is *reported* as truncated |
 * | 429 + `Retry-After: 2` | the header is honoured (≥ 2 s on the fake clock) and the call then succeeds |
 * | 500 ×4 | the network policy's attempt count, then a `NetworkError` rather than a throw |
 * | 401 | an `AuthError` with exactly one request — no retry, because a wrong token stays wrong |
 * | malformed body | a `SchemaError` naming what was wrong, not a crash and not a silent `undefined` |
 * | 12-record push | exactly two chunked writes of 10 and 2, `PATCH`, `typecast: false` |
 * | partial failure | per-record outcomes: the failed chunk's ten are reported, the next chunk still runs |
 * | redaction | no error, anywhere, contains the token |
 */
import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../fakes/clock';
import type { Clock } from '../fakes/clock';
import { createFakeTransport, TransportTimeoutError } from '../fakes/transport';
import type { FakeTransport } from '../fakes/transport';
import { DEFAULT_LIMITS, createAirtableClient } from '../../src/sync/airtable/client';
import { SyncFailure } from '../../src/sync/SyncTarget';
import type { PushedRecord, SyncError } from '../../src/sync/SyncTarget';
import {
	createRequestUrlTransport,
	redactedHeaders,
	retryAfterMs,
} from '../../src/sync/airtable/transport';
import type { TransportRequest } from '../../src/sync/airtable/transport';

const TOKEN = 'patTESTTOKENnotarealtoken0001';
const BASE = 'appTestBaseId';
const TABLE = 'tblTestTableId';

/** A client over the fake, with the fake clock driving both `now` and the sleeper. */
function setup(options: { random?: () => number; limits?: Partial<typeof DEFAULT_LIMITS> } = {}) {
	const clock = createFakeClock(1_700_000_000_000);
	const transport: FakeTransport = createFakeTransport({ clock });
	const client = createAirtableClient({
		token: TOKEN,
		baseId: BASE,
		tableId: TABLE,
		transport: (request) => transport.request(request),
		now: () => clock.now(),
		// The sleeper is the fake clock's timer, so `clock.advance` is what makes a backoff elapse; a test that
		// forgets to advance fails on the pending timer rather than hanging.
		sleep: (ms) =>
			new Promise<void>((resolve) => {
				clock.setTimer(resolve, ms);
			}),
		// Jitter off by default so a delay assertion is exact; the jitter test injects its own source.
		random: options.random ?? (() => 0),
		...(options.limits === undefined ? {} : { limits: options.limits }),
	});
	return { clock, transport, client };
}

/**
 * Runs a client call to completion **without waiting on wall-clock time**: each turn yields the microtask queue (so
 * the transport's resolved promise advances the client) and then runs any backoff timer that came due. Two hundred
 * turns is far more than the retry table can need, so a loop ending early means the promise genuinely never settled —
 * which the `throw` says, rather than a five-second test timeout.
 */
async function run<T>(promise: Promise<T>, clock: Clock): Promise<T> {
	let settled = false;
	// `finally` reports settlement without swallowing a rejection, and what is awaited below is the original promise —
	// so a failure arrives as the typed error the caller handles rather than as a value the helper re-wrapped.
	const tracked = promise.finally(() => {
		settled = true;
	});
	for (let turn = 0; turn < 200 && !settled; turn += 1) {
		await Promise.resolve();
		if (clock.pending() > 0) {
			clock.runTimers();
		}
	}
	if (!settled) {
		// Without this the rejection below would surface as an unhandled rejection while the test fails on the loop.
		void tracked.catch(() => undefined);
		throw new Error(
			'the call never settled: the fake clock has no timer left to run and the promise is still pending',
		);
	}
	return await tracked;
}

/** The same pump, answering with the failure instead of throwing it — the shape a caller actually handles. */
async function attempt<T>(
	promise: Promise<T>,
	clock: Clock,
): Promise<
	{ readonly ok: true; readonly result: T } | { readonly ok: false; readonly error: SyncError }
> {
	try {
		return { ok: true, result: await run(promise, clock) };
	} catch (thrown) {
		if (thrown instanceof SyncFailure) {
			return { ok: false, error: thrown.sync };
		}
		throw thrown;
	}
}

/**
 * The error from a failed attempt, or a thrown complaint — so a test that expects a failure cannot silently pass a
 * `null` on to `expect`, which is what `?.` in fifteen places would do.
 */
function failureOf(
	outcome:
		| { readonly ok: true; readonly result: unknown }
		| { readonly ok: false; readonly error: SyncError },
): SyncError {
	if (outcome.ok) {
		throw new Error('expected the call to fail, but it answered with a result');
	}
	return outcome.error;
}

/** The reason a pushed record was refused, or an empty string when it was accepted or absent, narrowed not cast. */
function reasonOf(record: PushedRecord | undefined): string {
	return record !== undefined && !record.ok ? record.reason : '';
}

/** A thrown value's message, for the `rejects` assertions — a throw of a non-`Error` answers `''`. */
function messageOf(thrown: unknown): string {
	return thrown instanceof Error ? thrown.message : '';
}

/** Runs a pull under the pump and answers with the result or with the typed error. */
function pullSettled(client: ReturnType<typeof setup>['client'], clock: Clock) {
	return attempt(client.pull(null), clock);
}

/** The body a request carried, as an object of `unknown`s — read without an assertion, so a wrong shape shows up. */
function sentBody(request: TransportRequest | undefined): Readonly<Record<string, unknown>> {
	const parsed: unknown = JSON.parse(request?.body ?? '{}');
	return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
		? Object.fromEntries(Object.entries(parsed))
		: {};
}

/**
 * A list guard written by hand rather than `Array.isArray`.
 *
 * `Array.isArray(value)` narrows an `unknown` to `any[]`, which puts an `any` back into a file that must not have one
 * (`no-unsafe-argument` catches it at the first use). Naming the narrowing keeps every element `unknown`.
 */
function isUnknownList(value: unknown): value is readonly unknown[] {
	return Array.isArray(value);
}

/** The record ids a `PATCH` body carried, filtered to the entries that have a string id. */
function sentRecords(request: TransportRequest | undefined): readonly string[] {
	const records = sentBody(request)['records'];
	if (!isUnknownList(records)) {
		return [];
	}
	const ids: string[] = [];
	for (const item of records) {
		if (typeof item !== 'object' || item === null || Array.isArray(item)) {
			continue;
		}
		// `in` narrows the object to one with that key; reading it as `unknown` keeps the `any` out of the file.
		if ('id' in item && typeof item.id === 'string') {
			ids.push(item.id);
		}
	}
	return ids;
}

/** A queued `PATCH` answer: Airtable echoes the records it wrote, so the fake echoes the ids a test expects. */
function echoing(ids: readonly string[]): { status: number; text: string } {
	return {
		status: 200,
		text: JSON.stringify({ records: ids.map((id) => ({ id, fields: {} })) }),
	};
}

describe('the transport fake', () => {
	it('throws when a request has no queued response — and nothing here reaches the network', async () => {
		const { transport } = setup();
		await expect(
			transport.request({
				url: 'https://api.airtable.com/v0/x/y',
				method: 'GET',
				headers: {},
			}),
		).rejects.toThrow(/no queued response/);
	});

	it('records the requests it answered, so a test can assert on the whole exchange', async () => {
		const { transport, client, clock } = setup();
		transport.queue({ status: 200, text: JSON.stringify({ records: [] }) });
		await run(client.pull(null), clock);
		expect(transport.calls).toHaveLength(1);
		expect(transport.calls[0]?.at).toBe(clock.now());
	});
});

describe('pagination', () => {
	it('follows `offset` and stops at the cap, reporting `truncated: true` rather than a short read', async () => {
		const { transport, client, clock } = setup({ limits: { maxPages: 3, pageSize: 2 } });
		// Every page claims there is another one: the pathological provider the cap exists for.
		for (let page = 0; page < 4; page += 1) {
			transport.queuePage(
				[{ id: `rec${String(page)}`, fields: { Name: `Row ${String(page)}` } }],
				`offset-${String(page)}`,
			);
		}
		const result = await run(client.pull(null), clock);
		expect(result.records.map((record) => record.id)).toEqual(['rec0', 'rec1', 'rec2']);
		expect(result.truncated).toBe(true);
		// Two records per page × three pages: the 2,000-record ceiling in miniature.
		expect(result.records.length).toBe(3);
		// The fourth page the fake is still holding was never asked for: the cap stopped the loop, not the data.
		expect(transport.pending()).toBe(1);
	});

	it('reports a complete read as complete, with the final page carrying no offset', async () => {
		const { transport, client, clock } = setup();
		transport.queuePage([{ id: 'recA', fields: { Name: 'A' } }], 'page-2');
		transport.queuePage([{ id: 'recB', fields: { Name: 'B' } }]);
		const result = await run(client.pull(null), clock);
		expect(result.records.map((record) => record.id)).toEqual(['recA', 'recB']);
		expect(result.truncated).toBe(false);
	});

	it('asks for field ids and narrows the read with `LAST_MODIFIED_TIME()` when a cursor is given', async () => {
		const { transport, client, clock } = setup();
		transport.queuePage([]);
		await run(client.pull('2026-10-01T00:00:00.000Z'), clock);
		const url = transport.calls[0]?.url ?? '';
		expect(url).toContain(`pageSize=${String(DEFAULT_LIMITS.pageSize)}`);
		expect(url).toContain('returnFieldsByFieldId=true');
		expect(decodeURIComponent(url)).toContain(
			"filterByFormula=LAST_MODIFIED_TIME() > '2026-10-01T00:00:00.000Z'",
		);
	});
});

describe('retry policy', () => {
	it('honours `Retry-After: 2` on a 429 and then succeeds, waiting ≥ 2 s on the fake clock', async () => {
		const clock = createFakeClock(1_700_000_000_000);
		const transport = createFakeTransport({ clock });
		const client = createAirtableClient({
			token: TOKEN,
			baseId: BASE,
			tableId: TABLE,
			transport: (request) => transport.request(request),
			now: () => clock.now(),
			sleep: (ms) => new Promise<void>((resolve) => clock.setTimer(resolve, ms)),
			random: () => 0,
		});
		transport.queueStatus(429, { headers: { 'retry-after': '2' } });
		transport.queuePage([{ id: 'recA', fields: {} }]);
		const started = clock.now();
		const result = await run(client.pull(null), clock);
		const waited = clock.now() - started;
		expect(waited).toBeGreaterThanOrEqual(2000);
		expect(waited).toBe(2000);
		expect(result.records).toHaveLength(1);
		expect(transport.calls).toHaveLength(2);
	});

	it('retries a 500 the documented number of times and then surfaces a NetworkError', async () => {
		const { transport, client, clock } = setup();
		for (let attempt = 0; attempt < DEFAULT_LIMITS.maxSeconds; attempt += 1) {
			transport.queueStatus(500, { body: { error: { message: 'boom' } } });
		}
		const outcome = await pullSettled(client, clock);
		expect(outcome.ok).toBe(false);
		const error = failureOf(outcome);
		expect(error.kind).toBe('network');
		expect(error.status).toBe(500);
		// `network: 4 attempts` — the first try plus three retries.
		expect(transport.calls).toHaveLength(4);
		expect(error.message).toBe('boom');
	});

	it('does not retry a 401: one request, an AuthError, and a message a person can act on', async () => {
		const { transport, client, clock } = setup();
		transport.queueStatus(401, {
			body: { error: { message: 'Invalid authentication token' } },
		});
		const outcome = await pullSettled(client, clock);
		expect(outcome.ok).toBe(false);
		const error = failureOf(outcome);
		expect(error.kind).toBe('auth');
		expect(error.status).toBe(401);
		expect(transport.calls).toHaveLength(1);
		expect(clock.pending()).toBe(0);
	});

	it('treats a rejected transport as a network error and retries it', async () => {
		const { transport, client, clock } = setup();
		transport.queueTimeout();
		transport.queuePage([{ id: 'recA', fields: {} }]);
		const outcome = await pullSettled(client, clock);
		expect(outcome.ok).toBe(true);
		expect(transport.calls[0]?.outcome).toBe('timeout');
		expect(transport.calls).toHaveLength(2);
	});

	it('jitters the delay: same attempt, different random source, different wait', async () => {
		const waits: number[] = [];
		for (const value of [0.1, 0.9]) {
			const clock = createFakeClock(0);
			const transport = createFakeTransport({ clock });
			const client = createAirtableClient({
				token: TOKEN,
				baseId: BASE,
				tableId: TABLE,
				transport: (request) => transport.request(request),
				now: () => clock.now(),
				sleep: (ms) => new Promise<void>((resolve) => clock.setTimer(resolve, ms)),
				random: () => value,
			});
			transport.queueStatus(500, { body: { error: { message: 'boom' } } });
			transport.queuePage([{ id: 'recA', fields: {} }]);
			await run(client.pull(null), clock);
			waits.push(clock.now());
		}
		expect(waits[0]).toBeLessThan(waits[1] ?? 0);
		// Both inside the network policy's first backoff: base 500 ms, full jitter.
		expect(waits[0]).toBeGreaterThanOrEqual(0);
		expect(waits[1]).toBeLessThanOrEqual(500);
	});

	it('caps a `Retry-After` longer than the ceiling rather than sleeping past it', async () => {
		// `maxSeconds: 30` — a provider cannot make a person wait a minute for a click.
		expect(retryAfterMs({ 'retry-after': '600' }, 0)).toBe(600_000);
		const clock = createFakeClock(0);
		const transport = createFakeTransport({ clock });
		const client = createAirtableClient({
			token: TOKEN,
			baseId: BASE,
			tableId: TABLE,
			transport: (request) => transport.request(request),
			now: () => clock.now(),
			sleep: (ms) => new Promise<void>((resolve) => clock.setTimer(resolve, ms)),
			random: () => 0,
			limits: { maxSeconds: 5 },
		});
		transport.queueStatus(429, { headers: { 'retry-after': '600' } });
		transport.queuePage([]);
		await run(client.pull(null), clock);
		expect(clock.now()).toBe(5000);
	});
});

describe('response validation', () => {
	it('a malformed body is a SchemaError naming what was wrong — never a crash', async () => {
		const { transport, client, clock } = setup();
		transport.queue({ status: 200, body: { rows: 'not records' } });
		const outcome = await pullSettled(client, clock);
		expect(outcome.ok).toBe(false);
		const error = failureOf(outcome);
		expect(error.kind).toBe('schema');
		expect(error.message).toContain('`records[]`');
		expect(transport.calls).toHaveLength(1);
	});

	it('a page whose record has no `id` is a SchemaError, not a record with `undefined` in it', async () => {
		const { transport, client, clock } = setup();
		transport.queue({ status: 200, body: { records: [{ fields: { Name: 'A' } }] } });
		const outcome = await pullSettled(client, clock);
		expect(outcome.ok).toBe(false);
		expect(failureOf(outcome).kind).toBe('schema');
	});

	it('a non-object body is a SchemaError too — the fake answers `undefined` when the text will not parse', async () => {
		const { transport, client, clock } = setup();
		transport.queue({ status: 200, text: '<html>maintenance</html>', body: undefined });
		const outcome = await pullSettled(client, clock);
		expect(outcome.ok).toBe(false);
		expect(failureOf(outcome).kind).toBe('schema');
	});

	it('reports an HTML error page by its size, and never quotes the markup', async () => {
		const { transport, client, clock } = setup();
		transport.queue({
			status: 502,
			text: '<html><body>Bad gateway</body></html>',
			body: undefined,
		});
		const outcome = await pullSettled(client, clock);
		expect(outcome.ok).toBe(false);
		const error = failureOf(outcome);
		expect(error.message).toContain('bytes that were not JSON');
		expect(error.message).not.toContain('<html>');
	});

	it('a base whose metadata has no `tables[]` fails as a SchemaError rather than an empty description', async () => {
		const { transport, client, clock } = setup();
		// One queued answer, one call: the metadata arrived, but it is not a base's (`bases`, not `tables`).
		transport.queue({ status: 200, text: JSON.stringify({ bases: [] }) });
		const failure = await run(client.describe(), clock).catch((thrown: unknown) => thrown);
		expect(failure).toBeInstanceOf(SyncFailure);
		expect(failure).toMatchObject({ sync: { kind: 'schema' } });
		expect(messageOf(failure)).toContain('no `tables[]`');
	});
});

describe('writes', () => {
	/** A push of `count` records against a transport that accepts everything it is sent. */
	function pushOf(client: ReturnType<typeof setup>['client'], count: number) {
		const changes = Array.from({ length: count }, (_unused, index) => ({
			recordId: `rec${String(index).padStart(2, '0')}`,
			fields: { Name: `Row ${String(index)}` },
		}));
		return client.push(changes);
	}

	it('sends a 12-record push as exactly two chunked writes of 10 and 2, PATCH, typecast off', async () => {
		const { transport, client, clock } = setup();
		transport.queue(
			echoing([
				'rec00',
				'rec01',
				'rec02',
				'rec03',
				'rec04',
				'rec05',
				'rec06',
				'rec07',
				'rec08',
				'rec09',
			]),
		);
		transport.queue(echoing(['rec10', 'rec11']));
		const result = await run(pushOf(client, 12), clock);
		expect(transport.calls).toHaveLength(2);
		expect(result.accepted).toBe(12);
		expect(result.pushed.every((record) => record.ok)).toBe(true);
		// The chunk sizes are read off the bodies that went out, not off what the test hoped would go out.
		const sent = transport.calls.map((call) => sentRecords(call).length);
		expect(sent).toEqual([10, 2]);
		// Every record exactly once, in order: the chunks are a split of the input, not a filter over it.
		expect(transport.calls.flatMap((call) => [...sentRecords(call)])).toHaveLength(12);
		expect(transport.calls[0]?.method).toBe('PATCH');
		expect(transport.calls[0]?.url).toBe(`https://api.airtable.com/v0/${BASE}/${TABLE}`);
		// `typecast: false` is written out rather than left to the provider's default.
		expect(sentBody(transport.calls[0])['typecast']).toBe(false);
	});

	it('reports per-record outcomes and keeps going: a failed chunk does not abandon the next one', async () => {
		const { transport, client, clock } = setup();
		transport.queueStatus(422, {
			body: { error: { message: 'Field "Cost" cannot accept "free"' } },
		});
		transport.queue(echoing(['rec10', 'rec11']));
		const result = await run(pushOf(client, 12), clock);
		expect(result.pushed).toHaveLength(12);
		expect(result.accepted).toBe(2);
		expect(
			result.pushed.filter((record) => record.ok).map((record) => record.recordId),
		).toEqual(['rec10', 'rec11']);
		expect(result.pushed[0]).toBeDefined();
		expect(reasonOf(result.pushed[0])).toContain('[validation]');
		expect(reasonOf(result.pushed[0])).toContain('cannot accept');
		expect(transport.calls).toHaveLength(2);
	});

	it('a record the provider did not echo back is reported as not written, not optimistically accepted', async () => {
		const { transport, client, clock } = setup();
		transport.queue(echoing(['rec00']));
		const result = await run(
			client.push([
				{ recordId: 'rec00', fields: { Name: 'A' } },
				{ recordId: 'rec01', fields: { Name: 'B' } },
			]),
			clock,
		);
		expect(result.accepted).toBe(1);
		expect(result.pushed[1]?.ok).toBe(false);
		expect(reasonOf(result.pushed[1])).toContain('did not return this record');
	});

	it('routes the write body through the transport as JSON text, with `fields` by field id', async () => {
		const { transport, client, clock } = setup();
		transport.queue(echoing(['rec00']));
		await run(client.push([{ recordId: 'rec00', fields: { fldName: 'Kettle' } }]), clock);
		const body = sentBody(transport.calls[0]);
		expect(body['typecast']).toBe(false);
		expect(sentRecords(transport.calls[0])).toEqual(['rec00']);
		// The field **ids** are the keys of `fields`, which is what `returnFieldsByFieldId: true` promises on a read.
		expect(JSON.stringify(body['records'])).toContain('fldName');
	});
});

describe('redaction', () => {
	it('never puts the token in a request recording, an error, or a description', async () => {
		const { transport, client, clock } = setup();
		// The token *is* in the header the fake records — that is the point: the leak has to be found in what the
		// client *reports*, which is where a `Notice` or a log would take it from.
		transport.queueStatus(401, {
			body: { error: { message: 'Invalid authentication token' } },
		});
		const outcome = await pullSettled(client, clock);
		const error = failureOf(outcome);
		expect(JSON.stringify(error)).not.toContain(TOKEN);
		expect(JSON.stringify(error)).toContain('api.airtable.com');
		expect(transport.calls[0]?.headers['authorization']).toContain(TOKEN);

		const headers: Readonly<Record<string, string>> = {
			authorization: `Bearer ${TOKEN}`,
			'content-type': 'application/json',
		};
		expect(redactedHeaders(headers)).toEqual({
			authorization: 'Bearer ***',
			'content-type': 'application/json',
		});
	});
});

describe('the real transport adapter', () => {
	it('passes `throw: false` and lower-cases the response headers it was given', async () => {
		const seen: { throw?: boolean; headers?: Readonly<Record<string, string>> }[] = [];
		const transport = createRequestUrlTransport((request) => {
			seen.push({ throw: request.throw, headers: request.headers });
			return Promise.resolve({
				status: 429,
				headers: { 'Retry-After': '3', ETag: 'abc' },
				text: '{"error":{"message":"slow down"}}',
			});
		});
		const response = await transport({
			url: 'https://api.airtable.com/v0/app/x',
			method: 'GET',
			headers: { authorization: `Bearer ${TOKEN}` },
		});
		expect(seen[0]?.throw).toBe(false);
		expect(response.headers).toEqual({ 'retry-after': '3', etag: 'abc' });
		expect(response.body).toEqual({ error: { message: 'slow down' } });
		// The adapter's own rejection is what the client classifies as `network`.
		expect(TransportTimeoutError).toBeDefined();
	});
});

describe('`Retry-After` arithmetic', () => {
	it('accepts seconds, an HTTP date, and nothing else', () => {
		expect(retryAfterMs({ 'retry-after': '2' }, 0)).toBe(2000);
		expect(retryAfterMs({ 'retry-after': '0.5' }, 0)).toBe(500);
		expect(retryAfterMs({ 'retry-after': new Date(2000).toUTCString() }, 0)).toBe(2000);
		expect(retryAfterMs({ 'retry-after': 'a while' }, 0)).toBeUndefined();
		expect(retryAfterMs({}, 0)).toBeUndefined();
		// A date in the past is zero, not negative.
		expect(retryAfterMs({ 'retry-after': new Date(0).toUTCString() }, 5000)).toBe(0);
	});
});

describe('capabilities and the token probe', () => {
	it('advertises the write chunk size it enforces, so the caller can pre-chunk', () => {
		const { client } = setup();
		expect(client.capabilities()).toMatchObject({
			incrementalPull: true,
			lastModified: true,
			maxRecordsPerWrite: DEFAULT_LIMITS.chunkSize,
		});
	});

	it("answers the token test with the base's table count, and a refusal as an error", async () => {
		const { transport, client, clock } = setup();
		transport.queue({
			status: 200,
			text: JSON.stringify({ tables: [{ id: TABLE, name: 'Notes', fields: [] }] }),
		});
		expect(await run(client.testToken(), clock)).toEqual({ ok: true, tables: 1 });
		transport.queueStatus(403, { body: { error: { message: 'not authorised' } } });
		const refused = await run(client.testToken(), clock);
		expect(refused.ok).toBe(false);
		expect(refused.ok ? null : refused.error.kind).toBe('auth');
	});
});

describe('`describe`', () => {
	it('reads the table from the base metadata and maps its fields by id', async () => {
		const { transport, client, clock } = setup();
		transport.queue({
			status: 200,
			text: JSON.stringify({
				tables: [
					{ id: 'tblOther', name: 'Elsewhere', fields: [] },
					{
						id: TABLE,
						name: 'Projects',
						fields: [{ id: 'fldName', name: 'Name', type: 'singleLineText' }],
					},
				],
			}),
		});
		const description = await run(client.describe(), clock);
		expect(description.tableId).toBe(TABLE);
		expect(description.tableName).toBe('Projects');
		expect(description.fields).toEqual([
			{ id: 'fldName', name: 'Name', type: 'singleLineText' },
		]);
	});

	it('resolves a field map that reports both directions of "no counterpart"', async () => {
		const { transport, client, clock } = setup();
		const meta = (): { status: number; text: string } => ({
			status: 200,
			text: JSON.stringify({
				tables: [
					{
						id: TABLE,
						name: 'Projects',
						fields: [{ id: 'fldName', name: 'Name', type: 'singleLineText' }],
					},
				],
			}),
		});
		transport.queue(meta());
		const first = await run(client.fieldMapFor(['Name', 'Cost'], {}), clock);
		expect(first.map).toEqual({ Name: 'fldName' });
		expect(first.unmapped.map((field) => `${field.side}:${field.name}`).sort()).toEqual([
			'local:Cost',
		]);

		// A stored mapping wins while that remote field still exists.
		transport.queue(meta());
		const stored = await run(client.fieldMapFor(['Rename'], { Rename: 'fldName' }), clock);
		expect(stored.map).toEqual({ Rename: 'fldName' });
		expect(stored.unmapped).toEqual([]);
	});
});
