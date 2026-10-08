# 06 — Native `.tablify` refactor roadmap

> **Status (2026-10-08):** implementation is in progress on `refactor/native-tablify`. R1–R3 are complete; R4 Steps 1–3 have passed their local implementation checkpoints. R5 Part A Steps 1–3 have verified source-preview, destination-contract, and exact-plan checkpoints; Step 4 has verified runner and native wizard/progress/cancel checkpoints (link-value mapping still open; Obsidian-host checks NOT RUN). Parts B–C remain open. XLSX workbook reading/worksheet selection, R6, and all release/version/tag metadata remain untouched. The published `0.1.0` release is still Bases/Markdown-note based; this branch is not a release and no `.tablify` support is claimed for `0.1.0`.

The implementation is deliberately phased, reviewable, and gated. Real Obsidian desktop/mobile probes remain **NOT RUN**; see [`docs/manual-test-log.md`](manual-test-log.md). Detailed step sequences, scope fences, tests, and exit criteria live in [`docs/`](README.md).

## Baseline to preserve

- Repository/plugin id remains `tablify`; do not create a replacement repository or rewrite the `0.1.0` tag.
- The `0.1.0` GitHub release is a prerelease for personal/device testing. Manual real-vault/phone verification remains `NOT RUN` in `docs/manual-test-log.md`.
- **VERIFIED (2026-10-08):** `bun run check` passed: 87 test files / 1,964 tests, plus typecheck, lint, formatting, build, contrast, CSS, and bundle-size gates. `bun run test:layout` passed 115/115 cases; that harness covers the existing grid only and is not a native FileView/device check.
- The application/release metadata remain on the existing Bases-backed `0.1.0` product until an authorized later cutover. Keep `manifest.json`, `package.json`, tags, and releases untouched in R4/R5 implementation steps.

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

## R1 — Native JSON schema and pure core ✅ complete

**Goal:** define the file format before host I/O.

- [x] Freeze envelope, stable IDs, field values/empty semantics, saved views, explicit record order, relation references, and attachment paths.
- [x] Build pure parser/validator/serializer and deterministic internal version migrations for `.tablify` only.
- [x] Create multi-table fixtures and test invalid/future versions, unknown fields/keys, broken links, and round-trip fidelity.
- [x] Keep core independent of Obsidian, React, DOM, file I/O, and Airtable.

**Exit:** schema ADR accepted; all fixtures round-trip; corrupted/future data is never silently reset or rewritten. See the R1 contract and implementation at the current branch head; no new release metadata is implied.

## R2 — Repository and Obsidian custom file view

**Goal:** open, create, save, and reopen `.tablify` safely. Repository/view implementation and automated tests are complete; actual-host probes remain open.

- [x] Verify the relevant `registerView`, `registerExtensions`, `FileView` lifecycle, file-write, and event signatures against pinned typings/docs.
- [ ] Verify those APIs and lifecycle/events against actual desktop **and** phone app versions with the R2 probe kit; both remain **NOT RUN** (see `docs/manual-test-log.md`).
- [x] Add document repository/session, in-memory validated snapshot, active-table projection, document-level serialized write queue, and revision conflict handling.
- [x] Add `.tablify` creation/open/close/reopen/rename and multi-pane behavior with automated coverage.
- [x] Test malformed file, unsupported future version, write failure, external edit/conflict, and view disposal in automated tests.

**Exit:** implementation/automated-test criteria are met; the R2 real-host acceptance check is still open until desktop and phone probes pass. Do not infer an app/device result from typings or browser tests.

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

**Step 1 — VERIFIED (2026-10-08):** the native file-view shell has database/table/view hierarchy, pane-local navigation, create-table/create-view controls through the shared store/queue, a grid region, history/recovery actions, and a status region. DOM tests cover create/switch/restore, two-pane selection isolation, and no-write navigation. The header flex-wraps within its host in the DOM implementation; actual Obsidian FileView geometry/lifecycle is **NOT RUN**. The unchanged Bases grid remains isolated. R2 desktop/phone probes remain user-run.

