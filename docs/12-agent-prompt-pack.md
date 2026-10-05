# 12 — Agent prompt pack

Ready-to-paste prompts for the Tablify build, one per milestone, plus the reusable ones. Method behind them: `docs/11-prompting-guide.md`.

**How to use:** paste the *Session anchor* first (every session), then the milestone prompt for the step you're on. Replace every `<…>` placeholder. Attach the files listed — do not paste their contents.

Every milestone prompt assumes these defaults, which you should re-state if the agent drifts:
- `bun run check` is the gate, and its raw output is the only acceptable evidence.
- APIs are cited from `node_modules/obsidian/obsidian.d.ts`.
- No new dependency, no file outside the fence, no re-opening `docs/08-decisions.md`.
- One step per turn, one branch per milestone, ~600 changed lines maximum.

---

## 0 · Session anchor (paste first, every session)

```
Project: Tablify — a spreadsheet-class grid view for Obsidian Bases (rows are notes,
columns are properties). Full spec in this repo's docs/.

Governing docs (settled — do not re-litigate):
- AGENTS.md — boundaries, conventions, the never-do list
- docs/02-architecture.md — layers, RowSource port, field-type registry, budgets
- docs/03-data-model-and-migration.md — frontmatter mapping, write rules
- docs/04-design-system-and-layout.md — tokens, the one layout contract
- docs/05-toolchain-and-ci.md — commands and CI gates
- docs/08-decisions.md — P1–P20, E1–E12 are DECISIONS, not suggestions
- docs/10-verification-and-ai-hygiene.md — cite-or-die and the verification rules

Current state: milestone M<n>, branch <name>. Last completed: <step>.
Known half-finished: <nothing | describe>.

Working agreement:
- Plan first (max 10 lines), then wait for my approval before writing code.
- One goal per turn. If the goal needs more, tell me how you'd split it.
- Read files I name; do not explore the repository for "context".
- Never edit: manifest.json (except a version bump), docs/**, .github/** unless I say so.

Confirm you have read AGENTS.md and docs/02-architecture.md by quoting the two
rules you consider most likely to be broken by mistake.
```

That last line is a cheap, effective comprehension check — the two rules it quotes tell you which parts it actually absorbed.

---

## 1 · Plan prompt (use before every non-trivial step)

```
Task: <single outcome>.

Before writing any code, produce a plan with:
1. Files you will create or modify (exact paths), and why each is inside the fence.
2. The public interfaces you will add: function/type signatures only, no bodies.
3. The tests or harness assertions that prove it works — written as acceptance criteria
   I can check (commands + expected observable result).
4. Every assumption you are making that is not settled in docs/08-decisions.md.
5. Every Obsidian API you expect to use, cited from node_modules/obsidian/obsidian.d.ts
   (file + symbol + @since). If you cannot find it there, say so now — do not plan around
   an API you have not located.
6. The three most likely ways this could be wrong.

Do not write code. Wait for my approval.
```

---

## 2 · M0 — Project hygiene

```
Task: stand up the repository skeleton so it is a buildable, lintable, testable plugin
that could be released. No product code yet.

Read: docs/05-toolchain-and-ci.md (commands, configs), docs/09-publishing.md (manifest,
versions.json, license, README), AGENTS.md (conventions), docs/06-roadmap.md §M0.

Deliverable:
- package.json (Bun scripts per docs/05), tsconfig.json, eslint.config.mts, .prettierrc,
  .editorconfig (tabs, 4-space, single quotes — match the official sample plugin),
  .gitignore (main.js, node_modules, playwright-report, meta.json)
- manifest.json (id "tablify", version 0.1.0, isDesktopOnly false, minAppVersion <tested version>)
- versions.json, CHANGELOG.md, LICENSE (MIT, retaining upstream copyright + mine), NOTICE
- src/plugin/main.ts — a minimal Plugin with one command that shows a Notice
- esbuild.config.mjs, scripts/bundle-size.ts, scripts/version-bump.ts
- .github/workflows/ci.yml and release.yml per docs/05
- tests/smoke.test.ts — one test that trivially passes, so the gate is wired
- no styles.css content yet beyond an empty file

Constraints:
- No React, no runtime dependencies yet. Do not add the spreadsheet libraries yet.
- Do not create src/core, src/grid, src/adapters subdirectories beyond empty placeholders
  with a README explaining the boundary (copy the boundary text from AGENTS.md).

Acceptance:
- `bun install && bun run check` passes on a clean checkout and prints the bundle size.
- `bun run build` produces main.js; report its size (this calibrates the budget in docs/05 §21).
- A dry-run of the release workflow logic produces exactly three assets and fails if the tag
  has a "v" prefix or does not match manifest.version.

Verification: paste raw output of `bun run check` and the measured bundle size. State the
`minAppVersion` you chose and why.
```

