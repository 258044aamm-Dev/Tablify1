Task: implement the keyboard model and the accessibility contract — one key handler for the whole grid, a
roving `tabindex`, the full key table, and a focus contract for every surface the plugin opens.

Read first: `docs/01-spec.md` §the keyboard table (implement it exactly; it is the spec your Playwright
spec will encode), §touch and long-press, §accessibility; `docs/04` §focus ring and §motion frequency
(the frequency table decides what may animate — keyboard-initiated actions never animate);
`src/plugin/help/keyBindings.ts` from step 03 is the human-readable twin of this table — they must match,
and a test must assert that.

Deliverable:

1. `src/grid/keyboard/handler.ts` — **one** `keydown` listener, attached to the grid root, handling the
   whole table: arrows, `Shift`+arrows (extend), `Page Up/Down`, `Home`/`End` (with `Ctrl`/`Cmd` for the
   extreme corners if the doc says so), `Tab`/`Shift+Tab` (move within the grid, and leave the grid at the
   last cell — the rule the doc specifies), `Enter`/`F2` (edit), any printable character (replace and
   start typing), `Space` (toggle a checkbox), `Delete`/`Backspace` (clear), `Cmd/Ctrl`+`C`/`X`/`V`/`A`/`Z`/
   `Shift+Z`(`Y`), `Alt`+`D`/`Alt`+`R` **and** `Cmd/Ctrl`+`D`/`Ctrl+R` for fill (the doc explains why both
   exist: browser shortcuts swallow one of them), `Escape` (cancel then clear selection).
   Requirements: a single `switch` over `event.key` (no per-cell listeners), `preventDefault` only where
   the action is handled, no handling while an editor owns focus (the editor's own state machine gets
   first refusal), and no handler attached to `document`/`window`.
2. `src/grid/keyboard/focus.ts` — the roving `tabindex` model: exactly one cell is tabbable, focusing the
   grid restores the last active cell, and the active cell is always inside the rendered window (the
   handler must scroll it into view with the same offset maths the windowing uses).
3. `src/grid/a11y/roles.tsx` — the accessibility wiring: `role="grid"`, `role="row"`, `role="gridcell"` with
   `aria-rowindex`/`aria-colindex`/`aria-rowcount`/`aria-colcount`, `aria-selected` for the selection,
   `aria-readonly` on read-only cells, and a documented `aria-live="polite"` region for the messages the
   store already emits (fill counts, cleared counts, undo results). The live region must be polite and
   must not be re-created on every render.
4. `src/grid/a11y/focusContract.ts` — the rule that every surface the plugin opens returns focus where it
   came from: menus, popovers, dialogs, the help modal. Implement it as one helper used by all of them
   (record the opener, restore on close, and **do not** steal focus from a surface that opened in the
   meantime: the rule is "restore only if focus was lost"). Add the `Escape` binding for each surface
   type, including popovers whose inputs live outside the grid root.
5. The keyboard help modal in `src/plugin/help/` — render from `keyBindings.ts`, one row per binding, no
   prose paragraphs, opened by the command from step 03 and by the documented key.
6. `tests/unit/keyboard-table.test.ts` — for every row of the table: the key event → the expected command
   (spy on the command layer). This test is the executable version of the spec table, so a doc/code
   divergence becomes a failure.
7. `tests/unit/keybindings-match.test.ts` — asserts `keyBindings.ts` and the handler's table describe the
   same set of actions (compare ids, not strings).
8. `tests/dom/focus-contract.test.tsx` — open and close each surface type: focus returns to the opener; a
   dialog that opens while a menu closes keeps focus inside itself; `Escape` closes the top-most surface
   only; no surface leaves nodes behind after the exit (assert the DOM count, not a timeout).
9. `PROGRESS.md` updated.

Constraints and fence:
- Touch `src/grid/keyboard/**`, `src/grid/a11y/**`, `src/grid/GridView.tsx` (wiring), `src/plugin/help/**`,
  `tests/**`, `PROGRESS.md`.
- Keyboard-initiated actions must not animate (the frequency table): assert duration 0 on the affected
  paths, or state in the report why no assertion was possible.
- No global listeners, no `setTimeout` used as a focus hack outside the documented one-tick deferral, no
  `any`, no `as`, no `!`.

STOP and report instead of proceeding if: a row of the key table conflicts with another row (paste both);
or the roving `tabindex` cannot coexist with the editor's focus needs in a way you can explain in three
lines (report the conflict and the design you would choose, then wait); or a browser reserves a key so that
the documented binding cannot work (name the key and the platform, and the alternative you propose).

Acceptance (paste raw output):
- `bun run check` — green.
- The keyboard-table test output: number of rows covered, and the count of doc rows without a test (must
  be zero).
- The focus-contract test results per surface type.
- A real-keyboard observation in a vault: ten presses of the arrow keys, `Enter` to edit, `Escape` to
  cancel, `Cmd/Ctrl+Z` — paste what you saw, and the NVDA/VoiceOver line if you managed to run one
  (if not, say so).

REPORT BACK with: the file list; the raw gate output; the covered key rows; the focus contract's rule in
three lines; the animation assertion results; anything ASSUMED (screen-reader behaviour especially);
the exact next step.
