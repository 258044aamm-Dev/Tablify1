# START HERE — paste-ready prompts

Everything in this file is **ready to paste**. No placeholders left to fill, except one optional value (your Obsidian version, already set to **1.13.0** from your answer).

**How to use it:** paste **Prompt 1** as the first message of a session. When the milestone is done, paste the next one. Each prompt stands alone — it re-anchors the agent, states the fence, and says exactly what evidence is required.

The method behind these prompts is `docs/11-prompting-guide.md`. The prompts are pre-filled from `docs/12-agent-prompt-pack.md`.

---

## Before you paste anything (10 minutes)

- [ ] **Create the repo.** Fresh `tablify` on GitHub, public, **no** README/license template (you're committing your own).
- [ ] **Put these 15 files in it**, at the root: `README.md`, `AGENTS.md`, and `docs/01-…` through `docs/12-…` plus `docs/manual-test-log.md`. (Download the whole `tablify/` folder from this workspace.)
- [ ] **Commit the docs as `docs: initial specification`.** Do this *before* the agent starts, so the M0 diff contains only code.
- [ ] `git init` if needed, then `git push`.
- [ ] **Confirm Bun:** `bun --version` → should print 1.4.x. If not installed: `curl -fsSL https://bun.sh/install | bash`.
- [ ] **Confirm your Obsidian version:** Settings → About → *Current version*. The prompts assume **1.13.x** (they set `minAppVersion: 1.13.0`). If yours differs, change that single number in Prompt 1 — and re-check it at M6, because `minAppVersion` must be a version you have actually tested on.
- [ ] **Create a dedicated dev vault** (not your real one) and symlink the plugin folder into it later, per `docs/05` §local development loop.

> Why the docs go in first: the agent is instructed to **stop if they're missing and not to reconstruct them from memory**. That single instruction is what prevents an agent from re-inventing your architecture from a plausible-sounding summary.

---

## Prompt 1 — M0 kickoff (paste this first)

```
You are implementing milestone M0 of Tablify, an Obsidian plugin. The repository already
contains the complete specification as documentation. It is settled: do not re-litigate it,
"improve" it, or work around it.

READ FIRST — in this order, and only these plus the files they reference:
1. AGENTS.md
2. docs/06-roadmap.md          → section "M0"
3. docs/05-toolchain-and-ci.md
4. docs/09-publishing.md
5. docs/10-verification-and-ai-hygiene.md → sections 5 and 6
6. docs/02-architecture.md     → the layer list, so the boundary placeholders are correct
If any of these files is missing, STOP and tell me. Do not reconstruct them from memory.

COMPREHENSION CHECK — do this first, then STOP:
Quote (a) the two rules in AGENTS.md you judge most likely to be broken by mistake,
(b) the M0 exit criteria from docs/06 verbatim, and (c) the verification requirements in
docs/10 §5 that you will be held to. Maximum 15 lines. Then wait for my approval.

TASK (only after I approve): stand up the repository skeleton so it builds, lints, tests and
could be released. No product code, no React, no grid, no runtime dependencies.

CREATE ONLY THESE FILES
- package.json · tsconfig.json · eslint.config.mts · .prettierrc · .editorconfig · .gitignore
- manifest.json · versions.json · CHANGELOG.md · LICENSE · NOTICE
- src/plugin/main.ts        minimal Plugin: registers one command that shows Notice("Tablify is installed")
- src/core/README.md · src/grid/README.md · src/adapters/README.md
                            boundary notes copied from AGENTS.md
- esbuild.config.mjs · scripts/bundle-size.ts · scripts/version-bump.ts
- tests/smoke.test.ts       one passing test, so the gate is wired from day one
- styles.css                empty file
- .github/workflows/ci.yml · .github/workflows/release.yml
Create nothing else. Do not modify anything under docs/ or AGENTS.md.

VALUES — use exactly these
  id: tablify · name: Tablify · version: 0.1.0 · minAppVersion: 1.13.0 · isDesktopOnly: false
  author: 258044aamm-Dev · authorUrl: https://github.com/258044aamm-Dev
  description: per docs/09 (≤250 chars, no "Obsidian", ends with a period)
  Bun scripts: exactly as docs/05 §package.json
  pins: packageManager bun@1.4.2 · esbuild ^0.25.0 · typescript ^5.8.0 · eslint ^9.39.0 ·
        eslint-plugin-obsidianmd ^0.4.0 · typescript-eslint ^8.59.0 · prettier ^3.4.0 ·
        vitest ^3.0.0 · @vitest/coverage-v8 ^3.0.0 · @playwright/test latest ·
        obsidian latest · @types/node ^22 · jsdom latest · tslib ^2.8.0
  tsconfig: exactly docs/05 §tsconfig.json — strict, noUncheckedIndexedAccess,
        exactOptionalPropertyTypes, verbatimModuleSyntax, noUnusedLocals/Parameters, paths
  eslint: base it on the official obsidian-sample-plugin shape (defineConfig, globalIgnores,
        projectService with allowDefaultProject, extraFileExtensions: ['.json'],
        obsidianmd.configs.recommended) then add typescript-eslint strictTypeChecked,
        the three architectural boundary blocks from docs/05 §eslint.config.mjs,
        the no-restricted-syntax rule banning addEventListener, and prettier last
  formatting: .editorconfig with tabs, indent 4, single quotes, LF (match the official template);
        Prettier configured to agree with it

ACCEPTANCE — I will check every one of these myself
1. `bun install && bun run check` passes on a clean checkout and prints the bundle size.
2. `bun run build` produces main.js; report its exact byte size (this calibrates the budget in docs/05).
3. Prove the core boundary rule actually bites: temporarily add src/core/_probe.ts that imports
   obsidian, show `bun run lint` failing on it, then delete the file. Paste both outputs.
4. Version bump: bump to 0.1.1, show package.json + manifest.json + versions.json all changed in
   one commit, then revert to 0.1.0.
5. The release workflow must refuse tag "v0.1.0" and accept "0.1.0". Implement that check and show
   it failing and then passing.

VERIFICATION — non-negotiable
Paste the RAW output of every command you run. Do not summarise it. If something fails, fix it and
re-run; do not report success until it passes. Finish with three lines:
  VERIFIED: <what you proved, with the command>
  NOT VERIFIED: <what you could not test>
  ASSUMED: <every assumption you made>

STOP AND ASK BEFORE
- adding any dependency (give me: name, size min+gzip, why it can't be hand-rolled)
- deviating from any file or config shown in docs/05 or docs/09
- creating any file outside the list above
- choosing a different minAppVersion
- if you believe a doc is wrong: report file + line + what you'd change. Never silently deviate.

OUTPUT FORMAT
Turn 1: the comprehension check only. Then stop.
Turn 2 (after my approval): the plan, max 15 lines — files, commands, acceptance. Then stop.
Turn 3: write the code, run the gates, paste the raw output.
```

---

## How to judge the first reply

**Accept it if** it quotes real rules from `AGENTS.md` — not paraphrases of the *idea* of rules — quotes the M0 exit criteria verbatim, and names commands from `docs/05`. Then it should **stop**.

**Reject and re-paste if you see:**

| Symptom | What it means | What to do |
|---|---|---|
| It says "I've created the files" before any approval | Ignored plan-first | Re-paste from "COMPREHENSION CHECK … Then stop" |
| It paraphrases rules instead of quoting them | It never opened `AGENTS.md` | "Quote them verbatim with their section headings, then stop" |
| It says it will use `pnpm`/`npm`, React 18, or the tanstack virtualizer | It's working from training data, not your docs | "docs/08 E1/E4/E7 are decisions. Use Bun, React 19, hand-rolled windowing." |
| It proposes files outside the list (e.g. a `src/utils/` tree) | Scope drift before a single line exists | "Fence: only the files listed. Re-plan." |
| "This should work" / "I believe" | Nothing was run | "Paste raw output for each acceptance item." |
| It skips acceptance item 3 or 5 (the ones that prove the gates work) | The gate is decorative | "Items 3 and 5 are not optional — they prove the gate exists." |

The M0 milestone has one purpose beyond wiring: **it tells you whether your agent respects fences.** If it does not, stop and fix the prompting before M1 — the cost of that discovery goes up by an order of magnitude per milestone.

---

## Prompt 2 — M1 core domain

```
You are implementing milestone M1 of Tablify. Settled context: AGENTS.md and all rows of
docs/08-decisions.md — do not re-open them.

READ: docs/02-architecture.md (§field-type registry, §Query), docs/03-data-model-and-migration.md
(the field→frontmatter mapping table is the spec), docs/08-decisions.md (P11, P12, E2),
docs/10-verification-and-ai-hygiene.md §5, AGENTS.md.

TASK: build src/core — pure TypeScript. No Obsidian, no React, no DOM.

Deliver, ONE TURN AT A TIME (stop for my approval after each):
1. core/fieldTypes/types.ts — the FieldDescriptor interface exactly as in docs/02.
2. One file per field type: the 13 surviving types from the docs/03 mapping table. Each declares
   parse, toYaml, formatDisplay, formatPlain, parsePlain, filterOps, matches, compare, groupKey,
   defaultValue.
3. core/fieldTypes/registry.ts — registration and lookup. No switch statements outside this directory.
4. core/query/ — Expr AST, parseQueryString, toQueryString, evaluate.
5. core/ops/ — Op types, reducers, inverses (for undo).
6. core/selection/ — ranges, anchors, the clipboard matrix model (TSV and HTML).
7. Tests for all of the above, including ONE shared contract suite that iterates the registry
   (the suite is the spec: parse(formatDisplay(v)) === v, formatPlain round-trips through parsePlain,
   toYaml yields a YAML-safe scalar or list, compare is a total order, every declared filterOp is
   implemented).

CONSTRAINTS
- Zero imports of obsidian or react anywhere in core/ — the ESLint boundary rule must pass.
- No switch (field.type) or switch on any type discriminant outside core/fieldTypes/.
- No new dependencies. No `any`, no `!`, no bare catch.
- Undo correctness as a property: apply(undo(apply(x))) === x, tested over generated op sequences.

ACCEPTANCE
- The shared contract suite passes for every registered type.
- Coverage ≥ 85% lines/functions on core/, thresholds wired in vitest.config.ts and passing.
- Tell me the honest count: how many files must a developer touch to add field type #14?

VERIFICATION: paste raw `bun run check` output.

STOP AND ASK BEFORE: adding a dependency, changing a field-type mapping in docs/03, or if a
documented behaviour can't be expressed in the descriptor interface (that's a design finding —
report it, don't patch around it).

OUTPUT FORMAT: plan first (max 15 lines), then stop. Then implement item 1 only, paste output,
and stop for approval before item 2.
```

---

## Prompt 3 — M2 data layer (spike first)

```
You are implementing milestone M2 of Tablify. Settled context: AGENTS.md and docs/08-decisions.md.

READ: docs/02-architecture.md (§RowSource, §Write queue, §Bases integration), docs/03-data-model-and-migration.md
(write rules, sync state), docs/10 §4 (the spike list), docs/08 (P2, P8, E7).

STEP 1 — SPIKE ONLY (≤ 50 lines, nothing else yet):
Write a throwaway Bases view that, in onDataUpdated(), logs to the console:
  - config.getOrder() and config.getSort()
  - this.data.data.length and this.data.data[0].file.path
  - the raw value and the typed Value of one property via getValue()
Then change one property in a note via app.fileManager.processFrontMatter and diff the note
before/after.
Report: (a) does the data path behave as docs/02 describes? (b) does the write preserve unknown
frontmatter keys? (c) the raw console output and the raw diff (e) any way the real API differs from
the docs. If it differs, STOP and report — do not code around it.

STEP 2 — only after I confirm the spike:
- adapters/RowSource.ts (the port, exactly as in docs/02)
- adapters/writeQueue.ts (coalesce per file+property, serialize per file, rollback, flush)
- adapters/bases/BasesSource.ts
- adapters/tabulaFile/ (read-only parser for v1 and v2, ported from the fork's parseTableFileDocument)
- the note-creation service — prefer BasesView.createFileForView(baseFileName, frontmatterProcessor)
  (@since 1.10.2; cite it from node_modules/obsidian/obsidian.d.ts); fall back to manual creation
  when a specific folder is required
- tests against tests/fakes/vault.ts — NEVER a real vault

CONSTRAINTS: adapters must not import react. Never vault.modify() for a property change.
Clearing a value deletes the key. No sync code in this milestone.

ACCEPTANCE
- 12 property writes to one file within a tick produce exactly ONE processFrontMatter call.
- Interleaved writes from two sources are serialized with nothing lost.
- A failing write drops only the affected optimistic overlay and returns a per-file error.
- Unknown frontmatter keys survive a full write cycle untouched.
- flush() resolves only after the last write resolves.

VERIFICATION: raw `bun run check`, plus the spike's console output and the note diff.
Then: VERIFIED / NOT VERIFIED / ASSUMED.

STOP AND ASK BEFORE: adding a dependency, touching React, or if the spike shows the documented
API doesn't exist as written.

OUTPUT FORMAT: plan (max 15 lines) → stop → spike → stop → implement.
```

---

## Prompt 4 — M3 grid v1

```
You are implementing milestone M3 of Tablify: the grid itself. Settled: AGENTS.md, docs/08-decisions.md.

READ: docs/02 (§Store, §Grid rendering, §Performance budget), docs/04 (all of it), docs/01 §interaction
model, docs/07 (harness tiers + the viewport matrix), docs/10 §5.

Deliver, ONE TURN PER ITEM, stopping for approval between items:
1. grid/styles/tokens.css + brand.css (placeholder values from docs/04) + grid.css. Zero !important.
2. grid/store.ts + selectors.ts — hand-rolled store on useSyncExternalStore, narrow selectors,
   optimistic overlay, command dispatch.
3. GridView.tsx — ONE scroller; .tablify-root { position: absolute; inset: 0 }; row windowing
   (fixed per-density heights, overscan 8, hand-rolled — do not add a virtualizer); sticky header and
   frozen column as transformed layers updated in requestAnimationFrame.
4. Cell editors for every field type, driven by the registry's editor id. Read-only cells are
   disabled with a reason, never editable inputs that discard input.
5. Keyboard model: exactly one handler, roving tabindex, the full key table from docs/01.
6. Resize/reorder via one pointer-capture handler on the container (no document listeners);
   context menus via Obsidian Menu; overlays via Obsidian Modal.
7. harness/ — a static page mounting the real GridView against a fixture RowSource, plus the
   Playwright spec with all 13 assertions from docs/07 §Tier 4.

CONSTRAINTS: no percentage-height chains, no ResizeObserver height anchors, no 100vh, no !important,
no window.addEventListener (registerDomEvent or React effect cleanup only), no virtualizer dependency.

ACCEPTANCE — all five harness viewports (desktop, desktop-dark, phone-closed, phone-keyboard, tablet)
- .tablify-root measures exactly its host's padding box, including the 389 px squeezed host.
- Header stays aligned after horizontal and vertical scroll; frozen column drifts ≤ 1 px.
- Every editor input reports font-size ≥ 16px; every touch target ≥ 44×44 on phone viewports.
- 200 arrow presses keep the active cell in view, keep exactly one focused element, and never scroll the page.
- Typing in a cell does not move scroll position, and does not re-render the grid (assert with a
  render counter).
- A 5,000-row × 20-column fixture paints in ≤ 300 ms and scrolls at ≥ 55 fps.
- `grep -c '!important' styles.css` → 0.

VERIFICATION: raw `bun run check` and `bun run test:layout` output, plus the measured paint time and
fps. State explicitly which of the 13 assertions you could NOT make pass.

STOP AND ASK BEFORE: any dependency, any layout change that isn't the documented contract, or if an
acceptance number cannot be met (report the real number — do not move the goalposts in the docs).
```

---

## Prompt 5 — M4 spreadsheet depth

```
You are implementing milestone M4 of Tablify: the spreadsheet behaviour that justifies the plugin.
Settled: AGENTS.md, docs/08-decisions.md.

READ: docs/01 (interaction model + import semantics), docs/02 §write queue, docs/03 (mapping),
docs/08 (P4, P10), docs/07 §performance assertions.

Deliver, ONE TURN PER ITEM, stopping for approval between items:
1. Range selection: shift-click, shift-arrows, whole row/column, select-all, and a touch toolbar toggle.
2. Clipboard in and out: TSV and HTML both directions; parse pasted HTML tables; paste a .csv/.xlsx
   file from the clipboard when the OS exposes it.
3. Fill down/right; clear selection; bulk column edit bottom-up (Cmd/Ctrl+Enter).
4. Undo/redo as single user-visible steps across multi-note writes.
5. Import: matrix → preview dialog (row count, folder, filename template, per-column type override,
   threshold warning with the .tabula alternative) → note creation → one undo step.
6. Export: selection or view → TSV/XLSX to clipboard or file. CSV stays Obsidian's.

CONSTRAINTS: no new dependency without asking (XLSX export will need one — ask with name, size
min+gzip, and why it can't be hand-rolled). Import must never create a note before the preview
confirms. Undo of a paste must remove exactly the notes it created, and nothing else.

ACCEPTANCE
- A 400 × 6 paste creates 400 correct notes as ONE undoable step, with progress feedback, in < 2 s on
  the harness path; undo removes exactly those 400 notes.
- Copy a range out to Google Sheets, paste it back: values and structure round-trip unchanged.
- Importing 412 rows reports the true count, creates exactly that many notes, and cancelling mid-run
  leaves no unreported partial notes.
- Export reproduces the visible values; verified by eye in Excel.

VERIFICATION: raw `bun run check` + harness output, plus the actual Excel/Sheets round-trip result.
If you could not test something, say so plainly rather than implying coverage.
```

---

## Prompt 6 — M5 Airtable sync

```
You are implementing milestone M5 of Tablify: optional Airtable sync, isolated so it cannot
destabilise the grid. Settled: AGENTS.md, docs/08-decisions.md (P7, P8, P9, E9).

READ: docs/02 §Sync, docs/03 (§sync state, §sync behaviour table), docs/09 (network disclosure),
docs/10 §5.

Deliver, ONE TURN PER ITEM, stopping for approval between items:
1. plugin/secrets.ts — token in SecretStorage only; settings UI; nothing in data.json, ever.
2. sync/SyncTarget.ts port + the link store for .tablify/links/*.json.
3. Airtable client: pagination, retry/backoff, typed errors, chunked writes (10 per request).
4. Pull/push engine with per-field three-way diff using the snapshot hashes.
5. Conflict review dialog (Obsidian Modal): per-field side-by-side, bulk take-local / take-remote,
   and a visible count of what will be written where.
6. Dynamic import so startup never parses sync code; badges driven by link state.
7. Tests with a mocked transport. No live API calls in CI.

CONSTRAINTS: never modify Airtable schema. Never delete remote records from a local delete. Never
delete local notes from a remote delete. The token must never appear in a vault file or data.json.

ACCEPTANCE
- A pull changing 40 fields across 12 notes applies in one reviewable step.
- A same-field conflict cannot be resolved silently; identical remote values resolve automatically.
- `grep -r "<token prefix>" <vault>` returns nothing.
- Plugin startup time is unchanged when sync is unused — measure both numbers and report them.

VERIFICATION: raw `bun run check`, the two startup measurements, and the vault grep result.
```

---

## Prompt 7 — M6 publish

```
You are implementing milestone M6 of Tablify: publish it. Settled: AGENTS.md, docs/08-decisions.md.

READ: docs/09 (all of it), docs/06 §M6, docs/04 §Branding constraints, docs/07 §Tier 5,
docs/manual-test-log.md.

Deliver:
1. README: purpose, install, usage, screenshots, limitations, and the network-use disclosure
   verbatim in substance from docs/09.
2. The .tabula migration command, tested end-to-end on a real legacy file (fixtures exist: docs/07 §Fixtures).
3. Rollback instructions stored with the migration report.
4. A release prep script: verify manifest/package/versions.json agree, tag shape, and that the three
   assets would be produced.
5. A pre-submission report against the docs/09 checklist, item by item, honestly.

CONSTRAINTS: no third-party company name anywhere in manifest, description, README headings, settings
copy or screenshots (docs/04 §Branding constraints is a hard rule, not a style note).

ACCEPTANCE: the docs/09 pre-submission checklist is satisfied item by item; a stranger's path works —
fresh vault → install → create a base → edit → import → migrate a legacy file → sync — and I will run
it on desktop AND my phone.

VERIFICATION: raw output of the release prep script and the checklist with each item marked and
evidenced. Anything unverified gets marked unverified, not skipped.
```

---

## Reusable prompts (paste any time)

### Audit my own work

```
Audit your previous output for this milestone. Do not fix anything yet — report only.
1. Every Obsidian API you used: cite file + symbol + @since from node_modules/obsidian/obsidian.d.ts.
   Flag any you cannot cite.
2. Every claim in your last summary: mark VERIFIED (with the command that proves it) or ASSUMED
   (with how I would verify it).
3. Every file you changed: confirm it is inside the fence. Flag anything outside it.
4. Every place you used `any`, `!`, a bare catch, a skipped test, or a loosened assertion.
5. Every acceptance criterion you did NOT actually demonstrate.
```

### Bug fix — failing test first

```
Bug: <observable behaviour, with device, viewport and OS>.
Do not fix anything yet. First: reproduce it in the harness, add the assertion that fails on current
code, and paste the failing output — that is the definition of done before touching implementation
code. Then state the root cause in one sentence with the file + line that proves it. Only then fix it,
and paste the passing output plus confirmation that no other assertion regressed.
No fix is accepted that cannot be expressed as a harness assertion. If it isn't reproducible in the
harness, say so and stop — that is a finding, not a failure.
```

### Spike

```
Question: <the assumption you want to kill>.
Write ≤ 50 lines that prove or disprove it on my real setup. Report the hypothesis, the exact command
I run, the raw output, and your conclusion. A failed spike is a successful outcome — report the failure
plainly and do not "fix" the experiment until it agrees with the docs.
```

### Adversarial review (use a different model than the one that wrote the code)

```
You are reviewing code you did not write. It claims to implement <feature> per docs/<n>.
Find the three most likely ways it fails in production, ranked. For each: exact file + line, the
failing scenario, and the cheapest experiment that demonstrates it. Do not list strengths or summarise
the code. First check: error paths, partial failures, concurrent edits, empty and large inputs, and the
mobile layout contract. End with: what should I verify by hand that no test in this repo can check?
```

### Session handoff (before context gets compacted)

```
Write a handoff note: current milestone and branch; what is complete and verified; what is
half-finished and where; decisions made this session and whether they belong in docs/08-decisions.md;
open questions; files touched; and the exact next step, with the prompt I should paste to resume.
Specific enough that a fresh session continues without reading this conversation.
```

---

## If you paste into an agent with no file access

Give it this preamble instead of the "READ FIRST" list, and expect lower quality — it cannot verify anything against your real files:

```
I'm giving you a specification in pieces. Before answering, ask me for any file you need.
Hard rules you must not break, whatever the spec says: pure TypeScript in src/core (no Obsidian, no
React imports); no !important in CSS; the grid root is position: absolute; inset: 0 and never a
percentage height chain; Obsidian Modal/Scope/registerDomEvent instead of hand-rolled overlays and
window.addEventListener; no new dependency without asking; every Obsidian API you use must be cited
from obsidian.d.ts or flagged as unverified. Never modify manifest.json's id. If something is
ambiguous, ask instead of inventing.
Now here is the task: <paste the milestone prompt>.
```

---

## The ten things that make these prompts work

1. **Plan-first, then stop.** Cheapest error-catching step that exists.
2. **A comprehension check with quotes** — not paraphrase. Proves the docs were actually read.
3. **A file fence.** Named files only; `git diff --stat` proves compliance.
4. **Exact values inline** (ids, versions, pins). Nothing for the agent to guess.
5. **Acceptance criteria you can check yourself**, including the two items that prove the *gates* work.
6. **Raw output demanded.** No output, no merge.
7. **Stop-and-ask lists** — including "if you think a doc is wrong, report the line."
8. **VERIFIED / NOT VERIFIED / ASSUMED** at the end of every turn.
9. **One turn per item** in multi-item milestones.
10. **A failed spike counts as success** — you are buying information, not agreement.
