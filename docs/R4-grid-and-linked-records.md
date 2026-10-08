# R4 — Grid parity, saved views, and linked records

**Mode:** implementation guide; this document is not stand-alone authorization. The user separately authorized R1–R5 implementation, one gated step at a time. **Dependencies:** R2 file-view host and R3 stable database operations.

**Progress (2026-10-08):** Step 1 is implemented. Step 2's native-projection checkpoint is locally gated: a native DOM table grid (no React mount) reads the active `DatabaseStoreSnapshot`, reuses the query pipeline, field descriptors, and row-window arithmetic, and addresses cells by stable row/field IDs. It applies saved-view filter/sort/group/column order/visibility/density; remembers the selected view per table; supports cell selection, keyboard movement, and descriptor-backed basic editors that commit one `set-cells` operation with row metadata through shared history. Select cells show labels while preserving stable option IDs. Step 3's linked-record checkpoint is also implemented and locally gated: owning link cells display target-row labels and broken-reference state; the native fieldset/radio/checkbox editor searches target rows and adds/removes one or multiple references, with in-editor Tab/Enter/Escape handling; missing/foreign IDs are retained until explicitly removed/repaired, and no-op saves do not rewrite them. Generated inverses are read-only, derived from owning links, and ignore stale stored inverse-cell data. Link navigation is covered from both owning and inverse cells; it opens a transient Default view without overwriting the target table's remembered saved view. An indexed `RelationInspector` supplies the core lookups. DOM tests cover labels, search/no-results filtering, editor commits and Shift+Tab no-op exit, broken-reference repair/no-op preservation, inverse read-only behavior, and both navigation paths. **VERIFIED:** `bun run check` passed on 2026-10-08 (87 files / 1,964 tests, including typecheck, lint, build, contrast, CSS, and bundle-size gates); `bun run test:layout` passed 115/115 cases. That Playwright harness exercises the pre-existing Bases/React grid—not the native FileView. **NOT RUN:** real Obsidian FileView geometry/lifecycle, R2 desktop/phone probes, and physical-device checks. **OPEN:** R4 parity remains incomplete: range/row/column selection, clipboard/bulk workflows, column/row reordering and resizing, schema dialogs, full screen-reader/mobile checks, and remaining parity work. `docs/06-roadmap.md` records the phase status.

## Objective

Move the existing spreadsheet-class grid onto a multi-table `.tablify` repository and retain user-visible grid parity. Add linked-record editing as a first-release capability without building formula, lookup, or rollup engines.

## Parity contract

R4 is not complete if a native file opens but key existing workflows disappear. Preserve, test, and document:

- virtualized rows, sticky header, wide-pane frozen primary column with live unpin below 600 px, density/row height, column resize/reorder, row reorder;
- single-cell/range/whole-row/whole-column/all selection; shift extension and row selection affordances;
- keyboard navigation, editing, Enter/Tab/Escape, shortcuts, type-to-replace, accessible focus and status announcements;
- copy TSV+HTML, paste TSV+HTML, cut, clear, fill down/right, paste expansion/fill mode;
- field-type editors and bulk edit; add/duplicate/delete rows with confirmation; field creation/configuration;
- grouping, filtering/search, multi-sort, hidden/reordered columns, saved views, row density and presentation;
- undo/redo with one logical step per user action and reliable write status;
- screen-reader navigation/reading, mobile keyboard/safe-area/long-press behavior, responsive narrow-pane behavior.

## Step-by-step UI sequence

### Step 1 — Define the workspace shell

Within the custom `.tablify` file view, create a clear hierarchy: database title, table switcher, saved-view switcher, toolbar, grid, and status region. The open database is one file; the selected table is one table in that document; a saved view is scoped to that table. Make “create table” available from the database context and “create view” from the table context.

Do not reuse Bases toolbar, view picker, or `.base` embed controls. Determine available width from the actual FileView host, not device width alone. The shell’s flex-wrapped header responds to its own host width; table and view switching are pane-local workspace state and dispatch no document operation. Create-table and create-view forms use the R3 operation store and shared queue.

### Step 2 — Reconnect the existing grid to the active table projection

