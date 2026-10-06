/**
 * The Airtable client: **the only file in the plugin that speaks to `api.airtable.com`.**
 *
 * It implements {@link SyncTarget} and nothing else — the port is provider-agnostic on purpose (`docs/02` §Sync) —
 * so this is where every Airtable fact is allowed to live. Five rules shape it, each one a sentence from the docs
 * or from the platform:
 *
 *  1. **Pagination terminates.** Airtable pages with `offset`; a buggy or hostile server can page forever, so the
 *     read stops at {@link DEFAULT_LIMITS}'s `maxPages` (and therefore `maxPages × pageSize` records) and reports
 *     `truncated: true` rather than presenting a partial read as complete — the one failure a sync cannot recover
 *     from, because the missing records look deleted.
 *  2. **Retries are the port's table, not a `catch` block.** {@link retryDelayFor} decides the delay per error kind,
 *     with jitter and honouring `Retry-After`; this file only counts attempts.
 *  3. **Writes are chunked at 10 and a failure is reported per record.** `docs/02` §Sync: *"`PATCH /records` in
 *     chunks of 10 with retry/backoff"*; `docs/01` §Sync UX promises a visible count of what was written, and one
 *     lumped failure cannot produce one.
 *  4. **Every response is validated before use.** A shape error is a `schema` error naming what was wrong — never a
 *     crash, and never a silent `undefined` travelling on as a value. Nothing here is `any`: a body is parsed as
 *     `unknown` and walked.
 *  5. **No deletes and no schema writes.** The port has no delete, and the only write this file sends is `PATCH` to
 *     `/records` for records that already exist (`docs/08` §P9, *"Airtable schema is never modified"*).
 *
 * **The caps**, with their reasons:
 *
 * | Cap | Value | Why |
 * |---|---|---|
 * | `pageSize` | 100 | Airtable's own maximum for `GET /records`; a smaller page multiplies round trips. |
 * | `maxPages` | 50 | 5,000 records is far past what a notes-backed view should hold, and the cap is the promise that a wrong `offset` cannot loop forever. |
 * | `chunkSize` | 10 | `docs/02` §Sync, and Airtable's own documented limit for one `PATCH`. |
 * | `maxSeconds` | 30 | The ceiling on any backoff, `Retry-After` included: past half a minute a person should be told, not left waiting. |
 *
 * **What is deliberately not here: creates.** `push` writes to existing records only. Where a local note has no
 * `recordMap` entry, the caller decides (step 26's review), and this client offers no API that could guess.
 */
import { errorText, retryDelayFor, resolveFieldMap, SyncFailure } from '../SyncTarget';
import { headersFor, retryAfterMs } from './transport';
import type { Transport, TransportRequest } from './transport';
import type {
	PullResult,
	PushChange,
	PushedRecord,
	PushResult,
	RemoteRecord,
	SyncCapabilities,
	SyncError,
	SyncErrorKind,
	SyncRequest,
	SyncTarget,
	TargetDescription,
	UnmappedField,
} from '../SyncTarget';

/**
 * The documented caps. Every one of them is in the header table with its reason.
 *
 * The shape is written out rather than inferred: `Object.freeze` alone would give each member a **literal** type, and
 * `Partial<typeof DEFAULT_LIMITS>` would then refuse `{maxPages: 3}` in a test — an inferred type making an
 * overridable option unoverridable.
 */
export type SyncLimits = {
	/** Airtable's own page maximum for `GET /records`. */
	readonly pageSize: number;
	/** 50 pages × 100 records = 5,000 records, and the promise that a wrong `offset` cannot loop forever. */
	readonly maxPages: number;
	/** `docs/02` §Sync: *"batch endpoints in chunks of 10"*. */
	readonly chunkSize: number;
	/** The ceiling on any single backoff, `Retry-After` included. */
	readonly maxSeconds: number;
};

export const DEFAULT_LIMITS: SyncLimits = Object.freeze({
	pageSize: 100,
	maxPages: 50,
	chunkSize: 10,
	maxSeconds: 30,
});

export const API_ROOT = 'https://api.airtable.com/v0';
export const META_ROOT = 'https://api.airtable.com/v0/meta/bases';

/** Everything the client needs. The token is a parameter — it is read from `SecretStorage` by the caller. */
export type AirtableClientOptions = {
	readonly token: string;
	readonly baseId: string;
	readonly tableId: string;
	readonly transport: Transport;
	/** The clock, for `pulledAt`/`pushedAt` and for `Retry-After` arithmetic. */
	readonly now?: (() => number) | undefined;
	/** The sleeper, so a test's backoff is instant. Defaults to the document window's timer. */
	readonly sleep?: ((ms: number) => Promise<void>) | undefined;
	/** `[0, 1)` — the jitter source, injected so a test's delays are exact. */
	readonly random?: (() => number) | undefined;
	readonly limits?: Partial<SyncLimits> | undefined;
};

