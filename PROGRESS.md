# PROGRESS

- Milestone: M0 — Foundation (complete) · M1 — Core domain (complete) · M2 — Data layer (complete) ·
  **M3 — Grid v1 (in progress)**
  Branch: main
- Last completed step: **step 19 — the keyboard, the focus contract and the accessible names.** One `keydown`
  listener on the grid root in the capture phase, a declared event → intent table, a roving `tabindex` that
  leaves **exactly one** element tabbable, one polite live region, the ARIA roles built by functions instead of
  spread into three components, and a keyboard help surface that renders the binding list itself — one row per
  binding, no prose. Two real product bugs were found by the end-to-end test rather than by reading: React's
  `onFocus` is `focusin` (it bubbles), so the grid re-focused the active cell for *any* focus inside it and every
  freshly mounted editor was blurred the instant it opened; and a handled keystroke could reach the surface it
  had just opened. 1140 tests, 36 files; `eslint .` 0 errors, 0 warnings.

- Before that: **step 18 — the cell editors: one per type, behind one registry, committing through
  the store.** Nothing writes per keystroke: a cell edit ends in exactly one `setCell`, one queued batch and one
  undo step, and a value the column cannot read is refused on screen rather than guessed at. The registry keys
  on the **descriptor's declared editor id**, so this step never branches on a type and the mapping is one
  table. `editSession.ts` is the state machine behind it (idle → editing → committing → idle) and it is tested
  without React. 1049 tests, 32 files.

- Before that: **step 17 — the grid view: one scroller, three sticky lanes, and a windowed row lane.**
  Rows live inside the one scroller as a windowed layer; the header, the frozen column and the corner are
  layers outside it, moved only by a transform the scroll frame writes. The window runs over lane items, so
  groups cost no second arithmetic; `pinnedPrimary` is the pane's answer and below 600 px nothing is pinned.
  1015 tests, 30 files.

- Before that: **step 16 — the UI store, its selectors, and the command layer.** Everything that mutates the
  grid goes through one hand-rolled store on `useSyncExternalStore` — no state library, no context for cell
  data, no `useReducer`. One user action is one `history.push`, one undo step and one queued batch; the four
  **Tier 3** rules from `docs/07` are asserted with measured numbers (a keystroke = **three renders out of 181
  mounted components**, zero renders of the other 178). `react`/`react-dom` 19.3.0 became real dependencies
  there; the bundle stayed byte-identical because nothing imported them yet — **step 17 is the step that
  changed that**.

- Before that: **step 15 — the stylesheet foundation: tokens, brand layer, grid layout, and the two
  styling gates.** `src/styles/tokens.css` owns every value in three marked zones (identity → semantic →
  host); `brand.css` spends the accent and sizes the wordmark's slot; `grid.css` is layout only and states
  the measurement behind each block. `styles.css` at the root is now a **built** artefact — esbuild bundles
  the three files through `src/styles/index.css` — and `bun run check` gained `contrast` and `css:gate`
  after `build`, both also in CI. 959 tests, 25 files; `eslint .` still 0 errors, 0 warnings.

- Before that: **step 14 — the settings schema, its persistence, and the real settings tab.**
  One schema file is the only place a setting is described; `data.json` is read by a validator that defaults
  what it cannot read and keeps what it does not know; the save path debounces, writes only on a real change,
  and never writes the passthrough keys it did not come up with. The tab is Obsidian 1.13's **declarative**
  surface (`PluginSettingTab.getSettingDefinitions()`), which resolves the lint warning that has been standing
  since step 04 — `eslint .` is now **0 errors, 0 warnings** for the first time.

- Last completed step before that: **step 13 — the `.tabula` reader, the dry run and the migration.** A legacy
  `.tabula` file is read into a neutral, read-only model (v1 and v2 detected from content, tolerant of
  BOM/CRLF/trailing space/zero rows/unknown types/orphaned option values, **never** throwing); the dry run
  turns it into a report a dialog can show; the migration is ordinary ops — one `importBlock` per table, one
  `setFieldOptions` per options column, one `setViewConfig` per view — so the whole thing is **one undo step**
  and the `.tabula` bytes are untouched. Seven committed fixtures, 6 snapshots of the parse result and 6 of the
  report.

- Before that: **step 12 — `BasesSource`, the real Bases view, and note creation.** Rows
  and values come from a real Bases view (keyed by `entry.file.path`), edits go out through step 11's queue,
  and the optimistic overlay is what the grid reads in between. The whole **data path is ASSUMED**: there is no
  real vault here, and the step's real-vault observation is not produced (see the step-12 block below).

- Last completed step before that one: **step 11 — the `RowSource` port, the write queue and the optimistic
  overlay.** The layer that makes editing a note-backed grid safe: coalescing per file+property, one
  `processFrontMatter` call per file per flush, a promise chain per file so two writers never overlap, a
  250 ms debounce with a `flush()` that bypasses it, per-file failure reporting, and an overlay that holds
  pending values only.

---

**Step 19 — the keyboard, the focus contract and the accessible names.**

- Verified (`bun run check` — raw, exit 0): `tsc --noEmit` clean; `eslint .` **0 errors, 0 warnings**;
  `brand-gate: OK — 61 permitted match(es), 0 violations`; `manifest:check: OK`; Prettier clean;
  **1140 tests across 36 files** (was 1049 / 32: +91 tests, +4 files — `tests/unit/keyboard-table.test.ts` 32,
  `tests/unit/keybindings-match.test.ts` 30, `tests/dom/focus-contract.test.tsx` 10, `tests/dom/keyboard.test.tsx`
  19); `contrast: OK — all 32 gated checks pass (light, dark)`; `css-gate: OK — 4 file(s) under src/styles,
  18112 bytes of built styles.css, no bang-important, 51 colour literal(s) all inside the identity layer,
  170 token declaration(s), no percentage or viewport heights`; `bundle-size: OK` —
  `main.js raw 360309 bytes (351.86 KB)` / `gzip 111910 bytes (109.29 KB)`.

- **The keyboard is one listener, one table, and one decision.** `src/grid/keyboard/handler.ts` attaches a single
  `keydown` listener to the **grid root, in the capture phase**: capture because the grid has to see `Tab` and
  `Enter` before an open editor consumes them (the commit-and-move follow-up lives here, not in each editor), one
  listener because a listener per cell is a leak dressed as locality. It ignores composition (`isComposing`, key
  `Process`) so an IME is never half-eaten, stands down on `contentEditable` targets, and calls
  `preventDefault` **only when the dispatcher said it handled the intent** — which is why `Cmd+C` still copies a
  selection of text today. `attachGridKeyboard(root, port)` is exported as a standalone so its attach/detach
  contract is testable without a grid, and `GridView` detaches it on unmount; there is **no** listener on
  `document` or `window` anywhere in `src/grid`.

- **The table is data, and the help surface is the same data.** `keyBindings.ts` (step 03) listed the bindings
  the docs name; `keybindings-match.test.ts` holds it against `src/grid/keyboard/keyTable.ts` — 26 rows of
  `{ id, keys, example, intent?, reason? }`, each row carrying a **real example event** so a test proves the row
  is not aspirational: the example is fed through the matcher and must resolve to that row's id. Escape, `F1`/`?`
  and the fill pair needed ids the spec does not enumerate, so **three ids were added to `keyBindings.ts`**
  (`escape`, `help`, `fill`) rather than invented in the table; the remaining four rows the keyboard genuinely
  cannot serve (`context-menu`, `resize-column`, `reorder-row`, `type-ahead`) are listed with their **reason** in
  `NON_KEYBOARD_BINDINGS`, and the match test requires every id to be in exactly one of the two lists. Wording
  is free; an action cannot quietly go missing.

- **The help surface is a table, not a page.** `src/plugin/help/KeyboardHelpModal.ts` is a real Obsidian `Modal`
  rendering `KEY_BINDINGS` — one `<tr>` per binding, no prose, no blurb — and the command keeps its step-03 id
  `open-keyboard-help`. The inline modal that had been sitting in `src/plugin/main.ts` since step 03 was
  deleted; `main.ts` now only wires the command to that class, and `src/grid/**` still never imports `obsidian`.
  Because `Modal` owns the focus trap and the scoped `Escape`, the grid hands the whole surface over and gets it
  back, which is the interaction `docs/04` §Accessibility asks for.

- **Accessibility was made assertable rather than asserted.** `src/grid/a11y/roles.tsx` builds the root, row and
  cell roles/ARIA in three small functions (`gridRoleProps`, `rowRoleProps`, `cellRoleProps`) that the components
  spread; the values are the ones the grid already rendered in steps 17–18, so nothing about the output changed —
  what changed is that a unit test can now name them. `cellTabIndex(active)` / `rootTabIndex(hasSelection)` are
  the roving model: the root is the tab stop while nothing is selected and the active cell takes it over after,
  so **exactly one element in the grid is ever tabbable** (asserted on the rendered DOM, `[tabindex="0"]` count
  = 1). `aria-activedescendant` is deliberately **not** used: `docs/04` says real focus moves.

