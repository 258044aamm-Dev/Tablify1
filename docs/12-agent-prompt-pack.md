# 12 — Native `.tablify` agent guide index

> **Mode warning:** these files describe the approved documentation plan and phase boundaries. Since 2026-10-07 the user has authorized implementation of R1–R5 (`refactor/native-tablify`, one step at a time, pushed after each step); R6 remains plan-only, and nothing outside an authorized phase may be treated as authorized by these files.

## Authoritative guide set

Start at [`docs/README.md`](README.md), then read the relevant phase guide. The guides are detailed design/checklists, not one-shot instructions to modify every listed file in one turn.

| Phase | Guide | Purpose | Gate for future implementation |
|---|---|---|---|
| R0 | [Contract and docs](R0-contract-and-docs.md) — completed documentation pass | Align product docs while distinguishing current 0.1.0 from target. | Link/doc audit, no product contradiction, `git diff --check`. |
| R1 | [JSON schema and core](R1-json-schema-and-core.md) | Freeze versioned multi-table JSON, stable IDs, values, links, views, parser/version migrations. | Fixtures round-trip; invalid/future data preserved; core purity. |
| R2 | [Repository and file view](R2-repository-and-file-view.md) | Open/create/save/reopen through a verified custom Obsidian file view. | Real app lifecycle/write proof; repository conflict tests. |
| R3 | [Identities, operations, undo](R3-identities-operations-and-undo.md) | Replace note-path/single-table state with stable database IDs and referential integrity. | Inverse/property tests; all local identity stable across rename/reorder. |
| R4 | [Grid and linked records](R4-grid-and-linked-records.md) | Keep grid parity and add linked-record UX. | Existing grid/a11y/mobile suite plus relation tests. |
| R5 | [Import/export and Airtable](R5-import-export-and-airtable.md) | Rewire CSV/TSV/XLSX and manual sync. | Spreadsheet round-trip and mocked sync/conflict/security suite. |
| R6 | [Removal, verification, release](R6-removal-verification-and-release.md) | Delete Bases/Tabula code and verify/release the cutover. | No obsolete runtime path; all automated/manual gates and docs accurate. |

## Session order

1. Paste `prompts/00-session-anchor.md`.
2. Paste one `prompts/native-tablify/phase-rN.md` file.
3. The agent must first return a plan and stop. Review it against the matching phase guide and `docs/08-decisions.md`.
4. In current plan-only mode, accept only documentation work explicitly requested. For implementation, obtain a separate user authorization that names the phase/task and code fence.
5. Review diff and evidence before continuing to another phase.

## Common constraints

- Current code and future plan must be described separately.
- Keep confirmed scope: `.tablify` only, multi-table, links v1, formulas/lookups/rollups deferred, attachment path refs, grid parity, CSV/TSV/XLSX interchange, manual Airtable sync, no Bases/Tabula migration.
- No source code, tests, styles, manifest/package, version, release assets, or vault data in plan-only mode (current exception: R1–R5 under the 2026-10-07 authorization).
- No unsupported API claims; inspect local pinned Obsidian declarations and run a real app proof later.
- No new dependencies, silent data loss, stale overwrite, or weakened tests.
- Never commit or tag unless explicitly asked.

## PROGRESS and evidence

Do not replace the historical `PROGRESS.md`. If an implementation phase is later authorized, add a new dated status/step at the top or use the project’s current progress protocol without erasing the 0.1.0 history. Record exact commands and results. The current documentation pass did not run Bun gates.
