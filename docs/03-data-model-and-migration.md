# 03 — Data model, sync state and migration

## Row identity

**A row is a file.** `RowId` is the file path (`Projects/Rows/Alpha.md`).

- Renames: `vault.on("rename")` re-keys the sync record map. Obsidian keeps links valid; we must keep the Airtable linkage valid too.
- Deletes: a deleted file removes its row. Sync never deletes remote records from a local delete without explicit confirmation.
- Duplicate files with the same visible name are fine — identity is the path, not the name.

## Property model

## Column mapping (verified against the official Bases syntax docs)

The column set comes from the Bases view, not from the plugin:

| Concept | Source |
|---|---|
| Visible columns + order | `config.getOrder()` → `BasesPropertyId[]` (e.g. `["file.name", "note.Status"]`) |
| Sort | `config.getSort()` → `BasesSortConfig[]`; `data` arrives presorted |
| Grouping | `BasesQueryResult.groupedData` |
| Global + per-view filters | `.base` file `filters:` and `views[].filters:` (strings, or `{and|or|not: […]}` objects) |
| Formulas | `.base` `formulas:`; read via `entry.getValue("formula.…")` |

The plugin contributes only what Bases does not have: per-field presentation metadata (`fieldOptions`), grid view options, and the row-level operations.

| Concept | Where it lives |
|---|---|
| Which properties are columns, and their order | `.base` view config (`config.getOrder()` and friends) — travels with the base |
| Property name (frontmatter key) | The note's frontmatter |
| Field type + per-field options (select colours, rating max, currency symbol) | `.base` view config, single `fieldOptions` entry (below) |
| Read-only status | Derived: `file.*`, formula properties, unmapped keys |
| Sync linkage | `.tablify/links/*.json` (machine state, not secret) |
| Airtable token | `SecretStorage` — never in a vault file, never in `data.json` |

### `fieldOptions` shape

Keyed by **prefixed Bases property id** (`note.<Name>`, `file.<name>`, `formula.<name>`) — bare property names are ambiguous between sources, which is exactly what `BasesPropertyId` exists to prevent. Stored as one serialized string via `config.set("fieldOptions", …)` so it travels with the `.base` file and survives vault sync:

```json
{
  "version": 1,
  "fields": {
    "note.Status":     { "type": "singleSelect", "options": [ { "id": "o1", "name": "Todo", "color": "gray" } ] },
    "note.Tags":       { "type": "multiSelect",  "options": [ { "id": "o2", "name": "urgent", "color": "red" } ] },
    "note.Effort":     { "type": "duration",     "unit": "seconds" },
    "note.Budget":     { "type": "currency",     "symbol": "$", "precision": 2 },
    "note.Confidence": { "type": "rating",       "max": 5 },
    "note.Notes":      { "type": "longText" }
  }
}
```

- Unknown or missing entries fall back to `core/fieldTypes` defaults keyed off the YAML value shape — the plugin must never hard-fail on a hand-edited base.
- Option **identity is the label**, not an id, because the frontmatter stores labels. Renaming an option is a bulk property rewrite with a preview (and a sync implication).

## Field type → frontmatter mapping

The governing rule: **frontmatter must stay human-readable and hand-editable.** Canonical values are chosen so that opening a note in a text editor shows something a person would have typed.

