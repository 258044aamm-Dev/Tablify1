# R3 — Identities, operations, and undo planning

**Guide:** `docs/R3-identities-operations-and-undo.md`
**Current mode:** plan only.

Read the R3 guide, `docs/08-decisions.md`, core operations, query, selection, store and sync-local contracts, plus existing tests. Do not treat file paths as native record identities.

## Plan-only task

Map the migration from current single-table/note-path state to database/table/row/field IDs. Return:

1. Current identity use sites and exact proposed replacement interfaces.
2. Database/table/field/row/view operation list and inverse/transaction semantics.
3. Link integrity policy for rename/delete, including inbound references and undo (mark unresolved choices; do not pick silently).
4. Record creation/modification timestamp ownership; no `TFile` timestamps as row values.
5. Query tie-break and explicit row-order behavior under sort/group/drag.
6. Test plan for inverse laws, atomic bulk operations, multi-table edits, link repair, and stable IDs through rename/reorder.
7. Exact future file fence and a staged compatibility/deletion sequence.

Do not edit code or tests before explicit authorization. Do not leave a second writable copy of table state in the proposal.