/** What the client is: the port, plus the two calls the settings UI makes. */
export type AirtableClient = SyncTarget & {
	/** `GET /meta/bases/{baseId}/tables` — the cheapest call that proves a token works. */
	testToken(): Promise<
		| { readonly ok: true; readonly tables: number }
		| { readonly ok: false; readonly error: SyncError }
	>;
	/** The field mapping for a set of local property names, with both directions of "no counterpart". */
	fieldMapFor(
		local: readonly string[],
		existing: Readonly<Record<string, string>>,
	): Promise<{
		readonly map: Readonly<Record<string, string>>;
		readonly unmapped: readonly UnmappedField[];
	}>;
};

/** The request, with the credential already replaced: what every error carries. */
function describeRequest(request: TransportRequest): SyncRequest {
	return { method: request.method, url: request.url };
}

function syncError(
	kind: SyncErrorKind,
	message: string,
	request: TransportRequest,
	status?: number,
	retryAfter?: number,
): SyncError {
	return {
		kind,
		message,
		request: describeRequest(request),
		...(status === undefined ? {} : { status }),
		...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
	};
}

/** Classifies a non-2xx response. The status is Airtable's; the kinds are the port's vocabulary. */
export function classify(
	status: number,
	message: string,
	request: TransportRequest,
	after?: number,
): SyncError {
	if (status === 401 || status === 403) {
		return syncError('auth', message, request, status);
	}
	if (status === 429) {
		return syncError('rateLimit', message, request, status, after);
	}
	if (status === 400 || status === 422) {
		return syncError('validation', message, request, status);
	}
	if (status === 0 || status >= 500) {
		return syncError('network', message, request, status, after);
	}
	return syncError('validation', message, request, status);
}

/** Airtable's error body: `{error: {type, message}}`. Anything else is summarised, never quoted raw. */
export function messageFrom(response: {
	readonly body?: unknown;
	readonly text?: string | undefined;
}): string {
	const body = objectOf(response.body);
	const error = body === null ? null : objectOf(body['error']);
	const message = error === null ? undefined : error['message'];
	if (typeof message === 'string') {
		return message;
	}
	if (response.text !== undefined && response.text !== '') {
		// A body that did not parse (an HTML error page from a proxy, say) is answered with its length, never with
		// markup: this string ends up in a `Notice`.
		return `the server sent ${String(response.text.length)} bytes that were not JSON`;
	}
	return 'the server sent an error without a message';
}

/**
 * The response body, however the transport chose to deliver it.
 *
 * `body` when the transport parsed it (the real `requestUrl` adapter does, and `tests/fakes/transport.ts`'s text
 * fixtures do not), otherwise `text` parsed here. `undefined` when neither works — which every validator in this file
 * already treats as *"not the shape I expected"*, i.e. a `schema` error rather than a crash.
 */
function bodyOf(response: {
	readonly body?: unknown;
	readonly text?: string | undefined;
}): unknown {
	if (response.body !== undefined) {
		return response.body;
	}
	if (response.text === undefined || response.text === '') {
		return undefined;
	}
	try {
		return JSON.parse(response.text);
	} catch {
		return undefined;
	}
}

/** Reads a value as an object of `unknown`s, or `null`. The one reader every validator in this file goes through. */
function objectOf(value: unknown): Readonly<Record<string, unknown>> | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return null;
	}
	return Object.fromEntries(Object.entries(value));
}

/** One remote record off the wire, or `null` when the shape is not Airtable's (which becomes a `schema` error). */
function recordOf(value: unknown): RemoteRecord | null {
	const record = objectOf(value);
	if (record === null) {
		return null;
	}
	const id = record['id'];
	if (typeof id !== 'string') {
		return null;
	}
	const rawFields = record['fields'];
	const values = rawFields === undefined ? {} : objectOf(rawFields);
	if (values === null) {
		return null;
	}
	const created = record['createdTime'];
	return { id, fields: values, ...(typeof created === 'string' ? { modifiedAt: created } : {}) };
}

/** A `GET /records` page. */
function pageOf(value: unknown): {
	readonly records: readonly RemoteRecord[];
	readonly offset: string | null;
} | null {
	const page = objectOf(value);
	if (page === null) {
		return null;
	}
	const raw = page['records'];
	if (!Array.isArray(raw)) {
		return null;
	}
	const records: RemoteRecord[] = [];
	for (const item of raw) {
		const record = recordOf(item);
		if (record === null) {
			return null;
		}
		records.push(record);
	}
	const offset = page['offset'];
	return { records, offset: typeof offset === 'string' ? offset : null };
}

