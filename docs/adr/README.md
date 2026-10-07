# Architecture decision records — native `.tablify`

**Opened:** 2026-10-07, at the start of R1 implementation, on branch `refactor/native-tablify`.

`docs/08-decisions.md` §Decision protocol and `docs/R0-contract-and-docs.md` Step 5 require an ADR
before implementing any open decision, with its source (`user`, `verified`, `proposed`), the rejected
alternatives, and the tests that prove the behaviour. This directory holds those records.

## Index

| ADR | Title | Phases | Status |
| --- | --- | --- | --- |
| [0001](ADR-0001-link-cardinality.md) | Link field cardinality, inverse representation and ordering | R1, R4 | Accepted |
| [0002](ADR-0002-row-and-table-deletion.md) | Row and table deletion with inbound links | R3 (validator: R1) | Accepted |
| [0003](ADR-0003-manual-row-order.md) | Manual row order is explicit document data; sort/group never rewrites it | R1, R4 | Accepted |
| [0004](ADR-0004-empty-and-unknown-values.md) | Empty, null and unknown values: distinctions preserved | R1 | Accepted |
| [0005](ADR-0005-external-edit-conflict.md) | External file edit while a document is open: never a silent overwrite | R2 (revision: R1) | Accepted |
| [0006](ADR-0006-retired-bases-keys.md) | Retired Bases-era keys: read-compatible, never a migration path | R5 | Accepted |
| [0007](ADR-0007-import-replace.md) | Import replace: full preview, destructive confirmation, import-absent fields retained | R5 | Accepted |
| [0008](ADR-0008-airtable-cross-table-links.md) | Airtable cross-table links sync only with a complete record map | R5 | Accepted |
| [0009](ADR-0009-performance-limits.md) | No hard document-size or write thresholds until measured | R2, R5 | Open — deferred to measurement |
| [0010](ADR-0010-app-version-floor.md) | App-version floor stays until FileView APIs are verified on the oldest supported desktop and phone | R2, R6 | Open — deferred to the R2 probes |
| [0011](ADR-0011-document-schema-identifiers.md) | The version-1 schema: key set, identifiers and uniqueness rules | R1 | Accepted |

## How to read a status

- **Accepted** — the behaviour is fixed for implementation. Every "Accepted" record here was a
  *recommendation* in the R0–R6 guides; it is adopted under the user's explicit 2026-10-07
  authorization to implement R1–R5 (`docs/08-decisions.md` §Implementation authorization log). The
  user's latest instruction always overrules an adopted recommendation — correcting an ADR is a
  documentation edit plus the test changes its Decision names, never a re-litigation.
- **Open** — deliberately not decided yet; the record states what will close it and which phase owns
  that evidence. Nothing may assume the answer in the meantime.

## Source labels used inside the records

`user` — stated by the user; `verified` — established by a run this repository can repeat;
`proposed` — a guide recommendation adopted for implementation (see above). A section that quotes a
rule from `docs/03` is labelled with that document rather than re-derived.
