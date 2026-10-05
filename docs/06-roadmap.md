# 06 — Roadmap

Sized for **full-time** work (the stated pace): roughly **4–6 weeks** to a public release, with a usable internal build inside the first two.

Every phase ends shippable. No phase leaves a half-migrated state. `M0` alone fixes the publishing blockers, so it can be done before any code exists.

---

## M0 — Project hygiene · 0.5–1 day

**Goal:** a clean repo that can legally and technically grow into a published plugin.

- [ ] Fresh repository `tablify` (keep the old fork archived for reference; do not merge it).
- [ ] `manifest.json` with `id: "tablify"`, own `author`/`authorUrl`, `version: "0.1.0"`, `isDesktopOnly: false`, `minAppVersion` = lowest version you actually test on.
- [ ] `versions.json`, one `CHANGELOG.md`, `LICENSE` (MIT, retaining upstream copyright alongside yours), `NOTICE`.
- [ ] `.gitignore`: `main.js`, `node_modules/`, `playwright-report/`, `*.local`.
- [ ] Bun + esbuild + TypeScript strict + ESLint 9 + Prettier wired; `bun run check` green on an empty `src/`.
- [ ] CI (`ci.yml`) and release (`release.yml`) per `docs/05-toolchain-and-ci.md`.
- [ ] `AGENTS.md` committed; `docs/` committed (this set).

**Exit:** `bun run check` passes; a `0.1.0` dry-run release produces `main.js`/`manifest.json`/`styles.css` as separate assets; `grep -r "airtable\|anthropic" --include=*.json --include=*.ts .` returns only Airtable *API* usages, never a brand placement.

---

## M1 — Core domain · 4–5 days

**Goal:** the pure layer that the old codebase never had, with the field-type registry replacing ~18 duplicated type switches.

- [ ] `core/schema`: property schema, column set, read-only resolution.
- [ ] `core/fieldTypes/**`: all 13 surviving types as descriptors (see mapping table in `03`) + registry + `fieldOptions` validation.
- [ ] `core/query`: AST, parser (DSL → AST), evaluator, comparator, `toQueryString`.
- [ ] `core/ops`: Op types + reducers + inverse computation (for undo).
- [ ] `core/selection`: ranges, anchors, clipboard matrix model (TSV/HTML in and out).
- [ ] Unit tests for all of it; coverage thresholds met.

**Exit:** adding a field type requires exactly one new file plus registration — prove it by adding `progressBar` as a spike, then deleting it. No `switch (field.type)` anywhere outside `core/fieldTypes/`. Zero `obsidian`/React imports in `core/` (lint-enforced).

---

## M2 — Data layer · 3–4 days

**Goal:** rows come from somewhere real, and writes are safe.