---

## 3 · M1 — Core domain

```
Task: build src/core — pure TypeScript, no Obsidian, no React, no DOM.

Read: docs/02-architecture.md (§field-type registry, §Query), docs/03-data-model-and-migration.md
(the field→frontmatter mapping table is the spec), docs/08-decisions.md (P11, P12, E2), AGENTS.md.

Deliverable, in this order (one turn each, stop after each):
1. core/fieldTypes/types.ts — the FieldDescriptor interface exactly as specified in docs/02.
2. One file per field type: the 16 types in the docs/03 mapping table (the table is the source of truth).
   Each declares parse, toYaml, formatDisplay, formatPlain, parsePlain, filterOps, matches,
   compare, groupKey, defaultValue.
3. core/fieldTypes/registry.ts — registration + lookup, no switch statements anywhere else.
4. core/query/ — Expr AST, parseQueryString, toQueryString, evaluate.
5. core/ops/ — Op types, reducers, and inverses (for undo).
6. core/selection/ — ranges, anchors, clipboard matrix model (TSV and HTML).
7. tests for all of the above, including a shared contract suite that iterates the registry.

Constraints:
- Zero imports of obsidian or react in core/ (the ESLint boundary rule must pass).
- No switch (field.type) or switch on a type discriminant anywhere outside core/fieldTypes/.
- No new dependencies. No `any`, no `!`, no bare catch.
- Undo correctness as a property: apply(undo(apply(x))) === x, tested over generated op sequences.

Acceptance:
- The shared contract suite passes for every registered type: parse(formatDisplay(v)) === v,
  formatPlain round-trips through parsePlain, toYaml yields a YAML-safe scalar/list, compare is
  a total order, every declared filterOp is implemented.
- Coverage: ≥ 85% lines/functions on core/, thresholds wired in vitest.config.ts and passing.
- Reporting the file count for "add a field type": list every file a developer must touch.

Verification: paste raw `bun run check`. Then state the honest answer to: "how many files does
adding field type #14 require?"
```

---

## 4 · M2 — Data layer (do the spikes first)

```
Task: prove the Bases data path on my machine, then build the adapters.

Read: docs/02 (§RowSource, §Write queue, §Bases integration), docs/03 (write rules, sync state),
docs/10 §4 (the spike list), docs/08 (P2, P8, E7).

STEP 1 — SPIKE (≤ 50 lines, do not build anything else yet):
A throwaway Bases view that, in onDataUpdated(), logs to the console:
  - config.getOrder() and config.getSort()
  - this.data.data.length and this.data.data[0].file.path
  - the raw value and the typed Value of one property via getValue()
Then: change one property in a note from a cell edit using
app.fileManager.processFrontMatter, and diff the note file before/after.

Report: does the data path behave as docs/02 describes? Does the write preserve unknown
frontmatter keys? Quote the actual console output and the actual diff. If the API differs from
the docs, STOP and report the difference — do not code around it.

STEP 2 (after I confirm the spike):
RowSource port + writeQueue (coalescing per file+property, per-file serialization, rollback,
flush) + BasesSource + the read-only tabulaFile adapter + the note-creation service
(prefer BasesView.createFileForView; fall back to manual creation when a specific folder is
required). Tests against tests/fakes/vault.ts — never a real vault.

Constraints: adapters must not import react. Never vault.modify() for a property change.
Clearing a value deletes the key. Sync code is not built in this milestone.

Acceptance: 12 property writes to one file in a tick produce exactly ONE
processFrontMatter call; interleaved writes from two sources are serialized with nothing
lost; a failing write drops only the affected optimistic overlay and returns a per-file error;
unknown keys survive; flush() resolves only after the last write resolves.

Verification: paste raw `bun run check`, plus the spike's console output and note diff.
State what you did not verify (e.g. behaviour on mobile, large files).
```

