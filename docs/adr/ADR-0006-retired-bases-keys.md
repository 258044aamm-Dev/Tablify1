# ADR-0006 — Retired Bases-era keys: read-compatible, never a migration path

- **Status:** Accepted
- **Source:** `user`-confirmed scope (docs/08 §Product decisions: Bases removal, no old-data
  migration; `docs/R5-import-export-and-airtable.md` §no old-link migration).
- **Phases:** R5 (and the R1 fixture that proves unknown keys survive a round-trip)
- **Proves:** R1: `unknown-keys.tablify` fixture keeps every unknown key byte-identically decoded;
  R5: absence-of-migration tests that assert the sidecar/metadata files are untouched.

## Context

The 0.1.0 plugin keyed its Bases/Airtable sync metadata to a `.base` path and a view name, and it
wrote a `.tablify/links/` sidecar keyed the same way. Path is not identity (docs/03) — renaming a
file or a view silently broke the mapping, which is a large part of why this refactor exists. The
confirmed product decision is: no migration of old data. This record fixes what "no migration"
means precisely, so R1 and R5 agree on where legacy data is and is not read.

## Decision

1. **R5 never reads `.base` files, Bases field paths, or legacy sidecar keys for matching.** The
   sync identity is `(databaseId, tableId, rowId, fieldId)`, all stable ids the document itself
   carries. There is no path-keyed or view-keyed legacy mapping, no heuristic name matching, no
   "best effort" import of old sync state.
2. **Files the plugin no longer understands are left exactly as found.** Old sidecar/metadata files
   are not read, not rewritten, not deleted, and not renamed. Removing them is the user's decision
   outside the plugin; the docs name them so the user can find them.
3. **Unknown keys inside a `.tablify` document are preserved by the R1 round-trip** (including keys
   that once belonged to a legacy schema). Preserving is not reading: R5 does not interpret them;
   R1 keeps them so a document written by a newer plugin version degrades gracefully.
4. **The `.tabula` reader and its v1/v2 importers are out of scope for the native path** (docs/03:
   dead-end; `docs/legacy/` keeps the record). Nothing in `src/core` may import from it, and no
   phase re-points it at `.tablify` "temporarily".

## Rejected alternatives

- **Best-effort key matching on path.** The exact bug class this refactor exists to remove; a
  migration that half-works is worse than none, because it looks like it worked.
- **Auto-deleting old metadata files.** Destroys data the user may still need to read; and a plugin
  that deletes files it no longer understands is a plugin whose writes cannot be trusted.
- **A one-time "import old sync links" command.** Same matching problem, now behind a button with
  implied blessing; out of the confirmed scope.
- **Reading unknown keys to round-trip them "intelligently".** Reading is the first step to acting
  on them; the rule is preserve-only.

## Consequences

- The R1 serializer must be able to place unknown keys back without reordering or reformatting the
  ones it does understand beyond the one-time normalization ADR-0004 defines.
- R5's smoke tests assert that a vault containing legacy files is byte-unchanged after sync
  operations run nearby.
