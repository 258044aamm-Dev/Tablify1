# R6 — Legacy removal, verification, and release planning

**Guide:** `docs/R6-removal-verification-and-release.md`
**Current mode:** plan only; no cleanup or release action is authorized.

Read the R6 guide, `docs/05-toolchain-and-ci.md`, `docs/07-test-plan.md`, `docs/09-publishing.md`, `docs/10-verification-and-ai-hygiene.md`, current manifests/workflows, and `docs/manual-test-log.md`.

## Plan-only task

Prepare an auditable cutover checklist that identifies:

- Bases runtime classes/registration/config, note/frontmatter paths, `.tabula` parser/migration/UI branches, tests/fixtures, settings, spike, and stale active copy to remove or archive;
- intentional exceptions: Airtable `baseId`, historical docs/releases, Obsidian APIs still needed by the custom file view;
- source gates that block obsolete runtime behavior without rejecting history or Airtable terminology;
- package/manifest/README/changelog/version/tag sequencing, preserving tag `0.1.0` and truthful `0.1.0` history;
- automated gates, real desktop/mobile/spreadsheet/Airtable smoke tests, rollback/recovery proof;
- exact evidence required before `CLEAR TO RELEASE`.

Do not delete files, edit release metadata, build assets, commit, tag, publish, or label any unrun check as passing.
