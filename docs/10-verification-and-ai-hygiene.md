# 10 — Verifying AI output, and keeping this project honest

Every document in this set was written by an AI. That is not automatically a problem, but it changes *what you must do* before trusting it. This file is the method, plus an honest audit of this doc set's own claims.

**The core principle:** an AI is a fast, fluent, sometimes-wrong author who never says "I'm not sure" unless asked, and who can produce a confident sentence about an API that does not exist. Never verify AI output by reading it more carefully. Verify it by **executing something real** — a compiler, a test, a type definition, the app itself.

---

## 1. Why AI verification is a different problem

| Failure mode | What it looks like | Why reading does not catch it |
|---|---|---|
| **Hallucinated API** | A method, option, config key or file path that sounds exactly right and does not exist | Plausible prose is indistinguishable from correct prose |
| **Version drift** | Correct last year, wrong today (renamed option, changed default, retired flow) | The document reads identically either way |
| **Confident summary of a secondary source** | "X is recommended" from a blog that paraphrased a forum post | Each hop looks authoritative |
| **Scope invention** | Adds a feature nobody asked for, or silently drops a requirement | Sounds like a helpful simplification |
| **Test theatre** | "All checks passed" — with tests that assert mocks, or that were weakened until green | The claim is about a run you did not see |
| **Silent weakening** | A `try/catch` that swallows an error, an `as any`, a `!` on a possibly-null value | Each line looks locally reasonable |

The asymmetry that matters: **AI errors cluster exactly where confidence is highest.** So rank verification by *consequence × uncertainty*, not by how suspicious the text sounds.

---

## 2. Three layers of verification

### Layer 1 — Deterministic gates (let machines verify machines)

These decide for you, and they cannot be talked out of a verdict:

| Gate | Verifies | Fails when |
|---|---|---|
| `tsc --noEmit` | Types, imports, signatures, exhaustiveness | Any API that does not exist or has the wrong shape |
| ESLint + boundary rules | Architecture (pure `core`, no raw listeners, no `any`) | The code drifted across a layer |
| Vitest | Domain logic, ops inverses, adapter behaviour | Logic, not style, is wrong |
| Playwright harness | Layout, geometry, interaction, behaviour at 5 viewports | Any UI claim that is not true |
| Bundle-size script | Dependency creep, startup cost | A dependency quietly landed |
| `git diff` | Scope | The agent touched files it was not asked to |

Rule: **the agent's summary is never the evidence.** Ask for the command and its raw output; re-run it yourself. If a claim cannot be expressed as a gate, it belongs in Layer 2 or 3 — and you should be more suspicious of it, not less.

### Layer 2 — The claim ledger (how you verify prose)

Every factual claim in a document gets one line:

```
CLAIM · STATUS · SOURCE · HOW YOU VERIFY IT · DATE CHECKED
```

Statuses: `VERIFIED` (checked against a primary source) · `ASSUMED` (plausible, unverified) · `WRONG` (was wrong, corrected) · `STALE` (verified once, must be re-checked at a date).

Rules:
1. **Primary sources only:** official docs, the actual `.d.ts`, npm registry metadata, a cloned repo, the app itself. Blogs and forum posts are *pointers*, never evidence.
2. Every claim about a version number or an API carries the version it was true for.
3. Anything `ASSUMED` blocks the phase that depends on it.
4. Re-verify `STALE` claims at each milestone boundary — APIs move while docs sit still.
5. **The ledger lives in the repo, not in a chat.** Regenerate or update it in the same commit as the code it describes.

### Layer 3 — Adversarial review (a second, differently-wrong reader)

- Have a **different model or person** review the same artifact. Models fail in different directions; a second reader catches a different class of error than the one that wrote it.
- Ask for **falsification, not validation**: "What would prove this wrong? What is the cheapest experiment that fails if this is false?" An answer that cannot name a failing experiment is not a verified claim.
- For any expensive architectural bet, write the **spike** before the plan: a 30-line program beats 3,000 words of design. Example below in §4.

---

## 3. Claim ledger for this doc set

Audited 2026-10-05. `✅` verified · `⚠️` assumed (blocking) · `🛠` was wrong, corrected.

