# ADR-0011 — The version-1 schema: key set, identifiers and uniqueness rules

- **Status:** Accepted
- **Source:** adopted recommendation (`docs/R1-json-schema-and-core.md` steps 1–2). The guide
  requires "all field names and required/optional rules" to be resolved in a schema ADR before
  fixtures are published; the two step-1 fixtures (`minimal`, `unknown-v1-key`) are the first
  entries of the matrix this record governs.
- **Phases:** R1 (extended by steps 4–5 as fields, rows and views land), R2–R5 (readers)
- **Proves:** `tests/unit/core-envelope.test.ts`, `tests/unit/core-ids.test.ts`

## Context

One `.tablify` file is one database, and the format has to be readable by a program that was built
before some of its keys existed. Two decisions make that workable, and both are cheap now and
expensive later: which keys the envelope owns and requires, and how identity is spelled. The step-1
reader already fixes the first half; step 2's id rules complete it.

## Decision

**Envelope keys.** `format` (literal `"tablify"`, required), `version` (integer ≥ 1, required; the
document schema version, not the plugin version), `databaseId` (required id), `name` (required
non-empty string; the display name, freely changeable), `tables` (required array; an empty database
carries `[]`, it does not omit the key).

**Table keys.** `id` (required id), `name` (required non-empty string). `fields`, `rows` and `views`
are required once their steps (4–5) land; until then they are preserved as unknown entries, and the
fixtures move from `unknown` to parsed structure in the same commit that starts reading them.

**Unknown keys are preserved everywhere** — at the root and on every object — and re-emitted after
the keys this version owns (ADR-0004's normalization is the same statement for cells).
No "preserve only at the root" half-measure: the expensive case is a newer build's data nested
somewhere a v1 reader does not look, and that is exactly the case the rule must cover.

**Identifiers.** An id is `<prefix>_<body>`:
`db_`, `tbl_`, `fld_`, `row_`, `viw_`, `opt_` — one prefix per kind (`database`, `table`, `field`,
`row`, `view`, `option`), so an id is self-describing wherever it appears. The **canonical** body is
26 Crockford-base32 characters over 16 random bytes drawn from an injected source (nothing in the
core talks to a platform random API; tests inject a seeded source). The **accepted** body on read is
`[a-z0-9]{1,64}`: broader than canonical on purpose, because a hand-edited id that is safely shaped
must not be refused, and canonical-ness is a generation rule, not a read rule. Ids are opaque
strings; nothing may parse meaning out of a body.

**Uniqueness scopes.** Document-wide: `databaseId` identifies one database and table ids are unique
among a document's tables (duplicates are a refused load, not a warning). Per table: field ids, row
ids and view ids are unique. Per field: option ids are unique. Each later step applies its scope in
the same shape this step applies the table rule.

**References, not spellings.** A reference is an id in its own kind's space: a link cell holds
target **row** ids (ADR-0001); a select cell holds option ids; a saved view names field ids. Display
labels, order and paths are never references.

## Rejected alternatives

- **UUIDs without prefixes.** Opaque and correct, but neither a reader nor a human can tell a row id
  from a field id in a diff, and wrong-kind references become a class of bug that is invisible.
- **Ids derived from names or paths** (`Projects/Tasks.row-3`). Every rename becomes a rewrite of
  every reference; this is the mechanism the refactor removes.
- **Enforcing the canonical length on read.** Refuses documents a person edited by hand while their
  shape is still unambiguous; the acceptance rule is the lax one and generation is the strict one.
- **Optional `tables` key** ("absent means empty"). Two spellings of the empty database, and a
  truncated file becomes indistinguishable from an empty one — R1's exit criterion forbids exactly
  that silent-emptiness failure.
- **A general `ids` registry or a UUID v7 scheme.** Ordering is carried by explicit sequences
  (ADR-0003), not by id bytes; a time-ordered id would smuggle time into identity, which R1's
  purity rules bar.

## Consequences

- `readDocument` refuses malformed ids (`malformed-database-id`, `malformed-table-id`) and duplicate
  table ids (`duplicate-table-id`, reported at the second occurrence with both indices named).
- Steps 4/5 will reuse `findDuplicates` and the same refusal shape for field/row/view/option ids; no
  step invents its own uniqueness check.
- Any future "id of anything" generic must go through `isIdOfKind`/`idKindOf` rather than a
  hand-rolled regex, so the prefix map stays the single source of truth.
