# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — unreleased, prepared 2026-10-06

**What works.** This is the first build with features rather than scaffolding. It is written for Obsidian 1.13.0
and newer, on desktop and on mobile.

### Added

- **The grid.** A Bases view (`Tablify grid`) with virtualised rows, a sticky header, grouped sections, column
  resize and reorder, row reorder by drag, three row heights and a row-number gutter. The first column is pinned
  only while the pane is wide enough; below 600 px nothing is pinned, and the freeze option disappears from the
  view dialog rather than pretending to work.
- **Selection.** A cell, a rectangular range, whole rows and columns, everything; shift-click and shift-arrow
  extension; a row-checkbox column; the selection survives scrolling because it is a range, not a list of cells.
- **The clipboard.** Copy as TSV **and** HTML, paste TSV from any spreadsheet, paste HTML tables, cut, clear. A
  range copied from Google Sheets or Excel and pasted back keeps its shape and its types.
- **Editing.** One editor per property type — text, long text, number, checkbox, date, select, multi-select,
  rating, attachment — behind one registry, committing through the same write queue as everything else. Writes
  are debounced and batched per note; a failed write rolls the cell back and says which file and why.
- **Bulk operations.** Edit a column from the bottom up in one dialog, fill down or right, insert N rows,
  duplicate rows, delete rows with a confirmation, set or clear a property across a selection.
- **Import.** CSV, TSV and XLSX files, with a preview, per-column type inference and per-column overrides. Choose
  rows-as-notes or keep the sheet as one `.tabula` file; above the large-import threshold (250 rows by default)
  the dialog says how many notes it is about to create and offers the single-file route first. A cancelled import
  reports exactly what it created, and one undo removes those notes.
- **Export.** The selection or the whole view as TSV or XLSX, to the clipboard or to a file.
- **Migration.** Read and migrate legacy `.tabula` files: a dry-run report first (what will be created, what will
  be dropped, what cannot be represented), then one undo step for the whole migration.
- **Optional sync with Airtable.** Link a view to one base and table, see the plan before it runs, pull, push, and
  review every conflicting field side by side. The Airtable schema is never modified; unknown local properties
  are skipped and reported; a remote deletion is reported, never mirrored locally.
- **Settings** in five sections (rows, import, appearance, legacy, advanced), including a "follow my Obsidian
  theme" switch, a row-height default, a motion preference and five content switches for what the grid offers.
- **Accessibility.** Roles and names on the grid, rows, cells and menus; a polite live region for completed
  writes only; the keyboard table in the README; 16 px minimum type on inputs so iOS does not zoom; a 24 px
  touch target on the drawn scrollbars; long-press for the context menu; safe-area insets respected.

### Changed since internal builds

- The view is called **Tablify** and the plugin id is `tablify`; the earlier internal name is gone from the
  manifest, the bundle and every user-visible string.
- The palette is Tablify's own warm parchment-and-ink tokens (`--tablify-*`), with **one** switch that follows
  the host theme instead. No `!important` anywhere, so your theme's own variables win where they should.
- The toolbar collapses into a `⋯` menu below 520 px, so no control is ever clipped off a narrow pane.
- Undo/redo labels now name what they will undo (`Undo paste 400 rows`), and every multi-note write is a single
  step.
- Sync lives behind a lazy import: with no link configured it costs nothing at startup and contacts nothing.

### Known limitations

- No formulas, lookups, rollups or linked records in the grid; no CSV export (Bases has one); `.tabula` is
  read-only legacy; sync never alters your Airtable schema and never mirrors a remote deletion; screen-reader
  **editing** in a virtualised grid is the least-exercised path in this release.

### Not verified yet

- The release is **not tagged**, because `docs/06-roadmap.md` §M6 requires in-app verification on a desktop and a
  physical phone first, and `docs/manual-test-log.md` records every one of those checks as **NOT RUN**. The
  plugin has never been loaded into a real Obsidian by anyone but its author's build harness.

[0.1.0]: https://github.com/258044aamm-Dev/Tablify/releases/tag/0.1.0
