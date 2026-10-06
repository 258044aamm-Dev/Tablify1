Task: implement the operation model (every mutation as a value with an inverse), the undo/redo stack, the
selection model and the clipboard matrix model. Pure TypeScript; this is what makes undo of a 400-note
paste possible later.

Read first: `docs/02-architecture.md` §Ops and §Store (the `commit()` idea, one undo step per user action),
`docs/01-spec.md` §selection, §clipboard, §undo, `docs/07-test-plan.md` §Tier 1 (the inverse property is
specified there).

Deliverable:

1. `src/core/ops/types.ts` — `Op` as a closed union covering every mutation the product performs:
   `setCell`, `setCells` (a matrix write), `clearCells`, `addRow`, `deleteRows`, `moveRow`, `moveRows`,
   `setFieldOptions`, `addField`, `deleteField`, `renameField`, `resizeColumn`, `reorderColumn`,
   `setGroupCollapse`, `setViewConfig` (a partial view patch), `importBlock` (matrix → new rows).
   Each carries exactly the data needed to apply and to invert it, and nothing derived at apply time.
2. `src/core/ops/inverse.ts` — `invert(op, before): Op` with `before` the minimal captured state.
   For a batch, inversion reverses the order. Document the rule that makes `setCells` invertible
   (row-level before-images) and what happens when a row no longer exists at undo time (produce a
   `skipped` reason, never throw).
3. `src/core/ops/history.ts` — `History` with `push(op)`, `undo()`, `redo()`, `canUndo`, `canRedo`,
   `depth`, `clear()`, and a coalescing hook (`shouldCoalesce(prev, next)`) that the store will use to
   merge rapid typing in one cell into one undo step **only when the docs say so** — read the decision and
   implement exactly that; do not invent coalescing.
4. `src/core/selection/range.ts` — `Range` (`anchor`, `focus`), normalisation, `contains`, `rows()`,
   `fields()`, whole-row/whole-column ranges, `expandTo(edge)`, and `clampTo(rows, fields)` which degrades
   a selection predictably when rows disappear (the Tier-3 rule: to the nearest surviving row).
5. `src/core/selection/clipboard.ts` — the matrix model: `toTsv(cells)`, `fromTsv(text)`, `toHtml(cells)`,
   `fromHtml(html)`, with the escaping rules of the spreadsheet world (tabs, newlines, quotes, leading `=`
   that must stay text). Round-trip requirements: `fromTsv(toTsv(m)) === m` for the fixture table, and
   `fromHtml(toHtml(m)) === m`. `fromHtml` must accept what Google Sheets and Excel actually put on the
   clipboard — the fixtures must be real captured snippets, and if you cannot capture one, construct it from
   the documented shape and mark it ASSUMED.
6. `tests/unit/ops-inverse.property.test.ts` — for generated sequences of ops (100 sequences × 20 ops over a
   seeded PRNG; no dependency — write a small mulberry32 in the test file):
   `apply(undo(apply(x))) === x` deep-equal, and history invariants: undo/redo never changes the sequence
   identity, `redo` after `push` is cleared, depth is bounded by the documented limit.
7. `tests/unit/selection.test.ts` and `tests/unit/clipboard.test.ts` — the behaviours above, plus the
   degenerate cases: empty range, single cell, reversed anchor/focus, a range whose rows were deleted,
   a TSV with a trailing newline, a cell containing a tab, a cell containing a quote at the start.
8. `PROGRESS.md` updated (M1's last piece; the op list is the contract the store will consume).

Constraints and fence:
- Touch only `src/core/**`, `tests/unit/**`, `PROGRESS.md`. No Obsidian, no React, no deps.
- Ops are plain data: no closures, no class instances, no functions. They must survive
  `structuredClone` — assert that in a test.
- No `any`, no `as`, no `!`, no bare `catch`. Inverses are total: every op type has an inverse in the test
  table, and a missing inverse is a failing test, not a runtime surprise.

STOP and report instead of proceeding if: an op cannot be inverted without keeping a full pre-image of the
whole table (report which one and what it would cost); or the docs specify coalescing behaviour that
contradicts the one-undo-step-per-user-action rule — quote both sentences and ask.

Acceptance (paste raw output):
- `bun run check` — green with coverage thresholds met.
- The property test result line (sequences generated, ops applied, failures).
- The clipboard round-trip results, counting the fixtures used, with the `fromHtml` fixtures named by their
  source (Sheets, Excel, or constructed).
- The `structuredClone` assertion result.

REPORT BACK with: the file list; the raw gate output; the op inventory with each op's inverse in one line;
the coalescing decision you implemented and the sentence in `docs/` that authorised it; anything ASSUMED
(especially the HTML clipboard fixtures); the exact next step.
