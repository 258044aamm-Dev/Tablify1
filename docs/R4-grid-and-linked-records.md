# R4 — Grid parity, saved views, and linked records

**Mode:** design and future implementation guide. No source code is authorized by this document update. **Dependencies:** R2 file-view host and R3 stable database operations.

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

Do not reuse Bases toolbar, view picker, or `.base` embed controls. Determine available width from the actual FileView host, not device width alone.

### Step 2 — Reconnect the existing grid to the active table projection

- Use existing grid rendering and field editor architecture where possible.
- Grid selectors resolve `rowId` and `fieldId`; display labels are not identity.
- Table switch updates the active projection, column schema, saved query, row order, selection, and accessible title in one transition.
- Define selection/history behavior on table/view switch. Recommended: clear cell selection when switching table, retain each table’s saved view/column state, and keep database undo history independent if safe.
- Restore user focus to the table/view control after deletion or rename; do not leave focus on a removed cell.

### Step 3 — Specify the link field’s presentation

A link cell stores target row IDs. The editor/display resolves row labels from the target table through a read-only lookup supplied by the repository; field descriptor code remains pure.

The ADR must decide whether the first editor supports single and multiple links, reciprocal/inverse fields, and link ordering. At minimum the UX must support:

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
