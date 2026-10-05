# 08 — Decision log

Format: **ID · decision · source · consequence.** `source: user` = answered directly; `source: delegated` = "choose the best", decided here and open to veto; `source: open` = needs an answer before the phase that depends on it.

Anything with `status: open` must be resolved by the phase noted, or the phase cannot start.

---

## Product

| ID | Decision | Source | Consequence |
|---|---|---|---|
| P1 | Display name **Tablify**, plugin id **`tablify`** | user | `tabula` is taken in the community directory (an existing plugin wraps a `tabula` binary); `tablify` is clear there. **The id is permanent after the first public release.** |
| P2 | **Bases-first**, with `.tabula` retained as a frozen legacy adapter and one-way importer | user | Rows became notes. The grid fills Obsidian's container, so the mobile height-chain bug class is structurally gone. The escape hatch keeps non-note data (and huge imports) possible. |
| P3 | **One view type: the grid.** No kanban/cards/list/map, and no CSV export | delegated | Verified: Bases 1.14 already ships table, cards, list, map, **kanban** and native CSV export. Differentiation is spreadsheet depth, not layout count. Revisit only if Bases' kanban leaves a real gap. |
| P4 | CSV/XLSX **import and export**, plus clipboard copy/paste in both directions | user | The full `import/spreadsheet.ts` matrix parsers survive (rewritten into `import/matrix`), and a writer is added for XLSX. |
| P5 | Row-notes: configurable, defaulting to a dedicated folder + `{{template}}` filename | user | Note creation is a first-class service with preview, dedupe and progress. |
| P6 | Rich types stay human-readable: plain YAML + a `fieldOptions` sidecar in the view config | user | Select colours/rating max/currency symbol travel with the `.base`; frontmatter stays hand-editable. Option identity is the label, so renaming is a bulk rewrite with preview. |
| P7 | Sync: **one base+table pair per view**, schema extensible to many later | delegated | Simple conflict model now (one key space per record). Storage shape is a map keyed by link, so multi-link is additive later. |
| P8 | Conflicts: **per-field diff, never silent** | user | Requires `snapshot` hashes in `.tablify/links/*.json`. Bulk take-local/take-remote provided for ergonomics. |
| P9 | Airtable **schema is never modified** | user | Read-only on fields/tables. Local properties with no remote counterpart are skipped and reported. |
| P10 | Import asks, with a row-count threshold warning and a `.tabula` alternative | user | Preview dialog is mandatory; above the threshold the `.tabula` option is the default. |
| P11 | `autoNumber` **dropped**; `createdTime`/`lastModifiedTime` read from `file.ctime`/`file.mtime` | delegated | Removes three stored field types and their bookkeeping. A Row-number column derived from view order replaces auto-numbering. Reported in the migration summary. |
| P12 | `percent` stores **25 for 25 %** (not 0.25); `duration` stores **seconds** | delegated | Human-first, diverging deliberately from Airtable's 0.25 convention. Documented in the README; sync maps between the two. |
| P13 | **No marker property** on created notes | delegated | Membership is defined by the view's own filter. Keeps notes clean and avoids the plugin claiming ownership of hand-edited notes. Optional "tag new rows" setting, default off. |
| P14 | Author metadata = your GitHub handle; `LICENSE` keeps upstream copyright **plus** yours; a `NOTICE` credits `MehulG/airtable-tabula` | user | MIT requires retaining the original notice. The fork's lineage is disclosed, not hidden. |
| P15 | **Fresh repository** `tablify`; the fork stays archived | user | No inherited history (23 of 30 commits were agent-authored churn) and no upstream remote to accidentally merge. `REFACTOR-PLAN.md` in the fork is the audit record. |
| P16 | **Hard fork** — never merge upstream again | delegated | Upstream sat at 0.1.6 with 0 commits while the fork carried 30; a merge has no value and real risk. |
| P17 | Brand direction: warm clay/parchment palette shipped as **our own tokens** | user (clarified) | ⚠️ The identity must not reference any third-party brand: no company names in tokens, classes, README or settings; no logos or mark imitation; no implied affiliation. Token structure in `docs/04`. |
| P18 | `minAppVersion` = the **lowest version actually tested**; the API floor is **1.10.2** if `createFileForView()` is used (verified: `BasesView` itself is `@since 1.10.0`, `createFileForView` and `getEvaluatedFormula` are `@since 1.10.2`) | delegated | Current app stable is 1.14.4; the `obsidian` types package latest is 1.13.1. Declaring a floor without testing on it is a lie the reviewers and users pay for: start at the tested version and lower it deliberately after verification. |
| P19 | `isDesktopOnly: false`; desktop **and** mobile are first-class | user | Drives the layout contract, the touch rules, the bundle budget and the harness viewport matrix. |
| P20 | Pace: full-time · handoff: **docs-only** (you or your agent implements from this set) | user | These docs are written as an implementation contract, not as notes: interfaces, thresholds, budgets and acceptance criteria are all specified. |