---

## 5 · M3 — Grid v1

```
Task: the grid. Windowing, keyboard model, cell editors, tokens — per docs/04 and docs/01 §interaction.

Read: docs/02 (§Store, §Grid rendering, §Performance budget), docs/04 (whole file),
docs/01 §core interaction model, docs/07 (harness tiers and the viewport matrix).

Deliverable, one turn per item:
1. grid/styles/tokens.css + brand.css (placeholder brand values from docs/04) + grid.css. Zero !important.
2. grid/store.ts + selectors.ts — hand-rolled store on useSyncExternalStore, narrow selectors.
3. GridView.tsx — one scroller, .tablify-root { position: absolute; inset: 0 }, windowing for rows
   (fixed per-density heights, overscan 8), sticky header and frozen column as transformed layers.
4. Cell editors for every field type, driven by the registry's editor id.
5. Keyboard model: exactly one handler, roving tabindex, the full key table from docs/01.
6. Resize/reorder via one pointer-capture handler; context menus via Obsidian Menu; overlays via Modal
   (no hand-rolled modals, no window.addEventListener).
7. harness/ — static page mounting the real GridView against a fixture RowSource, plus the
   Playwright spec with all 13 assertions from docs/07 §Tier 4.

Constraints:
- No percentage-height chains, no ResizeObserver height anchors, no 100vh, no !important.
- No virtualizer dependency (docs/08 E7). Hand-roll the range math.
- A keystroke must not re-render the grid — assert it with a render counter.

Acceptance (all 5 harness viewports):
- .tablify-root measures exactly its host's padding box, including the 389 px squeezed host.
- Header stays aligned after scroll; frozen column drifts ≤ 1 px.
- Every editor input reports font-size ≥ 16px; every touch target ≥ 44×44 on phone viewports.
- 200 arrow presses keep the active cell in view with exactly one focused element and never
  scroll the page.
- A 5,000-row × 20-column fixture paints in ≤ 300 ms and scrolls at ≥ 55 fps.
- `grep -c '!important' styles.css` → 0.

Verification: paste raw `bun run check` and `bun run test:layout` output, plus the measured
paint time and fps. State explicitly which of the 13 harness assertions you could not make pass.
```

---

## 6 · M4 — Spreadsheet depth

```
Task: make it a real spreadsheet — ranges, clipboard, fill, bulk edit, undo, import, export.

Read: docs/01 (interaction model, import semantics), docs/02 (§write queue), docs/03 (mapping),
docs/08 (P4, P10), docs/07 (perf assertions).

Deliverable, one turn per item:
1. Range selection: shift-click, shift-arrows, whole row/column, select-all, touch toolbar toggle.
2. Clipboard in/out: TSV and HTML in both directions; parse HTML tables; paste a .csv/.xlsx file
   from the clipboard when the OS exposes it.
3. Fill down/right, clear selection, bulk column edit bottom-up (Cmd/Ctrl+Enter).
4. Undo/redo as single user-visible steps across multi-note writes.
5. Import: matrix → preview dialog (row count, folder, filename template, per-column type override,
   threshold warning with the .tabula alternative) → note creation → single undo step.
6. Export: selection or view → TSV/XLSX to clipboard or file. CSV stays Obsidian's.

Constraints: no new dependency without asking (XLSX export needs one — ask with name, size, why).
Import must never create notes without the preview confirming.

Acceptance:
- A 400 × 6 paste creates 400 correct notes as ONE undoable step, with progress feedback, in < 2 s
  on the harness path; undo removes exactly those notes.
- A value copied out to Sheets and back round-trips unchanged (values and structure).
- Importing 412 rows reports the true count and creates exactly that many notes; cancelling mid-run
  leaves no partial notes unreported.
- Export reproduces the visible values, verified by eye in Excel.

Verification: raw `bun run check` + harness output. Then paste the actual Excel/Sheets
round-trip result — and if you could not test it, say so plainly.
```

---

## 7 · M5 — Airtable sync

