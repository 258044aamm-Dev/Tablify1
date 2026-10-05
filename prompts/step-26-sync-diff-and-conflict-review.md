Task: finish sync — the three-way diff, pull/push with per-field decisions, the conflict review dialog, and
the dynamic-import wiring so the feature costs nothing when unused.

Read first: `docs/03` §sync behaviour (the table of cases: local-only change, remote-only change, both
changed to the same value, both changed differently, deleted on one side, a field that does not exist
remotely), `docs/01-spec.md` §sync menus and §conflict review, `docs/08-decisions.md` §P9 (ask before
overwriting — never silent), step 25's client and link store.

Deliverable:

1. `src/sync/diff.ts` — the three-way diff as a pure function over `{ baseHash, local, remote }` per field,
   producing a typed decision per field:
   `unchanged | local-only | remote-only | both-same | conflict | local-deleted | remote-deleted |
   type-mismatch`. Requirements: identical remote values resolve automatically (no dialog); a same-field
   conflict can **never** resolve silently (assert that the resolution type requires an explicit choice);
   deletions never propagate automatically in either direction.
2. `src/sync/pullPush.ts` — the engine: build a plan (what will change locally, what will be written
   remotely, counts per direction), apply locally through the existing write queue as **one** undo step,
   push in chunks, and produce a report (`applied`, `skipped`, `conflicts`, `errors` per file/field).
   Every plan is computed before anything is written, and the plan is what the UI shows.
3. `src/plugin/sync/SyncPanel.ts` and `ConflictReview.ts` — Obsidian `Modal`s:
   - the panel: link state, the field mapping with unmatched fields called out, pull and push actions with
     the plan's counts on the button ("Pull 12 notes · 40 fields"), and a link/unlink flow with the folder
     the link file lives in;
   - the review dialog: per-field side by side (local value, remote value, base value when it differs),
     selection state per field with bulk take-local/take-remote, a visible count of exactly what will be
     written where, and a disabled primary action until every conflict has a choice. No silent defaults:
     opening the dialog with conflicts and pressing the primary action must not be possible.
4. `src/plugin/main.ts` — the dynamic import: sync is imported only when a link exists or the user opens the
   panel (`await import("../sync/…")`), and the startup path stays free of it. Add a badge/indicator
   (status bar item or ribbon, per the doc) reflecting link state.
5. `tests/unit/diff.test.ts` — the full case table from `docs/03` §sync behaviour, one test per row, plus:
   both-same resolves automatically; a conflict demands an explicit choice; a deletion on one side never
   propagates; a type-mismatch is reported with both values.
6. `tests/unit/pull-push.test.ts` — with the fake transport and the fake vault: the 40-field/12-note pull
   applies as one undo step; a push of 12 records produces the documented chunk count; a partial failure
   leaves the local state consistent and reports per-record status; an external change during a pull is
   detected (snapshot hash mismatch) and reported rather than overwritten.
7. `tests/dom/conflict-review.test.tsx` — the dialog's counts match the plan; the primary action is disabled
   until all conflicts are chosen; take-all works; cancelling writes nothing.
8. `tests/unit/startup.test.ts` — asserts the sync module is not imported on the startup path (load the
   plugin module graph and check the module registry, or assert the built `main.js` contains no reference
   outside the dynamic import — state which technique you used and why it is sound).
9. `PROGRESS.md` updated (M5 complete).

Constraints and fence:
- Touch `src/sync/**`, `src/plugin/sync/**`, `src/plugin/main.ts`, `tests/**`, `PROGRESS.md`.
- Never modify the remote schema; never delete remote records; never delete local notes because the remote
  side deleted them; the token never leaves `SecretStorage`.
- The review dialog must show raw and displayed values for a field when they differ (a user choosing
  between two numbers needs both).
- No `any`, no `as`, no `!`.

STOP and report instead of proceeding if: a row of the behaviour table has no defined outcome (list the row
and your proposal); or the plan cannot be computed before writing because a remote value is only known
during the write (report the constraint and the two-step design you would use).

Acceptance (paste raw output):
- `bun run check` — green.
- The diff case table results, one line per documented case.
- The 40-field/12-note pull: the plan, the applied result, and the single undo step that reverses it.
- The conflict-dialog test output, including the disabled-state assertion.
- The startup proof: the bundle does not contain the client, and the dynamic import fires only when a link
  exists (paste the console line you used to show it).
- Two startup measurements: time to first paint with no link, and with a link present (state the method;
  `performance.now()` around the view's first render is acceptable).

REPORT BACK with: the file list; the raw gate output; the behaviour-table results; the plan/apply/undo
evidence; the startup numbers; anything ASSUMED (real Airtable behaviour especially); the exact next step.