| Type | Stored in frontmatter | Notes |
|---|---|---|
| `text` | `string` | |
| `longText` | `string` | Multi-line values use YAML block scalars |
| `number` | `number` | |
| `checkbox` | `boolean` | |
| `date` | `"YYYY-MM-DD"` string | Maps to Obsidian's Date property type |
| `datetime` | ISO 8601 string; include the UTC offset when a time is present | Rendered in local time |
| `url` | `string` | Maps to Obsidian's URL property type |
| `email`, `phone` | `string` | No format coercion on write; validate on edit only |
| `singleSelect` | `string` (the option **label**) | Colours/order live in `fieldOptions` |
| `multiSelect` | `string[]` of labels | Chosen over tags: keeps a property, not the tag namespace |
| `rating` | `number` | `max` in `fieldOptions` |
| `currency` | `number` | Symbol/precision render-only |
| `percent` | `number`, where 25 means 25% | Human-first. Airtable stores 0.25; we deliberately diverge and document it |
| `duration` | `number` seconds, rendered `h:mm:ss` | Alternative (ISO 8601 durations) rejected for readability |
| `attachment` | `string` path, or `"[[link]]"` when inside the vault, or `string[]` | Links render clickable in Obsidian; external paths stay plain strings |
| `autoNumber` | **dropped** | Meaningless with file-backed rows. Replaced by a derived "Row number" column from view order. Reported during migration |
| `createdTime` | **not stored** — read from `file.ctime` | Bases/file metadata already provides it |
| `lastModifiedTime` | **not stored** — read from `file.mtime` | Same |

Read-only cells (`file.*`, formulas, unmapped keys) render disabled with a tooltip explaining why.

## Frontmatter write rules

1. **`fileManager.processFrontMatter()` only.** Never `vault.modify()` for a property change; another pane may be editing the same note.
2. **Preserve everything unknown.** The writer mutates only the keys it owns.
3. **Clearing deletes the key** rather than writing `""`/`null` — keeps notes clean. (Accepted cost: "explicitly empty" is indistinguishable from "absent".)
4. **Property names are taken from field names**, trimmed, with internal whitespace collapsed. Collisions are resolved by suffixing ` 2`, ` 3`, … and reported.
5. **Reserved/meaningful names warn.** `tags`, `aliases`, `cssclasses` have special Obsidian meaning; using them as grid columns is allowed but the importer warns.
6. **No objects in frontmatter.** If a field type would need a nested object, the mapping is wrong — extend `fieldOptions` instead.

## Row creation (paste and import)

```
folder:   <setting: default row folder>  (default: "<base name> Rows")
filename: <setting: template>            (default: "{{Name}}" → falls back to "Row {{n}}")
frontmatter: only properties with non-default values are written
collisions: append " 2", " 3", … and report the count
optional:   tag new rows (setting, default off) — the .base view's own filter defines
            membership, so no marker property is written by default
```

A marker property is deliberately **not** written: the view's filter (typically `file.inFolder(...)`) defines membership. This keeps notes clean and avoids the plugin claiming ownership of notes the user also edits by hand.

## Sync state

`<vault>/.tablify/links/<key>.json`, where `<key>` is a stable hash of the `.base` path plus the view name. Dot-folders are not indexed by Obsidian, so this never pollutes search or the file explorer.

```json
{
  "version": 1,
  "basePath": "Projects/Projects.base",
  "viewName": "Tasks",
  "airtable": { "baseId": "appXXXX", "baseName": "Work", "tableId": "tblYYYY", "tableName": "Tasks" },
  "recordMap": { "Projects/Rows/Alpha.md": "recZZZ" },
  "fieldMap": { "Status": "fldAAA", "Owner": "fldBBB" },
  "snapshot": { "recZZZ": { "Status": "sha256:…", "Owner": "sha256:…" } },
  "lastPulledAt": "2026-10-05T10:00:00.000Z",
  "lastPushedAt": "2026-10-05T09:12:04.000Z"
}
```

- `snapshot` holds a hash of the **last agreed value per field per record**. That is what makes per-field three-way diffs possible without storing full history: `local ≠ snapshot` means the vault changed; `remote ≠ snapshot` means Airtable changed; both ⇒ a real conflict.
- Deleting this folder is safe: it only loses sync linkage, and the plugin tells the user that before doing anything destructive.
- Migration reports also live under `.tablify/migrations/`.

## Sync behaviour

