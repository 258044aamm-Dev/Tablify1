# PROGRESS

- Milestone: M0 — Foundation (complete) · M1 — Core domain (in progress)            Branch: main
- Last completed step: **step 08 — the query layer.** One AST, a DSL parser and serialiser, an evaluator that
  dispatches through the registry, and the filter → search → sort → group pipeline the grid will read rows
  from. `src/core/query/**` and `src/core/view/**` are new; nothing else moved except one field on
  `ResolvedField` (below) and the coverage table, which now measures the whole core.

- Verified (commands run, observed results):
  - `bun run check` — **exit 0**: typecheck, lint (0 errors; one pre-existing warning on the settings tab),
    `brand-gate: OK — 59 permitted match(es), 0 violations`, `manifest:check: OK`, Prettier clean, tests,
    build, `bundle-size: OK`. The suite is now **746 tests across 14 files** — the unit project is 13 files:
    `field-roundtrip` 206, `query-table` 192, `field-contract.all` 179, `property-schema` 29,
    `field-contract.text` 26, `query-legacy` 21, `pipeline` 21, `registry` 16, `fakes-contract` 16,
    `query-document` 12, `boundaries` 12, `plugin-smoke` 7, `bases-registration` 5 — 742 in the unit project,
    plus `settings-tab.test.ts` (4 tests, the `dom` project). The workflow's layout job still skips its
    harness steps until step 21, so nothing about this step's numbers depends on a browser.
  - **Coverage** (`bunx vitest run --coverage`, exit 0): all files **94.78 % stmts / 91.97 % branch**;
    `core/query` **91.33 / 90.08** (ast.ts 100, evaluate.ts 88.95, parse.ts 89.86, serialize.ts 88.32);
    `core/view` **98.9 / 97.18**; `core/fieldTypes` 97.83 / 95.06; `core/format` 90.6 / 85.96;
    `core/schema` 98.72 / 95.15; `types.ts` 100. Both new directories are above the `src/core/**` floor
    (85/85/85/75), which is what the step's acceptance asks for.
  - **Parser totality, property-style** — the test reports itself in its own name, because this repo forbids
    `console.*` everywhere: `never throws and never hangs for any of the 2000 generated inputs, 1534 of which
    are broken` and `reads back what it writes, for the 439 generated inputs that parsed cleanly`. The
    generator is seeded (mulberry32), so a failure is reproducible; a third of its inputs are well-formed
    filters built from valid column/value pairs, a third are glued DSL fragments, a third are raw characters
    from the DSL's own alphabet. The totality test also asserts the walk stays under two seconds — a loop
    that never ended would hang the run, not fail an assertion.
  - **The pipeline's budget** — measured on this machine (Linux sandbox, Node 20, `bun`), 5,000 rows × 5
    columns through filter + search + two-level sort + group: **11.90 ms, 7.70 ms, 7.60 ms, 8.72 ms,
    7.75 ms** over five runs after a warm-up (the in-repo test asserts one run stays under 50 ms; this line
    comes from a throwaway probe script, since a passing test cannot print). It is a smoke budget, not a
    benchmark.
  - **The serialiser's fixture table** — **22 cases**, 21 of which round-trip exactly (including the
    quotations, the anchors, a list operand, nesting, booleans, a duration and a quoted instant) and one
    which is the documented loss: an operand no column can format is written as quoted JSON text and re-reads
    as an unreadable fragment *with* its error. (The step-08 commit message says "an 18-AST fixture table";
    the table holds 22 — see Findings 6.)
  - **The legacy DSL** — 20 strings from the old build's README table and its own example, each asserted row
    by row against six fixture rows, plus a test that the README's table of seven spellings is covered.

