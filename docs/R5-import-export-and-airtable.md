# R5 — Spreadsheet interchange and Airtable sync

**Mode:** active implementation guide under the authorized R1–R5 scope; proceed one gated step at a time. **Dependencies:** stable R1 schema, R2 repository, R3 IDs/ops, and R4 field/table UI.

**Status (2026-10-08):** Part A Step 1's source-only preview boundary has a verified implementation checkpoint. R5 is not complete: Part A Steps 2–4 and Parts B–C remain open. R6, release metadata, and version tags remain untouched. Native Obsidian-host and physical-device checks remain **NOT RUN**.

## Objective

Retain CSV/TSV/XLSX import/export and manual Airtable sync while redirecting all local operations to native tables and stable IDs. Do not reintroduce note creation or a `.tabula` path.

## Part A — CSV/TSV/XLSX import

### Step 1 — Keep the pure readers and preview logic

Reuse matrix readers, header handling, type inference, per-column overrides, clipboard parsing, collision reporting where it applies, and progress reporting. Remove plan inputs about note folders, filename templates, frontmatter keys, and vault file collisions.

**VERIFIED implementation checkpoint (2026-10-08):** `src/core/database/import/preview.ts` is a source-only native-table preview boundary over the existing pure `readSource`/`inferColumns` functions. It retains the matrix, exact header-adjusted dimensions, inference evidence, per-column type overrides, and excluded-column choices; it has no target table, database-write plan, folder/template/frontmatter, note path, or vault-file-collision inputs. CSV/TSV/HTML/clipboard text still use the existing readers; an already-parsed worksheet can enter as a matrix, so the native path does not need a second classifier. Tests cover this boundary alongside the unchanged note importer.

**VERIFIED gates:** `npx bun run check` passed, including 88 test files / 1,971 tests and the repository's type, lint, brand, manifest, format, build, contrast, CSS, and bundle-size checks. The targeted preview + legacy-import suites passed 40/40. The existing Playwright layout harness passed 115/115; it still exercises the pre-existing grid, not the native FileView or a native importer UI.

**OPEN:** although `read-excel-file` is already a dependency, no production XLSX import adapter, workbook reader, or worksheet chooser exists yet; this checkpoint accepts a parsed matrix but does not claim user-visible XLSX import. Destination-specific collision reporting and native apply progress belong to the later destination/plan/apply steps. The existing note import wizard and its folder/template/frontmatter/vault-collision/progress behavior remain unchanged until the authorized removal phase, so this isolated native path does not regress that workflow. Real Obsidian-host and physical-device checks remain **NOT RUN**.

### Step 2 — Define destinations

The new wizard offers:

1. **Create table** in the current database.
2. **Append records** to a selected existing table, matching columns by stable field ID only when an explicit import mapping exists; otherwise preview name matches and require confirmation.
3. **Replace table contents/schema** only after an explicit destructive preview and confirmation. Before implementation, decide whether unmatched existing fields are retained or removed.

The source file remains an external import input; it is never renamed to `.tablify` or treated as a database without parsing/confirmation.

### Step 3 — Build an exact import plan

The pure plan contains selected table, included columns, field types/options, row count, cell conversions, skipped/rejected values, duplicate decisions, and estimated document size/work. Preview text comes from that plan, and the runner consumes the same plan. No folder, `.md` filename, note count, `.tabula` alternative, or migration report appears.

- Infer column types using the existing evidence-based classifier; allow per-column overrides.
- Stable field/row/option IDs are generated through an injected ID factory.
- Linked-record imports require a deterministic target mapping; do not guess from labels or silently import link text as a relationship.
- Warn based on measured size/performance policy rather than “large import ⇒ keep `.tabula`.”
- Cancellation reports zero committed work, or precisely reports committed chunks if a documented chunked import is approved.

### Step 4 — Apply as one transaction where feasible

Prefer one database command, one undo entry, and one repository write. If a 400×6 or larger import requires chunking for responsiveness, design chunk visibility/undo semantics explicitly and preserve a cancelable progress report. Never leave unreported partial data after cancellation.

## Part B — CSV/TSV/XLSX export