| Situation | Behaviour |
|---|---|
| Only local changed | Pushed on the next push |
| Only remote changed | Offered on the next pull |
| Both changed, different fields | Merged per field automatically — **no** conflict promoted |
| Both changed, same field | Conflict: value shown side by side; user chooses per field |
| Remote record missing (deleted in Airtable) | Reported, never auto-deleted locally |
| Local note missing (deleted in vault) | Reported; remote record untouched |
| Field with no Airtable counterpart | Skipped, reported once per sync |
| Airtable schema changed | Reported; the mapping is never auto-rewritten; Airtable schema is never modified |

## Legacy `.tabula` format (frozen)

Two shapes exist in the wild; the adapter reads both and **writes neither**.

```jsonc
// v1 — a single table (bare document)
{ "version": 1, "name": "Tasks", "fields": [...], "rows": [...], "view": {...}, "autoNumberNext": 3, "sync": {...} }

// v2 — the multi-table envelope, written by the fork only when a file has ≥ 2 tables
{ "version": 2, "tables": [ { "id": "t_…", "table": { /* v1 document */ } } ] }
```

- Rows: `{ id, cells: { [fieldId]: CellValue } }`; select cells store **option ids**, not labels.
- Fields: the 19-type union with `singleSelect`/`multiSelect` carrying `{ id, name, color }` options.
- Sync: `{ baseId, tableId, baseName, tableName, fieldMap, recordMap, lastPulledAt, lastPushedAt }`.

The legacy view is read-only in the grid, shows a "migrate" banner, and never gains features. The format is documented here so the importer is exact, and then it is closed.

## Migration: `.tabula` → notes + `.base`

Triggered by a command and by the legacy view's banner. Always a dry run first.

**Algorithm**

1. Parse (v1 or v2). For each table, resolve field names → property names per the rules above; report collisions and renames.
2. Compute the target set: one folder per table (`<base name>/<table name>/`), one note per row (`{{primary field value}}`, deduped), one `.base` file per source file with one view per table.
3. **Dry-run report** (the dialog): rows → notes, properties created, dropped field types, untranslatable filter conditions, name collisions, target folder, filename sample. Nothing is written until confirmed.
4. On confirm: create notes (progress UI, cancellable mid-run), write frontmatter with `fieldOptions` for selects/rating/currency, then write the `.base`.
5. **Write the mapping file** `.tablify/migrations/<timestamp>.json`: `rowId → notePath`, `fieldId → property name`, plus any pre-existing `recordMap`. The first sync after migration seeds `recordMap` from this, so **Airtable linkage survives the migration**.
6. If "keep original" is off, the `.tabula` file is moved to a `_tabula-archive/` folder rather than deleted.
7. Rollback instructions are printed and stored in the mapping file (the report lists every file created, so "undo" is a known, finite list).

**View settings translation**

| Old | New |
|---|---|
| `frozenPrimary`, `rowHeight`, `columnWidths`, hidden fields, column order | Native Bases view config / plugin view options |
| `sorts` | Bases sort config |
| `filters` (flat and/or) | Bases filter syntax for simple comparisons; nested/multi-value conditions are reported as untranslatable rather than silently dropped |
| `query` (string DSL) | Folded into the same filter translation; leftovers reported |
| `search` | Dropped (user-visible notice: search is a per-session action in Bases) |
| `groupBy` | Bases grouping |
| `autoNumberNext` | Discarded with the field |

> ⚠️ **Verified (official Bases syntax docs + `BasesConfigFile` type):** the `.base` schema is `filters`, `formulas`, `properties` (`<id>.displayName`), `summaries`, `views[]` where each view is `{ type, name, filters?, groupBy?, order?: string[], summaries? }`. `order` holds prefixed property ids; `groupBy` is `{ property, direction }`; filter statements are strings (`'status != "done"'`) or `{and|or|not: […]}` objects.
>
> **Generate the file from the `BasesConfigFile` TypeScript type**, not from string templates — then the compiler validates the shape. A generated base must round-trip through Obsidian without warnings: add a harness case with a golden `.base` fixture.

## Import (into the current Bases view)

Same machinery, no `.tabula` involved: matrix → property inference → preview dialog (row count, filename template, folders, properties) → note creation → single undo step that removes the created notes.
