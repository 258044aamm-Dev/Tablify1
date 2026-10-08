# Tablify native `.tablify` refactor plan

**Status:** user-confirmed product direction. *Amendment 2026-10-08:* this audit is a historical record of the pre-implementation state. R1–R3 are implemented; R4 Steps 1–3 have verified implementation checkpoints, with full parity and real-host checks still open; R5 is authorized and Part A Steps 1–3 have verified source-preview, destination-contract, and exact-plan checkpoints. Part A Step 4 has a verified transactional-runner checkpoint but remains open for the native wizard/progress UI; Parts B–C, R6, release metadata, and version tags remain open/untouched under the current scope. Current implementation state is always the source at HEAD; `docs/06-roadmap.md` is the concise phase tracker.

**Repository audited:** `258044aamm-Dev/Tablify`, `main` at `50f041f135abe9e7e9f111cf7c170b32dc98e9e0` (2026-10-06); tag `0.1.0` exists.

**Detailed phase guides:** [`docs/README.md`](README.md) indexes R0–R6 guides covering schema, file view/storage, core identity, UI parity/links, sync, removal, tests, and release sequencing.

**Supersedes:** the earlier 2026-10-05 proposal in this file, which audited the older `airtable-tabula` fork and recommended an Obsidian Bases-first product. That recommendation and its architecture are no longer the product decision.

---

## 1. Decision in one sentence

Keep this repository and the Obsidian plugin, but make a versioned, multi-table `.tablify` JSON file the **only native editable data source**. Remove Obsidian Bases and the legacy `.tabula` path rather than keeping parallel modes. Reuse the grid and provider-independent code; replace the data model, storage adapter, plugin view lifecycle, and Bases-specific docs/tests.

This is a substantial refactor, not a new repository and not a small adapter swap.

## 2. User-confirmed product contract

These decisions were confirmed in the conversation and are the constraints for the plan:

| Area | Decision |
|---|---|
| Host | Remain an Obsidian plugin. Keep this repository, product identity, and plugin id `tablify`. |
| Native data | `.tablify` is the only native editable database format. Its JSON document contains the database’s tables, schema, rows, and saved views. |
| File shape | One `.tablify` document can contain multiple tables. |
| Relationships | Linked-record fields are in scope for the first stable release. Formula, lookup, and rollup fields are deferred. |
| Attachments | Store vault-relative path references; do not embed attachment bytes in the JSON document. |
| Bases | No Obsidian Bases view mode, no `BasesView` integration, and no `.base`-to-`.tablify` migration. |
| Legacy `.tabula` | Remove its reader/view/import path; do not carry a `.tabula` mode or converter forward. |
| Spreadsheet interchange | Keep CSV/TSV/XLSX import and export. These are interchange formats, not alternative native storage. |
| Airtable | Keep Airtable sync in the first stable release, using the current manual pull/push and field-by-field conflict-review behavior. Keep credentials in Obsidian `SecretStorage`. |
| Grid | Retain the current grid interaction set and bring it onto the new storage: editing, selection, clipboard, bulk operations, undo/redo, views, accessibility, and mobile behavior. |

**Terminology:** remove the Obsidian **Bases** integration. Airtable’s remote **base** remains an Airtable API concept, so remote `baseId`/`baseName` fields in the sync adapter are not themselves evidence of an Obsidian Bases dependency.

**Compatibility consequence:** `.base`, Markdown-note rows, and `.tabula` files may remain on disk, but the refactored plugin will not open, edit, or migrate them. The existing `0.1.0` pre-release is a rollback point; do not overwrite its tag or pretend it is compatible with the new storage.

## 3. Audit findings: current repo versus target

### 3.1 What is already reusable

The current repo is not the original 7,572-line fork described in the superseded plan. It is a typed Obsidian plugin with a substantial implemented core and test suites. Reuse these pieces where their contracts are genuinely storage-neutral:

- `src/grid/**`: the virtualized React grid, keyboard/focus model, editors, clipboard, menus, selection interactions, accessibility roles, mobile keyboard inset, and styling.
- `src/core/fieldTypes/**`: the field descriptor registry and most existing scalar field behavior (text, number, date, select, currency, percent, duration, rating, attachment, and others). Field context and serialization contracts need decoupling, not wholesale deletion.
- `src/core/query/**` and `src/core/view/pipeline.ts`: the expression evaluator, sorting/grouping pipeline, search behavior, and view presentation logic. Replace Bases-specific persisted input; do not reimplement these without a demonstrated gap.
- `src/core/ops/**`, `src/core/selection/**`, and `src/grid/store/**`: plain-data operations, inverses/history, ranges, and the store. Their identity and table scope currently assume a note path and one table, so they need a deliberate type/model migration.
- CSV/TSV/HTML/XLSX matrix parsing, preview/inference, clipboard serialization, and the XLSX/TSV export flows under `src/core/**` and `src/plugin/{import,export}/**`.
- The Airtable client, transport, diff/conflict engine, retry/error handling, secret-storage wrapper, and mocked-transport tests under `src/sync/**` and `src/plugin/sync/**`. Re-key and reconnect the local side; do not throw away the sync correctness work.
- The Vitest, DOM, Playwright layout harness, CI, bundle/contrast/CSS gates, and architecture-boundary lint rules.

### 3.2 The Bases coupling is structural, not just a registration call

The source audit found all of the following, so deleting only `registerBasesView()` would leave a misleading and nonfunctional product:

| Current code | Current assumption | Refactor consequence |
|---|---|---|
| `src/plugin/main.ts` | Calls `registerBasesView`, finds a `bases` leaf, and tracks live Bases views. | Replace with a `.tablify` file view, create/open commands, and file-view lifecycle. Remove `BASES_LEAF_TYPE` and all Bases registration/disabled-plugin notices. |
| `src/plugin/TablifyView.ts` | Extends Obsidian `BasesView`; consumes `QueryController`, `BasesPropertyId`, `data`, `.base` config, `createFileForView`, and note metadata/frontmatter APIs. | Replace with a view bound to a `.tablify` `TFile`/database session. No `BasesView`, `QueryController`, `config.getOrder()`, `processFrontMatter`, or note-backed row refresh. |
| `src/adapters/bases/BasesSource.ts` | Implements `RowSource` over note paths and frontmatter; persists field options, view patch, and presentation in `.base` config. | Retire. Add native database/table storage and store views/field options inside the `.tablify` document. |
| `src/adapters/RowSource.ts` | `kind` is only `'bases' | 'tabula-file'`; `RowId` comments distinguish note path from `.tabula` row id. | Redesign around database/table/row/field identities. There is currently no live `.tablify` source. |
| `src/core/ops/types.ts`, `src/core/selection/**`, `src/core/query/evaluate.ts`, `src/core/view/pipeline.ts` | Rows/cells use `filePath`; stable sort ties use that path; operations model a single `TableState`. | Replace note-path identity with stable `rowId`, carry `tableId` where an operation crosses table boundaries, and add database/table-level state and operations. |
| `src/core/types.ts`, `src/core/schema/propertySchema.ts`, `src/core/fieldTypes/**` | `PropertyId` is described as a prefixed Bases id; `PropertySource` distinguishes `note/file/formula`; descriptors expose `toYaml`; `FieldContext` contains a note `path`; created/modified fields derive from Obsidian file metadata. | Replace with native `FieldId`/field definitions and JSON-safe encode/decode. Define record timestamps in the file model; remove note/frontmatter/property-source rules. Keep locale/timezone formatting where useful. |
| `src/core/view/patch.ts`, `BasesSource` view keys | View configuration is encoded as strings in `.base` sidecar settings. | Persist named table views in `.tablify` and version their schema. |
| `src/adapters/notes/createNote.ts`, `src/core/import/**`, `src/plugin/import/**` | Import creates Markdown notes, plans folders/filenames/collisions, and treats `.tabula` as the legacy alternative. The `.tabula` wizard choice is explicitly not implemented as a writer. | Keep matrix parsing, inference, preview, progress, and one-action undo. Replace note planning with create-table / append-records / replace-table plans. Remove folder/template/legacy-choice semantics. |
| `src/adapters/tabulaFile/**`, `src/core/migrate/**` | Pure `.tabula` v1/v2 reader and conversion-to-notes migration, with committed fixtures and tests. | Remove these paths and fixtures after their tests are replaced by `.tablify` parser/serializer/version tests. |
| `src/sync/LinkStore.ts`, `src/plugin/sync/host.ts`, `src/plugin/sync/local.ts`, `src/sync/pullPush.ts` | Link identity is `.base` path + view name; record map keys are note paths; local operations address properties and note paths. | Key links by stable local `databaseId` + `tableId`; map stable local `rowId`/`fieldId` to Airtable record/field IDs. Keep the token in `SecretStorage`; keep the conflict engine provider-agnostic. |
| `src/plugin/settings/schema.ts` | Settings include row folder, note filename template, `.tabula` migration visibility, and note-import threshold. | Remove row-folder/filename and legacy settings. Retain appearance, diagnostics, type inference, clipboard behavior, and import warning only if it still corresponds to file-size/performance risk. |
| `AGENTS.md`, `README.md`, `manifest.json`, `package.json`, `docs/01–12`, `START-HERE.md`, `prompts/**`, `src/plugin/DEV-NOTES.md` | Active instructions and product copy still say Bases, notes/frontmatter, `.base`, `.tabula`, or note migration. | Rewrite the active contract before source work; otherwise future changes will reintroduce the removed system. Preserve historical release/progress records as history, not as current instructions. |

