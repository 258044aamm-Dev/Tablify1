# ADR-0001 — Link field cardinality, inverse representation and ordering

- **Status:** Accepted
- **Source:** adopted recommendation (`docs/03-data-model-and-migration.md` §relations,
  `docs/R1-json-schema-and-core.md` step 6). Scope item "linked records v1" is `user`-confirmed.
- **Phases:** R1 (schema, codec, validation), R4 (links UI)
- **Proves:** `tests/unit/core-link-invariants.test.ts` (R1 step 6)

## Context

Link fields connect rows of one table to rows of another. Before any code exists, six questions have
to be answered together, because each one changes the shape of the stored value (docs/03 §relations):
cardinality, inverse storage, ordering, target-delete behaviour, table-delete behaviour, and how a
broken reference is detected and reported. R1 owns the schema and the validator; R4 owns the UI. The
deletion questions are settled in [ADR-0002](ADR-0002-row-and-table-deletion.md).

## Decision

1. **Cardinality.** A link field declares `allowMultiple: boolean`. A single link holds zero or one
   row id; a multi link holds an ordered, duplicate-free list of row ids. Both shapes exist in v1
   fixtures so neither is retrofitted later.
2. **One side stores.** The value lives on the side that declares the field: `cells[fieldId]` holds
   `string` (single) or `string[]` (multi) of **row ids in the target table**. The target table is
   stated in the field's metadata (`targetTableId`), never inferred from a path or a view name.
3. **The inverse is generated, not stored.** When a link field declares `inverseFieldId`, the field
   with that id on the target table is *derived*: it is computed on demand by scanning the owning
   side, has no entries in any row's `cells`, and is never written. Marking is explicit in the
   schema (`generated: true` on the inverse field). A document that also stores cells for a
   generated inverse is a warning-level finding, not silently accepted and not destroyed.
4. **Ordering is user-visible and preserved exactly.** The stored order is the display order.
   Nothing sorts, dedupes or reorders a persisted list, and there is no tie-break by file path.
5. **Broken references are preserved and reported.** An id that does not resolve to a row of the
   target table is kept, and reported as an `unresolved-link` warning that names the field and the
   id. The validator distinguishes *stale id* (no such row) from *wrong table* (the id exists, in a
   different table). Nothing is dropped, nothing is auto-repaired, nothing is invented.
6. **Validation is one function.** `validateLinks(document)` returns findings; the parser attaches
   them as warnings. No other module re-implements the scan.

## Rejected alternatives

- **Store both sides (double-write).** Two copies drift the moment one write path misses; the
  document would carry a contradiction with no writer of record.
- **Array of `{id, label}` objects.** A label is a cached copy of another row's cell — exactly the
  drift problem, and lookups already resolve labels at display time.
- **Implicit inverse by naming convention** (a field named after the source). Invisible in the
  document, breaks on rename, and cannot express "no inverse" on purpose.
- **Prune dangling ids on load.** Destroys a value the user may be about to fix by re-creating the
  row or repairing the id; violates "corrupt data is never silently changed" (docs/10).

## Consequences

- Counts and rollups over links must scan the owning side; the inverse column is read-only in R4.
- Export/import must not treat a generated inverse as a stored field (a CSV with a generated
  inverse column is an export artifact, not a source of truth).
- The validator is the single source of `unresolved-link` findings, so its message shape is part of
  the contract that tests assert.
- `inverseFieldId` pointing at a missing field, or at a non-link field, is a document error.
