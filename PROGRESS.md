# PROGRESS

- Milestone: M0 — Foundation (complete) · M1 — Core domain (started)             Branch: main
- Last completed step: **step 06 — the field contract, the schema, and the registry.** `src/core` now has a
  spine: a closed value model, a `FieldDescriptor` contract implemented exactly as `docs/02` writes it, one
  reference type (`text`), a registry that replaces every `switch (field.type)`, and the property→field
  resolution that forgives a hand-edited `.base` file. One shared contract suite proves a descriptor; step 07
  points it at every type.

- Verified (commands run, observed results):
  - `bun run check` — **exit 0**, with the suite grown from 44 tests / 5 files to **115 tests / 8 files**:
    `field-contract.text` 26, `property-schema` 29, `registry` 16, `fakes-contract` 16, `boundaries` 12,
    `plugin-smoke` 7, `bases-registration` 5, `settings-tab` 4. `brand-gate: OK — 59 permitted match(es),
    0 violations`, `manifest:check: OK`, Prettier clean on every new file, `bundle-size: OK` at
    `main.js 3905 B raw / 1843 B gzip` — **unchanged**, because the plugin does not import `src/core` yet;
    the core adds zero shipped bytes until step 12 wires `BasesSource` to it.
  - **Coverage, with the step-05 glob threshold now live** (`bunx vitest run --coverage`, exit 0):
    `core/fieldTypes 98.4 % stmts / 98.14 % branch`, `core/schema 98.71 / 95.09`, `core/types.ts 100 %`,
    `text.ts 100 %` (statements, branches, functions and lines), all files `98.81 / 96.41`. The floor is
    85/85/85/75, so it passes with 13 points of headroom; the uncovered lines are the two unreachable
    defensive branches in `assertRegistryComplete` and three "cannot happen" paths in the schema layer.
  - **A hostile-input run**, names and results pasted from `--reporter=verbose` (26/26 in the file):
    `parse never throws, for any hostile input` ✓ — 18 labelled inputs (null, undefined, `{}`, a nested
    object, `[]`, `[{a:1}]`, the number 42, NaN, Infinity, a boolean, a function, a symbol, a `Date`,
    a 1,000,000-character string, emoji including a ZWJ sequence, right-to-left text, a string containing
    NUL, whitespace only); `parsePlain never throws, for any hostile text` ✓; `handles a very long value in
    every operator without pathological work` ✓.
  - **The one-line cost of field type #2**, measured against the staged step-06 tree:
    ```
     src/core/fieldTypes/index.ts        |  1 +
     src/core/fieldTypes/scratchProbe.ts | 23 +++++++++++++++++++++++
     2 files changed, 24 insertions(+)
    ```
    the single added line being `export { scratchProbeField } from './scratchProbe';`. In that state
    `bunx tsc --noEmit` and `bunx eslint src/core/fieldTypes` were green and the new type was live:
    `allFields(): longText, text` / `getField('longText') → Long text`. The probe was then deleted and the
    line reverted (verified: no unstaged diff). Answer to "how many files does field type #2 require?" —
    **one new file, plus exactly one line in `index.ts`**, because a type module registers itself when it is
    imported. Nothing else changes: no list to append to, no dispatch to extend, no test file to duplicate
    (the shared suite picks it up when step 07 points it at the registry).

- Two real problems the step found, both worth keeping:
  1. **An "invalid operand" filter must satisfy nothing, not everything.** The first operand coercion mapped
     anything that is not a scalar to `""`, which a test written the other way round exposed: `contains` with
     an object operand then matched *every* row — a filter that looks like it works and silently ignores what
     the user asked for. `readOperand` now distinguishes "no operand yet" (`null`/`undefined` ⇒ `""`) from
     "cannot be text" (object, array, function, symbol ⇒ invalid ⇒ the operator answers false).
  2. **`expect(0).toBe(-0)` fails.** The suite's antisymmetry assertion negated one sign, and `compare(v, v)`
     is `0`, so `-0` vs `0` failed under `Object.is`. Fixed by asserting the sum of the two signs.

