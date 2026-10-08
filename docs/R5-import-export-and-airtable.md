# R5 — Spreadsheet interchange and Airtable sync

**Mode:** active implementation guide under the authorized R1–R5 scope; proceed one gated step at a time. **Dependencies:** stable R1 schema, R2 repository, R3 IDs/ops, and R4 field/table UI.

**Status (2026-10-08):** Part A Steps 1–4 have verified local checkpoints. Step 4 now includes the native wizard (paste or choose a TSV/CSV/HTML file, column and type review, explicit destination, exact plan review, one acknowledgement when the plan needs consent, and cancellable progress) over the transactional runner. Explicit link-value mapping is offered in the wizard (see Part A item 3); a link field is a target only when its target table exists. Part A items 3 and 4 have landed (link-value mapping and XLSX worksheet reading); Parts B–C remain open as listed in the plan below. XLSX workbook reading/worksheet selection, R6, release metadata, and version tags remain untouched. Native Obsidian-host and physical-device checks remain **NOT RUN**. Saved-view export scope has landed in the native export panel (see Part B and the remaining-work plan).

## Objective

Retain CSV/TSV/XLSX import/export and manual Airtable sync while redirecting all local operations to native tables and stable IDs. Do not reintroduce note creation or a `.tabula` path.

## Part A — CSV/TSV/XLSX import

### Step 1 — Keep the pure readers and preview logic

Reuse matrix readers, header handling, type inference, per-column overrides, clipboard parsing, collision reporting where it applies, and progress reporting. Remove plan inputs about note folders, filename templates, frontmatter keys, and vault file collisions.

**VERIFIED implementation checkpoint (2026-10-08):** `src/core/database/import/preview.ts` is a source-only native-table preview boundary over the existing pure `readSource`/`inferColumns` functions. It retains the matrix, exact header-adjusted dimensions, inference evidence, per-column type overrides, and excluded-column choices; it has no target table, database-write plan, folder/template/frontmatter, note path, or vault-file-collision inputs. CSV/TSV/HTML/clipboard text still use the existing readers; an already-parsed worksheet can enter as a matrix, so the native path does not need a second classifier. Tests cover this boundary alongside the unchanged note importer.

**VERIFIED gates:** `npx bun run check` passed, including 88 test files / 1,971 tests and the repository's type, lint, brand, manifest, format, build, contrast, CSS, and bundle-size checks. The targeted preview + legacy-import suites passed 40/40. The existing Playwright layout harness passed 115/115; it still exercises the pre-existing grid, not the native FileView or a native importer UI.

**OPEN:** although `read-excel-file` is already a dependency, no production XLSX import adapter, workbook reader, or worksheet chooser exists yet; this checkpoint accepts a parsed matrix but does not claim user-visible XLSX import. Step 3 now rejects ambiguous native field-name mappings/collisions; native wizard conflict presentation, transactional apply, and progress reporting remain open. The existing note import wizard and its folder/template/frontmatter/vault-collision/progress behavior remain unchanged, so this isolated native path does not regress that workflow. Real Obsidian-host and physical-device checks remain **NOT RUN**.

### Step 2 — Define destinations

The native destination contract has three choices for the future wizard:

1. **Create table** in the current database, with a user-supplied table name.
2. **Append records** to a selected existing table. An explicit mapping targets stable field IDs. Without one, header/name matches are suggestions only and the exact preview requires confirmation before apply.
3. **Replace imported values** in a selected existing table, following [ADR-0007](adr/ADR-0007-import-replace.md): update rows only through a user-mapped key; without a key, append imported rows. Never match by position or reuse a row ID for a different logical row. Fields absent from the import and their values are retained by default; removing absent fields is a separate, explicit, off-by-default choice. Existing rows not identified by the mapped key are retained and listed; import never deletes unmatched rows.

The replace preview enumerates affected fields, type/cell changes, skipped or lossy values, and unmatched rows before an explicit confirmation. Apply must re-plan and refuse a stale plan. The source file remains an external import input; it is never renamed to `.tablify` or treated as a database without parsing/confirmation.

