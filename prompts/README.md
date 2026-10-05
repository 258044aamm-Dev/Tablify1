# Tablify — implementation prompt pack

Step-by-step, copy-paste prompts for building the plugin. Method behind them: `docs/11-prompting-guide.md`.
The prompts assume an agent that can **read files and run commands** in a checkout of this repository
(Claude Code, Codex CLI, Cursor, or any agent with shell access). If your agent can only accept text,
attach the files each prompt names and paste the prompt anyway — every prompt lists what it needs.

## The one rule that prevents most errors

> **One file = one prompt = one turn. Never paste the next step until the gate of the current step is green.**

A step is not "done" because the agent says it is done. It is done when you have seen:

1. the raw output of the gate command for that step (each step names it), and
2. the report the step asks for, and
3. a commit that matches what was reported.

If any of those three is missing, the step is not finished. Do not continue.

## Pre-flight (about 15 minutes, once)

```bash
# 1. the repository (the docs and the reference prototype must be in it)
cd <your checkout of 258044aamm-Dev/Tablify>
git status                      # expect a clean tree before you start

# 2. the reference prototype belongs in the repo as read-only evidence (2.1 MB, 31 files)
git add prototype tools DESIGN-REVIEW.md PLAN-ui-ux-pass.md PLAN-style-audit-notes \
        PROTOTYPE-FREEZE.md PROCEED-ASSUMPTION-2026-10-05.md prompts
git commit -m "docs: add the reference prototype, the design record and the prompt pack"
git push

# 3. the fork stays out of this repository — archive it and keep it as the .tabula reference
#    (clone it next to this repo if you need to read its LICENSE and its parser)
#    git clone https://github.com/258044aamm-Dev/airtable-tabula ../airtable-tabula

# 4. toolchain
bun --version                   # 1.4.2 or newer
node --version                  # 20 or newer

# 5. security: do not paste tokens into prompts and do not put them in files
gh auth status                  # use gh auth login / a credential helper for pushes
```

If you ever pasted a personal access token into a chat, a file or a commit: **revoke it** and create a new
one. Never let a prompt contain a secret; no step in this pack asks for one.

## The loop

```
paste 00-session-anchor.md            (every session, first)
paste step-NN-*.md                    (one step)
  → the agent plans and waits
  → you approve (or correct) the plan
  → the agent implements and reports
  → you run the gate yourself, or read the output it pasted
  → if red: paste reuse-bugfix.md with the failing output
  → if green: at the end of a wave, paste reuse-adversarial.md (a different model if you have one)
  → commit is already part of the step; check `git log` matches the report
next step
```

## Step index