- Decisions and interpretations worth recording:
  1. **`resolveField` returns a `ResolvedField`, not a bare `FieldDescriptor`.** The step requires the reasons
     to be *recorded*, and a descriptor has nowhere to carry them, so the result is
     `{ descriptor, readOnly, reasons, options, context }`. The descriptor interface itself is implemented
     exactly as `docs/02` writes it — no member added, none removed. If a later step wants reasons somewhere
     else, this is the one place to change.
  2. **`docs/01-spec.md` has no operator table**, although the step refers to one. `FilterOpId` is therefore
     derived from the semantics `docs/02` §Query needs: `is, isNot, contains, notContains, startsWith,
     endsWith, isEmpty, isNotEmpty, gt, gte, lt, lte`. `text` declares the eight string operators and answers
     `false` for the numeric ones rather than comparing strings numerically. **This list is worth confirming
     before step 08 (the query parser) and step 23 (the filter builder) freeze it** — see open questions.
  3. **`EditorId` and `StandardSchemaV1` are referenced by the `docs/02` interface but defined nowhere in the
     docs.** `EditorId` is now a closed union of the editors `docs/01` §Editing names plus `readonly`
     (step 18 owns the components, step 19 the keys). `StandardSchemaV1` is declared *structurally* in
     `src/core/types.ts` and nothing implements it yet; see open question 2.
  4. **`editor` is not defaulted to `id` by `defineField`.** `docs/02` says the editor "defaults to id", but
     the editor set is smaller than the type set — `currency`, `percent` and `duration` share the number
     editor, and ids like `createdTime` are not editor ids at all. The default is resolved where the editor
     set lives (the grid, step 18); typing it here would need a cast the fence forbids. Recorded so nobody
     "fixes" it with one.
  5. **The whitespace and Unicode policy for `text`**, asserted in `tests/unit/field-contract.text.test.ts`:
     `parse` preserves authored frontmatter byte for byte; `parsePlain` trims and normalises to NFC, because
     the same name pasted from two apps must not become two values; whitespace-only is the empty value
     (`null`) in both paths, so a canonical `text` value is never `""`; `toYaml` mirrors this by writing the
     value verbatim and writing `null` for absence, which the write queue turns into a deleted key.
  6. **`compare` ends with a code-point tiebreak** for exactly this reason: at variant sensitivity a
     collator reports `e`+U+0301 and `é` as *equal*, so without the tiebreak two visually identical values
     would compare equal while `groupKey` still separated them, and the suite's consistency assertion would
     fail. There is a test with the concrete pair; the tiebreak makes the sort deterministic instead.
  7. **`assertRegistryComplete(target)` takes an optional registry** so the guard itself is testable — the
     shipped registry cannot be broken from outside, so an argument is the only honest way to prove the
     assertion fires.
  8. **`filterOps` is a declaration, not documentation.** A type that declares an operator it does not handle
     fails the shared suite (`declares "x" but no case exercises it`), and a fixture that uses an undeclared
     operator fails too. That is what keeps the operator list honest as types are added.
  9. **The registry holds 1 of 18 ids on purpose.** `FIELD_TYPE_IDS` lists all eighteen type names, but two of
     them (`createdTime`, `lastModifiedTime`) are read-only columns backed by file metadata and are never
     registered — they are built inside `schema/propertySchema.ts` (P11). `assertRegistryComplete()` checks
     what is registered, not that the list is exhausted, which is what lets step 07 point the suite at the
     registry as it grows.

- Assumed / not verified (each with how to verify):
  1. **Only `text` exists.** The other fifteen types' storage rules come from `docs/03` §the mapping table and
     are unproven until step 07 implements them. Nothing in this step claims otherwise.
  2. **`Intl` output.** The two file-metadata columns render through `Intl.DateTimeFormat` with the context's
     locale and timezone. The tests pin `en-GB` in UTC, `Asia/Dhaka` and `Asia/Tokyo` on this machine's ICU
     (Node 20, full-icu): `24 Sept 2025, 06:26`, `24 Sept 2025, 12:26`, `25 Sept 2025, 05:00`. Obsidian runs on
     Electron's ICU, which should agree for these locales; a locale with a different CLDR date pattern could
     render a different separator. Verify on a real vault in step 10.
  3. **`file.ctime`/`file.mtime` are epoch numbers.** The descriptor accepts epoch ms or an ISO string; that
     the real `TFile` fields are numbers is taken from `obsidian.d.ts`, not observed. Step 10 proves it.
  4. **`StandardSchemaV1` is written from memory of the spec's v1 shape**, not from a fetched page, and is
     structurally compatible rather than imported. Verify if the dependency is adopted (open question 2).
  5. **The hostile table's long input is 1,000,000 characters, not the 1e9 the step names** — 1e9 would
     allocate roughly two gigabytes and take the runner out with an OOM instead of an assertion. The property
     under test (no throw, no quadratic or backtracking work) is the same at 1e6, and the implementation uses
     `indexOf`-class string operations with no regular expressions. A 1e9 run needs a machine with ~4 GB
     spare; it is not in CI.