**Important scope correction:** Bases is an Obsidian core API, not a separate runtime package in `package.json`. Keep the `obsidian` development typings for the plugin host and the remaining APIs. The removal target is the Bases classes, registration, configuration and semantics—not Obsidian itself.

**`.tabula` status correction:** the checked-in current runtime has a `.tabula` model/reader and migration utilities, but `RowSource` has no live `.tabula` implementation; the import wizard’s “keep as `.tabula`” action is disabled/unbuilt. The new product should remove this legacy code and its promise rather than preserve a viewer that is not actually present.

**`.tablify` naming correction:** the existing vault-root `.tablify/` directory is currently an app-owned link-metadata namespace; it is not a database file or an implemented `.tablify` format. Keep the file extension and the directory’s sync metadata roles distinct in code, UI copy, and tests.

### 3.3 Current release and verification baseline

- `manifest.json` and `package.json` identify the product as `Tablify`, id `tablify`, version `0.1.0`; manifest minimum Obsidian version is `1.13.0` and mobile is enabled.
- Git tag `0.1.0` and the latest changelog/progress describe a GitHub pre-release for personal/device testing, not a community-directory release. The current manual device log still records real-app/device checks as not run.
- `package.json` already has React 19, `read-excel-file`, and `write-excel-file`; it has no standalone database or Bases runtime package. Do not add a DB dependency just to make `.tablify` JSON work.
- This is a source/docs audit at the commit above. Bun is not installed in this workspace, so `bun run check` was not run as part of this planning pass. The existing repository gate remains required during implementation.

## 4. Target format and architecture

### 4.1 `.tablify` document contract

Use a plain, versioned JSON document with one stable database identity and stable IDs for tables, fields, records, views, and select options. The following is illustrative, not a frozen schema:

```json
{
  "format": "tablify",
  "version": 1,
  "databaseId": "db_…",
  "name": "Project tracker",
  "tables": [
    {
      "id": "tbl_…",
      "name": "Tasks",
      "fields": [
        { "id": "fld_…", "name": "Status", "type": "singleSelect", "options": [] },
        { "id": "fld_…", "name": "Project", "type": "link", "targetTableId": "tbl_…" }
      ],
      "rows": [
        { "id": "row_…", "cells": { "fld_…": "opt_…", "fld_…": ["row_…"] } }
      ],
      "views": [
        { "id": "view_…", "name": "Open tasks", "filters": null, "sorts": [], "groupBy": null }
      ]
    }
  ]
}
```

Schema work must settle these invariants before the file writer is built:

1. Renaming or reordering a table, field, view, or option must not change its ID or invalidate a linked-record value.
2. A linked-record field names one `targetTableId`; its value is a validated list of row IDs from that table. Decide whether single-link is a constraint on that same model or a separate field type.
3. Select/multi-select cell values should use stable option IDs in the native format; labels and colors are field metadata. This is recommended for a database format, even though the old frontmatter model used labels as stored values.
4. A row has persistent `createdAt`/`updatedAt` metadata if created/modified-time fields are exposed. Do not derive them from the `.tablify` file’s own Obsidian `TFile` timestamps, which describe the whole database file, not individual records.
5. Attachment values are vault-relative paths. Missing or moved files render as missing attachments; the JSON file does not pretend to package the bytes or guarantee cross-vault portability.
6. Views and their filters/sorts/grouping, hidden columns, order, widths, density, and frozen-column presentation belong to the table/database document, not `data.json` settings and not a `.base` sidecar.
7. A future `.tablify` `version` must never be silently rewritten by an older build. A newer unsupported version should open read-only with a clear explanation; malformed JSON must not be replaced by an empty database.
8. Internal `.tablify` schema upgrades are in scope. Conversion from `.base` or `.tabula` is explicitly not.

Use the existing core query AST/pipeline as the starting point for saved-view execution. A `.tablify` view is Tablify’s own query; it is no longer inherited from Bases.

### 4.2 Data access and plugin host

