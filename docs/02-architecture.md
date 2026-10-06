# 02 — Target architecture for native `.tablify`

> **Status:** future architecture for the planned refactor, not the current `0.1.0` implementation. The current plugin still uses Obsidian Bases. See the [master plan](reference/REFACTOR-PLAN.md) and [phase guides](reference/native-tablify/README.md).

## Architectural goals

- One local source of truth: a versioned `.tablify` JSON database file.
- One database document may hold many tables; the grid presents one active table and view at a time.
- Keep domain/query/operation code pure; keep Obsidian lifecycle and file APIs at the edges.
- Reuse current grid and field behavior where it is storage-neutral; replace note-path/YAML assumptions.
- Explicit, serialized document writes with revision/conflict handling; no silent data loss.
- Airtable transport and diff remain isolated from the grid, with manual user-triggered synchronization.

## Target layers

```text
src/
├─ core/                         pure TypeScript: no Obsidian, React, DOM, filesystem, network
│  ├─ database/                  versioned document types, IDs, validation, internal migrations
│  ├─ fieldTypes/                value semantics, formatting, parsing, filters, editors by ID
│  ├─ query/                     view query AST, parser, evaluator, sort/group pipeline
│  ├─ ops/                       database/table/field/row/view/link commands + inverses
│  ├─ selection/                 range model, clipboard matrices
│  └─ view/                      saved-view evaluation and presentation state
├─ adapters/                     ports and persistence; no React
│  ├─ tablifyFile/               JSON repository, serialization, revision-aware write queue
│  └─ files/                     attachment path resolution / host file boundary as needed
├─ grid/                         React grid over a table projection; no direct Obsidian I/O
│  ├─ store/                     selectors, commands, undo/redo, optimistic snapshot
│  ├─ cells/                     editors by field/editor ID, including linked records
│  └─ styles/                    theme/layout/accessibility rules
├─ import/ + export/             Matrix readers/writers, pure plans and serializers
├─ sync/                         provider port, Airtable client, diff/conflict engine
└─ plugin/                       Obsidian host glue, file-view registration, commands, settings
   ├─ TablifyFileView.ts          custom view for `.tablify` documents
   ├─ main.ts                     register file extension/view and commands
   ├─ settings/                   global plugin preferences, not table data
   └─ sync/                       compose repository/table port with sync engine
```

The tree is a target boundary map; names and exact file splits are implementation details to resolve in R1–R3. Do not copy old Bases adapters into a new directory and call that a refactor.

## Data ownership and ports

The current `RowSource` is a single-table grid port. A multi-table database requires a database-lifetime boundary as well as an active-table projection:

```text
Obsidian FileView ──> DatabaseRepository (one document/session)
                           ├─ validated DatabaseState
                           ├─ table/view lookup
                           ├─ operations + history
                           ├─ serialized persistence/revisions
                           └─ active-table projection ──> GridStore ──> React grid
```

The repository owns the canonical document snapshot, database ID, current file path/revision, mutation queue, and external-change subscription. The table projection exposes schema, rows, values, query results, and table-scoped operations to the grid. It must not keep a second writable copy of the table state.

**Identity rules:** `databaseId`, `tableId`, `fieldId`, `rowId`, `viewId`, and option IDs are stable. File paths identify where an Obsidian file is currently stored; they are not row identities. Human-readable names are labels and lookup aids, not primary keys.

## Obsidian file view and lifecycle

