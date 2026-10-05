Task: implement the read-only `.tabula` adapter and the one-way migration, ported from the fork's parser
but rewritten to this project's rules. The legacy format is frozen: read it, never write it.

Read first: `docs/03-data-model-and-migration.md` §the `.tabula` format, §the migration report and
§what is reported as dropped (this is the spec for the dry-run); `docs/01-spec.md` §legacy;
the fork at `../airtable-tabula` — read `parseTableFileDocument` and the settings persistence code to
learn the exact on-disk shapes of v1 and v2 (do **not** copy the code; the fork's version has the bugs
listed in `prototype/AUDIT-REPORT.md` — read that first and state which ones you are avoiding);
`prototype/js/legacy.js` shows the behaviour of a correct implementation.

Deliverable:

1. `src/adapters/tabulaFile/parse.ts` — `parseTabulaFile(text, path): TabulaDoc | TabulaError`:
   - v1 and v2, detecting the version from the content (header shape, then a version field if present),
   - **never throws**: a corrupt file returns a `TabulaError` with `{ path, line?, column?, message,
     excerpt }` where the excerpt is the offending line, trimmed to 120 characters,
   - tolerant of the shapes the fork actually wrote: BOM, CRLF, trailing whitespace, a table with zero
     rows, a table with a field type it no longer knows (keep the column, mark it unknown), select cells
     that reference deleted options (keep the label, mark it orphaned),
   - no `JSON.parse` on a fragment that might be truncated without a guard — a truncated file must produce
     a good error message, not a stack trace.
2. `src/adapters/tabulaFile/model.ts` — the neutral in-memory shape (`TabulaDoc`, `TabulaTable`,
   `TabulaField`, `TabulaRow`) plus `toFieldDescriptors()` mapping legacy types onto this project's
   registry, listing every type that has no equivalent, and `toMatrix()` producing the paste matrix the
   importer consumes.
3. `src/core/migrate/dryRun.ts` — `dryRunMigration(doc, target): MigrationReport` with, per table:
   the row count, the column count, every type being remapped, every column that will be dropped
   (`autoNumber`, unknown types), every value that will not survive (a select label with no option), and
   the exact count of notes that **would** be created. The report is data, not prose: the UI renders it,
   and a test asserts its shape.
4. `src/core/migrate/apply.ts` — `migrateMutation(doc, report, target): Op[]`: the migration as ordinary
   ops (importBlock per table, plus the view config op), so the migration is one undo step and goes through
   the same write queue as everything else. Writes go to **new** notes; the `.tabula` file is never
   modified (assert it: the fake vault's raw text for the source path is unchanged).
5. `tests/fixtures/tabula/` — committed fixtures, taken from the fork's own test data where possible:
   `v1-simple.tabula`, `v2-three-tables.tabula`, `unknown-types.tabula`, `orphan-options.tabula`,
   `truncated.tabula`, `empty.tabula`, `crlf-bom.tabula`. Each gets a snapshot test of the parse result
   (structure, not prose) and, for the corrupt one, of the error message.
6. `tests/unit/migration.test.ts` — the dry-run counts are correct for each fixture (a table of
   table → rows, columns, dropped, remapped, notes-to-create); applying the migration creates exactly that
   many notes with the correct frontmatter; the whole migration is one undo step and undoing it removes
   exactly those notes.
7. `PROGRESS.md` updated.

Constraints and fence:
- Touch `src/adapters/tabulaFile/**`, `src/core/migrate/**`, `tests/**`, `PROGRESS.md`.
- The parser is pure: it takes a string and a path, returns a value. No vault access, no `App`, no DOM.
- No `try/catch` that swallows: an unexpected throw is a bug and must surface as a `TabulaError` only at
  the boundary, with the original error attached as `cause`.
- No dependency for parsing. No `any`, no `as`, no `!`.

STOP and report instead of proceeding if: a fixture from the fork cannot be parsed without inventing a
format rule that is not in `docs/03` (paste the file's shape and the rule you would need); or a legacy type
maps onto two of our types with different `toYaml` behaviour (report both mappings and the value loss).

Acceptance (paste raw output):
- `bun run check` — green.
- The parse snapshots for all seven fixtures (paste them).
- The corrupt/truncated file's user-facing message, verbatim.
- The dry-run table for `v2-three-tables.tabula`.
- The undo test result: notes created, notes removed by one undo, and the source file's bytes unchanged.

REPORT BACK with: the file list; the raw gate output; the fixture inventory; the exact list of type
remappings and drops the dry-run will report; the two forks bugs you deliberately did not port; anything
ASSUMED; the exact next step.
