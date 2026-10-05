# PROGRESS

- Milestone: M0 — Foundation (complete) · M1 — Core domain (started)             Branch: main
- Last completed step: **step 07 — every field type, one file each, and the suites that prove them.** The
  registry holds all **sixteen** types of the `docs/03` mapping table, in that table's order, so
  `switch (field.type)` stays deleted; `src/core/format/` holds the genuinely cross-type logic (locale
  numbers and their readers, ISO dates and instants, text comparison, locale digits, shape checks) as named
  functions. The step-06 contract suite is now pointed at `allFields()`, and a second suite round-trips 181
  real-world inputs through `parse → toYaml → parse`.

- Verified (commands run, observed results):
  - `bun run check` — **exit 0**, with the suite grown from 115 tests / 8 files to **500 tests / 10 files**:
    `field-roundtrip` 206, `field-contract.all` 179, `property-schema` 29, `field-contract.text` 26,
    `fakes-contract` 16, `registry` 16, `boundaries` 12, `plugin-smoke` 7, `bases-registration` 5,
    `settings-tab` 4. `brand-gate: OK — 59 permitted match(es), 0 violations`, `manifest:check: OK`,
    Prettier clean, `bundle-size: OK` at `main.js 3905 B raw / 1843 B gzip` — **still unchanged**: the
    plugin does not import `src/core` yet, so the sixteen types add zero shipped bytes until step 12 wires
    `BasesSource` to the registry.
  - **Coverage** (`bunx vitest run --coverage`, exit 0, with the step-05 glob thresholds live at
    85/85/85/75 for `src/core/**`): all files **95.93 % stmts / 92.27 % branch**;
    `core/types.ts` 100 %; `core/fieldTypes` **97.83 / 94.96** (nine type files at 100 %, lowest
    `duration.ts` 90.47 and `singleSelect.ts` 95.94); `core/format` **90.6 / 85.96** (lowest `text.ts`
    84.78); `core/schema` 98.71 / 95.09. The floor passes with room to spare; every uncovered line is a
    refusal path or a defensive branch, and the table names them per file.
  - **The registry equals the `docs/03` list** — 16 ids in the mapping table's own order:
    `text, longText, number, checkbox, date, datetime, url, email, phone, singleSelect, multiSelect, rating,
    currency, percent, duration, attachment`, with `createdTime` and `lastModifiedTime` asserted **absent**
    (read from `file.ctime`/`file.mtime`, P11 — not storable).
  - **The round-trip table** — the suite reports `16 types, 181 cases, 149 canonical round-trips, 32 refused
    cleanly, 0 exceptions`. The 32 refusals are hostile or out-of-domain inputs (`{}`, a function, a
    5,000-character string where a number belongs, `2024-02-30`, `1,5`, `12 usd`, `50%`, `half`, `1h 30`,
    `45 minutes`, `-5m`, `not a rating`, …), each asserted to carry a reason and its original input.
  - **The AUDIT §8 probe, closed in code**: `{"90": 90, "45m": 2700, "2h": 7200, "1h30m": 5400}` seconds,
    asserted for storage *and* for filtering (`matches(2700, 'is', '45m') === true`), so the old build's
    `45m → 45 s` mis-parse cannot come back through the filter path.
  - **Two group commits** (this step, `git log --oneline`): `feat(core): the seven scalar field types and the
    shared format helpers`, then `feat(core): the remaining eight field types, and the registry-wide suites`.