- [ ] `adapters/RowSource.ts` (the port) + `adapters/writeQueue.ts` (coalescing, per-file serialization, rollback, `flush`).
- [ ] `adapters/bases/BasesSource.ts`: schema + rows + values from `QueryController`; writes via `fileManager.processFrontMatter`; snapshot caching + `subscribe`.
- [ ] `adapters/tabulaFile/`: read-only parser for v1 and v2 (ported from the fork's `parseTableFileDocument`, with tests).
- [ ] Note creation service: prefer `BasesView.createFileForView(baseFileName?, frontmatterProcessor?)` (the sanctioned path — it handles filename collision and frontmatter in one step, `@since 1.10.2`), falling back to a manual create when a specific folder is required.
- [ ] Adapter tests against a **fake vault** (an in-memory `App` implementing the small surface we use).

**Exit:** in a real vault, a Bases view renders rows from a `BasesSource`; editing a cell changes the note's frontmatter; a batch write to 4 notes either lands or reports exactly which failed; `flush()` guarantees disk before close.

---

## M3 — Grid v1 · 5–7 days → **internal beta**

**Goal:** a grid you would actually use daily.

- [ ] Windowing, single scroller, sticky header, frozen first column, `position: absolute; inset: 0` root.
- [ ] Store + selectors (`useSyncExternalStore`), command dispatch, optimistic overlay.
- [ ] Keyboard model (`01-spec.md` table) with one handler and a roving `tabindex`.
- [ ] Cell editors for every type; read-only cells disabled with a reason.
- [ ] Row/column resize, reorder by drag; row height; view options persisted in the `.base`.
- [ ] Context menus via Obsidian `Menu`; overlays via `Modal`.
- [ ] `tokens.css` + `brand.css` + `grid.css`; zero `!important`.
- [ ] Playwright harness with the four viewport fixtures; CI green.

**Exit:** the harness passes on `desktop`, `desktop-dark`, `phone-closed`, `phone-keyboard` (host squeezed to 389 px) and `tablet`; a 5,000-row × 20-column fixture opens in ≤ 300 ms and scrolls at 60 fps; typing never re-renders the grid; opening two panes on the same base neither fights nor loses edits; the plugin can be used for real work without falling back to the legacy build.

---

## M4 — Spreadsheet depth · 5–7 days → **public beta**

**Goal:** the reason the plugin exists.

- [ ] Range selection (mouse, touch toggle, shift-arrows), whole row/column selection.
- [ ] Clipboard: copy/cut/paste TSV **and** HTML both directions; paste a `.csv`/`.xlsx` file from the clipboard where the OS exposes it.
- [ ] Fill down/right; clear selection; bulk column edit bottom-up (`Cmd/Ctrl+Enter`).
- [ ] Undo/redo across all operations, including multi-note writes, as one step each.
- [ ] Import: CSV/TSV/XLSX → preview dialog with row count, folder, filename template, per-column type override, threshold warning, `.tabula` alternative.
- [ ] Export: selection or view → TSV/XLSX to clipboard or file. (CSV stays Obsidian's.)
- [ ] New-row affordances (footer button, Enter at the end of the last row, paste overflow) creating notes with correct frontmatter.

**Exit:** paste a 400 × 6 block into an empty view → 400 correct notes in one undoable step with progress feedback and no freeze; copy a range into Google Sheets and back with values and structure intact; import a 412-row XLSX with the preview telling the truth; export reproduces what the sheet looked like.

---

## M5 — Airtable sync · 3–5 days

**Goal:** the differentiator, isolated so it can never destabilise the grid.

- [ ] `SecretStorage` token flow + settings UI (never in `data.json`).
- [ ] `SyncTarget` port, Airtable client (pagination, retry/backoff, typed errors, chunked writes).
- [ ] Link dialog (base + table), link state in `.tablify/links/*.json`, `snapshot` hashes.
- [ ] Pull/push with per-field diff; conflict review dialog; bulk take-local/take-remote.
- [ ] Dynamic import so startup never parses sync code; link state drives badges.
- [ ] Sync tests with a mocked transport (no live Airtable calls in CI).

**Exit:** a pull that changes 40 fields across 12 notes applies in one reviewable step; a same-field conflict is impossible to resolve silently; deleting a note locally never deletes a remote record; the plugin's startup is measurably unchanged when sync is unused.

---

## M6 — Publish · 2–3 days

- [ ] README with usage, screenshots, limitations, and the **network-use disclosure** (`docs/09-publishing.md`).
- [ ] `.tabula` migration command documented and tested end-to-end on a real legacy file.
- [ ] `community.obsidian.md` submission: repo URL, latest release, developer policies accepted.
- [ ] Post-submission: address review feedback; tag `0.1.0` when the release is verified in-app on desktop **and** phone.

**Exit:** installable from the community directory; a stranger can go from install to a migrated legacy file to an Airtable pull without reading the source.

---

## After 1.0 (candidates, not commitments)

Kanban (only if Bases' kanban leaves a real gap — it currently does not), per-column type overrides in the UI, saved view presets beyond Bases', a "recently changed by sync" filter, an optional two-way link to Apple Numbers/Excel via file watch, i18n, and a command surface for external plugins.

## Critical path and risk order

```
M0 ─┬─ M1 ── M2 ── M3 ─┬─ M4 ── M6
    └─────────────────┴─ M5 ──┘
```

Highest-risk items, in order: **write-queue correctness** (M2), **Bases API assumptions** (M2 — `QueryController` behaviour under rapid vault changes), **windowing + interaction performance** (M3), **`.base` generation for migration** (M6). Each has a spike attached to its phase; do the spike before the phase's polish work.
