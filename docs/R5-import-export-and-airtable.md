# R5 — Spreadsheet interchange and Airtable sync

**Mode:** active implementation guide under the authorized R1–R5 scope; proceed one gated step at a time. **Dependencies:** stable R1 schema, R2 repository, R3 IDs/ops, and R4 field/table UI.

**Status (2026-10-08):** Part A Steps 1–3 have verified source-preview, destination-contract, and exact-plan checkpoints. R5 is not complete: Part A Step 4 and Parts B–C remain open. XLSX workbook reading/worksheet selection, native importer UI/apply, R6, release metadata, and version tags remain untouched. Native Obsidian-host and physical-device checks remain **NOT RUN**.

## Objective

Retain CSV/TSV/XLSX import/export and manual Airtable sync while redirecting all local operations to native tables and stable IDs. Do not reintroduce note creation or a `.tabula` path.

## Part A — CSV/TSV/XLSX import

### Step 1 — Keep the pure readers and preview logic

Reuse matrix readers, header handling, type inference, per-column overrides, clipboard parsing, collision reporting where it applies, and progress reporting. Remove plan inputs about note folders, filename templates, frontmatter keys, and vault file collisions.

**VERIFIED implementation checkpoint (2026-10-08):** `src/core/database/import/preview.ts` is a source-only native-table preview boundary over the existing pure `readSource`/`inferColumns` functions. It retains the matrix, exact header-adjusted dimensions, inference evidence, per-column type overrides, and excluded-column choices; it has no target table, database-write plan, folder/template/frontmatter, note path, or vault-file-collision inputs. CSV/TSV/HTML/clipboard text still use the existing readers; an already-parsed worksheet can enter as a matrix, so the native path does not need a second classifier. Tests cover this boundary alongside the unchanged note importer.

**VERIFIED gates:** `npx bun run check` passed, including 88 test files / 1,971 tests and the repository's type, lint, brand, manifest, format, build, contrast, CSS, and bundle-size checks. The targeted preview + legacy-import suites passed 40/40. The existing Playwright layout harness passed 115/115; it still exercises the pre-existing grid, not the native FileView or a native importer UI.

**OPEN:** although `read-excel-file` is already a dependency, no production XLSX import adapter, workbook reader, or worksheet chooser exists yet; this checkpoint accepts a parsed matrix but does not claim user-visible XLSX import. Step 3 now rejects ambiguous native field-name mappings/collisions; native wizard conflict presentation, transactional apply, and progress reporting remain open. The existing note import wizard and its folder/template/frontmatter/vault-collision/progress behavior remain unchanged, so this isolated native path does not regress that workflow. Real Obsidian-host and physical-device checks remain **NOT RUN**.

### Step 2 — Define destinations

The native destination contract has three choices for the future wizard:

1. **Create table** in the current database, with a user-supplied table name.
2. **Append records** to a selected existing table. An explicit mapping targets stable field IDs. Without one, header/name matches are suggestions only and the exact preview requires confirmation before apply.
3. **Replace imported values** in a selected existing table, following [ADR-0007](adr/ADR-0007-import-replace.md): update rows only through a user-mapped key; without a key, append imported rows. Never match by position or reuse a row ID for a different logical row. Fields absent from the import and their values are retained by default; removing absent fields is a separate, explicit, off-by-default choice. Existing rows not identified by the mapped key are retained and listed; import never deletes unmatched rows.

The replace preview enumerates affected fields, type/cell changes, skipped or lossy values, and unmatched rows before an explicit confirmation. Apply must re-plan and refuse a stale plan. The source file remains an external import input; it is never renamed to `.tablify` or treated as a database without parsing/confirmation.

**VERIFIED implementation checkpoint (2026-10-08):** `src/core/database/import/destination.ts` exports a discriminated destination contract for create, append, and replace plus the field-mapping and row-key choices. Name suggestions are distinguished from explicit stable-field-ID mappings, and the helper marks name-based matches as requiring confirmation. Replace defaults preserve import-absent fields, model field removal as an explicit choice, require an explicit stable field ID for key matching, and represent no-key behavior as append. No unmatched-row deletion or positional row matching is represented. This is the pure choice contract consumed by Step 3; it does not include a mounted wizard or apply path.

**VERIFIED gates:** `npx bun run check` passed (89 test files / 1,976 tests and all automated repository gates); targeted destination + preview + legacy-import suites passed 45/45. `npx bun run test:layout` passed 115/115; that harness covers the pre-existing grid only. **NOT RUN:** native importer UI, Obsidian-host, and physical-device verification.

### Step 3 — Build an exact import plan

The pure plan contains selected table, included columns, field types/options, row count, cell conversions, skipped/rejected values, duplicate decisions, and estimated document size/work. Preview text comes from that plan, and the runner consumes the same plan. No folder, `.md` filename, note count, `.tabula` alternative, or migration report appears.

- Infer column types using the existing evidence-based classifier; allow per-column overrides.
- Stable field/row/option IDs are generated through an injected ID factory.
- Linked-record imports require a deterministic target mapping; do not guess from labels or silently import link text as a relationship.
- Warn based on measured size/performance policy rather than “large import ⇒ keep `.tabula`.”
- Cancellation reports zero committed work, or precisely reports committed chunks if a documented chunked import is approved.

**VERIFIED implementation checkpoint (2026-10-08):** `src/core/database/import/plan.ts` exports `buildDatabaseImportPlan` and `describeDatabaseImportPlan` through the native database index. The pure planner creates exact operations for create/append/replace, uses injected IDs and clock, converts through native field descriptors, keeps existing field types, applies preview-selected types to new fields, and carries explicit stable option IDs. It records included/excluded columns, per-row conversions and skipped values, confirmations, duplicate decisions, unmatched retained rows, serialized document bytes before/after, deterministic work units, and threshold-only warnings. Keyed replace refuses duplicate source/target keys; no-key import preserves source duplicates and lists all existing rows retained by replace. Link imports require exact source-value mappings to valid row IDs in the configured target table. The input document is not mutated; the exact operation list is checked in memory before it is returned. The note importer and its behavior were not changed.

**VERIFIED gates:** targeted native planner + destination + preview + legacy-import suites passed 69/69. `npx --yes bun run check` passed: 90 test files / 1,985 tests and all type, lint, brand, manifest, format, test, build, contrast, CSS, and bundle-size gates. `npx --yes bun run test:layout` passed 115/115; that harness still covers the pre-existing grid, not the native importer or FileView. **NOT RUN:** real Obsidian-host and physical-device checks.

**OPEN:** Step 4 transaction/undo/write, cancellation and native progress/UI remain unimplemented. XLSX workbook reading and worksheet selection remain deferred; a pre-parsed matrix is the only XLSX seam. Parts B–C, R6, release metadata, and tags remain untouched.

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
