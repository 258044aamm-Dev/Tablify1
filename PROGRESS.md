# PROGRESS

- Milestone: M0 — Foundation (complete) · M1 — Core domain (starting)             Branch: main
- Last completed step: **step 05 — fakes, boundaries, coverage.** The test substrate the data layer will
  lean on exists and lies as little as possible: `tests/fakes/vault.ts` (an in-memory `App` with a write
  log), `tests/fakes/clock.ts` (time moves only when a test says so), `tests/fakes/transport.ts` (a
  fetch-like recorder that throws when nothing is queued). The architectural boundary is now a **lint
  error proven by a test that writes real violations at runtime**, not a convention.

- Verified (commands run, observed results):
  - `bun run check` — **exit 0**, with the suite grown from 16 tests / 3 files to **44 tests / 5 files**:
    `boundaries.test.ts` 12, `fakes-contract.test.ts` 16, `plugin-smoke.test.ts` 7,
    `bases-registration.test.ts` 5, `settings-tab.test.ts` 4. Bundle unchanged at
    `main.js raw 3905 B / gzip 1843 B`, `!important` clean, `bundle-size: OK`, `manifest:check: OK`,
    brand gate clean (note: 0 violations), Prettier clean.
  - **The boundary rule demonstrably bites.** A scratch file
    `src/core/scratch-boundary.ts` containing `import { Plugin } from "obsidian";` produced, from
    `bun run lint`:
    `1:1  error  'obsidian' import is restricted from being used. src/core must stay pure: it may not
    import the Obsidian API  no-restricted-imports` → **exit 1**. The file was deleted and lint returned
    to exit 0 with only the deferred settings warning. The same proof now runs on every gate, for eleven
    file/rule combinations, in `tests/unit/boundaries.test.ts` (each probe asserts `severity === 2`, which
    is the API's equivalent of the CLI's non-zero exit).
  - **The four vault behaviours, each with its test** (`tests/unit/fakes-contract.test.ts`):
    (a) *frontmatter is replaced wholesale* — a note containing `title: x  # keep me` and a block-style
    list is rewritten to exactly `---\ntitle: "y"\n---\nBody text.\n`; the comment is gone because the
    block is regenerated from the object;
    (b) *untouched keys survive* — a callback that sets only `status` leaves `title` and `owner` in place;
    (c) *`delete fm.key` removes it* — `'status' in after === false`, and the text contains no `status`
    line, because `undefined` is not a YAML value;
    (d) *a throwing callback writes nothing* — the promise rejects with the callback's error, the note
    text is byte-identical to before, and `writeCount()` is 0.
    Also asserted: the write log records `{path, before, after, at}` with copies (a later write cannot
    rewrite history); `vault.modify` **rejects** with the message pointing at
    `fileManager.processFrontMatter`; `create` on an existing path throws; `resolvePath` resolves exact
    path → basename (case-insensitive) → shallowest match; the metadata cache serves what a test sets and
    falls back to note frontmatter; the clock runs due timers in due order, `runTimers()` fires everything
    pending, `clearTimer` cancels, and a thousand busy iterations move `now()` by 0; the transport throws
    on an unqueued request without recording a call, records method/headers/body/`at`/outcome, and
    rejects with `TransportTimeoutError` / `TransportNetworkError` while the clock stays put.
  - **Coverage.** Standing report (`bunx vitest run --coverage`, product code only):
    `All files 100% / 100% / 100% / 100%` over `TablifyPlaceholderView.ts`, `keyBindings.ts`,
    `TablifySettingTab.ts`. Fakes measured on demand with a throwaway config (the standing gate excludes
    `tests/**` as the step requires): `All files 92.63% stmts / 85.18% branch / 90.24% funcs`;
    `clock.ts 100%`, `transport.ts 97.14%` (uncovered 116–117, the unqueued-throw's second branch),
    `vault.ts 88.59%` (uncovered: the `parse()` fallbacks for a malformed block, and the duplicate/orphan
    guard paths).
  - **Step 04's first assumption is now closed.** The workflows have executed on GitHub: pushing step 04
    as `2770c95` started run
    [37338515889](https://github.com/258044aamm-Dev/Tablify/actions/runs/37338515889); the `gate` job
    concluded **success** with every step green (`setup-bun`, cached `bun install --frozen-lockfile`,
    typecheck, lint, format:check, test, build, size) and the four layout steps `skipped` by the guard,
    exactly as designed — the annotation-plus-summary path instead of a red badge.

- **A silent hole this step found before it could ship.** `no-restricted-imports` is **not merged** across
  ESLint flat-config objects: when two objects match the same file, the later object's option *replaces*
  the earlier one's wholesale. The first version of this step added one block banning
  `prototype/**` imports for `src/**`, `tests/**` and `scripts/**` — and because that block matched
  `src/core/**` too and sat later in the array, it erased the core's purity rule that step 01 had added.
  It was caught by probing the resolved config (`eslint.calculateConfigForFile` showed only the prototype
  pattern for a core file) and by a CLI probe returning exit 0 where an error was expected. The fix is
  structural: exactly one boundary block per file set, and every restriction that applies to that set is
  composed by a `restrict()` helper that always appends the reference-material ban. The reason it cannot
  silently regress is `tests/unit/boundaries.test.ts`, which writes the violations to disk and lints them;
  a loosened pattern or a newly-added overlapping block turns that suite red.

- Assumed / not verified (each with how to verify):
  1. **The fake's YAML handling is a model, not a parser.** `parse()` understands flat `key: <JSON>` lines
     only, so behaviour (a) is proven structurally (the block is regenerated from the object) but the
     fidelity of a *real* round-trip — aliases, multi-line strings, dates, comments in Obsidian's own YAML
     serialiser — rests on step 10's real-vault spike. The fakes were written to keep `core/` and the tests
     free of the `obsidian` package, so this cannot be closed here.
  2. **`processFrontMatter`'s callback is modelled as synchronous and `void`-returning**, matching
     `obsidian.d.ts:2954` (`(frontmatter: any) => void`). The parameter type is deliberately
     `Record<string, unknown>` rather than upstream's `any`, because `any` is banned here. A generic
     parameter would read better but cannot be written without a cast the lint fence forbids: the callback
     receives a cloned `Record<string, unknown>`, which is not assignable to the narrower `T` a caller
     asked for. Consequence to respect until step 10 proves otherwise: an adapter must never return a
     promise from the callback.
  3. `vault.create` / `read` / `modify` / `delete` are `Promise`-returning in the fake, matching
     `obsidian.d.ts` (7386 / 7412 / 7467 / 7441) rather than being convenient synchronous stubs, so a
     forgotten `await` in an adapter is at least visible in the types. Only the seeding helpers
     (`seedNote`, `createNote`, `raw`) are synchronous, and tests use those.
  4. `resolvePath` models Obsidian's link resolution with three documented rules (exact path, then
     case-insensitive basename, ambiguity by shallowest then alphabetical) and **not** the parts the
     `.tabula` importer needs: `#heading`, `^block`, `[[Note|alias]]` and frontmatter aliases. Step 13
     owns those.
  5. The fake transport proves no test can reach the network *through it*; it cannot prove an adapter will
     not call the global `fetch` directly. That audit belongs to step 25, where the sync client is written,
     and the boundary rule for `src/sync/**` (dynamic-import only) is the second half of the answer.
  6. `src/core/**`'s coverage floor (85/85/85/75) is a **no-op while `src/core/` is empty** — verified:
     the coverage run on an empty `core/` reports no `core` rows and exits 0. It is not a hole: the
     threshold is a ratio over the files the glob matches, so the first file committed under `src/core/`
     is measured immediately. The floor becomes real in step 09.
  7. `tests/**` is exempted from `obsidianmd/no-nodejs-modules` (a test runner is the workstation, not
     Obsidian) and from `obsidianmd/ui/sentence-case` (the rule reported `fm.title = 'y'` as UI copy).
     Both exemptions are written in `eslint.config.mts` with their reason, and both stay on for every
     shipped file.

- Findings worth keeping:
  1. Vitest's **default** coverage excludes hide any file under a `tests/` directory, so measuring
     `tests/fakes/**` needed an explicit `exclude: []`; without it the report prints an empty table with
     `All files 0%` and no rows, which looks like "no coverage" rather than "not measured".
  2. `mergeConfig` concatenates arrays, so a throwaway config cannot narrow `coverage.include` by merging
     the base config — it has to be a standalone config. (Both traps cost a run each; recorded so the next
     person does not pay again.)
  3. ESLint's Node API and the CLI agree on these rules, so `tests/unit/boundaries.test.ts` is a faithful
     proxy for `bun run lint` — confirmed by running both against the same probe and comparing exit
     semantics.
  4. The boundary probes create directories when they do not exist and remove them again afterwards *only
     while empty* (`rmdir`, ENOTEMPTY ignored), so the suite leaves a clean tree and cannot delete real
     modules.

- Half-finished: nothing. The fakes are complete for their declared slice; anything beyond it is a new
  behaviour, not a missing one.

- Open questions for the human (carried from step 04 — both still unanswered and both still live):
  1. Should the layout guard emit a warning (current choice) or fail the run until step 21? A failing run
     would be a stronger signal but leaves CI red for the rest of M0–M2.
  2. Dependabot: the `obsidian` ignore covers `version-update:semver-major` only, so minor and patch bumps
     are still proposed. If every `obsidian` bump should be human-gated, say so and the ignore list
     changes.

- Next step: `prompts/step-06-*.md` (M1 — the core domain begins: field types, schema and the value model,
  still with no Obsidian and no React in `src/core/**`).

- Files touched this step: `tests/fakes/vault.ts`, `tests/fakes/clock.ts`, `tests/fakes/transport.ts`,
  `tests/unit/fakes-contract.test.ts`, `tests/unit/boundaries.test.ts`, `eslint.config.mts`,
  `vitest.config.ts`, `PROGRESS.md`.

- Earlier steps: 01 toolchain and gate (802 B / 532 B bundle, `bun run check` exit 0); 02 manifest and
  legal (`brand:gate`, `manifest:check`, `minAppVersion` 1.13.0 as the tested floor); 03 plugin shell
  (Bases view registration, two commands, settings tab, status bar item, `release-assets` and
  `version-bump`; 16 tests); 04 CI and release (the `gate` job, the self-retiring layout guard, the
  tag-driven release with three assets; verified green on GitHub as run 37338515889). Forced amendments
  are recorded in `prompts/README.md` under "Amendments applied during execution".
