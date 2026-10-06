# Tabula — Refactor Plan & Decision Record

Status: **proposal, awaiting sign-off** · Prepared 2026-10-05
Repo audited: `258044aamm-Dev/airtable-tabula` @ `ac25680` (30 commits ahead of, 0 behind, `MehulG/airtable-tabula`)

Answers that drove this plan:
- **Endgame:** publish as your own community plugin
- **Trigger:** mobile layout hell is the pain
- **Platform:** desktop *and* mobile are both first-class
- **Sync/storage:** "do what's best" → recommendation below
- **Stack:** build on Obsidian Bases

---

## 1. What I found (evidence)

**Shape.** Obsidian plugin, `.tabula` files = JSON tables, React 18 + esbuild. **7,572 LOC** across 27 TS/TSX files, **2,141 lines of CSS**, a committed 1.39 MB `main.js`.

**The 30-commit divergence is not a roadmap.** Roughly 15 consecutive commits are repairs to one thing — the mobile layout height chain — including two temporary on-screen diagnostic builds and one commit that diffs the whole document on tap. Upstream (`MehulG`) has been stationary at 0.1.6; the merge base is `3542249`.

**Identity is broken for publishing (blocking issues):**

| Issue | Evidence | Why it blocks |
|---|---|---|
| Plugin id collides with upstream | `manifest.json` `id: airtable-tabula`; upstream is already listed at `community.obsidian.md/plugins/airtable-tabula` | The directory is keyed by id. You cannot claim it. |
| "Airtable" in the name | Airtable's trademark guidelines forbid incorporating their marks "in business names, app names, … related products" | Legal risk on a public listing |
| Version triple-mismatch | `manifest.json`/`package.json` = `0.0.1`, `versions.json` = `{"0.0.1"}`, `CHANGELOG.md` documents **0.1.31** | Registry requires tag == manifest.version; also never change id after release |
| Author metadata still upstream's | `author: MehulG`, `authorUrl`/`homepage` → `MehulG/...` | Misattribution + review flags |
| Two changelogs, byte-identical | `CHANGELOG.md` and `change log.md`, same md5 `307ffb49` | Noise |
| Release workflow would fail review | `.github/workflows/release.yml` accepts `v`-prefixed tags (`VERSION="${TAG#v}"`) and publishes notes titled "Test Release" | Registry rejects `v`-prefixed tags |
| Build artifact in git | `main.js` (1.39 MB) committed | Release assets belong on the release, not in history |

**Architecture problems, ranked by cost:**

1. **No state layer.** `TableApp` holds ~32 handlers; `TableGrid`'s props interface has **29 members, 22 of them callbacks**; `Toolbar` 18. **Zero `React.memo`, zero `useMemo` in the grid, no virtualization** — a full `<table>` re-renders on every keystroke, and each edit fires `workspace.requestSaveLayout()` plus a full `root.render()`.
2. **Field types hardcoded in 5+ modules.** 19 variants; the type ladder is repeated in `store.ts` (×4: create/normalize/empty/sanitize), `query.ts` (operators, matching, comparator), `cellClipboard.ts`, `CellEditor.tsx`, `syncEngine.ts`. ~18 `case "text"`-style sites. Adding one field type touches ~6 files.
3. **Three overlapping filter systems** in `ViewState`: `filters` (flat and/or), `query` (string DSL), `search` (separate code path), with `filtersToQueryString`/`parseQueryString` round-tripping. No nested groups.
4. **Non-idiomatic Obsidian integration.** **Zero** uses of `Scope`, `Keymap`, `registerDomEvent`, or `Modal`. Instead 6–7 hand-rolled overlays each adding its own `window.addEventListener("keydown"/"mousedown")`, plus a `MutationObserver` that repaints the ribbon icon by injecting inline `!important` SVG purple. This is the root of the "theme repaints my controls" bug class.
5. **CSS fights everything.** Deep descendant chains (`.tabula-view .tabula-mount .tabula-file-root button.tabula-btn`), 7 `!important`, 46 custom props but only **12 references to Obsidian theme variables** — the plugin paints itself, then needs override layers to survive vault themes.
6. **Hand-rolled everything else.** No schema lib, no migration runner; the file's shape is unstable (`serializeTableFileDocument` emits bare v1 for 1 table, a v2 envelope for 2+). **No tests, no test runner, no ESLint/Prettier, no PR CI.** `tsconfig` sets only `noImplicitAny` + `strictNullChecks`, `allowJs: true`. The "harness"/"functest" the changelog cites is not in the repo — it was ephemeral, which is exactly why the layout regressions kept coming back.