The intended host path is a custom Obsidian file view registered for the `.tablify` extension. Official documentation covers custom views via `registerView` and file-extension routing via `registerExtensions`; exact load/close/rename/event/write behavior must be checked against the pinned `obsidian@1.13.1` typings and a real supported app version before implementation ([custom views](https://docs.obsidian.md/Plugins/User+interface/Views), [`registerExtensions`](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerExtensions), [`FileView.onLoadFile`](https://docs.obsidian.md/Reference/TypeScript+API/FileView/onLoadFile)).

The view must:

1. Mount one database session and one React root for its file.
2. Show a read-only/error surface for malformed or newer unsupported documents; never mount an empty writable grid over invalid input.
3. Restore selected database/table/view through workspace state when supported without writing to the database just because a pane becomes active.
4. Unsubscribe and flush/dispose according to the approved close semantics.
5. Handle rename and split/popup leaves without changing `databaseId` or creating competing stale sessions.

No Bases API, `.base` view configuration, Bases-enabled check, or note-frontmatter write path participates in the target architecture. Keep the Obsidian API dependency for the actual host APIs the FileView needs.

## Field model

The current descriptor registry and field presentation work are reusable, but `PropertyId`, `toYaml`, note path context, and `.base` options are not the target data model. A future descriptor should own:

- type identity and label;
- canonical JSON-safe value semantics and default/empty rules;
- parse/format for spreadsheet text, not YAML;
- supported filter/comparison/group operations;
- editor identity and field-specific configuration validation;
- relation lookup requirements without importing Obsidian or React.

Select values should use stable option IDs; labels/colors live in field schema. Attachment values remain vault-relative path references. Linked-record fields store IDs and resolve labels through a repository lookup. Created/modified-time values use record metadata, not document-file timestamps. Formulas/lookups/rollups are deferred.

## Query and saved views

Use the existing pure query AST/evaluator and filter → search → sort → group pipeline as the starting point. A table’s saved view stores its query and presentation in the `.tablify` document. The query references `FieldId`s and is validated when loaded. Unknown or removed fields in a saved query must produce a visible warning/repair path; do not silently mutate the saved view during read.

Specify order separately from query sort. The database owns the record order; a view may sort/group it for display. Manual row drag under active sorting needs an explicit rule (see `docs/08-decisions.md`).

## Operations, store, and persistence

All changes flow through pure operations and inverses:

```text
user action → validate command → update snapshot/undo log
            → mark document revision dirty → serialize queue
            → compare external revision → write → acknowledge/report
```

- A cell edit, bulk edit, and import have explicit transaction and undo behavior.
- Coalesce writes at the logical action/document level; do not reuse the current per-note batching model unchanged.
- A failed write never leaves a false “saved” state. Later queued commands are not discarded by an earlier failure.
- External file changes while local state is dirty cannot be resolved by silent last-writer-wins. The ADR defines reload/keep-copy/conflict UX.
- Two leaves for one file share one repository or use tested optimistic revision checks.
- Preserve the prior file text/snapshot until a new serialized document is validated and accepted by the host write API.

Do not assume which Obsidian text write API is atomic or how its modify events behave: verify it in R2 against the pinned declarations and a real vault. No `processFrontMatter` call is appropriate for the `.tablify` JSON document.

## Import/export architecture

- Readers parse CSV/TSV/XLSX/clipboard into a pure matrix.
- Inference/preview returns a single exact `ImportPlan` consumed by the runner.
- The runner dispatches create-table, append-records, or replace-table operations to the repository; it never creates Markdown row files.
- Writers export a selected range, visible view, or table to CSV/TSV/XLSX; data stays literal and formula-shaped text is never evaluated.

## Airtable architecture

Keep `src/sync/**` provider-neutral. The local port is scoped to a `databaseId + tableId` and reads/writes stable row/field IDs. Airtable base/table names and IDs describe only the remote service. The `.tablify/links/` directory can remain optional sync metadata; it is distinct from `.tablify` database files. Existing Base-keyed links are not migrated by default. Credentials remain in `SecretStorage`.

Pull/push remains manual. A precomputed plan and conflict review precede writes; schema is read-only; remote deletion is reported but never applied locally; rows with no remote record mapping are skipped rather than used to invent a remote record. Relation sync requires a complete target-table record map.

## Error and lifecycle contracts

| Failure | Required response |
|---|---|
| JSON parse/validation fails | Preserve original file, show errors and read-only/recovery options; no default blank overwrite. |
| Unsupported future schema | Open read-only or refuse with version explanation; no rewrite. |
| Local write fails | Keep truthful unsaved/failed state; permit retry/export/recovery; do not announce success. |
| External modification during local dirty work | Detect revision mismatch and ask/reload/copy; never silently clobber. |
| Broken link or missing attachment | Show an unresolved state; retain reference until an explicit user operation changes it. |
| Unsupported Airtable field or partial read | Report/skip/block before unsafe writes; never coerce or silently discard. |

## Performance and release boundaries

Keep current grid budgets where meaningful (5,000×20 first-paint baseline, windowing, input latency, mobile layout, bundle gates). Add separate benchmarks for JSON parsing and whole-document serialize/write; do not guess a write limit before measuring. No new database runtime dependency is expected for plain JSON. The current prerelease and its manifest description remain unchanged until corresponding functionality ships.
