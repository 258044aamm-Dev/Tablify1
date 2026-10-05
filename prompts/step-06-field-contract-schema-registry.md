Task: build the spine of `src/core` — the property schema, the `FieldDescriptor` contract, and the registry
that replaces every `switch (field.type)` in the old codebase. One reference type (`text`) proves the
contract suite. No other field types this turn.

Read first: `docs/02-architecture.md` §the field-type registry (the `FieldDescriptor` interface is quoted
there — implement it as written), §layers, §Query; `docs/03-data-model-and-migration.md` §the mapping table
(your `toYaml`/`parse` rules) and §read-only properties; `docs/01-spec.md` §column types;
`docs/08-decisions.md` §E2, §P11, §P12. `src/core` may import nothing but `src/core`.

Deliverable:

1. `src/core/types.ts` — `CellValue`, `FieldTypeId`, `Parsed<T>` (a tagged result: `{ ok: true, value } |
   { ok: false, error, raw }`), `FieldContext` (vault-relative path, `now()`, `timezone`, `locale`, plus
   `fieldOptions` and `columnName`), `FilterOpId`, and the shared `YamlScalar` type.
   No `any` anywhere; every union is closed and exhaustively handled.
2. `src/core/schema/propertySchema.ts` — the property→field resolution:
   - `resolveField(property, ctx): FieldDescriptor` using the registry, with the read-only rules:
     `file.ctime`/`file.mtime`-backed columns (`created time`, `last modified time`) resolve to read-only
     descriptors built in-file; a property whose `fieldOptions.type` names a type the registry does not
     know resolves to a `text` descriptor **plus** a recorded reason.
   - `fieldOptions` validation: unknown keys are ignored, `max` must be a positive integer, select options
     must be unique by label. Return reasons, never throw.
3. `src/core/fieldTypes/registry.ts` — `defineField()`, `registerField()`, `getField(id)`, `allFields()`,
   and `assertRegistryComplete()` (which the contract suite calls). The registry is a `Map`, frozen after
   registration in production, mutable only through `registerField` during module init. Registration must
   be explicit and additive: adding type #N+1 touches exactly one new file plus one line in
   `src/core/fieldTypes/index.ts`. Prove that in the report by stating the diff size.
4. `src/core/fieldTypes/text.ts` — the reference descriptor: `parse`, `toYaml`, `formatDisplay`,
   `formatPlain`, `parsePlain`, `filterOps` (from the operator table in `docs/01-spec.md`), `matches`,
   `compare` (total order, locale-aware, `undefined` sorts last), `groupKey`, `defaultValue`.
   This file is the template every later type copies; comment it so the next author cannot get the shape
   wrong.
5. `tests/unit/field-contract.suite.ts` — the shared suite, exported as a function that takes a descriptor
   and asserts the contract (it will be pointed at the whole registry in step 07):
   - `parse(formatDisplay(v))` round-trips for a table of canonical values,
   - `formatPlain` → `parsePlain` round-trips,
   - `toYaml` returns a YAML-safe scalar/list type (no functions, no `undefined` inside arrays),
   - `compare` is a total order (antisymmetry, transitivity over the fixture table, and consistent with
     `groupKey` equality),
   - every declared `filterOp` is implemented and returns a boolean for the fixture operand,
   - `parse` never throws for a hostile input table (null, undefined, `{}`, `[]`, 1e9-length string,
     emoji, RTL text, a number where a string is expected).
6. `tests/unit/field-contract.text.test.ts` — the suite pointed at `text`, plus text-specific cases
   (leading/trailing whitespace policy — state it in a comment and mirror it in `toYaml`).
7. `tests/unit/registry.test.ts` — `assertRegistryComplete()` passes with only `text` registered;
   registering the same id twice throws; the registry is frozen after `freezeRegistry()`; an unknown type
   name resolves through the `text` fallback **with a reason recorded**.
8. `PROGRESS.md` updated (M1 started; the exact registry API; how many files adding type #2 requires).

Constraints and fence:
- Touch only `src/core/**`, `tests/unit/**`, `PROGRESS.md`. No React, no Obsidian, no DOM, no new deps.
- No `switch (field.type)`-style branching anywhere: the only dispatch is through the registry.
- No `any`, no `as`, no `!`, no bare `catch`. `parse` returns the tagged error type, it never throws.
- Every public function gets a one-line doc comment stating its contract; no paragraph-length prose.

STOP and report instead of proceeding if: the `FieldDescriptor` interface in `docs/02` cannot be
implemented without a change to it (do not change it — report the exact blocker); or the read-only
`ctime`/`mtime` columns cannot be expressed as descriptors without a second interface.

Acceptance (paste raw output):
- `bun run check` — green.
- `bun run test -- --coverage` — the coverage table for `src/core/**`, which must already meet the glob
  threshold from step 05.
- A hostile-input run: paste the test names and results for the hostile table in item 5.
- The registry diff proof: paste `git diff --stat` for a scratch type registered through the one-line
  pattern, then revert it.

REPORT BACK with: the file list; the raw gate output; the coverage table; the answer to "how many files
does field type #2 require?" with the diff stat that proves it; anything ASSUMED; the exact next step.
