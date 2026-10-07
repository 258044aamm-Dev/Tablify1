# R5 — Spreadsheet interchange and Airtable planning

**Guide:** `docs/R5-import-export-and-airtable.md`
**Mode:** authorized for implementation (2026-10-07), on `refactor/native-tablify`, one step at a time with a push after each step; starts after R4's exit gate. The planning task below is the phase's plan of record.

Read the R5 guide, `docs/03-data-model-and-migration.md`, `docs/08-decisions.md`, current import/export paths, sync client/diff/conflict logic, `SecretStorage` boundary, and tests.

## Plan-only task

Return separate plans for spreadsheet interchange and Airtable:

1. CSV/TSV/XLSX import target choices: create table, append, replace; exact preview-to-operation parity, cancellation, destructive confirmation, undo, large-file limits.
2. CSV/TSV/XLSX export for range/view/table, stable columns, literal values, formula-shaped text safety.
3. Airtable link identity `databaseId + tableId`; field/row maps to Airtable IDs; existing `.base`-keyed links left untouched by default.
4. Manual pull/push, preflight, conflict review, missing/partial mapping, remote deletion, retry/errors, token secrecy.
5. Linked-record mapping across tables and the condition that must hold before any remote write.
6. Test matrix using fixtures/mocked transport; no live Airtable traffic in CI.
7. Exact files/interfaces to change later and unresolved decisions.

No new dependency, no user credential in the repository, and no live Airtable call from tests; the real-vault smoke run is user-run and its `manual-test-log` rows flip only on the user's report.