export function createAirtableClient(options: AirtableClientOptions): AirtableClient {
	const limits = { ...DEFAULT_LIMITS, ...options.limits };
	const now = options.now ?? ((): number => Date.now());
	const random = options.random ?? Math.random;
	const sleep =
		options.sleep ??
		((ms: number): Promise<void> =>
			new Promise((resolve) => {
				document.defaultView?.setTimeout(resolve, ms);
			}));

	/**
	 * One call, with the retry table applied. Answers with the response or with an already-classified error, and it
	 * **never throws** — every caller's next move is a sentence rather than a stack trace.
	 */
	async function call(request: TransportRequest): Promise<
		| {
				readonly ok: true;
				readonly response: { readonly status: number; readonly body: unknown };
		  }
		| { readonly ok: false; readonly error: SyncError }
	> {
		let attempt = 1;
		for (;;) {
			let response: {
				readonly status: number;
				readonly headers?: Readonly<Record<string, string>> | undefined;
				readonly body?: unknown;
				readonly text?: string | undefined;
			};
			try {
				response = await options.transport(request);
			} catch (thrown) {
				// A rejected transport is a dropped socket or a timeout — `tests/fakes/transport.ts` throws exactly
				// these two — so it is the `network` kind: retried per the policy, and reported with the message the
				// transport gave rather than a stack.
				response = {
					status: 0,
					body: undefined,
					text: thrown instanceof Error ? thrown.message : String(thrown),
				};
			}
			if (response.status >= 200 && response.status < 300) {
				return { ok: true, response: { status: response.status, body: bodyOf(response) } };
			}
			const after = retryAfterMs(response.headers ?? {}, now());
			const error = classify(response.status, messageFrom(response), request, after);
			const delay = retryDelayFor(error, attempt, random);
			if (delay === null) {
				return { ok: false, error };
			}
			attempt += 1;
			await sleep(Math.min(delay, limits.maxSeconds * 1000));
		}
	}

	/** One page of records. `since` narrows the read with Airtable's own `LAST_MODIFIED_TIME()` formula. */
	async function fetchPage(
		offset: string | null,
		since: string | null,
	): Promise<
		| {
				readonly ok: true;
				readonly page: {
					readonly records: readonly RemoteRecord[];
					readonly offset: string | null;
				};
		  }
		| { readonly ok: false; readonly error: SyncError }
	> {
		const query: string[] = [
			`pageSize=${String(limits.pageSize)}`,
			'returnFieldsByFieldId=true',
		];
		if (offset !== null) {
			query.push(`offset=${encodeURIComponent(offset)}`);
		}
		if (since !== null) {
			// `LAST_MODIFIED_TIME()` is the field Airtable exposes for exactly this, and it takes a literal, so the
			// instant is quoted; Airtable compares date strings in ISO order, which is why an ISO instant works.
			query.push(
				`filterByFormula=${encodeURIComponent(`LAST_MODIFIED_TIME() > '${since}'`)}`,
			);
		}
		const request: TransportRequest = {
			url: `${API_ROOT}/${options.baseId}/${options.tableId}?${query.join('&')}`,
			method: 'GET',
			headers: headersFor(options.token),
		};
		const result = await call(request);
		if (!result.ok) {
			return { ok: false, error: result.error };
		}
		const page = pageOf(result.response.body);
		if (page === null) {
			return {
				ok: false,
				error: syncError(
					'schema',
					'the response did not look like Airtable records (`records[]`, each with `id` and `fields`)',
					request,
					result.response.status,
				),
			};
		}
		return { ok: true, page };
	}

	/** The parts of `GET /meta/bases/{id}/tables` this plugin uses. */
	async function describeRequest(
		request: TransportRequest,
	): Promise<
		| { readonly ok: true; readonly description: TargetDescription }
		| { readonly ok: false; readonly error: SyncError }
	> {
		const result = await call(request);
		if (!result.ok) {
			return { ok: false, error: result.error };
		}
		const body = objectOf(result.response.body);
		const tables = body === null ? null : body['tables'];
		if (!Array.isArray(tables)) {
			return {
				ok: false,
				error: syncError(
					'schema',
					'the base metadata had no `tables[]`',
					request,
					result.response.status,
				),
			};
		}
		for (const entry of tables) {
			const table = objectOf(entry);
			if (table === null || table['id'] !== options.tableId) {
				continue;
			}
			const fields: { id: string; name: string; type: string }[] = [];
			const rawFields = table['fields'];
			if (Array.isArray(rawFields)) {
				for (const raw of rawFields) {
					const field = objectOf(raw);
					const id = field === null ? undefined : field['id'];
					const name = field === null ? undefined : field['name'];
					const type = field === null ? undefined : field['type'];
					if (typeof id === 'string' && typeof name === 'string') {
						fields.push({
							id,
							name,
							type: typeof type === 'string' ? type : 'unknown',
						});
					}
				}
			}
			return {
				ok: true,
				description: {
					baseId: options.baseId,
					// Airtable's table list does not carry the base's name, so the id stands in until the caller has
					// a better one (the link file keeps the name a person chose).
					baseName: '',
					tableId: options.tableId,
					tableName: typeof table['name'] === 'string' ? table['name'] : options.tableId,
					fields,
				},
			};
		}
		return {
			ok: false,
			error: syncError(
				'schema',
				`the base has no table with id “${options.tableId}”`,
				request,
				result.response.status,
			),
		};
	}

	const metaRequest = (): TransportRequest => ({
		url: `${META_ROOT}/${options.baseId}/tables`,
		method: 'GET',
		headers: headersFor(options.token),
	});

	const client: AirtableClient = {
		capabilities(): SyncCapabilities {
			return {
				incrementalPull: true,
				maxRecordsPerWrite: limits.chunkSize,
				lastModified: true,
			};
		},

		async describe(): Promise<TargetDescription> {
			const result = await describeRequest(metaRequest());
			if (!result.ok) {
				// `describe` is one of the two methods that answer with a value or fail: it runs before anything
				// is shown, and a link whose target cannot be described is not a link. `SyncFailure` carries the
				// typed error for the UI to switch on.
				throw new SyncFailure(result.error);
			}
			return result.description;
		},

		async fieldMapFor(local, existing) {
			const description = await client.describe();
			return resolveFieldMap(local, description.fields, existing);
		},

		async pull(since: string | null): Promise<PullResult> {
			const records: RemoteRecord[] = [];
			let offset: string | null = null;
			let pages = 0;
			let truncated = false;
			for (;;) {
				const result = await fetchPage(offset, since);
				if (!result.ok) {
					throw new SyncFailure(result.error);
				}
				records.push(...result.page.records);
				pages += 1;
				const next = result.page.offset;
				if (next === null) {
					break;
				}
				if (pages >= limits.maxPages) {
					truncated = true;
					break;
				}
				offset = next;
			}
			return { records, pulledAt: new Date(now()).toISOString(), truncated };
		},

		async push(changes: readonly PushChange[]): Promise<PushResult> {
			const pushed: PushedRecord[] = [];
			for (let start = 0; start < changes.length; start += limits.chunkSize) {
				const chunk = changes.slice(start, start + limits.chunkSize);
				const request: TransportRequest = {
					url: `${API_ROOT}/${options.baseId}/${options.tableId}`,
					method: 'PATCH',
					headers: headersFor(options.token),
					// `typecast: false` is Airtable's default, written out on purpose: the plugin never asks the
					// provider to coerce a value, because a coerced value is a value the user did not type.
					body: JSON.stringify({
						typecast: false,
						records: chunk.map((change) => ({
							id: change.recordId,
							fields: change.fields,
						})),
					}),
				};
				const result = await call(request);
				if (!result.ok) {
					// A failed chunk is reported **per record** so the caller can state exactly which rows did not
					// land, and the remaining chunks still run: one bad value must not abandon a 200-row push.
					for (const change of chunk) {
						pushed.push({
							ok: false,
							recordId: change.recordId,
							reason: errorText(result.error),
						});
					}
					continue;
				}
				const body = objectOf(result.response.body);
				if (body === null) {
					const error = syncError(
						'schema',
						'the write response was not an object',
						request,
						result.response.status,
					);
					for (const change of chunk) {
						pushed.push({
							ok: false,
							recordId: change.recordId,
							reason: errorText(error),
						});
					}
					continue;
				}
				const raw = body === null ? null : body['records'];
				const accepted = new Set<string>();
				if (Array.isArray(raw)) {
					for (const item of raw) {
						const record = objectOf(item);
						const id = record === null ? undefined : record['id'];
						if (typeof id === 'string') {
							accepted.add(id);
						}
					}
				}
				for (const change of chunk) {
					pushed.push(
						accepted.has(change.recordId)
							? { ok: true, recordId: change.recordId }
							: {
									ok: false,
									recordId: change.recordId,
									reason: 'Airtable accepted the request but did not return this record — it may have been deleted remotely.',
								},
					);
				}
			}
			return {
				pushed,
				pushedAt: new Date(now()).toISOString(),
				accepted: pushed.filter((record) => record.ok).length,
			};
		},

		async testToken() {
			const request = metaRequest();
			const result = await call(request);
			if (!result.ok) {
				return { ok: false, error: result.error };
			}
			const body = objectOf(result.response.body);
			if (body === null) {
				return {
					ok: false,
					error: syncError(
						'schema',
						'the token test got a response that was not JSON',
						request,
					),
				};
			}
			const tables = body['tables'];
			return { ok: true, tables: Array.isArray(tables) ? tables.length : 0 };
		},
	};
	return client;
}
