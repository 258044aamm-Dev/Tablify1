/**
 * The token, as the plugin handles it: **read and written through `SecretStorage`, and visible nowhere else.**
 *
 * The tests here are three kinds, and each answers a different way the promise could break:
 *
 *  1. **The API, quoted.** `TOKEN_SECRET_ID` must satisfy `SecretStorage`'s own rule (*"Lowercase alphanumeric ID
 *     with optional dashes"*, and `setSecret` *"@throws Error if ID is invalid"*), so the id is asserted against that
 *     rule rather than trusted. A test double that swallowed an invalid id would hide a throw that happens on
 *     every real install.
 *  2. **The boundary.** The token lives in the secret store and in nothing else: not in the settings object, not in
 *     the `data.json` the settings store writes, not in the vault. The `data.json` assertion drives the **real**
 *     settings store (`src/plugin/settings/save.ts`), because a grep over a hand-made object would prove nothing.
 *  3. **The action.** "Test the token" must make **no request** without a token, and exactly one probe with one.
 *
 * Everything the module touches is injected: the secret store is a small double, the probe is a one-method stub, and
 * the notice is a recorder. No `obsidian` import, no network, no timers.
 */
import { describe, expect, it } from 'vitest';
import {
	TOKEN_PATTERN,
	TOKEN_SECRET_ID,
	assertNoSecret,
	checkToken,
	clearToken,
	hasToken,
	readToken,
	writeToken,
} from '../../src/plugin/settings/secrets';
import type { SecretHost } from '../../src/plugin/settings/secrets';
import type { SyncError } from '../../src/sync/SyncTarget';
import { createSettingsStore } from '../../src/plugin/settings/save';
import { createFakeClock } from '../fakes/clock';
import { DEFAULT_SETTINGS } from '../../src/plugin/settings/schema';
import type { TablifySettings } from '../../src/plugin/settings/schema';

const TOKEN = 'patTESTTOKENnotarealtoken0001';

/** The smallest thing that can be a `SecretStorage`: three methods and the values they hold. */
function createSecretDouble(): SecretHost & { readonly writes: { id: string; value: string }[] } {
	const secrets = new Map<string, string>();
	const writes: { id: string; value: string }[] = [];
	return {
		writes,
		secretStorage: {
			setSecret(id, secret) {
				if (!/^[a-z0-9-]+$/.test(id)) {
					// `SecretStorage.setSecret` throws on an invalid id; the double throws too, so a bad constant
					// cannot pass a test that a real install would fail.
					throw new Error(`invalid secret id: ${id}`);
				}
				secrets.set(id, secret);
				writes.push({ id, value: secret });
			},
			getSecret: (id) => secrets.get(id) ?? null,
			listSecrets: () => [...secrets.keys()],
		},
	};
}

describe('the secret id', () => {
	it("satisfies `SecretStorage`'s own rule: lowercase alphanumeric with optional dashes", () => {
		expect(TOKEN_SECRET_ID).toBe('tablify-airtable-token');
		expect(TOKEN_SECRET_ID).toMatch(/^[a-z0-9-]+$/);
	});

	it('is the id `setSecret` accepts, and `setSecret` is what the double actually calls', () => {
		const host = createSecretDouble();
		expect(() => host.secretStorage.setSecret(TOKEN_SECRET_ID, TOKEN)).not.toThrow();
		expect(host.secretStorage.listSecrets()).toEqual([TOKEN_SECRET_ID]);
		expect(host.writes).toEqual([{ id: TOKEN_SECRET_ID, value: TOKEN }]);
	});
});

