# ADR-0004 — Empty, null and unknown values: distinctions preserved

- **Status:** Accepted
- **Source:** adopted recommendation (`docs/08-decisions.md` §Open decisions,
  `docs/03-data-model-and-migration.md` §value mapping, `docs/R1-json-schema-and-core.md` step 3).
- **Phases:** R1
- **Proves:** `tests/unit/core-values.test.ts` and the value fixtures in
  `tests/fixtures/tablify/` (R1 steps 3 and 9)

## Context

"Empty" is not one thing. A cleared checkbox, `false`, `0`, an empty string, an empty list and an
absent key are six different states, and a data file can contain all of them for the same field.
The rule docs/03 sets — preserve the distinctions per field semantics — has to become a concrete,
testable matrix before the codec is written, or the first implementation quietly collapses cases
("`false` is falsy, so treat as empty") and the collapse is only discovered by a user whose data
changed.

## Decision

One canonical in-memory model, one written form, one escape hatch:

1. **Canonical no-value is `null`.** On read, a missing key and an explicit `null` both produce
   `null` (they are the same statement in this format: no value). On write, no-value keys are
   **omitted**: the serializer never writes `null` for a cell. Round-trip equality is therefore
   *model* equality plus serializer idempotence — `serialize(parse(serialize(parse(text))))` equals
   `serialize(parse(text))`, asserted as a property, not asserted byte-for-byte against arbitrary
   hand-written input (which may be normalizing on first write, exactly once).
2. **Values that look "falsy" are values.** `false` on a checkbox, `0` on a number, `""` on a text
   field and `[]`… no: `[]` means *no selections* and canonicalizes to no-value. The matrix:

   | Field type | No value | A value that must never be treated as empty |
   | --- | --- | --- |
   | `text`, `longText`, `url`, `email`, `phone` | absent / `null` | `""` stays `""` |
   | `number`, `currency`, `percent`, `rating`, `duration` | absent / `null` | `0` stays `0` |
   | `checkbox` | absent / `null` | `false` stays `false` (`null` ≠ `false`) |
   | `date`, `datetime` | absent / `null` | any valid string keeps its exact spelling |
   | `singleSelect` | absent / `null` | an optionId string, even unknown (see 4) |
   | `multiSelect`, `attachment` | absent / `null` / `[]` | any non-empty ordered list |
   | link | absent / `null` / `[]` | any non-empty ordered id list |

3. **Units are canonical and unambiguous.** `percent` stores percent points (`25` is 25%);
   `duration` stores seconds, whole or fractional (the legacy parser kept `1.5`-style values and
   the guide's value table says *finite number*, so the codec must not be stricter); `date` is
   `YYYY-MM-DD` with no time zone ever applied (no local
   `Date` construction anywhere on this path); `datetime` is an ISO 8601 instant with explicit
   offset or `Z`. Numbers must be finite: JSON cannot carry `NaN`/`Infinity` and the serializer
   rejects them rather than writing a token that will not parse back.
4. **Values the field cannot represent are preserved, not repaired.** If a JSON value does not fit
   the field's shape (an object, an array where a scalar belongs, a number for `text`, an unknown
   optionId, an id not in the target table, a malformed date string), the parser keeps the raw JSON
   in the canonical model wrapped as an invalid value (`{ invalid: true, raw, reason }`), records a
   warning naming field and row, and the serializer writes the raw JSON back unchanged. The
   document never silently loses or invents a value, and a future editor can repair it in place.
   Display layers decide how to show an invalid value; they never "convert" it.
5. **`createdTime` and `lastModifiedTime` are row metadata, not cells.** Each row carries its own
   `createdAt`/`updatedAt` instants (step 5), so two rows never share a timestamp and the database
   file's own mtime is never reused as a row's. If a document's
   `cells` contains an entry for one of these field ids, it is preserved as an invalid-value
   passthrough with a warning — never parsed as authoritative, never dropped.
6. **Attachments are ordered vault-relative paths, never bytes.** A path that does not resolve is a
   warning (`unresolved-attachment`) with the path kept; the core does not stat the vault — R2
   supplies resolution.

## Rejected alternatives

- **Write `null` explicitly for empty cells.** Doubles the file size, and makes "absent" vs "null"
  meaningful in a format where nothing needs them to differ; omission is the house style from the
  frontmatter era and translates cleanly.
- **Coerce mismatched types** (`"5"` → `5`, `1` → `true`). Silent conversions are how round-trips
  stop being round-trips; an invalid passthrough plus a warning is honest and reversible.
- **Drop unknown optionIds on load.** Deletes user data on a hunch (the option may be restored by a
  sync or a hand edit); keeping the id keeps the promise that R1 never loses values.
- **Treat `""` as no-value.** Matches some importers' leniency, and loses the distinction between
  "cleared" and "deliberately empty" that CSV round-trips can preserve.
- **Store dates as epoch numbers.** Loses the calendar/zone distinction and the file's legibility.

## Consequences

- Every field type module already in `src/core/fieldTypes` maps onto this matrix; R1 adds the
  document-level codec around them rather than re-implementing per-type parsing.
- Warnings are typed findings (`code`, `path`-in-document, `message`), because R1 step 9's corrupt
  fixtures assert *which* finding fired, and R4 will surface them in a repair panel.
- A select cell naming an option its field does not declare is reported as an `unknown-option`
  finding and kept (R1 step 6b): the rejected alternative stays rejected, and the deletion becomes
  visible instead of silent.
- No `Date` object appears in the canonical model: dates and datetimes are strings end to end.
