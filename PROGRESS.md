# PROGRESS

- Milestone: M0 — Foundation (complete) · M1 — Core domain (complete) · **M2 — Adapters (in progress)**
  Branch: main
- Last completed step: **step 12 — `BasesSource`, the real Bases view, and note creation.** Rows and values
  come from a real Bases view (keyed by `entry.file.path`), edits go out through step 11's queue, and the
  optimistic overlay is what the grid reads in between. The whole **data path is ASSUMED**: there is no real
  vault here, and the step's real-vault observation is not produced (see the step-12 block below).

- Last completed step before that: **step 11 — the `RowSource` port, the write queue and the optimistic
  overlay.** The layer that makes editing a note-backed grid safe: coalescing per file+property, one
  `processFrontMatter` call per file per flush, a promise chain per file so two writers never overlap, a
  250 ms debounce with a `flush()` that bypasses it, per-file failure reporting, and an overlay that holds
  pending values only.

---

**Step 12 — `BasesSource`, the real Bases view, and note creation.**

- Verified (`bun run check` — raw): `tsc --noEmit` clean; `eslint .` → **0 errors, 1 warning** (step 04's
  settings tab does not implement `getSettingDefinitions()`; step 14 replaces it); `brand-gate: OK — 59
  permitted match(es), 0 violations`; `manifest:check: OK`; `All matched files use Prettier code style!`;
  **868 tests across 21 files** (was 836 / 19); `bundle-size: OK` — `main.js raw 52661 bytes (51.43 KB)`,
  `gzip 16525 bytes (16.14 KB)`, `styles.css !important check: clean`. Coverage: all files **92.15 / 91.43**;
  `src/adapters` 97.77 / 96.00 (`optimistic.ts` 100/100, `writeQueue.ts` 97.41/95.74),
  `adapters/bases/BasesSource.ts` **85.17 / 84.11**, `adapters/notes/createNote.ts` **92.30 / 90.14**,
  `plugin/TablifyView.ts` 54.18 (its DOM body is step 17's, and it is a placeholder by design).

- The five acceptance assertions, from `tests/unit/bases-source.test.ts` (18 tests; the fixture host is a
  stand-in for `BasesView` and the fake vault, never a real one):
  1. **Rows keyed by path survive a reorder and a re-creation**: after the host replaces its entries wholesale
     and adds a row, `getRows()` is `['Notes/B.md','Notes/A.md','Notes/C.md']` and the new row's value reads
     `'Gamma'`; after the host drops `B`, `getRows()` is `['Notes/A.md']` and `getValue('Notes/B.md','note.Name')`
     is `null` — the disappeared row does not resurrect, because nothing is keyed by index.
  2. **One cell op ⇒ exactly one queued write and one overlay entry**: `result.written === 1`,
     `queue.pending() === 1`, `overlay.size() === 1`, `overlay.get('Notes/A.md','Name') === 'Alpha two'`, and
     `getValue('Notes/A.md','note.Name')` returns the typed value *before* the write lands;
     `clock.pending() === 1` (the 250 ms debounce) and `vault.writeCount() === 0` at that moment. After
     `clock.advance(250)` + `flush()`: the writer was called **once**, the vault holds `Name: 'Alpha two'`, and
     `overlay.size() === 0`.
  3. **A read-only column refuses, typed**: `ok === false`, `written === 0`,
     `refused[0] = { reason: 'readonly-column', propertyId: 'file.mtime', message: 'mtime is read-only (…) }`,
     no timer queued and `vault.writeCount() === 0`. A column that is not in the view refuses too, naming it.
  4. **`subscribe` fires once per frame for ten rapid updates**: ten host updates leave `first === 0` and
     `frames.length === 1`; running that one frame gives `first === 1`, and the snapshot holds the **last**
     value (`'Alpha 9'`). A listener that unsubscribed is not called (`second === 0`).
  5. **The QueueSpy**: the source is constructed with one injected `processFrontMatter`, and a single cell op
     produces **zero** spy calls before the debounce and **exactly one** after it, with the fake vault
     recording exactly one write. The source holds no vault reference at all (asserted on its own keys), so a
     direct write is not possible — not merely not done.

- **A real defect the fixture caught, fixed in the adapter (not in the test).** `apply` was enqueuing the
  **Bases property id** (`note.Name`) where the write queue treats its `propertyId` as the **frontmatter key**,
  so the first write would have created a `note.Name:` key and left `Name:` alone — on a real vault, silently.
  `translate()` now enqueues `field.definition.name` (the frontmatter key: `docs/03` §write rules 4 — a rename
  in the `.base` changes the label, never the key on disk), while refusals and the overlay keep the Bases id and
  `getValue()` maps back through the column's own name. Asserted directly:
  `Object.keys(frontmatterOf('Notes/A.md')) === ['Name','Status']`.

- **ASSUMED — the entire data path.** No real vault exists in this environment, so nothing here has been
  observed against Obsidian: the fixture host is a stand-in for `BasesView`, not evidence about it. The step's
  real-vault observation (the placeholder's row/field counts, three formatted values, and one property's
  frontmatter before/after) is **not produced**, and no fixture is offered as a substitute. `DEV-NOTES.md`
  carries the exact click-path for whoever runs it, including the temporary `spike-set-cell` command — which
  must be deleted in the same commit that adds it, which is why it is not in this commit.

- The `.base` sidecar **can** store what `docs/03` §view config lists, checked in `obsidian.d.ts @1.13.1`
  before any view-config code was written, because the step's STOP clause asks:
  `BasesViewConfig.get(key)` / `set(key, value)` / `getAsPropertyId` / `getEvaluatedFormula` (`@since 1.10.0`),
  `getOrder()`, `getSort()`, `getDisplayName()`. **No STOP was needed.** Two related facts:
  `BasesView.config.set` is the documented "store configuration data for the view" path (it travels with the
  `.base`), and `@since 1.13.0` adds a **declarative** settings surface (`PluginSettingTab.getSettingDefinitions()`,
  which `eslint-plugin-obsidianmd` already nags about) — step 14 should adopt it, or say why not.

- Interpretations worth recording:
  1. **`order()` reads `data.properties`** ("visible properties defined by the user", `@1.10.0`) and falls back
     to `config.getOrder()` when a view has no explicit order yet, so a fresh view shows columns instead of an
     empty header. Both are the `.base` view config per `docs/03`.
  2. **The external-change subscription is the app's own `metadataCache.on('changed')`**, filtered to paths
     currently in the row set and released with `offref()` in `dispose()`. The step's STOP clause asked what to
     do if frame coalescing needs a `window` listener: this is the answer — the emitter is owned by the app,
     there is no global listener to leak, and `onDataUpdated` remains the primary trigger. The default frame
     scheduler uses `window.requestAnimationFrame` inside a window and a microtask hop outside one (a node
     test), documented at the constant; every test that cares injects its own `schedule`.
  3. **`createNote`'s filename rule**, following `docs/03` §row creation: expand the template; an **empty or
     blank** template is the documented fallback (`Row <n>`); a template that could not be filled (a
     placeholder key the row has no value for) gets one second chance — the leading column's value — then
     `Row <n>`; whatever wins is sanitised, and an empty result is `Row <n>`.
  4. **Collisions append `" 2"`, `" 3"`, …** per `docs/03` line 99, and the count is reported
     (`collisions`, `renamed`). `prompts/step-12` item 5 illustrates the same case as `Project plan (1)`; the
     doc is the spec, the parenthesised form is not implemented, and this is reported as a prompt/doc
     divergence for a decision rather than quietly split down the middle.
  5. **The manual path runs only for `mode: 'direct'`** (a specific folder, or a bulk import), because
     `createFileForView` opens the new-note **menu** per call (`@since 1.10.2`, step 10's finding) — 412 modals
     is not a feature. `CreateNoteResult.via` reports which path ran, so a failure is always attributable.
  6. **The port gained `dispose()`** (`src/adapters/RowSource.ts`): the step's item 1 requires the source to
     release everything, and the port is what a caller holds. One method, with the reason in its doc comment.
  7. **The view's factory is the composition root**: `main.ts` builds the environment (clock, timezone,
     locale) once, registers `view.dispose()` with `Component.register`, and the view keeps the container the
     factory was handed — `BasesView` still declares no `containerEl` (step 10's finding).

- Findings worth keeping (the docs did not say, or said differently):
  1. **`docs/02` §Rows become notes** should state that the sanctioned `createFileForView` path opens a menu
     and is therefore **single-row only**; bulk creation (paste, import, migration) must use
     `vault.create` + `processFrontMatter`. `docs/03` §Import needs the same line. *(reported, not applied —
     doc edits await approval, as the step asks)*
  2. Step 10's three proposed corrections are unchanged and still unapplied (no `containerEl` on `BasesView`;
     no public Obsidian version; the `GroupedData`/`data.properties` reading). They are listed in
     `spike/bases-path/FINDINGS.md` with the exact replacement sentences.

- Assumed / not verified (step 12):
  1. The real-vault observation itself (above). Everything about the real `BasesView` beyond the declaration
     text is unverified, including whether `data.properties` is already in the user's column order.
  2. `BasesViewConfig.set`'s on-disk format (a string in the `.base` view section) is assumed from `docs/03`
     §`fieldOptions shape`; the spike never wrote one.
  3. A metadata change caused by the plugin's **own** write is untested here. Frame coalescing bounds it to one
     repaint, and the queue's `settle` removes the overlay value before the frame runs — but a real vault is
     where a self-notify loop would show up.
  4. `frontmatterBody` is a deliberate one-line-per-key writer, not a YAML library: ten quoting cases are
     asserted and nested structures are out of scope by design (`docs/03` §write rules 6 — no objects in
     frontmatter).
  5. `plugin/TablifyView.ts` is at 54 % coverage on purpose: its DOM body is replaced in step 17, and the
     interesting part (`summarize`) is a pure function.

- Files touched this step: new — `src/adapters/bases/BasesSource.ts`, `src/adapters/notes/createNote.ts`,
  `src/plugin/TablifyView.ts`, `src/plugin/DEV-NOTES.md`, `tests/unit/bases-source.test.ts`,
  `tests/unit/create-note.test.ts`; changed — `src/adapters/RowSource.ts` (`dispose()` on the port),
  `src/plugin/main.ts` (constructs the view; exports `pluginEnvironment()`), `styles.css` (three lines for the
  placeholder), `tests/mocks/obsidian.ts` (`BasesView` gains `app`/`config`/`data`/`allProperties`, `Plugin`
  gains `register`), `tests/unit/bases-registration.test.ts` (the two placeholder assertions, now about the
  real view), `PROGRESS.md`; **deleted** — `src/plugin/TablifyPlaceholderView.ts`, replaced by the real view.

---

- Verified — **step 11** (commands run, observed results):
  - `bun run check` — **exit 0**: typecheck, lint (0 errors; the one pre-existing settings-tab warning),
    `brand-gate: OK — 59 permitted match(es), 0 violations`, `manifest:check: OK`, Prettier clean, tests,
    build, `bundle-size: OK`. **835 tests across 19 files** (was 817 / 18).
  - **The brand gate caught a real violation in this step's own code**: a source comment in `writeQueue.ts`
    named the remote-sync vendor, which is banned in product code (permissions exist only for internal docs).
    Reworded to "the remote-sync client"; the gate is now clean. Recorded because it is the first time the
    gate fired on product code, and it fired on prose, not on a value.
  - **Coverage** (`bunx vitest run --coverage`): all files 93.24 / 91.65; `src/adapters` 85.55 / 92.64 —
    `writeQueue.ts` 93.54 / 89.13, `optimistic.ts` 100 / 100, `RowSource.ts` (types + three helpers) covered
    by the result-shape test.

- The write queue's constants, and where each comes from:
  1. **`DEBOUNCE_MS = 250`** — `docs/02` §write queue, verbatim: "debounce 250 ms, hard flush on blur / view
     close / undo / import".
  2. **`CONCURRENCY = 4`** — the docs say files "may proceed in parallel, bounded by a **documented**
     concurrency limit" and never give the number. Decided here (one in-flight note write each; the vault's
     writer is the bottleneck), exported as a constant, and reported as a gap.
  3. **No retry** — the docs' retry/backoff belongs to the remote-sync client (`docs/02` §sync, `docs/06`
     M3), not to note writes. A failed note write is reported to the caller and its overlay value is dropped,
     so the grid shows the file's real content.