describe('reading and writing the token', () => {
	it('reads from the secret store and nowhere else', () => {
		const host = createSecretDouble();
		expect(readToken(host)).toBeNull();
		host.secretStorage.setSecret(TOKEN_SECRET_ID, TOKEN);
		expect(readToken(host)).toBe(TOKEN);
		expect(hasToken(host)).toBe(true);
	});

	it('answers `null` for an empty secret — a cleared field is not a credential', () => {
		const host = createSecretDouble();
		host.secretStorage.setSecret(TOKEN_SECRET_ID, '');
		expect(readToken(host)).toBeNull();
		host.secretStorage.setSecret(TOKEN_SECRET_ID, '   ');
		expect(readToken(host)).toBeNull();
		expect(hasToken(host)).toBe(false);
	});

	it('trims a pasted token, because a paste arrives with a newline more often than not', () => {
		const host = createSecretDouble();
		expect(writeToken(host, `  ${TOKEN}\n`)).toEqual({ ok: true, reason: null });
		expect(host.secretStorage.getSecret(TOKEN_SECRET_ID)).toBe(TOKEN);
	});

	it('refuses to store an empty token rather than storing a state no caller handles', () => {
		const host = createSecretDouble();
		const result = writeToken(host, '   ');
		expect(result.ok).toBe(false);
		expect(result.reason ?? '').toContain('empty token');
		expect(host.writes).toEqual([]);
	});

	it('clears by storing an empty value — the API has no delete', () => {
		const host = createSecretDouble();
		writeToken(host, TOKEN);
		clearToken(host);
		expect(readToken(host)).toBeNull();
		expect(host.writes.map((write) => write.value)).toEqual([TOKEN, '']);
	});
});

describe('the "test the token" action', () => {
	/** A probe double: records the token it was built with, and answers once with what the test handed it. */
	function createProbe(answer: { ok: true; tables: number } | { ok: false; error: SyncError }) {
		const asked: string[] = [];
		return {
			asked,
			probeFor: (token: string) => ({
				testToken: () => {
					asked.push(token);
					return Promise.resolve(answer);
				},
			}),
		};
	}

	function authError(): SyncError {
		return {
			kind: 'auth',
			message: 'Invalid authentication token',
			request: { method: 'GET', url: 'https://api.airtable.com/v0/meta/bases/appX/tables' },
			status: 401,
		};
	}

	it('makes **no request at all** when no token is stored, and says so', async () => {
		const host = createSecretDouble();
		const probe = createProbe({ ok: true, tables: 3 });
		const said: string[] = [];
		const result = await checkToken({
			host,
			probeFor: probe.probeFor,
			notify: (message) => said.push(message),
		});
		expect(result).toMatchObject({ ok: false, requested: false });
		expect(result.message).toContain('No Airtable token is stored yet');
		expect(probe.asked).toEqual([]);
		expect(said).toEqual([result.message]);
	});

	it('probes with the stored token and reports the table count', async () => {
		const host = createSecretDouble();
		writeToken(host, TOKEN);
		const probe = createProbe({ ok: true, tables: 3 });
		const said: string[] = [];
		const result = await checkToken({
			host,
			probeFor: probe.probeFor,
			notify: (message) => said.push(message),
		});
		expect(probe.asked).toEqual([TOKEN]);
		expect(result.ok).toBe(true);
		expect(result.requested).toBe(true);
		expect(result.message).toBe('Airtable token accepted: the base holds 3 tables.');
		expect(said).toEqual([result.message]);
	});

	it('says "1 table", not "1 tables", and reports a refusal with the typed error in it', async () => {
		const host = createSecretDouble();
		writeToken(host, TOKEN);
		const one = await checkToken({
			host,
			probeFor: createProbe({ ok: true, tables: 1 }).probeFor,
			notify: () => undefined,
		});
		expect(one.message).toBe('Airtable token accepted: the base holds 1 table.');

		const refused = await checkToken({
			host,
			probeFor: createProbe({ ok: false, error: authError() }).probeFor,
			notify: () => undefined,
		});
		expect(refused.ok).toBe(false);
		expect(refused.requested).toBe(true);
		expect(refused.message).toContain('Airtable token refused');
		expect(refused.message).toContain('[auth]');
		expect(refused.message).toContain('Invalid authentication token');
	});

	it('never puts the token in the sentence it shows', async () => {
		const host = createSecretDouble();
		writeToken(host, TOKEN);
		// The refusal the provider would actually send for a token: the message names the header, not the value.
		const result = await checkToken({
			host,
			probeFor: createProbe({ ok: false, error: authError() }).probeFor,
			notify: () => undefined,
		});
		expect(result.message).not.toContain(TOKEN);
		expect(JSON.stringify(result)).not.toContain(TOKEN);
	});
});