**VERIFIED implementation checkpoint (2026-10-08):** `src/core/database/import/destination.ts` exports a discriminated destination contract for create, append, and replace plus the field-mapping and row-key choices. Name suggestions are distinguished from explicit stable-field-ID mappings, and the helper marks name-based matches as requiring confirmation. Replace defaults preserve import-absent fields, model field removal as an explicit choice, require an explicit stable field ID for key matching, and represent no-key behavior as append. No unmatched-row deletion or positional row matching is represented. This is the pure choice contract consumed by Step 3; it does not include a mounted wizard or apply path.

**VERIFIED gates:** `npx bun run check` passed (89 test files / 1,976 tests and all automated repository gates); targeted destination + preview + legacy-import suites passed 45/45. `npx bun run test:layout` passed 115/115; that harness covers the pre-existing grid only. **NOT RUN:** native importer UI, Obsidian-host, and physical-device verification.

### Step 3 — Build an exact import plan

The pure plan contains selected table, included columns, field types/options, row count, cell conversions, skipped/rejected values, duplicate decisions, and estimated document size/work. Preview text comes from that plan, and the runner consumes the same plan. No folder, `.md` filename, note count, `.tabula` alternative, or migration report appears.

- Infer column types using the existing evidence-based classifier; allow per-column overrides.
- Stable field/row/option IDs are generated through an injected ID factory.
- Linked-record imports require a deterministic target mapping; do not guess from labels or silently import link text as a relationship.
- Warn based on measured size/performance policy rather than “large import ⇒ keep `.tabula`.”
- Cancellation reports zero committed work, or precisely reports committed chunks if a documented chunked import is approved.

**VERIFIED implementation checkpoint (2026-10-08):** `src/core/database/import/plan.ts` exports `buildDatabaseImportPlan` and `describeDatabaseImportPlan` through the native database index. The pure planner creates exact operations for create/append/replace, uses injected IDs and clock, converts through native field descriptors, keeps existing field types, applies preview-selected types to new fields, and carries explicit stable option IDs. It records included/excluded columns, per-row conversions and skipped values, confirmations, duplicate decisions, unmatched retained rows, serialized document bytes before/after, deterministic work units, and threshold-only warnings. Keyed replace refuses duplicate source/target keys; no-key import preserves source duplicates and lists all existing rows retained by replace. Link imports require exact source-value mappings to valid row IDs in the configured target table. The input document is not mutated; the exact operation list is checked in memory before it is returned. The note importer and its behavior were not changed.

**VERIFIED gates:** targeted native planner + destination + preview + legacy-import suites passed 69/69. `npx --yes bun run check` passed: 90 test files / 1,985 tests and all type, lint, brand, manifest, format, test, build, contrast, CSS, and bundle-size gates. `npx --yes bun run test:layout` passed 115/115; that harness still covers the pre-existing grid, not the native importer or FileView. **NOT RUN:** real Obsidian-host and physical-device checks.

**OPEN:** the native wizard/progress UI remains unimplemented. XLSX workbook reading and worksheet selection remain deferred; a pre-parsed matrix is the only XLSX seam. Parts B–C, R6, release metadata, and tags remain untouched.

### Step 4 — Apply as one transaction where feasible

Prefer one database command, one undo entry, and one repository write. If a 400×6 or larger import requires chunking for responsiveness, design chunk visibility/undo semantics explicitly and preserve a cancelable progress report. Never leave unreported partial data after cancellation.

**VERIFIED transactional-runner checkpoint (2026-10-08):** `src/adapters/tablifyFile/importRunner.ts` consumes the Step 3 plan unchanged, refuses stale or externally changed documents, dispatches its exact operation list as one database-session history entry, and flushes through the existing shared write queue. It does not modify the legacy note importer or its runner. Cancellation is honored before dispatch and reports zero committed records; after dispatch, the runner waits for the save result and distinguishes a saved transaction from an applied-but-unsaved transaction. It does not chunk. A 400×6 regression case verifies one atomic undo entry and one repository write.