| # | file | produces | gate |
|---|---|---|---|
| 01 | `step-01-toolchain-and-gate.md` | package.json, tsconfig, ESLint 9 flat, Prettier, .editorconfig, .gitignore, vitest config, `scripts/bundle-size.ts` | `bun run check` green on an empty `src/` |
| 02 | `step-02-manifest-and-legal.md` | `manifest.json`, `versions.json`, `CHANGELOG.md`, `LICENSE`, `NOTICE`, `README.md` skeleton, `scripts/brand-gate.ts` | `bun run check` + brand gate + manifest validation |
| 03 | `step-03-plugin-shell-and-build.md` | `src/plugin/main.ts` (command + Notice), esbuild config, dev watch, jsdom load test, `scripts/release-assets.ts` | `bun run check` + a produced `main.js` with its size |
| 04 | `step-04-ci-and-release.md` | `.github/workflows/ci.yml`, `release.yml`, tag/version guard | the CI job's steps run green locally, in order |
| 05 | `step-05-fakes-boundaries-coverage.md` | `tests/fakes/*`, ESLint boundary rules, coverage thresholds | `bun run check` + the boundary lint test |
| 06 | `step-06-field-contract-schema-registry.md` | `core/schema`, `FieldDescriptor`, registry, the shared contract suite | contract suite green for the one reference type |
| 07 | `step-07-field-types.md` | one file per surviving field type (the mapping table in `docs/03` is the list) | the contract suite green for **every** type |
| 08 | `step-08-query-and-pipeline.md` | query AST, DSL parser + serialiser, evaluator, filter/sort/group pipeline | query table tests + legacy DSL compatibility |
| 09 | `step-09-ops-undo-selection.md` | ops + inverses, undo/redo stack, selection ranges, clipboard matrix model | `apply(undo(apply(x))) === x` property tests |
| 10 | `step-10-bases-spike.md` | a ≤ 50-line throwaway Bases view that prints the real data path (**STOP gate**) | raw console output + a real note diff |
| 11 | `step-11-rowsource-and-writequeue.md` | `adapters/RowSource`, `adapters/writeQueue` | 12 writes → 1 `processFrontMatter`, rollback, `flush()` |
| 12 | `step-12-basessource-and-note-creation.md` | `adapters/bases/BasesSource`, note creation service | fake-vault tests + one real edit in a vault |
| 13 | `step-13-tabula-adapter-and-migration.md` | read-only `.tabula` v1/v2 parser, migration dry-run service | committed fixtures, corrupt file reports cleanly |
| 14 | `step-14-settings-persistence.md` | settings schema, `data.json` migration, settings tab rows | settings round-trip + old-`data.json` fixture |
| 15 | `step-15-tokens-css-and-contrast-gate.md` | `styles/tokens.css`, `brand.css`, `grid.css` skeleton, `scripts/contrast.ts` | zero `!important`, contrast gate green |
| 16 | `step-16-store-and-selectors.md` | store on `useSyncExternalStore`, commands, optimistic overlay | typing re-renders one cell (render counter) |
| 17 | `step-17-gridview-layout-contract.md` | `GridView.tsx` windowing, sticky header, frozen column ≥ 600 px pane | the 389 px host fills exactly; 5,000 rows ≤ 300 ms |
| 18 | `step-18-cell-editors.md` | one editor per field type, read-only reasons | every editor ≥ 16px, targets ≥ 44px |
| 19 | `step-19-keyboard-and-a11y.md` | one key handler, roving `tabindex`, the full key table, focus contract | 200 arrows in view, one focused element, no page scroll |
| 20 | `step-20-pointer-interactions.md` | resize/reorder/fill by pointer capture, Obsidian `Menu` + `Modal` | drag tests in the harness |
| 21 | `step-21-harness-and-playwright.md` | `harness/` + the Tier-4 spec, all five viewports | **all 13 assertions** from `docs/07` §Tier 4 |
| 22 | `step-22-ranges-clipboard-fill.md` | range selection, TSV/HTML both ways, fill down/right, clear | 400 × 6 paste < 2 s, round-trip through Sheets |
| 23 | `step-23-undo-bulk-edit-import.md` | multi-note undo as one step, bulk column edit, import wizard | 412-row XLSX tells the truth; one undo step |
| 24 | `step-24-export.md` | TSV/XLSX export to clipboard and file (ask before the dependency) | exported file opens with the visible values |
| 25 | `step-25-sync-port-secrets-client.md` | `SecretStorage` token, `SyncTarget` port, link store, Airtable client | mocked transport: pagination, backoff, typed errors |
| 26 | `step-26-sync-diff-and-conflict-review.md` | pull/push three-way diff, conflict review dialog, dynamic import | 40 fields / 12 notes in one reviewable step |
| 27 | `step-27-mobile-and-a11y-pass.md` | the phone matrix end to end, touch affordances, hit sizes | `phone-closed` + `phone-keyboard` green by hand |
| 28 | `step-28-publish.md` | README with the network disclosure, screenshots, manual log, `1.0.0`, tag, three release assets | a clean release + the submission checklist |

### Reusable prompts (paste whenever they apply, not in the sequence)

| file | when |
|---|---|
| `reuse-verify.md` | after any step, if you want a second opinion on the report before you trust it |
| `reuse-bugfix.md` | the moment a gate goes red — the only correct response to red |
| `reuse-adversarial.md` | end of every wave, ideally with a different model than the one that wrote the code |
| `reuse-handoff.md` | before context runs out, before a long break, or when the agent starts repeating itself |
| `reuse-release-check.md` | before tagging anything, and again before submitting to the community directory |