- **Every move ends inside a mounted cell, including the ones that are 4,900 rows away.**
  `src/grid/keyboard/focus.ts` is the arithmetic: `revealOffset` inverts the windowing's own band
  (`clientHeight - headerHeight`, the rows may not draw under the header), `revealElement` moves the scroller by
  rect and never calls `scrollIntoView()` (which walks up Obsidian's own panes), `revealRowIndex` handles the
  cell that has **no element yet** — the caller waits one `requestAnimationFrame` for the window to catch up —
  and `focusCell` falls back to the root so a vanished row leaves the keyboard in the grid instead of on
  `document.body`. `revealOffset` is pure and unit-tested; the DOM half is asserted where it can be (jsdom
  measures nothing, and that limit is stated in the test file).

- **The focus contract, in one helper.** `src/grid/a11y/focusContract.ts` is a stack of open surfaces
  (`grid-popover`, `menu`, `dialog`, `help`) that **records the opener**, restores focus on close **only if focus
  was lost**, and never steals focus from a surface that opened in the meantime: closing a menu behind a dialog
  answers `kept`, and a second `Escape` is a no-op (`none`) rather than a second restore. A detached opener is
  never focused — that answers `lost` and the focus is left where the browser put it. The grid's own handler
  routes `Escape` to exactly one owner per surface kind, and the tests assert the ownership table is complete
  for every kind.

- **Announcements are the write report, not a guess.** `announcementOf({lastError, lastApply})` turns the store's
  last action into one sentence — *"3 cells updated in 3 notes"*, *"N cells updated, K read-only"*, or the
  failure reason — and the grid owns a single polite live region (`.tablify-live`, visually hidden, appended to
  `src/styles/grid.css`). One region, replaced text, no `role="alert"`: a screen reader hears the result of the
  operation the user just performed, once.

- **Two real product bugs, found by the end-to-end test rather than by reading, and both fixed in the source:**
  1. **`Enter` never opened an editor.** React's `onFocus` is `focusin`, which **bubbles**: the grid root's
     `onRootFocus` therefore fired for focus landing on the newly mounted input, asked for the active cell
     again, blurred the input, and the blur committed the empty draft — the editor closed the instant it opened.
     Instrumented until the sequence was plain (`openEditor → onActiveChange(ref)` then `ANNOUNCE null` one tick
     later). Fix: `if (event.target !== event.currentTarget) return;` in `onRootFocus`, with the bug recorded in
     the comment — this is the guard, not the theory.
  2. **The keystroke that opens a surface could reach it.** `handler.ts` now calls `stopPropagation()` after
     `preventDefault()` once an intent is handled, so the `Enter` that opens an editor cannot also be seen by the
     input that editor just autofocused.
  A third came out of making the step green: `onFinish` had been rewritten to hand focus to *whatever is active*,
  which is right after a commit key but wrong for the **double-click** path — an editor opened by double-click
  never selected its cell, so the focus fell to the root. `onFinish(ref)` now moves the grid only when a commit
  key was pressed **and** the grid has a selection; otherwise the cell the edit belonged to takes the focus back.

- **Selection semantics were verified rather than assumed** (a probe against a 3 × 4 grid drove this): a plain
  arrow moves anchor and focus together; `Shift+Arrow` extends and leaves the anchor where it was; the opposite
  arrow collapses the range back to a single cell. `PageUp`/`PageDown` move the active cell by a **measured**
  screen (`viewportHeight / rowHeight`) in **one** selection change, keeping the column.

- **Decisions taken inside this step, recorded rather than asked** (each is a doc-level question, none blocked
  the work):
  1. `Escape` closes the top surface and, with nothing open, **clears the selection** — the second half of the
     binding is new, and `docs/01` does not say it.
  2. **`Ctrl+R` is bound and is known to be claimed elsewhere.** The prototype's own help text promises
     `Ctrl+D` / `Ctrl+R` *and* `Alt+D` / `Alt+R`; the browser claims `Ctrl+D` (bookmark) and `Ctrl+R` (reload),
     and Obsidian's Electron shell claims `Ctrl+R` for *Reload app without saving*. The table therefore **leads
     with `Alt+D` / `Alt+R`** and accepts `Cmd/Ctrl+D` and `Ctrl+R` where they arrive. If the human wants one
     answer, delete the second half of the pair — the table row is the single place to change it.
  3. `Space` toggles a checkbox on a checkbox cell and **starts an edit** everywhere else (typing a space is a
     real thing a person does); `F2` opens an editor as `Enter` does; `Delete` and `Backspace` are the same key.
  4. `commit-move` is recorded, not dispatched: the editor commits, the grid listens, and only a **successful**
     commit moves the selection — a cancel must not move anything.
  5. `bulk-edit` (`Cmd/Ctrl+Enter`) writes the value to **every cell of the selection in one batch** through
     `setCells`, so it is one undo step, which is a stronger guarantee than the spec's "bottom-up" wording needs.
  6. The old note that "nothing accepts keyboard input yet" is gone from the help surface, because it is no
     longer true.

- Open questions for the human:
  1. **`docs/01` §"Core interaction model" does not enumerate `Escape`, `F1`/`?` or the fill pair.** The binding
     list in `src/plugin/help/keyBindings.ts` is now the fullest statement of the keyboard model in the repo, and
     it is the surface a user reads. Either promote it into the doc or accept the code as the source.
  2. **`Ctrl+R` / `Ctrl+D`** (above) — one decision, one line in the help table.
  3. (carried) `docs/04` §Touch's 44 × 44 floor vs §Mobile's 40 px row — answered for editors and again here for
     the 40 px editor row; the doc still states both without naming the exception.
  4. (carried) `docs/02` §Grid rendering's sticky-lane description; `docs/01` §undo; `docs/02` §Store's
     `Command`; `@standard-schema/spec`; `docs/04` §cell-rendering; `attachment` links; the layout guard;
     `docs/09` line 33.

- Next step: `prompts/step-20-pointer.md` — the pointer layer: `src/grid/pointer/{dragSession,resizeColumn,
  reorderColumn,reorderRow,fillHandle}.ts` (a 4 px threshold before a drag counts, pointer capture, one undo step
  per finished drag) plus the scrollbar dragging the prototype proved out.

- Files touched in **step 19**: new — `src/grid/a11y/{roles.tsx,focusContract.ts}`,
  `src/grid/keyboard/{focus.ts,handler.ts,keyTable.ts}`, `src/plugin/help/KeyboardHelpModal.ts` (the help surface
  the step-03 command now opens), `tests/unit/{keyboard-table,keybindings-match}.test.ts`,
  `tests/dom/{focus-contract.test.tsx,keyboard.test.tsx}`; changed — `src/plugin/help/keyBindings.ts` (the three
  added ids and `NON_KEYBOARD_BINDINGS`), `src/grid/GridView.tsx` (the keyboard block, the bulk-aware commit, the
  roving tabindex, the live region, the focus effect), `src/grid/rows/Cell.tsx` (the role builder and the roving
  `tabindex`; the frozen lane's cells are the same component and inherit both), `src/plugin/main.ts` (the inline
  modal deleted), `src/plugin/TablifyView.ts` (`onHelp`), `src/styles/grid.css` + the built `styles.css`
  (`.tablify-live`), `eslint.config.mts` (the two pure `tests/unit` modules and the dom tests, each with its
  reason), `tests/dom/editors.test.tsx` (`process` imported rather than used as a bare global),
  `tests/mocks/obsidian.ts` (`Modal` gained the virtual `onOpen`/`onClose` its real counterpart calls — without
  them a subclass's `onOpen` never ran, which is a double that lies), `PROGRESS.md`.

**Step 18 — the cell editors, the registry, and the edit session.**


- Verified (`bun run check` — raw, exit 0): `tsc --noEmit` clean; `eslint .` **0 errors, 0 warnings**;
  `brand-gate: OK — 61 permitted match(es), 0 violations`; `manifest:check: OK`; Prettier clean;
  **1046 tests across 32 files** (was 1015 / 30: +31 tests, +2 files — `tests/dom/editors.test.tsx` 20 and
  `tests/unit/edit-session.test.ts` 14); `contrast: OK — all 32 gated checks pass`; `css-gate: OK — 17975 bytes
  of built styles.css, no bang-important, 51 colour literals in the identity layer, no percentage or viewport
  heights`; `bundle-size: OK` — `main.js raw 347516 bytes (339.37 KB)` / `gzip 107970 bytes (105.44 KB)`.

- **Two STOP-and-report clauses fired before any code was written, and both were answered by the human** (the
  prompts' gates, honoured rather than talked around):
  1. *"a per-type behaviour in `docs/01` is ambiguous about when a write happens (list the ambiguous types and
     your proposed rule, then wait)"* — `docs/01` §Core interaction model settles Enter/Tab/Space and nothing
     else, so **four** types had no documented write timing: `date`/`datetime`, `rating` reached by arrow keys,
     `multiSelect`, and `longText` (where the prompt and the prototype disagreed outright). The answers taken:
     · **date/datetime** — a pick in the native control commits immediately, and Enter/Tab/blur commit like any
       input: *choosing a day is a finished gesture*.
     · **rating** — **click only**. The prompt's arrow-key idea was **dropped**: `docs/01` gives the arrows to
       the grid (*Arrow keys — move active cell*) and a control that swallowed them would break the primary
       keyboard path in a cell nobody meant to edit. The star row is a `radiogroup` with real radios instead, so
       keyboard users still have a way in.
     · **multiSelect** — one write **per toggle**, list stays open (the prototype's behaviour; each toggle is its
       own undo step, which is what "I ticked three boxes" should mean).
     · **longText** — the **prototype wins over the prompt**: a popover with an explicit **Save**. An inline
       textarea in a 40 px row shows one line of a paragraph, and the row height may not grow to fit one.
  2. *"a native input cannot meet the 16 px / 44 px rules inside the documented row height"* — the numbers:
     `docs/04` §Touch wants ≥ 44 × 44 px and §Mobile fixes the medium row at 40 px, so the row axis is **4 px
     short** and no input can meet both. Answer: **accept 40 px on the row axis** (the editor fills the row's own
     `--tablify-row-h`, never a percentage), keep every other control on the `--tablify-tap` token, and record
     the exception here. The same 40-vs-44 tension was flagged for the gutter in step 17; both are this one
     decision.

- **The registry keys on the declared editor id, not the type.** `FieldDescriptor.editor` already says what a
  column wants, and ten ids cover sixteen types: `text` ×4 (text/url/email/phone), `longText`, `number` ×4
  (number/currency/percent/duration), `date` ×2 (date/datetime), `checkbox`, `rating`, `select`, `multiSelect`,
  `attachment`, and `readonly` — which resolves to `null`, the same answer a `readOnly` column gets
  (*disabled cells with a tooltip, never editable inputs that silently discard input*, `docs/01` §Editing). An
  unknown id falls back to the **text** editor, because that is the only failure that cannot lose data.

- **The editor inventory, as built** (type → component → commit trigger → cancel trigger):
  | Type(s) | Component | Commit | Cancel |
  |---|---|---|---|
  | text, url, email, phone | `TextEditor` | Enter, Tab, blur | Escape |
  | longText | `LongTextEditor` (popover) | **Save** | Escape, press outside |
  | number, currency, percent, duration | `NumberEditor` | Enter, Tab, blur — **only if the column parses it** | Escape |
  | date, datetime | `DateEditor` | a pick (`change`), Enter, Tab, blur | Escape |
  | checkbox | `CheckboxEditor` | using the control (Space, Enter, click) | — nothing to abandon |
  | rating | `RatingEditor` (popover) | clicking a star (the same star clears) | press outside |
  | singleSelect | `SelectEditor` (popover) | choosing (the same option clears) | Escape ×2, press outside |
  | multiSelect | `SelectEditor` (popover) | each toggle | Escape ×2, press outside |
  | attachment | `AttachmentEditor` (popover) | Enter, Tab, blur | Escape |

- **The edit session is a state machine, and that is where the bugs would have been.** `editSession.ts` has no
  React and no DOM: `open()`, `update()`, `commit()`, `cancel()`, `escape()`, and a state a test reads. The three
  rules it makes true, each asserted in `tests/unit/edit-session.test.ts`:
  · a commit that fails (a parse refusal *or* a store refusal) **keeps the editor open with the draft and the
    reason on screen** — a value silently lost is the worst bug this grid can have;
  · opening a second cell **commits** the first (`docs/01`: *Enter — edit the cell; committing moves down one
    row*; *Tab — commit and move right* — leaving a cell by the grid's own navigation is a commit), and if the
    first commit fails, the first editor stays and the second cell does not steal it;
  · `Escape` **closes a nested option list first** and cancels the editor second — the session's `escape()`
    answers which of the two it did (`closedList` / `cancelled` / `none`).

- **The paste-tolerance cases, through the whole chain** (`tests/dom/editors.test.tsx`, each asserted against the
  fake source's own table): `1,200` → **1200**; `25%` → **25** (`docs/03`: *25 means 25%*); `45m` → **2700 s**;
  `1:30` → **5400 s** (clock-style is always `h:mm(:ss)`); `"1,200"` typed into a **text** column → the literal
  string `"1,200"`; and `12 apples` into a number column → **no write at all**, with the refusal on screen and
  the draft intact. The last one is the case the prototype's audit is about: a parse that guesses is worse than
  a parse that refuses.

- **One architectural amendment, recorded because it is outside the step's file fence.** The step asks for
  `tests/unit/edit-session.test.ts`, and this repo's eslint boundary says *only `tests/dom` may import
  `src/grid`*. The prompt won, narrowly: `eslint.config.mts` grows one `ignores` entry for exactly that file, with
  the reason in the comment (`src/grid/editSession.ts` is a pure module — no React, no DOM, no `obsidian`). The
  rule itself is unchanged for every other file, and `tests/unit/boundaries.test.ts` still proves it bites.

- **What is declared vs what is measured, stated honestly.** `docs/04` §Touch/§Mobile rules are asserted as
  **declarations** read out of `src/styles/grid.css` (16 px floor on every text entry; `--tablify-tap` on the
  rating stars, list rows, search field and popover actions; the editor on the row axis using
  `var(--tablify-row-h)`, never a percentage). jsdom resolves no stylesheet, so a **measured** box is not
  something this step can produce — that is step 21's harness, and this file says so where it asserts.

- Bug found by the tests while building this step: the fixture resolved **every** column to the text descriptor,
  because `fieldOptions.type` was passed on the *context* instead of on the **property** — `resolveField`
  validates `property.fieldOptions`. The symptom was subtle (all eight editors were text inputs and the run
  looked half-green); the fix is one comment in the fixture.

- Open questions for the human:
  1. **`docs/01` still has no §editing paragraph** for the four types this step had to decide (date/datetime
     write timing, rating keys, multiSelect writes, longText surface). The decisions are implemented and
     recorded here; the doc they belong in is still silent, and step 22 (clipboard/fill) and step 23 (undo/bulk)
     will both read it.
  2. **`docs/04` §Touch's 44 × 44 floor vs §Mobile's 40 px row** — now answered for editors ("accept 40 on the
     row axis"), and the same answer should be written into `docs/04` so the gutter, the editors and step 19's
     key targets stop being three separate rediscoveries of it.
  3. (carried) `docs/02` §Grid rendering's sticky-lane description; `docs/01` §undo; `docs/02` §Store's
     `Command`; `@standard-schema/spec`; `docs/04` §cell-rendering; `attachment` links; the layout guard;
     `docs/09` line 33.

- Environment caveat worth keeping: `tests/fixtures/tabula/crlf-bom.tabula` lost its BOM **between runs** this
  session — not by any gate stage (`format`, `format:check`, the test run and every other stage were each run
  and each left it intact), so it is the workspace snapshot, not the build. CI checks out from git and is
  unaffected. If `tabula-parse` reports `123 vs 65279`, `git checkout --` that fixture and re-run; never "tidy"
  it.

- Next step: `prompts/step-19-keyboard-and-a11y.md` — the grid's own keyboard layer
  (`src/grid/keyboard/{handler,focus}.ts`): one `switch (event.key)`, no `document`/`window` listeners, the key
  table matching `src/plugin/help/keyBindings.ts`, roving `tabindex` (exactly one cell tab-reachable — the
  cells are already `tabIndex={-1}`, which is the half of it step 18 needed), and the keys that **open** an
  editor (`Enter`, typing on an unfocused cell, `Space` on a checkbox) plus the movement after a commit that
  step 18 deliberately left here.

- Files touched in **step 18**: new — `src/grid/editSession.ts`, `src/grid/editors/{registry.tsx,Popover.tsx,
  useEditState.ts,useEditorKeys.ts,TextEditor.tsx,LongTextEditor.tsx,NumberEditor.tsx,DateEditor.tsx,
  CheckboxEditor.tsx,RatingEditor.tsx,SelectEditor.tsx,AttachmentEditor.tsx}`, `tests/dom/editors.test.tsx`,
  `tests/unit/edit-session.test.ts`; changed — `src/grid/rows/{Cell,Row}.tsx` (the registry replaces the
  placeholder editor; a double-click opens it; `tabIndex={-1}`), `src/grid/FrozenColumn.tsx`,
  `src/grid/GridView.tsx` (the session, the descriptor parse, focus return, the popover host), `src/styles/grid.css`
  (editor, popover and star rules — each with the rule it implements), `eslint.config.mts` (the one documented
  exception above), `PROGRESS.md`.

**Step 17 — the grid view: one scroller, three sticky lanes, and a windowed row lane.**

- Verified (`bun run check` — raw, exit 0): `tsc --noEmit` clean; `eslint .` **0 errors, 0 warnings**;
  `brand-gate: OK — 61 permitted match(es), 0 violations`; `manifest:check: OK`; Prettier clean;
  **1015 tests across 30 files** (was 992 / 28: +23 tests, +2 files — `tests/dom/gridview.test.tsx` 12 and
  `tests/dom/measure.test.ts` 11); `contrast: OK — all 32 gated checks pass (light, dark); 0 host gap(s),
  3 host pair(s) below our minimums`; `css-gate: OK — 4 file(s) under src/styles, 14487 bytes of built
  styles.css, no bang-important, 51 colour literal(s) all inside the identity layer`; `bundle-size: OK` —
  `main.js raw 334989 bytes (327.14 KB)` / `gzip 104325 bytes (101.88 KB)`, and the growth is exactly the
  point: React is now **imported** by the grid, so React is in the bundle (~260 KB raw, ~80 KB gzip of it).
  The ceilings (900 KB / 300 KB) were chosen for this.

- **The DOM contract, as built.** One scroller (`.tablify-scroller`), and rows **inside** it as a windowed
  layer: `.tablify-canvas` is `width/height = content`, `.tablify-rows` sits at `top: headerHeight` and is
  moved by `translateY(window.offsetY)`. The browser scrolls the rows natively — wheel, trackpad, touch pan,
  momentum and `PageDown` are all the platform's. Header, frozen column and corner are layers **outside** the
  scroller, moved only by `syncScroll` (`header translateX(-scrollLeft)`, frozen
  `translateY(headerHeight - scrollTop)`). That is the prototype's geometry (`prototype/js/grid.js`), and it
  is what step 17's prompt asks for; the alternative — a lane outside the scroller whose rows are simulated —
  is what makes a grid feel wrong on a trackpad.

- **Windowing runs over lane items, not rows.** `selectLaneItems(snapshot)` returns `LaneItem[]`
  (`kind: 'group' | 'row'`, each with its own `index`; row items carry `rowIndex`), and every item is exactly
  `--tablify-row-h` tall — a group header included. So grouping costs no second mapping between a scroll
  offset and an index: `rowWindow` windows over `items.length`, and `selectLaneSlice` slices the same array.
  A collapsed group is not in `snapshot.rows` at all, so the window never has to skip anything.

- **Pinning is one derived value, and it is the pane's answer.** `usePinnedPrimary(area, desired, initialWidth)`
  re-renders **only when the answer flips** (a sidebar drag fires the observer continuously and changes the
  answer once), and `pinnedPrimary(desired, paneWidth)` is a pure function asserted at 900 / 600 / 599 / 389 px.
  When pinned: the row lane draws `columns.slice(1)` with `columnOffset = 1`, the frozen lane draws
  `columns.slice(0, 1)` **through the same `Row` component**, and the gutter moves to the frozen lane. When
  not pinned there is no frozen lane and no corner at all, and the gutter rides the scrolling lane — §P21,
  which is why a 389 px pane shows every column instead of spending a third of its width on row numbers.

- **Two real bugs, found by the new tests, fixed in place.**
  1. **A view-config op never reached the pipeline.** `rebuildView()` passed the module-level `view` binding
     (`options.view`) into `buildView`, while `setViewConfig` — an op like any other — updates
     `TableState.view`. Result: a search typed in the toolbar, a sort, or a group-by was *stored* and never
     *applied*. Caught by the first two tests that build a scenario through the command layer
     (`search: 'nothing matches this'` matched 30 of 30 rows). Fix: `rebuildView` adopts `table.view` as
     authoritative. The old binding now has exactly one job — seeding the initial state.
  2. **Pinning flipped off on an unmeasurable pane.** `usePinnedPrimary`'s first effect read
     `paneWidthOf(element)`, which is `0` in jsdom, in `display: none`, or on a frame that has not been laid
     out — and `0` is not a narrow pane, it is *no answer*. Fix: a non-positive measurement is a no-op, and the
     width handed in before the first paint stays the answer until a real one arrives. This is the same rule
     the row window already followed ("an unmeasured pane must show something").

- **The view is real.** `src/plugin/TablifyView.ts` now mounts `GridView` over a `BasesSource`, measures its
  container **before** the first paint and passes `initialPaneWidth`, keeps the DOM-less placeholder path
  (`render()`) for environments without a `document`, and still owns every Obsidian call the plugin makes
  (`config`, `data`, `onDataUpdated`, `createFileForView`, `processFrontMatter`, `metadataCache` +
  `offref`) — with the same `watch`-based external-change path step 12 established, filtered to the rows this
  view is showing. "New row" is bases' own new-note menu (`createFileForView()`); the grid never invents a
  file path. `dispose()` unmounts the React root, clears subscriptions and disposes the store and the source.

- **Measured, in jsdom (and labelled as jsdom).** Deterministic window: 30 configured rows, **9 mounted**
  (`rowWindow({scrollTop: 0, viewportHeight: 0, rowHeight: 40, rowCount: 30})` → `0 … 9`), the rest of the
  lane existing only as canvas height; **5,000 rows × 20 columns mount in 228 ms** with **180 cells** in the
  DOM (`9 × 20`, split 19 + 1 across the two lanes), on **Intel(R) Xeon(R) @ 2.60 GHz, 2 vCPU, 1 GB RAM**;
  **one edit changes one cell's text** (before/after comparison of every mounted cell, not a render count).
  The browser-truth measurements this step's prompt asks for — the real host's padding box at 900 / 600 /
  389 px, the cost of a 2,000 px scroll, and a first-paint timing a user would feel — are **not claimed here**:
  jsdom has no layout and its scroller cannot be scrolled (CSSOM answers 0 without a layout box), so producing
  those numbers now would be fabrication. They are step 21's harness, which is where the prompt puts them,
  and the six numbers above are what this step can prove without a browser.

- **One hand-off deliberately not made.** `TablifyView` accepts an optional `SettingsStore` and reads
  `appearance.defaultRowHeight` for the grid's density, but `src/plugin/main.ts` does not pass it yet: the view
  registration (line ~69) happens **before** the settings store is constructed (line ~114), and `main.ts` is
  outside this step's file fence. So an open view currently renders at the `medium` default until that one line
  is added — recorded here rather than quietly widening the fence.

- Design decisions taken, with the contract line each one serves:
  1. **The gutter is 74 px of the row, and its checkbox label is as tall as the row** (40 px medium), because
     `docs/04` §Touch asks for 44 × 44 targets and §Mobile fixes the medium row at 40 px — the two cannot both
     hold inside a row. The label is the target and takes `var(--tablify-row-h)`, never a percentage, so the
     resolution is visible in one line and can be revisited without hunting for it.
  2. **No percentage heights anywhere**, which the CSS gate enforced the moment the first one appeared
     (`height: 100%` on two inner labels): the grid is the one element in the app that may not negotiate its
     own height, and the gate is the reason that rule survives contact with a stylesheet.
  3. **`.tablify-rows .grid-row { position: relative }`** — every row stretches to the lane's `max-content`
     width, which is what keeps the columns of two different rows in line, and the pending accent is placed
     against the row's own edge.

- Open questions for the human:
  1. **The gutter's 44 × 44 target** (`docs/04` §Touch) cannot be met inside a 40 px row. Options: accept the
     row-height label (current), make the checkbox column 44 px wide and rely on width alone, or raise the
     medium density to 44 px. The prototype's `GUTTER_W = 74` and the token table say 74 × 40; the doc's touch
     rule says 44 × 44. This wants a decision before step 20 (pointer) hardens the hit targets.
  2. **Should `main.ts` pass the settings store to the view** (the one hand-off above), and if so, is the
     right shape a lazy getter so the registration closure sees the later-constructed store?
  3. **`docs/02` §Grid rendering still describes the sticky lanes as if the rows were outside the scroller.**
     This step implements the geometry the prompt specifies (rows inside, lanes outside). Worth an amendment
     in `docs/02` so step 20's drag maths and step 21's harness read the same model.
  4. (carried) `docs/01` §undo, `docs/02` §Store's `Command`, the query-layer notes, `@standard-schema/spec`,
     `docs/04` §cell-rendering, `attachment` links, the layout guard, `docs/09` line 33.

- Next step: `prompts/step-18-cell-editors.md` — `src/grid/editors/{registry.tsx,editSession.ts}`: one editor
  per field type behind one registry, a session that opens on double-click/Enter/typing and commits on blur or
  Enter, **no write per keystroke** (the queue's 250 ms debounce is not a licence to write on every key), and a
  minimum 16 px text / 44 px target on touch. The three jsx/`.tsx` traps this step had to fix first
  (`tsconfig.json` `jsx` + include globs, `esbuild.config.mjs` `jsx: 'automatic'`, the vitest dom project's
  `.test.tsx` pattern) are already in place, so step 18 can just add the files.

- Files touched in **step 17**: new — `src/grid/{layout,measure,useWindow,usePinnedPrimary,GridView,Toolbar,
  StatusBar,Empty,Header,FrozenColumn,GroupHeader}.ts(x)`, `src/grid/rows/{Row,Cell}.tsx`,
  `tests/dom/gridview.test.tsx`, `tests/dom/measure.test.ts`; changed — `src/grid/store/{types,store,selectors}.ts`
  (`widths`/`widthsOf`, `laneItems`/`LaneItem`/`selectLaneItems`/`selectLaneSlice`/`useEditing`, the
  `rebuildView` fix), `src/plugin/TablifyView.ts`, `src/styles/grid.css` (the lanes, the gutter, a group header,
  the empty state's actions — each with the contract line it implements), `tsconfig.json` (`jsx`, `**/*.tsx`
  in `include`), `esbuild.config.mjs` (`jsx: 'automatic'`), `vitest.config.ts` (the dom project also collects
  `**/*.test.tsx`), `PROGRESS.md`. Nothing outside `src/grid/**`, `src/plugin/TablifyView.ts`, `tests/dom/**`,
  `src/styles/grid.css` and those three config files.

**Step 16 — the UI store, its selectors, and the command layer.**

- Verified (`bun run check` — raw, exit 0): `tsc --noEmit` clean; `eslint .` **0 errors, 0 warnings**;
  `brand-gate: OK — 61 permitted match(es), 0 violations`; `manifest:check: OK`; Prettier clean;
  **992 tests across 28 files** (was 959 / 25: +33 tests, +3 files, all of them this step's); `contrast: OK —
  all 32 gated checks pass (light, dark); 0 host gap(s), 3 host pair(s) below our minimums`;
  `css-gate — 4 file(s) under src/styles, 12711 bytes of built styles.css`; `bundle-size: OK` —
  `main.js raw 68920 bytes (67.30 KB)` and `gzip 21985 bytes (21.47 KB)`, **identical to step 15**.

- **React is a dependency and costs nothing yet.** `react` and `react-dom` **19.3.0** went into
  `dependencies` (a plugin bundles them; a devDependency would be a lie about what ships), with
  `@types/react` and `@types/react-dom` **19.3.0** in `devDependencies`. Installed beside TypeScript 5.8.3
  and `@types/node` 20.19.43 with **no peer warnings** — the prompt's STOP leg ("React's version constraints
  conflict with the step-01 pin") **did not fire**, and re-pinning React to a 19.0.x backport was not
  needed. The bundle delta is **0 raw / 0 gzip**: `bun install` pulled 443 packages, `bun.lock` grew 18
  lines, and esbuild bundles only what is imported — nothing imports `src/grid/**` yet. The number will move
  in step 17, when `GridView` is imported by the view for the first time, and that is the honest place for
  it to move.

- The four **Tier 3** rules, each with its measured number:

  | Rule (`docs/07` §Tier 3) | Test | Measured result |
  |---|---|---|
  | a keystroke re-renders the edited cell and nothing else | `tests/dom/store-render.test.ts` | **181 mounted components** (1 chrome + 60 rows + 120 cells); one keystroke re-renders **3** — the edited cell, its row, the status line — and **0** of the other 178. The write's confirmation renders the same 3 again, for the same one fact. |
  | selection survives a re-query; degrades to the nearest surviving row | `tests/dom/store.test.ts` | unchanged row set ⇒ the range is **deep-equal** after `notify()`; `Notes/003.md` removed from 8 rows ⇒ the range re-seats at **index 3 of the new order** (`Notes/004.md`), keeping its far corner; all rows gone ⇒ selection `null`; an edit target that leaves the view ⇒ `editing` `null`. |
  | undo of a 400-cell paste is **one** queued batch, and writes = distinct files | `tests/dom/store.test.ts` | paste 400 cells ⇒ **1 batch, 400 writes, 4 distinct files touched**; undo ⇒ **2 batches, 800 writes**, `canUndo` false after one undo, `canRedo` true. The step's label ("Paste 400 cells") is the one the menu will show. |
  | external change wins over a stale snapshot; deleted rows are not resurrected | `tests/dom/store.test.ts` | another writer's value wins on re-query; a pending value for a row deleted elsewhere is **dropped, never written, never shown** (pending 0); a value the source confirms first **settles without waiting for the queue**. |

- **The render-count rule is three renders, not one, and the code says so where it does it.** A keystroke is
  one fact that three surfaces display: the cell's text *and its pending ring*, the row's pending dot, the
  status line's count. Reporting "one render" would have been a lie that a later reader would have to
  un-learn. What the rule exists to protect — *the grid does not re-render* — holds exactly: 178 of 181
  components are not re-rendered, not even scheduled. Written on the test, the mechanism is that a cell
  subscribes to a `string` (`useCellDisplay`) plus a small object compared field by field (`useCellFlags`),
  so React's own `Object.is`/`isEqual` decides — a subscription fires, the value is unchanged, nothing
  renders.

- **The bug this step found is the one worth recording.** `bump()` (new revision, new snapshot, notify) was
  originally called *after* the narrow-channel notifications. React's `useSyncExternalStore` asks the store
  for its value **synchronously, inside the change handler**: woken before the new snapshot existed, it read
  the old one, found no change, and silently skipped the render — a selection that moved with nothing on
  screen moving with it. It took a jsdom render probe to see it. Fixed by making the order an explicit
  contract in the code (`bump()` first, then the narrow channels), which is now documented at `bump()`
  itself. The general rule: **notify after the state you are describing exists**, because a listener is
  allowed to read synchronously.

- The rest of the fixes this step made in its own fresh code, all found by its own tests: a value write now
  wakes its **row** channel as well as its cell (the row's `dirty` flag changes, and a row is notified once
  however many of its cells moved); an external `refresh()` wakes **every narrow channel**, because a vault
  change is genuinely unbounded and diffing the whole table to find out which cells moved costs more than
  waking the components that are mounted; and `setEditing` notifies **the two cells whose appearance
  changes** — the one that had the cursor and the one that took it.

- The window maths, as a table (14 tests). 100 rows of 40 px in an 800 px viewport, `OVERSCAN_ROWS = 8`:

  | `scrollTop` | `start` | `end` | why it matters |
  |---|---|---|---|
  | 0 | 0 | 28 | the first screen and its overscan |
  | 40 (one row) | 0 | 29 | a row straddling the bottom edge stays mounted |
  | 400 (mid-list) | 2 | 38 | overscan on both sides; the slice is `Notes/002.md` … `Notes/037.md` |
  | 3200 (the last screen) | 72 | 100 | the last screen whole, with no overscan past the end |
  | 999999 | 72 | 100 | **clamped to `totalHeight − viewportHeight`**, never a blank grid |
  | −500 | 0 | 28 | clamped to the top |
  | 0, 3 rows | 0 | 3 | fewer rows than one screen |
  | 0, 0 rows | 0 | 0 | an empty view mounts nothing and reports no scroll range |
  | 0, viewport 0 | 0 | 9 | an unmeasured pane still mounts the first row — the failure mode this rule prevents |

  Densities are **short 32 / medium 40 / tall 64**, from `docs/02` §row windowing; `rowIndexAt` answers the
  row under a y offset and `null` past either end.

- The `getSnapshot` identity assertion the prompt asks for: two reads with nothing in between return the
  **same object** (and re-selecting the already-active cell is not a change — **0 notifications**, same
  object); after a change the object is replaced once and its `revision` is `previous + 1`, and the new
  object is then stable in turn.

- **One number in `tokens.css` was wrong and is corrected here: `--tablify-row-h-tall` 52 px → 64 px.** The
  window maths is arithmetic on a fixed row height, and the CSS is what draws it; if the two disagree, every
  mounted row drifts against the scroll position by the difference. Three sources say 64 (`docs/02`
  §row windowing, `PLAN-ui-ux-pass.md` §spacing, and `window.ts`), so the CSS was the outlier — a
  transcription slip in step 15. The fence for this step does not list `src/styles/**`; it is edited anyway,
  because shipping a grid whose maths and styles disagree is not an option, and a 12 px-per-row drift is a
  bug that would have been blamed on the renderer in step 17.

- `tests/dom/`, not `tests/unit/`, and the architecture made that choice, not convenience:
  `eslint.config.mts` forbids `tests/**` outside `tests/dom/**` from importing `src/grid/**` ("it needs a
  DOM and React"). The window maths has no DOM in it, but the grid is one module with one test home, so all
  three new test files live there. `tests/fakes/rowSource.ts` stayed in `tests/fakes/` because it imports
  only `src/adapters` and `src/core` — a fake of a port, not of the grid.

- ASSUMED, stated as such:
  1. **"jsdom renders" is not "a browser paints".** The render counts are React's own scheduling decisions,
     measured in jsdom. What a browser then does with them (paint, compositing) is step 21's Playwright
     harness, and no number in this step claims to be a paint measurement.
  2. **The store has no user.** Nothing in `src/plugin/**` imports `src/grid/**` yet, so every rule here is
     asserted against tests and not against a running view; step 17 is the first real caller.
  3. **`RowSource` is the fake, not a vault.** Rule 4 ("external change wins") is exercised through
     `tests/fakes/rowSource.ts`'s `notify()`, which is what a real vault watcher would do — not against a
     real vault. There is no real vault here (carried forward from step 12).

- Open questions for the human:
  1. **Should the status line really wake on every keystroke?** It shows a pending count, so today it does.
     A cheaper rule would be to let the cell and the row carry the "unsaved" signal while editing, and have
     the status line report only the *settled* count — one fewer render per keystroke, at the cost of the
     count lagging a beat behind. The test asserts 3 renders either way, so it is a one-line change.
  2. **`selectStatusSummary` returns a fresh object**, so it needs `useStoreSelector(…, isEqual)`; there is
     no shallow comparator exported yet. The status bar in step 17 will want one — export it from
     `selectors.ts`, or give the summary a revision-stamped identity?
  3. (unchanged) **Twelve settings defaults are choices, not quotations** (step 14's table);
     **does anything ever write `.tablify/migrations/<timestamp>.json`?**; `docs/01` §undo; `docs/02`
     §Query vs step 08; the three step-10 `FINDINGS.md` corrections; **twelve `docs/04` geometry numbers**
     (step 15's three open questions).

- Next step: `prompts/step-17-grid-components.md` — `GridView`, the `useWindow` hook, `rows/{Row,Cell}`,
  `Empty`, and `pinnedPrimary` (pinned only at ≥ 600 px of pane, `ResizeObserver`-driven). **Before writing
  any component:** `tsconfig.json` `include` has **no `.tsx`** glob — it must gain `src/**/*.tsx` and
  `tests/**/*.tsx` first, or `tsc` will silently skip every component file the step creates.

- Files touched in **step 16**: new — `src/grid/store/{types,window,store,selectors,commands}.ts`,
  `tests/fakes/rowSource.ts`, `tests/dom/{window-math,store,store-render}.test.ts`; changed — `package.json`
  and `bun.lock` (React 19.3.0, the step's declared dependency decision), `src/styles/tokens.css` (one
  number: `--tablify-row-h-tall` 52 → 64 px, justified above), `PROGRESS.md`. Nothing outside
  `src/grid/**`, `src/styles/tokens.css`, `tests/**`, `package.json`, `bun.lock` and `PROGRESS.md`.

---

**Step 15 — the stylesheet foundation: tokens, brand layer, grid layout, and the two styling gates.**

- Verified (`bun run check` — raw): `tsc --noEmit` clean; `eslint .` **0 errors, 0 warnings**;
  `brand-gate: OK — 61 permitted match(es), 0 violations`; `manifest:check: OK`; Prettier clean;
  **959 tests across 25 files** (was 948 / 24: +11 in `tests/unit/tokens.test.ts`); `bundle-size: OK` —
  `main.js raw 68920 bytes (67.30 KB)` **unchanged to the byte**, i.e. the whole step ships zero JavaScript;
  `styles.css !important check: clean`; then the two new gates — `contrast: OK — all 32 gated checks pass
  (light, dark)` and `css-gate: OK — no bang-important, 51 colour literal(s) all inside the identity layer`.
  `styles.css` is **12711 bytes (12.41 KB)** minified, generated by `node esbuild.config.mjs production`.

- How `styles.css` is assembled (the choice the step asked to make and state): **esbuild bundles it**, it is
  not a runtime `@import`. `src/styles/index.css` is the entry — `@import './tokens.css'; @import
  './brand.css'; @import './grid.css';` in that order, which *is* the cascade — and the build resolves the
  three into one file. A runtime `@import` would have been the smaller diff and the wrong one: Obsidian
  loads exactly three assets (`main.js`, `manifest.json`, `styles.css`), so a shipped stylesheet that asked
  for `./tokens.css` would ask a user's install for a file that is not there. `esbuild.config.mjs` now holds
  two contexts (JS and CSS), both in watch mode for `bun run dev`. `styles.css` joined `main.js` in
  `.prettierignore` (it is a build artefact now), and `release-assets.ts` already ships it.

- The token inventory — **170 `--tablify-*` declarations, 101 unique names**, and **zero declarations
  anywhere else in `src/styles/**`** (asserted by `css-gate`, and by `grep -rl -- '--tablify-.*:'` returning
  `tokens.css` and nothing else):

  | Zone | Declarations | Unique | What it holds |
  |---|---|---|---|
  | identity (light, dark) | 51 | 30 | the palette: 17 hues + 9 option hues + selection/overlay/shadow × 2 modes |
  | semantic (+ motion, space, type, geometry) | 73 | 73 | the vocabulary: surfaces, rules, text, accent, status, numerals, star, toast; 12 motion, 8 spacing, 3 radii, type scale, 13 geometry/layout |
  | host (`body.tablify-host-theme`) | 31 | 31 | every surface that has an Obsidian variable, plus its radii and font sizes |
  | the two media blocks | 15 | 15 | 11 durations zeroed by reduced motion, 4 tokens firmed up by `prefers-contrast: more` |
  | **total** | **170** | **101** | |

- The zones are **marker comments** (`@identity begin/end`, `@semantic begin/end`, `@host begin/end`), and
  all three readers — the gate, the contrast gate, the test — read them. That is the design decision of
  this step worth keeping: a marker rename fails three independent checks instead of silently turning them
  into no-ops. `css-gate` also fails when `tokens.css` has **no** identity zone, so "the palette is nowhere"
  cannot pass as "the palette is fine".

- The colour rule, as implemented: a literal may appear **only** inside an identity zone, and an identity
  zone may appear **only** in `tokens.css`. Everything else — brand.css, grid.css, and every later
  component file — asks for a token. The one number for it: **51 lines of literals, all inside the identity
  layer, 0 outside.** Three probes were run to prove the gate bites rather than to trust it (below).

- `bun run contrast` — the full table. Gated modes are light and dark (our palette); the host columns are
  reported, because the fixture theme's values are not our responsibility, while *resolution* in host mode
  is gated (an unresolved pair means the host block forgot a variable):

```

  Tablify contrast gate — 19 declared pairs × 4 modes
  gated: light, dark — our palette · reported: host-light, host-dark — the fixture theme
  tokens read: 101 in light, 101 in dark, 101 in host mode

  pair                                               mode        ratio   min   result
  ─────────────────────────────────────────────────────────────────────────────────────
--tablify-text on --tablify-surface                light       14.30   4.5   ✓
--tablify-text on --tablify-surface                dark        13.78   4.5   ✓
--tablify-text on --tablify-surface                host-light  12.72   4.5   ✓ (reported)
--tablify-text on --tablify-surface                host-dark   12.26   4.5   ✓ (reported)
--tablify-text-muted on --tablify-surface          light       5.47    4.5   ✓
--tablify-text-muted on --tablify-surface          dark        7.35    4.5   ✓
--tablify-text-muted on --tablify-surface          host-light  5.08    4.5   ✓ (reported)
--tablify-text-muted on --tablify-surface          host-dark   7.91    4.5   ✓ (reported)
--tablify-text on --tablify-surface-raised         light       15.15   4.5   ✓
--tablify-text on --tablify-surface-raised         dark        12.73   4.5   ✓
--tablify-text on --tablify-surface-raised         host-light  11.66   4.5   ✓ (reported)
--tablify-text on --tablify-surface-raised         host-dark   11.13   4.5   ✓ (reported)
--tablify-text-muted on --tablify-surface-raised   light       5.79    4.5   ✓
--tablify-text-muted on --tablify-surface-raised   dark        6.79    4.5   ✓
--tablify-text-muted on --tablify-surface-raised   host-light  4.65    4.5   ✓ (reported)
--tablify-text-muted on --tablify-surface-raised   host-dark   7.18    4.5   ✓ (reported)
--tablify-accent on --tablify-surface              light       5.55    3     ✓
--tablify-accent on --tablify-surface              dark        5.71    3     ✓
--tablify-accent on --tablify-surface              host-light  4.80    3     ✓ (reported)
--tablify-accent on --tablify-surface              host-dark   4.58    3     ✓ (reported)
--tablify-accent-text on --tablify-accent          light       5.98    4.5   ✓
--tablify-accent-text on --tablify-accent          dark        5.71    4.5   ✓
--tablify-accent-text on --tablify-accent          host-light  4.80    4.5   ✓ (reported)
--tablify-accent-text on --tablify-accent          host-dark   4.58    4.5   ✓ (reported)
--tablify-number on --tablify-surface              light       6.83    4.5   ✓
--tablify-number on --tablify-surface              dark        9.20    4.5   ✓
--tablify-number on --tablify-surface              host-light  5.08    4.5   ✓ (reported)
--tablify-number on --tablify-surface              host-dark   7.91    4.5   ✓ (reported)
--tablify-toast-fg on --tablify-toast-bg           light       15.15   4.5   ✓
--tablify-toast-fg on --tablify-toast-bg           dark        12.73   4.5   ✓
--tablify-toast-fg on --tablify-toast-bg           host-light  12.72   4.5   ✓ (reported)
--tablify-toast-fg on --tablify-toast-bg           host-dark   12.26   4.5   ✓ (reported)
--tablify-positive on --tablify-surface            light       5.44    4.5   ✓
--tablify-positive on --tablify-surface            dark        7.68    4.5   ✓
--tablify-positive on --tablify-surface            host-light  5.35    4.5   ✓ (reported)
--tablify-positive on --tablify-surface            host-dark   7.07    4.5   ✓ (reported)
--tablify-warning on --tablify-surface             light       5.49    4.5   ✓
--tablify-warning on --tablify-surface             dark        7.78    4.5   ✓
--tablify-warning on --tablify-surface             host-light  5.04    4.5   ✓ (reported)
--tablify-warning on --tablify-surface             host-dark   5.96    4.5   ✓ (reported)
--tablify-negative on --tablify-surface            light       6.83    4.5   ✓
--tablify-negative on --tablify-surface            dark        5.69    4.5   ✓
--tablify-negative on --tablify-surface            host-light  5.97    4.5   ✓ (reported)
--tablify-negative on --tablify-surface            host-dark   5.42    4.5   ✓ (reported)
--tablify-star on --tablify-surface                light       3.37    3     ✓
--tablify-star on --tablify-surface                dark        8.08    3     ✓
--tablify-star on --tablify-surface                host-light  5.04    3     ✓ (reported)
--tablify-star on --tablify-surface                host-dark   5.96    3     ✓ (reported)
--tablify-line-strong on --tablify-surface         light       3.67    3     ✓
--tablify-line-strong on --tablify-surface         dark        3.60    3     ✓
--tablify-line-strong on --tablify-surface         host-light  2.23    3     · below ours, the theme’s choice
--tablify-line-strong on --tablify-surface         host-dark   2.61    3     · below ours, the theme’s choice
--tablify-text-muted on --tablify-surface-sunken   light       5.02    4.5   ✓
--tablify-text-muted on --tablify-surface-sunken   dark        7.71    4.5   ✓
--tablify-text-muted on --tablify-surface-sunken   host-light  4.65    4.5   ✓ (reported)
--tablify-text-muted on --tablify-surface-sunken   host-dark   7.18    4.5   ✓ (reported)
--tablify-number on --tablify-surface-sunken       light       6.28    4.5   ✓
--tablify-number on --tablify-surface-sunken       dark        9.65    4.5   ✓
--tablify-number on --tablify-surface-sunken       host-light  4.65    4.5   ✓ (reported)
--tablify-number on --tablify-surface-sunken       host-dark   7.18    4.5   ✓ (reported)
--tablify-text-muted on --tablify-accent-subtle    light       5.07    4.5   ✓
--tablify-text-muted on --tablify-accent-subtle    dark        6.15    4.5   ✓
--tablify-text-muted on --tablify-accent-subtle    host-light  4.37    4.5   · below ours, the theme’s choice
--tablify-text-muted on --tablify-accent-subtle    host-dark   6.36    4.5   ✓ (reported)

  informational pairs: 3 (reported, never gated; --all to print them)
  host mode, below one of our minimums (3) — the fixture theme's own values:
    · --tablify-line-strong on --tablify-surface [host-light] 2.23 < 3
    · --tablify-line-strong on --tablify-surface [host-dark] 2.61 < 3
    · --tablify-text-muted on --tablify-accent-subtle [host-light] 4.37 < 4.5

  contrast: OK — all 32 gated checks pass (light, dark); 0 host gap(s), 3 host pair(s) below our minimums```

- The three things that follow from that table, stated plainly:
  1. **All 32 gated checks (16 pairs × light/dark) pass.** The prototype gated 15 pairs and 30 checks; this
     file adds a sixteenth — `--tablify-text-muted on --tablify-accent-subtle` — because a selected cell's
     text sits on the accent wash, which no prototype pair covered. It passes at 5.07 (light) and 6.15
     (dark).
  2. **Host mode cannot be gated the same way.** With the fixture theme, three pairs sit below our own
     minimums: `--tablify-line-strong` on `--tablify-surface` is 2.23 (host-light) and 2.61 (host-dark)
     against our 3, and `--tablify-text-muted` on `--tablify-accent-subtle` is 4.37 against our 4.5. That is
     the theme's palette, not ours — `--background-modifier-border-focus` is decorative in Obsidian's
     variable set, and `--background-modifier-hover` is a hover tint. Gating them would fail every theme but
     the fixture. They are printed on every run, and the count is in the final line, so the difference is
     visible rather than argued away.
  3. **The fixture is a stand-in, not a quotation.** `HOST_FIXTURE` in `scripts/contrast.ts` holds
     representative values under Obsidian's variable names — deliberately not presented as anyone's
     published theme, because the columns exist to demonstrate delegation, not to certify a theme.

- `bun run css:gate`, and the failure it catches. This is the raw output of the acceptance probe (a real
  violation appended to `grid.css`, then reverted):

```
  css-gate: FAILED
    src/styles/grid.css:287  carries a bang-important — shorten the selector instead
```

  and, with the built stylesheet also regenerated (so the shipped file was caught too, not just the source):

```
  css-gate: FAILED
    src/styles/grid.css:287  carries a bang-important — shorten the selector instead
    styles.css:1  contains a bang-important after the build — the design system forbids it
```

  Two further probes, to show it is not a one-trick gate — a literal outside the identity layer, and a token
  declared outside `tokens.css`:

```
  css-gate: FAILED
    src/styles/brand.css:139  holds the colour literal "#ff0000" outside the identity layer — ask for a token instead

  css-gate: FAILED
    src/styles/grid.css:286  declares a --tablify-* token — tokens.css is the only place one may live
```

  `grid.css` was restored from a copy both times; the clean run prints
  `css-gate: OK — no bang-important, 51 colour literal(s) all inside the identity layer`.

- The checks in `css-gate`, in full, because a gate nobody can enumerate is a gate nobody trusts:
  1. no bang-important in any file under `src/styles/**` **or** in the built `styles.css` — comments are
     blanked first, so a comment may *discuss* the rule (the sources write it as `! important` so a naive
     grep does not cry wolf, and `bundle-size.ts` keeps its own raw check as a second opinion);
  2. no colour literal outside an identity zone, and no identity zone outside `tokens.css`;
  3. no `--tablify-*` declaration outside `tokens.css`;
  4. none of the shapes `docs/04` §The layout contract forbids: a percentage `height`, or a viewport-height
     unit (`vh`, `dvh`, `svh`, `lvh`). All four are file-level, so they hold for every component file that
     does not exist yet — which is the point of landing this step before the grid.
  5. the built `styles.css` must contain `--tablify-surface`, `.tablify-root` and `.tablify-wordmark` — three
     markers, one per source file, so a broken `index.css` import list fails the gate rather than shipping a
     stylesheet with a layer missing.

- Layout: the contract is met **without** a stop-and-report, and the measurement that decides it is
  `position: absolute; inset: 0` on `.tablify-root` plus `position: absolute; inset: 0` on
  `.tablify-scroller` inside a `position: relative; flex: 1 1 auto; min-height: 0` grid area. No ancestor of
  the scroller has a height the plugin negotiates: the root takes the host's padding box, the area takes what
  the flex line leaves, the scroller takes the area's box. The only heights in the file are the fixed ones —
  `--tablify-toolbar-h` 40, `--tablify-statusbar-h` 26, `--tablify-header-h` 40, the three row heights — and
  they are floors (`min-height`) on boxes that are `flex: 0 0 auto`, never a share of the parent.

- Deliberate divergences from the prototype, each one recorded rather than silently done:
  1. **No `will-change`.** The prototype put `will-change: transform` on `.tablify-layer`; `docs/04`
     forbids it on a scrolling layer, and it is right to — a permanent composited layer per scroll position
     buys nothing when the layer is already moved by `transform`. The plugin's `.tablify-layer` has no
     `will-change` at all.
  2. **The narrow rule is not a media query.** P21 unpins the primary column below ~600 px **of pane**, and a
     media query answers for the window, which is not the same question in Obsidian's split panes. So no
     breakpoint exists in `grid.css`; the view measures the pane and simply does not render the frozen layer.
     The comment in that block says exactly that, so the next person does not "fix" it by adding
     `@media (max-width: 600px)`.
  3. **Identity names keep the prototype's vocabulary** (`--tablify-ink`, `--tablify-parchment`,
     `--tablify-clay`, `--tablify-sand-deep`) rather than being re-cut into `<hue>-<step>` names. The values
     are the verified ones from `prototype/css/tokens.css` — the same file the contrast gate's 30 prototype
     checks came from — and renaming them would break the link between the number in a gate and the value in
     the file for no gain. Where a hue *has* steps, the step is the suffix (`-muted`, `-faint`, `-deep`,
     `-hover`, `-wash`).
  4. **`docs/04` §Tier 1 says structure and surfaces always come from Obsidian's variables; the approved
     design pass (D3) says the identity palette is the default with exactly one switch.** The file implements
     the design pass and says so in its header, and the host block reads the variables §Tier 1 tabulates, so
     the doc's table is still the source of that mapping. This is the one place in the step where two
     documents disagree, and it is resolved in favour of the later, approved one — flagged here for review.
  5. **`--tablify-text-faint` is a new identity hue** (`#9c8f84` light, `#8b7f74` dark). The prototype used
     Obsidian's `--text-faint` directly, which identity mode does not have; a placeholder needs *some*
     value, and inventing one in `grid.css` is what the gate exists to prevent. It is an `@contrast-info`
     pair, not gated: placeholder text is decorative by construction.

- The mobile and accessibility numbers are in the tokens file as values, not as prose, and the test asserts
  them: `--tablify-tap: 44px`, `--tablify-input-fs: 16px` (the iOS zoom rule), `--tablify-row-h-medium: 40px`
  with `--tablify-row-h` aliasing it, `--tablify-header-h` at least a short row. Reduced motion zeroes all
  eleven duration tokens and keeps opacity (the two enter-scales go to 1, nothing goes to 0).

- Two things the tooling caught while building this step, both fixed in the code rather than the test:
  1. **Prettier wraps a long value, and both readers had to learn that.** `--tablify-ease-in-out` is long
     enough that Prettier moved its arguments onto separate lines, at which point the test's literal
     comparison failed and — worse — a wrapped `rgba(` would have read as *unresolved* in the contrast gate.
     Both readers now flatten whitespace and drop the padding inside parentheses before comparing. This is
     the kind of failure that only exists because the file is both machine-read and human-formatted, and
     handling it in the reader is the only place it can be handled once.
  2. **The stylesheet could not be loaded into jsdom from a test.** The first version of `tokens.test.ts`
     asserted the cascade through `getComputedStyle` against an injected `<style>` element — and
     `obsidianmd/no-forbidden-elements` refused it, tests included. The rule is worth more than the
     assertion, so the suite parses instead, and the one claim a parse cannot make (that `body`'s
     declaration beats `:root.theme-dark`'s) is asserted structurally — the mapping is declared once on
     `body`, the dark palette once on `:root.theme-dark` — with the inheritance argument written out in the
     test. Recorded because the *next* DOM-level test will hit the same wall: **no test in this repository
     may create a `<style>` element.** (What did survive the experiment, and is worth knowing: jsdom 29 does
     cascade custom properties per selector and does inherit them — it just does not substitute `var()`.)

- ASSUMED, not verified (there is no Obsidian here):
  1. **The grid has not been rendered.** Everything in `grid.css` is a layout contract that step 17 will
     satisfy for the first time; the viewport matrix (`docs/04` §Harness viewport matrix) is step 21's job
     and is the only thing that can actually check it.
  2. **The host-mode column is a fixture.** The switch's behaviour against a real theme — the body class, the
     near-ancestor inheritance, the `data.json` value — is step 16's wiring and step 21's observation.
  3. **The wordmark's slot is empty.** `brand.css` sizes the box; the SVG arrives with the identity step
     (D4/D5), so the 18 px height is a placeholder dimension, not a design decision.
  4. **`styles.css` is committed.** It is the third shipped asset and it is generated; the release script
     already refuses a dirty tree, which is what keeps the committed copy from drifting. No CI step compares
     the built file to the committed one — `bun run build` regenerates it before `css:gate` reads it, so a
     drift would show up as a *dirty tree* at release time rather than as a red build.

- Findings worth keeping (for the docs, reported not applied):
  1. **`docs/04` has no §grid geometry table.** The 40/26/40 and the three row heights are stated in prose
     ("row height minimum 40 (medium) on mobile") and in the harness matrix, but the toolbar and status bar
     minimums are this step's numbers. If they matter, they belong in `docs/04` §The layout contract.
  2. **`docs/04` §The layout contract does not name the drawn scrollbars' thickness.** 12 px is this step's
     choice (a finger target, not the OS default), and a fifth of the same paragraph would fix it.
  3. Still open from earlier steps: `docs/01` §settings and `docs/02` §settings do not exist; `docs/01` names
     only one settings default; `docs/02` §Store is behind the implemented shape; step 10's three
     `FINDINGS.md` corrections are unapplied.

- Open questions for the human:
  1. **The 12 px scrollbars and the 40/26 px chrome minimums** are this step's numbers — worth a line in
     `docs/04`, or keep them as code constants?
  2. **Host mode reports three pairs below our own minimums** (above). Report only, or should the plugin
     refuse to map a variable it cannot guarantee and fall back to the identity palette for that one token?
  3. (unchanged) **Twelve settings defaults are choices, not quotations** (step 14's table).
  4. (unchanged) **Does anything ever write `.tablify/migrations/<timestamp>.json`**?; **should the dialog
     offer `empty.tabula`?**; the missing `docs/01` §undo paragraph; `docs/02` §Query vs step 08.

- Next step: `prompts/step-16-store-and-selectors.md` — the store on `useSyncExternalStore`, `selectors.ts`,
  `commands.ts`, the window maths, and the point at which **React 19 and react-dom become real
  dependencies** (the prompt asks for the versions and the bundle delta, so the report will carry both).

- Files touched in **step 15**: new — `src/styles/{tokens,brand,grid,index}.css`, `scripts/contrast.ts`,
  `scripts/css-gate.ts`, `tests/unit/tokens.test.ts`; changed — `styles.css` (now generated, 12711 bytes),
  `esbuild.config.mjs` (a second context for CSS), `package.json` (`contrast`, `css:gate`, and both in
  `check` after `build`), `.prettierignore` (`styles.css`), `.github/workflows/ci.yml` (the two gates after
  `build` — the fence did not list the workflow, and the step's own headline asks for "a contrast gate that
  runs in CI", so it is edited and flagged), `PROGRESS.md`.

---

**Step 14 — the settings schema, its persistence, and the real settings tab.**

- Verified (`bun run check` — raw): `tsc --noEmit` clean; `eslint .` → **0 errors, 0 warnings** (the step-04
  `prefer-setting-definitions` warning is resolved by adopting the 1.13 declarative API, not suppressed);
  `brand-gate: OK — 61 permitted match(es), 0 violations` (after it caught one real violation, below);
  `manifest:check: OK`; `All matched files use Prettier code style!`; **948 tests across 24 files**
  (was 912 / 23: +22 in `tests/unit/settings-load.test.ts`, +20 in `tests/dom/settings-tab.test.ts`, and
  `plugin-smoke` +1 manifest field); `bundle-size: OK` — `main.js raw 68920 bytes (67.30 KB)`
  (**+16173 B / +3.88 KB gzip** over step 13: the settings schema, validator, store, tab and diagnostics),
  `gzip 21985 bytes (21.47 KB)`, `styles.css !important check: clean`. Coverage: all files **91.15 / 89.72**;
  `src/plugin/settings` **86.54** (`diagnostics.ts` 96.22, `schema.ts` / `load.ts` / `save.ts` / `tab.ts`
  between 88 and 100), `TablifySettingTab.ts` **18.18** — the class is the Obsidian-facing half and only
  Obsidian constructs it; the parts of that file that carry logic are exported and tested (below).

- The settings inventory (path → default → what changing it does):

  | Path | Default | Row |
  |---|---|---|
  | `rows.targetFolder` | `''` (vault root) | Folder for new notes — where a created note is written |
  | `rows.filenameTemplate` | `'{{Name}}'` | File name template — `{{Column}}`, falling back to `Row 1`, `Row 2` |
  | `rows.dateFormat` | `'iso'` | Date format — display only; the note keeps the same value |
  | `import.warnOnLargeImport` | `true` | Warn before a large import |
  | `import.largeImportThreshold` | `250` (range 10–5000) | Large import threshold — hidden while the warning is off |
  | `import.inferTypes` | `true` | Detect column types |
  | `import.clipboardPasteMode` | `'expand'` | Pasting a block — grow / fill / ask |
  | `appearance.followObsidianTheme` | `false` | Follow my Obsidian theme — the one host-theme switch |
  | `appearance.defaultRowHeight` | `'medium'` | Row height for **new** views (a view's own height lives in `.base`) |
  | `appearance.motionPreference` | `'system'` | Motion — follow the system reductions |
  | `legacy.showMigrationEntryPoints` | `true` | Show the legacy import entries |
  | `advanced.logLevel` | `'off'` | Log level — silent unless asked |
  | `advanced.experimental` | `{}` (empty) | Experimental features — hidden until a flag exists |
  | — (no value) | — | Version (read-only line) · Diagnostics (button) |

  `docs/01` names the 250-row threshold; every other default is this step's own choice, recorded here so the
  next step reads one table rather than four files.

- The migration table (item 6), each case as a test:
  1. `{}` → `DEFAULT_SETTINGS`, no warning, `migratedFrom: 0` (no version field **is** version 0; a missing
     file is the different case and reports nothing).
  2. a partial file (`{rows:{targetFolder}}`) → that one value stored, everything else at its default, no
     warning: an absent key is what a fresh install looks like, not a mistake.
  3. a wrong type (`largeImportThreshold: 'many'`, `warnOnLargeImport: 'yes'`, `defaultRowHeight: 'enormous'`)
     → three defaults and three warnings, in schema order, e.g. *“Warn before a large import” keeps its
     default (on): the stored value expected true or false.* and *… expected one of short, medium, tall.*
  4. a number out of range (`999999`) → the default, and *… expected a number between 10 and 5000.*
  5. unknown keys (`somethingNewer`) → kept in `passthrough`, warned, and present in the payload after a real
     load → set → debounce → flush cycle.
  6. `version: 0` → `migratedFrom: 0`, values untouched, `MIGRATIONS[0]` asserted to be pure (same input,
     same output); `version: 99` → nothing changed, nothing thrown, two warnings (the newer-version notice and
     the unknown key), and the payload keeps `futureSection` while writing our own `version`.
  Plus: a non-object file (`null`, `'nonsense'`, `42`, `[1,2]`) → defaults, never a throw.

- The `passthrough` behaviour, implemented and asserted: `loadSettings` splits the **top level** only —
  `version`, `rows`, `import`, `appearance`, `legacy`, `advanced` are ours, and every other key is copied
  verbatim into `passthrough`, warned about once, and merged back by `payloadFor` **before** our own `version`
  is written last. The store can never set a passthrough key: `set()` resolves the path through
  `settingRowFor` and refuses anything the schema does not declare (asserted for a real path, a made-up path,
  and an internal `__warning.0` key).

- **Three things the tooling caught, fixed in the product rather than the test** — the reason this step is
  worth its own block:
  1. **The brand gate fired on real product code**: `src/plugin/settings/schema.ts` said “Airtable-style” in a
     comment about what may never be stored. Removed — the token does not appear in `src/**` at all, and the
     gate is what proved it.
  2. **`obsidianmd/no-unsupported-api`**: `SettingSliderControl.displayFormat` is **`@since 1.13.1`** while
     this plugin's `minAppVersion` is 1.13.0. The field is gone; the slider's unit and range now live in the
     row's description (*“The row count, from 10 to 5000, …”*), which is also searchable. The group-level
     `search` field (`@since 1.13.1` as well) was removed for the same reason, unprompted by the linter.
  3. **`consistent-type-assertions` × 5 + two `no-unsafe-assignment`**: the defaults were written with `as`
     on five enum values, and `Reflect.get` returns `any`, which is an unsafe assignment even into `unknown`.
     Both are gone: the defaults rely on the annotation for contextual typing, and `readPath`/`writePath` walk
     objects through an `isRecord` guard and an index access, with `containerOf` shared by both.
  4. A behavioural bug the tests found before the gate did: `set()` notified listeners for a value **equal** to
     the stored one, so a slider dragged back to where it started re-rendered the tab. `set()` now compares
     first: equal value → accepted, no notification, no dirty flag, no write.
  5. The sandbox restore stripped the **byte-order mark** from `tests/fixtures/tabula/crlf-bom.tabula` — the
     fixture's entire purpose. Restored from git, and `tabula-parse.test.ts` now asserts the fixture's bytes
     (`charCodeAt(0) === 0xfeff`, contains `\r\n`, not `\n\r`) before asserting the parse, so a tool that
     tidies the file away fails the test instead of making it vacuous. This is step 13's file, fixed here.

- Decisions and deviations worth recording:
  1. **The tab is declarative (`getSettingDefinitions()`), not `Setting().addToggle()`.** `prompts/step-14`
     item 4 names the imperative controls; the API marks `display()` **deprecated since 1.13.0** and calls it
     only when `getSettingDefinitions()` returns an empty array, `minAppVersion` is 1.13.0, and the project's
     own lint rule (`obsidianmd/settings-tab/prefer-setting-definitions`) asked for exactly this in step 04.
     Writing both renderers would mean two places to keep in step for every future setting — the thing the
     schema exists to prevent. There is **no `display()` override at all** (asserted), so the declarative path
     is the only path.
  2. **The tab's logic lives in `src/plugin/settings/tab.ts`, which does not import `obsidian`.** The rows,
     the visibility predicates, the control mapping, the validators, the Diagnostics action and the versions
     line are all testable without a browser — and `renderFor` is the seam the tests drive, so what is asserted
     is the function the definition itself calls. `SettingSurface`/`ToggleSurface` are the narrow interfaces
     those callbacks declare: a real `Setting` satisfies them, and a test can build one without an assertion.
  3. **The class's logic is exported and tested; its delegations are not.** `settingsOf`, `isSettings` and
     `writeSetting` are exported from `TablifySettingTab.ts` and asserted against a hand-built host (defaults
     for a store that has nothing, a schema-only path guard, the value passed through unchanged). What remains
     uncovered is the constructor and three one-line delegations, which only Obsidian calls — reported as
     **ASSUMED**, like every DOM-facing surface in this project so far.
  4. **The debounce is 500 ms, and the number is a named constant.** No doc names an interval for plugin
     settings; the write queue's 250 ms is tuned for typing and this is a click path. `flush()` bypasses it,
     `dispose()` drops it, and a refused write keeps the value in memory with the dirty flag back on.
  5. **Diagnostics has a secrets filter, not a promise.** `looksSecret`/`redactedSettings` replace any
     credential-looking key with `"<removed>"` and a test proves the filter fires — so when step 25 adds a
     sync section, the button cannot leak it even by accident. The blob carries versions, the settings, and a
     **count** of notes: no note text, no file names, no folder paths.
  6. **The versions row shows two versions, not three.** “The version running now” is not public API
     (step 10's finding, recorded in `spike/bases-path/FINDINGS.md`), so the line reads
     `Tablify 0.1.0 · Obsidian 1.13.0 or newer` — true, and it does not pretend to know more.

- Findings worth keeping (the docs did not say, or said differently):
  1. **`docs/02` §settings does not exist.** The step's “read first” names a section that is not in the file
     (its neighbours are §Store, §Grid rendering, §Performance budget). The placement rule used here came from
     `docs/03` §view config (per-view state in `.base`) and `docs/01` §views (row height/density are *view*
     options), and it is written into `schema.ts` as a comment. *(reported, not applied)*
  2. **`docs/01` §settings also does not exist**, and `docs/01` names only one settings default (the 250-row
     threshold). The remaining twelve defaults are this step's, listed above for review.
  3. Unchanged: `docs/02` §Rows become notes needs the “`createFileForView` is single-row only” line, and
     step 10's three `FINDINGS.md` corrections are still unapplied.

- Open questions for the human:
  1. **Twelve defaults are choices, not quotations** — the table above is the list. Anything to change before
     step 16 reads them?
  2. (unchanged) **Does anything ever write `.tablify/migrations/<timestamp>.json`**, or does the dry-run
     report replace it?
  3. (unchanged) **`empty.tabula` has nothing to migrate** — should the dialog offer it at all?
  4. (unchanged) **`docs/01` §in scope** needs the missing §undo paragraph (depth 60, one step per action, the
     menu wording, no keystroke coalescing).
  5. (unchanged) **`docs/02` §Store's `Command`/`GridStore` sketch** is behind the implemented shape, and
     step 13 leaned on that shape.
  6. (unchanged) `docs/02` §Query and `docs/01` are behind the query layer (step 08, Findings 1–3);
     `@standard-schema/spec` as a types-only devDependency or the local declaration; `docs/04` has no
     §cell-rendering section; `attachment`: `[[link]]` or plain path; the layout-guard warning; the banned word
     in `docs/09` line 33 and the three candidate descriptions.

- Next step: `prompts/step-15-tokens-css-and-contrast-gate.md` — `src/styles/{tokens,brand,grid}.css` with the
  three token layers, the assembled `styles.css` entry, `scripts/contrast.ts` (a port of `tools/contrast.js`
  and its `@contrast` convention) and `scripts/css-gate.ts`, both wired into `check` after `build`, plus
  `tests/unit/tokens.test.ts`. The palette values come from `prototype/css/tokens.css` (the identity set), and
  the gate must pass in light, dark and host mode.

- Files touched in **step 14**: new — `src/plugin/settings/{schema,load,save,tab,diagnostics}.ts`,
  `tests/unit/settings-load.test.ts`; changed — `src/plugin/settings/TablifySettingTab.ts`,
  `src/plugin/main.ts`, `tests/mocks/obsidian.ts` (Setting `addToggle`/`controlEl`, `SettingGroup`,
  `PluginSettingTab`'s five declarative members, `Plugin.loadData`/`saveData` + app.vault),
  `tests/dom/settings-tab.test.ts`, `tests/unit/plugin-smoke.test.ts`,
  `tests/unit/tabula-parse.test.ts` (the fixture-bytes assertion, over a step-13 file), `PROGRESS.md`.
  Nothing outside `src/plugin/**`, `tests/**` and `PROGRESS.md` — in particular the `.base`-owned per-view
  settings were left alone, and no field of `data.json` holds one.

---

**Step 13 — the `.tabula` reader, the dry run and the migration.**

- Verified (`bun run check` — raw): `tsc --noEmit` clean; `eslint .` → **0 errors, 1 warning** (unchanged: the
  step-04 settings tab does not implement `getSettingDefinitions()`; step 14 replaces it);
  `brand-gate: OK — 60 permitted match(es), 0 violations` (one more permitted match: the new fixtures name the
  legacy format in prose, not a brand); `manifest:check: OK`; `All matched files use Prettier code style!`;
  **912 tests across 23 files** (was 868 / 21: +26 in `tests/unit/tabula-parse.test.ts`, +18 in
  `tests/unit/tabula-migrate.test.ts`); `bundle-size: OK` — `main.js raw 52747 bytes (51.51 KB)`,
  `gzip 16555 bytes (16.17 KB)`, `styles.css !important check: clean`. Coverage: all files **91.46 / 90.21**
  (funcs 96.22); `core/migrate` **93.81** (`dryRun.ts` 94.82, `apply.ts` 92.02),
  `adapters/tabulaFile` **82.77** (`model.ts` 83.41, `parse.ts` 82.53), `src/core/**` unchanged at 85+/85+.

- **The first CI run of this step failed, and it was the most useful thing that happened to it.**
  Run `37364334832` (on `c97e79f`) failed at `bun run test`: `tests/unit/tabula-parse.test.ts` →
  `refuses a truncated file … expected 10 to be 9`. The reader had fixed the runtime-dependence in the branch
  that has **no** engine position (Bun says `Expected '}'` with no position) and left the engine's own
  position untouched in the branch that has one — and the CI runner's engine reports
  `… in JSON at position 269 (line 10 column 1)`, pointing a truncated document at the last byte of the input,
  which is one line past the text. `locateAtLine` now answers a position that lands on a blank line with the
  **last line that has content, and that line's number**, so both engines report line 9 with the same excerpt.
  The rule is pinned by a test that injects a V8-shaped message (`line 10 column 1`) through a one-shot
  `JSON.parse` spy, so the local suite now catches exactly what CI caught — the fix is verified twice without a
  third push. The step-13 evidence above is from the gate **after** that fix.

- The acceptance assertions, by requirement:
  1. **It never throws.** Every refusal is a `TabulaResult` with `TabulaError { path, line?, column?, message,
     excerpt ≤ 120 }`; the engine's own `SyntaxError` travels as `cause` and nothing asserted depends on its
     wording. `truncated.tabula` (a deliberate half-written JSON file) refuses with
     `the file is not valid JSON — it stops before the document ends, so it is truncated or only partly saved`
     at **line 9 with a non-empty excerpt on both engines**: V8 reports the position at the last byte of the
     input (where there is no text) and Bun reports no position at all, so a position that lands on nothing is
     answered with the file's last line that has content (`locateAtLine`/`locateFrom` → `locateEnd`). The
     snapshot pins the message and the excerpt; the assertions pin the line, once for each engine's message
     shape.
  2. **Version from content.** `version === 2 && Array.isArray(tables)` is v2, `fields && rows` is v1, a
     `tables` array with no `version` is read as the v2 envelope (with a `missing-version` warning), and
     `version > 2` refuses rather than guessing.
  3. **Tolerance, each asserted on its own fixture or its own minimal document**: BOM + CRLF
     (`crlf-bom.tabula` parses with **zero** warnings), trailing space, a table with zero rows (`empty.tabula`),
     two unknown legacy types (`lookup`, `rollup` — **kept as text**, `unknown: true`, one `unknown-type`
     warning each), orphaned select ids (`orphan-options.tabula` — the value is kept, the label is kept when it
     exists, and `orphanSelections()` reports `r_1/f_status/o_archived` and `r_1/f_tags/o_urgent`), a v2 entry
     with no table object (`skipped-table-entry`, the other tables still read), two tables claiming one id
     (`duplicate-table-id`), a row with no `cells` object (`missing-row-cells`, the row survives as empty), a
     cell whose column is not in the table (`extra-cell-column`, the value is dropped), and an unrecognised
     sort direction (`unknown-sort-direction`, the sort is kept).
  4. **Seven fixtures, each snapshot-tested.** `tests/unit/__snapshots__/tabula-parse.test.ts.snap` holds the
     parse result of all six readable fixtures (820 lines); the seventh (`truncated.tabula`) is asserted as an
     error. A test also asserts the fixture directory contains exactly those seven names, so a fixture cannot
     be added without a test being added in the same commit.
  5. **The dry run is data.** `dryRunMigration(doc, target)` is pure — no clock, no vault, no I/O — and its
     report is snapshotted for the other five readable fixtures plus the whole report of `v1-simple`. Counts
     asserted outright: v2 is 6 notes over 3 tables (3/2/1), 16 columns, 1 dropped, 1 warn-free read;
     `unknown-types` is 2 remapped + 2 metadata + 1 dropped; `orphan-options` is 2 orphan values.
  6. **Operator translation, against the twelve canonical ids** (`docs/08` §query): `equals`→`is`,
     `contains`→`contains`, `before`→`lt`, `after`→`gt`, `isAnyOf`→`contains`, `isTrue`→`is`, `gt`→`gt`,
     `isEmpty`→`isEmpty`, each with a reason; an operator with no canonical form (`fuzzyMatches`) keeps its
     column and its spelling in the conditions table **and** is listed in `view.dropped`, because a filter that
     is not applied is a loss a person has to be able to read.
  7. **One undo step, one `importBlock` per table, new notes only, `.tabula` bytes unchanged.**
     `migrateMutation` returns `['importBlock','setFieldOptions','setViewConfig']` for `v1-simple`; pushed to
     `createHistory()` as **one** command (`{kind:'none'}` before-images — a note that did not exist), it gives
     `depth() === 1`, `undoLabel() === 'Migrate 3 notes from 1 table'`, and `undo()` returns deletes for exactly
     the three created notes; `redo()` puts them back. A note that already exists at a target path is left
     byte-identical and is not in `created()`. The fixture's text is re-read after a full apply and is equal,
     and no path in any op ends in `.tabula` (asserted over `vault.paths()`).
  8. **Through the view source**, a migration produces **no refusals and no cell writes** (`written === 0`) and
     exactly two sidecar patches, in order: `fieldOptions` (carrying `note.Status` with its options) and
     `tablifyViewConfig` (carrying the translated view). Rows are the store's business — `BasesSource` has no
     `importBlock` case and says so with an empty default — which is asserted rather than assumed.

- Decisions and deviations worth recording:
  1. **A column's destination is a four-way statement, not two booleans.** `ColumnPlan.destination` is
     `'kept' | 'remapped' | 'metadata' | 'dropped'`, and `stored` is derived so the two cannot disagree
     (asserted as an invariant over a 6-column plan). Reporting a `createdTime` column as "remapped" (as the
     first draft did) would have said the type changed when what changed is that the *values* stop being copied.
  2. **The auto-number counter is named only when a column used it.** A `.tabula` file carries
     `autoNumberNext` even with no `autoNumber` column, and "counter discarded" would then be noise next to a
     report that is otherwise exact. Asserted both ways (`v1-simple` must **not** mention it, `unknown-types`
     must).
  3. **v2 table ids come from the entry** (`{ id, table }`), matching the fork's own
     `parseTableFileDocument`; the first draft read `id` from inside the table document, which would have
     reported every v2 table as `t_1`/`t_2` and silently re-keyed a file that legitimately uses those names for
     something else. A v1 document has no id of its own — the file *is* the table — so `t_1` is synthesised and
     documented as synthesised.
  4. **A table with zero rows contributes no `importBlock`.** The step's item 4 says "one `importBlock` per
     table"; a no-op op would be recorded in the undo step and in the write log for nothing, so
     `empty.tabula` produces a `setViewConfig` and nothing else. Reported as a deviation rather than split down
     the middle.
  5. **Op order inside one table is `importBlock` → `setFieldOptions` → `setViewConfig`** (a table at a time,
     tables in order). A store applying the batch in order therefore cannot render a select column before its
     options exist, and `previous: {}` is honest for a **fresh** base view: a non-empty `previous` would make
     undo restore a config the user never had.
  6. **`Project plan (1)` vs `" 2"`.** `prompts/step-13` item 5 illustrates the collision case as
     `Project plan (1)`; `docs/03` line 99 says the suffix is `" 2"`, `" 3"`, …. The doc is the spec and the
     implementation follows it (same divergence as step 12's finding 4, recorded once, awaiting a decision).
  7. **`tests/fakes/noteStore.ts` (new) is a stand-in for the step-16 store, and it is a fake, not a mock**:
     notes are written by the shipping `createNote` frontmatter path and state comes from the shipping
     `applyOp` reducer, so a migrated note cannot drift from a pasted row. It exists because `importBlock` and
     `deleteRows` have to be *applied* somewhere for the one-undo-step assertion to mean anything; step 16
     replaces it with the real store and this file is then the thing to delete.
  8. **`tests/fixtures/tabula/*` are hand-written to the recorded on-disk shapes**, not copied from the fork's
     test data: v1 written bare, v2 only when there are two or more tables, select cells holding option **id**s,
     number/currency/percent as plain numbers (`f_share: 25` — checked against the fork's `isNumericField`,
     which does not store a ×100 form). The fork's reader was consulted for the detection rule and the envelope
     shape only.

- Interpretations worth recording:
  1. **`metadata`, not `remapped`, is where `createdTime`/`lastModifiedTime` go.** Both become read-only
     `file.ctime`/`file.mtime` columns; the column survives and the values are recomputed by Obsidian
     (`docs/03` §field type mapping), so they are reported as a destination of their own.
  2. **The reader keeps the file's own vocabulary.** A sort whose direction is not `asc`/`desc` is kept as
     written and warned about (the dry run then normalises to `asc`), and an unknown legacy type keeps its
     spelling in `legacyType` with `unknown: true` — so the report can show the user the word that was in their
     file, which is the whole point of a dry run.
  3. **Warnings are scoped by index, not by text.** `TabulaWarning.tableIndex` is stamped on every warning and
     the dry run filters with `tableIndex === undefined || === index`; the earlier substring match on `where`
     would have mis-attributed a warning whose text happened to contain another table's label.
  4. **`Array.isArray` was replaced at every read site** (`isStringList` in `model.ts`, `asArray` in `parse.ts`)
     because it types an `unknown` as `any[]` and `no-unsafe-*` catches it — the fix is a predicate, never a
     cast.

- Findings worth keeping (the docs did not say, or said differently):
  1. **`docs/03` §Migration step 5's mapping file (`.tablify/migrations/<timestamp>.json`) is not written in
     step 13.** The `sync` block is *carried* in every table plan and in the report, so the data a mapping file
     needs is read and reported — but writing it is a vault write with a clock, and both are outside this
     step's fence (read-only reader, pure migration). Whoever owns the dialog (step 23) has to own it, or the
     file has to be dropped in favour of the report. *(reported, not applied)*
  2. **`docs/03` should say that a row-creating op belongs to the store, not to the view source.** The source
     deliberately has no case for `importBlock`; without the sentence, the next reader of `BasesSource` sees an
     empty `default:` and has to guess whether it is a bug. *(reported, not applied)*
  3. Unchanged: `docs/02` §Rows become notes should note that `createFileForView` is single-row only; step 10's
     three `FINDINGS.md` corrections are still unapplied.

- Open questions for the human:
  1. **Does anything ever write `.tablify/migrations/<timestamp>.json`** (finding 1), or does the dry-run
     report replace it? Until that is decided the reader keeps the `sync` block and nothing writes a file.
  2. **`empty.tabula` has nothing to migrate** (zero rows, two columns). Should the dialog offer the migration
     at all, or say "this file has no rows" and stop? Step 23's call, recorded here because the ops for it are
     already empty except the view config.
  3. (unchanged) **`docs/01` §in scope** needs the missing §undo paragraph (depth 60, one step per user action,
     the menu wording, no keystroke coalescing).
  4. (unchanged) **`docs/02` §Store's `Command`/`GridStore` sketch** is behind the implemented shape
     (`label`, `undo()` returning ops, `History` as a factory) — and step 13 leaned on that shape, so the gap
     is now load-bearing.
  5. (unchanged) `docs/02` §Query and `docs/01` are behind the query layer; a select column's sort is
     alphabetical rather than option-ordered (step 08, Findings 1–3).
  6. (unchanged) `@standard-schema/spec` as a types-only devDependency, or the local structural declaration?
  7. (unchanged) `docs/04` has no §cell-rendering section, which `prompts/step-07` cites.
  8. (unchanged) `attachment`: write `[[link]]` or the plain vault path? (current: plain path.)
  9. (unchanged) Layout guard: warning (current) or failing until step 21?
 10. (unchanged) `docs/09` line 33 still contains a banned word in its description template; three candidate
     plugin descriptions await a pick.

- Next step: `prompts/step-14-settings-schema-persistence-and-tab.md` — the settings schema, load/save with
  migration, and the real `TablifySettingTab` replacing step 04's placeholder: schema-driven rows, hidden rather
  than disabled, unknown keys preserved, a pure `migrate(raw)` at `version: 0`, a debounced save, a read-only
  version row and a Diagnostics button that copies a secret-free blob. It must resolve the one standing lint
  warning **by adopting the 1.13 declarative surface** (`PluginSettingTab.getSettingDefinitions()`,
  `@since 1.13.0` — found while checking the Bases declaration in step 12) or by saying why not.

- Files touched in **step 13**: new — `src/adapters/tabulaFile/{model,parse}.ts`,
  `src/core/migrate/{dryRun,apply}.ts`, `tests/fixtures/tabula/*.tabula` (7),
  `tests/fakes/noteStore.ts`, `tests/unit/{tabula-parse,tabula-migrate}.test.ts`,
  `tests/unit/__snapshots__/tabula-parse.test.ts.snap`; changed — `PROGRESS.md`. Nothing outside
  `src/adapters/tabulaFile/**`, `src/core/migrate/**`, `tests/**` and `PROGRESS.md`.

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
