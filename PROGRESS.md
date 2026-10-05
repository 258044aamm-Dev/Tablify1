# PROGRESS

- Milestone: M0 — Foundation (complete) · **M1 — Core domain (complete)** · M2 — Adapters (next)       Branch: main
- Last completed step: **step 10 — the Bases spike.** A throwaway plugin under `spike/bases-path/` that prints
  what the Bases API actually does, plus a findings report that separates what was **verified from the shipped
  declarations** from what needs a **running Obsidian** (which this environment does not have).
  **Step 11 is gated on the human reading that report** — it is the one part of the plan that cannot be
  verified here.

- Verified (commands run, observed results):
  - `bun run check` — **exit 0**, unchanged by the spike: 817 tests / 18 files, `brand-gate: OK — 59 permitted
    match(es), 0 violations`, `manifest:check: OK`, Prettier clean, `bundle-size: OK`.
  - **`bun run check` provably ignores `spike/**`** (the step's acceptance asks for the proof, not the claim):
    1. `bunx eslint spike/bases-path/main.ts` → `File ignored because of a matching ignore pattern` (the folder
       is in `globalIgnores`), exit 0;
    2. `bunx tsc --noEmit --listFilesOnly | grep -c spike/` → **0** (the root `include` is
       `src/**`, `tests/**`, `scripts/**`, `vitest.config.ts`);
    3. `bunx vitest list --project unit | grep -c spike` → **0** (no test file lives there);
    4. the spike has its own project and its own build: `bunx tsc -p spike/bases-path` → **exit 0**, and
       `bun spike/bases-path/build.mjs` → `main.js 6.1kb` in 4 ms. Its `main.js` is covered by the existing
       `.gitignore`/`.prettierignore` `main.js` pattern, so the built artefact is never committed.
  - **The declaration half of the spike is done**: `spike/bases-path/FINDINGS.md` carries a 22-row claim table,
    16 rows `VERIFIED` against `node_modules/obsidian/obsidian.d.ts` **@ 1.13.1** with a line number as
    evidence, 6 rows `PENDING-RUN`, and one `DIFFERENT` (finding 1 below).
  - **The runtime half is not run** and says so: the console trace, the `processFrontMatter` before/after text
    and the Obsidian version are `PENDING-RUN`, with the exact commands that produce them pasted into the
    report's "How to finish this report" section.

- What step 10 found (declaration-verified, and the reason it is worth reporting):
  1. **`BasesView` declares no `containerEl`.** The only container the API hands a Bases view is the second
     argument of the `BasesViewFactory` (`obsidian.d.ts:1247`); the view class has no such member. Every layout
     contract in `docs/04` assumes the view owns its container, so this belongs in `docs/02` — the exact
     sentence is proposed in `FINDINGS.md`. Proposed correction, reported not absorbed.
  2. **`createFileForView` opens a menu, not a file.** Its own doc comment reads "Display the new note menu for
     a file with the provided filename" (`@since 1.10.2`). It is right for a "New row" button and wrong for the
     412-note import, which needs `vault.create` + `processFrontMatter` — worth a line in `docs/03` §Import so
     step 13 does not reach for the wrong tool.
  3. **The public API exposes no Obsidian version.** There is no version member on `App` or `Vault`; the
     spike's own command says so rather than guessing, and the report asks the human to read Settings ▸ About.
  4. **`QueryController` is an empty class** (`obsidian.d.ts:5315`) — confirmed exactly as `docs/02` claims, so
     all data must come from `BasesView.data`.
  5. **`processFrontMatter` is `@since 1.4.4`, `BasesEntry` really has no write path** (`file` and `getValue`
     are its only members, `685-702`), and `getSort()`'s own comment confirms the payload arrives presorted.
     `docs/02`'s "load-bearing fact of the whole design" holds.

- The op inventory (16 kinds, each with its inverse):

  | Op | Does | Inverse |
  |---|---|---|
  | `setCell` | one cell gets a value | `setCell` with the before-image's value |
  | `setCells` | a block of cells gets values | `setCells` with the row-level before-images, as **one** op |
  | `clearCells` | a selection is emptied | `setCells` with the before-images |
  | `addRow` | a row is created | `deleteRows` |
  | `deleteRows` | rows are deleted (carrying the rows) | `importBlock` — the same rows, values and positions |
  | `moveRow` | one row is dragged | `moveRow` with `from`/`to` swapped |
  | `moveRows` | a block is dragged | `moveRows` with `from`/`to` swapped |
  | `setFieldOptions` | a column's options change | `setFieldOptions` with `from`/`to` swapped |
  | `addField` | a column is created (with its starting values) | `deleteField` |
  | `deleteField` | a column is deleted **with every value it held** | `addField` — restores the data |
  | `renameField` | a column is renamed | `renameField` with `from`/`to` swapped |
  | `resizeColumn` | a column edge is dragged | `resizeColumn` with `from`/`to` swapped |
  | `reorderColumn` | a column is dragged | `reorderColumn` with `from`/`to` swapped |
  | `setGroupCollapse` | a group is collapsed | `setGroupCollapse` with `collapsed` flipped |
  | `setViewConfig` | a view option changes | `setViewConfig` with `changes`/`previous` swapped |
  | `importBlock` | a sheet is pasted or imported | `deleteRows` — one op, one undo step |

- Decisions and interpretations worth recording:
  1. **Coalescing is NOT implemented, and the hook exists unused.** The pack asked for a hook "only when the
     docs say so" and to stop if the docs contradicted themselves. They specify no coalescing at all; they
     specify the opposite shape: `docs/01` line 38 "Undo/redo | All grid operations, including multi-note
     writes, **as one user-visible step**", `docs/02` §Store "a **`Command`** captures the ops it produced
     *and the previous values it overwrote*", and `prompts/step-18` "Every editor: commits **once per finished
     edit** (no write on each keystroke)". One finished edit is therefore one push already; merging pushes
     would *contradict* "one user-visible step". So `createHistory()` defaults to `NEVER_COALESCE`, the hook
     is there for a caller that has the documentation for a different policy, and both halves are asserted —
     including the subtle rule that when commands *do* merge, the **earliest** before-image wins for a cell
     both touch, or undo would restore the value from before the last keystroke instead of before the first.
  2. **Undo depth is 60**, carried from `prototype/js/store.js` (`cap()` returns 60, 12 in its stress mode),
     because **`docs/` names no number at all**. Recorded as a gap: it deserves a line in `docs/01` §undo.
  3. **Three kinds need a `Before`; thirteen are self-inverting.** `setCell`, `setCells` and `clearCells`
     overwrite values they do not know, so the caller captures a before-image (`captureBefore`) exactly as
     `docs/02` says a command does. Everything else carries what its inverse needs: `deleteField` carries the
     column's values, `deleteRows` carries the rows, `setViewConfig` carries the settings it replaced. This is
     the STOP clause's subject — **a column pre-image is not a table pre-image** — so no op needs one.
  4. **`null` means "no key".** Writing `null` removes the cell key rather than storing it, which is the same
     rule `docs/03` §write rules gives the write queue ("clearing a value **removes** the key"). It was found
     by the property test: writing an explicit `null` into a cell that had no key made the state
     not-deep-equal after an undo (two representations of empty), and it would have reached the write queue.
  5. **A move op's `to` is the insertion index *after* the block is lifted out**, and `from` is the block's
     index before the move. That is the convention under which the inverse is a plain swap. Builders
     (`ops/build.ts`) read `from` out of the state and convert the index the user dropped on, because a stale
     `from` is exactly how an undo lands somewhere else — the property test caught that too.
  6. **A view patch that sets a key to `undefined` removes the setting, and the merge omits such keys** rather
     than writing `{ key: undefined }`, so "the same data" keeps the same shape and an undo lands on a
     deep-equal state. `viewConfigOp()` records `previous` for exactly the keys the patch names — the reason
     the builder exists instead of callers assembling patches by hand.
  7. **`apply` is total and reports.** A write into a row that is gone, a delete of a row that is not there, a
     duplicate import, a stale index: each comes back as a `Skipped { op, count, reason }`, never a throw, and
     never silent. The store drops ops that produced a skip instead of pushing them, because the inverse of a
     write that never happened would still overwrite something.
  8. **`clampTo` keeps a surviving endpoint exactly where it is** and re-seats only a vanished one, at the
     index it used to hold (clamped to the shorter list) — that is `docs/07` §Tier 3's "degrades predictably
     (to the nearest surviving row)". An endpoint with no previous position (a row that appeared) is seated at
     the start rather than dropped; a selection with nothing left in it is `null`, which the grid reads as
     "no selection".
  9. **The clipboard is type-blind and never evaluates.** Cells are strings: the caller formats with the
     column's `formatPlain` and parses back with `parsePlain`, so a date or a currency crosses the text
     channel without this module knowing what a date is. A cell starting with `=`, `+`, `-` or `@` is quoted
     in TSV (and marked `mso-number-format:'\@'` in HTML), and **empty text is never re-interpreted**: quoting
     is a mitigation, not a guarantee, and the reader side stores `=SUM(A1:A9)` as text, always.
 10. **One empty cell is written `""`, not an empty string.** Otherwise it is indistinguishable from "nothing
     was copied" and cannot round trip. Two documented losses remain, both asserted in their own tests: a
     final row that is one cell wide and entirely empty (indistinguishable from a trailing newline), and edge
     spaces in HTML (trimmed, because HTML cannot carry them).

- Assumed / not verified:
  1. **The Excel clipboard fixture is constructed, not captured** (ASSUMED, marked in the test): this
     environment has no Excel. The Sheets fixture *is* captured, from the article cited in the test header.
     Both are exercised, and the reader is written to be tolerant rather than to match one payload byte for
     byte.
  2. **`mso-number-format:'\@'` keeping a formula-shaped cell as text in Excel is documented, not tested.**
     Nothing in this environment can paste into Excel. The reader side is unaffected either way.
  3. **The undo depth of 60 and the absence of coalescing are carried from the prototype and the docs' silence
     respectively** (see 1 and 2 above) — both are decisions to confirm, not facts found in a spec.
  4. **Range lookups build an index map per call** (O(rows)); fine for a keystroke on 5,000 rows, and the grid
     can hoist it later if a profile asks. Recorded so it is a known cost, not a surprise.
  5. **Nothing here has met the store yet.** `apply` is called by tests, not by a renderer; step 16 wires it.

- Findings worth keeping (things the docs did not say, or said differently):
  1. **`docs/02` §Store's `Command` has no `label`,** and the UI needs one for "Undo paste 400 rows". This
     build's `Command` carries `label` (and `history.undoLabel()`/`redoLabel()` read it). Worth adding to
     `docs/02` when it is next updated.
  2. **`docs/02` §Store's sketch has `undo(): Promise<void>`; this build's `undo()` returns the ops to run**
     and the store replays them. That is the same design ("Undo replays inverse ops through the same write
     queue"), expressed so the pure core never awaits anything — the async part belongs to the write queue
     (step 11).
  3. **`docs/01` §in scope lists "undo of multi-note writes"** but no depth, no coalescing policy and no
     wording for the menu items — three gaps that a UI step will otherwise invent (see the open questions).
  4. **`prototype/js/io.js` parses the HTML table with the DOM** (`DOMParser`). The core cannot: it is pure
     TypeScript. The reader here is a ~90-line tolerant scanner (comments, `<style>`, `<script>`, `<colgroup>`,
     nested `<div>`s, `<br>`, entities) instead, and the captured Sheets payload is its regression test.
  5. **A nested table inside a cell reads as an empty cell** in that scanner, because text from a nested table
     is skipped rather than guessed at. Asserted, with the reason in the test name.
  6. **`fromTsv` needs the trailing-newline rule to be exactly one row, not "drop all trailing empties"** (the
     prototype drops all). Dropping one keeps a matrix that genuinely ends in an empty row, and it is what
     makes the round trip exact for 13 fixtures instead of 11.

- Open questions for the human:
  1. **Should `docs/01` be given the missing §undo paragraph** (depth 60, one step per user action, the undo
     wording, no keystroke coalescing)? The code is ahead of the docs here, and four prompts will read them.
  2. **Should `docs/02` §Store's `Command`/`GridStore` sketch be updated** to the implemented shape (`label`,
     `undo()` returning ops, `History` as a factory rather than methods on `GridStore`)? (Findings 1–2.)
  3. (unchanged) **`docs/02` §Query and `docs/01` are behind the query layer**; a select column's sort is
     alphabetical rather than option-ordered (step 08, Findings 1–3).
  4. (unchanged) **`@standard-schema/spec` as a types-only devDependency, or the local structural declaration?**
  5. (unchanged) **`docs/04` still has no §cell-rendering section**, which `prompts/step-07` cites.
  6. (unchanged) **`attachment`: write `[[link]]` or the plain vault path?** (current: plain path.)
  7. (unchanged) Layout guard: warning (current) or failing until step 21? Dependabot keeps proposing
     `obsidian` minor bumps. `docs/09` line 33 still contains a banned word in its description template; the
     three candidate plugin descriptions await a pick.

- Next step: `prompts/step-11-rowsource-and-writequeue.md` — the `RowSource` port, the write queue (coalescing
  per file+property, per-file serialisation, rollback, `flush()`), and the optimistic overlay. **It carries one
  gate from step 10:** the spike's runtime rows (container size, `getOrder()`, `processFrontMatter`'s byte-level
  behaviour, and the Obsidian version) are `PENDING-RUN`, so anything in step 11 that depends on a *verified*
  runtime fact rather than a declared one is marked as an assumption until the human runs the spike. The queue
  itself needs none of them — it is tested against `tests/fakes/vault.ts`.