- Use existing grid rendering and field editor architecture where possible.
- Grid selectors resolve `rowId` and `fieldId`; display labels are not identity.
- Table switch updates the active projection, column schema, saved query, row order, selection, and accessible title in one transition.
- Define selection/history behavior on table/view switch. Recommended: clear cell selection when switching table, retain each table’s saved view/column state, and keep database undo history independent if safe.
- Restore user focus to the table/view control after deletion or rename; do not leave focus on a removed cell.

### Step 3 — Specify the link field’s presentation

A link cell stores target row IDs. The editor/display resolves row labels from the target table through a read-only lookup supplied by the repository; field descriptor code remains pure.

ADR-0001 is accepted. The UI must implement its decisions: both single and multiple cardinalities; one-sided stored IDs; generated inverses are read-only; order is preserved; broken references remain stored and are visibly reported.

**Implementation checkpoint — VERIFIED (2026-10-08):** the native DOM grid displays owning-link labels, filters target rows by search, allows single/multiple selection changes, preserves and repairs broken IDs without no-op writes, derives inverse display values from owning links, treats generated inverses as read-only, and navigates to linked rows. The DOM suite covers the search filter/no-results state, Shift+Tab no-op exit, add/remove, undo, broken-reference repair/no-op, ignored stored inverse values, and navigation from both link directions. `bun run check` passed with 87 files / 1,964 tests, and `bun run test:layout` passed 115/115 on the existing grid harness. **NOT RUN:** real Obsidian FileView and physical-device verification. **OPEN:** verify full keyboard/screen-reader/mobile behavior in the actual host, define deterministic link paste/import mapping, and complete the rest of R4 parity.

At minimum the UX must support:

- choose an existing target row using search over the target table;
- add/remove one or more links within the decided cardinality;
- show missing/deleted target state without erasing the stored reference;
- open/navigate to the target table/row if this does not steal focus or mutate selection unexpectedly;
- keyboard-only creation/removal and announcements understandable to a screen reader;
- paste/import of references only when a deterministic ID/name mapping exists; otherwise show a preview error rather than guess.

### Step 4 — Define table/field/view editing UX

- Field creation offers the supported native field types and validates relation target tables/options before commit.
- Renaming a field preserves its stable ID and remaps saved-view query references by ID, not name.
- Changing field type previews conversions and losses. Do not coerce link arrays, option IDs, attachment paths, or typed numbers to text silently.
- Deleting a field previews cells, saved views, and Airtable mapping effects; undo restores all.
- Deleting/renaming tables follows R0 referential-integrity ADR.
- Saved views are database data; selecting an existing view is read-only until a control changes its configuration.

### Step 5 — Retain view pipeline behavior

Reuse `src/core/query/**` and the current filter → search → sort → group pipeline unless tests show a contract mismatch. Store filters/sorts/grouping and presentation in the `.tablify` document. Keep a consistent final sort tie-breaker using row ID/order. Define semantics for drag-reordering while a sort or group is active before enabling the drag affordance.

### Step 6 — Accessibility and responsive pass

Keep current layout constraints in `docs/04-design-system-and-layout.md`: one scroller, root fills host, touch targets, 16px editors, safe areas, long-press, reduced motion, focus-visible, grid roles, and no hover-only controls. Test the app’s custom file view in a real Obsidian host as well as the browser harness: a harness fixture cannot prove FileView padding/lifecycle.

## Tests to add

- DOM interaction tests for table/view switching, create/rename/delete flows, field dialogs, link selector keyboarding, broken links, and undo.
- Query/view tests proving saved view state persists in JSON and is scoped by table.
- Browser harness cases for all existing grid parity checks using a multi-table fixture; add explicit checks for a relation cell and table switch.
- Accessibility tests for relation name announcement, listbox/dialog focus, read-only broken link, and cross-table focus restore.
- Real-app manual checks for open/create/reopen/split leaves, mobile width/keyboard, file rename, and no Bases core-plugin dependency.

## R4 acceptance criteria

- One `.tablify` file with at least three tables and two views on one table opens and remains editable through the same grid workflows as the current release.
- A link field points to rows in its configured target table; changing target display name does not break the reference.
- Deleting/renaming a target follows the ADR and undo restores exact references.
- Save/reopen preserves selected data/schema/view configuration; no `.base` config is written.
- All retained selection, clipboard, keyboard, bulk-edit, undo, a11y, and mobile tests pass; no regression is hidden by excluding a feature from the fixture.
- Formulas/lookups/rollups remain absent and are not presented as supported.
