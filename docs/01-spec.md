# 01 — Product specification: native `.tablify` target

> **Status:** target specification for the planned refactor; it does not describe the current `0.1.0` build. The current prerelease remains Bases-backed. See [`docs/reference/REFACTOR-PLAN.md`](reference/REFACTOR-PLAN.md) and the [phase-guide index](reference/native-tablify/README.md).

## One-line definition

Tablify is an Obsidian plugin for creating and editing versioned, multi-table `.tablify` JSON databases through a spreadsheet-class grid.

## Product principles

1. **One native local database format.** A `.tablify` file contains database schema, records, saved views, and stable identities. It is not a Markdown-note index and not a wrapper around Bases.
2. **Local-first.** Opening, editing, viewing, and importing/exporting work without a network connection. Airtable network access happens only after a user explicitly invokes sync.
3. **Obsidian remains the host.** A `.tablify` file opens through an Obsidian custom file view. The core data model remains pure TypeScript.
4. **IDs, not labels, identify data.** Renaming a table, field, record, option, or view must not rewrite unrelated identity or break linked records.
5. **Preserve the spreadsheet workflow.** Current grid interactions remain the parity baseline; changing storage must not silently remove them.
6. **Safe failure over silent repair.** Invalid/future-version documents are never replaced with an empty database or rewritten without an explicit recovery path.

## Users

- **The vault database builder** — wants structured tables inside Obsidian rather than a large collection of note files.
- **The spreadsheet user** — imports/export sheets and expects range selection, keyboard navigation, bulk edits, and undo.
- **The Airtable user** — explicitly synchronizes selected local tables and reviews per-field conflicts before writes.

Desktop and mobile are both supported targets. Mobile remains a first-class layout requirement, with real-device checks required before a release is described as verified.

## Product scope

| Area | Target behavior |
|---|---|
| **Database file** | Create, open, edit, rename, close, and reopen versioned `.tablify` JSON files with multiple tables. Stable database/table/field/row/view/option IDs. |
| **Tables and views** | Each table has its own schema, rows, and one or more saved views. Views own filters, sorts, grouping, column visibility/order/width, and grid presentation. |
| **Grid rendering** | Virtualized rows; sticky header; freeze/pin primary column only when the pane is at least 600 px wide; row heights/density; resize/reorder columns; reorder rows; grouped sections. |
| **Selection** | Active cell and rectangular range; whole row/column; select all; shift-click and shift-arrow extension. |
| **Clipboard** | Copy TSV and HTML; paste TSV and HTML tables; cut and clear; preserve values and shape across spreadsheet round-trips. |
| **Editing** | Current scalar-field editors plus linked-record editing. Type-to-replace; Enter/Tab navigation; Escape cancels. All mutations use operations and undo. |
| **Field types** | Retain current field behavior where it fits the JSON model (text, long text, number, checkbox, date/datetime, URL, email, phone, select/multi-select, rating, currency, percent, duration, attachment, created/modified time semantics). Add `link`. |
| **Linked records** | A field targets a table and stores stable row references. Relationship cardinality, inverse-field behavior, and deletion rules must be settled before implementation (see `docs/08-decisions.md`). |
| **Bulk operations** | Fill down/right; bulk column edit; insert/duplicate/delete records; set/clear selected cells; table/field actions; every logical action is undoable. |
| **Import** | CSV/TSV/XLSX → explicit preview → create table, append to a selected table, or replace after destructive confirmation. Per-column type inference and overrides. |
| **Export** | CSV, TSV, or XLSX from selected cells, current view, or full table. Scope is stated before writing. Formula-shaped text remains literal. |
| **Airtable sync** | Manual pull/push and per-field conflict review. A local table links to an Airtable table; schema is never modified; remote deletion is reported and never silently mirrored. |
| **Attachments** | Values are vault-relative path references. No attachment bytes are embedded in the database file. |
| **Undo/redo** | One logical user action, including bulk paste or import, is one history operation where practical. Persistence failures remain visible and recoverable. |
| **Accessibility/mobile** | Keyboard-first operation, correct grid semantics, readable announcements, focus visibility, touch targets, safe areas, mobile keyboard behavior, and narrow-pane layout. |

## Non-goals and compatibility boundary

- No Obsidian Bases view mode, Bases fallback, `.base` view-config writes, or `.base`-to-`.tablify` migration.
- No `.tabula` reader, legacy view, import alternative, or converter.
- No assumption that users need migration from existing Bases data. Existing `.base`, Markdown, and `.tabula` content is not modified by the new plugin; it is simply outside the refactored plugin’s supported database format.
- No formulas, lookups, or rollups in the first stable release.
- No formula engine or remote Airtable schema mutation; no automatic/background sync; no remote record creation/deletion unless separately approved.
- No binary attachment embedding, real-time collaboration, CRDT merge, telemetry, analytics, or network calls other than explicit Airtable operations.