- Findings worth keeping:
  1. A closed union makes some validation unrepresentable: `if (field.id === '')` was a **type error**
     (`'FieldTypeId' and '""' have no overlap`), so the check was deleted rather than kept as dead code. If a
     validation cannot be typed, it is usually unnecessary.
  2. **Method syntax is what makes the type parameter erasable.** `FieldDescriptor<string | null>` is
     assignable to `FieldDescriptor<CellValue>` because method parameters are bivariant in TypeScript;
     rewriting the interface's methods as arrow properties would break registration and force a cast, which
     the house fence forbids. Worth knowing before anyone "tidies" `docs/02`'s interface.
  3. `satisfies` is allowed by the fence (`as` is not) — the scratch probe used it to keep a literal
     descriptor assignable without a cast.
  4. Prettier owns line breaking: hand-wrapped signatures are rejoined, so `format:check` failed on all eight
     new files until `bun run format` ran. Run the formatter before the first gate of a step, not after.

- Half-finished: nothing. The registry deliberately holds one type; `FIELD_TYPE_IDS` lists eighteen.

- Open questions for the human:
  1. **Confirm the filter-operator list** (`is, isNot, contains, notContains, startsWith, endsWith, isEmpty,
     isNotEmpty, gt, gte, lt, lte`) before step 08 parses it and step 23 renders it. `docs/01` has no operator
     table, so this list is currently derived from `docs/02` §Query.
  2. **`@standard-schema/spec` as a types-only devDependency, or keep the local structural declaration** plus
     the generic `validateFieldOptions`? The question becomes concrete in step 07: `singleSelect`,
     `multiSelect`, `rating`, `currency`, `percent` and `duration` all take options, and `docs/02` gives the
     descriptor an `optionsSchema` member that nothing populates today.
  3. (carried from step 04) Should the layout guard emit a warning (current choice) or fail the run until
     step 21?
  4. (carried from step 04) Dependabot: the `obsidian` ignore covers `version-update:semver-major` only, so
     minor and patch bumps are still proposed.
  5. (carried from step 02, unchanged) `docs/09` line 33's description template contains a banned brand word
     while line 79 forbids it; the three proposed plugin descriptions still await a pick; whether the
     internal-only files keep whole-file brand-gate permissions.

- Next step: `prompts/step-07-field-types.md` (M1 — the remaining field types, each one file, and the shared
  contract suite pointed at the whole registry).

- Files touched this step: `src/core/types.ts`, `src/core/fieldTypes/registry.ts`,
  `src/core/fieldTypes/text.ts`, `src/core/fieldTypes/index.ts`,
  `src/core/schema/propertySchema.ts`, `tests/unit/field-contract.suite.ts`,
  `tests/unit/field-contract.text.test.ts`, `tests/unit/registry.test.ts`,
  `tests/unit/property-schema.test.ts`, `PROGRESS.md`. Nothing outside `src/core/**`, `tests/unit/**` and
  `PROGRESS.md`, as the fence requires.

- Earlier steps: 01 toolchain and gate (802 B / 532 B bundle, `bun run check` exit 0); 02 manifest and legal
  (`brand:gate`, `manifest:check`, `minAppVersion` 1.13.0 as the tested floor); 03 plugin shell (Bases view
  registration, two commands, settings tab, status bar item, `release-assets` and `version-bump`; 16 tests);
  04 CI and release (the `gate` job, the self-retiring layout guard, the tag-driven release with three
  assets; verified green on GitHub as run 37338515889); 05 fakes, boundaries and coverage (the fake vault,
  clock and transport; the boundary lint proven by a runtime test; 44 tests). Forced amendments are recorded
  in `prompts/README.md` under "Amendments applied during execution".