The existing `RowSource` is a **single-table grid port**; simply adding `kind: 'tablify-file'` is insufficient for the confirmed multi-table document. Introduce two clear responsibilities:

- A database repository/session owns one parsed `.tablify` document, all tables, file I/O, schema validation, document revision, and subscriptions.
- The active-table/grid port exposes one table’s schema, rows, values, operations, and view to the existing grid. It always carries stable `databaseId`, `tableId`, `rowId`, and `fieldId` identity as appropriate.

Register a custom Obsidian file view for the `.tablify` extension, plus a create/open flow. The official Obsidian docs describe custom views through `registerView` and extension routing through `registerExtensions`; use the file-view lifecycle and verify exact event/write APIs against the repository’s pinned `obsidian@1.13.1` typings before implementation ([custom views](https://docs.obsidian.md/Plugins/User+interface/Views), [`Plugin.registerExtensions`](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerExtensions), [`FileView.onLoadFile`](https://docs.obsidian.md/Reference/TypeScript+API/FileView/onLoadFile)). Do not keep a plugin-global list of view instances merely to find the active Base; follow Obsidian’s custom-view lifecycle guidance.

The `.tablify` file is the native source of truth. Use an in-memory validated snapshot so render-time cell reads stay O(1). All edits go through the operation/store path. Coalesce a user action into one serialized document write and one undo step; do not reuse the per-note queue unchanged. Define how writes to one open file serialize, how two panes share the same database session, and how an external vault-sync edit is detected before overwriting a newer revision. On parse or write failure, show the error and preserve the last known-good file; never replace it with an empty default.

### 4.3 Airtable link model

Retain the working manual sync design, but change its local identity. The `.tablify` filename is the database document; the existing vault-root `.tablify/links/` directory is only optional sync metadata, not the database itself:

- Recommended default: link **one local table** to one Airtable base/table. A saved local view is presentation/query state, not the sync identity.
- Store `databaseId`, local `tableId`, Airtable base/table IDs, `fieldId → Airtable field ID`, `rowId → Airtable record ID`, per-field agreement hashes, and last pull/push stamps in the link sidecar under `.tablify/links/`. The sidecar remains sync metadata, not another native table format.
- Preserve explicit pull/push, dry-run counts, per-field conflict review, safe stale checks, typed errors/retry behavior, read-only remote schema, and “report remote deletion; never silently delete locally.” Preserve the current rule that missing Airtable record links are reported rather than inventing remote records, unless a separate user decision adds record creation.
- Keep the personal access token only in `SecretStorage`. No token in `.tablify`, link JSON, `data.json`, logs, or export.
- For linked-record sync, translate local referenced row IDs through the linked table’s Airtable record map. If either side lacks a valid mapping or the Airtable field type is not supported, report/skip it; never coerce a relation into text or silently write an incomplete link.

## 5. Refactor work plan

Phases are dependency order, not calendar estimates. The previous plan’s week estimates were for a different product and should not be reused.

### R0 — Replace the stale product contract before coding

- [x] Keep this file as the active refactor plan and mark the 2026-10-05 Bases-first proposal superseded.
- [x] Rewrite the normative docs first: `docs/01-spec.md`, `docs/02-architecture.md`, `docs/03-data-model-and-migration.md`, `docs/06-roadmap.md`, `docs/07-test-plan.md`, and the applicable product decisions in `docs/08-decisions.md`.
- [x] Update `AGENTS.md`, README status note, `START-HERE.md`, `prompts/**`, `src/plugin/DEV-NOTES.md`, and any active issue templates so no future task tells an agent to extend Bases, use frontmatter rows, or migrate `.tabula`.
- [x] Keep `manifest.json`/`package.json` release descriptions accurate for the current `0.1.0` build; update those fields only at the code cutover/release when `.tablify` support actually ships.
- [x] Preserve old `PROGRESS.md`/`CHANGELOG.md` entries as historical records; append native-format work rather than falsifying what `0.1.0` did. Correct only demonstrably false status text (for example, the existing prerelease tag does exist).
- [x] Confirm open design items in §7: link cardinality/delete behavior, row order semantics, external file edit behavior, and Airtable relation mapping.

**Exit:** one authoritative product/architecture contract; no disagreement between this plan, active docs, and implementation prompts.

### R1 — Specify and test the native schema (pure core)

- [ ] Add a pure `DatabaseDocument` model with database/table/field/row/view/link types and stable ID rules.
- [ ] Add total parser/validator/serializer functions for JSON. Return structured errors/warnings; never default a corrupt file to a blank database.
- [ ] Add an internal `.tablify` version migration runner and golden fixtures. No `.base` or `.tabula` migration branch.
- [ ] Decide unknown-key policy (recommended: preserve unknown v1 keys; reject or read-only open unknown future versions).
- [ ] Define record ordering and view ordering separately; Bases previously supplied source ordering, while the native file must own it.
- [ ] Add field type `link` (or equivalent typed relationship) with target table ID, row-ID values, validation, display/search/sort/filter behavior, and editor contract. Formula/lookup/rollup types remain out of scope.
- [ ] Move field options into the field definitions; remove `.base`-keyed `fieldOptions` parsing.

**Exit:** fixtures round-trip without loss; bad IDs, duplicate IDs, missing tables, broken links, malformed JSON, and future versions have explicit tested outcomes; core stays Obsidian/React/DOM-free.

### R2 — Database repository and `.tablify` file view

- [ ] Add `src/adapters/tablifyFile/**` for create/read/validate/write/subscribe/flush/dispose.
- [ ] Register and open `.tablify` through a custom Obsidian file view. Add a command to create a database and open it in a leaf; support reopen, rename, close, and multiple open panes.
- [ ] Add a document-level write queue: coalesce cell edits and bulk operations, serialize one document revision at a time, surface write failures, and avoid clobbering an external revision.
- [ ] Store all table view configs in the document. Keep global plugin preferences in Obsidian plugin settings only when they are truly global defaults.
- [ ] Update `AGENTS.md`’s current rule “Writes go through `adapters/bases`” to the new single storage boundary. Keep the core/adapters/grid/plugin import direction intact.

**Exit:** create a `.tablify`, enter values in multiple tables, close/reopen, and verify exact values/schema/views; no Bases core plugin is enabled or queried; malformed/external edits never cause silent data loss.

### R3 — Generalize the core from a note-backed table to a database

- [ ] Replace `filePath`-as-row identity in operations, cell references, selection, view rows, query tiebreaks, store snapshots, export, and sync local ports with stable row/table identity.
- [ ] Replace Bases `PropertyId`/`PropertySource`/prefixed ID resolution with native `FieldId` and a field definition owned by the database document.
- [ ] Replace `toYaml`/frontmatter mapping with type-safe native JSON encode/decode; keep `parsePlain`/`formatPlain` for clipboard and interchange.
- [ ] Remove note-only `FieldContext.path` assumptions. Add database/table/row/relationship context only where a descriptor or editor actually needs it.
- [ ] Replace file metadata time fields with record-level `createdAt`/`updatedAt` semantics, or explicitly defer those fields; do not display the database file’s modification time as every row’s value.
- [ ] Extend the operation/inverse model for database and table actions (create/rename/delete table, add/rename/delete field, view management, linked-record writes) while retaining one logical undo step per user action.
- [ ] Add referential-integrity operations. A delete must state what happens to inbound links and must be undoable.

**Exit:** a pure `DatabaseState` can apply/undo table and row operations; no note path, YAML, frontmatter, or Bases property ID is needed to represent a table.

### R4 — Bring the existing grid to native tables and views

- [ ] Add table switching/navigation and the minimal create/rename/delete table UX.
- [ ] Add field/table/record creation and editing from the native schema.
- [ ] Persist multiple named views with filters, multi-sort, grouping, hidden/reordered/resized columns, density, and frozen-primary presentation.
- [ ] Keep grid parity: virtualized rendering, range/row/column selection, keyboard navigation, clipboard, bulk edits, fill, row/column reorder, undo/redo, screen-reader roles, and mobile layout.
- [ ] Add linked-record editor/display that resolves names from the target table while storing IDs. Cover missing targets and cross-table navigation.
- [ ] Preserve existing locale-aware field formatting and the project’s mobile/performance gates.

**Exit:** a person can create a multi-table `.tablify` database, add linked records, create different views over a table, and complete the current grid workflows without any Bases view or Markdown rows.

### R5 — Rewire import/export and Airtable sync

**Part A, Step 1 — VERIFIED checkpoint (2026-10-08):** `src/core/database/import/preview.ts` composes the existing source reader and inference for the native-table path, including header handling, evidence, column overrides, and exclusions. It is source-only and does not import the note-oriented plan; the legacy note wizard and its vault/path semantics remain unchanged. XLSX bytes/workbook reading and worksheet selection, collision planning, and apply remain open.

**Part A, Step 2 — VERIFIED checkpoint (2026-10-08):** `src/core/database/import/destination.ts` defines the native create/append/replace choices and stable-field-ID versus suggested-name mapping modes. Replace follows ADR-0007: import-absent fields stay by default, rows match only by a selected field ID (otherwise append), and unmatched rows are retained. This defines the pure choice contract consumed by Step 3; no native wizard or apply path exists yet.

**Part A, Step 3 — VERIFIED checkpoint (2026-10-08):** `src/core/database/import/plan.ts` provides `buildDatabaseImportPlan` and plan-derived summary text. It creates exact operations for create/append/replace; uses injected IDs and clock plus native field descriptors; records selected types/options, included/excluded columns, per-cell conversions and skips, duplicate/key decisions, confirmations, retained unmatched rows, exact serialized byte deltas, and deterministic work units with caller-threshold-only warnings. Keyed replacement blocks duplicate source/target keys; no-key imports preserve duplicate source rows and list existing rows retained by a replace. Link values require explicit mappings to valid row IDs in the configured target table. The input document is not mutated and the note importer is unchanged. **VERIFIED:** targeted native planner + destination + preview + legacy-import suites passed 69/69; `npx --yes bun run check` passed (90 test files / 1,985 tests and all repository gates); `npx --yes bun run test:layout` passed 115/115 on the pre-existing grid harness. **OPEN:** native wizard/progress UI and XLSX workbook reading/worksheet selection. Real-host/device checks remain **NOT RUN**.

**Part A, Step 4 — VERIFIED transactional-runner checkpoint (2026-10-08):** `src/adapters/tablifyFile/importRunner.ts` consumes the Step 3 plan unchanged, refuses stale or externally changed documents, dispatches exact operations as one database-session history entry, then flushes through the shared write queue. Cancellation is honored before dispatch; after dispatch the runner waits for the explicit save result and distinguishes saved from applied-but-unsaved data. It does not chunk. A 400×6 regression test verifies one undo entry and one repository write, without touching the legacy note importer. **VERIFIED:** runner + database-store + session + write-queue targeted suites passed 44/44. `npx --yes bun run check` passed in a clean copy with the unrelated uncommitted BOM fixture restored to HEAD: 91 test files / 1,992 tests. `npx --yes bun run test:layout` passed 115/115. **OPEN:** native wizard, destination/link-mapping and confirmation UI, and visible progress/cancel UI; Part A Step 4 is not complete.

- [ ] Reuse CSV/TSV/XLSX readers, type inference, clipboard matrix logic, and XLSX/TSV serializers.
- [ ] Change the import wizard target from “create notes / disabled `.tabula` alternative” to “create a table / append to a selected table / replace a table,” with an explicit preview and destructive-replace confirmation. One imported sheet should become one undoable database operation (or a documented sequence if size requires chunking).
- [ ] Offer CSV, TSV, and XLSX export for a selected range, current view, or table. Do not preserve “CSV belongs to Bases” as a limitation.
- [ ] Update Airtable link identity from `.base path + viewName` to `databaseId + local tableId`, then connect row/field ID maps. Keep manual pull/push, conflict review, no remote schema mutation, token storage, error reporting, and mocked network tests.
- [ ] Add linked-record sync rules: only push/pull link fields when the target table’s record mapping is complete; report unsupported/missing mappings before writing.

**Exit:** import/export round-trips representative data; sync tests cover manual pull/push updates, stale local edits, same-field conflicts, remote deletion, partial reads, missing mappings, linked records, and token redaction. No live Airtable calls run in CI.

### R6 — Delete obsolete product paths, close docs, and release

- [ ] Remove `src/adapters/bases/**`, Bases-only view and registration code, note creation/import runners/settings, `.tabula` reader/migration modules, their tests/fixtures/snapshots, and Base/Tabula-only branches in import UI.
- [ ] Remove `bases`/`tabula-file` source kinds and stale note/frontmatter types. Keep `obsidian` typings and Obsidian APIs needed by the file view, settings, vault paths, and `SecretStorage`.
- [ ] Delete the throwaway `docs/legacy/spike/bases-path/**` after preserving any still-relevant findings in this plan or a historical note. Update `eslint.config.mts`/brand and source gates so they no longer treat Obsidian Bases as a shipped feature; retain the Airtable-base terminology exception.
- [ ] Update active README/manifest/product copy and `docs/01–12`, `AGENTS.md`, prompts, and dev notes. Remove obsolete Bases spikes/references from active guidance; preserve historical audit entries rather than rewriting history.
- [ ] Add a CI/source gate against reintroducing `BasesView`, `registerBasesView`, `BasesPropertyId`, `.base` view-config writes, `processFrontMatter`, and `.tabula` mode in shipped code. Scope the gate carefully: Airtable `baseId` and historical docs are intentional exceptions.
- [ ] Keep plugin id `tablify`; do not rewrite tag `0.1.0`. Publish a distinct pre-release only after desktop and real-phone verification required by the current release process.

**Exit:** `.tablify` is the sole native local database mode; active docs match the product; all gates pass; release notes plainly say old `.base`/`.tabula` content is not migrated or supported.

## 6. Test and acceptance gates

Every implementation phase must add tests before or with its behavior. The current `bun run check` gate remains the minimum; do not weaken it to make the refactor pass.

### Format and repository

- Valid multi-table `.tablify` parse/serialize/parse preserves stable IDs, option IDs, views, attachments, and links.
- Empty database, empty table, empty cell, `false`, `0`, empty text, and absent value remain distinguishable where the model requires it.
- Malformed/truncated JSON, duplicate IDs, broken link targets, unknown field types, unknown keys, and unsupported future versions are covered; no silent reset/write occurs.
- Internal format-version migration is deterministic and leaves a backup or recoverable prior document when a migration cannot complete.

### Store, operations, and file lifecycle

- One cell edit and one 400 × 6 paste each have the intended undo behavior and are saved through one coalesced document write.
- A failed save reports the error and restores truthful UI state; `flush()` resolves only after the document write finishes.
- Two panes on one `.tablify` share or reconcile one document session; external modify/rename/delete is handled without stale local state overwriting newer content.
- Delete/rename table, field, or record preserves referential integrity and undo restores both the object and its links.
- Opening/closing the custom file view releases subscriptions, timers, queues, and React roots.

### Grid, import/export, and performance

- Preserve the existing selection, clipboard TSV/HTML, keyboard, accessibility, mobile, and layout assertions against the native file-backed source.
- Import preview matches the operation actually committed; append/create/replace are tested; replace requires explicit confirmation; cancellation and failure are reported exactly.
- CSV/TSV/XLSX export/import uses stable field order, values, types, and selection semantics; formula-shaped spreadsheet text is never evaluated.
- Benchmark open, view filtering/sorting, edit/serialize, and import on the existing 5,000-row × 20-column fixture. Keep the 300 ms first-paint target as a starting regression guard, but set a separate measured write budget for serializing the JSON document before release.

### Airtable and release

- The current manual conflict-review guarantees survive with `rowId`/`fieldId`: no unreviewed same-field conflict, no silent schema change, no remote deletion mirrored locally, no token in data/logs, and no CI network calls.
- Verify the file extension opens in a real Obsidian vault without the Bases core plugin enabled.
- Complete the current desktop and physical-phone manual verification; the existing release log says those checks have not yet been run for `0.1.0`.
- Run `bun run check`, build/release checks, and the complete browser layout harness before tagging a new release.

## 7. Open design decisions to close before the dependent phase

These do not reopen the product direction; they are implementation-level contracts that should be decided in an ADR before coding the related feature.

| Decision | Recommended starting point | Must be resolved by |
|---|---|---|
| Linked-record cardinality | One field targets one table and stores an ordered list of target row IDs; a single-link field is a constraint on the same representation. | R1 |
| Link deletion behavior | Deleting a target row removes its inbound references in the same undoable transaction; deleting a table with inbound links is blocked until the user resolves them. Do not cascade-delete records silently. | R3 |
| Manual row order | Persist an explicit table/view row order; stable sorting uses `rowId` as final tie-break. Define what drag-reorder means in a sorted view. | R1/R4 |
| Multiple views and current view | Persist named views per table; open a stable default view, and keep selected table/view in Obsidian workspace state rather than mutating the database merely on focus. | R1/R2 |
| Unknown JSON keys | Preserve unknown keys within a supported version; future versions open read-only rather than being rewritten. | R1 |
| External edits / Obsidian Sync conflict | Compare file revision or last-loaded content before writing; reload or ask before replacing a changed document. Never “last writer wins” silently. | R2 |
| Airtable link granularity | One local table ↔ one Airtable table; multiple local tables may link independently. Keep credentials global in `SecretStorage`. | R5 |
| Cross-table sync | Translate a linked row only if the referenced table has a record mapping; report all unresolved relation values before applying. | R5 |
| Existing Airtable link metadata | Current links are keyed by `.base` path/view. Recommended default: do not migrate; leave files untouched and create fresh `.tablify` table links. Ask before building a converter. | R5 |
| JSON write strategy | Benchmark document-level rewrite; use one serialized queue and a recoverable write path. Do not choose a binary/container format unless real size/attachment evidence requires it. | R2 |
| Supported app floor | Keep current `minAppVersion` until the new custom file-view APIs are verified on the intended oldest desktop and mobile version; removing Bases does not itself justify lowering the floor. | R2/R6 |

## 8. Risk register

| Risk | Why it matters | Mitigation |
|---|---|---|
| Whole-database JSON rewrites | Every cell write touches one potentially large document, unlike the current per-note queue. | In-memory index, coalescing, one write per action, profile 5k × 20 and large imports, recoverable writes, explicit error state. |
| Multi-table identity leaks | `filePath` is embedded in operations, selection, query tiebreaks, sync, and labels. A superficial rename leaves wrong semantics. | Do a checked inventory and a staged `rowId` conversion; add a multi-table boundary test before grid wiring. |
| Linked-record integrity | Row/table deletion, table rename, and partial imports can leave dangling IDs. | Stable IDs, validation, explicit delete rules, undoable relation cleanup, broken-link UI and tests. |
| Airtable mapping complexity | Current sync is keyed to a Bases view/note path; linked fields require cross-table record maps. | Stabilize the native IDs/schema first; port sync after repository/table identity; refuse/report unmapped relation fields. |
| Attachment portability | A vault path reference is not an embedded attachment. | Show missing-file state, document the portability limitation, and keep the chosen path-reference contract explicit. |
| No old-format migration | Existing test-vault Bases data will not appear in the new plugin. | Preserve release tag and source files; announce the breaking change; do not delete or overwrite old vault content. |
| Stale instructions reintroduce Bases | README, AGENTS, prompts, architecture and settings are still Bases-first. | R0 rewrites active guidance before implementation; add a targeted source/lint gate, while preserving historical logs. |
| Mobile and real-vault verification | Current manual release checks were not run on a real device/vault. | Keep mobile first-class; do not call a build verified until the manual matrix is actually completed. |

## 9. What not to do

- Do not create a second repository or replace the existing plugin identity; the project is already named/id’d `tablify`, and the user confirmed this remains an Obsidian plugin.
- Do not keep `BasesSource` hidden as a “fallback,” keep a Bases view mode, or implement `.base` migration.
- Do not keep `.tabula` read-only/migrate support; the user chose `.tablify` only.
- Do not treat `registerBasesView` removal as the whole refactor; row identity, field schema, import, settings, views, and sync are coupled to note/Bases semantics.
- Do not remove Airtable sync when removing Obsidian Bases. They are distinct systems.
- Do not put Airtable credentials in the database file, plugin `data.json`, logs, or exports.
- Do not implement formulas/lookups/rollups in v1 without a new explicit scope decision.
- Do not modify `0.1.0` history or claim `.base`/`.tabula` compatibility.

## 10. Research references

### Repository evidence

- Current adapter boundary and type: `src/adapters/RowSource.ts`.
- Current Bases source and write queue: `src/adapters/bases/BasesSource.ts`, `src/adapters/writeQueue.ts`.
- Current Bases view/registration: `src/plugin/TablifyView.ts`, `src/plugin/main.ts`.
- Current single-table state/identity: `src/core/ops/types.ts`, `src/core/query/evaluate.ts`, `src/core/view/pipeline.ts`, `src/grid/store/**`.
- Current note-backed schema/import: `src/core/schema/propertySchema.ts`, `src/core/types.ts`, `src/adapters/notes/createNote.ts`, `src/plugin/import/**`.
- Existing `.tabula` reader/migration: `src/adapters/tabulaFile/**`, `src/core/migrate/**`, `tests/fixtures/tabula/**`.
- Existing Airtable boundary/state: `src/sync/SyncTarget.ts`, `src/sync/LinkStore.ts`, `src/sync/pullPush.ts`, `src/plugin/sync/**`.
- Current product/release truth: `README.md`, `manifest.json`, `package.json`, `CHANGELOG.md`, `PROGRESS.md`, `docs/manual-test-log.md`.

### Obsidian API references

- [Custom views](https://docs.obsidian.md/Plugins/User+interface/Views)
- [`Plugin.registerExtensions`](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerExtensions)
- [`FileView.onLoadFile`](https://docs.obsidian.md/Reference/TypeScript+API/FileView/onLoadFile)

The Obsidian docs establish a custom file-view route without Bases. The exact supported API lifecycle and write behavior still needs to be checked against the repo’s pinned type declarations and a real desktop/mobile Obsidian build during R2; do not infer it from the Bases spike.