- The grammar implemented (productions, in order):
  1. `query := group ( 'or' group )*`
  2. `group := unary ( ('and')? unary )*` — juxtaposition is AND, which the legacy dialect needs
  3. `unary := 'not' unary | '(' query ')' | atom`
  4. `atom := function | name ':' shorthand | name operandOp value | name 'is' ['not'] ( value | emptiness )`
  5. `function := ('empty'|'notEmpty') '(' name ')' | ('startsWith'|'endsWith'|'contains') '(' name ',' value ')'`
  6. `shorthand := ['!'] [ '~' | '>' | '>=' | '<' | '<=' | '=' | '!=' ] (value | 'empty' | 'blank')`
  7. `value := word | quoted | number | true | false | date`, and a legacy comma list is a comma-separated
     run of value items.
  The lexer keeps character offsets on every token, and switches to "operand mode" after `:` and `,` — which
  is what lets `Site:https://example.com` and `Tags:draft,urgent` lex, and what lets an operator followed by
  a quoted value (`When:>"2026-01-01T00:00:00Z"`) stay one token.

- Decisions and interpretations worth recording:
  1. **The operator list is the 12 canonical ops, confirmed with the human** (`is, isNot, contains,
     notContains, startsWith, endsWith, isEmpty, isNotEmpty, gt, gte, lt, lte`). The legacy vocabulary
     (`equals`, `before`, `after`, `isTrue`, `isFalse`, `isAnyOf`, `containsAny`, `containsAll`) exists only
     in the old build and in `.tabula` files, so the *parser* translates it: `equals`→`is`, `before`→`lt`,
     `after`→`gt`, `isTrue`/`isFalse`→`is` with a boolean operand, `isAnyOf`/`containsAny`/`containsAll`→an
     `or`/`and` of the canonical ops, and a comma list→`or` of comparisons. No node kind was needed for any
     of them, which is exactly what the step's STOP clause asked about.
  2. **The AST has six kinds, not the four `docs/02` §Query sketched.** `empty` and `unparsed` are the two
     additions, and both are required by this step's deliverable: emptiness has three spellings that must
     collapse to one node, and an unreadable fragment has to survive as itself so the UI can underline it.
     `and`/`or` are n-ary (`parts`) rather than binary, and the constructors flatten and collapse as they
     build, so two spellings of one filter are the same value. **`docs/02` §Query should be updated to this
     union** — it currently documents `and|or|not|cmp` with `children`/`child`/`value` names.
  3. **`empty` as `not(empty)` is not the same as `isNot`, and that is deliberate.** `not` negates the
     *question*, so `not (Status = Done)` is true for a row whose status is empty; `Status != Done` is
     `isNot`, and every type's contract answers false for a value operator on an empty cell (step 07's
     suite, and the old engine did the same). `Status:!Done` — the legacy spelling — maps to `isNot`, which
     is what keeps migrated filters selecting the same rows; `not (...)` is the new escape hatch. Asserted in
     `query-legacy.test.ts` with both row sets side by side.
  4. **Ambiguity in the shorthand is resolved by the column, not by the parser.** `field:!x` means `isNot` on
     a single select (the README's table), `notContains` on a text-shaped column or a list column, `isNot`
     where that is all the type declares, and `not(is x)` otherwise. The mapping is one function with a long
     comment; the divergences are asserted.
  5. **Operands are read by the column's own `parsePlain`**, so `45m` means 2,700 seconds, `25%` means 25,
     `true` means a checked box and `Doing` is canonicalised against the option list — the query language
     accepts exactly what a cell accepts. The exception is the four text operators, which take the raw text,
     because `contains` on a multi-select column matches a *label substring* (step 07's contract) and handing
     it a parsed value would ask the wrong question.
  6. **`startsWith`/`endsWith` have no infix spelling, so they use the function family the dialect already
     has**: `startsWith(Name, "text")`, `endsWith(Name, "text")`. Inventing `^`/`$` would have collided with
     operands that contain them (`Site:$5`), and the round trip is exact — asserted for both anchors.
  7. **The serialiser writes the infix form whenever the operand needs quoting** (`Status = "Ann Lee"`,
     `When > "2026-05-04T09:30:00Z"`), because the shorthand scanner stops at a quote when it already carries
     an operator. `isNot` is always written `!=`, never `:!`, since `:!` is type-resolved. The seven
     normalisations are listed in the module header, including the one deliberate loss (an operand no column
     can format becomes quoted JSON text, which re-reads as an unreadable fragment *with an error*).
  8. **The search box reads `formatPlain`, not `formatDisplay`.** The machine spelling (`2026-01-01`,
     `1234.5`) is locale-independent and is the text `parsePlain` accepts, so one search string finds the
     same rows in every vault and can be pasted into a cell. The honest cost, asserted in the tests: typing
     `5 Jan 2026` finds nothing, and `$4` does not find `4.50`. Hidden columns are not searched, because the
     search box promises visible values only.
  9. **Sorting is stable and its last key is the row's file path, ascending, whatever the sort directions
     are.** Equal rows are common (empty cells, the same date), and a 5,000-row grid must not shuffle them
     between renders. A sort level for a column the view does not have is skipped, like a filter for one.
 10. **`ViewResult.rows` holds data rows only, and leaves out the rows of a collapsed group.** Group headers
     are derived (`groups` carries the same row objects), because the grid windows over known-height rows: a
     pseudo-row would have to be measured and skipped by every selection, keyboard and clipboard path. A
     collapsed group contributes no height to `rows` but still reports every row it has (`count`, `rows`), so
     expanding needs no recomputation. `matchedRows` is therefore what the filter and the search let through,
     and `rows.length` is what is on screen; they differ only when something is collapsed.
 11. **A group's key is the registry's folded `groupKey`; its label is the column's `formatDisplay`.** A
     `.base` file stores `doing`, `draft\u0000urgent`, `2026-01-01`; the header reads `Doing`, `draft, urgent`,
     `1 Jan 2026`. The empty group's key is `''` (both `textGroupKey` and `numericGroupKey` use the empty
     string for "no value") and its label is the one piece of wording this module owns: `(empty)`.
 12. **Filter → search → sort → group, in one pass each.** The structured query is applied first because it
     is the cheap per-row test, and the search only runs on what survives it. Filtering and searching share a
     loop and write into a single output array (no per-row allocation); the sort decorates one array of
     indices; the field lookup is a `Map` built once per call.
 13. **The evaluator is a pure dispatch with three documented defaults**: an `unparsed` fragment is true (a
     typo never hides a row), a filter naming a column the view does not have is true (a saved filter must
     not blank the table while a column is being re-added), and an unknown column in a `cmp` is true for the
     same reason. `evaluate` answers a boolean and allocates nothing; the *diagnosis* is a separate walk
     (`operandProblems`), which is what makes "one message per column" cheap.
 14. **`ResolvedField` gained a `definition` field** (a `PropertyDefinition`), because a filter names a
     column and the query layer had no way to know which column a resolved field was. One field, filled in
     the same three `return`s of `resolveField`; no test needed changing. Reported here because it is a
     step-06 file touched by step 08.

- Assumed / not verified:
  1. **The generated-input distribution is mine, not a known-good corpus.** Two thousand inputs from a fixed
     seed prove the parser is total *over that sample*; the seed and the generator are in the test, so a
     failure is reproducible, but a different generator could still find something. The corpus from the
     prompt's "fixtures from `docs/01`" does not exist (see the finding below).
  2. **The timing numbers are from a Linux container on Node 20**, not from Obsidian's Electron on a
     mid-range laptop. The in-repo assertion is the 50 ms budget; the numbers above are indicative.
  3. **The pipeline has not met a real adapter.** Rows arrive as canonical values, which is the step-12
     adapter's job; until then, a row built by hand is the only input the pipeline has seen.
  4. **Coverage is not a proof for the uncovered lines.** They are, by inspection: `serialize`'s
     unknown-operator fallback (unreachable for the closed `FilterOpId` union), some parser recovery spans,
     and `evaluate`'s defensive shape checks. Listed here so a later step can attack them deliberately
     instead of by accident.

- Findings worth keeping (things the docs did not say, or said differently):
  1. **`prompts/step-08` cites `docs/01` §filters, §the query string, §sort and §grouping, and a table of
     `(expr, row, expected)` "from `docs/01`". `docs/01` has none of them** — it is 117 lines and has no
     query-string section, no operator table and no grammar. The prompt's own bullet list and the old README's
     table are therefore what the parser is built against, and `query-table.test.ts` *is* the missing table,
     written out. Recommend adding §filters/§the query string to `docs/01`, or moving the DSL's spec into
     `docs/02` §Query where the AST already lives.
  2. **`docs/02` §Query's sketched union and function signatures are out of date** (`children`/`child`/`value`,
     `parseQueryString(input, schema)`, `evaluate(expr, row, schema)`, `toQueryString(expr)`). This build uses
     the step's closed union and a `QueryContext`, which carries resolved fields rather than a schema.
  3. **A select column sorts alphabetically, not by its option order.** `singleSelect.compare` is the shared
     text comparator, so a Status column sorts `Doing, Done, Todo`; the old build sorted by the option's index
     in the column's list. Neither is wrong, but a select *is* an ordered vocabulary, and step 18's filter
     builder will show that order. Recommend deciding before the column-sort UI ships: either read
     `fieldOptions.options` in `singleSelect.compare`, or document alphabetical sorting as the contract.
  4. **Every type sorts its empty cell last when ascending** (`compareNullableNumbers` and
     `compareNullableText` both answer +1 for absent, and the list type follows). Asserted, since it is the
     kind of rule that silently drifts.
  5. **The lexer needed one merge rule to be able to read what the serialiser writes**: an operator followed
     by a quoted value in operand mode is one token. Without it `When:>"2026-01-01"` was unreadable — found by
     the fixture table, not by a human.
  6. **Corrections to this step's own record.** The step-08 commit message says the round-trip fixture table
     has "18 AST shapes"; it has 22 cases (21 exact, 1 lossy). The same message calls `query-document.test.ts`
     "a fourth test file beyond the step's three" — correct, and it is why `query-table.test.ts` reports 192
     tests rather than the ~150 the prompt's bullet list implies. Neither number is asserted anywhere, so
     nothing else moved; recorded here because the commit message is immutable once pushed.