**VERIFIED gates:** runner + database-store + session + write-queue targeted suites passed 44/44. `npx --yes bun run check` passed in a clean copy with the unrelated uncommitted BOM fixture restored to HEAD: 91 test files / 1,992 tests and all repository gates. `npx --yes bun run test:layout` passed 115/115 after installing Chromium system libraries.

**VERIFIED (local, 2026-10-08):** the panel and model are covered by `tests/unit/native-import-model.test.ts` (7) and `tests/dom/native-import-panel.test.ts` (3): Next stays disabled for an empty source; a create import applies one undo step, saves once, and reports one sentence; a cancel before the commit point leaves the document and history unchanged. The toolbar button **Import rows** opens the modal over the pane's store; a pending grid edit is committed first, and releasing the pane closes the modal and aborts any apply that has not committed. The clean copy at `HEAD` plus this change passed `bun run check` (93 files / 2,002 tests, exit 0) and `bun run test:layout` (115/115). **OPEN:** explicit link-value mapping (link fields are shown as unavailable with a reason); the Obsidian `Modal` and toolbar in a real host, and physical-device checks, are **NOT RUN**.

## Part B — CSV/TSV/XLSX export

- Add CSV export; it is not delegated to Obsidian Bases in the target product.
- Keep TSV clipboard/file and XLSX workbook export.
- Offer export of selected range, current filtered/sorted/grouped view, or whole table, with exact scope stated in the dialog.
- Use field ID order/presentation order from an explicit export choice; do not depend on JSON object key order.
- Linked-record export needs a documented representation (recommended: display labels for readable spreadsheets, with warning that re-import does not recreate identity without a mapping).
- Attachment export emits path references or display names according to an explicit option; it never embeds the binary asset.
- Spreadsheet formula injection safety remains: formula-shaped local text must export as literal text; reader never evaluates formulas.

**Part B checkpoint (2026-10-08, partial):** `src/core/export/csv.ts` adds a pure CSV writer and reader. Writes follow RFC 4180 quoting; formula-leading cells are quoted by the same rule as the clipboard's TSV writer (a mitigation, not a guarantee). CRLF is the default and LF is an option. Every record is terminated, and an empty matrix is empty text. `fromCsv` never evaluates a cell. `tests/unit/native-csv-export.test.ts` (7 tests) covers escaping, formula text, line endings, empty cells, and round-trips. **NOT DONE:** the native table-to-matrix builder for selection/view/table scope, field-ID column order, the export dialog, XLSX from native tables, and linked-record or attachment representations. The existing grid export path is unchanged. **ASSUMED:** no byte-order mark is needed for spreadsheet readers; not verified on a real host.

**Part B checkpoint (2026-10-08, native CSV export):** `src/core/database/export/nativeMatrix.ts` turns the active native table into a matrix in manual row order. Display mode follows the native grid's rules for selects and invalid values; raw mode uses each descriptor's plain text. Unsupported and link fields are omitted and counted, never silently exported as IDs. `src/plugin/nativeExport/` adds a native-DOM panel and modal. The FileView toolbar gains **Export CSV**. The panel states the scope and omissions first, offers display or raw text and CRLF or LF line endings, and writes one file to `Tablify exports/` using the existing name convention (`Tablify export <table> <stamp>.csv`, with a numeric suffix rather than an overwrite). It does not change the grid export, the clipboard, or the note paths. **VERIFIED (local):** `tests/unit/native-export-matrix.test.ts` (6), `tests/unit/native-csv-export.test.ts` (7), and `tests/dom/native-export-panel.test.ts` (5) pass. **NOT DONE:** TSV and XLSX from native tables; saved view filters and sorts (the export is the whole table, and the panel says so); selection scope; readable link labels; attachment references; and the Obsidian host itself (NOT RUN). **ASSUMED:** Excel and Sheets read the quoted formula text as text; not verified on a real host.

## Part C — Airtable sync

### Step 1 — Preserve safety semantics

Keep manual pull, manual push, dry-run counts, per-field three-way diff, explicit conflict review, stale-check protection, partial-read blocking, read-only Airtable schema, safe typed errors/retry, no remote deletes, no secret leakage, and no live calls in CI. No background polling or automatic sync is introduced.

