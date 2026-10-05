/**
 * A fetch-like recorder for the sync work, with no network underneath it.
 *
 * The two failure modes this guards against are the ones that make sync code untestable: a test that
 * accidentally talks to the real API, and a retry/backoff test that depends on wall-clock time. So a
 * request with no queued response throws, and a simulated timeout rejects immediately — determinism over
 * realism, with the realism covered by the step-25 contract tests against fixtures.
 */
import type { Clock } from './clock';

export type TransportResponse = {
	status: number;
	headers?: Record<string, string>;
	body?: unknown;
};

export type TransportRequest = {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
};

export type RecordedRequest = {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | undefined;
	at: number;
	/** The status that was returned, or the error kind, so a test can assert the whole interaction. */
	outcome: 'response' | 'timeout' | 'network-error';
};

/** Thrown by a queued timeout. Sync code must classify it as retryable. */
export class TransportTimeoutError extends Error {
	constructor(url: string) {
		super(`fake transport: timed out contacting ${url}`);
		this.name = 'TransportTimeoutError';
	}
}

/** Thrown by a queued network failure (DNS, TLS, connection reset). */
export class TransportNetworkError extends Error {
	constructor(url: string) {
		super(`fake transport: network error contacting ${url}`);
		this.name = 'TransportNetworkError';
	}
}

export type QueuedResult =
	| { kind: 'response'; response: TransportResponse }
	| { kind: 'timeout' }
	| { kind: 'network-error' };

export type FakeTransport = {
	request(request: TransportRequest): Promise<TransportResponse>;
	calls: RecordedRequest[];
	/** Queue an exact response. */
	queue(response: TransportResponse): void;
	/** Queue `status` with an optional body and headers, e.g. 429 with `retry-after`. */
	queueStatus(
		status: number,
		options?: { headers?: Record<string, string>; body?: unknown },
	): void;
	/** Queue a deterministic timeout. Rejects immediately; the clock does not move. */
	queueTimeout(): void;
	/** Queue a deterministic network failure. */
	queueNetworkError(): void;
	/** How many queued results are still unused. */
	pending(): number;
};

export function createFakeTransport(options: { clock: Clock }): FakeTransport {
	const queued: QueuedResult[] = [];
	const calls: RecordedRequest[] = [];

	const take = (url: string): QueuedResult => {
		const next = queued.shift();
		if (next === undefined) {
			throw new Error(
				`fake transport: no queued response for ${url}. Tests must queue every response — nothing in this project may reach the network in a test.`,
			);
		}
		return next;
	};

	return {
		calls,
		async request(request) {
			const method = request.method ?? 'GET';
			const headers = request.headers ?? {};
			const result = take(request.url);
			const outcome: RecordedRequest['outcome'] =
				result.kind === 'response'
					? 'response'
					: result.kind === 'timeout'
						? 'timeout'
						: 'network-error';
			calls.push({
				url: request.url,
				method,
				headers,
				body: request.body,
				at: options.clock.now(),
				outcome,
			});
			if (result.kind === 'timeout') {
				throw new TransportTimeoutError(request.url);
			}
			if (result.kind === 'network-error') {
				throw new TransportNetworkError(request.url);
			}
			return result.response;
		},
		queue(response) {
			queued.push({ kind: 'response', response });
		},
		queueStatus(status, extra) {
			queued.push({
				kind: 'response',
				response: { status, headers: extra?.headers, body: extra?.body },
			});
		},
		queueTimeout() {
			queued.push({ kind: 'timeout' });
		},
		queueNetworkError() {
			queued.push({ kind: 'network-error' });
		},
		pending: () => queued.length,
	};
}