| # | Claim | Status | Evidence / how to verify |
|---|---|---|---|
| 1 | `BasesView` API exists, `@since 1.10.0`; `createFileForView` + `getEvaluatedFormula` are `@since 1.10.2` | ✅ | Read `@since` tags in `node_modules/obsidian/obsidian.d.ts` (npm `obsidian@1.13.1`, downloaded and grepped) |
| 2 | **The Bases view API has no write API** — `BasesEntry` is only `{ file: TFile, getValue(propertyId) }` | ✅ | Same file. Grep: `awk '/^export class BasesEntry/,/^}/' obsidian.d.ts` |
| 3 | `BasesView.data` is replaced on every update; entries are recreated ⇒ never hold references | ✅ | Verbatim doc comment above `data` in `obsidian.d.ts` |
| 4 | `QueryController` is an empty class publicly — data must come from `this.data` | ✅ | `awk '/class QueryController/,/^}/' obsidian.d.ts` → empty body |
| 5 | `config.getOrder()`, `config.getSort()`, `config.set(key, value)` exist | ✅ | `BasesViewConfig` body in `obsidian.d.ts` |
| 6 | `registerBasesView(viewId, registration): boolean`, `false` when Bases is disabled | ✅ | Signature + official "Build a Bases view" guide |
| 7 | Property ids are prefixed: `note.*` / `file.*` / `formula.*` | 🛠 | `BasesPropertyId` template type in `obsidian.d.ts`. **This doc set originally used bare names — corrected** |
| 8 | `.base` schema: `filters`, `formulas`, `properties.<id>.displayName`, `summaries`, `views[]` with `type/name/filters/groupBy/order/summaries` | ✅ | Official Bases syntax help page + `BasesConfigFile` / `BasesConfigFileView` types |
| 9 | `fileManager.processFrontMatter()` is atomic and is the correct write path | ✅ | Official API reference |
| 10 | Bases ships table, cards, list, map, **kanban** layouts and **native CSV export** | ✅ | Official Obsidian changelog (kanban scroll fix; "Fixed exporting a view as a CSV file") |
| 11 | App stable is **1.14.4** (2026-10-01); npm types package latest is **1.13.1** | ✅ | `obsidian.md/changelog`; `registry.npmjs.org/obsidian` |
| 12 | Submission goes through `community.obsidian.md` (dashboard), automatic review, tag must equal `manifest.version`, assets uploaded separately, `id` unique and cannot contain `obsidian` | ✅ | Official "Submit your plugin" page |
| 13 | Official sample plugin ships ESLint 9 + `eslint-plugin-obsidianmd` + `typescript-eslint` + esbuild, an `AGENTS.md`, an `.editorconfig`, and **no Prettier** | ✅ | Cloned `obsidianmd/obsidian-sample-plugin` and read `package.json`, `eslint.config.mts`, `tsconfig.json` |
| 14 | Dev versions: `eslint-plugin-obsidianmd` 0.4.2, `esbuild` 0.25.5, `eslint` ^9.39.4, `typescript-eslint` ^8.59.1, `typescript` ^5.8.3 | ✅ | npm registry + the sample plugin's `package.json` |
| 15 | Runtime deps: `read-excel-file` 9.3.10, `write-excel-file` 4.1.1 | ✅ | npm registry |
| 16 | Bun 1.4.2 current; `bun.lock` (text, JSONC) is the standard lockfile | ✅ | bun.com release blog |
| 17 | Plugin id `tabula` is taken; `tablify` appears free; only an unrelated 2023 hackathon "Tablify" exists | ⚠️→ | Checked the community directory listing. **Re-check at submission**: the directory, not a web search, is the authority on id uniqueness |
| 18 | "Airtable" must not be used in the plugin name; no implied affiliation | ⚠️ | Airtable's published trademark guidelines say so; **not legal advice** — treat as risk guidance, not a ruling |
| 19 | Anthropic/Claude marks must not appear in the plugin identity | ⚠️ | Registered trademarks + community consensus. **Not legal advice.** Colour values themselves are not protected; brand and mark reproduction is the risk |
| 20 | `color-mix()` works in Obsidian's WebViews (iOS/Android/Electron) | ⚠️ | Not tested on device. Verify in the M3 harness **and** one real phone; if it fails, fall back to explicit light/dark tint pairs |
| 21 | Bundle budgets (900 KB / 300 KB gzip / 250 KB non-React) | ⚠️ | **These are targets, not measurements.** Calibrate against the first real M0 build, then freeze |
| 22 | Heavy plugin bundles slow Obsidian mobile startup | ⚠️ | Directionally supported by a published developer case study; treat as a strong prior, measure your own startup in M0 |
| 23 | The old repo has no tests, no test runner, no ESLint, no PR CI; two byte-identical changelogs; 23/30 commits agent-authored | ✅ | Direct inspection of the cloned fork (`md5sum`, `git shortlog`, file listing) |
| 24 | The old build's mobile failure: app shell squeezed 860 px → 389 px, mount collapsed to 0 | ✅ | Its own committed changelog (v0.1.27–v0.1.31) |

**Summary: 15 verified, 8 assumed, 1 corrected.** The assumed ones are all narrow: two legal-risk judgements, one CSS-feature support question, three measurements to calibrate, one directory-uniqueness check, one anecdotal performance prior. None of them change the architecture — but #20 and #17 must be closed during M0/M3, and #21 is only a target until a real build exists.