describe('the guard against a token reaching settings', () => {
	it('throws when a value about to be saved contains the stored token', () => {
		expect(() => assertNoSecret({ airtable: { token: TOKEN } }, TOKEN)).toThrow(
			/secret storage, not in settings|Refusing to save/,
		);
	});

	it('throws on anything token-shaped, even when the live token is unknown', () => {
		expect(() =>
			assertNoSecret({ note: 'use patABC1234567890 from the team vault' }, null),
		).toThrow(/shaped like an Airtable token/);
	});

	it('finds a token nested in a list, and says nothing about a value that merely mentions "token"', () => {
		expect(() => assertNoSecret({ rows: [{ note: TOKEN }] }, TOKEN)).toThrow(
			/Refusing to save/,
		);
		expect(() =>
			assertNoSecret({ helpText: 'Paste your token here', rows: [1, true, null] }, null),
		).not.toThrow();
	});

	it('recognises the shape of a real personal access token', () => {
		expect(TOKEN_PATTERN.test(TOKEN)).toBe(true);
		expect(TOKEN_PATTERN.test('pat1')).toBe(false);
		expect(TOKEN_PATTERN.test('a pattern')).toBe(false);
	});
});

describe('the token is not a setting, and not in `data.json`', () => {
	/** The settings store writes to whatever port it is given; this one keeps the file in memory. */
	function createPersistence() {
		let file: unknown = null;
		return {
			port: {
				read: () => Promise.resolve(file),
				write: (data: unknown) => {
					file = data;
					return Promise.resolve();
				},
			},
			/** The file as it exists on disk, serialised exactly as `JSON.stringify` would write it. */
			text: () => JSON.stringify(file ?? {}, null, 2),
		};
	}

	it('has no setting path for a token or a secret', () => {
		const paths = Object.keys(DEFAULT_SETTINGS).map((key) => key.toLowerCase());
		expect(paths.some((path) => path.includes('token') || path.includes('secret'))).toBe(false);
	});

	it('writes a `data.json` with no token in it, after a full save cycle', async () => {
		const persistence = createPersistence();
		// The fake clock: `save.ts`'s debounce would otherwise need a real window (this project is `node`).
		const clock = createFakeClock();
		const store = createSettingsStore({
			persistence: persistence.port,
			timers: { setTimer: clock.setTimer, clearTimer: clock.clearTimer },
		});
		await store.load();
		// A few changes, so the file is genuinely written rather than left as the defaults from a cold start.
		store.set('appearance.defaultRowHeight', 'tall');
		store.set('advanced.logLevel', 'warn');
		await store.flush();
		const text = persistence.text();
		expect(store.writeCount()).toBe(1);
		expect(text).toContain('defaultRowHeight');
		expect(text).not.toContain('pat');
		expect(text.toLowerCase()).not.toContain('token');
		expect(text.toLowerCase()).not.toContain('secret');
		// And the guard would have caught it on the way out: the same payload with a token added throws.
		expect(() => assertNoSecret({ ...DEFAULT_SETTINGS, token: TOKEN }, TOKEN)).toThrow();
	});

	it('a settings payload that carried the token would be refused before the write', () => {
		const settings: TablifySettings = { ...DEFAULT_SETTINGS };
		const payload: Record<string, unknown> = { ...settings, airtableToken: TOKEN };
		expect(() => assertNoSecret(payload, TOKEN)).toThrow(/Refusing to save/);
	});
});
