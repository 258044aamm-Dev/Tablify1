Task: the import path and the multi-note undo guarantee — a 400-row import that creates notes, counts them
honestly, reports progress, and undoes in one step; plus bulk column editing across the selection.

Read first: `docs/01-spec.md` §import (the wizard's steps, the fields it collects, the semantics of each
mode), §bulk edit, §undo; `docs/03` §import (type inference rules, the filename template, collision
handling, the threshold and the `.tabula` alternative); `docs/07` §Tier 3 (the 400-cell undo rule);
`prototype/js/dialogs.js` §the import wizard and §the paste dialog for the wording and the flow to match.

Deliverable:

1. `src/core/import/preview.ts` — pure functions over a matrix:
   - `inferColumns(matrix)` → per column: inferred type, the evidence (sample size, the values that forced
     the decision), the confidence, and the alternative type a user might prefer,
   - `estimateNotes(matrix, template, folder)` → the exact count plus every filename collision predicted
     (including collisions with files that will be created in the same run),
   - `buildPlan(matrix, options)` → the ordered op list (`createNote` per row with the mapped frontmatter)
     **without performing anything**, so the dialog can show the truth before writing.
2. `src/plugin/import/ImportWizard.ts` — an Obsidian `Modal` with the documented steps: source (file /
   clipboard / paste area), preview (row count, per-column type with an override control, the folder, the
   filename template, the collision list, the threshold warning naming the `.tabula` alternative), and
   target (mode: replace / create / append, with the exact counts). Every step's numbers come from item 1 —
   the wizard must never say "about 400 rows".
3. `src/plugin/import/runImport.ts` — the runner: creates notes in chunks, yields to the event loop so the
   UI never freezes, reports progress (`created n of N`) in the modal and the live region, records per-file
   failures and continues, and returns a `WriteResult`-shaped summary. Cancelling stops at a chunk boundary
   and **reports exactly what was created** (never silently partial).
4. `src/grid/commands/bulkEdit.ts` — bulk column edit: typing while a whole-column range is selected asks
   for one value and applies it bottom-up (the doc's ordering, so undo restores in the same way), one undo
   step, with the count announced. `Cmd/Ctrl+Enter` commits the editor across the selection (per the doc).
5. `tests/unit/import-preview.test.ts` — inference table: dates vs text, numbers with thousand separators,
   percent vs number, a column that is 99 % numbers with one text cell (assert the evidence list contains
   the offending row), an empty column, a column of `true/false` vs `yes/no`. Collision prediction
   including two rows with the same title.
6. `tests/unit/import-run.test.ts` — with the fake vault: a 412-row import creates exactly 412 notes with
   the correct frontmatter; cancelling after 150 rows reports 150 created and leaves no unreported file;
   a failing create on row 200 is reported per-file and the remaining rows still land; the whole run is one
   undo step and undo removes exactly those 412 files.
7. `tests/layout/tier4.spec.ts` — add: a 400 × 6 import through the UI on the fixture completes with the
   correct note count and the progress text reached `created 400 of 400`; and the undo restores the fixture
   to its previous state in one step.
8. `PROGRESS.md` updated (M4 complete → public beta candidate).

Constraints and fence:
- Touch `src/core/import/**`, `src/plugin/import/**`, `src/grid/commands/**`, `tests/**`, `PROGRESS.md`.
- Import never writes without the preview having confirmed the plan; the plan and the run must use the same
  functions (no second implementation for the "real" run — assert with a spy that the run consumed the
  plan object).
- Chunked yielding: no `setTimeout` chains, no worker, no dependency. Use async iteration with `await` on a
  macrotask boundary, and document the chunk size and why.
- No `any`, no `as`, no `!`.

STOP and report instead of proceeding if: the doc's inference rules are ambiguous for a column shape you
have in the fixtures (list the shape and your proposal); or "append" mode's placement is undefined relative
to sorts and grouping (state both possible readings and wait); or the 2 s lint budget for the dialog
cannot be met because a step is synchronous.

Acceptance (paste raw output):
- `bun run check` — green.
- The inference table output with the evidence lists.
- The 412-row run: the summary, the failure row, the ordering of created files, and the undo result.
- The Tier-4 additions with their measured timings.
- A real-app observation: import a real CSV from your Downloads folder into a scratch vault and paste the
  before/after note counts plus three notes' frontmatter.

REPORT BACK with: the file list; the raw gate output; the inference decisions with their doc lines; the
import summary shape; the undo proof; anything ASSUMED; the exact next step.