## Engineering

| ID | Decision | Source | Consequence |
|---|---|---|---|
| E1 | **Bun 1.4.x** for install/scripts; **esbuild 0.25+** for the bundle; `tsc --noEmit` as the type gate | user (bun) / delegated (esbuild) | Bun does not replace esbuild: the Obsidian bundle needs CJS output with `obsidian`/`electron`/CodeMirror externals and a banner. CI uses `oven-sh/setup-bun@v2` + `--frozen-lockfile` with `bun.lock` committed. |
| E2 | TypeScript `strict` **plus** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noUnusedLocals/Parameters` | delegated | The old build ran `noImplicitAny` + `strictNullChecks` only, with `allowJs: true`. |
| E3 | ESLint 9 flat config + `eslint-plugin-obsidianmd` + `typescript-eslint`; **Prettier added on top (divergence from the official template, which formats via ESLint only)** | delegated | Verified against the real `obsidian-sample-plugin`: it ships `eslint.config.mts` built on `defineConfig` + `globalIgnores` + `projectService` + `obsidianmd.configs.recommended`, with ESLint `^9.39.4`, `typescript-eslint` `^8.59.1`, `@eslint/js`, `globals`, `jiti`. Adopt **that** as the base config and append our strict + boundary rules rather than hand-rolling from `strictTypeChecked`. Also adopt the template's `.editorconfig` (tabs, 4-space width, single quotes) and make Prettier match it. Includes the architectural boundary rules (`core` cannot import Obsidian/React; adapters cannot import React). `eslint-disable` on boundary rules is forbidden by `AGENTS.md`. |
| E4 | **React 19** | user | Bundled inside `main.js`; no host dependency. |
| E5 | **Hand-rolled store** on `useSyncExternalStore` + narrow selector hooks + command log | user | Zero dependency, full control over the optimistic overlay and undo. Cost: ~200 lines to own and test (tier-3 tests in the plan). |
| E6 | **Plain CSS** with a two-tier token system; no CSS framework | user | `!important` banned; literal colours only inside `brand.css`. |
| E7 | **Own row windowing**, no virtualizer dependency | delegated | *Reverses the earlier suggestion of `@tanstack/react-virtual`.* Fixed per-density row heights make the visible range arithmetic; the library would add a dependency for ~150 lines of range math, and bundle size affects mobile startup. Revisit only if variable row heights become a requirement — and record it here if so. |
| E8 | Vitest + Playwright harness committed in-repo + CI gates on every PR | user | The previous "harness"/"functest" was never committed, which is why layout regressions returned. Committing it is the fix. |
| E9 | Dependency policy: every runtime dependency is a decision row here; bundle budgets are enforced in CI | delegated | Runtime deps: `react`, `react-dom`, `read-excel-file` (**9.3.10**, verified on npm), `write-excel-file` (**4.1.1**, verified on npm, published 2026-06-08). Dev versions verified: `esbuild` 0.25.5, `eslint` ^9.39.4, `eslint-plugin-obsidianmd` **0.4.2**, `typescript-eslint` ^8.59.1, `typescript` ^5.8.3, `@types/node` ^22, `obsidian` types 1.13.1. |
| E10 | **No telemetry, no analytics, no remote calls except the user's own Airtable account** | policy | Developer-policy requirement and a listing requirement. |
| E11 | `main.js` is gitignored and exists only as a release asset | delegated | Keeps 1.4 MB build artifacts out of history. |
| E12 | Versioning: `0.x` until the field-type set and `.base` option schema freeze, then `1.0.0` | delegated | Tags equal `manifest.version` exactly, no `v` prefix. |

## Open questions

| ID | Question | Needed by | Default if unanswered |
|---|---|---|---|
| O1 | **Brand assets** — palette values, light/dark variants, logo/wordmark, ribbon icon | M3 (before polish) | Ship the placeholder tokens in `docs/04` (contrast-checked); swap values later. Structure does not change. |
| O2 | Exact strings for `author` / `authorUrl` / optional `fundingUrl` | M0 | `author: "258044aamm-Dev"`, `authorUrl: https://github.com/258044aamm-Dev`, no `fundingUrl`. |
| O3 | Confirm the `percent` (25) and `duration` (seconds) conventions — or keep Airtable parity (0.25) | M1 | As decided in P12 (human-first). |
| O4 | Does v0.1.0 ship the **legacy `.tabula` view**, or only the migration command? | M6 | Ship the migration command; the legacy view lands in 0.2.0 if it slows the release. |
| O5 | XLSX writer choice (`write-excel-file` vs a minimal OOXML writer) | M4 | `write-excel-file` if it stays under the 60 KB single-dependency budget. |
| O6 | Kanban, ever? | post-1.0 | No. Bases ships one. |

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Bases API behaves differently than documented under rapid vault change | medium | high | Spike in M2 before building on it; keep `BasesSource` thin so a workaround is local; keep the legacy view as a functioning fallback. |
| Rows-as-notes doesn't suit some of your data | low (your data is small) | medium | The `.tabula` adapter stays; big imports can stay file-based. Re-evaluate at M4 with real data. |
| Write queue loses or clobbers edits | low | **critical** | Tier-2 tests (per-file serialization, partial-failure reporting, flush guarantees); `processFrontMatter` only; two-pane and external-edit tests before beta. |
| Mobile WebView variance | medium | medium | Harness with five viewports, including the historical 389 px squeeze; manual device matrix per release; no `100vh`, no percentage chains, no zoom tricks. |
| Bundle growth slows mobile startup | medium | medium | Enforced budgets in CI; one dependency decision at a time; sync dynamically imported. |
| Obsidian changes the Bases API | medium | medium | `minAppVersion` + `versions.json` per release; watch the changelog; isolate the integration to `plugin/basesView.ts`. |
| Trademark/branding complaint | low | high | P17 and `docs/09`: no third-party marks anywhere, own palette under own names, no implied affiliation. |
| Bus factor: one maintainer | high (certain) | high | Everything documented, tested and reproducible: `AGENTS.md`, ADRs, committed harness, CI gates. |

## Rejected alternatives (and why)

| Rejected | Why |
|---|---|
| Keep own-storage as the primary product | It keeps the plugin competing with a core feature on layout while owning a bug class (the height chain) that consumed most of the fork's history. Kept as an adapter instead. |
| Bases-only, delete `.tabula` | Breaks the one workflow that notes cannot serve: importing large sheets without creating hundreds of files. |
| Retain upstream plugin `id` | It is owned by upstream in the directory; ids cannot change after release. |
| "Airtable Tabula" / an Anthropic-referencing identity | Trademark exposure on a public listing. Same trap, avoided twice. |
| `@tanstack/react-virtual` | See E7. |
| Zustand / Redux | The store is ~200 lines with two consumers (grid, overlays); a library adds a dependency and a mental model without removing work. |
| Tailwind / CSS-in-JS | Theme-variable theming is the requirement; utilities fight that and bloat the bundle. |
| YAML/JSON schema library (zod/valibot) | The only serialized surface we own is `fieldOptions` and the sync link file — both small enough to validate by hand, and the rest of the data model is Obsidian's. Revisit if a third serialized format appears. |
