# PROGRESS

- Milestone: M0 — Foundation (complete) · M1 — Core domain (complete) · **M2 — Adapters (in progress)**
  Branch: main
- Last completed step: **step 14 — the settings schema, its persistence, and the real settings tab.**
  One schema file is the only place a setting is described; `data.json` is read by a validator that defaults
  what it cannot read and keeps what it does not know; the save path debounces, writes only on a real change,
  and never writes the passthrough keys it did not come up with. The tab is Obsidian 1.13's **declarative**
  surface (`PluginSettingTab.getSettingDefinitions()`), which resolves the lint warning that has been standing
  since step 04 — `eslint .` is now **0 errors, 0 warnings** for the first time.

- Last completed step before that: **step 13 — the `.tabula` reader, the dry run and the migration.** A legacy
  `.tabula` file is read into a neutral, read-only model (v1 and v2 detected from content, tolerant of
  BOM/CRLF/trailing space/zero rows/unknown types/orphaned option values, **never** throwing); the dry run
  turns it into a report a dialog can show; the migration is ordinary ops — one `importBlock` per table, one
  `setFieldOptions` per options column, one `setViewConfig` per view — so the whole thing is **one undo step**
  and the `.tabula` bytes are untouched. Seven committed fixtures, 6 snapshots of the parse result and 6 of the
  report.

- Before that: **step 12 — `BasesSource`, the real Bases view, and note creation.** Rows
  and values come from a real Bases view (keyed by `entry.file.path`), edits go out through step 11's queue,
  and the optimistic overlay is what the grid reads in between. The whole **data path is ASSUMED**: there is no
  real vault here, and the step's real-vault observation is not produced (see the step-12 block below).

- Last completed step before that one: **step 11 — the `RowSource` port, the write queue and the optimistic
  overlay.** The layer that makes editing a note-backed grid safe: coalescing per file+property, one
  `processFrontMatter` call per file per flush, a promise chain per file so two writers never overlap, a
  250 ms debounce with a `flush()` that bypasses it, per-file failure reporting, and an overlay that holds
  pending values only.

---

**Step 14 — the settings schema, its persistence, and the real settings tab.**

- Verified (`bun run check` — raw): `tsc --noEmit` clean; `eslint .` → **0 errors, 0 warnings** (the step-04
  `prefer-setting-definitions` warning is resolved by adopting the 1.13 declarative API, not suppressed);
  `brand-gate: OK — 61 permitted match(es), 0 violations` (after it caught one real violation, below);
  `manifest:check: OK`; `All matched files use Prettier code style!`; **948 tests across 24 files**
  (was 912 / 23: +22 in `tests/unit/settings-load.test.ts`, +20 in `tests/dom/settings-tab.test.ts`, and
  `plugin-smoke` +1 manifest field); `bundle-size: OK` — `main.js raw 68920 bytes (67.30 KB)`
  (**+16173 B / +3.88 KB gzip** over step 13: the settings schema, validator, store, tab and diagnostics),
  `gzip 21985 bytes (21.47 KB)`, `styles.css !important check: clean`. Coverage: all files **91.15 / 89.72**;
  `src/plugin/settings` **86.54** (`diagnostics.ts` 96.22, `schema.ts` / `load.ts` / `save.ts` / `tab.ts`
  between 88 and 100), `TablifySettingTab.ts` **18.18** — the class is the Obsidian-facing half and only
  Obsidian constructs it; the parts of that file that carry logic are exported and tested (below).

