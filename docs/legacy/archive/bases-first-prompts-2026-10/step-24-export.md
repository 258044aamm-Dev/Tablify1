Task: implement export — TSV and XLSX, to the clipboard and to a file — respecting the decision that CSV
output stays Obsidian's own feature. The XLSX path needs a dependency, so this step starts with a decision,
not with code.

Read first: `docs/01-spec.md` §export, `docs/03` §export (what is exported: displayed values or raw values,
and the rule for each — this is the part users notice), `docs/08-decisions.md` §E6 and §the dependency
policy, `docs/05` §the bundle budget.

Deliverable, in this order:

1. **Dependency decision first.** Compare `write-excel-file` (pure ESM, ~90 KB minified, MIT, browser
   support) against the alternatives you can find that are actually maintained as of today. Report: name,
   version, licence, size added to `main.js` and gzipped, whether it can be dynamically imported so it is
   not in the startup bundle, and the trade-off. Wait for my approval before adding it.
2. `src/core/export/serialize.ts` — pure serialisers: `toTsv(cells)` (reuse the clipboard model, do not
   write a second one), `toMatrix(cells, { mode: "display" | "raw" })` where the mode is explicit and comes
   from the dialog, and `toXlsxData(matrix, types)` producing the plain data structure the writer needs
   (no library import in this file).
3. `src/plugin/export/ExportDialog.ts` — an Obsidian `Modal`: what to export (selection / all filtered
   rows), the format (TSV / XLSX), the destination (clipboard / file), the value mode (displayed / raw),
   and the exact row × column count. The primary action is disabled until the counts are known.
4. `src/plugin/export/runExport.ts` — the runner: clipboard path (with the fallback from step 22) and file
   path (`vault.create` with a collision-safe name in a documented folder, or Obsidian's own save dialog if
   the doc says so — follow the doc). XLSX must be **dynamically imported** so startup stays lean; report
   the startup bundle delta before and after.
5. `tests/unit/export.test.ts` — TSV escaping matches the clipboard fixtures byte for byte; the display/raw
   modes differ for a currency, a date, a percent and a multi-select, with the expected strings;
   the XLSX data structure has the right cell types (number vs string vs boolean) for each field type.
6. `tests/dom/export-dialog.test.tsx` — the counts in the dialog match the selection and the filtered set;
   the primary action is disabled with no rows; cancelling writes nothing.
7. A real-file check you perform yourself: export a 30 × 12 view to XLSX, open it in Excel (or LibreOffice),
   and paste a screenshot plus the three cells that prove the types survived (a date, a currency, a
   multi-select). If you cannot open a spreadsheet application, say so plainly and mark it ASSUMED.
8. `PROGRESS.md` updated (M4 closed; the export formats and the value-mode rule).

Constraints and fence:
- Touch `src/core/export/**`, `src/plugin/export/**`, `tests/**`, `PROGRESS.md`, `package.json` (only after
  my approval in item 1).
- CSV writing is **not** implemented: Obsidian exports CSV natively, and duplicating it is the documented
  reason to skip it. Export must offer TSV for spreadsheets and XLSX for typed data, nothing else.
- No export may read the vault more than once per run, and none may trigger a write.
- No `any`, no `as`, no `!`.

STOP and report instead of proceeding if: the chosen library cannot be dynamically imported in the
ES2018/CJS bundle format Obsidian requires (report the constraint and the fallback); or the display/raw
distinction is not defined for a type in the docs (list them and your proposal).

Acceptance (paste raw output):
- `bun run check` — green, with the bundle numbers before and after the dependency (including the startup
  bundle without the dynamic import, which must be unchanged or smaller).
- The serialiser test results, with the display/raw table.
- The real-file check: the screenshot and the three typed cells (or an honest ASSUMED).
- The dialog test results.

REPORT BACK with: the dependency comparison table and my approval line; the file list; the raw gate output;
the export inventory (format → destination → mode); the measured bundle delta; anything ASSUMED; the exact
next step.