**How this ledger was produced (repeat it yourself):** clone the template repos, download the npm tarballs, read the `.d.ts`, hit the registry API, read the official docs page for the exact feature. Roughly ten minutes of commands replaced a day of arguing with prose.

---

## 4. The spike rule (cheapest possible proof)

Before committing to an architectural claim, write the smallest program that proves or kills it. Recorded here so they get built during the phase noted:

| Spike | Proves | Phase | Size |
|---|---|---|---|
| Mount a trivial Bases view that logs `config.getOrder()`, `this.data.data[0].file.path` and `getValue()` for a real base | The data path works as documented on the user's actual Obsidian build | M2 | ~40 lines |
| Write one frontmatter property from a cell edit and diff the note | Write path + preservation of unknown keys | M2 | ~30 lines |
| Add a throwaway field type (`progressBar`) via the registry only | The "one file to add a field type" claim | M1 | ~60 lines |
| Render 5,000 rows in the harness and measure first paint + scroll fps | The windowing budget (#21) | M3 | harness case |
| Generate a `.base` from the type, open it in Obsidian, confirm no warnings | Migration output is valid | M6→M4 | ~50 lines |

**A spike that fails is a success.** It costs an afternoon and saves the rewrite.

---

## 5. Working rules for the coding agent

1. **One milestone per branch. One milestone per PR.** A diff bigger than ~600 lines cannot be reviewed by a human, so it cannot be verified.
2. **The agent must show raw command output** for `bun run check`, lint and the harness — not a summary of it. No output, no merge.
3. **Cite-or-die:** any use of an Obsidian API must cite the file and symbol in `obsidian.d.ts` (e.g. `BasesView.createFileForView` @since 1.10.2). Uncited API usage is treated as hallucination until proven.
4. **Ask, don't assume:** unknowns go to `docs/08-decisions.md` as open questions and are raised, never silently decided.
5. **No new dependency, no new file outside the stated scope, no rewrite of untouched files** — each is a stop-and-ask.
6. **Test-first for `core/`.** A new field type or op lands with its tests in the same commit.
7. **A layout fix lands with a harness assertion.** No exceptions — this is the rule whose absence caused the previous project's death spiral.
8. **Never touch the user's vault in tests.** Fixture vaults only (`tests/fakes/`), and a scratch vault for manual runs.
9. **Never edit `manifest.json` version except in a version bump commit.**
10. **When the agent says "done", you open the app and do the thing.** Automatable proof first, human eyes last.

## 6. Red flags in agent output

| Red flag | What it usually means |
|---|---|
| An API method that is not in `obsidian.d.ts` | Hallucination |
| `as any`, `!`, or a bare `catch {}` | A real error is being hidden |
| Tests added that assert a mock or a snapshot, not behaviour | Test theatre |
| "Should work", "this should fix…", "I believe…" | Not run |
| A failing test deleted, skipped or loosened | The gate was defeated, not passed |
| A dependency appearing in `package.json` without an ADR row | Quiet scope and bundle growth |
| Files outside the task's stated scope in `git diff --stat` | Collateral damage |
| A long prose summary with no diff and no command output | The work is unverifiable; ask again |
| Requirements paraphrased back with one item dropped | Silent scope reduction |
| "Simplified X for now" where X was an explicit requirement | The requirement needs to be re-asserted or formally dropped as an ADR |
| Confident version numbers with no source | Version drift |

## 7. Human verification checklist per milestone

Automated gates cannot check these — you must:

**M0** — id/name/author strings match `docs/09`; a dry-run release produces three separate assets; `bun run check` on a clean checkout; bundle size measured (closes #21).
**M1** — add a field type yourself, start to finish, and count the files you touched. If it is more than one plus registration, the registry failed its own claim.
**M2** — open a note in another pane, change the same property, and watch the grid; kill the app mid-write and confirm nothing corrupts; check that unknown frontmatter keys survive.
**M3** — the phone test: keyboard, long-press, momentum, notch, input zoom. Then the two-pane test. Then the 5,000-row fixture.
**M4** — a real 400-row paste from real Excel; undo it; export it back and open in Excel. Compare values by eye.
**M5** — create a deliberate conflict in Airtable, pull, and confirm the dialog is impossible to misread; confirm the token never appears in any vault file (`grep -r` the vault).
**M6** — a stranger's path: fresh vault → install → migrate a legacy file → import → sync. Do it on the phone too.

## 8. The meta-rule

**Prefer small, independently verifiable increments to large, impressive ones.** Every phase of this roadmap ends shippable; every exit criterion is checkable without trusting anyone's summary. That structure is not project management — it is the verification strategy. A rewrite that can only be judged at the end cannot be verified by an AI or a human.

And when an AI (this one included) tells you something confidently: **ask for the source, ask for the command that would prove it wrong, and then run it.**
