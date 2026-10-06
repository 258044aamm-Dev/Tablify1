# Prompts — native `.tablify` planning set

**Current mode: plan only.** The active prompts below guide document review and planning. They do not authorize source changes. A separate user instruction is required before any implementation.

## Start a session

1. Read [`00-session-anchor.md`](00-session-anchor.md).
2. Read the matching phase guide in `docs/reference/native-tablify/`.
3. Paste one prompt from `prompts/native-tablify/phase-rN.md`.
4. Review the proposed files and acceptance checks. In plan-only mode, allow only the documentation fence named in the prompt.
5. Inspect the resulting diff, links, and `git diff --check`; do not claim code gates passed if no code was changed/run.

## Phase prompts

| Prompt | Guide | Purpose |
|---|---|---|
| `native-tablify/phase-r0.md` | R0 contract/docs (**completed in this documentation pass**) | Revisit alignment only if scope or active docs change. |
| `native-tablify/phase-r1.md` | R1 JSON schema/core | Plan the schema and parser contract; no source implementation yet. |
| `native-tablify/phase-r2.md` | R2 repository/FileView | Plan API proof and document persistence. |
| `native-tablify/phase-r3.md` | R3 IDs/ops/undo | Plan the single-table-to-database conversion. |
| `native-tablify/phase-r4.md` | R4 grid/links | Plan parity and linked-record interactions. |
| `native-tablify/phase-r5.md` | R5 import/export/sync | Plan spreadsheet flows and Airtable remapping. |
| `native-tablify/phase-r6.md` | R6 removal/release | Plan cleanup and verified release gates. |

## Reusable prompts

- `reuse-adversarial.md` — falsification review after a future authorized implementation.
- `reuse-bugfix.md` — reproduce and isolate a bug before changing code.
- `reuse-handoff.md` — concise state handoff.
- `reuse-release-check.md` — release evidence checklist.
- `reuse-verify.md` — audit claims against evidence.

Old `step-01`–`step-28` prompts described the earlier Bases-first build. They are archived under [`docs/reference/archive/bases-first-prompts-2026-10/`](../docs/reference/archive/bases-first-prompts-2026-10/README.md) and must not be used for the native refactor.

## Shared rules

- Current release and future target are separate. Do not claim `.tablify` support exists before code ships.
- No Bases mode, `.base` migration, `.tabula` reader/migration, or note-backed rows in the target.
- Preserve linked records v1, deferred formulas/lookups/rollups, attachment path refs, grid parity, CSV/TSV/XLSX, manual Airtable conflict review, and no assumed legacy-data migration.
- No package/manifest/version changes, source edits, commits, tags, or release assets in plan-only mode.
- For future code, consult the exact R-phase guide, request authorization, use a file fence, add tests, run gates, and report `VERIFIED`/`ASSUMED`/`NOT RUN` distinctly.
