Task: build the test substrate the data layer and the grid will lean on — a fake vault that records every
write, a fake clock, a fake transport — and make the architectural boundary a lint failure, not a
convention. No product behaviour yet.

Read first: `docs/07-test-plan.md` §Tier 2 (this step implements it), §Tier 1 rules; `docs/02-architecture.md`
§layers and the `RowSource` port; `AGENTS.md` §boundaries; `docs/10-verification-and-ai-hygiene.md`.

Deliverable:

1. `tests/fakes/vault.ts` — an in-memory implementation of exactly the slice of `App` the adapters will
   use, with a recording write log:
   - `vault.getFileByPath(path)`, `vault.getMarkdownFiles()`, `vault.create(path, content)`, `vault.delete(file)`,
     `vault.read(file)`, `vault.modify` (**present but throws** — the queue must never call it for a
     property change, and the fake enforces that),
   - `fileManager.processFrontMatter(file, cb)` — deep-clones the fake note's frontmatter, invokes the
     callback, and records `{ path, before, after, at }` in `writes`,
   - `metadataCache.getFileCache(file)` returning whatever the test set,
   - helpers: `seedNote(path, frontmatter)`, `raw(path)` (the exact text that would be on disk),
     `writeCount(path)`, `resolvePath(name)` (Obsidian's link resolution, simplified but documented).
   - The fake must model Obsidian's real behaviour on these points, and each must have a unit test:
     (a) frontmatter is replaced wholesale, (b) unknown keys survive a callback that does not touch them,
     (c) deleting a key is done by `delete fm.key` and results in the key being absent, not `undefined`,
     (d) a callback that throws leaves the note unchanged.
2. `tests/fakes/clock.ts` — a controllable clock (`now()`, `advance(ms)`, `runTimers()`), no real timers.
3. `tests/fakes/transport.ts` — a fetch-like recorder for the sync work later: queue responses, record
   calls, simulate 429/500/timeouts deterministically, and assert no real network is reachable
   (it must throw if called without a queued response).
4. `tests/unit/fakes-contract.test.ts` — the four vault behaviours above, plus: the clock advances only
   when told to; the transport throws when unqueued.
5. `eslint.config.mts` — add, as a **failing lint rule**, the layer boundaries from `docs/02`:
   - nothing under `src/core/**` may import `obsidian` or `react` (already added in step 01 — verify it),
   - nothing under `src/adapters/**` may import `react`,
   - nothing under `src/grid/**` may import `obsidian` **except** through the two modules the docs name as
     the UI bridge, and nowhere may import from `prototype/**`,
   - `tests/**` may not import from `src/grid/**` except in `tests/dom/**`.
   Implement with `no-restricted-imports` patterns and `files` overrides; no inline disables.
6. `tests/unit/boundaries.test.ts` — a test that proves the rule bites: create the violation in a
   temporary file at test runtime (write, run ESLint's Node API on that path, assert non-zero exit, delete
   the file). This keeps the boundary honest if someone later loosens the config.
7. `vitest.config.ts` — extend, do not rewrite: make the coverage thresholds from step 01 real for
   `src/core/**` (they will fail until step 09 fills core — so for now assert the thresholds only for
   files that exist, and record in `PROGRESS.md` that the floor is enforced from the moment `core/` has
   content). Coverage must exclude `prototype/**`, `harness/**`, `tests/**` and `src/plugin/main.ts`.
8. `PROGRESS.md` updated.

Constraints and fence:
- Touch only `tests/**`, `eslint.config.mts`, `vitest.config.ts`, `PROGRESS.md`.
- The fakes must not import `obsidian`; they implement structural types we own (define a small
  `FakeApp` interface in the file, and note in a comment which real Obsidian members each method stands
  for). This keeps `core/` and the tests free of the real package.
- No `any`; the fake's `processFrontMatter` callback type must be generic and precise.
- No new dependency.

STOP and report instead of proceeding if: the layer rules in `docs/02` cannot be expressed as
`no-restricted-imports` patterns without listing every file individually; or a fake behaviour required by
`docs/07` §Tier 2 contradicts what `obsidian.d.ts` says about `processFrontMatter`.

Acceptance (paste raw output):
- `bun run check` — green, with the new tests.
- `bun run test -- --coverage` — paste the coverage table for `tests/fakes/**` (no thresholds on tests
  themselves, but show the numbers).
- Demonstration that the boundary rule is real: add `import { Plugin } from "obsidian";` to a scratch file
  under `src/core/`, run `bun run lint`, show the exact rule that fired, then delete the file and re-run to
  show green.

REPORT BACK with: the file list; the raw gate output; the four vault behaviours each with the test that
covers it; the boundary demonstration output; the coverage table; anything ASSUMED (in particular anything
about Obsidian's real `processFrontMatter` that the fake merely models — that gets proven in step 10);
and the exact next step.
