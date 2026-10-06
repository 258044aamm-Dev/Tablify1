/**
 * The Airtable token: **read and written only through `SecretStorage`, and never through settings.**
 *
 * `docs/01` §Sync UX says it in one line — *"the token lives in `SecretStorage`, never in a `.base` file or
 * `data.json`"* — and `docs/09` §the network disclosure says it to users: *"stored in Obsidian's secret storage on
 * your device and is never written into your vault or into any synced file."* Both sentences are promises about
 * what this file must **not** do, so the guard below is the interesting part of it.
 *
 * ## The API, quoted rather than assumed
 *
 * `App.secretStorage` is `@since 1.11.4` (`obsidian.d.ts`), and `SecretStorage` has exactly three methods:
 * `setSecret(id, secret)` (*"@param id Lowercase alphanumeric ID with optional dashes … @throws Error if ID is
 * invalid"*), `getSecret(id): string | null`, and `listSecrets(): string[]`. `minAppVersion` is **1.13.0**, so the
 * API is present on every build this plugin installs on; nothing here needs a `requireApiVersion` guard.
 *
 * ## Why a redaction guard rather than a comment
 *
 * The step asks for a guard that throws when anything tries to serialise the token into settings, and a test that
 * greps for the token's shape in settings and in a `data.json` fixture. A comment cannot fail a build, so
 * {@link assertNoSecret} is called by the settings **save** path: it walks the value about to be written and throws
 * if any string in it matches a token's shape (`pat…`, the prefix the service issues) or the token currently in
 * storage. That way the mistake is caught at the door, in a test, rather than in somebody's synced vault.
 *
 * ## What is not here
 *
 * ## The "test the token" action
 *
 * {@link checkToken} is the one thing here that reaches the network, and it reaches it through a **probe**: a
 * one-method port. That is the difference between a testable action and an action that needs the service to exist.
 * client under `src/sync/` implements the probe with its cheapest endpoint — base metadata, one request, no
 * records — and the action answers with a sentence either way. The
 * `Notice` is injected rather than imported, for the same reason.
 *
 * A **missing token makes no request at all**: the check says so and returns, so a person who has not pasted a token
 * learns nothing about the network from pressing the button.
 */
import type { App } from 'obsidian';
import { errorText } from '../../sync/SyncTarget';
import type { SyncError } from '../../sync/SyncTarget';

/** The one place the secret's id is written. Lower case with dashes: `SecretStorage`'s own id rule. */
export const TOKEN_SECRET_ID = 'tablify-airtable-token';

/**
 * What a personal access token looks like: `pat` followed by a run of base62 characters. The pattern is
 * used for two things — recognising a token somebody pasted into the wrong field, and proving in a test that no
 * token-shaped string reaches `data.json`.
 */
export const TOKEN_PATTERN = /\bpat[A-Za-z0-9]{8,}\b/;

/** The slice of `SecretStorage` this module uses, so a test needs a double for three methods and nothing else. */
export type SecretStorageLike = {
	setSecret(id: string, secret: string): void;
	getSecret(id: string): string | null;
	listSecrets(): string[];
};

/** The app, as far as this module is concerned: it has a `secretStorage`. */
export type SecretHost = {
	readonly secretStorage: SecretStorageLike;
};

/** The real host, from the app. One line, so it is obvious that nothing else is read. */
export function secretHostOf(app: App): SecretHost {
	return { secretStorage: app.secretStorage };
}

/** The token, or `null`. An empty string is `null`: a cleared field is not a credential. */
export function readToken(host: SecretHost): string | null {
	const value = host.secretStorage.getSecret(TOKEN_SECRET_ID);
	return value === null || value.trim() === '' ? null : value.trim();
}

/**
 * Stores a token. Trims it (a pasted token arrives with a newline more often than not) and refuses an empty one
 * rather than storing it — `getSecret` would then answer `''`, and `''` is not a state any caller handles.
 */