**Step 2 — VERIFIED implementation checkpoint (2026-10-08):** `NativeDatabaseGrid` renders the active snapshot with native DOM (no React/legacy `GridView` mount), stable row/field IDs, saved-view filter/sort/group/column order/visibility/density, the shared row-window calculation, and per-table selected-view/scroll state. It supports single-cell selection, arrow-key movement, Enter/F2/double-click editing, descriptor-backed basic editors, Tab/Enter commit, Escape cancel, and one shared `set-cells` history/write operation; select/multi-select display labels while retaining option IDs. Unsupported, unaddressable, invalid-stored, and metadata cells stay read-only as applicable; Step 3 now adds the native link path. The native DOM suite covers view/query projection, select-label filtering, keyboard navigation/cancel, valid edits, validation refusal, and undo. Rename/delete focus handling is deferred until those schema controls exist; this checkpoint is not a claim of full R4 parity.

**Step 3 — VERIFIED implementation checkpoint (2026-10-08):** owning link cells render target labels and broken-reference status; a native-DOM single/multiple chooser filters target rows by search and commits changes through `set-link` with row timestamps and shared history. Existing missing/foreign IDs remain explicit removable choices, no-op edits preserve broken IDs and timestamps, and a user can repair a broken reference by choosing a valid target. Generated inverse cells are read-only, derive their visible rows only from owning links, and ignore stale stored inverse values. Both owning and inverse link labels navigate to the linked row through a transient Default view, preserving that table's remembered saved view. DOM tests cover search/no-results filtering, editor commits, broken-reference repair/no-op behavior, inverse derivation/read-only state, and both navigation paths; core tests cover `set-link` timestamps and relation inspection. **VERIFIED:** full `bun run check` passed (87 files / 1,964 tests and all automated gates), and `bun run test:layout` passed 115/115. The layout harness still exercises the pre-existing Bases/React grid. **NOT RUN:** native FileView in actual Obsidian, R2 desktop/phone probes, and physical-device checks. This is a focused checkpoint, not a claim of full R4 parity.

- [x] Implement table/view switching, create-table/create-view, and saved-view projection through the shared operation/store path.
- [ ] Add rename/delete UX for tables, fields, and views; restore focus after those controls remove/rename the active target.
- [x] Implement the initial native DOM active-table grid, basic single-cell selection/editing, and safe history-backed cell commits without React.
- [ ] Retain full range/row/column selection, clipboard, bulk operations, row/column reorder and resize, type-to-replace, shortcuts, and full accessibility/mobile/performance parity.
- [x] Implement native-DOM link labels/search chooser, single/multiple add/remove, broken-reference preservation/repair, generated-inverse read-only derivation, linked-row navigation, and automated coverage.
- [ ] Complete real-host keyboard/screen-reader/mobile verification and define paste/import mapping behavior for link references; no physical-device check is claimed.
- [x] Add native FileView DOM integration tests; `test:layout` still exercises only the pre-existing grid harness.
- [ ] Run the native FileView in real Obsidian desktop and on physical mobile devices; all such checks remain **NOT RUN**.

**Exit:** a multi-table `.tablify` document can be used without enabling Bases; full agreed grid parity and link behavior pass. That exit remains open.

## R5 — Spreadsheet interchange and Airtable

**Goal:** preserve import/export and manual sync on stable local identities.

**Part A, Step 1 — VERIFIED implementation checkpoint (2026-10-08):** the new native-table source preview composes the existing pure matrix reader and inference without using the note-oriented plan. It retains header-adjusted dimensions, source matrix, inference evidence, per-column overrides, and exclusions; it has no note destination or vault-file-collision inputs. Existing note-import behavior is unchanged. **VERIFIED:** `npx bun run check` passed (88 test files / 1,971 tests and all automated repository gates); the targeted preview + legacy-import suites passed 40/40. The existing Playwright layout harness passed 115/115, but covers the pre-existing grid only, not the native FileView/import UI. **OPEN:** XLSX bytes/workbook reading and worksheet selection are not implemented; a pre-parsed XLSX matrix can use this boundary. Step 3 adds native field-name collision rejection; native wizard conflict presentation, apply, and progress remain open. Real-host and physical-device checks remain **NOT RUN**.

