# R6 — Remove legacy paths, verify, and release

**Mode:** documentation and future implementation guide. No source code, manifest, version, or release changes are authorized by this document update. **Dependencies:** R0–R5 are complete and accepted.

## Objective

Finish the cutover by deleting Bases and `.tabula` implementation paths, removing stale active instructions, proving the `.tablify` file view works in real Obsidian, and releasing a distinct verified build. Historical evidence is preserved; it is not a compatibility promise.

## Step-by-step finalization

### Step 1 — Confirm native cutover readiness

Before deleting old code, verify in a scratch vault and automated suite:

- create/open/reopen a multi-table `.tablify` file;
- edit and undo across rows/tables, preserve saved views/relationships;
- import/export CSV/TSV/XLSX;
- perform manual Airtable pull/push and conflict review for a `.tablify` table;
- complete desktop and physical-phone run-throughs;
- no functionality still depends on a Bases query/view or a Markdown-note row.

Do not remove the only working grid path until the replacement is independently validated; do not ship a dual mode after cutover.

### Step 2 — Remove Bases integration

Delete/replace the actual code paths identified in the master plan:

- `src/adapters/bases/**` and Bases-only source kinds;
- `src/plugin/TablifyView.ts` Bases inheritance, `registerBasesView`, `BASES_LEAF_TYPE`, active Bases-leaf lookup/registry, disabled-plugin notice, `.base` config writes;
- Bases property IDs/property-source/frontmatter parsing and note-created timestamps in core;
- note creation/import/settings code that exists only to turn spreadsheet rows into Markdown files;
- test fakes/fixtures and boundary exceptions whose only purpose was Bases behavior.

Keep Obsidian APIs still required for custom file views, workspace leaves, vault text files, settings, commands, notices, modals/menus, and `SecretStorage`. Do not remove the `obsidian` dev dependency.

### Step 3 — Remove legacy `.tabula`

Delete `.tabula` model/parser/migration modules and wizard/command/setting paths, their fixtures and tests. Retain only truthful, concise release/history statements such as “0.1.0 supported a legacy path; the native refactor does not.” Do not leave disabled buttons, unused adapters, a hidden “read-only” file view, or orphaned documentation that promises migration.

### Step 4 — Clean development artifacts and gates

- Delete the throwaway `docs/legacy/spike/bases-path/**` after preserving relevant audit facts in this plan or a clearly historical note.
- Remove obsolete `Bases` brand allowlist entries and adjust Base-specific lint/build/brand scripts with tests. Do not ban Airtable’s `baseId` or historical text.
- Update source/test import-boundary rules for `tablifyFile` and the database repository; assert that core remains pure and sync stays provider-agnostic.
- Run targeted grep over shipped TypeScript, styles, active prompts/docs, manifest description, issue templates, and release copy. Classify each remaining `Bases`, `.base`, `.tabula`, or frontmatter hit: historical statement, remote Airtable term, intentional negative test, or stale product dependency.

### Step 5 — Update active docs and public copy after behavior is real

- README describes the native `.tablify` plugin only after the release includes it; include the old `.base`/`.tabula` no-migration notice, offline/network disclosure, linked record support, formulas deferred, and CSV export.
- Update manifest/package descriptions, version files, documentation screenshots/manual, issue templates, settings text, docs/01–12, `AGENTS.md`, `START-HERE.md`, prompts, and developer notes together.
- Preserve `CHANGELOG.md`’s `0.1.0` entry, `PROGRESS.md` historical gates, old screenshots only if clearly labelled, license/NOTICE attribution, and the `0.1.0` tag.
- Add a dated unreleased/current version changelog section for the breaking refactor. Do not claim migration or support for old data.

### Step 6 — Run automated verification

At minimum, run the existing `bun run check` and `bun run test:layout`, plus the new format/repository/link/sync test matrix. Verify a clean checkout and release workflow using a distinct version/tag. Do not loosen tests or remove assertions to pass.

### Step 7 — Complete manual verification

Copy the new template in `docs/manual-test-log.md`; record exact Obsidian version, plugin build SHA, device, OS, and result. Test:

- fresh dev vault with Bases disabled;
- create a `.tablify`, multiple tables/views, link editing, save/reopen, rename/move;
- desktop file-change conflict / two panes;
- phone keyboard, focus, safe area, scroll, long-press, screen reader where available;
- spreadsheet import/export in real Excel/Sheets or compatible apps;
- Airtable pull/push and deliberate conflict with a non-production/scratch base, if credentials/test data are available;
- old `.base`/`.tabula` files untouched and no false “migration succeeded” message.

A non-run check remains `NOT RUN`; do not infer pass from the browser harness.

### Step 8 — Release safely

