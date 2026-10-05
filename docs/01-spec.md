# 01 — Product specification

## One-line definition

A spreadsheet-class grid view for Obsidian Bases: rows are notes, columns are properties, and every bulk-editing gesture a person knows from Excel, Sheets or Airtable works.

## Why the grid is the product

Obsidian Bases (core, 1.9+, with a public view API from 1.10) already ships **table, cards, list, map and kanban** layouts, native CSV export, filters, sorting, grouping, formulas and per-cell editing. Re-implementing any of that is wasted budget and permanent maintenance debt.

What Bases deliberately does not ship is *spreadsheet behaviour*: selecting a rectangular range, copying it into Excel and pasting it back, filling down, typing to overwrite and arrow-keying onward, bulk-editing a column, or importing a 400-row sheet. Every one of those is a daily gesture for anyone who lives between a notes app and a spreadsheet.

**Therefore: one view type. The best grid in the ecosystem, and nothing else.** Kanban and cards are Obsidian's job; the day Bases' table view matches Tablify's grid, Tablify still wins on import/export/sync and keyboard depth.

## Users

1. **The spreadsheet escapee** — keeps project/task data in the vault, wants Excel-class editing without leaving Obsidian. Main persona.
2. **The Airtable dumper** — has records in Airtable, wants them as notes, and wants changes to flow both ways on their terms.
3. **The bulk editor** — imports a 500-row sheet once a month, cleans it up in the grid, exports it back.

Mobile is a first-class target for all three (see `docs/04-design-system-and-layout.md`).

## Feature scope

### In scope

| Area | Behaviour |
|---|---|
| **Grid rendering** | Virtualized rows; sticky header; first column pinned **only while the pane is wide** (unpinned below 600 px — see *Pinning* below); three row heights; column resize; column reorder; row reorder by drag; grouped sections |
| **Selection** | Single cell, rectangular range, whole row/column, all rows; shift-click and shift-arrow extension; select-all checkbox column |
| **Clipboard** | Copy range as TSV **and** HTML (spreadsheet-compatible in both directions); paste TSV from any spreadsheet; paste HTML tables; paste a `.csv`/`.xlsx` file from the clipboard where the OS exposes it; cut; clear |
| **Editing** | Type-to-replace, Enter to commit and move down, Tab to commit and move right, Escape to cancel; per-type editors (text, long text, number, checkbox, date, select, multi-select, rating, attachment) |
| **Bulk operations** | Edit a column bottom-up, fill down/right from a selection, insert N rows, duplicate rows, delete rows in bulk (with confirmation), set/clear a property across the selection |
| **Import** | CSV / TSV / XLSX file → preview → choose destination (create rows as notes, or keep as a standalone `.tabula` file) |
| **Export** | Selection or whole view → TSV/XLSX to the clipboard or a downloaded file (CSV is already native in Bases; do not duplicate it) |
| **Views of the same data** | Everything Bases provides (filters, sorts, grouping, formulas) is inherited, not re-implemented. The plugin contributes view options: row height, frozen first column, density, "show row numbers". The freeze option is **hidden while the pane is too narrow to pin anything** |
| **Airtable sync** | Optional, per-view link to one Airtable base+table; pull, push, per-field conflict review; schema is never modified on the Airtable side |
| **Undo/redo** | All grid operations, including multi-note writes, as one user-visible step |

### Explicit non-goals

- Re-implementing Bases layouts (cards, list, map, kanban) or its filters/formulas/CSV export.
- Editing Airtable **schema** (fields, tables, views). Never. Read-only on schema, by decision.
- Formulas, lookups, rollups, linked records inside the grid — Bases formulas already exist and linked records would require a row-identity model that notes cannot express.
- Real-time collaboration or CRDT merge. Conflicts are surfaced, not silently merged.
- Any network call that is not the user's own Airtable account.
- A second data format. `.tabula` is frozen legacy (read + migrate), never extended.

## Core interaction model

The grid has exactly one focus concept: **an active cell inside a range**. Everything else follows from it.