---

## 2. The pivot you need to see before anything else

You chose "build on Obsidian Bases." That is a **product pivot, not a refactor**, and it has one consequence that decides everything:

> **In Bases, every row is a file in the vault.**

- Bases entries are notes; `BasesEntry`/`BasesEntryGroup` expose `this.data` to a custom view as **read-only** data plus view config. The Beta/Bases API gives you `registerBasesView(viewId, { name, icon, factory, options })` and `BasesView.onDataUpdated()`. It does **not** give you a write API.
- Editing therefore happens by *you* writing frontmatter: `app.fileManager.processFrontMatter(file, fm => { fm[prop] = value })`, debounced. That works well — it is how the built-in table view behaves — but it means your plugin owns per-note file writes, not a record store.
- `registerBasesView` **returns `false` when Bases is disabled in the vault** — you must degrade gracefully.
- Bases API is `@since 1.10.0`, so `minAppVersion` goes to `1.10.0` and you inherit Obsidian's own schema, filters, sorting, grouping, formulas, view chrome, embeds (`![[x.base#view]]`) and **layout**.

**What Bases buys you (directly answers your #1 pain):** your plugin no longer owns the height chain, the viewport, the keyboard, or the theme contract — the failure surface that consumed 15 commits and two diagnostic builds. A Bases view renders inside a container Obsidian has already sized correctly, on desktop and mobile.

**What Bases costs you:** `.tabula` standalone tables, multiple independent tables per file with non-note records, and — at scale — 5,000 imported rows becomes 5,000 notes. Bases' own docs warn to expect thousands of entries and to reuse DOM / avoid off-screen rendering.

**Therefore: a decision, not a default.** Both are legitimate products:

| | **A. Bases-first (recommended)** | **B. Own-storage-first** |
|---|---|---|
| Product | "The Airtable-style grid view for Bases" | "Standalone tables that live next to your notes" |
| Rows | Notes (frontmatter = schema) | Records inside a `.tabula` file |
| Layout/mobile/keyboard | Obsidian owns it | You own it — must be rebuilt cleanly |
| 5k-row import | 5k notes (warn; gate it) | One file, trivially fine |
| Publishability | High, ecosystem-aligned, core-API supported | You compete with a core feature |
| Keep `.tabula`? | Only as one-way importer | Yes, permanently |

**My recommendation:** take A, and take it *without throwing away the old product on day one* — see §3. The rewrite is worth doing either way, and ~70% of it (field registry, grid, editors, query engine, sync) is shared. The difference is which adapter sits underneath.

---

## 3. Target architecture: one grid, two data adapters

```
src/
  core/                     ← pure TS. No React, no Obsidian, 100% unit-testable
    schema.ts               zod schemas + migration runner (.tabula only)
    fieldType/registry.ts   ← ONE file per field type. THE decisive refactor
    query/                  ← AST + parser + evaluator (single source of truth)
    ops/                    ← insert/update/delete/reorder/select options/undo
    selection/              ← row ranges, clipboard semantics

  grid/                     ← the visible product (React)
    GridView.tsx            virtualized, one scroller, sticky header + frozen col
    cells/                  per-field-type editors (registry-driven)
    commands.ts             keyboard nav via a single keymap, undo/redo
    tokens.css              Obsidian CSS vars only. No !important. No palette.

  adapters/                 ← the only place that knows where rows live
    RowSource.ts            getRows/getFields/setCell/insertRow/deleteRow/subscribe
    tabulaFile.ts           .tabula JSON (legacy + non-note data) — frozen contract
    bases.ts                QueryController data + processFrontMatter write-back

  sync/                     ← optional, lazily imported
    SyncTarget.ts           port: apply(rows) / collect(rows)
    airtable.ts             Airtable adapter, conflict UX, secret from SecretStorage

  plugin/                   ← Obsidian glue
    registerBasesView(...)  ← primary surface
    FileView (legacy)       ← secondary surface, shares grid/
```

**Why this shape:**
- The field-type registry turns "add a field type = touch 6 files" into "add one file" — it is the single biggest velocity win and the reason a rewrite is justified at all.
- `RowSource` is what lets you ship the Bases product while `.tabula` stays alive as the escape hatch for non-note data (a 5,000-row import that shouldn't become 5,000 notes). One renderer, two adapters — not two architectures.
- The grid never learns where data comes from, so sync plugs in as another port, not another coupling.

**The mobile layout contract (replaces the ResizeObserver anchor hack):**

```
host provides a correctly-sized positioned parent
  .view-content  (file view)   ← Obsidian sizes it
  .bases-view    (Bases view)  ← Obsidian sizes it
    └─ .tabula-grid-host   position: absolute; inset: 0;
        └─ .tabula-grid    height: 100%; display: flex; column; overflow: hidden
            ├─ .toolbar    flex: none
            └─ .scroller   flex: 1; overflow: auto   ← the only scroller
```

`position: absolute; inset: 0` cannot be lost in a flex chain, which is precisely the bug that ate v0.1.23 → v0.1.30. For the mobile keyboard, handle it where it actually happens — `visualViewport` resize → pad the scroller — never by renegotiating the document's height.

---

## 4. Decision record

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| D1 | Plugin name & id | **New id, no "Airtable" in it.** Candidates: `tabula-grid`, `tabula-tables`, `bases-grid`. Verify availability at `community.obsidian.md` | `airtable-tabula` is owned by upstream; Airtable's trademark rules forbid their mark in an app name. **Never change the id after release.** |
| D2 | Product model | **Bases-first**, `.tabula` retained as legacy adapter + one-way importer | Removes the layout/theme/keyboard bug class; ecosystem-aligned; keeps non-note data possible |
| D3 | `.tabula` promise | Keep reading it (frozen format, never written except by the legacy adapter); ship a previewed one-way importer `.tabula → notes + .base` | Existing users can migrate; you stop maintaining two formats in anger |
| D4 | Airtable sync | **Keep it** — but as a lazily-imported module behind `SyncTarget`, with token in `SecretStorage`, and *visible* conflict resolution (per-field diff + choice), not silent last-write-wins | It is your only real differentiator vs. plain Bases. Startup stays light. |
| D5 | State | Tiny store + `useSyncExternalStore` + selectors + command log (undo/redo). No prop drilling; no new framework | 22 callbacks in one props interface is the actual bug |
| D6 | Grid | Virtualize with **TanStack Virtual** (~5 KB) but keep your own column model from the field registry — not TanStack Table | A table lib would duplicate the registry you're building |
| D7 | Field types | Registry: each type declares value shape, empty/parse/format/validate, editor, filter operators, comparator, group key, sync mapping | Kills ~18 duplicated switch sites |
| D8 | Query | One AST. Query string compiles *into* it; delete `search` by folding it into the AST | Three filter systems is three bug surfaces |
| D9 | CSS | Obsidian theme variables only. No `!important`, no hardcoded palette, max 2-level selectors | Ends the "theme repaints my controls" class |
| D10 | Obsidian idioms | `Modal`/`SuggestModal`, `Scope`, `registerDomEvent`, `SecretStorage`. Delete the ribbon `MutationObserver` | Free keyboard/a11y/focus correctness |
| D11 | Fork strategy | **Hard fork.** Keep `upstream` as a read-only remote for reference, never merge again; record it in `DECISIONS.md` | 30 commits of divergence with a stationary upstream is a fork, not a branch |
| D12 | Versioning | Reset to `0.1.0` under the new id; tag == `manifest.version` (no `v` prefix); `versions.json` entry per release | Registry requirement |
| D13 | Testing | Vitest on `core/`; **committed** Playwright harness that mounts the grid at 3 viewports incl. keyboard-open simulation; both in PR CI | The old harness was ephemeral — that is why layout regressions returned |
| D14 | Attribution | MIT retained; `LICENSE` keeps MehulG's copyright **plus** your own; add `NOTICE` crediting upstream | MIT requires retaining the notice; also the honest thing |
| D15 | Platforms | Both first-class; `isDesktopOnly: false`; one layout contract for both hosts; CI viewport matrix | Your call, and the contract makes it cheap |

---

## 5. Phased plan

**M0 — Identity & hygiene** *(1–2 days, zero behaviour change)*
New repo name, new id, `author`/`authorUrl`/`fundingUrl` corrected, version reset `0.1.0`, `versions.json` normalised, one `CHANGELOG.md` (delete `change log.md`), `main.js` out of git, release workflow fixed (tag == manifest.version, real release notes, assets as separate files), LICENSE + NOTICE, README network-use disclosure (Airtable API + how the token is stored).
*Exit:* `npm run build` clean, tag dry-run produces valid assets, no id/name/version inconsistency anywhere.

**M1 — Domain core extraction** *(the real refactor; ~1–2 weeks)*
Build `core/` with the field-type registry, query AST, ops, selection. Port `store.ts`, `query.ts`, `cellClipboard.ts` logic onto it. Vitest with fixtures. The existing UI keeps working against the new core (strangler step 1).
*Exit:* all 19 field types declarative; **adding a type = 1 file**; core coverage on the paths that used to be switch ladders; no React/Obsidian import inside `core/`.

**M2 — Store + ports + Obsidian idioms** *(~1 week)*
Store with `useSyncExternalStore`, actions, undo/redo. `RowSource` port with `tabulaFile` adapter (atomic writes, debounced `requestSave()`; delete the per-keystroke `requestSaveLayout()`). Replace hand-rolled overlays with `Modal`; replace window listeners with `Scope`/`registerDomEvent`; token → `SecretStorage`; delete the ribbon `MutationObserver`.
*Exit:* grid props ≤ 6; no `window.addEventListener` in `src/ui`; safe to open in two panes.

**M3 — Grid rewrite + layout contract** *(~1–2 weeks)*
Virtualized grid; CSS token layer; single scroller; sticky header/frozen primary column; one keyboard handler; the `absolute; inset: 0` contract; commit the Playwright harness with 3 viewports (desktop / phone closed / phone keyboard-open).
*Exit:* 5,000 rows × 20 cols, typing at 60 fps; harness green on all 3 viewports; `grep -c '!important' styles.css` → 0.

**M4 — Bases view + migration** *(~1 week)*
`registerBasesView` with ViewOptions (row height, frozen column, …); write-back via `processFrontMatter` (debounced, error-handled, optimistic with rollback); graceful notice when Bases is disabled; embedded-base and pop-out-window handling; `.tabula → notes + .base` importer with dry-run preview and row-count warning above a threshold.
*Exit:* publishable; a user can migrate a `.tabula` file end-to-end.

**M5 — Sync rebuild** *(optional, ~1 week)*
`SyncTarget` over `RowSource`; Airtable adapter; explicit conflict UX; lazy `import()` on first use.
*Exit:* startup unaffected when sync is unused; no silent data loss path.

**M6 — Release**
`community.obsidian.md` submission (dashboard flow; the old PR route is retired), README with disclosures, screenshots, migration guide.

**Not doing:** merging upstream again · two live file formats · hand-rolled modals · `main.js` in git · two changelogs · "Airtable" in the name · any ResizeObserver-anchored height chain.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Rows-as-notes is the wrong product for your data | Keep the `tabulaFile` adapter. It costs little precisely because the grid is shared. Revisit at M4 with real data. |
| Import creates thousands of notes | Dry-run preview + threshold warning + "keep as `.tabula` instead" option |
| Bases disabled / API churn | Detect `registerBasesView() === false`; the legacy file view remains a working fallback surface |
| You are the only maintainer now | Small dependency surface, committed test harness, CI on every PR, ADRs for every D-number above |
| Rewrite stalls half-finished | Every milestone ends shippable; M0 alone fixes the publishing blockers |

## 7. First three actions

1. Confirm the name/id (D1) and whether the Bases pivot (D2/D3) is accepted — everything downstream hangs on it.
2. Do M0 today; it is small and unblocks a legitimate listing.
3. Start M1 with the field-type registry — write the 19 types as data, then delete the ladders.