- Keep id `tablify` and never alter the existing `0.1.0` tag/release.
- Select a new version/tag under the repository’s versioning policy and label the first build a prerelease if real device checks or review remain incomplete.
- Ensure manifest, package metadata, `versions.json`, tag, changelog, and three separate Obsidian release assets agree.
- Community submission remains blocked until the intended release gates are complete; do not call the plan itself a release.

## R6 exit criteria

- Shipped code has one native editable local data path: `.tablify` JSON.
- No runtime Bases view/adapter, `.base` view-config read/write, note-row storage, `.tabula` reader/migration, or legacy import mode remains.
- Airtable manual sync still works against local table IDs and uses `SecretStorage`; “Airtable base” remains only as remote terminology.
- Active docs and product metadata match the code; historical records are labelled and factually accurate.
- Automated checks and real-device/vault test log are complete, with assumptions/known limits stated.
- A distinct release is prepared without rewriting history or claiming old-data migration.

## Progress log (executed, 2026-10-08)

- **Step 1 (readiness), automated part VERIFIED** by the existing suite: multi-table `.tablify` create/open/reopen, edit and undo, CSV/TSV/XLSX import and export, and the Airtable pull/push with conflict review, all green at `8043719`. **NOT RUN:** the scratch-vault and desktop/phone run-throughs in Obsidian (Step 1 and Step 7).
- **Step 3, slice 1 (`.tabula`), LANDED.** Removed: `src/adapters/tabulaFile/**`, `src/core/migrate/**`, the `.tabula` reader and migration tests, the wizard's “Keep as .tabula file” action and its disabled reason, the `.tabula` sentences in the paste and empty-state copy, the `legacy.showMigrationEntryPoints` setting and its section, and the `legacy` key from the settings validator. An old settings file that still has `legacy` loads with defaults, keeps the key, and says so once (the existing passthrough warning, unchanged). The R3 inventory report was regenerated from the tree (`scripts/r3-inventory.ts --write`). Assertions that expected `.tabula` text or the escape-hatch action now assert that they are gone.
- **Gates for slice 1:** `check` 104 files / 2088 tests, bundle 247398 bytes gzip; layout 115/115.
- **Still open:** Step 2 (Bases view, `TablifyView` Bases inheritance, `src/adapters/bases`, the legacy note-row import, the legacy sync path); the grid store's note-row shape; Steps 4–8.
- **Step 2, slice 2a (legacy Bases view and legacy sync/import), LANDED.** Removed from `main.ts`: the Bases view registration, the live-view and sync-host tracking, the legacy status-bar badge, the “Open the sync panel” command, and the legacy type and constant declarations. Removed 74 modules that the reachability trace from `src/plugin/main.ts` shows the shipped bundle cannot reach, plus the legacy tests, `harness/`, `tests/layout/`, `playwright.config.ts`, `tests/fakes/noteStore.ts`, and the `harness:*` and `test:layout` scripts. `tests/unit/startup.test.ts` was rewritten for the native-only startup path (zero native-sync evaluations at startup, with and without a link file). `plugin-smoke` now expects four commands. The R3 floor for scanned files was lowered from 50 to 30 with the reason in the test. The inventory was regenerated.
- **Decisions (user, via ask_user):** the layout suite is retired with the legacy grid. The native grid's layout coverage is a **gap**, to be covered by a native harness later. React is kept for now. The sync panel command and status-bar badge are removed.
- **Kept as test-only leftovers, to remove later:** `src/grid/store/commands.ts`, `src/core/query/parse.ts`, `src/core/query/serialize.ts`, `src/core/ops/build.ts`, `tests/unit/ops-fixtures.ts`. The `@playwright/test` devDependency is kept, so the lockfile is unchanged.
- **Gates for slice 2a:** `check` exit 0; 81 files and 1691 tests; lint clean; bundle 134223 bytes gzip, down from 247398 (the legacy code is gone). Layout suite: retired. **NOT RUN:** Obsidian host and device checks.
- **Still open:** `.tabula` gates (slice 1 has not been gated separately; it is gated by this run). `RowSource` and `adapters/notes`; the grid store's note-row shape; `src/grid/store/selectors.ts` still imports React, so React removal is blocked; Steps 4–8.
- **Step 2, slice 2b (dead grid-store factory and the `RowSource` port), LANDED.** Removed: `createGridStore` and its options type from `src/grid/store/store.ts` (the module keeps only the `cellAt` and `isPending` read helpers, which the clipboard matrix and selectors use); the `RowSource` interface and its `bases | tabula-file` kind from `src/adapters/RowSource.ts` (the shared result and row-id types stay, because native sync, the overlay and the write queue use them); the `source` field from `GridState`; and the tests and fake that drove the factory (`tests/dom/store.test.ts`, `tests/dom/store-render.test.ts`, `tests/fakes/rowSource.ts`). Two R3 floors were lowered again, with reasons in the tests: scanned files 39 against a floor of 30, and marker occurrences 455 against a floor of 300.
- **Proof of no shipped change (VERIFIED):** unminified bundles built from HEAD and from the working tree were split by module. Every module body is identical except `src/grid/store/store.ts`, whose only content was one `init_pipeline()` call. `core/view/pipeline.ts` has no top-level statements, so that call has no side effects. The minified `main.js` differs only in minifier-generated helper names, so a byte compare was not a usable check.
- **Gates for slice 2b:** `check` exit 0; 79 files and 1667 tests; lint clean; bundle 134202 bytes gzip. **NOT RUN:** Obsidian host and device checks.
- **Coverage loss (OPEN):** the removed render test was the only direct test of the React hooks in `src/grid/store/selectors.ts`. That module is still in the shipped bundle, unchanged. A test of those hooks against the native grid is needed before React can be removed.
- **Next, not yet done (OPEN):** `runExport` in `src/plugin/export/runExport.ts` has no shipped caller. Its legacy pipeline (`exportTable`, `runExport`, `refusalFor`) is tested only by `tests/unit/export.test.ts`. Also OPEN: `property.source === 'note'` legacy property sources in `src/core/schema/propertySchema.ts`; the name `RowSource.ts`; and `src/grid/store/selectors.ts` React imports.
- **Step 2, slice 2c (grid-store export runner and the layout module), LANDED.** Removed: `exportTable`, `runExport`, `refusalFor`, and their types from `src/plugin/export/runExport.ts` (the module keeps the folder and prefix constants, `stamp`, and `freePath`, which the native export panel uses); the runner's tests in `tests/unit/export.test.ts`, replaced by direct tests of `stamp` and `freePath`, including the 999 ceiling, so the live naming logic stays covered; and `src/grid/layout.ts`, which had no importers left after slice 2b.
- **Proof of no shipped change (VERIFIED):** the same module-by-module comparison of unminified bundles, from HEAD and from the working tree. Every module body is identical except `src/plugin/main.ts`, whose only difference is React's license banner. `selectors.ts` and React are no longer in the shipped bundle, because the runner was their only shipped importer. The bundle has no `react/jsx-runtime` or `react-dom` reference. No shipped module depends on React.
- **Gates for slice 2c:** `check` exit 0; 79 files and 1665 tests; lint clean; bundle 130970 bytes gzip. **NOT RUN:** Obsidian host and device checks.
- **Decision recorded:** the earlier answer “keep React for now” still stands. React is no longer shipped, but `package.json` and any tests that import React are unchanged. Removing the dependency is a separate decision for the user.
- **Next candidate (OPEN, not done):** the reachability trace now lists 14 modules as dead: `adapters/optimistic`, `core/ops/apply`, `core/ops/build`, `core/ops/history`, `core/ops/inverse`, `core/query/parse`, `core/query/serialize`, `core/selection/range`, `grid/clipboard/host`, `grid/clipboard/matrix`, `grid/store/commands` and others. Some are test-only leftovers already recorded. The rest need their own slice, because `core/selection` and `core/ops` may still be shared.
- **Still open:** `property.source === 'note'` legacy property sources in `src/core/schema/propertySchema.ts`; the `RowSource.ts` file name; and the coverage of the React hooks removed in slice 2b.
- **Step 2, slice 2d (the modules the trace shows the shipped bundle cannot reach), LANDED.** Removed: `src/grid/clipboard/host.ts` and `matrix.ts`; `src/grid/store/store.ts`, `types.ts`, `selectors.ts`, and `commands.ts`; `src/core/ops/apply.ts`, `history.ts`, `inverse.ts`, and `build.ts`; `src/core/selection/range.ts`. Also removed the four tests that exercised only those modules: `tests/dom/clipboard-host.test.ts`, `tests/unit/ops-inverse.property.test.ts`, `tests/unit/ops-fixtures.ts`, and `tests/unit/selection.test.ts`.
- **Importer check (VERIFIED):** every importer of each removed module, resolved from the actual import specifiers across `src`, `tests`, and `scripts`, was itself removed. The few exceptions were test files, and those tests were removed too.
- **Kept, with reasons (OPEN):** `src/core/query/parse.ts` and `serialize.ts` are still imported by `tests/unit/pipeline.test.ts` and `query-table.test.ts`, which test live code. `src/adapters/optimistic.ts` is still imported by `tests/unit/write-queue.test.ts`. All three are dead in the shipped bundle, and they are the next test-only dependencies to remove.
- **Proof of no shipped change (VERIFIED):** unminified bundles from HEAD and from the working tree were compared module by module. Both contain the same 230 modules, and no module body differs. The minified bundle is 130,970 bytes gzip, the same as slice 2c.
- **React (VERIFIED):** no file under `src/` imports React now. The only remaining imports are in two tests, `tests/unit/boundaries.test.ts` and `tests/dom/focus-contract.test.tsx`. `package.json` still lists `react` and `react-dom`. The earlier decision to keep React for now still stands.
- **R3 floors changed (decision recorded):** the count floors (files 30, occurrences 300) fell as legacy code was removed. The guard now names four files that must stay in the scan: `src/sync/pullPush.ts`, `src/adapters/writeQueue.ts`, `src/core/query/evaluate.ts`, and `tests/mocks/obsidian.ts`. The occurrence check is only “greater than zero”.
- **Gates for slice 2d:** `check` exit 0; 76 files and 1631 tests; lint clean; bundle 130970 bytes gzip. **NOT RUN:** Obsidian host and device checks.
- **Still open:** `property.source === 'note'` legacy sources in `src/core/schema/propertySchema.ts`; the `RowSource.ts` file name; the `writeQueue`/`optimistic` pair, which is test-only in practice; and the coverage lost with the removed React render test.
- **Step 2, slice 2e (the queue and overlay that only the removed store used), LANDED.** Removed: `src/adapters/writeQueue.ts` (the frontmatter write queue; its runtime had no caller left), `src/adapters/optimistic.ts` (the overlay), and `tests/unit/write-queue.test.ts`. From `src/adapters/RowSource.ts` removed `applyResult`, `describeApplyResult`, and `EMPTY_APPLY_RESULT`, which had no callers outside that test. Kept the live types `RowId`, `PropertySchema`, `Refusal`, `ApplyError`, and `ApplyResult`. `settings/save.ts` now defines its two-method `TimerPort` locally, with the same shape.
- **Proof of no shipped change (VERIFIED):** module-by-module comparison of unminified bundles, HEAD against the working tree. Both contain the same 230 modules and no module body differs. The minified bundle is 130,970 bytes gzip.
- **Gates for slice 2e:** `check` exit 0; 75 files and 1612 tests; lint clean. **NOT RUN:** Obsidian host and device checks.
- **R3 guard:** the named file `src/adapters/writeQueue.ts` was removed, so the guard now names `src/sync/SyncTarget.ts`. The guard was designed to fail in this case.
- **Decision needed (OPEN):** the legacy property sources `note`, `file`, and `formula`, and `propertyFromBasesId`, in `src/core/schema/propertySchema.ts`. The shipped code passes only `source: 'database'`, and `propertyFromBasesId` has no caller. But 11 test files use the legacy sources as fixtures, so removing them needs a fixture rewrite.
- **Decision needed (OPEN):** `src/core/query/parse.ts` and `serialize.ts` are used by `tests/unit/pipeline.test.ts` and `query-table.test.ts` (33 call sites) to test live query and view code. Removing them needs those tests rewritten.
- **Decision (user, delegated):** remove the legacy property sources and the query-string parser deeply, while keeping every feature a user can reach unchanged.
- **Plan for the next slice (not started; one coherent change, because the tests use both):**
  1. `src/core/query/parse.ts` and `serialize.ts`, and the native view's query. The native view stores a structured `filterExpr` and never parses text (`NativeDatabaseGrid` passes `view.filterExpr` to `buildView`). Rewrite `tests/unit/query-table.test.ts` (44 text cases, 25 tests, parser-specific round-trip and error tests) and the 6 call sites in `pipeline.test.ts` to build expression literals with `core/query/ast.ts` helpers. Delete the parser-only tests.
  2. `src/core/schema/propertySchema.ts`: narrow `PropertySource` to `'database'`. Remove `propertyFromBasesId`, `fileTimeFieldFor`, and the `readOnlyBySource` branch. For every value the shipped code can produce (`source: 'database'`), each removed branch evaluates to its default, so the behaviour is unchanged. Prove it with the module comparison.
  3. Convert the 39 legacy fixture sites in 11 test files to `source: 'database'`. Delete the assertions that exist only to test legacy file metadata.
