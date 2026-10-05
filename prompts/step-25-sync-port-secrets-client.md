Task: build the sync foundation — the token stored in `SecretStorage` only, the `SyncTarget` port, the link
store, and an Airtable client with pagination, backoff, typed errors and chunked writes. Isolated so it can
never destabilise the grid, and dynamically imported so startup never pays for it.

Read first: `docs/02-architecture.md` §Sync and §the port; `docs/03` §sync state and §the sync behaviour
table; `docs/09-publishing.md` §the network disclosure (the exact wording the README must carry later);
`docs/08-decisions.md` §P7, §P8, §P9, §E9; `docs/01-spec.md` §sync (the menus and what each does);
`obsidian.d.ts` for `SecretStorage` and `requestUrl` — quote each with `@since`.

Deliverable:

1. `src/plugin/settings/secrets.ts` — the token flow: read/write through `SecretStorage` only (key
   `tablify-airtable-token`, a fixed id documented in the file), a "test the token" action that calls the
   client's cheapest endpoint and reports the outcome in a Notice, and a guard that **throws in tests** if
   anything tries to serialise the token into settings. Add a unit test that greps the serialised settings
   and `data.json` fixture for the token prefix and asserts absence.
2. `src/sync/SyncTarget.ts` — the port: `describe()`, `pull(since)`, `push(changes)`, `capabilities()`,
   and the typed error union (`AuthError`, `RateLimitError`, `NetworkError`, `SchemaError`,
   `ValidationError`) with a documented retry policy per kind. No Airtable types in the port.
3. `src/sync/LinkStore.ts` — link state in `.tablify/links/<base>-<table>.json`: base id, table id, the
   field mapping (local property → remote field id), the snapshot hashes per row and per field, and the
   last pull cursor. Forward-compatible: unknown keys survive a save cycle, and a corrupt link file is
   reported (never silently recreated — that would lose the mapping).
4. `src/sync/airtable/client.ts` — the client, implementing `SyncTarget`:
   - pagination via `offset` with a hard page cap and a documented total cap,
   - retry with exponential backoff **plus jitter** for 429 and 5xx, honouring `Retry-After` when present,
     a maximum attempt count, and no retry for 4xx other than 429,
   - chunked writes of the documented size, with partial-failure reporting (which records failed, why),
   - all HTTP through Obsidian's `requestUrl` (never `fetch`, so the platform's network rules are respected),
   - every response validated before use: a shape error is a `SchemaError`, never a crash or a silent
     `undefined`,
   - the field-mapping resolver: local property → remote field id, reporting any remote field with no local
     counterpart and vice versa.
5. `tests/unit/airtable-client.test.ts` — with `tests/fakes/transport.ts` (no network ever):
   the pagination loop terminates at the cap; a 429 with `Retry-After: 2` waits ≥ 2 s on the fake clock and
   then succeeds; a 500 retries the documented number of times and then surfaces `NetworkError`; a 401 is an
   `AuthError` with no retry; a malformed body is a `SchemaError`; a 12-record push produces exactly two
   chunked write calls of the documented size; a partial failure reports per-record status.
6. `tests/unit/secrets.test.ts` — the token is read from `SecretStorage`, never from settings; the
   serialised settings and the `data.json` fixture contain no token-shaped string; a missing token yields a
   clear error, not a request.
7. `PROGRESS.md` updated (M5 started; the client's caps and retry policy).

Constraints and fence:
- Touch `src/sync/**`, `src/plugin/settings/secrets.ts`, `tests/**`, `PROGRESS.md`.
- **Never** modify the remote schema. **Never** delete a remote record from a local delete (the port may
  not even expose delete; if it must, implement it as a no-op with a comment citing the decision).
- No live API call in any test, in CI, or in a script. The transport fake must throw if a test tries to
  reach the network without a queued response, and a test must assert that throw.
- No `any`, no `as`, no `!`. Errors are typed and carry the request that produced them (with the token
  redacted — assert the redaction).

STOP and report instead of proceeding if: `SecretStorage` is not available at 1.13.1 with the API you
planned (quote what you found); or `requestUrl` cannot express a header you need; or the link-file location
conflicts with a documented folder rule.

Acceptance (paste raw output):
- `bun run check` — green.
- The client test results, one line per scenario in item 5, with the fake clock's advanced times.
- The token-redaction assertion and the vault grep result (`grep -r "pat" <fixture vault>` style — state the
  command you ran and its empty result).
- The bundle check: `main.js` must not contain the sync client (prove it: grep for a distinctive client
  identifier in the built file and show zero matches).

REPORT BACK with: the file list; the raw gate output; the client's caps and retry table with the doc line
behind each; the redaction proof; the bundle proof; anything ASSUMED (Airtable API behaviour especially —
say which parts you could not exercise); the exact next step.