- Add CSV export; it is not delegated to Obsidian Bases in the target product.
- Keep TSV clipboard/file and XLSX workbook export.
- Offer export of selected range, current filtered/sorted/grouped view, or whole table, with exact scope stated in the dialog.
- Use field ID order/presentation order from an explicit export choice; do not depend on JSON object key order.
- Linked-record export needs a documented representation (recommended: display labels for readable spreadsheets, with warning that re-import does not recreate identity without a mapping).
- Attachment export emits path references or display names according to an explicit option; it never embeds the binary asset.
- Spreadsheet formula injection safety remains: formula-shaped local text must export as literal text; reader never evaluates formulas.

## Part C — Airtable sync

### Step 1 — Preserve safety semantics

Keep manual pull, manual push, dry-run counts, per-field three-way diff, explicit conflict review, stale-check protection, partial-read blocking, read-only Airtable schema, safe typed errors/retry, no remote deletes, no secret leakage, and no live calls in CI. No background polling or automatic sync is introduced.

### Step 2 — Change local identity

Recommended link identity: one local `databaseId + tableId` maps to one Airtable base/table. A saved view is not the sync identity. Link metadata continues under `<vault>/.tablify/links/` as a separate optional sidecar; distinguish this directory from `.tablify` database files.

Proposed link state maps:

- `fieldId → remoteFieldId`;
- `rowId → remoteRecordId`;
- agreed snapshot hashes by remote record and remote field ID;
- remote Airtable base/table identifiers/names;
- last successful pull/push stamps and format version.

Token stays in `SecretStorage`, never in the database file, link state, settings file, logs, or export.

### Step 3 — Decide old-link metadata separately

The current link state is keyed by `.base` path and view name; it does not become compatible merely by renaming its key. Default plan: **do not migrate existing Bases-keyed link JSON**; leave it untouched and let the user establish fresh links for `.tablify` tables. If the user wants old link snapshots/mappings migrated, add a separate explicitly approved converter with dry-run/back-up tests; do not assume.

### Step 4 — Adapt the provider-agnostic engine

Change `SyncLocalPort` path/property vocabulary to row/field IDs and a table-scoped port. Keep the provider `SyncTarget` abstraction. Use remote Airtable names only for user-facing mapping suggestions; persist remote IDs. A row with no existing remote mapping remains skipped/reported; this plan does not add remote record creation or deletion.

### Step 5 — Handle linked-record sync conservatively

A local link value is a set/list of local row IDs. Convert it to Airtable record IDs only when the target table has a matching, valid mapping for every referenced row and the remote field type is supported. Pull follows the inverse mapping. If any relation target is missing, unmapped, deleted, or ambiguous, show the row/field in the plan and block or skip according to a documented rule before any write. Never turn an unresolved link into text or an empty remote list.

### Step 6 — Keep secrets and network isolated

- Sync remains behind the existing explicit command/action and lazy module boundary where it is still useful.
- All network calls use Obsidian’s supported request transport; verify current API types at the pinned version.
- Use fake transports in tests. Assert authorization tokens do not appear in error, logs, sidecar, plugin settings, or exported files.
- Keep rate-limit/backoff and Airtable page caps; incomplete reads cannot authorize push.

## R5 test matrix and exit criteria

- Import CSV/TSV/XLSX: headers/no headers, typed overrides, empties, duplicate values, malformed values, 400×6 undo, cancellation, size warning, create/append/replace.
- Export: CSV escaping/line endings, TSV/HTML clipboard fidelity, XLSX file opens/round-trips, selected range/view/table scope, literal formula-shaped text.
- Sync: mapped row/field, local-only and remote-only field changes, same-field conflicts, stale local edits during review, remote deletion, local deletion, partial/truncated page, type mismatch, rejected push, link-file corruption, redaction.
- Linked sync: complete target mapping, one missing target mapping, deleted target, unsupported Airtable linked-record field, cyclic link graph, and no unintended data write on an unresolved relation.
- Verify no live Airtable network call in test/CI and no token-like string in generated fixtures.
- No `.tabula` choice or old Bases link-state importer appears in UI.
