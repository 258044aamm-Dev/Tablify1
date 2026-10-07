# ADR-0002 — Row and table deletion with inbound links

- **Status:** Accepted
- **Source:** adopted recommendation (`docs/08-decisions.md` §Open decisions,
  `docs/03-data-model-and-migration.md` §relations). No silent cascade is a `user`-confirmed scope
  line ("Do not change confirmed scope" — linked records v1 with defined delete behaviour).
- **Phases:** R3 (the operations), R1 (the validator preconditions this ADR names)
- **Proves:** R1: validator halves in `tests/unit/core-link-invariants.test.ts`; R3: deletion and
  undo tests with the R3 op suite.

## Context

Deleting a row, or a whole table, can orphan every link that pointed at it. Both a silent cascade
and a silent orphaning lose data in different ways: the first deletes rows the user did not name,
the second leaves the document in a state whose repair path is undefined. docs/03 already rules out
silent cascades; this record fixes what happens instead, so R1 can build the validator and R3 can
build the operations against it.

## Decision

1. **Deleting a row clears every inbound id that referenced it**, as part of the same operation, in
   the same undo transaction. Nothing outside the transaction is written; undo restores the row, its
   position in the explicit order, and every cleared id.
2. **The clear is explicit, not implicit.** The delete operation records the cleared cells (field,
   row, previous value) so undo is a tail-append of what was actually there; it never recomputes
   "what to restore" from the current document.
3. **Deleting a table is refused while it is referenced.** Refusal happens when any other table
   holds a link field whose `targetTableId` is this table — whether or not any cell currently
   resolves — or holds unresolved ids that point into it. The refusal names the referring tables and
   fields. No cascade delete of dependent rows, ever.
4. **The user resolves a refusal by editing, not by confirming a dialog.** There is no
   "delete anyway": the user removes or retargets the link fields, or clears their cells, and then
   the delete is a plain unreferenced-table delete.
5. **A table with zero references deletes freely**, including its rows' cells; the undo transaction
   carries the whole table, not a diff over it.

## Rejected alternatives

- **Cascade delete dependents.** Deleting one Projects row would silently delete its Tasks rows —
  the exact "silent cascade" docs/03 rules out, and unrecoverable if the user did not know.
- **Leave stale inbound ids on row delete.** The ADR-0001 validator would report them forever, R4
  would show dangling values, and a "repair" flow could resurrect phantom rows next to a deleted
  one. Clearing inside the delete transaction is the only point where intent is known.
- **Block row deletion whenever anything points at the row.** Turns a normal operation into an
  error path for the common case; the clear-in-transaction behaviour keeps it one undoable op.
- **Prevent the delete *and* keep a tombstone.** Tombs grow the document with entries no UI can
  explain in v1; undo history is the recovery mechanism (R3).

## Consequences

- R1's validator must classify unresolved ids (stale vs wrong-table) and expose the
  "which tables reference this table" query that the R3 refusal uses.
- R3's op model needs the inbound index computed from `cells` at operation time — derived state,
  never a sidecar file.
- The delete-then-undo path is a property test target: `undo(delete_table(t))` must restore a
  deep-equal document, including row order and cleared cells.
