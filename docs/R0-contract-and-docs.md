# R0 — Contract lock and documentation realignment

**Mode:** planning/documentation. No application implementation. **Entry:** product decisions in the master plan are confirmed; implementation-level decisions remain explicitly open below.

## Objective

Make the target product unambiguous before source work begins. The current active spec, README, agent instructions, and 28-step prompt pack still describe a different product. R0 replaces their *future-state instructions* while preserving the truthful description and history of the `0.1.0` Bases-backed prerelease.

## Authoritative scope

Treat the following as confirmed:

1. Remain the Obsidian plugin in this repository; keep id `tablify`.
2. `.tablify` versioned JSON file is the only native editable database, with multiple tables and views per file.
3. Include linked records in the first stable release; defer formulas, lookups, and rollups.
4. Attachment data is vault-relative path references, never embedded bytes.
5. Deeply remove Obsidian Bases. No Bases view, Base compatibility mode, or `.base` migration.
6. Remove legacy `.tabula` parsing and migration support; do not create a `.tabula` mode.
7. Preserve current grid feature parity; retain CSV/TSV/XLSX import/export.
8. Include manual Airtable pull/push, per-field conflict review, and current safety behavior in the first stable release.
9. No migration from old Bases or `.tabula` data is a product requirement. Never write an unapproved importer.
10. `/Plan only mode` means documentation changes are allowed as requested; source, tests, settings implementation, package/manifest, and release changes are not. *(Amended 2026-10-07: R1–R5 are implemented under the user's standing authorization, recorded in `08-decisions.md` §Implementation authorization log; everything else here still holds.)*

**Terminology guard:** “Bases” in this work means Obsidian’s built-in Bases API/`.base` view system. The remote Airtable API still uses “base” and `baseId`; keep that nomenclature in the Airtable adapter only.

## Step-by-step document work

### Step 1 — Record current and target states separately

- [x] Add a status line to target specifications: “Target contract; not implemented in 0.1.0.”
- [x] Describe `0.1.0` as the existing Bases-backed GitHub prerelease for testing; do not tell users it already opens `.tablify`.
- [x] Correct the release-history fact: tag `0.1.0` exists and the GitHub release is a prerelease; real-vault/device checks remain `NOT RUN` in the current log.
- [x] Keep `CHANGELOG.md`, `PROGRESS.md`, and the old manual-test rows as historical records, except for factual corrections that clearly preserve what happened.

### Step 2 — Rewrite the target product contracts

Update these normative docs to express one consistent future-state contract:

- `docs/01-spec.md`: users, capabilities, keyboard behavior, file-first persistence, import/export, sync, non-goals, success criteria.
- `docs/02-architecture.md`: database/session boundary, JSON repository, custom file view, core/grid/adapter/plugin boundaries, data flow, error paths.
- `docs/03-data-model-and-migration.md`: proposed JSON envelope, identity, typed values, linked records, views, attachment references, internal versioning, explicit absence of old-data migration.
- `docs/06-roadmap.md`: R0–R6 dependencies and exits; no old M0–M6 Bases milestones.
- `docs/07-test-plan.md`: parser/repository/store/grid/import/export/sync/manual gates for `.tablify`.
- `docs/08-decisions.md`: confirmed user decisions, preserved engineering decisions, explicit ADRs needed before dependent work.

### Step 3 — Reconcile supporting docs without rewriting history

- [x] `docs/04-design-system-and-layout.md`: keep the existing responsive/accessibility contract; describe one custom `.tablify` file-view host rather than Bases + legacy-file hosts.
- [x] `docs/05-toolchain-and-ci.md`: keep the current Bun/TypeScript/ESLint/Vitest/Playwright gate; distinguish current pinned Obsidian typings from the future file-view API proof; add the new repository tests to the gate.
- [x] `docs/09-publishing.md`: preserve the existing plugin id/tag/release rules; add the breaking-change disclosure and require new release verification.
- [x] `docs/10-verification-and-ai-hygiene.md`: replace the Bases claim ledger/spikes with repository evidence, custom-file-view API verification, and explicit unresolved claims.
- [x] `docs/11-prompting-guide.md` and `docs/12-agent-prompt-pack.md`: point to R0–R6; require each guide to be executed one fenced step at a time.
- [x] `docs/manual-test-log.md`: keep all old `0.1.0` observations; add a `NOT RUN` checklist for the first `.tablify` build.

### Step 4 — Update entry points and active instructions

- [x] `AGENTS.md`: preserve code-quality and test boundaries; define the future `.tablify` repository boundary; freeze the legacy adapter pending removal; state that plan mode cannot change source.
- [x] `START-HERE.md`, `prompts/README.md`, session anchor, and phase prompts: remove old Base/Tabula implementation steps and link to the native phase guides.
- [x] `README.md`: keep 0.1.0 feature claims accurate; add a clear note that the native `.tablify` refactor is planned, not shipped; link to the plan. Do not advertise future features as available.
- [x] `.github/ISSUE_TEMPLATE/feature_request.md` and developer notes: replace active Bases assumptions with database/table terminology or mark a note as historical.
- [x] Root prototype/design records remain prototype-specific; add a short scope banner if readers could mistake them for the current product contract.
- [x] Do **not** alter `manifest.json`, `package.json`, version files, code, or assets before the `.tablify` implementation cutover. Change user-facing release metadata only together with the code that makes the claim true.

### Step 5 — Record unresolved decisions instead of guessing

Before the affected phase starts, create an ADR for each unresolved item:

| ADR topic | Safe recommendation to evaluate | Due |
|---|---|---|
| Link cardinality and inverse fields | One source field targets one table and stores ordered row IDs; decide whether an inverse field is explicit or generated. | R1/R4 |
| Row/table deletion | Removing an individual linked row clears inbound references atomically and undoably; block deleting a table with inbound links until resolved. | R3 |
| Manual row order | Persist an explicit sequence and define drag behavior when a sort is active. | R1/R4 |
| Empty/unknown values | Preserve distinction among absent, null, empty string, false, zero, and empty lists where field semantics require it. | R1 |
| External file edit | Detect a changed document and ask/reload rather than silently overwriting. | R2 |
| Old Airtable link metadata | Default: do not migrate links keyed by `.base` path/view; leave old metadata untouched and create new links for `.tablify` tables. Ask before adding a conversion path. | R5 |
| Import replace semantics | Replace values/schema only after a full preview and explicit destructive confirmation; define whether fields not in the import are retained or removed. | R5 |
| Cross-table Airtable links | Sync a relation only when its target local table has a complete Airtable record map. | R5 |

## Exact doc-only fence for R0

Allowed: Markdown documentation and prompt files named in this guide, plus moving old prompt Markdown into a clearly labelled historical archive if needed.

Not allowed: any `src/**` TypeScript/TSX, test behavior, generated build asset, `manifest.json`, `package.json`, `versions.json`, lockfile, CSS, release tag, `.tablify` vault data, or credentials.

## R0 verification

- [x] `git diff --stat` contains only documented Markdown/prompt paths.
- [x] Search active instructions/specifications for `BasesView`, `registerBasesView`, `.base` migration, `.tabula` support, note/frontmatter row assumptions, and stale “unreleased/not tagged” claims. Each match is either rewritten or clearly labelled historical/current-0.1.0 truth.
- [x] Search confirmed requirements: multiple tables, linked records, deferred formulas/lookups/rollups, attachment path references, CSV/XLSX import/export, Airtable pull/push/conflict review, no old-data migration.
- [x] Check links between phase guides and the master plan.
- [x] Run `git diff --check`. Do not claim source tests were run; no source code changes are allowed in R0.

**Exit:** a reader can tell, without chat history, what exists in 0.1.0, what is planned, which decisions are settled, which remain open, and what files a later implementation phase may change.
