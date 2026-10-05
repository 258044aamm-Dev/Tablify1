Task: implement every field type the product supports, one file per type, all conforming to the contract
suite built in step 06. This is the step that removes the old codebase's ~18 duplicated type switches.

Authoritative list: the **mapping table in `docs/03-data-model-and-migration.md`** — every row that is not
marked "dropped" or "not stored". Enumerate those rows in your plan, and if your count differs from what
`docs/06-roadmap.md` says, use the table and report the difference in one line. Do not implement
`autoNumber` (dropped) or `createdTime`/`lastModifiedTime` (read-only descriptors built from
`file.ctime`/`file.mtime` — those already exist from step 06).

Read first: `docs/03` §the mapping table (every row's second and third columns are your
`toYaml`/round-trip rules), `docs/01-spec.md` §column types and §filter operators, `docs/04` §cell
rendering rules (what `formatDisplay` shows for each type), `docs/08-decisions.md` §P11, §P12, §E2.

Deliverable — in this order, one commit per group so I can review in two sittings:

Group A — `src/core/fieldTypes/{number,currency,percent,checkbox,date,datetime,duration}.ts`:
- `number`: plain decimal, no grouping in `formatPlain`; `toYaml` writes a number.
- `currency`: symbol and precision are render-only (`fieldOptions`); `toYaml` writes the bare number.
- `percent`: **human-first** — `25` means 25 %; Airtable stores `0.25` and we deliberately diverge; the
  divergence must be documented in a doc comment here and asserted in a test.
- `checkbox`: `toYaml` writes a boolean; `parse` accepts `true/false`, `yes/no`, `1/0` from pasted text.
- `date`: `"YYYY-MM-DD"` strings, never a `Date` in the canonical value; timezone-free comparisons.
- `datetime`: ISO 8601 with offset when a time is present; `formatDisplay` renders in local time using
  `ctx.timezone`; `compare` compares instants, not strings.
- `duration`: **seconds** in the canonical value, rendered `h:mm:ss`; `parsePlain` accepts `90`, `1:30`,
  `1:30:00`, `45m`, `2h 15m` and must reject a bare `45m`-style ambiguity **only if** it is genuinely
  ambiguous — state your rule in a comment and test it. (The old plugin's bugs are in
  `prototype/AUDIT-REPORT.md` §8 and §13 for reference; read those two rows before you write the parser.)

Group B — `src/core/fieldTypes/{longText,url,email,phone,singleSelect,multiSelect,rating,attachment}.ts`:
- `longText`: multi-line; `toYaml` must choose a block scalar when the value contains a newline and a
  quoted scalar otherwise (assert both shapes in a test).
- `url`, `email`, `phone`: no coercion on write, validation only on edit; `parse` accepts any string but
  records a `warning` reason for a malformed value (the tagged result carries it; nothing throws).
- `singleSelect`: canonical value is the option **label**; `fieldOptions.options` supplies order and
  colour; `parse` on an unknown label returns `ok` with the label and a `warning` (options are created at
  the call site, not here); `toYaml` writes the string.
- `multiSelect`: canonical value is an ordered, de-duplicated array of labels; `parsePlain` splits on the
  list separator used by the paste model; `toYaml` writes a YAML list, and an **empty** array must write
  nothing rather than `[]` — assert it.
- `rating`: `fieldOptions.max` (default 5); `parse` clamps, and clamping is a `warning`, not an error.
- `attachment`: canonical value is a string path, a `"[[wikilink]]"`, or a `string[]`; `formatDisplay`
  renders a wikilink as-is and an external path as plain text; `toYaml` keeps the shape it received.

Also:
- `src/core/fieldTypes/index.ts` — one line per type (registration), in a documented order.
- `tests/unit/field-contract.all.test.ts` — the step-06 suite iterated over `allFields()`, plus a test that
  the registered set equals the list you enumerated from `docs/03` (so a missing type is a failing test,
  not a discovery made in production).
- `tests/unit/field-roundtrip.test.ts` — a fixture table per type covering: empty/undefined, the smallest
  and largest plausible value, a value with surrounding whitespace, unicode (emoji, RTL, combining marks),
  and a hostile value; for each, `parse` → `toYaml` → `parse` must be stable (idempotent), and
  `formatDisplay` must never contain `undefined`, `NaN` or `[object Object]`.
- `PROGRESS.md` updated (M1 continues; the type count actually registered; the divergence notes for
  `percent`, `duration` and `multiSelect`).

Constraints and fence:
- Touch only `src/core/**`, `tests/unit/**`, `PROGRESS.md`.
- One file per type. No shared "helpers.ts" grab-bag: cross-type logic that is genuinely shared (locale
  number formatting, ISO parsing) goes in `src/core/format/` as named functions with their own tests.
- No `Intl` call without a documented fallback: state what happens in a vault with an unusual locale, and
  assert it.
- No dependency for dates or numbers. No `any`, no `as`, no `!`.

STOP and report instead of proceeding if: a rule in `docs/03` contradicts a rule in `docs/01` for a type
(report the two sentences side by side; do not choose silently); or a type's round-trip cannot be made
idempotent without a schema change.

Acceptance (paste raw output):
- `bun run check` — green, with coverage on `src/core/**` at or above the step-05 threshold.
- The registry test's assertion that the registered types equal the `docs/03` list — paste the list it
  compared, with the count.
- The hostile/idempotence table results — paste the failures if there are none, and the summary line if
  there are.
- `git log --oneline` for this step, showing the two group commits.

REPORT BACK with: the file list; the enumerated type list with its count and the roadmap discrepancy if
any; the raw gate output; the two divergence notes (`percent`, `duration`) as you wrote them in code;
anything ASSUMED; the exact next step.
