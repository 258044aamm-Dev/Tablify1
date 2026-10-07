# R1 — Native JSON schema and pure core

**Mode:** implementation guide. Authorized for implementation 2026-10-07 (see [`08-decisions.md`](08-decisions.md) §Implementation authorization log): steps commit and push one at a time on `refactor/native-tablify`. **Status:** complete — steps 1–9 landed ✅ (each gated and pushed on `refactor/native-tablify`); implementation state is always the source at HEAD. **Dependencies:** R0 docs closed; the blocking decisions are resolved in [`docs/adr/`](adr/README.md) (0001 links, 0003 row order, 0004 values).

## Objective

Freeze a small, explicit version-1 `.tablify` JSON contract and pure parser/serializer before adding file I/O or a custom Obsidian view. R1 is complete only when independent code can validate a database document without Obsidian, React, DOM, filesystem access, or network access.

## Scope

### In scope

- One `.tablify` document envelope with `format`, `version`, stable `databaseId`, human-readable database name, tables, table fields/records/views, and native values.
- Stable identities for databases, tables, fields, records, views, and select options.
- Typed field definitions, linked-record values, attachment references, saved-view schema, parser/validator/serializer, internal format migrations, and fixture tests.
- Record metadata needed for record-level created/modified-time fields.

### Explicitly out of scope

- Obsidian `TFile` APIs, file registration, writes, UI, import/export orchestration, Airtable, formulas, lookups, rollups, `.base` conversion, `.tabula` conversion, or preserving a legacy mode.

## Step-by-step design sequence

### Step 1 — Freeze the envelope ✅ landed

The example is a shape sketch, not a released schema. Resolve all field names and required/optional rules in the schema ADR before publishing a fixture.

```json
{
  "format": "tablify",
  "version": 1,
  "databaseId": "db_…",
  "name": "Project tracker",
  "tables": [
    {
      "id": "tbl_…",
      "name": "Tasks",
      "fields": [],
      "rows": [],
      "views": []
    }
  ]
}
```

Specify:

- `format` is a literal discriminator, so a random JSON file is not mistaken for a database.
- `version` is the document schema version, not the plugin version.
- `databaseId` stays stable when the file is renamed or moved within the vault; a path is not identity.
- Order is represented explicitly where it matters (table order, field order, record order, option order, saved-view order). Do not infer persistent order from object-key ordering.
- Unknown keys at a supported version are preserved by the round trip unless a data-integrity reason requires refusal. Unsupported future versions open read-only in the host phase and are never rewritten.

### Step 2 — Define stable IDs and references ✅ landed

- Database ID identifies one logical database document.
- Table ID identifies a table independently from its display name.
- Field ID identifies a column independently from its name/order.
- Record ID identifies a row independently from its display value.
- View ID identifies one saved query/presentation independently from its name.
- Select option ID identifies a choice independently from its label/color.
- A link field references exactly one target table. Cell values reference IDs in that table, not labels or row indexes.
- ID generation belongs at an injected boundary; pure core tests use deterministic IDs. Do not call a platform random API from reducers or parsers.

### Step 3 — Define JSON value rules ✅ landed

Use JSON-safe canonical cell values. A field type interprets its value; the serialized representation must not require YAML rules.

| Field | Suggested canonical representation | Notes |
|---|---|---|
| text / longText / URL / email / phone | string or absent/null according to the null ADR | Preserve newline and exact text. |
| number / rating / currency / percent / duration | finite JSON number or absent/null | Preserve current conventions: percent `25` means 25%; duration is seconds. Currency formatting/options are field metadata. |
| checkbox | boolean or absent/null | `false` is not the same as absent. |
| date | ISO `YYYY-MM-DD` string | Validate calendar date; do not timezone-shift date-only values. |
| datetime | ISO 8601 instant with offset/UTC normalization policy | Keep display timezone separate from stored instant. |
| singleSelect | stable option ID | Option metadata holds label/color/order. |
| multiSelect | ordered array of option IDs | Deduplicate and validate against field options; define behavior for temporarily unknown IDs. |
| attachment | ordered array of vault-relative path strings | Never embed bytes; paths are references and may be missing. |
| link | ordered array of target row IDs | Target table ID is field metadata; cardinality/inverse behavior is an ADR. |
| createdTime / lastModifiedTime | row metadata, surfaced as read-only computed fields | Do not reuse the database file’s own timestamps for every row. |

Define empty semantics for each descriptor: omitted cell key, `null`, empty string, empty option/link list, `false`, and `0` must not collapse into one value unless that field explicitly defines them as equivalent.

### Step 4 — Define fields and options ✅ landed

A field definition should contain only serializable schema: `id`, `name`, `type`, type-specific options, and any relation target. Use a discriminated union (or a validated extensible shape) that makes invalid combinations rejectable.

- Move per-field settings currently stored in `.base` config into the field definition: option list/colors, rating maximum, currency symbol/precision, duration unit, link target, etc.
- For select fields, labels/colors are metadata and IDs are cell identity. Renaming an option should not rewrite every row cell.
- Preserve current field rendering/clipboard semantics through the core descriptor registry, but replace `toYaml` with JSON encode/decode or a narrower codec only where a type truly needs one.
- Unknown field type: parser returns a structured unsupported-field result; do not drop its data or rewrite it as text.

### Step 5 — Define rows, timestamps, order, and saved views ✅ landed

