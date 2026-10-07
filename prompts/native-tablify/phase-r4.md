# R4 — Grid parity and linked-record planning

**Guide:** `docs/R4-grid-and-linked-records.md`
**Mode:** authorized for implementation (2026-10-07), on `refactor/native-tablify`, one step at a time with a push after each step; starts after R3's exit gate. The planning task below is the phase's plan of record.

Read `docs/01-spec.md`, `docs/04-design-system-and-layout.md`, `docs/07-test-plan.md`, `docs/08-decisions.md`, the R4 guide, current grid contracts, and layout/interaction tests.

## Plan-only task

Produce a UI/data-flow plan for a multi-table native file without regressing current grid workflows:

- table navigation and create/rename/delete actions;
- current grid parity checklist (selection, clipboard, bulk edit, undo, keyboard, accessibility, mobile, views, filters/sorts/groups, resize/reorder/hide, performance);
- linked-record cell display/editor/navigation and unresolved/deleted target state;
- exact path from operation → repository → visible update → undo/save;
- test additions mapped to current harness and field editor architecture;
- mobile/screen-reader interaction risks and acceptance criteria.

Distinguish user-confirmed requirements from open design behavior. Formulas/lookups/rollups stay deferred (out of scope), no note rows — and every interaction change the grid changes needs its keyboard/layout gate green before the step is pushed.
