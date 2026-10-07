# R3 — Stable identities, database operations, and undo

**Mode:** implementation guide. Authorized for implementation 2026-10-07 (see [`08-decisions.md`](08-decisions.md) §Implementation authorization log): steps commit and push one at a time on `refactor/native-tablify`. **Status:** in progress — steps marked ✅ are implemented, gated and pushed; implementation state is always the source at HEAD. **Dependencies:** R1 schema frozen (✅ complete); R2 repository/session landed (✅ complete, steps 1–7 pushed at `71e6051` — `src/adapters/tablifyFile/**` is the repository R3 generalizes, and its `DatabaseDocument` is the one canonical state R3 step 1 adopts). **Blocking decisions:** ADR-0002 (deletion with inbound links), ADR-0003 (manual row order), and this phase's own boundary record, [ADR-0012](adr/ADR-0012-state-ownership-and-history.md). **Not in scope here:** the Bases-era grid path's removal (R6) — R3 replaces identities and persistence assumptions in the code the native path shares, and leaves the legacy view running until R6.

## Objective

Generalize the existing pure grid core from one Bases-backed table keyed by note paths to one database document containing stable tables, fields, rows, and views. Preserve its query, selection, clipboard, operation, inverse, history, and store work while replacing identities and persistence assumptions.

## Audit checklist before edits

The implementation phase must inventory every note/Base assumption, not just rename `filePath`:

- `src/adapters/RowSource.ts` and the current `bases`/`tabula-file` kinds;
- `src/core/types.ts`: `PropertyId`, `YamlValue`, field context `path`, field options description, field types `createdTime`/`lastModifiedTime`;
- `src/core/schema/propertySchema.ts` and Bases-prefixed property resolution;
- `src/core/ops/types.ts`, apply/inverse/build/history modules and any `filePath` operations;
- `src/core/query/**`, `src/core/view/**`, `RowView`/sort tie-breakers;
- `src/core/selection/**`, `src/grid/store/**`, row/cell selectors, clipboard/export/sync references;
- grid row keys, error labels, notices, field menus, import-plan types, and test fakes/fixtures.

Before writing code, generate a read-only search inventory and classify each match: a) row identity to replace, b) host path that remains for locating the database/attachment, c) remote Airtable identifier that remains, d) historical test/document string.

## Step-by-step conversion plan

### Step 1 — Define the state ownership boundary ✅ landed

The boundary is fixed in [ADR-0012](adr/ADR-0012-state-ownership-and-history.md): the open document is
the only authoritative state, the active table is a derived projection (never a second store, never
diffed back), and the history is one database-scoped stack that survives a table switch.

The audit deliverable landed with it, and it is a gate rather than a paragraph:
`bun scripts/r3-inventory.ts` scans `src/**` and `tests/**` for the ten identity markers
(`filePath`, `PropertyId`, `propertyId`, `YamlValue`, `toYaml`, `RowSource`, `processFrontMatter`,
`metadataCache`, `getFileCache`), classifies every match by an explicit rule table, and **fails** when
a file with matches has no class. The committed report is
[`docs/audit/R3-identity-inventory.md`](audit/R3-identity-inventory.md): 104 files, 1315 occurrences,
`replace` 808 / `historical` 482 / `host-path` 11 / `remote-record-id` 10 / `guard` 4, and **zero**
inside the R2 native path. `tests/unit/r3-inventory.test.ts` holds the report to the tree byte for
byte, asserts every class is used and the native path stays clean, so the numbers in this paragraph
cannot drift from the code while the rest of R3 is implemented.

Choose one canonical in-memory database state and one active-table projection. Avoid two writable copies. A useful conceptual split is:

```text
DatabaseDocument / DatabaseState
  ├─ tables: TableId → table schema + rows + saved views
  ├─ database operations: create/rename/delete table, field, view
  └─ links: validated target table/row references

ActiveTableSnapshot
  └─ one selected table projection consumed by existing grid/query code
```

