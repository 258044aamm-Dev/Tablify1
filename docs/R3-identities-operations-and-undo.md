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
[`docs/audit/R3-identity-inventory.md`](audit/R3-identity-inventory.md), regenerated from the tree at
each step. Its numbers move *because R3 is landing*, which is the point: 1205 occurrences at step 3
(48 `replace` files, 727 occurrences; 463 `historical`; 8 `guard`; 7 `remote-record-id`; `host-path`
now **empty** — it held `src/adapters/notes/createNote.ts` through that file's `toYaml`/`YamlValue`
matches, and step 3 removed those names, see below), and **zero** inside the R2 native path. `tests/unit/r3-inventory.test.ts` holds the report to the tree byte for
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

### Step 3 — Replace YAML/frontmatter value conversion ✅ landed

**What landed, in one sentence:** the field descriptors speak the document's canonical JSON and nothing
else; the YAML vocabulary is gone from `src/**`; and a descriptor can no longer address a file.

- **`toYaml` → `toJson`.** The contract method on `FieldDescriptor` (`src/core/types.ts`) now returns
  `CellValue` — the canonical value — instead of a YAML shape, and the three YAML value aliases
  (`YamlScalar`, `YamlList`, `YamlValue`) are deleted. All sixteen registered descriptors and the
  read-only file-time column in `core/schema/propertySchema.ts` were renamed with it; the call sites
  (`core/import/plan.ts`, `adapters/notes/createNote.ts`, `adapters/bases/BasesSource.ts`,
  `sync/values.ts`) hand the value to the host's frontmatter writer, which serializes it as YAML at
  that boundary. Where the conversion was already the identity it is now *literally* the identity:
  most descriptors return their value unchanged.
- **One vocabulary, asserted.** `tests/unit/value-vocabulary.test.ts` proves `CellValue` and
  `CanonicalCell` (`core/database/values.ts`) are mutually assignable, so the descriptor layer and the
  document codec cannot drift; and for every registered type it feeds a sample of canonical values
  through `toJson` into `encodeCell`, asserting the document accepts every one of them.
- **`parsePlain`/`formatPlain` stay.** Both remain on the contract and are asserted present, because
  clipboard and spreadsheet interchange is a *text* format and never went through YAML.
- **`FieldContext.path` is gone.** The property was declared and read by nothing (it carried the note's
  path), so removing it deleted one line from the type and one property from every construction site —
  including `adapters/bases/BasesSource.ts`, which passed the row's file path in for no reader. A
  descriptor cannot address a file any more; attachment existence and link labels resolve in the
  adapter/view. Asserted at the type level and as a runtime key check.
- **Numeric conventions held.** `percent` still stores percent points (`25` is 25 %) and `duration`
  still stores seconds, with the column's `unit` remaining an input convention only; both are asserted
  through the descriptor *and* through the document codec in the same test file.
- **The inventory's `host-path` class emptied, and the report says so.** Its only member was
  `src/adapters/notes/createNote.ts`, matched through that file's YAML vocabulary rather than through a
  path; the class and its rule stay, and the guard test now names the one class a step emptied instead
  of pretending all five still have members.

