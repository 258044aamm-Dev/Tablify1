# 07 — Test plan

The previous build had **no tests and no test runner**, while its changelog cited a "harness" and "functest ALL CHECKS PASSED" that were never committed — which is precisely why the same layout regressions kept returning across 15 commits. This plan exists so that never happens again.

## Tiers

| Tier | Tool | Scope | Gate |
|---|---|---|---|
| 1 · Unit | Vitest (`node`) | `core/**`: field types, query AST/parser, ops + inverses, selection matrices | Every commit; coverage thresholds |
| 2 · Adapter | Vitest (`node`) + fake vault | `adapters/**`: write queue, coalescing, per-file serialization, rollback, tabula parsing, note creation | Every commit |
| 3 · Component | Vitest (`jsdom`) | Store + selectors: dispatch, optimistic overlay, undo/redo, reconciliation on external change | Every commit |
| 4 · Layout/interaction | Playwright | The real grid in a real browser at five viewports | Every PR (CI) |
| 5 · Manual device | Human | Real phone: keyboard, safe areas, long-press, momentum scroll, iOS input zoom | Before each release |

## Tier 1 — unit (the biggest lever)

Rules:
- Field types are tested **by descriptor**, not by hand: one shared suite iterates the registry and asserts the contract (`parse(formatDisplay(v)) === v`, `formatPlain` round-trips through `parsePlain`, `toYaml` produces a YAML-safe scalar type, `compare` is a total order, `filterOps` all implemented).
- Query tests use a table of `(expr, row, expected)`; the parser is tested against the old DSL syntax from the README so legacy filters keep meaning the same thing.
- Ops tests assert the **inverse** for every op: `apply(undo(apply(x))) === x`. Undo correctness is a property, so it gets property-style tests over generated op sequences.

## Tier 2 — adapters against a fake vault

`tests/fakes/vault.ts` implements the slice of `App` used by adapters: `vault.getFileByPath`, `vault.create`, `vault.delete`, `fileManager.processFrontMatter`, `metadataCache`. It records every write, so tests assert:

- 12 property writes to one file in a tick ⇒ **one** `processFrontMatter` call.
- Interleaved writes to the same file from two sources are serialized, never lost.
- A failing write drops only the affected optimistic overlay and returns a per-file error.
- Unknown frontmatter keys survive a write cycle untouched.
- Clearing a value **removes** the key rather than writing `""`.
- The write queue's `flush()` resolves only after the last write resolves.

Legacy parsing is tested against **committed fixtures**: a v1 file, a v2 file with 3 tables, a file with unknown field types, a file with select cells referencing deleted options, and a corrupted file (asserts a clean user-facing error, not a crash).

## Tier 3 — store

- A keystroke re-renders the edited cell and nothing else (assert with a render counter).
- Selection is preserved when the row set is unchanged by a re-query; it degrades predictably (to the nearest surviving row) when rows are removed.
- Undo of a 400-cell paste issues **one** queued batch, and the number of `processFrontMatter` calls equals the number of distinct files touched.
- External change (`subscribe` fired by another pane) wins over a stale local snapshot and does not resurrect deleted rows.

## Tier 4 — the layout harness (the committed one)

`harness/` is a static page that mounts the **real** `GridView` against a fixture `RowSource`, styled by a stub Obsidian theme stylesheet plus the plugin's own CSS. Served by `bun run harness:serve` on port 4173; driven by Playwright.

Viewports: `desktop`, `desktop-dark`, `phone-closed`, `phone-keyboard`, `tablet` (`docs/04` §matrix).

Assertions (all five viewports unless noted):

| # | Assertion |
|---|---|
| 1 | `.tablify-root` fills **100 %** of its host (padding box), measured, not assumed |
| 2 | In `phone-keyboard`, the host is squeezed to **389 px** and the root still fills it — the exact historical failure, now a test |
| 3 | Header stays visually aligned with its columns after horizontal scroll, and after vertical scroll |
| 4 | Frozen first column does not drift by more than 1 px against the header |
| 5 | Toolbar is single-row and fully visible; overflow menu appears below 520 px |
| 6 | Every input/editor reports `font-size ≥ 16px` (iOS zoom guard) |
| 7 | Every interactive target is ≥ 44 × 44 px on phone viewports |
| 8 | No element's computed style contains `!important` — plus a static check that `styles.css` contains zero occurrences |
| 9 | Keyboard navigation: 200 arrow presses keep the active cell in view, keep exactly one focused element, and never scroll the *page* |
| 10 | Typing in a cell does not move scroll position (no jump-to-top regression) |
| 11 | Paste of a 400 × 6 matrix completes with correct cell values in a < 2 s budget (harness fixture, not a note-creating run) |
| 12 | Row insert/remove does not scroll-jump |
| 13 | Screenshot diff against committed baselines at each viewport, with a small tolerance |

Every layout or interaction bug fixed **must** land with a new assertion here. That is the rule that was missing before; without it the harness is decorative.

## Tier 5 — manual device matrix

| Check | Why it cannot be automated |
|---|---|
| Keyboard open/close while editing | Real iOS/Android behaviour and timing |
| Long-press context menu vs scroll | OS gesture arbitration |
| Safe-area/notch | Real hardware |
| Input zoom on focus | WebView behaviour |
| Momentum scroll feel | Perception |
| Large pastes from the real Excel/Sheets apps | Real clipboard payloads (TSV + HTML flavours differ per OS) |

Record results in `docs/manual-test-log.md` before each release (one page per release, including the device/OS).

## Performance assertions

| Test | Method | Budget |
|---|---|---|
| Open a 5,000-row view | Fixture render timing | ≤ 300 ms to first paint |
| Scroll | rAF sampling over a scripted scroll | ≥ 55 fps sustained, no gap > 50 ms |
| Typing | 60 keystrokes dispatched | No frame > 16 ms attributable to grid re-render |
| Paste 400 × 6 | Harness apply path | < 2 s |
| Bundle | `metafile` + gzip | Per `docs/05` budgets |
| Startup | Time `onload` in a dev vault with the plugin alone | ≤ 50 ms; sync module not parsed |

## What is deliberately not tested

- Component snapshot tests (they assert markup, not behaviour, and rot instantly).
- jsdom-based layout tests (jsdom does not lay out; that is what tier 4 is for).
- Live Airtable calls in CI (mock transport; a manual smoke test before releases instead).
- The old build's behaviour as a compatibility contract. Only the **file format** is a contract; the UI is not.

## Fixtures

Committed under `tests/fixtures/` and `harness/fixtures/`:

- `legacy-v1.tabula`, `legacy-v2-multitable.tabula`, `legacy-corrupt.tabula`
- `sheet-412.xlsx`, `sheet.csv`, `paste-block-400x6.tsv`
- `golden/projects.base` (generated by migration; must round-trip through Obsidian without warnings)
- `golden/migration-report.json` (asserted structurally, not byte-for-byte)
- `rows-5000.json` (generated by a script at test time, not committed — keep the repo lean)
