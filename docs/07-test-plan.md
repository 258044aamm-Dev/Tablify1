# 07 — Test plan for the native `.tablify` target

> **Status:** future test contract. Current `0.1.0` tests are built around a Bases-backed source; no native `.tablify` repository exists yet. Keep current gates and add the tests below as implementation is authorized.

## Test principles

1. Test pure behavior at the lowest layer possible.
2. Use fake Obsidian/file ports for deterministic repository tests; real vault/device verification remains a separate release gate.
3. Assert observable behavior, not snapshots alone or mocked method calls that bypass the behavior.
4. A test is not green if an assertion was deleted, weakened, skipped, or made vacuous to fit a refactor.
5. Test file corruption, concurrent edits, large values, partial failures, and undo—not only the happy path.
6. Never use a live Airtable token or network call in CI.

## Tiers and gates

| Tier | Tool | Target scope | Gate |
|---|---|---|---|
| 1 — Domain | Vitest, node | JSON parser/validator/serializer, field codecs, IDs, query, ops/inverses, links, import plans/export matrices | Every commit touching core; current `bun run check` includes unit suite. |
| 2 — Repository | Vitest with fake file/vault port | File load/create/write/flush, serialization, revisions, rename/delete/modify events, recovery | Every repository/adapter change. |
| 3 — Store/DOM | Vitest + jsdom | Store selectors, optimistic state, undo/redo, table/view switching, link chooser/dialogs, accessibility semantics | Every relevant UI/state change. |
| 4 — Layout/interaction | Playwright browser harness | Real grid components on fixture database at existing viewport matrix | Every PR; CI `bun run test:layout`. |
| 5 — Real Obsidian | Human | File view registration/lifecycle, vault write notifications, desktop/mobile panes, safe areas, real clipboard, external edits | Before a release; record in `docs/manual-test-log.md`. |
| 6 — Airtable smoke | Human + scratch Airtable base, optional | Token entry, manual pull/push, conflict review, relationship mapping | Before stable sync release; never required for CI. |

## Tier 1 — Format and core

Required suites:

- Parse/serialize/parse round-trip for minimum, multi-table, multi-view, all-field-type, link, attachment, Unicode, long-text, and large fixtures.
- Empty-value semantics: absent, `null`, `''`, `[]`, `false`, and `0` for each relevant field.
- Stable IDs: rename/reorder does not rewrite cell identity or relation references.
- Duplicate/missing IDs, unknown supported-version keys, unknown field types, malformed/truncated JSON, unsupported future version, invalid numbers, invalid date/time, duplicate options, unknown option IDs, broken table/row links.
- `.tablify` version migration determinism and idempotence; input remains unchanged on failure.
- Field descriptor contract: parsing/formatting, compare total order, operators implemented, JSON-safe values, plain-text clipboard round-trip where intended.
- Operations/inverses: `apply(inverse(apply(state))) === state` for record/field/table/view/link operations, property-tested over generated states.
- View query tests: filters/search/sorts/grouping use stable `fieldId`/`rowId`, respect selected table and view.

No tests for `.base` or `.tabula` migration are carried into this target suite. Historical fixtures can be archived, not used as a compatibility gate.

## Tier 2 — Repository and writes

Use an in-memory fake implementing exactly the text-file operations the adapter needs. Record writes, events, revision numbers, and failures. Test:

- Create a valid empty document, open it, mutate it, flush, reload, and compare normalized document state.
- Exactly defined write coalescing for a single edit, bulk paste, table schema change, import, undo, and redo.
- Writes serialize; a failed write does not make the snapshot appear saved or discard later commands.
- External modification while clean reloads safely; external modification while dirty triggers the agreed conflict behavior and never silently overwrites.
- Two sessions/leaves on one document share or reconcile revisions; close of one leaf does not dispose the session still used by another.
- Rename preserves `databaseId`; delete/close/unload releases listeners, timers, and queued resources.
- Malformed and newer-version documents remain byte-for-byte untouched; read-only/error state is visible.
- Attachment paths resolve to existing/missing status through a fake host without mutating stored values.

The write/atomicity guarantees in tests must match what the real Obsidian API provides. A fake proves repository logic, not host durability.

## Tier 3 — Store, UI and accessibility

- One keystroke re-renders the edited cell and expected row only; active table selectors do not leak rows from another table.
- Table/view switch preserves the intended per-table selection/view behavior and restores focus.
- Range/row/column selection, copy/cut/paste, fill, bulk edit, add/duplicate/delete, and undo remain correct against stable IDs.
- Linked-record chooser supports approved cardinality, search, keyboard-only add/remove, missing target display, cross-table updates, and undo.
- Table/field rename/delete updates or warns about dependent views/links according to ADR.
- Screen-reader labels/announcements describe table, view, cell, link target, read-only state, errors, and completed writes.
- Dialog focus trap/restore, escape handling, reduced motion, and disabled/read-only semantics remain correct.

## Tier 4 — Browser layout/interaction harness

Keep current five target viewport categories (`desktop`, `desktop-dark`, `phone-closed`, `phone-keyboard`, `tablet`) and existing CSS, focus, touch, frozen-column, scroll, and grid interaction assertions. Extend fixtures to include at least two tables, two saved views, and linked records. Add assertions for:

1. table and view switchers remain visible/usable at narrow widths;
2. linked-record editor is navigable and does not trap focus;
3. target table name changes update display without changing stored relation ID;
4. missing targets show a visible broken-reference state;
5. all current selection/clipboard/performance assertions pass using the native repository fixture;
6. no layout behavior relies on Bases DOM or `.base` settings.

Use browser geometry for layout claims, not jsdom. The harness still cannot verify Obsidian's FileView host or real device behavior.

## Performance and file-size tests

Benchmark parse/open, visible first paint, filter/sort/group, edit/serialize/write, and bulk import on a reproducible 5,000-row × 20-column database. Keep existing first-paint target (≤300 ms in the harness) as a baseline, then record a separate measured budget for full JSON write and import. Measure memory for duplicate document snapshots/two panes. Do not set a maximum file size by guess.

## Airtable tests

Use a fake `SyncTarget`/transport. Required scenarios: link mapping by stable IDs; local-only and remote-only field updates; same-field conflict review; stale local edit after plan; full versus partial read; remote deletion report; local deletion report; failed/rejected push; 429/backoff; corrupt link state; token redaction; unsupported field type; cross-table linked-record mapping complete/missing/deleted; no live network in CI.

No remote record create/delete or schema mutation is introduced by these tests unless separately approved.

## Tier 5/6 manual matrix

Record build SHA, plugin version, Obsidian version, OS/device, date, exact steps, result, and limitations. Required before stable release:

- open/create/rename/reopen `.tablify` with Bases disabled;
- multiple panes, same-file writes, Obsidian Sync/external edit collision;
- multi-table links, table/row deletion, undo, and broken-link recovery;
- phone keyboard, focus, safe areas, long-press versus scroll, screen reader where available;
- real CSV/XLSX import and CSV/TSV/XLSX export with Excel/Sheets or compatible clients;
- manual Airtable pull/push and a deliberately created conflict using a scratch/test base if available;
- confirmation old `.base`/`.tabula` files were left unchanged, not migrated.

A check that was not actually run remains **NOT RUN**.

## Current baseline and commands

The existing package script `bun run check` runs typecheck, lint, brand/manifest gates, formatting, unit tests, build, contrast, CSS, and size gates. CI additionally runs the Playwright layout suite. Run both for implementation PRs. This documentation-only pass did not run them because Bun is not available in the workspace; it does not claim the code or tests pass.
