Task: implement the pointer interactions — column resize, column reorder, row reorder, the fill handle, the
scroll thumbs — and route every context menu through Obsidian's own `Menu` and every dialog through
`Modal`. This is the step that removes all hand-rolled modals and document listeners from the grid.

Read first: `docs/01-spec.md` §mouse and §touch (what a drag does at the edges, what a long-press opens),
`docs/04` §the drag rules (pointer capture, no jitter, the 4 px threshold before a drag starts);
`prototype/js/grid.js` §drags and `prototype/AUDIT-REPORT.md` (the drag and reorder findings, including the
row-reorder-through-the-gutter case) show the behaviours and the traps; `obsidian.d.ts` for `Menu` and
`Modal` — quote the members you use with `@since`.

Deliverable:

1. `src/grid/pointer/dragSession.ts` — one reusable pointer-capture drag helper:
   `begin({ target, onMove, onEnd, threshold })`, with pointer capture, a 4 px activation threshold, extra
   touch points ignored, `Escape` cancelling, and `onEnd` always called exactly once (including on
   `pointercancel` and on a lost capture). No `document`-level listeners beyond the capture's own events.
2. `src/grid/pointer/resizeColumn.ts` — resize by dragging a header's edge: a live 1 px-wide guide (or a
   live width update, whichever the doc specifies), a minimum width, a double-click to autosize to the
   widest visible value, and one undo step per finished drag (never one per pointer move).
3. `src/grid/pointer/reorderColumn.ts` — the drop indicator, the "no-op when dropped where it started"
   rule, and keyboard-free reordering via the header menu as an accessible alternative (the doc asks for
   one; implement it there, not here).
4. `src/grid/pointer/reorderRow.ts` — dragging the gutter handle moves the row; dropping on a row's upper or
   lower half inserts before/after; dropping outside the lane is a no-op; the gutter is a drop target too
   (the audit's finding); one undo step per drag; no re-render per pointer move (assert with the render
   counter).
5. `src/grid/pointer/fillHandle.ts` — the fill handle on the selection's corner: dragging down or right
   fills with the registry's copy rules (no series inference — the doc says copy, so copy), previews the
   target range while dragging, and commits one undo step on release.
6. `src/grid/menus/` — the cell menu, header menu and gutter menu, each built with Obsidian's `Menu`:
   items exactly as `docs/01` §menus lists, each with an icon where the doc names one, disabled items for
   read-only or inapplicable actions (with a reason in the tooltip where the API allows), and a
   `Menu.showAtMouseEvent`/`showAtPosition` call for mouse and keyboard invocation respectively.
   No hand-rolled menu DOM anywhere in `src/`.
7. `src/grid/dialogs/` — the dialogs the grid owns (view options, field config, option manager, keyboard
   help) as `Modal` subclasses in one folder, each with: a title, a body built from Obsidian's setting
   components where they fit, a footer with one primary action, and `onClose` returning focus to the
   opener. Delete `src/plugin/TablifyPlaceholderView.ts` if it still exists.
8. `tests/dom/pointer.test.tsx` — for each drag helper: below-threshold moves do nothing; a full drag
   produces exactly one command call; `Escape` mid-drag cancels with no command; a lost capture calls
   `onEnd` once. Use the fixture row source and assert command spies.
9. `tests/dom/menus.test.tsx` — each menu opens with the documented item list (compare against the doc's
   list, in order), disabled items are disabled for the documented reasons, and the chosen item dispatches
   the matching command.
10. `PROGRESS.md` updated.

Constraints and fence:
- Touch `src/grid/**`, `tests/**`, `PROGRESS.md`. `src/grid/**` may import `obsidian` **only** in
  `src/grid/menus/**` and `src/grid/dialogs/**` (the two bridge modules the layer rule names).
- No `document.addEventListener` for grid internals; pointer capture only. No `jQuery`-style delegation.
- No drag library. No `any`, no `as`, no `!`.

STOP and report instead of proceeding if: Obsidian's `Menu` cannot express an item the doc requires (name
the item and what you would do instead); or pointer capture is unavailable in a supported environment
(name the environment and the fallback you propose); or a drag cannot be limited to one undo step without
deferring the render (report the approach you would take and wait).

Acceptance (paste raw output):
- `bun run check` — green.
- The drag-helper test results, including the `Escape`-mid-drag and lost-capture cases.
- The menu inventory test output: menu → item count → each item's command.
- The render-count assertion for a row-reorder drag (no renders during the move, one on release).

REPORT BACK with: the file list; the raw gate output; the menu inventory; the drag thresholds and constants
you used with the doc line behind each; the deletion of the placeholder view (if it happened); anything
ASSUMED; the exact next step.