- Files touched this step: new — `spike/bases-path/{manifest.json,main.ts,write-test.ts,tsconfig.json,build.mjs,README.md,FINDINGS.md}`;
  changed — `eslint.config.mts` (one line: `spike/**` in `globalIgnores`, which the prompt's own fence asks
  for), `PROGRESS.md`. Nothing in `src/`, `tests/` or `scripts/`. The spike is throwaway by design: the report
  ends with the instruction to delete the folder and fold the verified facts into `docs/02`.

- Files touched this step: new — `src/core/ops/{types,apply,inverse,build,history}.ts`,
  `src/core/selection/{range,clipboard}.ts`, `tests/unit/{ops-fixtures.ts,ops.test.ts,ops-inverse.property.test.ts,selection.test.ts,clipboard.test.ts}`;
  changed — `PROGRESS.md`. Nothing outside `src/core/**`, `tests/unit/**` and `PROGRESS.md`. `ops/build.ts` is
  a fifth source file beyond the step's four: the builders that read an inverse's input out of the state
  (findings 4–6) are the reason `inverse.ts` stays about inverses.

- Earlier steps: 08 the query layer (one AST, the DSL, the evaluator, the filter→search→sort→group pipeline;
  746 tests, `core/query` 91 %); 07 the fifteen remaining field types and the registry-wide suites (500
  tests); 06 the field contract, the schema and the registry (115 tests); 05 fakes and boundaries; 04 CI and
  release; 03 the plugin shell; 02 manifest and legal; 01 toolchain and gate. Forced amendments are recorded
  in `prompts/README.md` under "Amendments applied during execution".