export function writeToken(
	host: SecretHost,
	token: string,
): { readonly ok: boolean; readonly reason: string | null } {
	const trimmed = token.trim();
	if (trimmed === '') {
		return {
			ok: false,
			reason: 'An empty token was not stored — paste the token Airtable gives you, or clear it by deleting the value.',
		};
	}
	host.secretStorage.setSecret(TOKEN_SECRET_ID, trimmed);
	return { ok: true, reason: null };
}

/** Forgets the token. `setSecret(id, '')` is how the API expresses removal: there is no `deleteSecret`. */
export function clearToken(host: SecretHost): void {
	host.secretStorage.setSecret(TOKEN_SECRET_ID, '');
}

/** Whether a secret with this id exists, without reading its value — what the settings tab shows. */
export function hasToken(host: SecretHost): boolean {
	return readToken(host) !== null;
}

/**
 * Throws when a value about to be saved contains the token or anything shaped like one.
 *
 * Two checks, because they catch different mistakes: the **shape** catches a pasted token regardless of where it
 * came from, and the **exact value** catches a token that does not match the pattern (a test's `'token-1'`, a
 * future prefix) when it is being written by the person who has it in hand.
 */
export function assertNoSecret(value: unknown, token: string | null, path = 'settings'): void {
	const seen: string[] = [];
	collectStrings(value, seen, path);
	for (const [index, text] of seen.entries()) {
		if (TOKEN_PATTERN.test(text)) {
			throw new Error(
				`Refusing to save: the value at ${String(index)} contains something shaped like an Airtable token. It belongs in secret storage, not in settings.`,
			);
		}
		if (token !== null && text.includes(token)) {
			throw new Error(
				'Refusing to save: the Airtable token is about to be written into settings. It belongs in secret storage, never in `data.json`.',
			);
		}
	}
}

/** Every string inside a value, with its path — so the message can say *where* the token was found. */
function collectStrings(value: unknown, out: string[], path: string): void {
	if (typeof value === 'string') {
		out.push(value);
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			collectStrings(item, out, `${path}[${String(index)}]`);
		});
		return;
	}
	if (typeof value === 'object' && value !== null) {
		for (const [key, member] of Object.entries(Object.fromEntries(Object.entries(value)))) {
			collectStrings(member, out, `${path}.${key}`);
		}
	}
}

/** The cheapest call the provider has, as this action needs it — one method, so the client (or a test) can be it. */
export type TokenProbe = {
	testToken(): Promise<
		| { readonly ok: true; readonly tables: number }
		| { readonly ok: false; readonly error: SyncError }
	>;
};

/** Where the sentence goes. `new Notice(…)` in the plugin; a recorder in a test. */
export type Notifier = (message: string) => void;

/** What {@link checkToken} did, for the caller and the test. The sentence is the same one the Notice carries. */
export type TokenCheck = {
	readonly ok: boolean;
	/** True when the probe was actually called. A missing token means `false`, and no network traffic. */
	readonly requested: boolean;
	readonly message: string;
};

/**
 * The action behind *"Test the token"* in the settings tab.
 *
 * `probeFor` is a function of the token rather than a probe instance because the client is built per test: the token
 * is read at the moment the button is pressed, never captured at startup (a token pasted five seconds ago must be
 * the one used).
 */
export async function checkToken(input: {
	readonly host: SecretHost;
	readonly probeFor: (token: string) => TokenProbe;
	readonly notify: Notifier;
}): Promise<TokenCheck> {
	const token = readToken(input.host);
	if (token === null) {
		const message =
			"No Airtable token is stored yet. Add one in Settings › Tablify › Sync — it is kept in Obsidian's secret storage, never in your vault.";
		input.notify(message);
		return { ok: false, requested: false, message };
	}
	const result = await input.probeFor(token).testToken();
	const message = result.ok
		? result.tables === 1
			? 'Airtable token accepted: the base holds 1 table.'
			: `Airtable token accepted: the base holds ${String(result.tables)} tables.`
		: `Airtable token refused: ${errorText(result.error)}`;
	input.notify(message);
	return { ok: result.ok, requested: true, message };
}
