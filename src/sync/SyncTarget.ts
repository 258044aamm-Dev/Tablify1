/**
 * The sync port: **what a provider must be able to do, and how it says no.**
 *
 * `docs/02` §Sync states the shape in three lines — *"`SyncTarget` is a port like `RowSource`, so the conflict UI and
 * the queue are provider-agnostic"*, pull is "records → per-field diff against local values → user decision → ops",
 * push is "local values → batch endpoints in chunks of 10 with retry/backoff". This file is those lines as types,
 * with **no provider in them**: no base id, no `fields` object, no HTTP status in the interface's vocabulary — the
 * provider's own client implements this, and the conflict review (step 26) consumes it.
 *
 * ## The error union, and why every kind carries a retry policy
 *
 * The step's rule: *"typed errors with a documented retry policy per kind"*. A retry policy that lives in the
 * catch block is a policy nobody can read; here it is a table ({@link RETRY_POLICIES}) next to the kinds, and
 * {@link retryDelayFor} is the only function that decides a delay — with jitter, because a thousand users retrying
 * in lockstep is a second outage.
 *
 * | Kind | Retry | Why |
 * |---|---|---|
 * | `auth` | never | A token that is wrong stays wrong. The fix is a person, and the message says so. |
 * | `rateLimit` | until the attempt cap, honouring `Retry-After` | The provider told us when to come back. |
 * | `network` | until the attempt cap, exponential with jitter | 5xx and a dropped socket are the same problem. |
 * | `schema` | never | A response we do not recognise will not become recognisable by asking again. |
 * | `validation` | never | The provider refused *our* data; the data is what has to change. |
 *
 * ## Redaction is a property of the type, not a habit
 *
 * Every error carries the request that produced it, and {@link describeRequest} has redacted the token before the
 * error is built — the header is replaced with `Bearer ***`. The client's own test asserts the
 * absence of the token in every error it can produce, which is the only way this stays true as the file grows.
 */

/** The five ways a sync operation can fail, in the vocabulary the UI speaks. */
export type SyncErrorKind = 'auth' | 'rateLimit' | 'network' | 'schema' | 'validation';

/** What was asked of the provider, with the credential already replaced. */
export type SyncRequest = {
	readonly method: string;
	readonly url: string;
};

export type SyncError = {
	readonly kind: SyncErrorKind;
	/** One sentence, safe to show: no token, no truncated JSON, no stack. */
	readonly message: string;
	/** Where it happened, when there was a request. */
	readonly request?: SyncRequest | undefined;
	/** The HTTP status, when there was one. */
	readonly status?: number | undefined;
	/** How long the provider asked us to wait (`Retry-After`), when it did. */
	readonly retryAfterMs?: number | undefined;
};

/**
 * The five kinds as **named types**, so a caller can write `AuthError` and mean it.
 *
 * Same values as {@link SyncError}, narrowed by `kind` — a discriminated union you can `switch` on and get
 * exhaustiveness from, rather than five unrelated interfaces that a `catch` has to guess between. The names are the
 * ones the step asks for; the single object shape is what keeps `errorText`, the redaction rule and the retry table
 * from having five copies.
 */
export type AuthError = SyncError & { readonly kind: 'auth' };
export type RateLimitError = SyncError & { readonly kind: 'rateLimit' };
export type NetworkError = SyncError & { readonly kind: 'network' };
export type SchemaError = SyncError & { readonly kind: 'schema' };
export type ValidationError = SyncError & { readonly kind: 'validation' };
/** Every kind, named — the union above is `SyncError`, and this is the alias for code that wants to say so. */
export type AnySyncError =
	AuthError | RateLimitError | NetworkError | SchemaError | ValidationError;

/** What a kind's retry looks like. `attempts` counts the *first* try, so 1 means "never retry". */
export type RetryPolicy = {
	readonly attempts: number;
	readonly baseDelayMs: number;
	readonly jitter: boolean;
	readonly honourRetryAfter: boolean;
};

/** The table. Read it before changing a number here: the reason column is in the file's header. */
export const RETRY_POLICIES: Readonly<Record<SyncErrorKind, RetryPolicy>> = Object.freeze({
	auth: { attempts: 1, baseDelayMs: 0, jitter: false, honourRetryAfter: false },
	rateLimit: { attempts: 5, baseDelayMs: 1000, jitter: true, honourRetryAfter: true },
	network: { attempts: 4, baseDelayMs: 500, jitter: true, honourRetryAfter: true },
	schema: { attempts: 1, baseDelayMs: 0, jitter: false, honourRetryAfter: false },
	validation: { attempts: 1, baseDelayMs: 0, jitter: false, honourRetryAfter: false },
});

/** A stable, comparable form of a failure, so a test and the UI can name it without the stack. */
export function errorText(error: SyncError): string {
	const where =
		error.request === undefined ? '' : ` (${error.request.method} ${error.request.url})`;
	return `[${error.kind}]${where} ${error.message}`;
}

/**
 * A {@link SyncError} as a real `Error`, for the two port methods that answer with a value or fail.
 *
 * A promise rejection carrying a plain object is a stack trace nobody can read, so the failure is an `Error` — with
 * the typed error on {@link SyncFailure.sync}, which is the form the UI switches on. `cause` is not used: it
 * arrived in ES2022 and this build targets ES2018 (`tsconfig.json`), so the field is part of the class instead of
 * part of the platform.
 */
export class SyncFailure extends Error {
	readonly sync: SyncError;

	constructor(error: SyncError) {
		super(errorText(error));
		this.name = 'SyncFailure';
		this.sync = error;
	}
}

