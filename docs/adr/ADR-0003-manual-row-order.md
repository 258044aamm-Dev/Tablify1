# ADR-0003 — Manual row order is explicit document data; sort/group never rewrites it

- **Status:** Accepted
- **Source:** adopted recommendation (`docs/03-data-model-and-migration.md` §row order,
  `docs/R0-contract-and-docs.md` Step 5, `docs/R1-json-schema-and-core.md` step 5).
- **Phases:** R1 (the document shape), R4 (the drag/sort interaction)
- **Proves:** R1: order round-trip and duplicate-id tests in `tests/unit/core-rows.test.ts` and the
  schema tests; R4: the interaction tests for reorder-under-sort.

## Context

A table has a user-visible row order. A view may sort and group. If a sort rewrote the stored order,
the user's intent would be destroyed by switching views; if two orders existed in the document with
no rule, two writers would fight. docs/03 settles the storage half ("manual order persisted;
tie-break rowId/order, never path"); the interaction half has to be decided before R1 ships the
document shape, because R1's validator and serializer encode it.

## Decision

1. **One explicit order per table: the `rows` array's document order.** There is no separate
   `rowIds` list beside it (an early draft of this ADR had one) — two spellings of one sequence is a
   drift bug waiting for a writer, and JSON arrays already carry order. That array is reordered only
   by an explicit reorder operation (R3). Rows never carry an order number in a cell, and no module
   ever sorts by file path.
2. **A view's sort/group is presentation only.** Evaluating a view produces a display sequence in
   memory; it never mutates `rowIds`, and no code path writes a view evaluation back to the
   document.
3. **Manual reorder is disabled while a sort/group is active** in the view being used (R4 owns the
   affordance and its explanation). The data model cannot express the conflict: there is exactly one
   stored order, and it only ever changes through an explicit reorder operation.
4. **Determinism:** equal sort keys tie-break on the explicit row order, then on row id. Never on
   path, never on insertion time (files have no insertion time), never on `undefined` ordering of a
   `Map` iteration.
5. **Reordering is an operation like any other** (R3): one op, undoable, no implicit writes to
   `cells`.

## Rejected alternatives

- **Persist the order the sort computed, at save time.** Switching to a sorted view would rewrite
  the user's manual order; switching back could not restore it.
- **Per-view stored orders.** Deferred with formulas — v1 has one order per table; adding per-view
  order now would change the document shape for a feature no v1 screen needs.
- **Store `order` numbers on rows.** Two sources of truth for one sequence; a deleted middle row
  leaves gaps whose renumbering is itself a write.
- **Tie-break by `filePath`.** Path is not identity (docs/03 §principles); files can be renamed and
  two rows could compare by a path that changed meaning.

## Consequences

- The R1 validator rejects a repeated row id in the table's `rows` array — the matrix "corrupt data
  is never silently emptied" means each case has a named finding, not a silent fixup.
- Counts in fixtures and tests never depend on `Object.keys` order.
- R4's grid shows the explicit order whenever no sort/group is active, and drag handles are hidden
  (with the reason) while one is.