**Part A, Step 2 — VERIFIED implementation checkpoint (2026-10-08):** `src/core/database/import/destination.ts` defines create/append/replace destinations and explicit field-ID versus suggested-name mappings. Name suggestions are flagged for later preview confirmation. Replace follows ADR-0007: absent fields are preserved unless explicitly removed; row matches require a selected field ID, otherwise source rows append; unmatched rows are retained and never position-matched/deleted. This is the pure choice contract consumed by Step 3; it does not include a native wizard or apply path. **VERIFIED:** `npx bun run check` passed (89 test files / 1,976 tests); targeted destination + preview + legacy-import tests passed 45/45; `npx bun run test:layout` passed 115/115 on the existing grid harness. Native importer UI, Obsidian-host, and physical-device checks are **NOT RUN**.

**Part A, Step 3 — VERIFIED implementation checkpoint (2026-10-08):** `buildDatabaseImportPlan` and `describeDatabaseImportPlan` now expose the pure native exact-plan boundary. Create/append/replace plans carry the exact operation list, selected/included/excluded columns and types/settings/options, descriptor-backed cell conversions, skipped values, duplicate/key decisions, confirmations, and retained unmatched rows. IDs and clock are injected; link imports require explicit source-value-to-row-ID mappings validated against the configured target table. Keyed replace refuses duplicate source or target keys; no-key imports preserve duplicate source rows. The planner measures serialized document bytes and deterministic work units and warns only against caller-supplied thresholds; it validates operations in memory without mutating the input. The existing note importer is unchanged. **VERIFIED:** targeted planner + destination + preview + legacy-import tests passed 69/69; `npx --yes bun run check` passed (90 test files / 1,985 tests and all automated gates); `npx --yes bun run test:layout` passed 115/115 on the pre-existing grid harness. **OPEN:** native wizard/progress UI and XLSX workbook reading/worksheet selection. Real Obsidian-host and physical-device checks remain **NOT RUN**.

**Part A, Step 4 — VERIFIED transactional-runner checkpoint (2026-10-08):** `src/adapters/tablifyFile/importRunner.ts` consumes the Step 3 plan unchanged, refuses stale or externally changed documents, dispatches exact operations as one database-session history entry, then flushes through the existing shared write queue. Cancellation is honored before dispatch; after dispatch the runner waits for an explicit save result and distinguishes saved from applied-but-unsaved data. The runner does not chunk. A 400×6 test verifies one undo entry and one repository write; the legacy note importer is unchanged. **VERIFIED:** runner + database-store + session + write-queue targeted suites passed 44/44. `npx --yes bun run check` passed in a clean copy with the unrelated uncommitted BOM fixture restored to HEAD: 91 test files / 1,992 tests. `npx --yes bun run test:layout` passed 115/115. **OPEN:** native CSV/TSV source selection and wizard, destination/link-mapping controls, confirmation surface, and visible progress/cancel UI; this checkpoint does not complete Part A Step 4.

**Part A, Step 4 — VERIFIED native wizard checkpoint (2026-10-08):** `src/plugin/nativeImport/` holds a pure model, a native-DOM panel (no React), and an Obsidian `Modal` host. The FileView toolbar has an **Import rows** button. The wizard applies the Step 3 plan through the unchanged runner; cancel is honored only before the commit point. **VERIFIED:** 10 new targeted tests passed; clean-copy `bun run check` 93 files / 2,002 tests, exit 0; `bun run test:layout` 115/115. **OPEN:** explicit link-value mapping; the Obsidian host and physical-device checks are **NOT RUN**.

- [ ] Add the native CSV/TSV/XLSX wizard and transactional apply/undo/cancellation/progress UI on top of the Step 3 exact plan; no note creation or `.tabula` option.
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
