# R4 — Grid parity and linked-record planning

**Guide:** `docs/reference/native-tablify/R4-grid-and-linked-records.md`
**Current mode:** plan only.

Read `docs/01-spec.md`, `docs/04-design-system-and-layout.md`, `docs/07-test-plan.md`, `docs/08-decisions.md`, the R4 guide, current grid contracts, and layout/interaction tests.

## Plan-only task

Produce a UI/data-flow plan for a multi-table native file without regressing current grid workflows:

- table navigation and create/rename/delete actions;
- current grid parity checklist (selection, clipboard, bulk edit, undo, keyboard, accessibility, mobile, views, filters/sorts/groups, resize/reorder/hide, performance);
- linked-record cell display/editor/navigation and unresolved/deleted target state;
- exact path from operation → repository → visible update → undo/save;
- test additions mapped to current harness and field editor architecture;
- mobile/screen-reader interaction risks and acceptance criteria.

Distinguish user-confirmed requirements from open design behavior. Do not make formulas/lookups/rollups in scope, add note rows, or implement anything in plan-only mode.