- The five acceptance assertions (paste of the fake-vault results; the whole file is
  `tests/unit/write-queue.test.ts`, 19 tests):
  - **12 writes in a tick ⇒ exactly one `processFrontMatter` call**: `expect(vault.writes).toHaveLength(1)`
    after `clock.advance(DEBOUNCE_MS)`; the write log holds one record whose `after` carries all twelve keys.
  - **Two interleaved writers, nothing lost**: four writes alternating `FromOne`/`FromTwo`, coalesced to one
    call, final frontmatter `{ FromOne: '2', FromTwo: 'b' }` — both writers' last intentions.
  - **A failing callback drops only that property's overlay and other files still land**: `result.ok === false`,
    `result.errors[0].path === 'Notes/Bad.md'`, `vault.writeCount('Notes/Bad.md') === 0`, and the good file
    holds its value. The overlay hook test asserts the pending entry is gone afterwards.
  - **`flush()` resolves after the last write**: a flush with a queued write returns `{ ok: true, written: 1,
    files: ['Notes/A.md'] }`, `queue.pending() === 0`, `clock.pending() === 0`; a second flush writes nothing
    and reports `written: 0`; failures are not reported twice.
  - **Unknown keys and the body survive**: `raw()` before and after differ only in the `Name:` line — every
    other line byte-identical — and unknown keys (`custom`, `tags`) are untouched. Clearing deletes the key
    (asserted with `'Name' in frontmatter === false`), and the fake vault's `modify` — which throws — is
    never reached.

