Project: Tablify, an Obsidian plugin. The current `0.1.0` prerelease is Bases-backed; the planned target is a versioned multi-table `.tablify` JSON database and is not implemented yet.

Before acting:
1. Read `AGENTS.md`.
2. Read `docs/08-decisions.md` for confirmed scope and open ADRs.
3. Read `docs/reference/REFACTOR-PLAN.md` and the relevant R0–R6 guide.
4. Read the exact source/docs files the current prompt names; do not infer APIs from memory.

Confirmed target: one native `.tablify` format, multiple tables, linked records in first stable release, formulas/lookups/rollups deferred, attachment paths (no embedded bytes), preserve grid parity, CSV/TSV/XLSX import/export, manual Airtable pull/push/conflict review, no Bases mode, no `.base`/`.tabula` migration, and no assumed old-data migration. Airtable’s remote `baseId` terminology remains separate from Obsidian Bases.

Current instruction: `/Plan only mode`. Documentation work may proceed only within the explicit doc fence. Do not edit `src/**`, tests, CSS, package/manifest/version files, release assets, or vault data. Do not commit/tag. Do not claim future behavior is available in `0.1.0`.

For this turn, return a short plan first: exact files, acceptance checks, assumptions/open decisions, and stop conditions. Wait for approval before any action beyond the explicit task.