## Core interaction model

The grid has one active cell inside a selection. Selection, edit, and focus are distinct state; a range remains a range when scrolled or virtualized.

| Gesture | Result |
|---|---|
| Click/tap | Set the active cell and selection anchor. |
| Shift-click / drag | Extend the range from its anchor. |
| Arrow keys / Shift+arrows | Move active cell / extend selection; scroll active cell into view. |
| Home / End / PageUp / PageDown / Ctrl+Home / Ctrl+End | Move to row, page, or table boundaries. |
| Enter / F2 | Edit the active cell; Enter commits and moves down. |
| Tab / Shift+Tab | Commit and move right/left. |
| Printable key | Start editing and replace cell contents. |
| Space on checkbox | Toggle without entering a text editor. |
| Cmd/Ctrl+C, X, V | Copy/cut/paste selection. |
| Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z / Ctrl+Y | Undo/redo a logical database operation. |
| Cmd/Ctrl+A | Select all rows in the active view. |
| Cmd/Ctrl+Enter | Bulk-edit selected cells in the active column. |
| Delete / Backspace | Clear selected values. |
| Alt+D / Alt+R | Fill down / fill right, subject to platform key conflicts and documented bindings. |
| Right-click / long-press | Context menu for the cell, row, column, table, or selection. |
| Drag column edge / row handle | Resize columns / reorder rows when the current view permits manual ordering. |

Table switching, view switching, and dialogs must be keyboard accessible and must restore focus predictably.

## Database editing and save behavior

- The JSON document is the local source of truth; the grid reads a validated in-memory snapshot.
- All edits are typed operations. The UI may show optimistic state, but success is not announced until the repository reports a successful write.
- Serialize writes per database document, coalesce one user action, and detect stale external revisions. Never silently overwrite a newer externally modified file.
- A malformed document or unsupported future version stays intact. Display a clear error/read-only view and preserve the original text for recovery.
- Record timestamps, if exposed, describe individual records and are stored/derived according to the data-model ADR; they are not the `.tablify` file’s `ctime`/`mtime` repeated on each row.

## Import/export semantics

The import preview is mandatory. It states the exact source dimensions, destination table, fields/types, skipped values, duplicate handling, and whether existing data will be replaced. It uses the same plan the runner will apply. Cancellation/failure reports any committed work exactly; no unreported partial import.

Export states whether it includes the selection, visible current view, or every record in the table. Linked-record exports use a documented human-readable representation; re-import cannot recreate stable relationship identity unless a mapping is supplied. Attachment paths remain references.

## Airtable sync UX and safety

- The default is manual: **Pull**, **Push**, and **Review conflicts**. Opening a database or view does not contact Airtable.
- Preview counts and conflict states are computed before writes; unresolved same-field conflicts block the run.
- Mapping is stored by stable local field/row IDs and remote field/record IDs. Existing `.base` path + view-name link state is not silently reused.
- Credentials are held only in Obsidian `SecretStorage`; never in `.tablify`, link metadata, plugin `data.json`, logs, or exports.
- Airtable schema is read-only. Missing local/remote counterparts and unsupported relation mappings are reported. Remote deletion is reported but not applied locally; local deletion does not delete remotely.
- No live Airtable calls in CI; use a mocked transport.

## Success criteria

| Criterion | Acceptance |
|---|---|
| Native-file lifecycle | Create/open/save/reopen a multi-table `.tablify` without Bases enabled; rename and split panes do not change stable IDs or lose writes. |
| Data integrity | Parser and serializer preserve values/views/links; malformed or newer-version input is never silently reset or rewritten. |
| Grid parity | Current selection, clipboard, keyboard, bulk-edit, undo, view, accessibility, and mobile behaviors pass against a native fixture. |
| Linked records | Create, display, edit, rename targets, delete/undo, and broken-reference states follow the approved integrity rules. |
| Spreadsheet interchange | CSV/TSV/XLSX import and export work for selection/view/table; formula-shaped text is not evaluated. |
| Performance | Benchmark a 5,000-row × 20-column fixture for first paint, query, and whole-file write; set a measured document-write budget before release. |
| Airtable | Manual pull/push, stale-check, per-field conflict review, mapping, and token redaction pass offline tests; real-device/vault smoke test is recorded before release. |
| Honest release | Current `0.1.0` claims remain accurate; future `.tablify` claims appear in release copy only when shipped. |

## Current release note

The `0.1.0` GitHub prerelease still describes the current Bases-backed implementation. The `.tablify` format and behaviors in this document are a future target, not available in that release. See `README.md`, `CHANGELOG.md`, and `docs/manual-test-log.md` for current release truth.
