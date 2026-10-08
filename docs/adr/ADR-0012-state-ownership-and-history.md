# ADR-0012 — One canonical database state, one derived active-table projection, one history

- **Status:** Accepted
- **Source:** adopted recommendation (`docs/R3-identities-operations-and-undo.md` §Step 1 and §Step 6),
  implemented under the user's 2026-10-07 authorization for R1–R5
  (`docs/08-decisions.md` §Implementation authorization log). Step 1 asks the phase to "choose one
  canonical in-memory database state and one active-table projection. Avoid two writable copies", and
  step 6 requires the transaction/history contract to follow from that choice.
- **Phases:** R3 (identity, operations, history), R4 (grid reads the projection), R5 (import/export
  write through the same operations)
- **Proves:** `tests/unit/r3-inventory.test.ts` (the identity baseline this decision is built on);
  the projection and history tests land with their own steps in R3 and are named in
  `docs/R3-identities-operations-and-undo.md` as those steps commit.

## Context

R2 landed the repository the refactor needs: one `DatabaseSession` per resolved path
(`src/adapters/tablifyFile/registry.ts`), holding one immutable `DatabaseDocument` (R1's model),
serializing whole-document writes behind a revision check (ADR-0005), and never letting two panes
hold two writers. The legacy grid path, meanwhile, still holds its own Bases-backed state keyed by
note path and property id, and a store that edits it. Two questions R3 cannot defer:

1. **Which state is authoritative** once the grid reads a `.tablify` document? The failure to avoid
   is the one R2 was built against: two writable copies of one database, each convinced it is the
   truth, each writing the file.
2. **What scope does undo/redo have** when a database has several tables? The guide is explicit that
   a table switch must not silently clear the history, and silent loss of undo is exactly the class
   of bug a user experiences as data loss.

A third question — where the grid's *transient* state (selection, scroll, an open editor) lives — is
already answered by R2 step 7 and its record (`src/plugin/viewState.ts`): workspace leaf state,
plugin settings, or the document, each with one home.

## Decision

**1. The document is the only authoritative state.** For a database that is open, the
`DatabaseDocument` held by its session is the single source of truth. Nothing else stores a second
copy of schema, rows, views or link values in a form that can be written back. The grid may hold
*derived* data (sorted indices, pixel geometry, the current page of rows) and *transient* data
(selection, drafts, focus), but an edit becomes real only by becoming an id-addressed command applied
to the document, and it reaches the disk only through the session's queue.

**2. The active table is a projection, not a store.** The table a pane shows is derived from the
document by its `TableId`: schema, rows, views, plus the index maps a renderer needs. It is recomputed
from the document, never mutated, and never diffed back — an edit is addressed to
`(TableId, RowId, FieldId)` and applied to the document directly. Where the projection is computed is
an implementation detail of R3; that it is derived is not.

**3. One database-scoped history.** Undo and redo form one stack for the open database, not one per
table. Switching tables neither clears nor forks the stack, and an undo applies to the table its
entry names, regardless of which table is on screen when it runs. Each entry is one logical user
action (a cell edit, a paste, a bulk fill, a row deletion, a field rename) with its inverse and the
ids it touched — never one entry per cell (step 4), and never a snapshot of the whole document.

**4. History holds data, not the world.** Entries are pure and id-addressed: no callbacks, no
`TFile`s, no React nodes, no `Date` instances, no closures over a pane (step 6). Anything that cannot
be spelled that way is not an undoable operation; it is UI state, and it lives in the leaf.

## Consequences

- A second writable copy is not a shortcut to be taken later: `src/core/database/**` remains free of
  host and UI concepts (the inventory's `native` class holds that line), and the grid core is
  rewritten to address the document rather than to own the data.
- The undo stack survives a table switch, so the guide's "do not silently clear undo state on a table
  switch" is satisfiable without a special case.
- Cross-table operations (a link edit whose inverse lives in another table) undo as one entry, which
  is only possible because the document is one write unit — the same fact ADR-0005 relies on.
- The projection has to be cheap enough to recompute; if measurement later says otherwise, the answer
  is memoization keyed by document revision, not a second store (ADR-0009: no thresholds before
  measurement).
- Undo history is session state. It is not serialized into `.tablify`, and a reopen starts with an
  empty stack — deliberate: a file is not a log of one person's editing session.

## Implementation record — R3 step 6 (2026-10-08)

- `DatabaseSession` owns a 60-entry-bounded undo/redo history of accepted operations and exact inverses.
  The session applies an operation or history plan before publishing it; a refusal cannot partially
  change the document or consume a history entry. Reload and disposal clear the session history.
- `createWriteQueue` subscribes to dirty document transitions and debounces them into the same
  revision-checked whole-document `flush` used by explicit flush, undo, redo, and close. A failed write
  leaves the optimistic document dirty and undoable; the session emits a failure event for the file
  view's notice and the queue remains retryable.
- `createDatabaseStore` is a framework-free, per-pane derived selector in
  `src/adapters/tablifyFile/databaseStore.ts`. It shares the session/document/history, holds only the
  selected `TableId`, and derives a fresh `ActiveTableSnapshot`; navigation does not dispatch or write.
  The existing legacy `src/grid/store/store.ts` remains untouched.
- Evidence: the R3 step 6 section of the phase guide, the history/queue/store unit suites, the current
  identity-inventory gate, the full `bun run check`, and the 115-case layout gate. Step-by-step gate
  results are recorded in `/home/user/r1-r5-progress.md` (workspace tracker).

## Implementation record — R3 step 7 (2026-10-08)

- `createdTime` and `lastModifiedTime` remain native read-only metadata fields. The active-table
  projection derives them from `TableRow.createdAt`/`updatedAt`; an invalid raw cell for either field is
  still preserved and warned about, but is not authoritative for a view.
- The operation algebra remains pure and clock-free. Record creation/duplication and cell edits may carry
  explicit, offset-bearing timestamp strings from the host; validation and inverses preserve exact row
  metadata. The native field schema has no `PropertySource` or formula type; a similarly named unknown
  key is round-tripped without acquiring semantics.
- A displayed row number is derived from the visible row-id order, never stored as identity or cell data.
- Evidence: `tests/unit/core-projection.test.ts`, `tests/unit/core-operations.test.ts`,
  `tests/unit/core-fields.test.ts`, and `tests/unit/core-database-view-output.test.ts`; complete R3
  step-7 gate results are in the phase guide and `/home/user/r1-r5-progress.md`.

## Rejected alternatives

- **A grid-owned writable store beside the document** (the pre-refactor shape). Rejected: this is the
  clobber R2 exists to remove, and a diff-back merge re-derives identity from names, which R3 is
  removing precisely because names are not identity.
- **A per-table history stack.** Rejected: it silently drops undo when a person moves between tables,
  which the guide forbids, and it makes a cross-table link edit two entries that cannot be undone as
  one action.
- **Snapshot-based undo** (store whole document copies per action). Rejected: memory grows with
  document size rather than with edit count, and a snapshot has no ids, so replay after an external
  reload cannot be reasoned about. Inverses are the contract the existing `src/core/ops` work already
  implements; R3 generalizes them rather than replacing the technique.
- **Serializing history into the document.** Rejected: it would make an edit trail part of a shared
  file, grow every write, and give a second writer (Sync, another editor) something to conflict with.