### Step 2 — Change local identity

Recommended link identity: one local `databaseId + tableId` maps to one Airtable base/table. A saved view is not the sync identity. Link metadata continues under `<vault>/.tablify/links/` as a separate optional sidecar; distinguish this directory from `.tablify` database files.

Proposed link state maps:

- `fieldId → remoteFieldId`;
- `rowId → remoteRecordId`;
- agreed snapshot hashes by remote record and remote field ID;
- remote Airtable base/table identifiers/names;
- last successful pull/push stamps and format version.

Token stays in `SecretStorage`, never in the database file, link state, settings file, logs, or export.

### Step 3 — Decide old-link metadata separately

The current link state is keyed by `.base` path and view name; it does not become compatible merely by renaming its key. Default plan: **do not migrate existing Bases-keyed link JSON**; leave it untouched and let the user establish fresh links for `.tablify` tables. If the user wants old link snapshots/mappings migrated, add a separate explicitly approved converter with dry-run/back-up tests; do not assume.

### Step 4 — Adapt the provider-agnostic engine

Change `SyncLocalPort` path/property vocabulary to row/field IDs and a table-scoped port. Keep the provider `SyncTarget` abstraction. Use remote Airtable names only for user-facing mapping suggestions; persist remote IDs. A row with no existing remote mapping remains skipped/reported; this plan does not add remote record creation or deletion.

### Step 5 — Handle linked-record sync conservatively

A local link value is a set/list of local row IDs. Convert it to Airtable record IDs only when the target table has a matching, valid mapping for every referenced row and the remote field type is supported. Pull follows the inverse mapping. If any relation target is missing, unmapped, deleted, or ambiguous, show the row/field in the plan and block or skip according to a documented rule before any write. Never turn an unresolved link into text or an empty remote list.

### Step 6 — Keep secrets and network isolated

- Sync remains behind the existing explicit command/action and lazy module boundary where it is still useful.
- All network calls use Obsidian’s supported request transport; verify current API types at the pinned version.
- Use fake transports in tests. Assert authorization tokens do not appear in error, logs, sidecar, plugin settings, or exported files.
- Keep rate-limit/backoff and Airtable page caps; incomplete reads cannot authorize push.

## Remaining R5 work (plan, 2026-10-08)

Recorded as documentation only. No code changes accompany this plan. Each item is a separate, isolated, gated step: it must leave existing grid, note-import, FileView, and export behaviour unchanged, be pushed on its own, and keep host checks NOT RUN until after R6.

