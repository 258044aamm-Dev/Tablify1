# ADR-0007 — Import replace: full preview, destructive confirmation, import-absent fields retained

- **Status:** Accepted
- **Source:** adopted recommendation (`docs/08-decisions.md` §Open decisions,
  `docs/R5-import-export-and-airtable.md`). "Spreadsheet interchange only" is `user`-confirmed
  scope; XLSX/CSV import must not become a second source of truth.
- **Phases:** R5 (R1 provides only the fixtures-level semantics this record names)
- **Proves:** R5 preview/apply tests and the `import-absent-fields` fixture.

## Context

Importing a spreadsheet over an existing table can destroy more than it brings: columns dropped,
types changed, cells cleared, rows removed. Any of those can happen silently if "import" simply
replaces the table. The fences are already set — docs/10 §7 stops for lossy conversion; docs/08
requires preview and confirmation — but the exact contract has to be written before the preview
code, because it decides what the preview must even show.

## Decision

1. **Replace means "replace the values of the columns the import provides" — never the schema
   wholesale.** Fields absent from the import are **retained** with their values. Removing an absent
   column is a separate, explicit choice, offered in the preview and off by default.
2. **Every destructive change is previewed before it can happen.** The preview enumerates, per
   affected column and row: type changes, cells that would be cleared or re-spelled, rows the
   import does not mention, and any conversion that is lossy (a number that cannot parse, a date
   that cannot round-trip, an optionId that has no match). Lossy items are marked, and the apply
   button states their count.
3. **Confirmation is required and is about the enumerated list**, not a generic "are you sure": the
   user confirms the replacement they were shown. If the plan changes after the preview (the
   document was edited elsewhere), apply re-plans and refuses rather than applying the stale plan.
4. **Row identity:** rows are matched by a user-mapped key column when the user maps one;
   otherwise the import appends new rows. Import never reuses a row id for a different logical row
   and never deletes rows it cannot match — "unmatched existing rows" is a listed, confirmed item.
5. **Applicable to Airtable pulls with the same preview rules** where they replace local values;
   the Airtable-specific link rule is ADR-0008.

## Rejected alternatives

- **Delete-all-then-insert.** Churns row ids, which breaks every link and every view selection;
  the file would be a new document wearing the old one's name.
- **Schema replaces wholesale, values merge.** Silently drops columns the user did not mention in
  the import — the most common field-loss report in importers that do this.
- **Silent lossy conversion with a post-hoc summary.** A summary after the fact cannot un-convert;
  docs/10 §7 requires the stop *before* the write.
- **Match rows by position.** Column insertions shift positions; a position mapping writes one
  logical row's values into another's.

## Consequences

- The R5 preview data structure is the apply plan (one object), so preview and apply cannot drift.
- R1's invalid-value passthrough (ADR-0004) feeds the preview with honest "kept as-is" rows instead
  of conversions that only look clean.