/**
 * The delay before attempt **n + 1**, or `null` when there must not be one.
 *
 * `attempt` is 1-based and counts the try that just failed. Exponential with full jitter (`random()` in `[0, 1)`),
 * capped at 30 s, and `Retry-After` — when the provider sent one and the kind honours it — wins over the curve.
 */
export function retryDelayFor(
	error: SyncError,
	attempt: number,
	random: () => number = Math.random,
): number | null {
	const policy = RETRY_POLICIES[error.kind];
	if (attempt >= policy.attempts) {
		return null;
	}
	if (policy.honourRetryAfter && error.retryAfterMs !== undefined) {
		return Math.min(error.retryAfterMs, 30_000);
	}
	if (!policy.jitter) {
		return policy.baseDelayMs;
	}
	const ceiling = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), 30_000);
	return Math.round(ceiling * random());
}

/** A provider's own description of the link, for the UI's header and for the link file. */
export type TargetDescription = {
	readonly baseId: string;
	readonly baseName: string;
	readonly tableId: string;
	readonly tableName: string;
	/** The remote fields, by id, so the mapping resolver can report what has no local counterpart. */
	readonly fields: readonly {
		readonly id: string;
		readonly name: string;
		readonly type: string;
		/** For a link field: the remote table it points to. Absent for every other field. */
		readonly linkedTableId?: string;
	}[];
};

/**
 * What a provider promises. Deliberately **four methods and no more**: there is no `delete` — `docs/01`
 * §Sync UX: *"Records deleted remotely are never silently deleted locally"* and `docs/08` §P9 keeps the remote
 * schema untouched — so the port offers no way to express either.
 */
export type SyncTarget = {
	/** The link's identity and the remote field list. One request, cached by the caller. */
	describe(): Promise<TargetDescription>;
	/** Records changed since `since` (an ISO instant, or `null` for everything the caps allow). */
	pull(since: string | null): Promise<PullResult>;
	/** Writes local values for existing remote records. Creates nothing, deletes nothing. */
	push(changes: readonly PushChange[]): Promise<PushResult>;
	/** What the provider can do, so the UI does not offer what it cannot. */
	capabilities(): SyncCapabilities;
};

export type SyncCapabilities = {
	/** Whether a date filter narrows a pull. `false` means every pull is a full read (within the caps). */
	readonly incrementalPull: boolean;
	/** The largest number of records one write may carry. */
	readonly maxRecordsPerWrite: number;
	/** True when the provider can report a record's last-modified time. */
	readonly lastModified: boolean;
};

/** One remote record, as the port sees it: an id and the field values keyed by **remote field id**. */
export type RemoteRecord = {
	readonly id: string;
	/** Field values by remote field id, exactly as the provider returned them. */
	readonly fields: Readonly<Record<string, unknown>>;
	/** The provider's own last-modified stamp, when it has one. */
	readonly modifiedAt?: string | undefined;
};

export type PullResult = {
	readonly records: readonly RemoteRecord[];
	/** The instant this read is good as of: the next `pull(since)` starts here. */
	readonly pulledAt: string;
	/** True when the caps stopped the read early — reported, never silent (`docs/01` §Sync UX's spirit). */
	readonly truncated: boolean;
};

/** One local value to write to an existing remote record. */
export type PushChange = {
	readonly recordId: string;
	/** Values by remote field id. A property with no mapping is skipped before this is built. */
	readonly fields: Readonly<Record<string, unknown>>;
};

/** One record's outcome inside a push: what landed, and what the provider refused. */
export type PushedRecord =
	| { readonly ok: true; readonly recordId: string }
	| { readonly ok: false; readonly recordId: string; readonly reason: string };

export type PushResult = {
	readonly pushed: readonly PushedRecord[];
	readonly pushedAt: string;
	/** Records the provider accepted. Always `pushed.filter(ok).length` — computed once, in the client. */
	readonly accepted: number;
};

/** A value that has no mapping: reported by {@link resolveFieldMap}, never written. */
export type UnmappedField = {
	/** `'local'` for a property with no remote field, `'remote'` for a remote field nothing writes. */
	readonly side: 'local' | 'remote';
	readonly name: string;
};

/**
 * The field mapping: **local property name → remote field id** (`docs/03` §Sync state's `fieldMap`).
 *
 * Both directions of "no counterpart" are reported, because `docs/03` §Sync behaviour requires it — *"Field with
 * no remote counterpart | Skipped, reported once per sync"* — and `docs/08` §P9 forbids inventing the counterpart
 * remotely. A resolver that only reported missing locals would silently drop a local property every sync.
 */
export function resolveFieldMap(
	local: readonly string[],
	remote: readonly { readonly id: string; readonly name: string }[],
	existing: Readonly<Record<string, string>>,
): {
	readonly map: Readonly<Record<string, string>>;
	readonly unmapped: readonly UnmappedField[];
} {
	// A mapping already in the link file wins when its remote field still exists: a rename at the provider keeps the
	// field's id, so the stored id is the only mapping that survives one.
	const remoteById = new Map(remote.map((field) => [field.id, field]));
	const remoteByName = new Map(remote.map((field) => [field.name, field]));
	const map: Record<string, string> = {};
	const unmapped: UnmappedField[] = [];
	for (const name of local) {
		const kept = existing[name];
		if (kept !== undefined && remoteById.has(kept)) {
			map[name] = kept;
			continue;
		}
		const match = remoteByName.get(name);
		if (match === undefined) {
			unmapped.push({ side: 'local', name });
			continue;
		}
		map[name] = match.id;
	}
	const claimed = new Set(Object.values(map));
	for (const field of remote) {
		if (!claimed.has(field.id)) {
			unmapped.push({ side: 'remote', name: field.name });
		}
	}
	return { map, unmapped };
}