1. **Native TSV and XLSX export** from the active native table. **TSV file export has landed** (`src/plugin/nativeExport/`, the same panel as CSV, written with the clipboard's own `toTsv`; covered by `tests/dom/native-export-panel.test.ts`). **XLSX export has landed** through the existing `toXlsxData` typed-cell helper and `writeXlsxSheet` writer, with the same whole-table scope and omission report. Number and date columns are typed; text that does not parse stays text. The workbook is written as bytes to the vault (`createBinary` in the host). The writer's own byte output is covered by the existing `xlsx-file` tests, and the native panel's path is covered by `tests/dom/native-export-panel.test.ts`. A real-host open of the workbook is **NOT RUN**. The TSV clipboard copy is unchanged and is not part of this item.
2. **Saved-view scope for export. LANDED (2026-10-08, native CSV/TSV/XLSX panel).** `nativeViewMatrix` in `src/core/database/export/nativeMatrix.ts` runs the same `buildView` the grid runs, with the view's filter expression, sorts, grouping, hidden fields and column order. Decisions: (a) the panel defaults to **Current view** when the pane has a saved view selected, and to **Whole table** otherwise; the choice is shown as a radio, and a view with no selection is disabled; (b) rows inside **collapsed groups are included**, because collapse is a display state, not a filter, and the dialog says so; (c) hidden fields are left out and counted; (d) the export filters on the same values the grid filters on: select cells by option name, invalid and empty cells as empty; (e) a filter that reads the link field or an unsupported field is **refused with a stated reason** rather than evaluated on values the file does not show; (f) the saved view's own filter problems are listed in the panel, as the grid lists them. **VERIFIED (local):** `tests/unit/native-export-matrix.test.ts` (10, including hidden columns, sort order, filter rows, link refusal, filter problems) and `tests/dom/native-export-panel.test.ts` (10, including the default scope, visible-field output, and the whole-table fallback). **NOT DONE:** a collapsed-group test; the real-host check (NOT RUN).
3. **Explicit link-value mapping in the import wizard. LANDED (2026-10-08).** A link column is a target when its target table exists in the database. The destination step shows one picker per distinct, non-blank source value, listing the target rows by their first text field (or by ID when that is blank). A single link takes one row; a multi-link takes an ordered list of rows. A value with no chosen row blocks the review and is named there, as the planner already reports it, and clearing a choice makes the value unmapped again. Changing a column's field or the destination table clears its choices. Labels are never guessed. **Decisions:** (a) no 'leave this value empty' option, because an unmapped value blocks by planner policy; (b) a generated inverse link is refused with a reason. **VERIFIED (local):** `tests/unit/native-import-model.test.ts` (12, including planner acceptance and refusal, the single-versus-multi cardinality, and distinct values), `tests/dom/native-import-panel.test.ts` (5, including a blocked review that names the value and an applied link that saves once). **NOT DONE:** a DOM test of the multi-link picker itself; real-host check NOT RUN.
4. **XLSX source reading and worksheet choice** for import. **LANDED (2026-10-08, native import wizard).** `src/plugin/nativeImport/workbookReader.ts` reads an `.xlsx` with the existing `read-excel-file` dependency, behind a dynamic import, so it loads only when a workbook is opened. Every worksheet is read once, as text, through `src/core/import/workbook.ts` (a pure cell-to-text rule: numbers as stored, booleans as TRUE/FALSE, a midnight date as a day, other dates as local date and time, blanks as blanks). The chosen worksheet becomes a `matrix` source, so inference, the planner and the review are the same path as a pasted table. A worksheet chooser appears when a workbook has more than one sheet, and it defaults to the first. A refused file gives one sentence and changes nothing else. Decisions: (a) the workbook is read in full at open time, so switching sheets never re-reads the file; (b) the reader's declared `Date` type is narrowed at runtime rather than cast, because the library types a date cell as the `Date` constructor; (c) the time zone of a date cell is the host's local zone. **VERIFIED (local):** `tests/unit/workbook-cells.test.ts` (4), `tests/unit/native-import-workbook.test.ts` (4, real workbooks written and read with the same library), and `tests/dom/native-import-panel.test.ts` (6, including opening an `.xlsx` through the file input, choosing a worksheet, and previewing it). **ASSUMED:** a date cell's local-time reading matches Excel on a real host. **NOT DONE:** very large workbooks are read in full with no size limit; a real-host open is NOT RUN.
5. **Part C (Airtable sync)** after Parts A and B are closed, following Steps 1–6 above.

**Part C progress (2026-10-08).** Slice C1 (Steps 2–3) and slice C2 (Step 4) have landed as isolated modules with no UI or command wiring, so no existing behaviour changes:
- `src/sync/nativeLink.ts`: native link identity from `databaseId + tableId` in a key namespace that cannot equal a legacy `.base` key; the file stores `rowId → remoteRecordId`, `fieldId → remoteFieldId` and the snapshot by remote IDs; the engine's local vocabulary is produced at one boundary. Legacy `.base` link JSON is neither read nor migrated (Step 3 default).
- `src/sync/nativePort.ts`: a `SyncLocalPort` over the native database store. The path is the row ID and the property is the field ID. The engine, the legacy port and `SyncLocalPort` are unchanged. Link fields are excluded and named (Step 5, first slice), and any write to one is refused. An apply is all-or-nothing and one undo step.
- `src/core/database/export/nativeMatrix.ts`: `optionsOf` is exported (additive only).
- Tests: `tests/unit/native-link.test.ts` (9), `tests/unit/native-port.test.ts` (10). `check` 100 files / 2064 tests, layout 115/115 (in an overlay of HEAD).
- Slice C3 (Steps 4–6, runner and host): `src/sync/nativeRun.ts` runs the unchanged engine for one native table (display-name matching converted to field IDs; a stored mapping survives a rename; duplicate display names are reported, never guessed). `src/plugin/sync/nativeHost.ts` loads the link, refuses with one sentence when it cannot proceed (no link, damaged file, other table, no token), runs, and saves once after success. Its Obsidian and network dependencies are injected, so it has no `obsidian` import.
- Engine fact found while testing: the engine's snapshot is already keyed by remote record and remote field ID, so the link stores it unchanged. A first sync has no baseline and reports differing values as conflicts, which writes nothing. An empty text cell is treated as no value at the sync boundary, because a provider cannot hold an empty text (ADR-0004 keeps `""` as a value in the core).
- Tests: `native-run` (6), `native-host` (6). `check` 102 files / 2075 tests; layout 115/115 (overlay).
- Slice C4 (first link and command): **Decision, first row-to-record link.** The spec leaves this open. Resolved: the user names one key field; a row and a record link only when the key is unique on both sides after trimming and collapsing whitespace (case is significant). Everything else is reported as no-key, no-match or ambiguous, and nothing is created on either side. Pure logic in `src/sync/nativeLinking.ts` (5 tests).
- **Command surface, deliberate change.** A fifth command, `sync-native-table` ("Sync this table"), runs a pull and push for the table the pane shows. It loads `src/plugin/sync/nativeCommand.ts` only inside its handler, the only file in this path that imports Obsidian. `TablifyFileView.activeStore()` is a new read-only accessor. Three pinned assertions move from four commands to five (`plugin-smoke`, `bases-registration`), and `startup.test.ts` names the second lazy entry point. No existing command's behaviour changed.
- **Bundle cost, measured.** `main.js` grows from 240500 to 244207 bytes gzip (limit 300 KB). The dynamic import defers evaluation, not bytes, because `cjs` inlines dynamic chunks, as the startup test already records.
- Slice C5 (link creation and dialog): `linkActiveStore` in `nativeHost.ts` creates the link for the active table. It refuses an existing link file, an unknown or ambiguous key field (local or remote), a missing token, and a truncated remote read. It pairs rows by the key via `linkRowsByKey`, saves once, and runs no sync. The sync command now opens a link dialog (`nativeCommand.ts`) when the table is unlinked, rather than failing. The dialog is written but **NOT RUN in Obsidian**; its logic is tested through the host (14 tests in `native-host`).
- **Known gap, OPEN:** the first sync after linking has no agreed baseline, so a value that differs on both sides is a conflict, and nothing is written until a person chooses. Without a native conflict review that choice cannot be made from the native table. This is the next blocker for real use.
- Bundle: `main.js` 245562 bytes gzip (limit 300 KB). `check` 103 files / 2088 tests; layout 115/115 (overlay).
- Still open: a conflict review for native tables (today the summary says the conflicts were not written), linked-record sync beyond exclusion, and the live Airtable smoke test (user-run, after R6). `check` 103 files / 2082 tests; layout 115/115 (overlay).


Each step also needs its own check that the legacy note importer, the grid, and the existing export paths are unchanged, and each stays NOT RUN for host checks until after R6.

## R5 test matrix and exit criteria

- Import CSV/TSV/XLSX: headers/no headers, typed overrides, empties, duplicate values, malformed values, 400×6 undo, cancellation, size warning, create/append/replace.
- Export: CSV escaping/line endings, TSV/HTML clipboard fidelity, XLSX file opens/round-trips, selected range/view/table scope, literal formula-shaped text.
- Sync: mapped row/field, local-only and remote-only field changes, same-field conflicts, stale local edits during review, remote deletion, local deletion, partial/truncated page, type mismatch, rejected push, link-file corruption, redaction.
- Linked sync: complete target mapping, one missing target mapping, deleted target, unsupported Airtable linked-record field, cyclic link graph, and no unintended data write on an unresolved relation.
- Verify no live Airtable network call in test/CI and no token-like string in generated fixtures.
- No `.tabula` choice or old Bases link-state importer appears in UI.