| Gesture | Result |
|---|---|
| Click / tap | Active cell becomes the range |
| Shift+click / drag | Extend the range from the anchor |
| Arrow keys | Move active cell (extends with Shift); scrolls it into view |
| Home / End / PageUp / PageDown / Ctrl+Home / Ctrl+End | Navigate to edges |
| Enter | Edit the cell; committing moves down one row |
| Tab / Shift+Tab | Commit and move right / left |
| Any printable key on an unfocused cell | Start editing, replacing content |
| Space on a checkbox cell | Toggle without entering edit mode |
| Cmd/Ctrl+C / X / V | Copy / cut / paste the range (TSV + HTML) |
| Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z | Undo / redo the last grid operation |
| Cmd/Ctrl+A | Select all rows in the current view |
| Cmd/Ctrl+Enter | Edit the column across the whole selection, bottom-up |
| Delete / Backspace | Clear the selection's values |
| Right-click / long-press | Context menu: cell, row, column or selection actions |
| Drag column edge | Resize; double-click edge = auto-fit to content |
| Drag row-number handle | Reorder rows |
| Type-ahead in a select cell | Filter options; create an option on the fly when allowed |

Keyboard parity on mobile: every gesture above has a touch path (long-press for the context menu, a toolbar button for range selection and copy/paste).

## Editing the underlying note

Because a row *is* a file:

- **Editing a cell writes that note's frontmatter**, not a mirrored store. Writes are debounced, batched and serialized per file (`docs/02-architecture.md` §write queue).
- **Read-only properties** (`file.ctime`, `file.mtime`, formulas, and anything the plugin cannot map) render as disabled cells with a tooltip, never as editable inputs that silently discard input.
- **A failed write must never look like a success.** Optimistic UI with rollback plus a `Notice` naming the file and the reason.

## Import semantics

Rows are notes, so importing is a note-creating operation. The preview dialog is mandatory and must state consequences:

```
Import sheet.xlsx — 3 columns × 412 rows
  → Creates 412 notes in "Projects/Rows" using {{Name}}.md
  → Adds 3 properties: Name, Status, Owner

[ Create 412 notes ]   [ Keep as .tabula file instead ]   [ Cancel ]
```

- Above a configurable threshold (default 250 rows) the dialog adds an explicit warning and defaults the cursor to the `.tabula` option.
- The `.tabula` escape hatch exists exactly for this: data that should not become a thousand notes.
- Column types are inferred as today (text / number / date / checkbox / single select), with an override per column before commit.

## Sync UX

- Link is per Bases view, stored as base+table ids; the token lives in `SecretStorage`, never in a `.base` file or `data.json`.
- Default is **manual**: "Pull from Airtable" and "Push to Airtable". An optional "check for changes on open" performs a **read-only** comparison and shows a badge; it never writes.
- Conflicts open a review dialog listing changed fields per row (local value vs remote value, per-field choice), with bulk actions ("take all local", "take all remote") and a visible count of what will be written where.
- Push never creates or alters fields. New local properties that have no Airtable counterpart are skipped and reported.
- Records deleted remotely are never silently deleted locally; they are reported and left for the user to decide.

## Success criteria

| Criterion | Target |
|---|---|
| Typing latency in a 5,000-row × 20-column view | No dropped keystrokes; frame budget held while typing |
| Grid scroll | 60 fps on a mid-range laptop, no blank regions during scroll |
| Paste of a 400 × 6 block | Correct values, single undo step, progress feedback, no freeze |
| Mobile (phone, keyboard open) | Grid fills the view; header stays sticky; no clipped toolbar; no input zoom; **nothing pinned** — the row-number/checkbox gutter, the first column and the rest scroll as one lane |
| Fresh install → first useful action | Under 60 seconds, no configuration required |
| Bundle | Small enough not to measurably slow Obsidian mobile startup (see `docs/05-toolchain-and-ci.md` §bundle budget) |
| Accessibility | Full keyboard operability; correct roles/labels; usable with the OS screen reader for navigation and reading (grid editing is announced, not silently mutated) |
