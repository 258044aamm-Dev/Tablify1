# Native `.tablify` refactor — guide index

**Status:** planning documentation only. These guides describe a target that is **not implemented** in the current `0.1.0` pre-release. They authorize no source-code changes by themselves. The user’s explicit `/Plan only mode` remains in force; application code, tests, build metadata, and release assets must not be changed unless the user separately authorizes implementation.

**Audit baseline:** `main` at `50f041f135abe9e7e9f111cf7c170b32dc98e9e0`, tag `0.1.0`; see [`../REFACTOR-PLAN.md`](../REFACTOR-PLAN.md) for the evidence inventory and overall decision record.

## How to use this guide set

1. Read this index and the master refactor plan first.
2. Read the relevant current contract (`docs/01–08`) and the matching R-phase guide before planning any future implementation step.
3. Treat checklists as **future work**, not as completed code. Do not tick implementation boxes until the behavior exists and the named gate has been run.
4. If a recommendation in a guide is not among the user-confirmed decisions, it is a proposal. Resolve it in `docs/08-decisions.md` before the dependent phase; do not silently turn it into a requirement.
5. Keep each phase small enough to review. The phase guide is a sequence of independently testable work packages, not permission to implement the whole phase in one diff.

## Confirmed target

- Obsidian remains the host; retain repository/plugin identity `tablify`.
- A versioned JSON `.tablify` **file** is the only native editable database format. One file holds multiple tables, records, fields, and saved views.
- Linked records ship in the first stable release. Formulas, lookups, and rollups are deferred.
- Attachment cells reference vault-relative paths; attachment bytes are not embedded.
- No Obsidian Bases view, Bases compatibility mode, `.base` migration, `.tabula` reader, or `.tabula` migration.
- Preserve current grid workflows; retain CSV/TSV/XLSX import/export and manual Airtable pull/push with per-field conflict review.
- The folder `<vault>/.tablify/links/` is currently only a sync-metadata location. It is not the `.tablify` database file format. Airtable's remote “base” remains a separate concept from Obsidian Bases.

## Phase guides and dependencies

```text
R0 docs + decision lock
  └─ R1 native JSON schema + pure validation
       └─ R2 repository + Obsidian file view
            └─ R3 stable identities + database operations
                 └─ R4 grid parity + linked records
                      └─ R5 import/export + Airtable sync
                           └─ R6 removal sweep + release verification
```

| Guide | Purpose | Main outputs | Depends on |
|---|---|---|---|
| [R0 — Contract and documentation](R0-contract-and-docs.md) | Remove contradictory active guidance; settle decisions before implementation. | Aligned product contract, ADR list, document/entry-point map. | User-confirmed scope. |
| [R1 — JSON schema and pure core](R1-json-schema-and-core.md) | Define the versioned database document, IDs, values, links, views, parser, and internal schema migration. | Frozen v1 schema, parser/validator contract, fixtures and core test matrix. | R0. |
| [R2 — Repository and file view](R2-repository-and-file-view.md) | Design file I/O, view registration/lifecycle, create/open/close, writes, external edits, and multi-pane behavior. | Database repository, `.tablify` Obsidian file view, write/revision contract. | R1. |
| [R3 — Identity, operations, and undo](R3-identities-operations-and-undo.md) | Replace note-path/single-table assumptions with database/table/row/field identity. | Multi-table core state, operations, inverses, referential-integrity contract. | R1; interfaces from R2. |
| [R4 — Grid and linked records](R4-grid-and-linked-records.md) | Preserve existing grid parity over native tables/views and add usable linked-record editing. | Table/view navigation, link editor, parity/a11y/mobile acceptance suite. | R2 and R3. |
| [R5 — Import/export and Airtable](R5-import-export-and-airtable.md) | Rewire spreadsheet interchange and manual sync to stable local IDs. | Table-based import/export, re-keyed sync port/link model, conflict tests. | R1–R4. |
| [R6 — Removal, docs, and release](R6-removal-verification-and-release.md) | Delete obsolete Bases/Tabula paths, close active docs, verify the new build, and release honestly. | Clean source/docs gates, manual test record, distinct verified prerelease. | R0–R5. |

## Current-versus-target truth

The current `0.1.0` code still registers a Bases view and stores grid rows as Markdown-note properties. It does **not** implement `.tablify` database files. The existing `.tablify/` folder stores link metadata. The `.tabula` reader/migration utilities and the disabled import alternative are legacy code to remove; they are not an active native data source. The current README, manifest, and package description describe the existing prerelease and must not be edited to claim future functionality before cutover.

The current product and verification history remains historical evidence. Keep old release notes/progress facts intact; label future-target docs clearly, and revise factual statements when a record says the `0.1.0` release/tag was not published. The tag exists as a GitHub prerelease; manual desktop/phone verification remains outstanding according to the manual log.

## Out of scope for these guides

- Changing or generating application code, tests, styles, manifests, package metadata, version tags, release assets, or Obsidian vault contents.
- Building a Bases compatibility mode or converters from `.base`, Markdown notes, or `.tabula`.
- Claiming that `.tablify` files can already be opened by the current plugin.
- Choosing unresolved relationship cardinality, table/record delete behavior, external-edit conflict UX, or old Airtable-link metadata migration without an ADR/user decision.
