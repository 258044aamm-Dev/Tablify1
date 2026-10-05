Task: implement the settings schema, its persistence in `data.json` with a forward-only migration, and the
real settings tab rows. Everything the later steps read through `settings` must exist here first.

Read first: `docs/02-architecture.md` §settings, `docs/03` §view config vs plugin settings (which knobs
live in the `.base` and which in `data.json` — this distinction is a decision, do not blur it),
`docs/01-spec.md` §settings, `docs/08-decisions.md` §P3, §E5, `docs/09-publishing.md` §what may be stored
(never a token, never telemetry).

Deliverable:

1. `src/plugin/settings/schema.ts` — the settings type with documented defaults and a `version` field:
   rows & files (target folder, filename template, date format), import/export (threshold for the
   large-import warning, default type-inference on/off, clipboard paste mode default), appearance
   (theme mode: follow the host theme or the plugin's own; row height default; reduce motion: follow the
   system), legacy (show the `.tabula` migration entry points), advanced (log level, experimental flags
   object — empty by default). Every default is a value, never `undefined`; every field has a one-line
   comment naming the user-facing consequence of changing it.
2. `src/plugin/settings/load.ts` — `loadSettings(raw: unknown): { settings, migratedFrom?, warnings }`:
   - validates shape without a dependency (a small hand-written validator: type, range, enum membership),
   - unknown keys are preserved in a `passthrough` bag and written back on save (so a newer version's
     settings are not destroyed by an older one),
   - missing keys take their default; a wrong-typed key takes its default **and** produces a warning that
     the settings tab displays once,
   - `migrate(raw)` handles `version: 0` (no version field) → current, and is a pure function with tests.
3. `src/plugin/settings/save.ts` — debounced save (the docs' interval), writes only when the serialised
   value changed, never writes `undefined`, and never writes a key whose value came from `passthrough`.
4. `src/plugin/settings/TablifySettingTab.ts` — grown into the real tab: sections in the documented order,
   each row with a name, a description that says what happens when you change it, and a control
   (`Setting().addToggle/.addText/.addDropdown/.addSlider`). Rows that only make sense when another row is
   on must be hidden rather than disabled, with the rule in a comment. The tab must render from the schema,
   not from hand-written markup: adding a setting should be one entry in the schema plus one control row.
   Also add one read-only row showing the plugin version and the `minAppVersion`, and a "Diagnostics"
   button that copies a small JSON blob (versions, settings *without* any secret, row counts) to the
   clipboard — implemented with `navigator.clipboard`, wrapped so a failure to copy shows a Notice rather
   than throwing.
5. `tests/dom/settings-tab.test.ts` — the tab renders every schema row (iterate the schema and assert one
   row per setting), a hidden row appears when its condition turns on, and changing a control calls the
   save path exactly once (use the fake clock for the debounce).
6. `tests/unit/settings-load.test.ts` — the migration table: `{}` → defaults; a partial file; a file with a
   wrong type; a file with unknown keys (they survive a save/reload cycle); a file with `version: 0`; a
   file with a future version number (must not throw, must not change anything, must warn).
7. `PROGRESS.md` updated (M2 complete; the settings inventory with defaults).

Constraints and fence:
- Touch `src/plugin/settings/**`, `src/plugin/main.ts` (wiring only), `tests/**`, `PROGRESS.md`.
- No token, no secret, no telemetry, no network in this step. Nothing that looks like an analytics field.
- View-level knobs (column widths, order, row height per view, grouping) must **not** appear in
  `data.json`: they belong to the `.base` sidecar. If you feel tempted, re-read the doc and report the
  temptation instead.
- No dependency for validation. No `any`, no `as`, no `!`.

STOP and report instead of proceeding if: a setting in `docs/01` cannot be placed in either `data.json` or
the `.base` unambiguously; or `Setting()` needs a control the API does not provide at 1.13.1 (list the
control and what you would use instead); or the migration cannot be written as a pure function because the
old format is unknown (then say which keys you cannot map and stop).

Acceptance (paste raw output):
- `bun run check` — green.
- The settings-tab render test output, listing every row name it asserted.
- The migration table results for the six cases in item 6, each with the resulting settings and the warning.
- A real-vault observation: open the settings tab, change two settings, restart Obsidian, and paste the
  resulting `data.json` (with any path values shortened) plus the evidence that the tab remembered them.

REPORT BACK with: the file list; the raw gate output; the settings inventory with defaults; the
`passthrough` behaviour you implemented; the real-vault evidence or an honest ASSUMED; anything ASSUMED;
the exact next step.
