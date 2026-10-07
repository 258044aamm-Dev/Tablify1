# 08 — Decision record for the native `.tablify` refactor

This file is the durable product/engineering decision ledger. “Confirmed” records a user decision. “Proposed” is a safe default to evaluate, not a user-approved product choice. “Open” must be resolved in an ADR before the phase listed. The detailed sequence is in [`docs/`](README.md).

## Product decisions

| ID | Decision | Status/source | Consequence |
|---|---|---|---|
| P1 | Keep product name **Tablify**, current repository, and plugin id **`tablify`**. Do not fork into a new identity or rewrite tag `0.1.0`. | Confirmed by user; current repo/tag verified | Keep release identity stable; select a new distinct version for a future refactored release. |
| P2 | Obsidian remains the plugin host; Bases is removed as an integration. | Confirmed by user | Replace `BasesView`/registration/source with a custom `.tablify` file view; no Bases compatibility mode. |
| P3 | `.tablify` versioned JSON is the sole native editable database format; one file holds multiple tables. | Confirmed by user | Schema, stable IDs, multi-table operations and file repository are the critical path. |
| P4 | No `.base` migration, Bases fallback/view mode, or assumption that users need old Bases-data migration. | Confirmed by user | Old `.base`/note content stays untouched and unsupported by the new plugin. No converter in roadmap. |
| P5 | Remove legacy `.tabula` read/migrate support. | Confirmed by user | Delete reader/migration/UI branches and fixtures when native path replaces current storage. No `.tabula` mode. |
| P6 | Linked records are in the first stable release. | Confirmed by user | Stable row/table IDs, relation validation, editor, navigation, deletion rules, sync mapping. |
| P7 | Formulas, lookups, and rollups are deferred. | Confirmed by user | No computed-field engine in v1; do not imply formulas are inherited from Bases. |
| P8 | Attachment fields store vault-relative paths; no binary embedding. | Confirmed by user | Missing-file UI is required; cross-vault asset portability is not guaranteed. |
| P9 | Preserve current grid feature parity. | Confirmed by user | Selection, clipboard, editing, bulk operations, undo, views, accessibility, mobile and performance remain gates. |
| P10 | Keep CSV/TSV/XLSX import and export. | Confirmed by user | Add CSV export; it is no longer delegated to native Bases. Formats are interchange, not native storage. |
| P11 | Include Airtable sync in the first stable release with manual pull/push and field-by-field conflict review. | Confirmed by user | Reuse provider-neutral diff/client work and re-key the local port to database/table/row/field IDs. |
| P12 | No Airtable auto-sync; preserve safe conflict review and no remote schema mutation. | Existing behavior to retain; scope confirmation includes manual/conflict review | Network only on explicit action; token remains in `SecretStorage`; deletions/unsupported mappings are reported. |
| P13 | No legacy data importer is a requirement. | Confirmed by user | Keep old data untouched. Internal `.tablify` schema-version upgrades are still required and are not old-data migration. |

## Current-release truth

`0.1.0` remains a Bases-backed GitHub prerelease. It has a tag and release; manual real-vault and physical-device verification is still recorded as `NOT RUN`. The target docs describe future work. Keep `manifest.json`, `package.json`, and README claims truthful to the code until a native-format build ships. Do not revise old changelog/progress history to make it appear the new format was present earlier.

## Proposed data-model defaults (not yet user-approved)

| ID | Proposal | Phase to resolve |
|---|---|---|
| D1 | Stable IDs for database/table/field/row/view/option; labels are not identity. | R1 |
| D2 | Select cells store option IDs; options carry labels/colors/order. | R1 |
| D3 | A link field targets one table and stores an ordered list of row IDs; single-link is a cardinality constraint if needed. | R1/R4 |
| D4 | Row deletion clears inbound links in one undoable operation; table deletion is blocked while inbound relations remain. Never cascade-delete silently. | R3 |
| D5 | Saved views are table-scoped and stored in the database file; workspace active table/view state does not write to the file. | R1/R2 |
| D6 | Explicit row order is persisted; sort/group presentation is distinct from source order. | R1/R4 |
| D7 | Preserve unknown keys within a supported schema version; future versions open read-only and are never rewritten. | R1/R2 |
| D8 | One local table links to one Airtable table; different local tables may link independently. | R5 |
| D9 | Existing Airtable link files keyed by `.base` path + view name are not migrated by default; leave them untouched and create fresh links for native tables. | R5; ask before changing |
| D10 | External changes to a dirty database are detected and trigger reload/keep-copy/conflict UX; no silent last-writer-wins. | R2 |

## Engineering decisions to retain unless a measured need changes them

| ID | Decision | Status | Consequence |
|---|---|---|---|
| E1 | Bun + locked `bun.lock`; esbuild for plugin bundle; `tsc --noEmit` for types. | Existing repo | Keep `bun run check` and CI scripts; no package-manager switch in this refactor. |
| E2 | Strict TypeScript and no `any`/unsafe non-null assertions. | Existing repo | Keep current lint/type fences; add only documented narrow exceptions. |
| E3 | React 19 grid, hand-rolled store/selectors, plain CSS tokens. | Existing repo | Reuse current grid; no state library, CSS framework, or virtualizer dependency without an ADR. |
| E4 | Core has no Obsidian/React/DOM; adapters have no React; sync has no React. | Existing repo architecture | Extend boundaries to database repository and custom file view; never let the core call host APIs. |
| E5 | Automated unit/DOM/layout gates plus real-device release verification. | Existing repo | Keep CI and manual logs; browser harness is not proof of real FileView/phone behavior. |
| E6 | Secrets through Obsidian `SecretStorage`; no telemetry; explicit network disclosure. | Existing repo/policy | Keep credentials out of database, plugin settings, sidecars, exports, logs. |
| E7 | Keep current plugin id and never overwrite an existing tag. | Existing release constraint | `0.1.0` is preserved; refactor uses a new version/tag. |

## Open decisions — phase blockers

| Question | Recommended default | Needed by |
|---|---|---|
| Link cardinality and inverse fields? | One field targets one table; ordered list representation; decide if inverse is explicit or generated. | R1/R4 |
| Broken/dangling link parsing? | Preserve reference and show repair state; do not delete during read. | R1 |
| Table/row deletion rules? | No silent cascade; row deletion removes inbound refs atomically/undoably; table deletion blocked until inbound links resolved. | R3 |
| Drag reorder under sort/group? | Hide/disable reorder when it cannot have clear semantics, or define a stable explicit order operation. | R4 |
| `null` vs absent vs empty string/list? | Field-specific canonical rules with exact tests. | R1 |
| External edit while dirty? | Stop write and offer reload or keep-copy/compare path. | R2 |
| Old sync sidecar conversion? | No conversion by default; preserve files and make new links. | R5 |
| App-version floor? | Keep current manifest floor until custom FileView APIs are verified on the oldest supported desktop and phone. | R2/R6 |
| Import replace field/schema behavior? | Preview every destructive change; require confirmation. | R5 |
| Document-size/write threshold? | Measure parse/serialize/write on target-sized fixtures before setting limits. | R2/R5 |

## Decision protocol

- Add an ADR before implementing any open decision; include source (`user`, `verified`, `proposed`), rejected alternatives, and tests that prove the behavior.
- A recommendation in the phase guides is not user approval.
- Do not change confirmed scope (Bases removal, no migration, `.tablify` only, linked records v1, deferred formulas, spreadsheet interchange, manual Airtable sync) without asking the user.
- Do not use “plan only” authorization to alter source code, tests, CSS, manifest/package metadata, version tags, release assets, or vault data.