- **Gate for that slice:** `check`, the module-by-module bundle comparison, and a tsc check that no `'note'`, `'file'`, `'formula'`, or `'unknown'` source literal remains in `src` or `tests`.
- **Step 2, slice 2f (legacy property sources and the query-string parser), LANDED.** Removed: `src/core/query/parse.ts` and `src/core/query/serialize.ts`. The only producer of text-built filters was the parser, and the shipped code never builds a filter from text: native filters come from stored documents through `decodeQueryDocument`. In `src/core/schema/propertySchema.ts`, `PropertySource` is narrowed to `'database'`. Removed: `propertyFromBasesId`, `normalizeName`, `fileTimeFieldFor`, `CREATED_NAMES`, `MODIFIED_NAMES`, `LEGACY_STORED_NAMES`, and the `readOnlyBySource` branch. The `databaseTime` source check is now unconditional, because every shipped column is `database`.
- **Tests rewritten, not deleted for coverage:** `tests/unit/query-table.test.ts` builds each expression with the `ast.ts` helpers. Operands are read by the column's own `parsePlain`, except text operators, which take raw text. The generated per-type table now evaluates its hand-built expected AST, and it still checks the answer against the column's own `matches`. The behaviour table keeps all 36 rows as expressions, and the unparsed-fragment rule keeps its own test. Deleted with the syntax they tested: the bad-input text table, the parser-totality fuzzer, and the serializer round-trips. `tests/unit/pipeline.test.ts` builds its six filters the same way. `tests/unit/property-schema.test.ts` drops the legacy file-metadata tests, keeps the user-typed "Created" rule, and adds a native `createdTime`/`lastModifiedTime` read-only test. The 39 legacy fixture sites in 11 files now use `source: 'database'`. `core-fields.test.ts` keeps its raw `source: 'formula'` key, because that test checks that unknown keys are reported.
- **Proof of no shipped change (VERIFIED):** unminified bundles from HEAD `45e204f` and from the working tree were built with the project's own esbuild options (browser, es2018, automatic JSX, the same externals) and compared module by module. Both contain 230 modules, none added or removed. Only `src/core/schema/propertySchema.ts` differs, and its diff contains only the removals listed above. The removed branches were dead in the shipped build, because every column is `database`.
- **Reachability (VERIFIED):** `src/plugin/main.ts` reaches LIVE 108 and DEAD 0. Before this slice it was LIVE 108 and DEAD 2 (the two parser files).
- **R3 inventory (VERIFIED):** regenerated with `scripts/r3-inventory.ts --write`. The guard test passes.
- **Gates for slice 2f:** `check` exit 0; 75 files and 1571 tests; lint clean; `tsc` exit 0; bundle 130715 bytes gzip, down from 130970. Prettier was applied to the two rewritten test files. **NOT RUN:** Obsidian host and device checks, and the real Airtable and Excel/Sheets checks.
- **Still open (OPEN):** `src/core/ops/types.ts`; `src/core/export/serialize` helpers (unclassified); `src/sync/SyncTarget.ts` comments that mention `RowSource`; the `@playwright/test` devDependency; the names `RowSource.ts` and `store.ts`; React in `package.json` and two tests (kept by the user's decision); the native-grid coverage gap. `unparsedOf` in `ast.ts` is now used only by tests. It remains because the evaluator handles the `unparsed` node kind, and that node must stay correct for stored documents that might carry one (VERIFIED that `evaluate.ts` handles it; whether `decodeQueryDocument` can produce one is OPEN).
- **Step 2, slice 2g (comments and developer notes), LANDED.** Comment-only change. Removed stale references to the Bases adapter, the `.tabula` reader, and the legacy file-metadata columns from comments that described removed code. Rewrote `src/plugin/DEV-NOTES.md` so it describes the current tree. Module comparison against the slice 2f commit: 230 modules, no body changed.
- **Step 4 items, slice 2h, LANDED.**
  - The throwaway probe `docs/legacy/spike/bases-path/` is deleted. Its audit record (`FINDINGS.md`, with the declaration evidence) is kept as `docs/legacy/archive/bases-spike-findings-2026-10.md`, with a historical banner. The `PENDING-RUN` rows were never run and stay so.
  - The Bases brand entry is removed from the ESLint sentence-case rule. No shipped UI text uses that word.
  - Import boundaries: the core may not import the adapters, sync, plugin, or grid layers (verified: zero current violations). The sync engine may not import the Airtable provider folder (verified: zero current violations). Each rule has a probe in `tests/unit/boundaries.test.ts`, including one that the provider folder itself stays importable. Named brand-gate permissions cover the lines that must name the provider.
  - Fixed a lint warning left by slice 2f: an unused binding in `tests/unit/pipeline.test.ts`. The earlier check runs printed it, and I missed it.
- **Gates for slice 2h:** `check` exit 0; 75 files and 1574 tests; lint clean with no warnings; bundle 130715 bytes gzip, unchanged. Module comparison: 230 modules, no body changed. Reachability: LIVE 108, DEAD 0. **NOT RUN:** Obsidian host and device checks.
- **Kept on purpose (OPEN):** `LinkStore.ts` stores the Airtable link fields under an `airtable` key. That key is the on-disk link format, so renaming it would break existing links. It is data, not an import. The sync engine's provider-agnostic rule covers imports only.
- **Historical text kept (VERIFIED by grep):** the archived prompts and `PROGRESS.md` still mention the deleted spike folder. They record past work and are not active guidance.
- **Decision (user, via ask_user): version 1.0.0** for the native release. The version is plain `x.y.z`, as the manifest validator requires, so the prerelease status is carried by `.github/prerelease`, not by the version string. I recommended 0.2.0 as the conservative pre-1.0 choice; the user chose 1.0.0 and this log records that choice. Because device checks are NOT RUN, the release is published as a GitHub prerelease, as Step 8 requires.
- **Step 8 is not started.** Cutover edits (manifest, package, `versions.json`, changelog section, README, `docs/09-publishing.md`), the prerelease marker, and the tag all wait on an audit of the README feature claims against the code. The R5 log still says XLSX reading and the native wizard are deferred. The code has `src/plugin/nativeImport/workbookReader.ts` and `NativeImportPanel.ts`, so that line is stale and must be corrected before any claim is made.
- **Step 6 note:** `bun run test:layout` does not exist in `package.json`. The layout suite was retired by the user's decision in slice 2a, so Step 6 runs `bun run check` only, and the layout gap stays OPEN.
- **Release blocker found by the README feature audit (VERIFIED by reading `src/plugin/NativeDatabaseGrid.ts`, `TablifyFileView.ts`, and `nativeImport/`).** The 1.0.0 cutover is on hold. R4 says it "is not complete if a native file opens but key existing workflows disappear." The native grid today implements: arrow navigation, Home/End (with Ctrl), Enter and F2 to edit, Escape, Tab in the editor, toolbar undo and redo, toolbar import and export (CSV, TSV, XLSX, HTML reading), grouping, the Airtable sync panel, and conflict review. It does **not** implement: range or multi-cell selection and shift-extend (Shift only reverses Tab), copy, paste, cut, clear, fill down or right, bulk column edit, type-to-replace, select-all, Space to toggle a checkbox, PageUp and PageDown, and add, duplicate, or delete row. Those are 0.1.0 features that a user would lose. The README's current keyboard table and feature list therefore describe the 0.1.0 build and cannot be carried over to the native release unchanged.
- **Decision needed (OPEN):** either finish the R4 workflows before cutover, or ship a prerelease that explicitly lists these as known regressions (which waives the R4 rule). This is recorded here and was raised with the user.

### R4 slice A: keyboard clear of the active cell

- **Change:** Delete and Backspace clear the active cell in `NativeDatabaseGrid.ts`, through `clearActiveCell`. A text or date cell writes a `set-cells` edit with `null`. A link cell writes `set-link` with no rows. Each clear is one store operation, so one Undo restores it. A cell that is already empty dispatches nothing.
- **Test:** `tests/dom/tablify-file-view.test.ts`, "native grid keyboard clear". It clears "Shoots 1" with Delete, checks the cell is empty, clicks the toolbar Undo, and checks the text is back. It fails without the grid change.
- **Gates:** `check` exit 0; 75 files; 1575 tests; bundle 130975 bytes gzip. Module comparison against `1fb2a7d` (same directory, grid stashed): 230 modules, only `src/plugin/NativeDatabaseGrid.ts` changed. Reachability: LIVE 108, DEAD 0. **NOT RUN:** Obsidian host and device checks.
- **Still missing from the gap list:** range and multi-cell selection, copy/cut/paste, fill, bulk edit, type-to-replace, select-all, Space checkbox toggle, PageUp/PageDown, and add/duplicate/delete row. The release stays blocked until these land.
- **Environment note:** the workspace was reset to `45e204f` again. It was restored to `origin/refactor/native-tablify` (`1fb2a7d`), and the slice was reapplied from a saved patch. The remote had to be re-added.

### R4 slice B: range selection

- **Change:** Shift+Arrow extends a rectangular range from the anchor cell (the cell where the range started) to the active cell. Escape clears the range, and so does any other key, a click, or Enter/F2. Cells inside the range get `is-in-range` and a matching highlight in `native-workspace.css`. Without Shift the grid behaves as before: plain arrows, Home/End, and Enter/F2 are unchanged.
- **Delete with a range:** clears every editable cell in the rectangle. Read-only cells and already-empty cells are skipped. The clear is one batch dispatch, so one Undo restores the whole range. The slice A single-cell clear now goes through the same path, and it also skips read-only cells instead of sending a refused edit.
- **Test:** `tests/dom/tablify-file-view.test.ts`, "native grid keyboard range". Shift+ArrowDown selects two cells, Delete empties both, one Undo restores both, and Escape drops the highlight. The test fails on the slice A grid.
- **Gates:** `check` exit 0; 75 files; 1576 tests; bundle 131450 bytes gzip. Module comparison against `74a0e57`: 230 modules, only `NativeDatabaseGrid.ts` changed. Reachability: LIVE 108, DEAD 0. **NOT RUN:** Obsidian host and device checks.
- **Not in this slice:** Shift+click, Ctrl/Cmd+A, and copy/paste over a range. Those are slices C and E.

### R4 slice C: copy, cut, and paste

- **Change:** `copy`, `cut`, and `paste` listeners on the native grid, using the existing `src/core/selection/clipboard.ts` codec. Copy writes TSV and HTML for the range. Cut copies, then clears the range as one batch. Paste parses the clipboard matrix with the column's own `parse` and `toJson`, the same path a typed edit takes. The matrix starts at the range's top-left cell.
- **Limits, by design:** link columns are not copied or pasted, and a notice counts them. Read-only cells, text that does not fit its column, and cells past the table edge are skipped, and a notice counts them. An invalid stored value copies as an empty cell. Pasting one cell into a larger range does not fill it (that is slice D). Cut leaves link columns alone.
- **Test:** `tests/dom/tablify-file-view.test.ts`, "copies, cuts and pastes the range as TSV and HTML, one undo step per action". It copies two cells, checks TSV and the HTML round trip, cuts and undoes, pastes two lines and undoes, and pastes `=1+1` as text. The test fails on the slice B grid. The HTML codec round-trips the test matrix exactly.
- **Gates:** `check` exit 0; 75 files; 1577 tests; bundle 132397 bytes gzip. Module comparison against `37591f4`: 230 modules. Raw comparison shows 10 changed modules. Normalising esbuild's `import_obsidianN` alias numbers (the grid now imports `Notice`) leaves 2: `NativeDatabaseGrid.ts`, and `clipboard.ts`, which gains 15 lines and loses none (the HTML writer is now reachable). Reachability: LIVE 108, DEAD 0. **NOT RUN:** real Ctrl+C/Ctrl+V in Obsidian on desktop and mobile, and paste from Excel and Sheets.
- **Environment note:** the reset helpers `/tmp/cmp/*` and `/tmp/reach.py` were recreated. The reach trace is a rewrite. It gives the same baseline (LIVE 108, DEAD 0) on the same tree.

### R4 slice D: fill down, fill right, and paste expansion

- **Change:** Alt+D fills down and Alt+R fills right over the range, from its first row or first column. Both use `event.code`, so macOS Option characters still match. Each fill is one undoable batch. Link columns, read-only cells, and invalid source values are skipped and counted in one notice. Paste expansion: a single copied cell pasted onto a range of more than one cell fills the whole range. Before this slice, that paste wrote only the top-left cell, so this is a deliberate behaviour change. Larger clipboards still paste from the top-left, as before.
- **Test:** `tests/dom/tablify-file-view.test.ts`, "pastes one cell across a range, and Alt+D fills down, each as one undo step". It pastes one value across two rows and undoes it. It fills down from `alpha` and undoes that. The test fails on the slice C grid.
- **Not covered by a DOM test yet:** Alt+R (fill right). The fixture table has one text column, and a two-column fixture is needed. The fill-right branch runs through the same code as fill-down, and that gap is recorded here, not claimed as tested.
- **Gates:** `check` exit 0; 75 files; 1578 tests. Module comparison against `7394be2`, alias-normalised: only `NativeDatabaseGrid.ts` changed. Reachability: LIVE 108, DEAD 0. **NOT RUN:** real Alt+D and Alt+R on macOS and Windows keyboard layouts, and Obsidian host checks.
- **Status:** committed locally only. The push is blocked because no GitHub credential is available in the sandbox.

### R4 slice E: select all, Space, type-to-replace, PageUp and PageDown

- **Change:** Ctrl/Cmd+A selects the whole visible table as one range. Space toggles a checkbox cell as one undo step. Read-only checkboxes are left alone. Typing a character on a selected text, long-text, or number cell opens the editor with that character in place of the old text. Numbers accept only digits, `.` and `-`. PageUp and PageDown move the active cell by the number of rows that fit the viewport. The grid used to leave these keys to the browser's own scrolling, so PageUp and PageDown now move the selection instead.
- **Behaviour that existed before and is unchanged:** Enter and F2 still open the editor with the current value. Arrows, Home/End, Tab, Escape, and the Alt+D/Alt+R fills are unchanged. Typing inside an open editor still goes to the editor's own input, because the keydown handler returns early for editor targets.
- **Tests:** three new tests in `tests/dom/tablify-file-view.test.ts`, under "native grid keyboard range". They cover Ctrl+A with PageDown; typing `z` and committing with Enter; and Space on a checkbox with Undo. The checkbox test uses a new fixture with one text and one checkbox column. All three fail on the slice D grid.
- **Gates:** `check` exit 0; 75 files; 1581 tests; bundle 133158 bytes gzip. Module comparison against `f6bf456`, alias-normalised: only `NativeDatabaseGrid.ts` changed. Reachability: LIVE 108, DEAD 0. **NOT RUN:** real keyboard layouts on macOS and Windows, real checkbox rendering in Obsidian, and PageUp/PageDown on a tall table in the host.

### R4 slice F: add, duplicate and delete rows

- **Change:** Ctrl/Cmd+Shift+Enter appends an empty row and selects its first cell. Alt+Shift+D duplicates the active row and places the copy directly below it in stored order. Ctrl/Cmd+Shift+Backspace deletes every row in the current range, after a confirmation dialog. Each action is one store operation, so one Undo reverses it. A rejected write shows a notice and leaves the selection where it was. New row IDs come from the same secure factory the file view uses for other ids.
- **Confirmation:** `src/plugin/ConfirmModal.ts` is a host `Modal` with Cancel and a warning-styled action button. Cancel, Escape, or closing the dialog resolves `false`, and nothing is written. The grid receives the confirmation and the id factory through a second constructor argument, `NativeGridActions`. `NativeGridEnvironment` is unchanged, so the host environment type is unchanged.
- **Test mock:** `tests/mocks/obsidian.ts` now gives the element stub `addEventListener` and `click`, so a test can press a dialog button. This is the only change to shared test infrastructure.
- **Test:** `tests/dom/tablify-file-view.test.ts`, "adds, duplicates and deletes rows, with a confirmation before any delete". It covers add, undo, duplicate, undo, Cancel keeping the row, and Delete with one undo. The test fails on the slice E grid.
- **Known limits:** an empty table has no rows, so the grid never takes the keypress, and the add shortcut cannot run there. Add always appends to the end of stored order, even when the view is sorted. Delete works on the range's rows only, because whole-row selection is not built yet. Toolbar buttons for these actions are not built yet.
- **Still open for R4:** bulk column edit (Ctrl/Cmd+Enter), whole-row and whole-column selection, and the Alt+R DOM test.
- **Gates:** `check` exit 0; 75 files; 1582 tests. Module comparison against `af00551`: one new module, `ConfirmModal.ts`, and two changed modules, `NativeDatabaseGrid.ts` and `TablifyFileView.ts`. `TablifyFileView.ts` changes only the grid's constructor call and an import. Reachability: LIVE 109, DEAD 0 (the dialog module is now used). **NOT RUN:** the shortcuts on macOS and Windows keyboard layouts, the dialog's rendering and focus in the Obsidian host, and mobile behaviour.

### R4 slice G: bulk column edit

- **Change:** with a multi-row range selected, Ctrl/Cmd+Enter in an open cell editor writes the parsed value to the editor's column across the range's rows. This is one undoable step. Read-only cells and cells that already hold the value are skipped, and the range stays selected. Link columns and single-row ranges keep the existing commit path.
- **Range and editing:** Enter, F2, and type-to-replace no longer clear the range before the editor opens. A range stays visible while the editor is open. It is cleared when the edit commits without the bulk key, when the editor is cancelled, and when a non-range key or click moves the selection. A plain Enter therefore ends with no range, as before.
- **Behaviour change for ranges only:** on a long-text cell with a multi-row range selected, Ctrl/Cmd+Enter is now a bulk write, not a plain commit that moves down. Without a range, Ctrl/Cmd+Enter on long text behaves as before.
- **Tests:** two new tests in `tests/dom/tablify-file-view.test.ts`, under "native grid keyboard range". One checks that typing `b` on a two-row range, then Ctrl+Enter, writes both cells, and that one Undo restores them. The other checks that a plain Enter edits only the active cell and leaves no range. The bulk test fails on the slice F grid.
- **Gates:** `check` exit 0; 75 files; 1584 tests; bundle 134100 bytes gzip. Module comparison against `da14d03`, alias-normalised: only `NativeDatabaseGrid.ts` changed. Reachability: LIVE 109, DEAD 0. **NOT RUN:** Ctrl+Enter on macOS, where Cmd+Enter may differ in the host, and the bulk-edit status announcement for screen readers.
- **Still open for R4:** whole-row and whole-column selection, and the Alt+R DOM test.

### R4 slice H: whole-row and whole-column selection, and the Alt+R test

- **Change:** Shift+Space selects the active row, from its first column to its last. Ctrl/Cmd+Space selects the active column, from its first row to its last. The selection is a range of two corner cells, so copy, cut, clear, fill, and bulk edit apply to it unchanged. Alt+Shift+Space and Meta+Space are not bound. Space alone still toggles a checkbox, as before.
- **Limits:** these selections are keyboard-only. Clicking a row number or column header does not select a line yet, so the header affordance from the R4 list is still open.
- **Test:** a new two-column fixture, "Shift+Space selects the whole row, Ctrl+Space the whole column, and Alt+R fills right". It checks the whole row (both columns, not the other row), the whole column (both rows, not the other column), and Alt+R filling `x` to `Shoots 1` with one Undo to `x`. The row and column checks fail on the slice G grid.
- **Gates:** `check` exit 0; 75 files; 1585 tests; bundle 134270 bytes gzip. Module comparison against `2c1bcc7`, alias-normalised: only `NativeDatabaseGrid.ts` changed. Reachability: LIVE 109, DEAD 0. **NOT RUN:** the shortcuts on macOS and Windows layouts, and header-click selection, which is not built.
- **Still open for R4:** clickable row and column headers, and the R4 list's Step 1 items that the old grid had and this one has not yet verified in the host: frozen primary column, column resize and reorder, and virtualized rows.
