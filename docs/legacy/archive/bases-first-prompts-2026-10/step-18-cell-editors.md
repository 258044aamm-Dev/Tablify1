Task: implement the cell editors — one per field type, driven by the registry, committing through the
store's commands, and meeting the input-size and touch-target rules. No editor may write to a note by
itself.

Read first: `docs/01-spec.md` §editing (per-type behaviour: when Enter commits, when Tab moves, what
`Escape` does), §touch; `docs/04` §the touch and input rules (16 px inputs, 44 px targets);
`docs/03` §write rules (what an empty value does); the editors in `prototype/js/grid.js`
(`beginEdit`, the per-type branches, and the popover editors for select/rating/attachment) show the exact
behaviour to match; `prototype/AUDIT-REPORT.md` §8 and §13 show the parsing bugs not to repeat.

Deliverable:

1. `src/grid/editors/registry.tsx` — `editorFor(field): EditorComponent | null` resolved from the field
   descriptor's declared editor id, with a documented fallback to a plain text editor for unknown ids and
   `null` (read-only) for types the descriptor marks non-editable. No `switch` on type anywhere outside
   this file.
2. One editor per type, each a small component in `src/grid/editors/`:
   - `TextEditor`, `LongTextEditor` (textarea, `Enter` inserts a newline, `Cmd/Ctrl+Enter` commits,
     `Escape` cancels), `NumberEditor`, `CurrencyEditor`, `PercentEditor` (all three commit only on a
     parsable value and show the parse warning inline when the value is kept as text),
     `CheckboxEditor` (toggles on space and on click, no text input), `DateEditor`, `DateTimeEditor`
     (native inputs, with the documented keyboard affordances), `DurationEditor` (`h:mm:ss` mask with
     paste tolerance), `RatingEditor` (star row, arrow keys, click), `SingleSelectEditor` and
     `MultiSelectEditor` (searchable option list using Obsidian's `SuggestModal` where the docs say so,
     otherwise an inline list with keyboard navigation; creating a new option is explicit and never happens
     on blur), `AttachmentEditor` (path entry plus a link to the file if it resolves in the vault).
   - Every editor: commits **once** per finished edit (no write on each keystroke), calls
     `commands.setCell`, keeps focus, and returns focus to the grid on commit/cancel.
   - Every editor: no `!important`, input `font-size ≥ 16px`, hit target ≥ 44 px on touch, and it must
     render inside the cell without changing the row's height.
3. `src/grid/editSession.ts` — the single place that knows which cell is being edited, so exactly one
   editor exists at a time, and the state machine is testable without React: `idle → editing → committing →
   idle`, with the cancel path restoring the previous value from the store.
4. `tests/dom/editors.test.tsx` — per type, iterated from the registry: opens, accepts the fixture input,
   commits exactly one command call (spy on `commands.setCell`), cancels without a write, and moves focus
   back to the grid. Include the paste cases from `docs/03` (`45m`, `1:30`, `25%`, `1,200`, a quoted value
   that must stay text).
5. `tests/unit/edit-session.test.ts` — the state machine, including: opening a second editor commits or
   cancels the first (state which, from the docs), a commit that fails leaves the cell in edit mode with the
   value intact, and `Escape` from a nested option list closes the list before the editor.
6. `PROGRESS.md` updated.

Constraints and fence:
- Touch `src/grid/**`, `tests/**`, `PROGRESS.md`.
- Editors never touch the vault, never call `processFrontMatter`, never import from `src/adapters/**`
  except the port type. All writes go through `commands`.
- No dependency for date/star/option widgets. Obsidian's modal classes are allowed only where the docs say.
- No `any`, no `as`, no `!`.

STOP and report instead of proceeding if: a per-type behaviour in `docs/01` is ambiguous about when a write
happens (list the ambiguous types and your proposed rule, then wait); or a native input cannot meet the
16 px / 44 px rules inside the documented row height (report the numbers and the conflict).

Acceptance (paste raw output):
- `bun run check` — green.
- The per-type table from item 4: type → opened, committed once, cancelled cleanly, focus returned.
- The paste-tolerance cases with their resulting canonical values.
- The measured `font-size` and hit-target box for every editor, on a phone viewport fixture.

REPORT BACK with: the file list; the raw gate output; the editor inventory (type → component → commit
trigger → cancel trigger); the two parse decisions you had to make and the doc sentence behind each;
anything ASSUMED; the exact next step.