- The settings inventory (path → default → what changing it does):

  | Path | Default | Row |
  |---|---|---|
  | `rows.targetFolder` | `''` (vault root) | Folder for new notes — where a created note is written |
  | `rows.filenameTemplate` | `'{{Name}}'` | File name template — `{{Column}}`, falling back to `Row 1`, `Row 2` |
  | `rows.dateFormat` | `'iso'` | Date format — display only; the note keeps the same value |
  | `import.warnOnLargeImport` | `true` | Warn before a large import |
  | `import.largeImportThreshold` | `250` (range 10–5000) | Large import threshold — hidden while the warning is off |
  | `import.inferTypes` | `true` | Detect column types |
  | `import.clipboardPasteMode` | `'expand'` | Pasting a block — grow / fill / ask |
  | `appearance.followObsidianTheme` | `false` | Follow my Obsidian theme — the one host-theme switch |
  | `appearance.defaultRowHeight` | `'medium'` | Row height for **new** views (a view's own height lives in `.base`) |
  | `appearance.motionPreference` | `'system'` | Motion — follow the system reductions |
  | `legacy.showMigrationEntryPoints` | `true` | Show the legacy import entries |
  | `advanced.logLevel` | `'off'` | Log level — silent unless asked |
  | `advanced.experimental` | `{}` (empty) | Experimental features — hidden until a flag exists |
  | — (no value) | — | Version (read-only line) · Diagnostics (button) |

  `docs/01` names the 250-row threshold; every other default is this step's own choice, recorded here so the
  next step reads one table rather than four files.

- The migration table (item 6), each case as a test:
  1. `{}` → `DEFAULT_SETTINGS`, no warning, `migratedFrom: 0` (no version field **is** version 0; a missing
     file is the different case and reports nothing).
  2. a partial file (`{rows:{targetFolder}}`) → that one value stored, everything else at its default, no
     warning: an absent key is what a fresh install looks like, not a mistake.
  3. a wrong type (`largeImportThreshold: 'many'`, `warnOnLargeImport: 'yes'`, `defaultRowHeight: 'enormous'`)
     → three defaults and three warnings, in schema order, e.g. *“Warn before a large import” keeps its
     default (on): the stored value expected true or false.* and *… expected one of short, medium, tall.*
  4. a number out of range (`999999`) → the default, and *… expected a number between 10 and 5000.*
  5. unknown keys (`somethingNewer`) → kept in `passthrough`, warned, and present in the payload after a real
     load → set → debounce → flush cycle.
  6. `version: 0` → `migratedFrom: 0`, values untouched, `MIGRATIONS[0]` asserted to be pure (same input,
     same output); `version: 99` → nothing changed, nothing thrown, two warnings (the newer-version notice and
     the unknown key), and the payload keeps `futureSection` while writing our own `version`.
  Plus: a non-object file (`null`, `'nonsense'`, `42`, `[1,2]`) → defaults, never a throw.

- The `passthrough` behaviour, implemented and asserted: `loadSettings` splits the **top level** only —
  `version`, `rows`, `import`, `appearance`, `legacy`, `advanced` are ours, and every other key is copied
  verbatim into `passthrough`, warned about once, and merged back by `payloadFor` **before** our own `version`
  is written last. The store can never set a passthrough key: `set()` resolves the path through
  `settingRowFor` and refuses anything the schema does not declare (asserted for a real path, a made-up path,
  and an internal `__warning.0` key).

- **Three things the tooling caught, fixed in the product rather than the test** — the reason this step is
  worth its own block:
  1. **The brand gate fired on real product code**: `src/plugin/settings/schema.ts` said “Airtable-style” in a
     comment about what may never be stored. Removed — the token does not appear in `src/**` at all, and the
     gate is what proved it.
  2. **`obsidianmd/no-unsupported-api`**: `SettingSliderControl.displayFormat` is **`@since 1.13.1`** while
     this plugin's `minAppVersion` is 1.13.0. The field is gone; the slider's unit and range now live in the
     row's description (*“The row count, from 10 to 5000, …”*), which is also searchable. The group-level
     `search` field (`@since 1.13.1` as well) was removed for the same reason, unprompted by the linter.
  3. **`consistent-type-assertions` × 5 + two `no-unsafe-assignment`**: the defaults were written with `as`
     on five enum values, and `Reflect.get` returns `any`, which is an unsafe assignment even into `unknown`.
     Both are gone: the defaults rely on the annotation for contextual typing, and `readPath`/`writePath` walk
     objects through an `isRecord` guard and an index access, with `containerOf` shared by both.
  4. A behavioural bug the tests found before the gate did: `set()` notified listeners for a value **equal** to
     the stored one, so a slider dragged back to where it started re-rendered the tab. `set()` now compares
     first: equal value → accepted, no notification, no dirty flag, no write.
  5. The sandbox restore stripped the **byte-order mark** from `tests/fixtures/tabula/crlf-bom.tabula` — the
     fixture's entire purpose. Restored from git, and `tabula-parse.test.ts` now asserts the fixture's bytes
     (`charCodeAt(0) === 0xfeff`, contains `\r\n`, not `\n\r`) before asserting the parse, so a tool that
     tidies the file away fails the test instead of making it vacuous. This is step 13's file, fixed here.

- Decisions and deviations worth recording:
  1. **The tab is declarative (`getSettingDefinitions()`), not `Setting().addToggle()`.** `prompts/step-14`
     item 4 names the imperative controls; the API marks `display()` **deprecated since 1.13.0** and calls it
     only when `getSettingDefinitions()` returns an empty array, `minAppVersion` is 1.13.0, and the project's
     own lint rule (`obsidianmd/settings-tab/prefer-setting-definitions`) asked for exactly this in step 04.
     Writing both renderers would mean two places to keep in step for every future setting — the thing the
     schema exists to prevent. There is **no `display()` override at all** (asserted), so the declarative path
     is the only path.
  2. **The tab's logic lives in `src/plugin/settings/tab.ts`, which does not import `obsidian`.** The rows,
     the visibility predicates, the control mapping, the validators, the Diagnostics action and the versions
     line are all testable without a browser — and `renderFor` is the seam the tests drive, so what is asserted
     is the function the definition itself calls. `SettingSurface`/`ToggleSurface` are the narrow interfaces
     those callbacks declare: a real `Setting` satisfies them, and a test can build one without an assertion.
  3. **The class's logic is exported and tested; its delegations are not.** `settingsOf`, `isSettings` and
     `writeSetting` are exported from `TablifySettingTab.ts` and asserted against a hand-built host (defaults
     for a store that has nothing, a schema-only path guard, the value passed through unchanged). What remains
     uncovered is the constructor and three one-line delegations, which only Obsidian calls — reported as
     **ASSUMED**, like every DOM-facing surface in this project so far.
  4. **The debounce is 500 ms, and the number is a named constant.** No doc names an interval for plugin
     settings; the write queue's 250 ms is tuned for typing and this is a click path. `flush()` bypasses it,
     `dispose()` drops it, and a refused write keeps the value in memory with the dirty flag back on.
  5. **Diagnostics has a secrets filter, not a promise.** `looksSecret`/`redactedSettings` replace any
     credential-looking key with `"<removed>"` and a test proves the filter fires — so when step 25 adds a
     sync section, the button cannot leak it even by accident. The blob carries versions, the settings, and a
     **count** of notes: no note text, no file names, no folder paths.
  6. **The versions row shows two versions, not three.** “The version running now” is not public API
     (step 10's finding, recorded in `spike/bases-path/FINDINGS.md`), so the line reads
     `Tablify 0.1.0 · Obsidian 1.13.0 or newer` — true, and it does not pretend to know more.

- Findings worth keeping (the docs did not say, or said differently):
  1. **`docs/02` §settings does not exist.** The step's “read first” names a section that is not in the file
     (its neighbours are §Store, §Grid rendering, §Performance budget). The placement rule used here came from
     `docs/03` §view config (per-view state in `.base`) and `docs/01` §views (row height/density are *view*
     options), and it is written into `schema.ts` as a comment. *(reported, not applied)*
  2. **`docs/01` §settings also does not exist**, and `docs/01` names only one settings default (the 250-row
     threshold). The remaining twelve defaults are this step's, listed above for review.
  3. Unchanged: `docs/02` §Rows become notes needs the “`createFileForView` is single-row only” line, and
     step 10's three `FINDINGS.md` corrections are still unapplied.

- Open questions for the human:
  1. **Twelve defaults are choices, not quotations** — the table above is the list. Anything to change before
     step 16 reads them?
  2. (unchanged) **Does anything ever write `.tablify/migrations/<timestamp>.json`**, or does the dry-run
     report replace it?
  3. (unchanged) **`empty.tabula` has nothing to migrate** — should the dialog offer it at all?
  4. (unchanged) **`docs/01` §in scope** needs the missing §undo paragraph (depth 60, one step per action, the
     menu wording, no keystroke coalescing).
  5. (unchanged) **`docs/02` §Store's `Command`/`GridStore` sketch** is behind the implemented shape, and
     step 13 leaned on that shape.
  6. (unchanged) `docs/02` §Query and `docs/01` are behind the query layer (step 08, Findings 1–3);
     `@standard-schema/spec` as a types-only devDependency or the local declaration; `docs/04` has no
     §cell-rendering section; `attachment`: `[[link]]` or plain path; the layout-guard warning; the banned word
     in `docs/09` line 33 and the three candidate descriptions.

- Next step: `prompts/step-15-tokens-css-and-contrast-gate.md` — `src/styles/{tokens,brand,grid}.css` with the
  three token layers, the assembled `styles.css` entry, `scripts/contrast.ts` (a port of `tools/contrast.js`
  and its `@contrast` convention) and `scripts/css-gate.ts`, both wired into `check` after `build`, plus
  `tests/unit/tokens.test.ts`. The palette values come from `prototype/css/tokens.css` (the identity set), and
  the gate must pass in light, dark and host mode.

- Files touched in **step 14**: new — `src/plugin/settings/{schema,load,save,tab,diagnostics}.ts`,
  `tests/unit/settings-load.test.ts`; changed — `src/plugin/settings/TablifySettingTab.ts`,
  `src/plugin/main.ts`, `tests/mocks/obsidian.ts` (Setting `addToggle`/`controlEl`, `SettingGroup`,
  `PluginSettingTab`'s five declarative members, `Plugin.loadData`/`saveData` + app.vault),
  `tests/dom/settings-tab.test.ts`, `tests/unit/plugin-smoke.test.ts`,
  `tests/unit/tabula-parse.test.ts` (the fixture-bytes assertion, over a step-13 file), `PROGRESS.md`.
  Nothing outside `src/plugin/**`, `tests/**` and `PROGRESS.md` — in particular the `.base`-owned per-view
  settings were left alone, and no field of `data.json` holds one.

---

**Step 13 — the `.tabula` reader, the dry run and the migration.**

- Verified (`bun run check` — raw): `tsc --noEmit` clean; `eslint .` → **0 errors, 1 warning** (unchanged: the
  step-04 settings tab does not implement `getSettingDefinitions()`; step 14 replaces it);
  `brand-gate: OK — 60 permitted match(es), 0 violations` (one more permitted match: the new fixtures name the
  legacy format in prose, not a brand); `manifest:check: OK`; `All matched files use Prettier code style!`;
  **912 tests across 23 files** (was 868 / 21: +26 in `tests/unit/tabula-parse.test.ts`, +18 in
  `tests/unit/tabula-migrate.test.ts`); `bundle-size: OK` — `main.js raw 52747 bytes (51.51 KB)`,
  `gzip 16555 bytes (16.17 KB)`, `styles.css !important check: clean`. Coverage: all files **91.46 / 90.21**
  (funcs 96.22); `core/migrate` **93.81** (`dryRun.ts` 94.82, `apply.ts` 92.02),
  `adapters/tabulaFile` **82.77** (`model.ts` 83.41, `parse.ts` 82.53), `src/core/**` unchanged at 85+/85+.

- **The first CI run of this step failed, and it was the most useful thing that happened to it.**
  Run `37364334832` (on `c97e79f`) failed at `bun run test`: `tests/unit/tabula-parse.test.ts` →
  `refuses a truncated file … expected 10 to be 9`. The reader had fixed the runtime-dependence in the branch
  that has **no** engine position (Bun says `Expected '}'` with no position) and left the engine's own
  position untouched in the branch that has one — and the CI runner's engine reports
  `… in JSON at position 269 (line 10 column 1)`, pointing a truncated document at the last byte of the input,
  which is one line past the text. `locateAtLine` now answers a position that lands on a blank line with the
  **last line that has content, and that line's number**, so both engines report line 9 with the same excerpt.
  The rule is pinned by a test that injects a V8-shaped message (`line 10 column 1`) through a one-shot
  `JSON.parse` spy, so the local suite now catches exactly what CI caught — the fix is verified twice without a
  third push. The step-13 evidence above is from the gate **after** that fix.

- The acceptance assertions, by requirement:
  1. **It never throws.** Every refusal is a `TabulaResult` with `TabulaError { path, line?, column?, message,
     excerpt ≤ 120 }`; the engine's own `SyntaxError` travels as `cause` and nothing asserted depends on its
     wording. `truncated.tabula` (a deliberate half-written JSON file) refuses with
     `the file is not valid JSON — it stops before the document ends, so it is truncated or only partly saved`
     at **line 9 with a non-empty excerpt on both engines**: V8 reports the position at the last byte of the
     input (where there is no text) and Bun reports no position at all, so a position that lands on nothing is
     answered with the file's last line that has content (`locateAtLine`/`locateFrom` → `locateEnd`). The
     snapshot pins the message and the excerpt; the assertions pin the line, once for each engine's message
     shape.
  2. **Version from content.** `version === 2 && Array.isArray(tables)` is v2, `fields && rows` is v1, a
     `tables` array with no `version` is read as the v2 envelope (with a `missing-version` warning), and
     `version > 2` refuses rather than guessing.
  3. **Tolerance, each asserted on its own fixture or its own minimal document**: BOM + CRLF
     (`crlf-bom.tabula` parses with **zero** warnings), trailing space, a table with zero rows (`empty.tabula`),
     two unknown legacy types (`lookup`, `rollup` — **kept as text**, `unknown: true`, one `unknown-type`
     warning each), orphaned select ids (`orphan-options.tabula` — the value is kept, the label is kept when it
     exists, and `orphanSelections()` reports `r_1/f_status/o_archived` and `r_1/f_tags/o_urgent`), a v2 entry
     with no table object (`skipped-table-entry`, the other tables still read), two tables claiming one id
     (`duplicate-table-id`), a row with no `cells` object (`missing-row-cells`, the row survives as empty), a
     cell whose column is not in the table (`extra-cell-column`, the value is dropped), and an unrecognised
     sort direction (`unknown-sort-direction`, the sort is kept).
  4. **Seven fixtures, each snapshot-tested.** `tests/unit/__snapshots__/tabula-parse.test.ts.snap` holds the
     parse result of all six readable fixtures (820 lines); the seventh (`truncated.tabula`) is asserted as an
     error. A test also asserts the fixture directory contains exactly those seven names, so a fixture cannot
     be added without a test being added in the same commit.
  5. **The dry run is data.** `dryRunMigration(doc, target)` is pure — no clock, no vault, no I/O — and its
     report is snapshotted for the other five readable fixtures plus the whole report of `v1-simple`. Counts
     asserted outright: v2 is 6 notes over 3 tables (3/2/1), 16 columns, 1 dropped, 1 warn-free read;
     `unknown-types` is 2 remapped + 2 metadata + 1 dropped; `orphan-options` is 2 orphan values.
  6. **Operator translation, against the twelve canonical ids** (`docs/08` §query): `equals`→`is`,
     `contains`→`contains`, `before`→`lt`, `after`→`gt`, `isAnyOf`→`contains`, `isTrue`→`is`, `gt`→`gt`,
     `isEmpty`→`isEmpty`, each with a reason; an operator with no canonical form (`fuzzyMatches`) keeps its
     column and its spelling in the conditions table **and** is listed in `view.dropped`, because a filter that
     is not applied is a loss a person has to be able to read.
  7. **One undo step, one `importBlock` per table, new notes only, `.tabula` bytes unchanged.**
     `migrateMutation` returns `['importBlock','setFieldOptions','setViewConfig']` for `v1-simple`; pushed to
     `createHistory()` as **one** command (`{kind:'none'}` before-images — a note that did not exist), it gives
     `depth() === 1`, `undoLabel() === 'Migrate 3 notes from 1 table'`, and `undo()` returns deletes for exactly
     the three created notes; `redo()` puts them back. A note that already exists at a target path is left
     byte-identical and is not in `created()`. The fixture's text is re-read after a full apply and is equal,
     and no path in any op ends in `.tabula` (asserted over `vault.paths()`).
  8. **Through the view source**, a migration produces **no refusals and no cell writes** (`written === 0`) and
     exactly two sidecar patches, in order: `fieldOptions` (carrying `note.Status` with its options) and
     `tablifyViewConfig` (carrying the translated view). Rows are the store's business — `BasesSource` has no
     `importBlock` case and says so with an empty default — which is asserted rather than assumed.

- Decisions and deviations worth recording:
  1. **A column's destination is a four-way statement, not two booleans.** `ColumnPlan.destination` is
     `'kept' | 'remapped' | 'metadata' | 'dropped'`, and `stored` is derived so the two cannot disagree
     (asserted as an invariant over a 6-column plan). Reporting a `createdTime` column as "remapped" (as the
     first draft did) would have said the type changed when what changed is that the *values* stop being copied.
  2. **The auto-number counter is named only when a column used it.** A `.tabula` file carries
     `autoNumberNext` even with no `autoNumber` column, and "counter discarded" would then be noise next to a
     report that is otherwise exact. Asserted both ways (`v1-simple` must **not** mention it, `unknown-types`
     must).
  3. **v2 table ids come from the entry** (`{ id, table }`), matching the fork's own
     `parseTableFileDocument`; the first draft read `id` from inside the table document, which would have
     reported every v2 table as `t_1`/`t_2` and silently re-keyed a file that legitimately uses those names for
     something else. A v1 document has no id of its own — the file *is* the table — so `t_1` is synthesised and
     documented as synthesised.
  4. **A table with zero rows contributes no `importBlock`.** The step's item 4 says "one `importBlock` per
     table"; a no-op op would be recorded in the undo step and in the write log for nothing, so
     `empty.tabula` produces a `setViewConfig` and nothing else. Reported as a deviation rather than split down
     the middle.
  5. **Op order inside one table is `importBlock` → `setFieldOptions` → `setViewConfig`** (a table at a time,
     tables in order). A store applying the batch in order therefore cannot render a select column before its
     options exist, and `previous: {}` is honest for a **fresh** base view: a non-empty `previous` would make
     undo restore a config the user never had.
  6. **`Project plan (1)` vs `" 2"`.** `prompts/step-13` item 5 illustrates the collision case as
     `Project plan (1)`; `docs/03` line 99 says the suffix is `" 2"`, `" 3"`, …. The doc is the spec and the
     implementation follows it (same divergence as step 12's finding 4, recorded once, awaiting a decision).
  7. **`tests/fakes/noteStore.ts` (new) is a stand-in for the step-16 store, and it is a fake, not a mock**:
     notes are written by the shipping `createNote` frontmatter path and state comes from the shipping
     `applyOp` reducer, so a migrated note cannot drift from a pasted row. It exists because `importBlock` and
     `deleteRows` have to be *applied* somewhere for the one-undo-step assertion to mean anything; step 16
     replaces it with the real store and this file is then the thing to delete.
  8. **`tests/fixtures/tabula/*` are hand-written to the recorded on-disk shapes**, not copied from the fork's
     test data: v1 written bare, v2 only when there are two or more tables, select cells holding option **id**s,
     number/currency/percent as plain numbers (`f_share: 25` — checked against the fork's `isNumericField`,
     which does not store a ×100 form). The fork's reader was consulted for the detection rule and the envelope
     shape only.

- Interpretations worth recording:
  1. **`metadata`, not `remapped`, is where `createdTime`/`lastModifiedTime` go.** Both become read-only
     `file.ctime`/`file.mtime` columns; the column survives and the values are recomputed by Obsidian
     (`docs/03` §field type mapping), so they are reported as a destination of their own.
  2. **The reader keeps the file's own vocabulary.** A sort whose direction is not `asc`/`desc` is kept as
     written and warned about (the dry run then normalises to `asc`), and an unknown legacy type keeps its
     spelling in `legacyType` with `unknown: true` — so the report can show the user the word that was in their
     file, which is the whole point of a dry run.
  3. **Warnings are scoped by index, not by text.** `TabulaWarning.tableIndex` is stamped on every warning and
     the dry run filters with `tableIndex === undefined || === index`; the earlier substring match on `where`
     would have mis-attributed a warning whose text happened to contain another table's label.
  4. **`Array.isArray` was replaced at every read site** (`isStringList` in `model.ts`, `asArray` in `parse.ts`)
     because it types an `unknown` as `any[]` and `no-unsafe-*` catches it — the fix is a predicate, never a
     cast.

- Findings worth keeping (the docs did not say, or said differently):
  1. **`docs/03` §Migration step 5's mapping file (`.tablify/migrations/<timestamp>.json`) is not written in
     step 13.** The `sync` block is *carried* in every table plan and in the report, so the data a mapping file
     needs is read and reported — but writing it is a vault write with a clock, and both are outside this
     step's fence (read-only reader, pure migration). Whoever owns the dialog (step 23) has to own it, or the
     file has to be dropped in favour of the report. *(reported, not applied)*
  2. **`docs/03` should say that a row-creating op belongs to the store, not to the view source.** The source
     deliberately has no case for `importBlock`; without the sentence, the next reader of `BasesSource` sees an
     empty `default:` and has to guess whether it is a bug. *(reported, not applied)*
  3. Unchanged: `docs/02` §Rows become notes should note that `createFileForView` is single-row only; step 10's
     three `FINDINGS.md` corrections are still unapplied.

- Open questions for the human:
  1. **Does anything ever write `.tablify/migrations/<timestamp>.json`** (finding 1), or does the dry-run
     report replace it? Until that is decided the reader keeps the `sync` block and nothing writes a file.
  2. **`empty.tabula` has nothing to migrate** (zero rows, two columns). Should the dialog offer the migration
     at all, or say "this file has no rows" and stop? Step 23's call, recorded here because the ops for it are
     already empty except the view config.
  3. (unchanged) **`docs/01` §in scope** needs the missing §undo paragraph (depth 60, one step per user action,
     the menu wording, no keystroke coalescing).
  4. (unchanged) **`docs/02` §Store's `Command`/`GridStore` sketch** is behind the implemented shape
     (`label`, `undo()` returning ops, `History` as a factory) — and step 13 leaned on that shape, so the gap
     is now load-bearing.
  5. (unchanged) `docs/02` §Query and `docs/01` are behind the query layer; a select column's sort is
     alphabetical rather than option-ordered (step 08, Findings 1–3).
  6. (unchanged) `@standard-schema/spec` as a types-only devDependency, or the local structural declaration?
  7. (unchanged) `docs/04` has no §cell-rendering section, which `prompts/step-07` cites.
  8. (unchanged) `attachment`: write `[[link]]` or the plain vault path? (current: plain path.)
  9. (unchanged) Layout guard: warning (current) or failing until step 21?
 10. (unchanged) `docs/09` line 33 still contains a banned word in its description template; three candidate
     plugin descriptions await a pick.

- Next step: `prompts/step-14-settings-schema-persistence-and-tab.md` — the settings schema, load/save with
  migration, and the real `TablifySettingTab` replacing step 04's placeholder: schema-driven rows, hidden rather
  than disabled, unknown keys preserved, a pure `migrate(raw)` at `version: 0`, a debounced save, a read-only
  version row and a Diagnostics button that copies a secret-free blob. It must resolve the one standing lint
  warning **by adopting the 1.13 declarative surface** (`PluginSettingTab.getSettingDefinitions()`,
  `@since 1.13.0` — found while checking the Bases declaration in step 12) or by saying why not.

- Files touched in **step 13**: new — `src/adapters/tabulaFile/{model,parse}.ts`,
  `src/core/migrate/{dryRun,apply}.ts`, `tests/fixtures/tabula/*.tabula` (7),
  `tests/fakes/noteStore.ts`, `tests/unit/{tabula-parse,tabula-migrate}.test.ts`,
  `tests/unit/__snapshots__/tabula-parse.test.ts.snap`; changed — `PROGRESS.md`. Nothing outside
  `src/adapters/tabulaFile/**`, `src/core/migrate/**`, `tests/**` and `PROGRESS.md`.

---

**Step 12 — `BasesSource`, the real Bases view, and note creation.**

- Verified (`bun run check` — raw): `tsc --noEmit` clean; `eslint .` → **0 errors, 1 warning** (step 04's
  settings tab does not implement `getSettingDefinitions()`; step 14 replaces it); `brand-gate: OK — 59
  permitted match(es), 0 violations`; `manifest:check: OK`; `All matched files use Prettier code style!`;
  **868 tests across 21 files** (was 836 / 19); `bundle-size: OK` — `main.js raw 52661 bytes (51.43 KB)`,
  `gzip 16525 bytes (16.14 KB)`, `styles.css !important check: clean`. Coverage: all files **92.15 / 91.43**;
  `src/adapters` 97.77 / 96.00 (`optimistic.ts` 100/100, `writeQueue.ts` 97.41/95.74),
  `adapters/bases/BasesSource.ts` **85.17 / 84.11**, `adapters/notes/createNote.ts` **92.30 / 90.14**,
  `plugin/TablifyView.ts` 54.18 (its DOM body is step 17's, and it is a placeholder by design).

- The five acceptance assertions, from `tests/unit/bases-source.test.ts` (18 tests; the fixture host is a
  stand-in for `BasesView` and the fake vault, never a real one):
  1. **Rows keyed by path survive a reorder and a re-creation**: after the host replaces its entries wholesale
     and adds a row, `getRows()` is `['Notes/B.md','Notes/A.md','Notes/C.md']` and the new row's value reads
     `'Gamma'`; after the host drops `B`, `getRows()` is `['Notes/A.md']` and `getValue('Notes/B.md','note.Name')`
     is `null` — the disappeared row does not resurrect, because nothing is keyed by index.
  2. **One cell op ⇒ exactly one queued write and one overlay entry**: `result.written === 1`,
     `queue.pending() === 1`, `overlay.size() === 1`, `overlay.get('Notes/A.md','Name') === 'Alpha two'`, and
     `getValue('Notes/A.md','note.Name')` returns the typed value *before* the write lands;
     `clock.pending() === 1` (the 250 ms debounce) and `vault.writeCount() === 0` at that moment. After
     `clock.advance(250)` + `flush()`: the writer was called **once**, the vault holds `Name: 'Alpha two'`, and
     `overlay.size() === 0`.
  3. **A read-only column refuses, typed**: `ok === false`, `written === 0`,
     `refused[0] = { reason: 'readonly-column', propertyId: 'file.mtime', message: 'mtime is read-only (…) }`,
     no timer queued and `vault.writeCount() === 0`. A column that is not in the view refuses too, naming it.
  4. **`subscribe` fires once per frame for ten rapid updates**: ten host updates leave `first === 0` and
     `frames.length === 1`; running that one frame gives `first === 1`, and the snapshot holds the **last**
     value (`'Alpha 9'`). A listener that unsubscribed is not called (`second === 0`).
  5. **The QueueSpy**: the source is constructed with one injected `processFrontMatter`, and a single cell op
     produces **zero** spy calls before the debounce and **exactly one** after it, with the fake vault
     recording exactly one write. The source holds no vault reference at all (asserted on its own keys), so a
     direct write is not possible — not merely not done.

- **A real defect the fixture caught, fixed in the adapter (not in the test).** `apply` was enqueuing the
  **Bases property id** (`note.Name`) where the write queue treats its `propertyId` as the **frontmatter key**,
  so the first write would have created a `note.Name:` key and left `Name:` alone — on a real vault, silently.
  `translate()` now enqueues `field.definition.name` (the frontmatter key: `docs/03` §write rules 4 — a rename
  in the `.base` changes the label, never the key on disk), while refusals and the overlay keep the Bases id and
  `getValue()` maps back through the column's own name. Asserted directly:
  `Object.keys(frontmatterOf('Notes/A.md')) === ['Name','Status']`.

- **ASSUMED — the entire data path.** No real vault exists in this environment, so nothing here has been
  observed against Obsidian: the fixture host is a stand-in for `BasesView`, not evidence about it. The step's
  real-vault observation (the placeholder's row/field counts, three formatted values, and one property's
  frontmatter before/after) is **not produced**, and no fixture is offered as a substitute. `DEV-NOTES.md`
  carries the exact click-path for whoever runs it, including the temporary `spike-set-cell` command — which
  must be deleted in the same commit that adds it, which is why it is not in this commit.

- The `.base` sidecar **can** store what `docs/03` §view config lists, checked in `obsidian.d.ts @1.13.1`
  before any view-config code was written, because the step's STOP clause asks:
  `BasesViewConfig.get(key)` / `set(key, value)` / `getAsPropertyId` / `getEvaluatedFormula` (`@since 1.10.0`),
  `getOrder()`, `getSort()`, `getDisplayName()`. **No STOP was needed.** Two related facts:
  `BasesView.config.set` is the documented "store configuration data for the view" path (it travels with the
  `.base`), and `@since 1.13.0` adds a **declarative** settings surface (`PluginSettingTab.getSettingDefinitions()`,
  which `eslint-plugin-obsidianmd` already nags about) — step 14 should adopt it, or say why not.

- Interpretations worth recording:
  1. **`order()` reads `data.properties`** ("visible properties defined by the user", `@1.10.0`) and falls back
     to `config.getOrder()` when a view has no explicit order yet, so a fresh view shows columns instead of an
     empty header. Both are the `.base` view config per `docs/03`.
  2. **The external-change subscription is the app's own `metadataCache.on('changed')`**, filtered to paths
     currently in the row set and released with `offref()` in `dispose()`. The step's STOP clause asked what to
     do if frame coalescing needs a `window` listener: this is the answer — the emitter is owned by the app,
     there is no global listener to leak, and `onDataUpdated` remains the primary trigger. The default frame
     scheduler uses `window.requestAnimationFrame` inside a window and a microtask hop outside one (a node
     test), documented at the constant; every test that cares injects its own `schedule`.
  3. **`createNote`'s filename rule**, following `docs/03` §row creation: expand the template; an **empty or
     blank** template is the documented fallback (`Row <n>`); a template that could not be filled (a
     placeholder key the row has no value for) gets one second chance — the leading column's value — then
     `Row <n>`; whatever wins is sanitised, and an empty result is `Row <n>`.
  4. **Collisions append `" 2"`, `" 3"`, …** per `docs/03` line 99, and the count is reported
     (`collisions`, `renamed`). `prompts/step-12` item 5 illustrates the same case as `Project plan (1)`; the
     doc is the spec, the parenthesised form is not implemented, and this is reported as a prompt/doc
     divergence for a decision rather than quietly split down the middle.
  5. **The manual path runs only for `mode: 'direct'`** (a specific folder, or a bulk import), because
     `createFileForView` opens the new-note **menu** per call (`@since 1.10.2`, step 10's finding) — 412 modals
     is not a feature. `CreateNoteResult.via` reports which path ran, so a failure is always attributable.
  6. **The port gained `dispose()`** (`src/adapters/RowSource.ts`): the step's item 1 requires the source to
     release everything, and the port is what a caller holds. One method, with the reason in its doc comment.
  7. **The view's factory is the composition root**: `main.ts` builds the environment (clock, timezone,
     locale) once, registers `view.dispose()` with `Component.register`, and the view keeps the container the
     factory was handed — `BasesView` still declares no `containerEl` (step 10's finding).

- Findings worth keeping (the docs did not say, or said differently):
  1. **`docs/02` §Rows become notes** should state that the sanctioned `createFileForView` path opens a menu
     and is therefore **single-row only**; bulk creation (paste, import, migration) must use
     `vault.create` + `processFrontMatter`. `docs/03` §Import needs the same line. *(reported, not applied —
     doc edits await approval, as the step asks)*
  2. Step 10's three proposed corrections are unchanged and still unapplied (no `containerEl` on `BasesView`;
     no public Obsidian version; the `GroupedData`/`data.properties` reading). They are listed in
     `spike/bases-path/FINDINGS.md` with the exact replacement sentences.

- Assumed / not verified (step 12):
  1. The real-vault observation itself (above). Everything about the real `BasesView` beyond the declaration
     text is unverified, including whether `data.properties` is already in the user's column order.
  2. `BasesViewConfig.set`'s on-disk format (a string in the `.base` view section) is assumed from `docs/03`
     §`fieldOptions shape`; the spike never wrote one.
  3. A metadata change caused by the plugin's **own** write is untested here. Frame coalescing bounds it to one
     repaint, and the queue's `settle` removes the overlay value before the frame runs — but a real vault is
     where a self-notify loop would show up.
  4. `frontmatterBody` is a deliberate one-line-per-key writer, not a YAML library: ten quoting cases are
     asserted and nested structures are out of scope by design (`docs/03` §write rules 6 — no objects in
     frontmatter).
  5. `plugin/TablifyView.ts` is at 54 % coverage on purpose: its DOM body is replaced in step 17, and the
     interesting part (`summarize`) is a pure function.

- Files touched this step: new — `src/adapters/bases/BasesSource.ts`, `src/adapters/notes/createNote.ts`,
  `src/plugin/TablifyView.ts`, `src/plugin/DEV-NOTES.md`, `tests/unit/bases-source.test.ts`,
  `tests/unit/create-note.test.ts`; changed — `src/adapters/RowSource.ts` (`dispose()` on the port),
  `src/plugin/main.ts` (constructs the view; exports `pluginEnvironment()`), `styles.css` (three lines for the
  placeholder), `tests/mocks/obsidian.ts` (`BasesView` gains `app`/`config`/`data`/`allProperties`, `Plugin`
  gains `register`), `tests/unit/bases-registration.test.ts` (the two placeholder assertions, now about the
  real view), `PROGRESS.md`; **deleted** — `src/plugin/TablifyPlaceholderView.ts`, replaced by the real view.

---

- Verified — **step 11** (commands run, observed results):
  - `bun run check` — **exit 0**: typecheck, lint (0 errors; the one pre-existing settings-tab warning),
    `brand-gate: OK — 59 permitted match(es), 0 violations`, `manifest:check: OK`, Prettier clean, tests,
    build, `bundle-size: OK`. **835 tests across 19 files** (was 817 / 18).
  - **The brand gate caught a real violation in this step's own code**: a source comment in `writeQueue.ts`
    named the remote-sync vendor, which is banned in product code (permissions exist only for internal docs).
    Reworded to "the remote-sync client"; the gate is now clean. Recorded because it is the first time the
    gate fired on product code, and it fired on prose, not on a value.
  - **Coverage** (`bunx vitest run --coverage`): all files 93.24 / 91.65; `src/adapters` 85.55 / 92.64 —
    `writeQueue.ts` 93.54 / 89.13, `optimistic.ts` 100 / 100, `RowSource.ts` (types + three helpers) covered
    by the result-shape test.

- The write queue's constants, and where each comes from:
  1. **`DEBOUNCE_MS = 250`** — `docs/02` §write queue, verbatim: "debounce 250 ms, hard flush on blur / view
     close / undo / import".
  2. **`CONCURRENCY = 4`** — the docs say files "may proceed in parallel, bounded by a **documented**
     concurrency limit" and never give the number. Decided here (one in-flight note write each; the vault's
     writer is the bottleneck), exported as a constant, and reported as a gap.
  3. **No retry** — the docs' retry/backoff belongs to the remote-sync client (`docs/02` §sync, `docs/06`
     M3), not to note writes. A failed note write is reported to the caller and its overlay value is dropped,
     so the grid shows the file's real content.

- The five acceptance assertions (paste of the fake-vault results; the whole file is
  `tests/unit/write-queue.test.ts`, 19 tests):
  - **12 writes in a tick ⇒ exactly one `processFrontMatter` call**: `expect(vault.writes).toHaveLength(1)`
    after `clock.advance(DEBOUNCE_MS)`; the write log holds one record whose `after` carries all twelve keys.
  - **Two interleaved writers, nothing lost**: four writes alternating `FromOne`/`FromTwo`, coalesced to one
    call, final frontmatter `{ FromOne: '2', FromTwo: 'b' }` — both writers' last intentions.
  - **A failing callback drops only that property's overlay and other files still land**: `result.ok === false`,
    `result.errors[0].path === 'Notes/Bad.md'`, `vault.writeCount('Notes/Bad.md') === 0`, and the good file
    holds its value. The overlay hook test asserts the pending entry is gone afterwards.
  - **`flush()` resolves after the last write**: a flush with a queued write returns `{ ok: true, written: 1,
    files: ['Notes/A.md'] }`, `queue.pending() === 0`, `clock.pending() === 0`; a second flush writes nothing
    and reports `written: 0`; failures are not reported twice.
  - **Unknown keys and the body survive**: `raw()` before and after differ only in the `Name:` line — every
    other line byte-identical — and unknown keys (`custom`, `tags`) are untouched. Clearing deletes the key
    (asserted with `'Name' in frontmatter === false`), and the fake vault's `modify` — which throws — is
    never reached.

- Assumed / not verified:
  1. **Concurrency 4** is my number, not the docs' (see above).
  2. **Frontmatter comments are not modelled by the fake**, and Obsidian's `processFrontMatter` does not
     promise to preserve them either (`docs/03` promises unknown *keys* survive, which is what is asserted).
     The step-10 spike's write probe is the place a real comment is put through a real vault.
  3. **Nothing here has touched a real vault.** The whole data path is ASSUMED until step 12 wires the adapter
     and the spike's runtime rows land (see the step-10 report).
  4. **The queue is view-scoped**: two views on the same note have independent chains, and cross-view ordering
     is the vault writer's business. Stated in the module header; not tested, because two views need two
     `App`s.

- Findings worth keeping (things the docs did not say, or said differently):
  1. **`docs/02` §the port's `RowSource` has no capability flags** beyond `writable`, while the step prompt
     asks for `readonly`, `canCreateRows` and `canDeleteRows`. All four exist on the port (`readonly` is the
     prompt's spelling of `!writable`), and the doc is the one that should gain the extra three: a grid that
     cannot create rows must not show an "add row" affordance.
  2. **`PropertySchema` was never defined in the docs.** The port declares it as `{ fields: ResolvedField[] }`,
     reusing the type the rest of the core speaks, rather than inventing a second column shape.
  3. **The doc's `flush(): Promise<void>` is implemented as `Promise<FlushResult>`** — a flush that cannot say
     what it wrote or what failed would force every caller to keep a parallel log.

- What step 10 found (declaration-verified, and the reason it is worth reporting):
  1. **`BasesView` declares no `containerEl`.** The only container the API hands a Bases view is the second
     argument of the `BasesViewFactory` (`obsidian.d.ts:1247`); the view class has no such member. Every layout
     contract in `docs/04` assumes the view owns its container, so this belongs in `docs/02` — the exact
     sentence is proposed in `FINDINGS.md`. Proposed correction, reported not absorbed.
  2. **`createFileForView` opens a menu, not a file.** Its own doc comment reads "Display the new note menu for
     a file with the provided filename" (`@since 1.10.2`). It is right for a "New row" button and wrong for the
     412-note import, which needs `vault.create` + `processFrontMatter` — worth a line in `docs/03` §Import so
     step 13 does not reach for the wrong tool.
  3. **The public API exposes no Obsidian version.** There is no version member on `App` or `Vault`; the
     spike's own command says so rather than guessing, and the report asks the human to read Settings ▸ About.
  4. **`QueryController` is an empty class** (`obsidian.d.ts:5315`) — confirmed exactly as `docs/02` claims, so
     all data must come from `BasesView.data`.
  5. **`processFrontMatter` is `@since 1.4.4`, `BasesEntry` really has no write path** (`file` and `getValue`
     are its only members, `685-702`), and `getSort()`'s own comment confirms the payload arrives presorted.
     `docs/02`'s "load-bearing fact of the whole design" holds.

- The op inventory (16 kinds, each with its inverse):

  | Op | Does | Inverse |
  |---|---|---|
  | `setCell` | one cell gets a value | `setCell` with the before-image's value |
  | `setCells` | a block of cells gets values | `setCells` with the row-level before-images, as **one** op |
  | `clearCells` | a selection is emptied | `setCells` with the before-images |
  | `addRow` | a row is created | `deleteRows` |
  | `deleteRows` | rows are deleted (carrying the rows) | `importBlock` — the same rows, values and positions |
  | `moveRow` | one row is dragged | `moveRow` with `from`/`to` swapped |
  | `moveRows` | a block is dragged | `moveRows` with `from`/`to` swapped |
  | `setFieldOptions` | a column's options change | `setFieldOptions` with `from`/`to` swapped |
  | `addField` | a column is created (with its starting values) | `deleteField` |
  | `deleteField` | a column is deleted **with every value it held** | `addField` — restores the data |
  | `renameField` | a column is renamed | `renameField` with `from`/`to` swapped |
  | `resizeColumn` | a column edge is dragged | `resizeColumn` with `from`/`to` swapped |
  | `reorderColumn` | a column is dragged | `reorderColumn` with `from`/`to` swapped |
  | `setGroupCollapse` | a group is collapsed | `setGroupCollapse` with `collapsed` flipped |
  | `setViewConfig` | a view option changes | `setViewConfig` with `changes`/`previous` swapped |
  | `importBlock` | a sheet is pasted or imported | `deleteRows` — one op, one undo step |

- Decisions and interpretations worth recording:
  1. **Coalescing is NOT implemented, and the hook exists unused.** The pack asked for a hook "only when the
     docs say so" and to stop if the docs contradicted themselves. They specify no coalescing at all; they
     specify the opposite shape: `docs/01` line 38 "Undo/redo | All grid operations, including multi-note
     writes, **as one user-visible step**", `docs/02` §Store "a **`Command`** captures the ops it produced
     *and the previous values it overwrote*", and `prompts/step-18` "Every editor: commits **once per finished
     edit** (no write on each keystroke)". One finished edit is therefore one push already; merging pushes
     would *contradict* "one user-visible step". So `createHistory()` defaults to `NEVER_COALESCE`, the hook
     is there for a caller that has the documentation for a different policy, and both halves are asserted —
     including the subtle rule that when commands *do* merge, the **earliest** before-image wins for a cell
     both touch, or undo would restore the value from before the last keystroke instead of before the first.
  2. **Undo depth is 60**, carried from `prototype/js/store.js` (`cap()` returns 60, 12 in its stress mode),
     because **`docs/` names no number at all**. Recorded as a gap: it deserves a line in `docs/01` §undo.
  3. **Three kinds need a `Before`; thirteen are self-inverting.** `setCell`, `setCells` and `clearCells`
     overwrite values they do not know, so the caller captures a before-image (`captureBefore`) exactly as
     `docs/02` says a command does. Everything else carries what its inverse needs: `deleteField` carries the
     column's values, `deleteRows` carries the rows, `setViewConfig` carries the settings it replaced. This is
     the STOP clause's subject — **a column pre-image is not a table pre-image** — so no op needs one.
  4. **`null` means "no key".** Writing `null` removes the cell key rather than storing it, which is the same
     rule `docs/03` §write rules gives the write queue ("clearing a value **removes** the key"). It was found
     by the property test: writing an explicit `null` into a cell that had no key made the state
     not-deep-equal after an undo (two representations of empty), and it would have reached the write queue.
  5. **A move op's `to` is the insertion index *after* the block is lifted out**, and `from` is the block's
     index before the move. That is the convention under which the inverse is a plain swap. Builders
     (`ops/build.ts`) read `from` out of the state and convert the index the user dropped on, because a stale
     `from` is exactly how an undo lands somewhere else — the property test caught that too.
  6. **A view patch that sets a key to `undefined` removes the setting, and the merge omits such keys** rather
     than writing `{ key: undefined }`, so "the same data" keeps the same shape and an undo lands on a
     deep-equal state. `viewConfigOp()` records `previous` for exactly the keys the patch names — the reason
     the builder exists instead of callers assembling patches by hand.
  7. **`apply` is total and reports.** A write into a row that is gone, a delete of a row that is not there, a
     duplicate import, a stale index: each comes back as a `Skipped { op, count, reason }`, never a throw, and
     never silent. The store drops ops that produced a skip instead of pushing them, because the inverse of a
     write that never happened would still overwrite something.
  8. **`clampTo` keeps a surviving endpoint exactly where it is** and re-seats only a vanished one, at the
     index it used to hold (clamped to the shorter list) — that is `docs/07` §Tier 3's "degrades predictably
     (to the nearest surviving row)". An endpoint with no previous position (a row that appeared) is seated at
     the start rather than dropped; a selection with nothing left in it is `null`, which the grid reads as
     "no selection".
  9. **The clipboard is type-blind and never evaluates.** Cells are strings: the caller formats with the
     column's `formatPlain` and parses back with `parsePlain`, so a date or a currency crosses the text
     channel without this module knowing what a date is. A cell starting with `=`, `+`, `-` or `@` is quoted
     in TSV (and marked `mso-number-format:'\@'` in HTML), and **empty text is never re-interpreted**: quoting
     is a mitigation, not a guarantee, and the reader side stores `=SUM(A1:A9)` as text, always.
 10. **One empty cell is written `""`, not an empty string.** Otherwise it is indistinguishable from "nothing
     was copied" and cannot round trip. Two documented losses remain, both asserted in their own tests: a
     final row that is one cell wide and entirely empty (indistinguishable from a trailing newline), and edge
     spaces in HTML (trimmed, because HTML cannot carry them).

- Assumed / not verified:
  1. **The Excel clipboard fixture is constructed, not captured** (ASSUMED, marked in the test): this
     environment has no Excel. The Sheets fixture *is* captured, from the article cited in the test header.
     Both are exercised, and the reader is written to be tolerant rather than to match one payload byte for
     byte.
  2. **`mso-number-format:'\@'` keeping a formula-shaped cell as text in Excel is documented, not tested.**
     Nothing in this environment can paste into Excel. The reader side is unaffected either way.
  3. **The undo depth of 60 and the absence of coalescing are carried from the prototype and the docs' silence
     respectively** (see 1 and 2 above) — both are decisions to confirm, not facts found in a spec.
  4. **Range lookups build an index map per call** (O(rows)); fine for a keystroke on 5,000 rows, and the grid
     can hoist it later if a profile asks. Recorded so it is a known cost, not a surprise.
  5. **Nothing here has met the store yet.** `apply` is called by tests, not by a renderer; step 16 wires it.

- Findings worth keeping (things the docs did not say, or said differently):
  1. **`docs/02` §Store's `Command` has no `label`,** and the UI needs one for "Undo paste 400 rows". This
     build's `Command` carries `label` (and `history.undoLabel()`/`redoLabel()` read it). Worth adding to
     `docs/02` when it is next updated.
  2. **`docs/02` §Store's sketch has `undo(): Promise<void>`; this build's `undo()` returns the ops to run**
     and the store replays them. That is the same design ("Undo replays inverse ops through the same write
     queue"), expressed so the pure core never awaits anything — the async part belongs to the write queue
     (step 11).
  3. **`docs/01` §in scope lists "undo of multi-note writes"** but no depth, no coalescing policy and no
     wording for the menu items — three gaps that a UI step will otherwise invent (see the open questions).
  4. **`prototype/js/io.js` parses the HTML table with the DOM** (`DOMParser`). The core cannot: it is pure
     TypeScript. The reader here is a ~90-line tolerant scanner (comments, `<style>`, `<script>`, `<colgroup>`,
     nested `<div>`s, `<br>`, entities) instead, and the captured Sheets payload is its regression test.
  5. **A nested table inside a cell reads as an empty cell** in that scanner, because text from a nested table
     is skipped rather than guessed at. Asserted, with the reason in the test name.
  6. **`fromTsv` needs the trailing-newline rule to be exactly one row, not "drop all trailing empties"** (the
     prototype drops all). Dropping one keeps a matrix that genuinely ends in an empty row, and it is what
     makes the round trip exact for 13 fixtures instead of 11.

- Open questions for the human:
  1. **Should `docs/01` be given the missing §undo paragraph** (depth 60, one step per user action, the undo
     wording, no keystroke coalescing)? The code is ahead of the docs here, and four prompts will read them.
  2. **Should `docs/02` §Store's `Command`/`GridStore` sketch be updated** to the implemented shape (`label`,
     `undo()` returning ops, `History` as a factory rather than methods on `GridStore`)? (Findings 1–2.)
  3. (unchanged) **`docs/02` §Query and `docs/01` are behind the query layer**; a select column's sort is
     alphabetical rather than option-ordered (step 08, Findings 1–3).
  4. (unchanged) **`@standard-schema/spec` as a types-only devDependency, or the local structural declaration?**
  5. (unchanged) **`docs/04` still has no §cell-rendering section**, which `prompts/step-07` cites.
  6. (unchanged) **`attachment`: write `[[link]]` or the plain vault path?** (current: plain path.)
  7. (unchanged) Layout guard: warning (current) or failing until step 21? Dependabot keeps proposing
     `obsidian` minor bumps. `docs/09` line 33 still contains a banned word in its description template; the
     three candidate plugin descriptions await a pick.

- Next step: `prompts/step-13-tabula-adapter-and-migration.md` — the `.tabula` reader (`v1` and `v2` detected
  from content, never throwing, tolerant of BOM/CRLF/unknown types), the dry-run report as data, and
  `migrateMutation` as ordinary ops so a whole migration is one undo step. Seven committed fixtures under
  `tests/fixtures/tabula/`. Known blocker: the fork clone (`258044aamm-Dev/airtable-tabula`) is needed for the
  on-disk shapes and is not in the workspace after the sandbox recycle — it needs re-cloning or the shapes
  come from the table recorded in this file.

- Files touched in **step 11**: new — `src/adapters/{RowSource,writeQueue,optimistic}.ts`,
  `tests/unit/write-queue.test.ts`; changed — `PROGRESS.md`. Nothing outside `src/adapters/**`,
  `tests/**` and `PROGRESS.md`.
- Earlier step 10 files: new — `spike/bases-path/{manifest.json,main.ts,write-test.ts,tsconfig.json,build.mjs,README.md,FINDINGS.md}`;
  changed — `eslint.config.mts` (one line: `spike/**` in `globalIgnores`, which the prompt's own fence asks
  for), `PROGRESS.md`. Nothing in `src/`, `tests/` or `scripts/`. The spike is throwaway by design: the report
  ends with the instruction to delete the folder and fold the verified facts into `docs/02`.

- Files touched this step: new — `src/core/ops/{types,apply,inverse,build,history}.ts`,
  `src/core/selection/{range,clipboard}.ts`, `tests/unit/{ops-fixtures.ts,ops.test.ts,ops-inverse.property.test.ts,selection.test.ts,clipboard.test.ts}`;
  changed — `PROGRESS.md`. Nothing outside `src/core/**`, `tests/unit/**` and `PROGRESS.md`. `ops/build.ts` is
  a fifth source file beyond the step's four: the builders that read an inverse's input out of the state
  (findings 4–6) are the reason `inverse.ts` stays about inverses.

- Earlier steps: 08 the query layer (one AST, the DSL, the evaluator, the filter→search→sort→group pipeline;
  746 tests, `core/query` 91 %); 07 the fifteen remaining field types and the registry-wide suites (500
  tests); 06 the field contract, the schema and the registry (115 tests); 05 fakes and boundaries; 04 CI and
  release; 03 the plugin shell; 02 manifest and legal; 01 toolchain and gate. Forced amendments are recorded
  in `prompts/README.md` under "Amendments applied during execution".
