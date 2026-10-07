Task: make it a spreadsheet — range selection, clipboard in both directions, fill, clear, and bulk column
editing. Everything through the commands built in step 16; nothing writes to a note outside the queue.

Read first: `docs/01-spec.md` §selection, §clipboard, §fill, §clear (the interaction rules), §touch
(the phone selection toggle), `docs/03` §paste semantics (which text becomes which type, the `=` rule),
`docs/07` §Tier 1 (the clipboard round-trip rules), `prototype/js/grid.js` (copy/cut/paste/fill
implementations — read for behaviour).

Deliverable:

1. `src/grid/selection/` — the visible selection model on top of `core/selection`: mouse drag (with
   auto-scroll past the edges), `Shift`+click, `Shift`+arrows, whole-row and whole-column selection by
   header/gutter click, select-all, and the phone affordance the doc describes (a selection toggle that
   turns a drag into a range instead of a pan). Selection state lives in the store, not in a component.
2. `src/grid/clipboard/` — the clipboard integration:
   - copy: write **both** `text/plain` (TSV) and `text/html` (a real table) with
     `navigator.clipboard.write`, and fall back to a hidden textarea + `execCommand("copy")` if the API is
     unavailable, reporting which path ran;
   - cut: copy, then clear through one undo step;
   - paste: read `text/html` first (falling back to `text/plain`), parse it with `core/selection/clipboard`,
     and hand the matrix to the paste flow;
   - a paste whose matrix is larger than the current row set offers the three documented modes
     (replace / append as rows / fill from the anchor) in a dialog that shows the exact counts and what
     will be created; the mode names come from the doc, not invented;
   - a paste with more than the threshold number of rows shows the warning the doc specifies, with the
     `.tabula` alternative mentioned.
3. `src/grid/commands/fill.ts` — fill down and fill right from the selection's anchor row/column, copying
   values through the registry's `formatPlain`/`parsePlain` so a fill is type-correct; one undo step per
   fill; the count is announced in the live region.
4. `src/grid/commands/clear.ts` — clearing deletes keys for every type that stores nothing for an empty
   value, and writes the empty representation only where the type requires one (the registry decides; state
   in a comment which types write something on clear).
5. `tests/unit/clipboard-roundtrip.test.ts` — the fixture matrix round-trips TSV and HTML unchanged,
   including: a cell containing a tab, a newline, a leading `=`, a quote at the start, a number stored as
   text, an emoji, and an empty cell in the middle and at the end.
6. `tests/dom/paste-flow.test.tsx` — the three paste modes: the dialog states the right counts; each mode
   produces the right op sequence; cancelling produces no ops; the threshold warning appears at the right
   size and names the `.tabula` alternative.
7. `tests/layout/tier4.spec.ts` — extend assertion 11 into the real one: a 400 × 6 paste through the UI on
   the fixture, under the 2 s budget, with the correct values in the cells and the correct note count in
   the fake source; and add an assertion that a copy → paste round-trip inside the grid preserves values
   (this is the committed regression guard for the clipboard).
8. `PROGRESS.md` updated.

Constraints and fence:
- Touch `src/grid/**`, `src/core/**` (only if a shared rule must move — report it), `tests/**`,
  `PROGRESS.md`, and `harness/**` only to add the spec's hooks.
- No clipboard library, no dependency. No `document.execCommand` outside the documented fallback.
- The paste flow must never create notes without the confirmation dialog when the matrix is larger than the
  current row set, and never create a partial set silently on cancel.
- No `any`, no `as`, no `!`.

STOP and report instead of proceeding if: the browser's clipboard read cannot distinguish HTML from text in
the environment (report what you receive and the fallback you propose); or a paste mode in the doc has no
defined row-creation semantics (list the ambiguity and your proposal, then wait); or the threshold warning
conflicts with the confirmation dialog (say which comes first and why).

Acceptance (paste raw output):
- `bun run check` — green.
- The round-trip results with the fixture list.
- The paste-mode results with the counts each mode reported.
- The extended Tier-4 run with the 400 × 6 timing and the round-trip assertion.
- A real-app observation: copy a 10×4 range into the system clipboard, paste it into a spreadsheet
  application and back, and paste the result — with the two values that would have broken in the old build
  (`=SUM(A1:A2)` as text, and a multi-line cell) called out.

REPORT BACK with: the file list; the raw gate output; the clipboard path that actually ran in your
environment; the fill/clear type table; anything ASSUMED; the exact next step.