**The select-identity call, recorded.** The step's bullet — *"move select option label/color/order into
field metadata and store cell option IDs"* — is **landed in the document half** (R1: `SelectOption` in
`core/database/fields.ts`, `opt_…` ids in `values.ts`, labels/colours/order in the field's settings) and
proven by this step's tests: a fixture document holds an `opt_…` id in the cell, the label and colour
come from the field, renaming the option leaves every cell byte-identical, and a *label* written where an
id belongs becomes a preserved invalid cell rather than a silent repair. What this step deliberately does
**not** do is change the note path's label identity. A note's frontmatter can only spell a label, and the
note model lets a person type a brand-new option no metadata knows: mapping labels to ids there would
either invent ids for unseen labels (silently mutating the user's data) or drop the value. So the label
stays the string on that path, every descriptor treats it as opaque, and the rule is stated once in
`types.ts` §`FieldOption` for whoever touches either side. R6 deletes the note path; the document's id
identity is the destination.

- Replace descriptor `toYaml` with JSON-compatible encode/decode or direct canonical JSON values where sufficient.
- Preserve `parsePlain`/`formatPlain` for clipboard/spreadsheet interchange; their text semantics do not depend on YAML.
- Move select option label/color/order into field metadata and store cell option IDs.
- Preserve current numeric conventions (percent points, duration seconds) unless an ADR explicitly changes them.
- Remove `FieldContext.path` dependence from pure field code. Add a relation lookup port/context only where link rendering/editing requires it; do not import Obsidian into a descriptor.
- Keep missing attachment status as adapter/view resolution, while the core stores only a normalized vault-relative string.

### Step 4 — Define database-scoped operations and inverses ✅ landed

**What landed:** `src/core/database/operations.ts` — the document's whole mutation surface, replacing the
provisional three-command seam (`commands.ts`, now deleted). Twenty-one user-facing kinds plus six
restore-only ones (the last two added in step 5), each with preconditions, affected ids, an inverse
payload and a stale-id guard:

| Group | Kinds |
|---|---|
| database | `set-document-name` |
| table | `create-table`, `rename-table`, `move-table`, `delete-table` |
| field | `create-field`, `rename-field`, `reconfigure-field`, `move-field`, `delete-field` |
| record | `create-record`, `duplicate-record`, `set-cells`, `move-record`, `delete-record` |
| view | `create-view`, `rename-view`, `duplicate-view`, `delete-view`, `update-view` |
| relation | `set-link` |
| restore-only (produced as inverses, never by a user action) | `insert-table`, `insert-field`, `insert-record`, `insert-view`, `restore-field`, `restore-cells` |

The decisions that matter, with what each one buys:

- **Ids, never names or positions.** Every write names its target by stable id; the only index that
  appears is the one a *reorder* sets, and its inverse carries the old index recorded from the state
  that was actually there. A stale id is a `no-such-…` refusal, so *"never apply a write to an object
  with a reused name but different id"* is true by construction rather than by a check.
- **Whole-value inverses.** A deleted record comes back as the row it was (cells included); a deleted
  column comes back with `cells` recorded per row; a deleted table comes back whole. Nothing is
  recomputed from the current document, which is ADR-0002 §2 and the reason undo cannot drift.
- **`delete-record` clears inbound links in the same operation** (ADR-0002 §1) — and it clears only the
  one id, keeping the rest of a multi link **in order** (ADR-0001 §4). Undo restores the untouched lists
  and the cleared cells exactly; the property sweep exercises this on every seed.
- **`delete-table` is refused while referenced**, naming the referring tables and fields (ADR-0002 §3),
  whether or not a cell currently resolves — the new `validateLinksForTableDelete` query in
  `core/database/links.ts` answers "which fields point here", and it consults declarations, not values.
- **`set-link` writes one side only.** The owning side stores (`string` for a single link, an ordered
  `string[]` for a multi link, "no value" to clear); the generated inverse is refused
  (`generated-field`) because it is derived and never stored (ADR-0001 §2/§3); an id that is not a row
  of the target table, a repeat inside one list, and two ids on a single link are all refusals.
- **A type change refuses to strand values** (`type-change-loses-data`) when a stored value cannot be
  written as the new type. Option-list changes are *not* refusals: an option id the new list does not
  know is kept and reported (ADR-0004, `validateOptions`), because that is the value the user has.
- **A batch is one transaction.** `applyOperations` applies a list as a unit, stops at the first
  refusal with the input untouched, and returns the inverses **in undo order** — so a bulk paste, an
  import chunk or a delete-with-cleanup is one history entry and one document write, which is what
  step 6 needs.
- **Stale-revision guard, stated as a split.** The operation layer's guard is id resolution. The
  *file*-level guard stays R2's: the session compares the document revision before writing and the
  queue never writes over a revision it did not read (ADR-0005). Write-failure behaviour is R2's too —
  memory first, dirty on success, visible and retryable on failure — because the core has no filesystem
  to fail on.

**Tests:** `tests/unit/core-operations.test.ts` (61 tests) replaces `core-commands.test.ts` and holds
the guide's four claims: purity and sharing (untouched tables/rows come back by reference; the input is
byte-identical after an operation), **apply-then-inverse restoring the document byte for byte** for
every kind — as pairs *and* as a long sequence undone in reverse — the ADR-0001/0002/0003 behaviours,
the refusal codes, and a seeded property sweep (60 seeds × 15 generators, plus 31 twelve-step random
sequences) that re-runs the same round-trip assertion. The sweep found one real defect on its first
run: clearing an inbound id replaced a multi link with the value it held before instead of removing that
one entry, which is exactly the class of mistake the ADR-0001 §4 ordering rule exists to prevent. The
session test file's `dispatch` now exercises the batch path (`session.dispatch(...)` returns the undo
list); `commands.ts` and its test file are gone.


Extend the existing typed operation model so each mutating user action carries enough identity and prior data to undo:

- record: create, duplicate, set one/many cells, reorder, delete;
- field: create, rename, reconfigure type/options, reorder/hide, delete with data-loss preview;
- table: create, rename, reorder, delete with inbound-link check;
- view: create, rename, duplicate, delete, update query/presentation;
- relation: set/unset linked row IDs and any inverse-field change decided by ADR;
- database: rename metadata only if database name is stored in the document.

For each operation specify preconditions, affected IDs, whether it is reversible, inverse payload, stale revision guard, and write failure behavior. Applying/undoing one logical user action should yield one history entry and one repository transaction, not one history entry per cell.