- Two real problems the step found, both worth keeping:
  1. **`1h30m` was refused — the same family of bug as AUDIT §8.** The unit-group reader replaced each match
     inside the very string it was still iterating, with one shared `lastIndex`, so the second group was
     never seen and the reader reported "a duration mixes a unit with a number that has none". The reader now
     validates the whole string in one pass and sums it in a second; `1h30m`, `1h 30m`, `1.5h` and `45m` are
     all anchored, and a bare number is still read in the column's own unit.
  2. **The display form must be readable, and that decided five behaviours.** The suite asserts
     `parse(formatDisplay(v)) === v` for every canonical value, which forced: `longText` to keep its newlines
     (`formatDisplay` collapses nothing — wrapping is the cell renderer's business); `multiSelect` and
     `attachment` to use the *quoted* list form in the display too, so a label containing a comma cannot
     split into two values; `rating` to read its own star string back; `date`/`datetime` to read the
     locale's own rendering; and `percent`/`duration` to render exactly the unit they store.

- Decisions and interpretations worth recording:
  1. **`duration` stores seconds and renders `h:mm:ss`**, with a bare number read in `fieldOptions.unit`
     (seconds by default, P12). Explicit units always win: `45m` is 2,700 s, never 45. A `h:mm` value whose
     reading is genuinely ambiguous (`1:30` — 1 h 30 m or 1 m 30 s) is accepted *with a warning that names
     both readings*, instead of being silently guessed.
  2. **`percent` stores the number a person reads** (25 means 25 %), per `docs/03`; the sync mapper is the
     only thing that ever sees the other convention. `toYaml` writes the bare number, so changing a symbol
     never rewrites a note.
  3. **`multiSelect` stores labels as a YAML list** (docs/03 chose a property over the tag namespace), with
     case-insensitive de-duplication, first spelling wins, and a canonicalisation to the option list's
     spelling so grouping never splits one option into two. An empty list is `null`, never `[]` — "no value"
     has exactly one representation.
  4. **`attachment` stores vault paths, not links.** `[[path]]`, `[[path|label]]` and `[label](path)` are all
     *read* (the old build wrote them, and notes are hand-edited), and the canonical form written back is the
     plain path, which Obsidian's rename does not rewrite. `docs/03` allows the link form in the file; this
     is the deliberate, documented divergence — flag it if links should be written instead.
  5. **`datetime` canonicalises to UTC** (`2026-10-05T09:30:00Z`, milliseconds only when they exist), so one
     moment has one text form and a touched note shows an empty diff unless the moment changed. An input
     carrying another offset is converted (same moment, different spelling); a value with **no** offset is a
     wall-clock reading resolved in the vault's timezone. `date` never converts at all: it renders at UTC
     midnight in UTC, so `2025-09-24` is 24 September at every hour in every zone.
  6. **Every `Intl` call has a documented fallback, and the reason is recorded.** A malformed locale tag
     makes `Intl.NumberFormat`/`Intl.DateTimeFormat` **throw** (`RangeError: Incorrect locale information
     provided`), so rendering walks locale → `en` → a plain rendering, and `localeProblemFor` returns the
     reason for a settings screen to show. Reading walks the same two locales, so whatever a cell displays
     can be typed back into it.
  7. **The readers understand locale numerals, not just locale separators.** A `bn-BD` vault renders 2026 as
     `২০২৬` and 1,234.5 as `১,২৩৪.৫`, so digits are translated through a table derived from `Intl`
     (`format/digits.ts`), and grouping is accepted in both Western (`1,234,567`) and Indian (`12,34,567`)
     forms. `1,5` is still refused in an `en-GB` vault: it is a grouping by neither rule, and reading it as
     15 would be a data-destroying guess.
  8. **Years before 100 are handled**, because `Date.UTC(1, 0, 1)` is 1901: the calendar helpers validate
     month lengths directly and apply the year with `setUTCFullYear`. `0001-01-01` and `9999-12-31` are both
     in the round-trip table.
  9. **`rating` reads its own star string** (`★★★★½` sums to 4.5) and prefers a number written after the
     glyphs (`★★★★☆ 4.3/5` → 4.3), because the display form must be an input. Out-of-range values are
     clamped **with a warning**, never rejected. The half is `½`, not the rarely-installed `⯨`, which is
     still *read* for a value copied out of an older build.
 10. **`singleSelect` treats an unknown label as input, not as an error** — options are created by typing —
     and canonicalises a known label to the list's spelling (one option, never two differing by case).
 11. **`url`, `email`, `phone` are validators, not coercers**: any string is stored exactly as written, with
     a warning when the shape is off, because the alternative is refusing or silently rewriting the user's
     data. Only the editor (step 18) blocks a malformed commit. `number`, `currency` and `percent` do read
     their displayed forms back, including their symbol and grouping.
 12. **`optionsSchema` is still `undefined` everywhere.** Six types take `fieldOptions` and all six are
     served by the generic, reason-recording `validateFieldOptions` from step 06. The `docs/02` member stays
     declared and unused; adopting `@standard-schema/spec` is a dependency decision (open question 2).
 13. **`docs/04` has no §cell-rendering section**, although `prompts/step-07` cites one. `formatDisplay` was
     therefore built from the step's own bullets plus `docs/03` §the mapping table, and the descriptors
     deliberately leave truncation, wrapping and the option colour dot to the cell renderer (step 16).

- Assumed / not verified (each with how to verify):
  1. **Only this machine's ICU output is observed.** The Bengali numerals, the `en-CA` day key and the
     locale-derived date/time patterns are asserted on Node 20. Electron ships its own ICU build; step 10
     should re-run the locale cases in a real vault.
  2. **The locale month and day-period tables are derived at runtime**, so a locale this ICU build does not
     know falls back to `en` — correct, but silent. `localeProblemFor` is the hook a settings screen can use;
     nothing displays it yet.
  3. **The type's `editor` names are not validated against a cell-editor registry**, which does not exist
     until step 18; `EditorId` is a closed union, so a typo is a compile error, and the renderer will fall
     back to `text` for an id it does not know.
  4. (carried from step 06) **`file.ctime`/`file.mtime` are epoch numbers** — taken from `obsidian.d.ts`,
     not observed. Step 10 proves it.
  5. (carried from step 06) **The hostile table's long input is 1,000,000 characters, not 1e9**: 1e9 would
     allocate ~2 GB and take the runner out with an OOM instead of an assertion. The property under test is
     unchanged and the readers use `indexOf`-class operations with no backtracking regexes.
  6. **`url` uses `URL.canParse`**, which is available in Node 20 and in the DOM lib this project compiles
     against; Electron's runtime is the same family, and step 10 confirms it in the app.
  7. **The Indian-grouping rule (`12,34,567`) is derived from the CLDR convention, not from a cited spec.**
     It is tested with a Bengali context; a locale that groups some other way would be refused rather than
     mis-read, which is the safe direction.

- Findings worth keeping:
  1. **The shared suite is what found the design bugs.** Its first run against the fifteen new types produced
     nine failures: `longText`'s `toYaml` returned an object the suite refuses and `parse` could not read
     back; `duration` refused `1h30m`; `singleSelect` re-tagged a nested failure with the element instead of
     the original input; two fixtures had wrong expectations (`gt` against the *same* duration is false);
     and one step-06 assertion was text-only ("a million characters parses") where most types must refuse it.
  2. **A "style flag" on a value is a smell.** `longText` first carried `{ kind: 'text', style: 'block' }` from
     `toYaml` so the writer would not have to guess. It broke `parse(toYaml(v))` (the round-trip, which is
     the contract) and it was redundant: block-vs-quoted is a function of the value. Derived in the writer.
  3. **A failure must carry the input it was *given*.** The hostile assertions check `result.raw` identity, so
     a type that unwraps an array and then reports the element's failure with the element as `raw` is caught.
  4. **`expect(0).toBe(-0)` and other identity traps**: the suite compares signs, not values, and asserts
     antisymmetry as `forward + backward === 0` rather than `=== -backward`.
  5. **`parse` and `parsePlain` are allowed different whitespace policies** — frontmatter is authored text
     (preserved), a pasted cell is machine text (trimmed, NFC) — so the round-trip table asserts the plain
     form is a **fixpoint** (stable from the first cycle on) rather than equal to the original. The frontmatter
     round-trip stays exact.
  6. **`no-console` and `no-global-this` are both enforced**, and `noInlineConfig` means they cannot be
     waived: a test cannot print a summary line. The count lives in the test's own name and the numbers are
     asserted, so the runner's output still carries the evidence.

- Half-finished: nothing. All sixteen storable types are registered and proven; the two file-metadata ids are
  resolved as read-only descriptors by `schema/propertySchema.ts`, as designed in step 06.

- Open questions for the human:
  1. (unchanged, and now blocking step 08) **Confirm the filter-operator list** (`is, isNot, contains,
     notContains, startsWith, endsWith, isEmpty, isNotEmpty, gt, gte, lt, lte`) before the query parser
     consumes it and the filter builder renders it. `docs/01` has no operator table; the set is derived from
     `docs/02` §Query.
  2. (now concrete) **`@standard-schema/spec` as a types-only devDependency, or keep the local structural
     declaration and the generic `validateFieldOptions`?** Six types take options and are validated without
     the package; the question is whether the options editor (step 18) wants a schema.
  3. **`docs/04` does not contain the §cell-rendering section `prompts/step-07` cites.** Should `docs/04`
     gain one (it is the design-commitment document), or does cell rendering belong to `docs/01` §Grid?
  4. **`attachment`: write the `[[link]]` form for in-vault files (as `docs/03` allows) or keep writing the
     plain path (current)?** Plain paths survive a rename without being rewritten; links render.
  5. (carried from step 04) Should the layout guard emit a warning (current choice) or fail the run until
     step 21?
  6. (carried from step 04) Dependabot: the `obsidian` ignore covers `version-update:semver-major` only, so
     minor and patch bumps are still proposed.
  7. (carried from step 02, unchanged) `docs/09` line 33's description template contains a banned brand word
     while line 79 forbids it; the three proposed plugin descriptions still await a pick; whether the
     internal-only files keep whole-file brand-gate permissions.

- Next step: `prompts/step-08-query-and-pipeline.md` (M1 — the query AST, the DSL parser, the comparator and
  the pipeline), built on the `filterOps`/`matches`/`compare`/`groupKey` contract the sixteen types now
  declare.

- Files touched this step: `src/core/types.ts`, `src/core/format/{numbers,iso,digits,text,validation}.ts`,
  `src/core/fieldTypes/{number,currency,percent,checkbox,date,datetime,duration,longText,url,email,phone,
  singleSelect,multiSelect,rating,attachment,index}.ts`, `tests/unit/{field-contract.suite.ts,
  field-contract.all.test.ts,field-roundtrip.test.ts,registry.test.ts}`, `PROGRESS.md`. Nothing outside
  `src/core/**`, `tests/unit/**` and `PROGRESS.md`, as the fence requires.

- Earlier steps: 06 the field contract, the schema and the registry (the closed value model,
  `FieldDescriptor` exactly as `docs/02` writes it, one `text` type, the registry that replaces every
  `switch (field.type)`, `resolveField` with the read-only rules, and the shared contract suite; 115 tests);
  01 toolchain and gate (802 B / 532 B bundle, `bun run check` exit 0); 02 manifest and legal
  (`brand:gate`, `manifest:check`, `minAppVersion` 1.13.0 as the tested floor); 03 plugin shell (Bases view
  registration, two commands, settings tab, status bar item, `release-assets` and `version-bump`; 16 tests);
  04 CI and release (the `gate` job, the self-retiring layout guard, the tag-driven release with three
  assets; verified green on GitHub as run 37338515889); 05 fakes, boundaries and coverage (the fake vault,
  clock and transport; the boundary lint proven by a runtime test; 44 tests). Forced amendments are recorded
  in `prompts/README.md` under "Amendments applied during execution".