The active projection can be derived, but edits must resolve back to the canonical document through stable IDs. Document whether table switching keeps a table-scoped history stack or one database history stack; do not silently clear undo state on a table switch.

### Step 2 — Replace row and field identity ✅ landed

Two modules carry the change, both under `src/core/database/**` and both inside the zero-marker native
path the inventory holds clean:

- **`refs.ts`** — `TableRef`, `RowRef`, `FieldRef`, `ViewRef` and `CellRef`, plus `cellRef`,
  `sameCell` and `cellKey`. A reference is ids only: no vault path and no display name, because a path
  is an address the host uses to find a file and a name is a label a person reads, and neither is
  identity. `CellRef` carries `TableId` because a cell's table cannot always be derived from where the
  reference is used (the guide's first bullet).
- **`projection.ts`** — `ActiveTableSnapshot` and `projectTable(document, tableId)`, the ADR-0012
  derived view of one table: the table and its fields/rows/views are handed back as the document's own
  objects, with `fieldById` / `rowById` / `rowIndexById` / `viewById` resolved once per projection, and
  a projection is *frozen* so a consumer cannot start a second store by accident. Lookups
  (`rowAt`/`fieldAt`/`viewAt`) answer `undefined` for anything of another table; `cellOf` returns the
  stored state or `undefined` for "no value" and is deliberately not the query layer's falsy-normalized
  read; `rowNumber` is 1-based and derived from the manual order (ADR-0003), never stored; and
  `sortRowIds`/`displayOrder` produce a view's row sequence — sort stack, then manual order, then
  `RowId` — with an injectable `FieldComparison` for the descriptor comparison a field type owns, and
  `compareCanonical` as the pure-data fallback (absent/`[]`/`null` at the far end of the ordering, so
  `desc` mirrors `asc` exactly as the legacy descriptors did).

`RowView.filePath` is now **`RowView.rowId`** (`src/core/query/evaluate.ts` and the doc comment that
described the path tie-break, `src/core/view/pipeline.ts`). The legacy Bases-era grid is still running
until R6, so `src/grid/store/store.ts` bridges the gap with `rowViewOf`, which passes the note path
through as an opaque `rowId` — the bridge is labelled as a bridge and R4 step 2 replaces it.

Tests: `tests/unit/core-projection.test.ts` (24 tests) proves the projection is derived rather than
copied, resolves nothing for another table's ids, separates "no value" from "no such row", numbers rows
from the manual order, orders canonical values deterministically, sorts without writing (same sequence
twice, document byte-identical), isolates a view to its own table, and reads its own fixture ids out of
the shipped `rows-views` fixture instead of composing them. The drift gate from step 1 did its job on
the way in: it failed while a doc comment in `refs.ts` still spelled `filePath`, so the report was
regenerated from the tree and the marker was reworded rather than the report being edited to match.

- Replace row path identity with `RowId`; include `TableId` in cell references and operations whose context otherwise cannot be derived.
- Replace `PropertyId` with `FieldId`; preserve display names as labels only.
- Include `DatabaseId` in external repository/sync identity, not in every internal function if the repository already scopes it.
- Rename is a metadata operation; it must not rewrite every cell, link, selection, history entry, or sync snapshot.
- Query stable-sort tie-break uses stable `RowId`, not path/name. The row-order ADR determines any manual ordering key.
- Keep Obsidian file paths only at explicit host boundaries for `.tablify` addressing and attachment resolution.

### Step 3 — Replace YAML/frontmatter value conversion

- Replace descriptor `toYaml` with JSON-compatible encode/decode or direct canonical JSON values where sufficient.
- Preserve `parsePlain`/`formatPlain` for clipboard/spreadsheet interchange; their text semantics do not depend on YAML.
- Move select option label/color/order into field metadata and store cell option IDs.
- Preserve current numeric conventions (percent points, duration seconds) unless an ADR explicitly changes them.
- Remove `FieldContext.path` dependence from pure field code. Add a relation lookup port/context only where link rendering/editing requires it; do not import Obsidian into a descriptor.
- Keep missing attachment status as adapter/view resolution, while the core stores only a normalized vault-relative string.

### Step 4 — Define database-scoped operations and inverses

Extend the existing typed operation model so each mutating user action carries enough identity and prior data to undo:

- record: create, duplicate, set one/many cells, reorder, delete;
- field: create, rename, reconfigure type/options, reorder/hide, delete with data-loss preview;
- table: create, rename, reorder, delete with inbound-link check;
- view: create, rename, duplicate, delete, update query/presentation;
- relation: set/unset linked row IDs and any inverse-field change decided by ADR;
- database: rename metadata only if database name is stored in the document.

For each operation specify preconditions, affected IDs, whether it is reversible, inverse payload, stale revision guard, and write failure behavior. Applying/undoing one logical user action should yield one history entry and one repository transaction, not one history entry per cell.

### Step 5 — Add relation integrity to operations

Create pure graph checks for:

- link field target table exists;
- every stored row ID belongs to the configured target table;
- no duplicate references unless explicitly allowed;
- maximum cardinality if single-link is supported;
- deleting a record or table follows the R0 ADR;
- undo restores inbound links and their ordering exactly;
- links across two tables are updated atomically within the same database document write.

If a loaded document has dangling links, keep the data readable and surface a broken-reference state; do not delete the dangling cell values during parse/serialize without consent.

### Step 6 — Adapt history and the store

- Keep operations pure and serializable where possible; do not place callbacks, `TFile` objects, React nodes, or `Date` instances into history state.
- Make `dispatch` validate before optimistic application; rejected operation returns an explicit refusal.
- Queue one document write batch after state transition; `flush`, undo, redo, close, and sync use the same revision-aware repository path.
- Maintain truthful optimistic UI after partial failures. The document is one write unit; define the new failure contract instead of copying the old per-file partial-success behavior.
- Preserve the current bulk import coalescing intent. Do not defer snapshots or notifications in a way that breaks immediate selectors, undo, progress, or error reporting.

### Step 7 — Preserve read-only metadata semantics

- `createdTime` and `lastModifiedTime` must refer to row timestamps stored in row metadata, or be deliberately removed from the new field set before R4. They cannot use the `.tablify` file `TFile.stat` for every row.
- A derived row number can be shown from current view order if retained; it is not a stored auto-number identity.
- Formula/file/note `PropertySource` variants are not part of the native schema. Do not keep a generic “formula” escape hatch after formulas have been deferred.

## Future file map

- `src/core/database/**`: database/table/schema/row/view IDs and state, validators, relational helpers.
- `src/core/ops/**`: database/table/record/field/view/link ops and inverses.
- `src/core/query/**`, `selection/**`, `view/**`: stable ID-based inputs and output.
- `src/grid/store/**`: database-level state store plus stable active-table selectors.
- `src/sync/**`: receives row/field IDs only at a later phase; avoid coupling R3 to Airtable implementation.

## R3 test matrix and exit criteria

- Tests prove that renaming/reordering fields, tables, and rows preserves identity and cell values.
- Property tests prove `apply` then inverse returns exact database state for every op, including linked references.
- Undo/redo across table changes, bulk cell edits, relation edits, deletion/link cleanup, and persistence failures is deterministic.
- Stale operations are rejected or rebased by an explicit rule; never apply a write to an object with a reused name but different ID.
- Multi-table query/filter/sort/group output is isolated to its selected table and saved view.
  *(Proven for the projection at step 2 — `tests/unit/core-projection.test.ts` §"view output is isolated
  to its own table"; the query/filter/group half arrives with steps 3–6.)*
- No `filePath` or `PropertyId` is used as a local row/cell identity; remaining paths are explicitly host file/attachment addresses or remote Airtable values.
- Core remains import-clean: no Obsidian, React, filesystem, network, or DOM.