## The gate

```bash
bun run check     # typecheck → lint → format:check → test → build → size
```

Expected on success: each stage's own output, ending with the bundle size and no error line.
`bun run check` is the *minimum* gate: each step names any additional command (layout suite, contrast
gate, brand gate, spike output). Two extra rules:

- A step is not verified on your machine until `bun run check` has run **on a clean tree**
  (`git stash -u` if you must) — the CI runs it that way and it must pass there too.
- The layout suite (`bun run test:layout`) and the contrast gate are **not** optional at any point after
  step 21; a red one blocks the next step exactly like a red `check`.

## PROGRESS.md protocol

The agent creates and maintains this file at the repo root. It is how a fresh session continues without
reading the whole conversation. Template (the agent fills it in; you only read it):

```markdown
# PROGRESS
- Milestone: M<n> — <name>          Branch: <branch>
- Last completed step: <step id + one line of what it produced, with the gate result>
- Verified: <the commands that were run and their observed results>
- Assumed / not verified: <list, each with how to verify>
- Half-finished: <files, what is missing, what is at risk>
- Open questions for the human: <numbered, each with a default proposal>
- Next step: <the exact file to paste next>
- Files touched this step: <paths>
```

## Error protocol

| situation | do this |
|---|---|
| a gate is red | paste `reuse-bugfix.md` with the raw failing output. Never let the agent "fix" it by relaxing a test |
| the agent says a step is done but the gate was not pasted | ask for the raw output; if it cannot produce it, the step is not done |
| the agent wants to add a dependency | decide deliberately: name, version, size, why; then say yes or no in one line |
| the agent wants to change `docs/**` or a decision | say no unless the doc is factually wrong; factual fixes go through `reuse-verify.md` first |
| three attempts at the same red gate | stop. Paste `reuse-handoff.md`, then bring the handoff to a different model |
| the agent "improves" something outside the step | revert that hunk (`git checkout -- <file>`), restate the fence, continue |
| you have lost track of state | paste `reuse-handoff.md`, then `00-session-anchor.md` in the next session |

## The ten failure modes this pack is built to prevent

1. **A gate that does not exist yet.** Step 01 wires `bun run check` before any product code, so every later
   step has something to fail.
2. **A layout regression nobody notices.** The 389 px squeezed-host fixture (step 21, assertion 2) encodes
   the historical failure as a test.
3. **`!important` and percentage-height chains.** Banned in step 15 and asserted in the harness.
4. **Writing properties with the wrong API.** `processFrontMatter` only, never `vault.modify` (steps 11–12),
   proven by the fake vault's write log.
5. **Losing unknown frontmatter keys.** An explicit Tier-2 assertion in step 11.
6. **A token in `data.json`.** `SecretStorage` only, with a vault grep as the acceptance test (step 25).
7. **An API that does not exist.** Every Obsidian API used must be cited from
   `node_modules/obsidian/obsidian.d.ts` with its `@since`; step 10 is a real-machine spike before the
   adapter is written.
8. **A version/tag mismatch that breaks the release.** `scripts/release-assets.ts` validates tag ==
   `manifest.version` and produces exactly three assets (steps 03–04).
9. **A bundle that grows silently.** `bun run size` is part of `check` and fails over budget (steps 01, 03).
10. **A brand problem that blocks review.** The grep gate for reserved names/marks is a script (step 02),
    not a good intention.

## What the reference prototype is for

`prototype/` is a working model of the same product (2.1 MB, plain JS, its own tests). Use it to answer
*behaviour* questions the docs leave open — what fill-down does at the edge of a range, what the import
preview shows, how the conflict dialog words a choice. Never: import it, copy its file layout, let its
classes leak into the plugin, or add it to lint/typecheck/build. If the prototype and the docs disagree,
the docs win and you report the disagreement.

## When you are done

`step-28-publish.md` ends with the submission checklist from `docs/09-publishing.md`. Keep `PROGRESS.md`
for the first post-release session — it is your changelog and your rollback map.