- Open questions for the human:
  1. **Should `docs/02` §Query (and `docs/01`) be updated to the implemented union, grammar and context?**
     The code is ahead of the architecture document in three places now (finding 1 and 2).
  2. **Should a select column sort by its option order?** (finding 3 — affects step 18's filter builder and
     the column-sort UI.)
  3. (unchanged) **`@standard-schema/spec` as a types-only devDependency, or keep the local structural
     declaration and `validateFieldOptions`?**
  4. (unchanged) **`docs/04` still has no §cell-rendering section**, which `prompts/step-07` cites.
  5. (unchanged) **`attachment`: write `[[link]]` or the plain vault path?** (current: plain path.)
  6. (unchanged) Layout guard: warning (current) or failing until step 21? Dependabot keeps proposing
     `obsidian` minor bumps. `docs/09` line 33 still contains a banned word in its description template;
     the three candidate plugin descriptions await a pick.

- Next step: `prompts/step-09-ops-undo-selection.md` — the operation model (every mutation as a value with an
  inverse), the undo/redo stack, selection ranges and the clipboard matrix. It is M1's last piece: after it,
  the `src/core/**` coverage floor is the real floor and M1 closes.

- Files touched this step: new — `src/core/query/{ast,parse,serialize,evaluate}.ts`,
  `src/core/view/pipeline.ts`, `tests/unit/{query-table,query-legacy,pipeline,query-document}.test.ts`;
  changed — `src/core/schema/propertySchema.ts` (`ResolvedField.definition`), `PROGRESS.md`. Nothing outside
  `src/core/**`, `tests/unit/**` and `PROGRESS.md`. `query-document.test.ts` is a fourth test file beyond the
  step's three: it covers the stored-document path (encode/decode of untrusted `.base` JSON), which is what
  took `src/core/query` from 80 % to 91 % statements.

- Earlier steps: 07 the fifteen remaining field types, the shared format helpers and the registry-wide suites
  (16 types registered, 181-case round-trip table, 500 tests; two real bugs found — an unanchored duration
  reader and a display form richer than its value); 06 the field contract, the schema and the registry (the
  closed value model, `FieldDescriptor` exactly as `docs/02` writes it, the shared contract suite; 115
  tests); 05 fakes, boundaries and coverage; 04 CI and release; 03 the plugin shell; 02 manifest and legal;
  01 toolchain and gate. Forced amendments are recorded in `prompts/README.md` under "Amendments applied
  during execution".
