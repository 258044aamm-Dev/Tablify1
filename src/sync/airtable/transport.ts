/**
 * The HTTP edge: **one function, and the types the client exchanges with it.**
 *
 * `docs/02` §Sync and the plugin-review rules both point the same way — all network traffic goes through Obsidian's
 * `requestUrl`, never `fetch` — so this file exists to keep that fact in exactly one place. The client above it
 * takes a {@link Transport} port, which is what makes every other line of the sync path testable without a network
 * (`tests/fakes/transport.ts` is the double, and it throws if a test forgets to queue a response).
 *
 * Two details here are load-bearing rather than incidental:
 *
 *   · **`throw: false`.** `requestUrl`'s default is to *reject* on a 400+, which would throw away the status and the
 *     headers — the two things the retry table is built from. With it off, a 429 arrives with its `Retry-After` and
 *     a 500 arrives as a status rather than as an exception (`RequestUrlParam.throw`, `obsidian.d.ts`).
 *   · **Header names are lower-cased on the way in.** Servers spell `Retry-After`, `retry-after` and `Retry-after`;
 *     a lookup that depends on which one this provider chose is a bug waiting for a different provider.
 */
import type { SyncError } from '../SyncTarget';

/** One HTTP call, as the client needs it. Mirrors `requestUrl`'s own fields, minus everything unused. */
export type TransportRequest = {
	readonly url: string;
	/** Upper case, so a recorded call reads the way an HTTP log does in a test: `GET`, `PATCH`. */
	readonly method: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body?: string | undefined;
};

/**
 * What comes back. `body` is **parsed**, not text: the transport is the layer that knows JSON, and every validator
 * above works on `unknown` anyway — so the shape here matches `tests/fakes/transport.ts`'s own `TransportResponse`,
 * which is the fake the whole sync path is tested against. `text` is optional and only kept for an error message
 * ("the server sent 431 bytes that were not JSON").
 */
export type TransportResponse = {
	readonly status: number;
	/** Lower-cased names. `status: 0` means "the request never completed". */
	readonly headers?: Readonly<Record<string, string>> | undefined;
	readonly body?: unknown;
	readonly text?: string | undefined;
};

/**
 * The transport port. It may **reject** — `tests/fakes/transport.ts` throws `TransportTimeoutError` and
 * `TransportNetworkError`, which is how a dropped socket is simulated — and the client classifies a rejection as a
 * `network` error, which is the retryable kind.
 */
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

/** Every request the client sends carries this, built in one place so a token cannot leak through a second path. */
export function headersFor(
	token: string,
	extra: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
	return { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra };
}

/** `Authorization: Bearer ***` — the only form of the header that is ever written down or reported. */
export function redactedHeaders(
	headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		out[name] = name.toLowerCase() === 'authorization' ? 'Bearer ***' : value;
	}
	return out;
}

/**
 * Milliseconds from a `Retry-After` header, which the HTTP specification allows to be **either** a number of
 * seconds or an HTTP date — so both are read, and anything else answers `undefined` rather than `NaN`.
 */
export function retryAfterMs(
	headers: Readonly<Record<string, string>>,
	now: number,
): number | undefined {
	const raw = headers['retry-after'];
	if (raw === undefined) {
		return undefined;
	}
	const seconds = Number(raw);
	if (Number.isFinite(seconds)) {
		return Math.max(0, Math.round(seconds * 1000));
	}
	const date = Date.parse(raw);
	return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * The real transport: Obsidian's `requestUrl`, injected rather than imported.
 *
 * Injected because this module then compiles and its tests run with no `obsidian` module present, and because the
 * composition root is the only place that should know the app exists. `requestUrl` is `@since 0.12.8`
 * (`obsidian.d.ts`), which `minAppVersion: 1.13.0` is comfortably past.
 */
export type RequestUrlLike = (request: {
	readonly url: string;
	readonly method: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body?: string | undefined;
	readonly throw: false;
}) => Promise<{
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly text: string;
}>;

export function createRequestUrlTransport(requestUrl: RequestUrlLike): Transport {
	return async (request) => {
		const response = await requestUrl({
			url: request.url,
			method: request.method,
			headers: request.headers,
			...(request.body === undefined ? {} : { body: request.body }),
			throw: false,
		});
		const headers: Record<string, string> = {};
		for (const [name, value] of Object.entries(response.headers)) {
			headers[name.toLowerCase()] = value;
		}
		// The body is parsed here, once, and a body that does not parse is `undefined` — which the client reports as
		// a `schema` error naming the byte count rather than crashing on a `JSON.parse` inside a validator.
		let body: unknown;
		try {
			body = JSON.parse(response.text);
		} catch {
			body = undefined;
		}
		return { status: response.status, headers, body, text: response.text };
	};
}

/** A `SyncError`'s URL with the token nowhere in it — the client's own error builder, shared with the tests. */
export function requestSummary(error: SyncError): string {
	return error.request === undefined
		? '(no request)'
		: `${error.request.method} ${error.request.url}`;
}
