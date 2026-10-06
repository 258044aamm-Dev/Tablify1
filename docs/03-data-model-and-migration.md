# 03 — Native data model, Airtable link metadata, and compatibility

> **Status:** target contract for the `.tablify` refactor. It is not the current `0.1.0` storage behavior. The current code is Bases/note-backed; no `.tablify` database-file reader or writer exists yet. Freeze the exact v1 schema in R1 before implementation.

## 1. Native file and identity

One `.tablify` file is one logical database containing multiple tables. A JSON shape proposal (illustrative, not a released schema):

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

| Entity | Stable identifier | Rename/move rule |
|---|---|---|
| Database | `databaseId` | File rename/move does not change identity. |
| Table | `tableId` | Table name is a label; relations reference the ID. |
| Field | `fieldId` | Field name/order can change without rewriting cell identity. |
| Row | `rowId` | Row label and position are not identity. |
| View | `viewId` | View name is a label; query refers to field IDs. |
| Select option | `optionId` | Label/color changes do not rewrite cell values. |

The file path is a host-level location, not a record ID. The core must not use `filePath` for stable row identity or sort tie-breaks.

## 2. Database, table, field, row, and view contract

- `format` is a discriminator; `version` is the document schema version, independent of plugin version.
- Table order, field order, option order, row order, and view order must be explicit if user-visible. JSON object-key order is not a product contract.
- Fields contain `id`, `name`, `type`, and validated type-specific settings. Stable field IDs persist through rename/reorder.
- Rows contain `id`, a field-ID-keyed cell map, and record-level timestamps if the product exposes created/modified time. Store or derive row metadata deliberately; do not repeat the database file’s `ctime`/`mtime` as row values.
- Views are table-scoped and contain saved filters/search, sort/group configuration, hidden columns, column order/width, row density, and other supported grid presentation.
- Plugin-wide preferences (theme-following, motion, default row height, diagnostics) remain in Obsidian plugin settings. Active table/view selection belongs to workspace state where possible and should not cause a database write on focus.

## 3. Cell-value mapping proposal

The current field registry has scalar types and time fields. The new JSON contract should retain their useful semantics while replacing YAML serialization. Exact `null`/omission rules are an R1 ADR.

| Field | Suggested stored value | Notes |
|---|---|---|
| `text`, `longText`, `url`, `email`, `phone` | JSON string | Preserve exact content; long text may contain newlines. |
| `number`, `rating`, `currency`, `percent`, `duration` | finite JSON number | Keep current conventions: `25` = 25%; duration is seconds. Currency symbol/precision are field settings. |
| `checkbox` | boolean | `false` is a value, not absence. |
| `date` | `YYYY-MM-DD` | Date-only; no timezone shift. |
| `datetime` | ISO-8601 string | Define normalization and display timezone separately. |
| `singleSelect` | `optionId` | Labels/colors/order live in field metadata. |
| `multiSelect` | ordered `optionId[]` | Validate/deduplicate according to the field contract. |
| `attachment` | ordered vault-relative path list | References only; no embedded bytes. Missing files remain visible as missing. |
| `link` | ordered target `rowId[]` | Field metadata identifies `targetTableId`; cardinality/inverse behavior is an ADR. |
| `createdTime`, `lastModifiedTime` | read-only row metadata values | Not derived from the whole database file’s Obsidian timestamps. |

Define semantics for absent cell key, `null`, empty string, empty arrays, `false`, and `0` for each type. A parser must not conflate these unless the descriptor explicitly defines them as equivalent. Unknown field types and unknown supported-version keys must not be silently dropped.

## 4. Linked-record integrity

A link field points to one target table. Its values are stable record IDs from that table; display labels are resolved at render time and never persisted as the relation key.

Before implementation, decide and record:

- whether the relation is single-value, multi-value, or supports both through one representation;
- whether inverse relations are explicit or generated;
- relation value ordering;
- what happens when a target record is deleted;
- whether a table with inbound links may be deleted;
- how to load/detect broken links from hand-edited or partially synced documents.

