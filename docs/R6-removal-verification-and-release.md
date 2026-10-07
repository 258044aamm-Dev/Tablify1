# R6 — Remove legacy paths, verify, and release

**Mode:** documentation and future implementation guide. No source code, manifest, version, or release changes are authorized by this document update. **Dependencies:** R0–R5 are complete and accepted.

## Objective

Finish the cutover by deleting Bases and `.tabula` implementation paths, removing stale active instructions, proving the `.tablify` file view works in real Obsidian, and releasing a distinct verified build. Historical evidence is preserved; it is not a compatibility promise.

## Step-by-step finalization

### Step 1 — Confirm native cutover readiness

Before deleting old code, verify in a scratch vault and automated suite:

- create/open/reopen a multi-table `.tablify` file;
- edit and undo across rows/tables, preserve saved views/relationships;
- import/export CSV/TSV/XLSX;
- perform manual Airtable pull/push and conflict review for a `.tablify` table;
- complete desktop and physical-phone run-throughs;
- no functionality still depends on a Bases query/view or a Markdown-note row.

Do not remove the only working grid path until the replacement is independently validated; do not ship a dual mode after cutover.

### Step 2 — Remove Bases integration

Delete/replace the actual code paths identified in the master plan:

- `src/adapters/bases/**` and Bases-only source kinds;
- `src/plugin/TablifyView.ts` Bases inheritance, `registerBasesView`, `BASES_LEAF_TYPE`, active Bases-leaf lookup/registry, disabled-plugin notice, `.base` config writes;
- Bases property IDs/property-source/frontmatter parsing and note-created timestamps in core;
- note creation/import/settings code that exists only to turn spreadsheet rows into Markdown files;
- test fakes/fixtures and boundary exceptions whose only purpose was Bases behavior.

Keep Obsidian APIs still required for custom file views, workspace leaves, vault text files, settings, commands, notices, modals/menus, and `SecretStorage`. Do not remove the `obsidian` dev dependency.

### Step 3 — Remove legacy `.tabula`

Delete `.tabula` model/parser/migration modules and wizard/command/setting paths, their fixtures and tests. Retain only truthful, concise release/history statements such as “0.1.0 supported a legacy path; the native refactor does not.” Do not leave disabled buttons, unused adapters, a hidden “read-only” file view, or orphaned documentation that promises migration.

### Step 4 — Clean development artifacts and gates

- Delete the throwaway `docs/legacy/spike/bases-path/**` after preserving relevant audit facts in this plan or a clearly historical note.
- Remove obsolete `Bases` brand allowlist entries and adjust Base-specific lint/build/brand scripts with tests. Do not ban Airtable’s `baseId` or historical text.
- Update source/test import-boundary rules for `tablifyFile` and the database repository; assert that core remains pure and sync stays provider-agnostic.
- Run targeted grep over shipped TypeScript, styles, active prompts/docs, manifest description, issue templates, and release copy. Classify each remaining `Bases`, `.base`, `.tabula`, or frontmatter hit: historical statement, remote Airtable term, intentional negative test, or stale product dependency.

### Step 5 — Update active docs and public copy after behavior is real

- README describes the native `.tablify` plugin only after the release includes it; include the old `.base`/`.tabula` no-migration notice, offline/network disclosure, linked record support, formulas deferred, and CSV export.
- Update manifest/package descriptions, version files, documentation screenshots/manual, issue templates, settings text, docs/01–12, `AGENTS.md`, `START-HERE.md`, prompts, and developer notes together.
- Preserve `CHANGELOG.md`’s `0.1.0` entry, `PROGRESS.md` historical gates, old screenshots only if clearly labelled, license/NOTICE attribution, and the `0.1.0` tag.
- Add a dated unreleased/current version changelog section for the breaking refactor. Do not claim migration or support for old data.

### Step 6 — Run automated verification

At minimum, run the existing `bun run check` and `bun run test:layout`, plus the new format/repository/link/sync test matrix. Verify a clean checkout and release workflow using a distinct version/tag. Do not loosen tests or remove assertions to pass.

### Step 7 — Complete manual verification

Copy the new template in `docs/manual-test-log.md`; record exact Obsidian version, plugin build SHA, device, OS, and result. Test:

- fresh dev vault with Bases disabled;
- create a `.tablify`, multiple tables/views, link editing, save/reopen, rename/move;
- desktop file-change conflict / two panes;
- phone keyboard, focus, safe area, scroll, long-press, screen reader where available;
- spreadsheet import/export in real Excel/Sheets or compatible apps;
- Airtable pull/push and deliberate conflict with a non-production/scratch base, if credentials/test data are available;
- old `.base`/`.tabula` files untouched and no false “migration succeeded” message.

A non-run check remains `NOT RUN`; do not infer pass from the browser harness.

### Step 8 — Release safely

- Keep id `tablify` and never alter the existing `0.1.0` tag/release.
- Select a new version/tag under the repository’s versioning policy and label the first build a prerelease if real device checks or review remain incomplete.
- Ensure manifest, package metadata, `versions.json`, tag, changelog, and three separate Obsidian release assets agree.
- Community submission remains blocked until the intended release gates are complete; do not call the plan itself a release.

## R6 exit criteria

- Shipped code has one native editable local data path: `.tablify` JSON.
- No runtime Bases view/adapter, `.base` view-config read/write, note-row storage, `.tabula` reader/migration, or legacy import mode remains.
- Airtable manual sync still works against local table IDs and uses `SecretStorage`; “Airtable base” remains only as remote terminology.
- Active docs and product metadata match the code; historical records are labelled and factually accurate.
- Automated checks and real-device/vault test log are complete, with assumptions/known limits stated.
- A distinct release is prepared without rewriting history or claiming old-data migration.
