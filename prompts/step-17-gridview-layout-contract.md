Task: build the real `GridView` — windowing, one scroller, sticky header, frozen primary column, group
headers, status bar — and satisfy the layout contract from `docs/04` on the first try. This step replaces
step 12's data-path placeholder as the view's renderer.

Read first: `docs/04-design-system-and-layout.md` §the one layout contract and §the viewport matrix (the
measurements are the acceptance criteria), `docs/02-architecture.md` §Grid rendering and §Performance
budget, `docs/01-spec.md` §interaction; `prototype/js/grid.js` shows a working implementation of the same
geometry (read it for the maths — lane widths, the frozen strip, the scroll sync, the add-row strip — then
write the plugin's own version in React).

Deliverable:

1. `src/grid/GridView.tsx` — the component tree: `GridView` → `Toolbar` → `GridArea` → (`Header`,
   `Rows`, `FrozenColumn`) → `StatusBar`, plus `GroupHeader` as a row-lane pseudo-row. One scroller only
   (the grid area); the header translates with `transform: translateX(-scrollLeft)`; the frozen column is
   its own element whose rows translate with `translateY(-scrollTop)`.
2. `src/grid/useWindow.ts` — the scroll listener: passive, `requestAnimationFrame`-coalesced, reading the
   scroll offset from the DOM element (never from state), writing the transforms imperatively. Scroll must
   not re-render rows: assert with the render counter from step 16 (scrolling 2,000 px must not increment
   any row's render count).
3. `src/grid/rows/Row.tsx` and `src/grid/rows/Cell.tsx` — one row component, one cell component; the cell
   renders the registry's `formatDisplay`, and dispatches to an editor only when it is the active cell in
   edit mode (editors arrive next step; render a placeholder input that does not commit).
4. The narrow-pane rule, implemented exactly as `docs/08` §P21 and `docs/04` describe: the primary column
   is pinned only when the pane the view owns is at least 600 px wide, and the freeze option is **absent**
   (not disabled) below it. Implement it as one derived value (`pinnedPrimary`) that every consumer reads,
   and re-evaluate it on a `ResizeObserver` on the grid area, re-rendering only when the value flips.
5. `src/grid/Empty.tsx` — the empty state and the "no rows match the filter" state, both with a one-line
   explanation and the action that fixes it (the doc names the copy); no illustration, no animation.
6. `src/plugin/TablifyView.ts` — render `GridView` with the `BasesSource` from step 12; measure the
   container before first paint so the first frame is already windowed (no flash of 5,000 rows).
7. `tests/dom/gridview.test.tsx` — jsdom smoke: renders with 30 fixture rows; the frozen column exists only
   when the pinned rule is true; the empty state renders when the filter matches nothing; the status bar
   shows the counts from `selectStatusSummary`.
8. `PROGRESS.md` updated (M3 continues; the measured first-paint time on the harness fixture).

Constraints and fence:
- Touch `src/grid/**`, `src/plugin/TablifyView.ts`, `tests/dom/**`, `PROGRESS.md`, and `src/styles/grid.css`
  **only** for rules the component genuinely needs (each addition needs a comment naming the contract line
  it implements).
- No percentage heights, no `100vh`, no `ResizeObserver` height anchors, no `!important`, no inline styles
  except the imperative transforms and measured widths.
- No virtualizer dependency: the range maths is yours (step 16 tests it).
- No `any`, no `as`, no `!`.

STOP and report instead of proceeding if: the contract cannot be met with the DOM structure the docs
describe (paste the contract line, your structure, and the measured wrong number); or the frozen column
cannot be kept within 1 px without a second scroller (report the alternative and stop before building it).

Acceptance (paste raw output):
- `bun run check` — green.
- A real measurement at the container's padding box: paste the numbers for a 900 px host, a 600 px host and
  the 389 px host (the harness fixture in step 21 makes this repeatable; here you may measure in a scratch
  page and say so).
- The render-count assertion for scrolling (rows rendered = 0 during a 2,000 px scroll) and for a keystroke
  (one cell).
- The first-paint timing for 5,000 × 20 as measured in the scratch page, with the machine named.

REPORT BACK with: the file list; the raw gate output; the three host measurements; the render counts; the
first-paint number; the DOM structure in a short tree diagram; anything ASSUMED; the exact next step.
