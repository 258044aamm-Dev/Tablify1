Task: build the UI store and its selectors — the only place that mutates state — on
`useSyncExternalStore`, with the optimistic overlay wired in and a render-cost contract that the harness
will hold you to: a keystroke must re-render one cell, not the grid.

Read first: `docs/02-architecture.md` §Store, §selectors, §the render budget;
`docs/07-test-plan.md` §Tier 3 (the four store assertions); the write queue from step 11 and the ops from
step 09 (the store consumes both).

Deliverable:

1. `src/grid/store/store.ts` — a hand-rolled store (no state library):
   - state: `{ source, view, selection, history, overlay, ui }` where `view` is the resolved view config,
     `selection` the range model, `history` the op history, `overlay` the pending writes;
   - `dispatch(op)`: applies through `history.push`, updates the overlay, and calls `source.apply` in the
     same tick's microtask — **one** user action ⇒ **one** undo step ⇒ one queue batch;
   - `subscribe(listener)` / `getSnapshot()` for `useSyncExternalStore` with a stable snapshot identity per
     version counter (no new object per call, or React will re-render forever — assert the identity is
     stable across two `getSnapshot()` calls with no change);
   - `useStore(selector)` and `useStoreSelector(selector, isEqual)`: narrow selectors only; the store
     exposes no way to subscribe to the whole state from a component.
2. `src/grid/store/selectors.ts` — memoised selectors, each with a documented invalidation rule:
   `selectRows` (the windowed slice: `{ start, end, rows, totalHeight }` for a given scroll offset and
   viewport height), `selectCellValue` (overlay first, then row, then registry `formatDisplay`),
   `selectSelectionBounds`, `selectVisibleFields`, `selectStatusSummary` (counts for the status bar),
   `selectGroupSpans` (for the group headers the renderer draws).
   Row-window maths: fixed per-density row heights, `overscan` from the doc, and a stable mapping from a
   scroll offset to a row index (assert it with a table of offsets, including the last screen and the very
   last row).
3. `src/grid/store/commands.ts` — the command layer the toolbar, keyboard and menus all call:
   `setCell`, `setCells`, `clearSelection`, `fillDown`, `fillRight`, `addRow`, `deleteRows`,
   `moveRowBy`, `resizeColumn`, `reorderColumn`, `setViewConfig`, `toggleGroup`, `setSelection`,
   `extendSelection`, `undo`, `redo`, `flush`. Each is a thin, testable function over `dispatch`; no DOM.
4. `tests/unit/store.test.ts` — the four Tier-3 rules:
   - a keystroke re-renders the edited cell and nothing else (a render counter per cell component),
   - selection survives a re-query that leaves the row set unchanged, and degrades to the nearest
     surviving row when rows are removed,
   - undoing a 400-cell paste issues **one** queued batch and the number of `processFrontMatter` calls
     equals the number of distinct files touched,
   - an external `subscribe` change wins over a stale local snapshot and does not resurrect deleted rows.
5. `tests/unit/window-math.test.ts` — the offset → window table, including: zero, the first page boundary,
   a mid-list offset, the last screen, an offset beyond the end, and a negative offset. Each asserts
   `start`, `end`, and that exactly the expected rows are mounted.
6. `PROGRESS.md` updated (M3 started; the store's public surface).

Constraints and fence:
- Touch `src/grid/store/**`, `src/grid/**` (only what the store needs to exist), `tests/**`, `PROGRESS.md`.
- React is allowed **from this step on** in `src/grid/**` only; add `react` and `react-dom` as
  dependencies in this step and report the exact versions and the bundle-size delta — this is the one
  dependency decision I want to see before the grid grows around it.
- No state library, no `useReducer` for global state, no context for per-cell data.
- No `any`, no `as`, no `!`.

STOP and report instead of proceeding if: `useSyncExternalStore`'s snapshot identity cannot be kept stable
without an extra dependency; or the Tier-3 render-count rule cannot be measured with the test setup you
have (propose the counter's placement and wait); or React's version constraints conflict with the
`@types/node`/TypeScript pin from step 01.

Acceptance (paste raw output):
- `bun run check` — green, including the bundle-size delta from React.
- The four Tier-3 tests, each with its measured numbers (render counts, queue-call counts).
- The window-math table results.
- The `getSnapshot` identity assertion.

REPORT BACK with: the file list; the raw gate output; the resolved React versions and the bundle delta;
the store's public surface (the exported functions, one line each); anything ASSUMED; the exact next step.