- Assumed / not verified:
  1. **Concurrency 4** is my number, not the docs' (see above).
  2. **Frontmatter comments are not modelled by the fake**, and Obsidian's `processFrontMatter` does not
     promise to preserve them either (`docs/03` promises unknown *keys* survive, which is what is asserted).
     The step-10 spike's write probe is the place a real comment is put through a real vault.
  3. **Nothing here has touched a real vault.** The whole data path is ASSUMED until step 12 wires the adapter
     and the spike's runtime rows land (see the step-10 report).
  4. **The queue is view-scoped**: two views on the same note have independent chains, and cross-view ordering
     is the vault writer's business. Stated in the module header; not tested, because two views need two
     `App`s.

- Findings worth keeping (things the docs did not say, or said differently):
  1. **`docs/02` §the port's `RowSource` has no capability flags** beyond `writable`, while the step prompt
     asks for `readonly`, `canCreateRows` and `canDeleteRows`. All four exist on the port (`readonly` is the
     prompt's spelling of `!writable`), and the doc is the one that should gain the extra three: a grid that
     cannot create rows must not show an "add row" affordance.
  2. **`PropertySchema` was never defined in the docs.** The port declares it as `{ fields: ResolvedField[] }`,
     reusing the type the rest of the core speaks, rather than inventing a second column shape.
  3. **The doc's `flush(): Promise<void>` is implemented as `Promise<FlushResult>`** — a flush that cannot say
     what it wrote or what failed would force every caller to keep a parallel log.

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

- Next step: `prompts/step-13-tabula-adapter-and-migration.md` — the `.tabula` reader (`v1` and `v2` detected
  from content, never throwing, tolerant of BOM/CRLF/unknown types), the dry-run report as data, and
  `migrateMutation` as ordinary ops so a whole migration is one undo step. Seven committed fixtures under
  `tests/fixtures/tabula/`. Known blocker: the fork clone (`258044aamm-Dev/airtable-tabula`) is needed for the
  on-disk shapes and is not in the workspace after the sandbox recycle — it needs re-cloning or the shapes
  come from the table recorded in this file.

- Files touched in **step 11**: new — `src/adapters/{RowSource,writeQueue,optimistic}.ts`,
  `tests/unit/write-queue.test.ts`; changed — `PROGRESS.md`. Nothing outside `src/adapters/**`,
  `tests/**` and `PROGRESS.md`.
- Earlier step 10 files: new — `spike/bases-path/{manifest.json,main.ts,write-test.ts,tsconfig.json,build.mjs,README.md,FINDINGS.md}`;
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