Recommended safety posture (proposal, not yet user-confirmed): never cascade-delete records silently; a row deletion clears inbound links in the same undoable transaction; table deletion is blocked until inbound references are resolved; parse preserves broken reference data for user repair.

## 5. Views and record order

A table can have multiple saved views. Query/view state belongs in the `.tablify` document, not in a `.base` config or plugin `data.json`. Each view refers to stable field IDs and should include only state that is meaningful for that table.

The native database must define authoritative row order because Bases currently supplies an already-sorted row sequence. Persist manual ordering explicitly and define how it interacts with filters, sorts, groups, and row drag. Stable final sort tie-breaks use row ID/order, never file path.

## 6. Attachments

- Store vault-relative paths only; do not embed images or files in JSON.
- Normalize separators/Unicode consistently and preserve paths with spaces and special characters.
- A missing attachment is an unresolved reference, not permission to remove the cell value.
- Moving the database file does not rewrite attachment paths. Cross-vault portability is not guaranteed when referenced assets are absent.
- UI may open/preview a path using the Obsidian host, but the core model stores plain strings and imports no Obsidian API.

## 7. Internal `.tablify` schema upgrades

The only automatic migrations in scope are pure upgrades between versions of the native `.tablify` schema.

- Each `vN → vN+1` migration is deterministic, tested against a committed fixture, and returns a new document plus warnings.
- Migration failure leaves original file content intact and gives a recovery route; never replace it with an empty database.
- Newer unsupported document versions are read-only or refused clearly; an older build never writes them back.
- Preserve unknown keys within a supported format version unless an ADR specifies safe handling.

## 8. Explicitly unsupported old-data migration

The refactor does **not** convert:

- Obsidian `.base` files or Bases view configuration;
- Markdown note/frontmatter rows;
- legacy `.tabula` v1/v2 tables;
- Base-keyed Airtable link state from `<vault>/.tablify/links/`.

No old data is deleted or rewritten by the new plugin. Existing files can remain in the vault, but the refactored plugin does not promise to open, edit, or migrate them. Because the old release is a prerelease for personal/testing use, the default is fresh setup in a `.tablify` database, not a converter. Any later request for data conversion requires an explicit scope decision and a separate reviewed plan.

## 9. Airtable link metadata is not the database

The current vault-root `<vault>/.tablify/` directory is an app-owned namespace for sync metadata; it is not an implemented `.tablify` database format. Keep these concepts distinct:

- **`.tablify` extension:** a JSON database file opened by a custom file view.
- **`.tablify/links/` directory:** optional per-table Airtable link metadata, if retained.

Recommended future link state is keyed by stable local `databaseId + tableId`, with `fieldId → remoteFieldId`, `rowId → remoteRecordId`, per-field agreed snapshot hashes, remote Airtable base/table identity, and last successful pull/push stamps. The Airtable token remains only in Obsidian `SecretStorage`.

Do not automatically reinterpret old link files keyed by `.base` path + view name. Recommended default: leave old link metadata untouched and create a fresh Airtable link for each new local table. Ask before implementing any sidecar conversion.

## 10. Data operations and import boundary

CSV/TSV/XLSX and clipboard matrices are interchange inputs/outputs, not native data formats. Import preview chooses create table, append records, or replace after confirmation. It creates database records, never Markdown notes. Export states selected range/current view/full table. Formula-shaped text is literal and never evaluated. Import and export must use stable field order and explicit link/attachment conversion rules.

## 11. Review checklist for R1/R2

- [ ] Schema IDs/value/empty semantics are in an ADR and match the example fixture.
- [ ] Multiple tables, views, links, field options, row order, and attachments survive parse/serialize/parse.
- [ ] Invalid/future documents cannot be silently overwritten.
- [ ] No `.base` or `.tabula` migration code appears in the new parser.
- [ ] `.tablify` filename and `.tablify/links/` metadata directory are described separately.
- [ ] All file write guarantees are verified against pinned Obsidian APIs and a real test vault before claimed.
