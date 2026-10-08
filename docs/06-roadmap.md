# 06 — Native `.tablify` refactor roadmap

> **Status:** planned work only. The current `0.1.0` prerelease still uses Bases and Markdown-note rows. This roadmap does not claim `.tablify` support exists.

The implementation is deliberately phased. Each phase is a reviewable, testable boundary; no calendar estimate is claimed before the R2 file-write proof and R1 schema decisions are closed. Detailed step sequences, scope fences, tests, and exit criteria live in [`docs/`](README.md).

## Baseline to preserve

- Repository/plugin id remains `tablify`; do not create a replacement repository or rewrite the `0.1.0` tag.
- The `0.1.0` GitHub release is a prerelease for personal/device testing. Manual real-vault/phone verification remains `NOT RUN` in `docs/manual-test-log.md`.
- Current unit/DOM/layout/CI work is the baseline to retain; the test/build gate has not been rerun in this documentation pass.
- The application remains Bases-backed until the cutover. Keep current `manifest.json` and `package.json` product descriptions truthful until a release that actually includes `.tablify` support.

## Dependency graph

```text
R0 — scope, decisions, and docs
 └─ R1 — JSON model/parser/versioning
     └─ R2 — repository + custom file view
         └─ R3 — IDs, database ops, undo, relations
             └─ R4 — grid parity + linked records
                 └─ R5 — CSV/TSV/XLSX + Airtable
                     └─ R6 — delete old paths, verify, release
```

R3 and parts of R2 may be explored in parallel only after their public state/repository interfaces are agreed. Airtable is deliberately after local IDs; otherwise sync mappings would be built on identities scheduled for removal.

## R0 — Scope and documentation (completed documentation pass)

**Goal:** a single accurate contract for what is present versus planned.

- [x] Record all user-confirmed decisions and unresolved engineering choices.
- [x] Rewrite target spec, architecture, data-model, roadmap, test, decision, publishing, verification, and prompting docs.
- [x] Update AGENTS/START-HERE/phase prompts and developer notes so future work does not revive Bases or `.tabula`.
- [x] Keep the README accurate for the released `0.1.0` build and clearly label `.tablify` as planned.
- [x] Do not change package/manifest/release metadata until behavior ships.

**Exit:** active guidance distinguishes current 0.1 behavior from `.tablify` target; no open product-scope contradiction; unresolved details are marked as ADRs.

## R1 — Native JSON schema and pure core

**Goal:** define the file format before host I/O.

- [ ] Freeze envelope, stable IDs, field values/empty semantics, saved views, explicit record order, relation references, and attachment paths.
- [ ] Build pure parser/validator/serializer and deterministic internal version migrations for `.tablify` only.
- [ ] Create multi-table fixtures and test invalid/future versions, unknown fields/keys, broken links, and round-trip fidelity.
- [ ] Keep core independent of Obsidian, React, DOM, file I/O, and Airtable.

**Exit:** schema ADR accepted; all fixtures round-trip; corrupted/future data is never silently reset or rewritten.

## R2 — Repository and Obsidian custom file view

**Goal:** open, create, save, and reopen `.tablify` safely.

- [ ] Verify `registerView`, `registerExtensions`, `FileView` lifecycle, supported file-write APIs, and rename/external-modify events against pinned typings and actual desktop/mobile app versions.
- [ ] Add document repository/session, in-memory validated snapshot, active-table projection, document-level serialized write queue, and revision conflict handling.
- [ ] Add `.tablify` creation/open/close/reopen/rename and multi-pane behavior.
- [ ] Test malformed file, unsupported future version, write failure, Obsidian Sync/external edit, and view disposal.

**Exit:** edit multiple tables, close/reopen, and preserve data; external/newer document state is never clobbered silently; no Bases plugin dependency.

## R3 — Multi-table identities and operations ✅ complete

**Goal:** give the native `.tablify` path stable table/row/field/view/cell identity and one reversible
multi-table state owner. R3's implementation boundary is the native database path; it does not cut over
or delete the still-running Bases grid.