### Step 5 — Add relation integrity to operations ✅ landed

**What landed:** `src/core/database/relations.ts` adds pure, targeted graph checks and cell inspection;
`src/core/database/operations.ts` applies them at every ordinary link write. The existing
`validateLinks(document)` in `links.ts` remains the **only document-wide scan**: the new helpers index
row/table identity for a requested cell or schema/write operation and do not duplicate that full scan.

- **The read side stays lossless.** `relationFindings` and `inspectLinkCell` distinguish missing target
tables, missing rows, foreign-table rows, duplicate IDs, wrong cardinality, generated-inverse data,
and unreadable values. Inspection returns `empty`, `resolved`, `broken`, or `unreadable` plus per-ID
resolution, without repairing or normalizing a value. Parsing still accepts supported documents with
broken IDs as warnings; serialize → parse preserves the exact stored value.
- **Every new edge is checked.** `create-field` requires a real target; `reconfigure-field` compares the
old and new declaration/value findings and refuses new broken edges, cardinality problems, or
generated-value conflicts. It can carry an already-broken target unchanged through an unrelated field
edit, so loaded damage remains repairable. `create-record` checks new link values against a temporary
document containing the pending row, so a valid self-link is allowed. `duplicate-record` also checks
inherited link cells; it cannot silently copy a broken edge or stored inverse. `set-link` and direct
`set-cells` both verify row ownership, duplicate IDs, single/multi
shape, and generated-inverse restrictions, so a caller cannot bypass relation rules by using the lower
level cell operation. Ordinary non-link writes retain their existing behavior.
- **Existing damage is not silently made worse or erased.** A targeted edit can preserve a pre-existing
finding while repairing or clearing it; a new missing/foreign reference, duplicate, cardinality issue,
missing target, generated write, or unreadable new value is refused before the input document changes.
A user can explicitly clear a broken field value, then repair its target declaration. Parse/serialize
never deletes a dangling value. Inverse-declaration anomalies remain warnings rather than write
refusals, as fixed by ADR-0001 §6 and reported by the existing `validateLinks` scan.
- **Deletion stays one operation.** `delete-record` clears inbound stored edges from the same document
revision and removes only the deleted id from multi-links, preserving the order of the rest (ADR-0001
§4 and ADR-0002 §1). `applyOperations` still makes a multi-step batch atomic; table deletion still uses
the ADR-0002 declaration-level refusal.
- **Undo can return to old damage exactly.** Step 5 adds restore-only `restore-cells` and `restore-field`
inverses. They restore the exact previous cells/schema — including a deliberately repaired dangling
value or target configuration — without treating historical state as a fresh user write. Normal user
writes remain subject to relation checks; delete/cleanup and repair undo stay byte-for-byte reversible.
The operation surface is now 21 user-facing kinds plus 6 restore-only kinds.

**Verification (2026-10-08):** `bun scripts/r3-inventory.ts --check` is current. `bun run check`
passed typecheck, lint, brand and manifest gates, formatting, **83 unit files / 1,920 tests**, build,
all 32 gated contrast checks, CSS gate, and bundle-size gate (539,698 raw / 164,993 gzip bytes,
within 900 / 300 KB limits). The audit script calls this class a remote service record identifier,
keeping the check within the existing brand-gate permissions. `bun run test:layout` passed **115/115**
across desktop, dark, phone-closed, phone-keyboard, and tablet
browser profiles. The focused `tests/unit/core-relations.test.ts` covers target ownership,
malformed/cardinality findings, all guarded write paths (including duplicate and generated-inverse
cells), self-links, exact broken-link round-trip/repair undo, target-configuration undo, and atomic
order-preserving deletion; `tests/unit/core-operations.test.ts` and the R2 session/link suites also
passed in the full unit run.

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
- Property tests prove `apply` then inverse returns exact database state for every op, including linked
  references. *(Proven at step 4: `tests/unit/core-operations.test.ts` — every kind as a pair, all kinds
  as one sequence undone in reverse, and the seeded sweep.)*
- Undo/redo across table changes, bulk cell edits, relation edits, deletion/link cleanup, and persistence failures is deterministic.
- Stale operations are rejected or rebased by an explicit rule; never apply a write to an object with a
  reused name but different ID. *(Proven at step 4 by construction — every operation is id-addressed, and
  a vanished id refuses — with the file-level revision guard staying R2's, as the step-4 section says.)*
- Multi-table query/filter/sort/group output is isolated to its selected table and saved view.
  *(Proven for the projection at step 2 — `tests/unit/core-projection.test.ts` §"view output is isolated
  to its own table"; the query/filter/group half arrives with steps 3–6.)*
- No `filePath` or `PropertyId` is used as a local row/cell identity; remaining paths are explicitly host file/attachment addresses or remote Airtable values.
- Core remains import-clean: no Obsidian, React, filesystem, network, or DOM.
