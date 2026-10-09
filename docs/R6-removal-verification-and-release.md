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