- [x] Establish stable IDs for native schema/projection/operations/inverses/query tie-breaks and the
  per-pane database store. Existing Bases grid/selection remain tracked in the identity inventory and
  are wired to the native projection in R4 or retired in R6.
- [x] Add table/field/row/view/link operations, atomic batches, exact inverses, bounded history, and
  document write-failure/conflict behavior.
- [x] Validate links and implement the approved referential-integrity/delete behavior.
- [x] Store row-owned `createdAt`/`updatedAt` timestamps; metadata fields remain read-only and never use
  the `.tablify` file's Obsidian timestamps. R5 owns import/sync boundary rewiring.

**Exit:** the native multi-table state can apply/undo every supported operation; selected-table saved
query/filter/sort/group output is isolated; native rows/cells use document IDs, not note paths. Remaining
legacy markers and the exact R4/R5/R6 boundaries are recorded in `docs/R3-identities-operations-and-undo.md`
and `docs/audit/R3-identity-inventory.md`. The R2 desktop/phone host probes remain **NOT RUN**; they are
not represented as passing by this R3 completion.

## R4 — Grid parity and links

**Goal:** give the user the existing spreadsheet-class workflows on a native database.

- [ ] Add table/view switching, create/rename/delete UX for tables/fields/views, and persist saved views in the `.tablify` file.
- [ ] Retain selection, keyboard, editing, clipboard, bulk operations, row/column order, undo/redo, accessibility, mobile layout, and performance.
- [ ] Add linked-record chooser, display, navigation, missing-target state, and keyboard/screen-reader behavior.
- [ ] Add native-view lifecycle tests beyond the existing browser-only layout harness.

**Exit:** a multi-table `.tablify` document can be used without enabling Bases; full agreed grid parity and link behavior pass.

## R5 — Spreadsheet interchange and Airtable

**Goal:** preserve import/export and manual sync on stable local identities.

- [ ] Rewire CSV/TSV/XLSX import to create/append/replace table data with exact preview and undo; no note creation or `.tabula` option.
- [ ] Add CSV export alongside TSV/XLSX; define selection/view/table scope, link display, attachment reference, and formula-shaped literal rules.
- [ ] Re-key sync to `databaseId + tableId`, `rowId`, and `fieldId`; preserve manual pull/push/conflict review and token storage.
- [ ] Define linked-record Airtable mapping behavior and safely report unresolved mappings.
- [ ] Default to no migration of old `.base` path/view-keyed sync links; leave old metadata untouched unless separately approved.

**Exit:** import/export round-trips; mocked sync tests cover conflicts, partial reads, stale checks, deletions, links, failures, and secret redaction; CI makes no live API calls.

## R6 — Removal, verification, release

**Goal:** deliver one native data path, with accurate documentation and release evidence.

- [ ] Remove Bases adapters/view registration, frontmatter/note row model, `.tabula` parser/migration, hidden alternatives, obsolete settings/tests/fixtures, and the throwaway Bases spike.
- [ ] Update all active specs, instructions, prompts, issue templates, developer notes, README, and product metadata with behavior that actually ships. Preserve historical release/progress records.
- [ ] Add source gates against Bases and `.tabula` runtime paths, with Airtable terminology/historical text exceptions.
- [ ] Run `bun run check`, `bun run test:layout`, release gates, and real desktop/physical-phone/device-vault tests; mark any unrun check `NOT RUN`.
- [ ] Publish a distinct version/tag; never rewrite `0.1.0`.

**Exit:** `.tablify` JSON is the only native editable database, sync remains safe, no Bases or `.tabula` code path ships, all active docs match the release, and old data is not claimed to migrate.

## Stop conditions

Stop and ask for a decision before: choosing link cardinality/inverse behavior; deleting tables/rows with inbound links; choosing a lossy schema conversion; changing current keyboard behavior; migrating old Airtable link metadata; writing a newer document version; changing `minAppVersion`; adding a runtime dependency; or modifying package/manifest/version/release assets before the new behavior exists.