- Rows have stable `id`, a `cells` map keyed by `fieldId`, and explicit metadata only if needed (for example `createdAt` and `updatedAt`).
- Choose an explicit record-order representation. Do not rely on an array’s incidental re-sort after filtering. The ADR must define how manual reorder interacts with sorted/grouped views.
- A table has one or more saved views. Each view includes its ID/name, filters/search, sorts, grouping, hidden fields, field order/widths, density, and frozen-primary presentation as supported.
- Saved-view queries must use the existing core AST; the parser must validate field IDs against the table schema without importing the UI.
- Keep view state distinct from global plugin preferences (theme/motion defaults). Opening a view or focusing a pane should not create writes.

### Step 6 — Define linked-record invariants ✅ landed

Before coding relation helpers, resolve:

1. whether every relation is many-valued or whether a single-link cardinality is needed;
2. whether inverse fields are explicit or auto-created;
3. whether values preserve user order or sort by target-table order;
4. row deletion behavior for inbound links;
5. table deletion when other tables reference it;
6. behavior when a reference points to a missing row in a hand-edited or partially synced document.

Recommended initial safety posture: validate target table and row IDs; never silently cascade-delete records; make any inbound-link cleanup one undoable transaction; refuse to save a corrupted reference graph without a visible error/report.

**Step 6b — the option sibling.** The six questions above are all about links; the other dangling-id
case is a select cell naming an option the field does not declare. The value layer keeps it
(ADR-0004 §2: "an optionId string, even unknown") and cannot judge membership, because the option
list belongs to the field — so the judgment lives beside the link scan, with the same manners:
`validateOptions` reports `unknown-option` for each stray id, naming the field, the id and the exact
cell (or list position), as a warning, with the value untouched, and the parser attaches it after
the link findings. Deleting an option never rewrites the cells that named it, and never hides them
either. A value that is not an option id at all is the value layer's `invalid-cell-value`; the scan
stays silent about it, because the file already says a clearer thing.

### Step 7 — Specify parser/validator/serializer result types ✅ landed

Separate successful load, warnings, and fatal errors. Avoid throwing on ordinary bad input.

```ts
type DocumentLoad =
  | { readonly ok: true; readonly document: DatabaseDocument; readonly warnings: readonly LoadWarning[] }
  | { readonly ok: false; readonly errors: readonly LoadError[]; readonly rawTextPreserved: true };
```

Required validation includes JSON syntax, format tag, version support, duplicate/empty IDs, duplicate field IDs/names policy, invalid field options, non-finite numbers, broken relation targets, wrong-table row references, missing saved-view fields, and unknown field types. Error results must retain the original bytes/text outside the pure parser so a future host can offer repair/export without overwriting.

### Step 8 — Internal schema versioning ✅ landed

- `parseAndMigrate` applies deterministic pure migrations `vN → vN+1` for `.tablify` only.
- A migration returns a new document plus warnings; it never mutates input.
- An unsupported newer version is not “migrated down.” The plugin opens read-only or refuses with a clear version message.
- There is no importer from `.base`, Markdown frontmatter, or `.tabula` in the format migrator.
- Do not implement sync-link metadata migration in R1.

### Step 9 — Build a fixture matrix ✅ landed

At minimum, create fixtures for: smallest empty database; multiple tables; multiple views; each current field type; every empty-value edge; linked rows in same and different tables; duplicate IDs; unknown field type; unknown v1 key; future version; malformed/truncated JSON; dangling table/row/option; attachment paths with spaces, Unicode, and missing targets; large database fixture generated reproducibly.

## Code boundaries for this phase

- `src/core/database/**`: JSON types, schema validation, identity, migrations, relation rules.
- `src/core/fieldTypes/**`: field-specific parse/format/query/edit behavior, with JSON-native serialization.
- `src/core/query/**`, `src/core/ops/**`, `src/core/view/**`: pure query/operation semantics.
- `src/adapters/**`: no parser assumptions from the Obsidian UI; file I/O belongs to R2.

Do not create both a `DatabaseState` and an almost-identical `TableState` without documenting ownership and synchronization. R3 must specify one source of truth and the active-table projection.

## R1 test matrix and exit criteria

All six hold at HEAD, each with a place that fails if it stops holding:

- **Round trips** — `tests/unit/core-fixture-matrix.test.ts` asserts, per fixture, parse → serialize →
  parse is model-identical and serializing twice is byte-identical; `core-envelope.test.ts` proves the
  same over 200 generated documents; IDs, unknown v1 keys, views and attachment paths are asserted by
  name in the matrix's per-fixture cases.
- **Property-based tests** — `core-links.property.test.ts` (150 seeded relation graphs: determinism,
  every injected break reported and still written, parser findings ≡ the scans, with a counted
  case-mix so the generator cannot go quiet), `core-migrations.test.ts` (100 generated documents,
  same text in ⇒ same outcome out), plus the seeded generators in `core-envelope.test.ts` (round
  trip) and `core-ids.test.ts` / `core-values.test.ts` (uniqueness, codecs).
- **Nothing corrupt becomes empty** — `core-result-types.test.ts` (20 hostile inputs, every one
  refused with `rawTextPreserved`) and the `truncated` / `future-version` / `duplicate-*` matrix rows.
- **Diff-stable serialization** — key order asserted where it is promised (`core-envelope.test.ts`);
  two-space JSON and a trailing newline everywhere.
- **Purity** — `tests/unit/boundaries.test.ts` keeps `src/core/**` free of Obsidian, React, DOM,
  network, filesystem and clock imports; R1 added none.
- **Decisions recorded** — `docs/adr/` 0001–0010, plus the option-membership call in step 6b above.