```
Task: optional sync behind a port, isolated so it cannot destabilise the grid.

Read: docs/02 (§Sync), docs/03 (§sync state, §sync behaviour table), docs/09 (network disclosure),
docs/08 (P7, P8, P9, E9).

Deliverable, one turn per item:
1. plugin/secrets.ts — token in SecretStorage only; settings UI; nothing in data.json.
2. sync/SyncTarget.ts port + LinkStore for .tablify/links/*.json.
3. Airtable client: pagination, retry/backoff, typed errors, chunked writes (10/req).
4. Pull/push engine with per-field three-way diff using the snapshot hashes.
5. Conflict review dialog (Modal): per-field side-by-side, bulk take-local/take-remote,
   visible count of what will be written where.
6. Dynamic import so startup never parses sync; badges driven by link state.
7. Tests with a mocked transport. No live API calls in CI.

Constraints: never modify Airtable schema. Never delete remote records from a local delete.
Never delete local notes from a remote delete. Token never in a vault file or data.json.

Acceptance: a pull changing 40 fields across 12 notes applies in one reviewable step; a
same-field conflict cannot be resolved silently; identical-remote-values resolve automatically;
`grep -r "<token-prefix>" <vault>` returns nothing; plugin startup time is unchanged when sync
is unused (measure and report both numbers).

Verification: raw `bun run check` + the two startup measurements + the vault grep result.
```

---

## 8 · Reusable prompts

### 8a · Adversarial review (use a *different* model than the one that wrote the code)

```
You are reviewing code you did not write. It claims to implement <feature> per <docs>.
Find the three most likely ways it fails in production, ranked. For each: the exact
file+line, the failing scenario, and the cheapest experiment that would demonstrate it.

Do not list strengths. Do not summarise the code. If you cannot find three real problems,
say so explicitly rather than padding — but first check: error paths, partial failures,
concurrent edits, empty/large inputs, and the mobile layout contract.

End with: what should I verify by hand that no test in this repo can check?
```

### 8b · Bug fix (the fork's 15-commit lesson, applied)

```
Bug: <observable behaviour, with device/viewport/OS>.

Do not fix anything yet. First:
1. Reproduce it in the harness. Add the assertion that fails on current code. Paste the failing
   output — this is the definition of done before you may touch implementation code.
2. State the root cause in one sentence, with the file+line that proves it.
3. Only then fix it, and paste the passing output plus confirmation that no other assertion regressed.

Constraints: no fix is accepted that cannot be expressed as a harness assertion. If the bug is
not reproducible in the harness, say so and stop — that is a finding, not a failure.
```

### 8c · Spike

```
Question: <the assumption you want to kill>.
Write ≤ 50 lines that prove or disprove it, on my real setup.
Report: the hypothesis, the exact command I run, the raw output, and your conclusion.
A failed spike is a successful outcome — report the failure plainly, do not "fix" the
experiment until it agrees with the docs.
```

### 8d · Session handoff (before context gets compacted)

```
Write a handoff note in markdown: current milestone and branch; what is complete and verified;
what is half-finished and where; decisions made this session (and whether they belong in
docs/08-decisions.md); open questions; files touched; and the exact next step, with the prompt
I should paste to resume. Be specific enough that a fresh session can continue without reading
this conversation.
```

### 8e · Audit the previous work

```
Audit your own previous output for this milestone:
1. Every Obsidian API used — cite file+symbol from node_modules/obsidian/obsidian.d.ts.
   Flag any that are uncited.
2. Every claim in your last summary — mark it VERIFIED (with the command) or ASSUMED (state how
   I would verify it).
3. Every file changed — confirm it is inside the stated fence. Flag anything outside.
4. Any place you used `any`, `!`, a bare catch, a skipped test, or a loosened assertion.
5. Anything in the milestone's acceptance criteria you did NOT actually demonstrate.
Do not fix anything yet. Just report.
```

---

## 9 · Prompt hygiene checklist (30 seconds, before you hit send)

- [ ] One goal, stated as an outcome.
- [ ] Files to read, by exact path.
- [ ] The fence: what may change, what may not.
- [ ] Acceptance criteria I can check myself.
- [ ] Verification: which commands, and raw output required.
- [ ] "Plan first, no code" — unless this is a follow-up step already planned.
- [ ] Placeholders `<…>` all replaced.
- [ ] Settled decisions explicitly marked as not up for discussion.
